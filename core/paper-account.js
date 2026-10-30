import { randomUUID } from "node:crypto";
import { z } from "zod";

const clean = (value) => Number(value.toPrecision(15));
const positive = z.number().finite().positive().max(1e12);
const timestamp = z.number().int().positive().max(8.64e15);
export const paperOrderSchema = z
  .object({
    symbol: z.string().regex(/^[A-Z0-9]{2,20}USDT$/),
    side: z.enum(["buy", "sell"]),
    type: z.enum(["market", "limit", "stop"]),
    quantity: z
      .number()
      .finite()
      .min(1e-8)
      .max(1e9)
      .refine(
        (n) => clean(n) === n,
        "Use at most 15 significant digits for quantity.",
      ),
    price: positive.optional(),
    maxNotional: positive.optional(),
    feePercent: z.number().finite().min(0).max(5).default(0.1),
    slippage: z.number().finite().min(0).max(1e9).default(0),
  })
  .strict()
  .superRefine((p, ctx) => {
    const fail = (message) => ctx.addIssue({ code: "custom", message });
    if (p.type !== "market" && p.price === undefined)
      fail("Limit/stop price is required.");
    if (p.type === "market" && p.price !== undefined)
      fail("Market orders do not use a limit/stop price.");
    if (p.side === "buy" && p.type === "stop")
      fail("Stop orders are sell exits only.");
    if (p.side === "buy" && p.type === "market" && p.maxNotional === undefined)
      fail("Market buys require a maximum entry notional.");
    if (
      !(p.side === "buy" && p.type === "market") &&
      p.maxNotional !== undefined
    )
      fail("Maximum notional is only used for market buys.");
  });
const quoteSchema = z
  .object({
    symbol: z.string(),
    bid: positive,
    ask: positive,
    requestedAt: timestamp,
    receivedAt: timestamp,
    source: z.literal("Binance public bookTicker REST"),
  })
  .strict();
const planSchema = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    name: z.string().max(100),
  })
  .strict();
const eventSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("submit"),
      at: timestamp,
      id: z.string().uuid(),
      requestId: z.string().uuid(),
      input: paperOrderSchema,
      plan: planSchema.nullable(),
    })
    .strict(),
  z
    .object({ kind: z.literal("cancel"), at: timestamp, id: z.string().uuid() })
    .strict(),
  z
    .object({
      kind: z.literal("process"),
      at: timestamp,
      id: z.string().uuid(),
      quote: quoteSchema,
    })
    .strict(),
]);
const archiveSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    currency: z.literal("USDT"),
    initialCash: positive,
    createdAt: timestamp,
    events: z.array(eventSchema).max(5000),
  })
  .strict();
