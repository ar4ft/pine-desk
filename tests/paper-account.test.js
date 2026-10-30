import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  PaperAccount,
  paperQuote,
  paperOrderSchema,
} from "../core/paper-account.js";
import { toolDefinitions } from "../core/mcp-tools.js";
const input = (patch = {}) => ({
  symbol: "BTCUSDT",
  side: "buy",
  type: "market",
  quantity: 2,
  maxNotional: 220,
  feePercent: 1,
  slippage: 1,
  ...patch,
});
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function fixture() {
  let doc = null,
    fail = false,
    time = 10000,
    bid = 99,
    ask = 100,
    network = false,
    offset = 0,
    calls = 0;
  const storage = {
    read: async () => structuredClone(doc),
    write: async (d) => {
      if (fail) throw Error("disk full");
      doc = structuredClone(d);
    },
  };
  const opts = {
    storage,
    now: () => time,
    validateMarket: async (s) => {
      if (s !== "BTCUSDT") throw Error("Unknown market");
    },
    quote: async (symbol) => {
      calls++;
      if (network) throw Error("offline");
      return {
        symbol,
        bid,
        ask,
        requestedAt: time + offset,
        receivedAt: time + offset,
        source: "Binance public bookTicker REST",
      };
    },
  };
  const account = new PaperAccount(opts);
  return {
    account,
    opts,
    storage,
    doc: () => doc,
    setDoc: (v) => {
      doc = v;
    },
    fail: (v) => {
      fail = v;
    },
    network: (v) => {
      network = v;
    },
    offset: (v) => {
      offset = v;
    },
    prices: (b, a) => {
      bid = b;
      ask = a;
      time += 1000;
    },
    calls: () => calls,
  };
}
async function submit(account, patch = {}, extra = {}) {
  const s = await account.snapshot();
  return account.submit({
    expectedRevision: s.revision,
    requestId: randomUUID(),
    input: input(patch),
    ...extra,
  });
}
async function processLast(account) {
  const s = await account.snapshot();
  return account.process({
    expectedRevision: s.revision,
    id: s.orders.at(-1).id,
  });
}
test("cash-funded buys and partial/full sells reconcile fees, average cost and realized ledger P&L", async () => {
  const f = fixture(),
    a = f.account;
  await a.create({ initialCash: 1000 });
  let s = await submit(a);
  near(s.reservedCash, 222.2);
  near(s.availableCash, 777.8);
  s = (await processLast(a)).account;
  assert.equal(s.orders[0].status, "filled");
  near(s.cash, 795.98);
  near(s.positions.BTCUSDT.cost, 204.02);
  assert.equal(s.fills[0].price, 101);
  near(s.fills[0].fee, 2.02);
  f.prices(120, 121);
  s = await submit(a, { side: "sell", quantity: 0.5, maxNotional: undefined });
  assert.equal(s.reservedQuantity.BTCUSDT, 0.5);
  s = (await processLast(a)).account;
  near(s.fills[1].realizedPnl, 7.9);
  near(s.positions.BTCUSDT.cost, 153.015);
  s = await submit(a, { side: "sell", quantity: 1.5, maxNotional: undefined });
  s = (await processLast(a)).account;
  assert.equal(s.positions.BTCUSDT.quantity, 0);
  assert.equal(s.positions.BTCUSDT.cost, 0);
  near(s.realizedPnl, 31.6);
  near(s.cash, 1031.6);
  assert.equal(s.fills.length, 3);
  assert.equal(s.revision, 7);
  const reopened = new PaperAccount(f.opts);
  assert.deepEqual(await reopened.snapshot(), s);
});
test("reservations prevent overspending and overselling and cancel releases them", async () => {
  const { account: a } = fixture();
  await a.create({ initialCash: 300 });
  let s = await submit(a);
  await assert.rejects(submit(a), /Insufficient available/);
  s = await a.cancel({ id: s.orders[0].id, expectedRevision: s.revision });
  assert.equal(s.availableCash, 300);
  assert.equal(s.reservedCash, 0);
  await assert.rejects(
    submit(a, { side: "sell", maxNotional: undefined }),
    /Insufficient unreserved/,
  );
  await submit(a);
  await processLast(a);
  s = await submit(a, { side: "sell", quantity: 1.5, maxNotional: undefined });
  await assert.rejects(
    submit(a, { side: "sell", quantity: 1, maxNotional: undefined }),
    /Insufficient unreserved/,
  );
  await a.cancel({ id: s.orders.at(-1).id, expectedRevision: s.revision });
  s = await submit(a, { side: "sell", quantity: 2, maxNotional: undefined });
  assert.equal(s.reservedQuantity.BTCUSDT, 2);
});
test("limits wait without ledger mutation and never fill beyond their limit after slippage", async () => {
  const f = fixture(),
    a = f.account;
  await a.create({ initialCash: 1000 });
  let s = await submit(a, {
    type: "limit",
    price: 100,
    maxNotional: undefined,
  });
  const before = structuredClone(f.doc());
  let r = await processLast(a);
  assert.match(r.message, /not been reached/);
  assert.deepEqual(f.doc(), before);
  f.prices(98, 99);
  r = await processLast(a);
  assert.equal(r.account.fills[0].price, 100);
  s = await submit(a, {
    type: "limit",
    side: "sell",
    price: 110,
    maxNotional: undefined,
  });
  f.prices(110, 111);
  r = await processLast(a);
  assert.equal(r.account.orders.at(-1).status, "pending");
  f.prices(112, 113);
  r = await processLast(a);
  assert.equal(r.account.fills.at(-1).price, 111);
});
test("sell stops use current bid and gap through triggers; market-buy cap rejects and releases cash", async () => {
  const f = fixture(),
    a = f.account;
  await a.create({ initialCash: 1000 });
  await submit(a);
  await processLast(a);
  await submit(a, {
    side: "sell",
    type: "stop",
    price: 90,
    maxNotional: undefined,
  });
  assert.match((await processLast(a)).message, /not triggered/);
  f.prices(80, 81);
  let s = (await processLast(a)).account;
  assert.equal(s.fills.at(-1).price, 79);
  await submit(a, { maxNotional: 50 });
  s = (await processLast(a)).account;
  assert.equal(s.orders.at(-1).status, "rejected");
  assert.equal(s.reservedCash, 0);
  assert.equal(s.fills.length, 2);
});
test("offline, stale, future, crossed and pre-submission quotes never change the ledger", async () => {
  const f = fixture(),
    a = f.account;
  await a.create({ initialCash: 1000 });
  await submit(a);
  const before = structuredClone(f.doc());
  f.network(true);
  await assert.rejects(processLast(a), /offline/);
  f.network(false);
  for (const offset of [-6000, 1000, -1]) {
    f.offset(offset);
    await assert.rejects(processLast(a), /Quote/);
    assert.deepEqual(f.doc(), before);
  }
  f.offset(0);
  f.prices(101, 100);
  await assert.rejects(processLast(a), /Quote/);
  assert.deepEqual(f.doc(), before);
});
test("optimistic revisions, request idempotency and terminal orders prevent duplicate fills", async () => {
  const { account: a, calls } = fixture();
  await a.create({ initialCash: 1000 });
  const args = { expectedRevision: 1, requestId: randomUUID(), input: input() };
  const [x, y] = await Promise.all([a.submit(args), a.submit(args)]);
  assert.deepEqual(x, y);
  assert.equal(x.orders.length, 1);
  await assert.rejects(
    a.submit({ ...args, input: input({ quantity: 1 }) }),
    /different order/,
  );
  await assert.rejects(
    a.submit({ ...args, requestId: randomUUID() }),
    /changed elsewhere/,
  );
  const processArgs = { expectedRevision: x.revision, id: x.orders[0].id };
  const results = await Promise.allSettled([
    a.process(processArgs),
    a.process(processArgs),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(calls(), 1);
  const s = await a.snapshot();
  await assert.rejects(
    a.process({ ...processArgs, expectedRevision: s.revision }),
    /no longer pending/,
  );
  await assert.rejects(
    a.cancel({ ...processArgs, expectedRevision: s.revision }),
    /no longer pending/,
  );
  assert.equal((await a.snapshot()).fills.length, 1);
});
test("failed writes leave reservations and fills unchanged and permit safe retry", async () => {
  const f = fixture(),
    a = f.account;
  await a.create({ initialCash: 1000 });
  const args = { expectedRevision: 1, requestId: randomUUID(), input: input() };
  f.fail(true);
  await assert.rejects(a.submit(args), /disk full/);
  assert.equal((await a.snapshot()).orders.length, 0);
  f.fail(false);
  await a.submit(args);
  const before = structuredClone(f.doc());
  f.fail(true);
  await assert.rejects(processLast(a), /disk full/);
  assert.deepEqual(f.doc(), before);
  f.fail(false);
  await processLast(a);
  assert.equal((await a.snapshot()).fills.length, 1);
});
test("invalid models, markets and archive events fail without resetting the account", async () => {
  const f = fixture(),
    a = f.account;
  await assert.rejects(a.create({ initialCash: Infinity }));
  await a.create({ initialCash: 1000 });
  await assert.rejects(a.create({ initialCash: 1000 }), /already exists/);
  for (const patch of [
    { symbol: "BTCUSD" },
    { quantity: 0 },
    { feePercent: 6 },
    { type: "stop", price: 90 },
    { type: "limit", maxNotional: undefined },
    { side: "short" },
    { slippage: -1 },
    { execution: true },
  ])
    assert.equal(paperOrderSchema.safeParse(input(patch)).success, false);
  await assert.rejects(submit(a, { symbol: "BADUSDT" }), /Unknown market/);
  await submit(a);
  const original = structuredClone(f.doc());
  for (const patch of [
    (d) => (d.version = 9),
    (d) => d.events.push(d.events[0]),
    (d) => (d.events[0].at = 1),
    (d) => (d.events[0].input.maxNotional = 1e8),
  ]) {
    const d = structuredClone(original);
    patch(d);
    f.setDoc(d);
    await assert.rejects(a.snapshot());
    assert.deepEqual(f.doc(), d);
  }
});
test("public quote adapter bounds request age and validates symbol, bid/ask and HTTP errors", async () => {
  const times = [10000, 10010];
  const q = await paperQuote("BTCUSDT", {
    now: () => times.shift(),
    fetcher: async (url, opts) => {
      assert.match(url, /bookTicker/);
      assert.equal(opts.redirect, "error");
      return {
        ok: true,
        json: async () => ({
          symbol: "BTCUSDT",
          bidPrice: "99",
          askPrice: "100",
        }),
      };
    },
  });
  assert.equal(q.bid, 99);
  assert.equal(q.receivedAt, 10010);
  await assert.rejects(
    paperQuote("BTCUSDT", {
      fetcher: async () => ({ ok: false, status: 429 }),
    }),
    /429/,
  );
  await assert.rejects(
    paperQuote("BTCUSDT", {
      fetcher: async () => ({
        ok: true,
        json: async () => ({
          symbol: "ETHUSDT",
          bidPrice: "99",
          askPrice: "100",
        }),
      }),
    }),
    /Quote/,
  );
  const late = [10000, 16000];
  await assert.rejects(
    paperQuote("BTCUSDT", {
      now: () => late.shift(),
      fetcher: async () => ({
        ok: true,
        json: async () => ({
          symbol: "BTCUSDT",
          bidPrice: "99",
          askPrice: "100",
        }),
      }),
    }),
    /five seconds/,
  );
});
test("paper MCP separates read from research and rejects injected quotes or real-order flags", () => {
  const defs = toolDefinitions(),
    read = defs.find((d) => d.name === "paper_account");
  assert.equal(read.capability, "read");
  for (const d of defs.filter((d) => d.name.startsWith("paper_") && d !== read))
    assert.equal(d.capability, "research");
  const process = defs.find((d) => d.name === "paper_process");
  assert.equal(
    process.schema.safeParse({
      id: randomUUID(),
      expectedRevision: 1,
      quote: { bid: 1, ask: 1 },
    }).success,
    false,
  );
  assert.equal(
    defs
      .find((d) => d.name === "desktop_navigate")
      .schema.safeParse({ page: "paper" }).success,
    true,
  );
});

test("fractional holdings can be fully exited without binary-rounding dust or false oversells", async () => {
  const { account: a } = fixture();
  await a.create({ initialCash: 1000 });
  await submit(a, { quantity: 0.3 });
  await processLast(a);
  await submit(a, { side: "sell", quantity: 0.1, maxNotional: undefined });
  await processLast(a);
  assert.equal((await a.snapshot()).positions.BTCUSDT.quantity, 0.2);
  await submit(a, { side: "sell", quantity: 0.2, maxNotional: undefined });
  const s = (await processLast(a)).account;
  assert.equal(s.positions.BTCUSDT.quantity, 0);
  assert.equal(s.positions.BTCUSDT.cost, 0);
});

test("fractional pending exits reserve the full position without false oversells", async () => {
  const { account: a } = fixture();
  await a.create({ initialCash: 1000 });
  await submit(a, { quantity: 0.3 });
  await processLast(a);
  await submit(a, { side: "sell", quantity: 0.1, maxNotional: undefined });
  const s = await submit(a, {
    side: "sell",
    quantity: 0.2,
    maxNotional: undefined,
  });
  assert.equal(s.reservedQuantity.BTCUSDT, 0.3);
  await assert.rejects(
    submit(a, { side: "sell", quantity: 1e-8, maxNotional: undefined }),
    /Insufficient unreserved/,
  );
});

test("an exactly funded fractional-notional order fills without a false cap rejection or negative cash", async () => {
  const f = fixture(),
    a = f.account;
  await a.create({ initialCash: 3.3 });
  f.prices(1.09, 1.1);
  await submit(a, {
    quantity: 3,
    maxNotional: 3.3,
    feePercent: 0,
    slippage: 0,
  });
  const s = (await processLast(a)).account;
  assert.equal(s.orders[0].status, "filled");
  assert.equal(s.cash, 0);
  assert.equal(s.positions.BTCUSDT.cost, 3.3);
});