function reserve(order) {
  return (
    (order.type === "market"
      ? order.maxNotional
      : order.quantity * order.price) *
    (1 + order.feePercent / 100)
  );
}
function available(s) {
  let reservedCash = 0;
  const reservedQuantity = {};
  for (const o of s.orders.filter((o) => o.status === "pending")) {
    if (o.side === "buy") reservedCash = clean(reservedCash + reserve(o));
    else
      reservedQuantity[o.symbol] = clean(
        (reservedQuantity[o.symbol] ?? 0) + o.quantity,
      );
  }
  return {
    reservedCash,
    availableCash: clean(s.cash - reservedCash),
    reservedQuantity,
  };
}
function fresh(raw, symbol, at) {
  const q = quoteSchema.parse(raw);
  if (
    q.symbol !== symbol ||
    q.bid > q.ask ||
    q.requestedAt > q.receivedAt ||
    q.receivedAt > at ||
    at - q.requestedAt > 5000
  )
    throw Error(
      "Quote is invalid or older than five seconds; retry with a fresh quote.",
    );
  return q;
}
function apply(s, e) {
  if (e.kind === "submit") {
    if (s.orders.length >= 1000)
      throw Error(
        "Paper ledger is full (1,000 orders). Export it before starting a future account.",
      );
    if (s.orders.some((o) => o.id === e.id || o.requestId === e.requestId))
      throw Error("Duplicate paper order.");
    if (s.orders.filter((o) => o.status === "pending").length >= 50)
      throw Error("At most 50 pending paper orders are supported.");
    const p = e.input,
      a = available(s);
    if (p.side === "buy") {
      if (!Number.isFinite(reserve(p)) || clean(reserve(p)) > a.availableCash)
        throw Error(
          "Insufficient available paper cash, including reserved orders and fees.",
        );
    } else if (
      p.quantity >
      clean(
        (s.positions[p.symbol]?.quantity ?? 0) -
          (a.reservedQuantity[p.symbol] ?? 0),
      )
    )
      throw Error(
        "Insufficient unreserved position quantity. Short sales are not supported.",
      );
    s.orders.push({
      id: e.id,
      requestId: e.requestId,
      ...p,
      plan: e.plan,
      status: "pending",
      submittedAt: e.at,
    });
    return;
  }
  const o = s.orders.find((o) => o.id === e.id);
  if (!o || o.status !== "pending")
    throw Error("Order is no longer pending; refresh the paper account.");
  if (e.kind === "cancel") {
    o.status = "cancelled";
    o.completedAt = e.at;
    return;
  }
  const q = fresh(e.quote, o.symbol, e.at);
  if (q.requestedAt < o.submittedAt)
    throw Error("Quote predates the submitted order.");
  const price = o.side === "buy" ? q.ask + o.slippage : q.bid - o.slippage;
  if (!(price > 0) || !Number.isFinite(price))
    throw Error("Slippage produces an invalid fill price.");
  if (
    o.type === "limit" &&
    (o.side === "buy" ? price > o.price : price < o.price)
  )
    return "Limit has not been reached after slippage.";
  if (o.type === "stop" && q.bid > o.price)
    return "Sell stop has not triggered.";
  const notional = clean(price * o.quantity),
    fee = clean((notional * o.feePercent) / 100);
  if (!Number.isFinite(notional + fee) || notional + fee > 1e15)
    throw Error("Paper fill exceeds numeric capacity.");
  if (o.side === "buy" && o.type === "market" && notional > o.maxNotional) {
    o.status = "rejected";
    o.completedAt = e.at;
    o.reason = "Fresh ask plus slippage exceeds the market-buy notional cap.";
    return;
  }
  const pos = s.positions[o.symbol] ?? { quantity: 0, cost: 0, realizedPnl: 0 };
  let realizedPnl = 0;
  if (o.side === "buy") {
    if (clean(notional + fee) > s.cash)
      throw Error("Paper cash invariant failed.");
    s.cash = clean(s.cash - clean(notional + fee));
    pos.quantity = clean(pos.quantity + o.quantity);
    pos.cost += notional + fee;
  } else {
    if (o.quantity > pos.quantity)
      throw Error("Paper position invariant failed.");
    const cost =
      o.quantity === pos.quantity
        ? pos.cost
        : pos.cost * (o.quantity / pos.quantity);
    realizedPnl = notional - fee - cost;
    pos.quantity = clean(pos.quantity - o.quantity);
    pos.cost -= cost;
    pos.realizedPnl += realizedPnl;
    s.cash = clean(s.cash + notional - fee);
  }
  if (![s.cash, pos.quantity, pos.cost, pos.realizedPnl].every(Number.isFinite))
    throw Error("Paper balance exceeds numeric capacity.");
  s.positions[o.symbol] = pos;
  o.status = "filled";
  o.completedAt = e.at;
  s.fills.push({
    orderId: o.id,
    symbol: o.symbol,
    side: o.side,
    quantity: o.quantity,
    price,
    notional,
    fee,
    realizedPnl,
    at: e.at,
    quote: q,
  });
}
function replay(doc) {
  const s = {
    id: doc.id,
    currency: doc.currency,
    initialCash: doc.initialCash,
    createdAt: doc.createdAt,
    revision: doc.events.length + 1,
    cash: doc.initialCash,
    orders: [],
    fills: [],
    positions: {},
  };
  let last = doc.createdAt;
  for (const e of doc.events) {
    if (e.at < last) throw Error("Paper ledger timestamps are out of order.");
    if (apply(s, e))
      throw Error("Paper ledger contains a non-executable fill event.");
    last = e.at;
  }
  return {
    ...s,
    ...available(s),
    realizedPnl: Object.values(s.positions).reduce(
      (n, p) => n + p.realizedPnl,
      0,
    ),
    ledger: doc.events,
  };
}
export class PaperAccount {
  constructor({ storage, quote, validateMarket, now = Date.now }) {
    this.storage = storage;
    this.quote = quote;
    this.validateMarket = validateMarket;
    this.now = now;
    this.queue = Promise.resolve();
  }
  serial(fn) {
    const job = this.queue.then(fn);
    this.queue = job.catch(() => {});
    return job;
  }
  async read() {
    const raw = await this.storage.read();
    if (raw === null) return null;
    const doc = archiveSchema.parse(raw);
    replay(doc); // Never silently reset or trust cached balances from disk.
    return doc;
  }
  snapshot() {
    return this.serial(async () => {
      const doc = await this.read();
      return doc ? replay(doc) : null;
    });
  }
  create({ initialCash }) {
    return this.serial(async () => {
      positive.parse(initialCash);
      if (await this.read())
        throw Error("A paper account already exists. Refresh to load it.");
      const doc = archiveSchema.parse({
        version: 1,
        id: randomUUID(),
        currency: "USDT",
        initialCash,
        createdAt: this.now(),
        events: [],
      });
      await this.storage.write(doc);
      return replay(doc);
    });
  }
  check(doc, revision) {
    if (!doc) throw Error("Create a paper account first.");
    if (revision !== doc.events.length + 1)
      throw Error("Paper account changed elsewhere; refresh before retrying.");
    if (doc.events.length >= 5000)
      throw Error(
        "Paper ledger is full. Export the ledger; no events were removed.",
      );
  }
  time(doc) {
    return Math.max(this.now(), doc.events.at(-1)?.at ?? doc.createdAt);
  }
  async commit(doc, event) {
    const next = archiveSchema.parse({
        ...doc,
        events: [...doc.events, event],
      }),
      result = replay(next);
    await this.storage.write(next);
    return result;
  }
  submit({ expectedRevision, requestId, input, plan = null }) {
    return this.serial(async () => {
      input = paperOrderSchema.parse(input);
      z.string().uuid().parse(requestId);
      plan = plan === null ? null : planSchema.parse(plan);
      const doc = await this.read(),
        previous = doc?.events.find(
          (e) => e.kind === "submit" && e.requestId === requestId,
        );
      if (previous) {
        if (
          JSON.stringify(previous.input) !== JSON.stringify(input) ||
          JSON.stringify(previous.plan) !== JSON.stringify(plan)
        )
          throw Error("Request ID was already used for a different order.");
        return replay(doc);
      }
      this.check(doc, expectedRevision);
      await this.validateMarket(input.symbol);
      return this.commit(doc, {
        kind: "submit",
        at: this.time(doc),
        id: randomUUID(),
        requestId,
        input,
        plan,
      });
    });
  }
  cancel({ expectedRevision, id }) {
    return this.serial(async () => {
      const doc = await this.read();
      this.check(doc, expectedRevision);
      return this.commit(doc, { kind: "cancel", at: this.time(doc), id });
    });
  }
  process({ expectedRevision, id }) {
    return this.serial(async () => {
      const doc = await this.read();
      this.check(doc, expectedRevision);
      const s = replay(doc),
        order = s.orders.find((o) => o.id === id && o.status === "pending");
      if (!order)
        throw Error("Order is no longer pending; refresh the paper account.");
      const quote = await this.quote(order.symbol),
        event = { kind: "process", at: this.time(doc), id, quote };
      const waiting = apply(s, event);
      if (waiting) return { account: replay(doc), message: waiting };
      return {
        account: await this.commit(doc, event),
        message:
          s.orders.find((o) => o.id === id).status === "filled"
            ? "Simulated fill recorded."
            : "Order rejected; reserved cash released.",
      };
    });
  }
  close() {
    return this.queue;
  }
}

// Public data only; no API key, order endpoint or exchange account is involved.
export async function paperQuote(
  symbol,
  { fetcher = fetch, now = Date.now } = {},
) {
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol))
    throw Error("Choose a Binance USDT spot market.");
  const requestedAt = now();
  const response = await fetcher(
    `https://data-api.binance.vision/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`,
    { signal: AbortSignal.timeout(5000), redirect: "error", cache: "no-store" },
  );
  if (!response.ok)
    throw Error(
      `Public paper quote unavailable (${response.status}); order remains pending.`,
    );
  const data = await response.json(),
    receivedAt = now();
  return fresh(
    {
      symbol: data.symbol,
      bid: Number(data.bidPrice),
      ask: Number(data.askPrice),
      requestedAt,
      receivedAt,
      source: "Binance public bookTicker REST",
    },
    symbol,
    receivedAt,
  );
}
