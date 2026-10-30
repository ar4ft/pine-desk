import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PaperAccount } from "../core/paper-account.js";
import { defaultPaperRisk, paperRiskSchema } from "../core/paper-risk.js";
import { toolDefinitions } from "../core/mcp-tools.js";

function fixture() {
  let doc = null,
    at = Date.UTC(2026, 9, 30, 12),
    bid = 99,
    ask = 100,
    fail = false;
  const opts = {
    now: () => at,
    storage: {
      read: async () => structuredClone(doc),
      write: async (d) => {
        if (fail) throw Error("disk full");
        doc = structuredClone(d);
      },
    },
    validateMarket: async () => {},
    quote: async (symbol) => ({
      symbol,
      bid,
      ask,
      requestedAt: at,
      receivedAt: at,
      source: "Binance public bookTicker REST",
    }),
  };
  const a = new PaperAccount(opts);
  const risk = async (patch) => {
    const s = await a.snapshot();
    return a.setRisk({
      expectedRevision: s.revision,
      policy: { ...s.risk, ...patch },
    });
  };
  const submit = async (patch = {}) =>
    a.submit({
      expectedRevision: (await a.snapshot()).revision,
      requestId: randomUUID(),
      input: {
        symbol: "BTCUSDT",
        side: "buy",
        type: "limit",
        price: 100,
        quantity: 1,
        feePercent: 0,
        ...patch,
      },
    });
  const process = async (id) => {
    const s = await a.snapshot();
    return a.process({
      expectedRevision: s.revision,
      id: id ?? s.orders.at(-1).id,
    });
  };
  return {
    a,
    opts,
    risk,
    submit,
    process,
    doc: () => structuredClone(doc),
    setDoc: (d) => {
      doc = d;
    },
    fail: (v) => {
      fail = v;
    },
    prices: (b, q) => {
      bid = b;
      ask = q;
      at += 1000;
    },
    time: (v) => {
      at = v;
    },
  };
}
test("entry limits count fees, held cost and pending reservations; equality is allowed without double counting a filling order", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  await f.risk({ maxOrderCost: 101, maxSymbolCost: 202, maxTotalCost: 250 });
  await assert.rejects(f.submit({ feePercent: 2 }), /per-order/);
  let s = await f.submit({ feePercent: 1 });
  assert.equal(s.riskUsage.totalCost, 101);
  await f.process();
  await f.submit({ feePercent: 1 });
  await assert.rejects(f.submit({ quantity: 0.01 }), /per-market/);
  await assert.rejects(
    f.submit({ symbol: "ETHUSDT", quantity: 0.49 }),
    /total limit/,
  );
  await f.process();
  s = await f.a.snapshot();
  assert.equal(s.positions.BTCUSDT.quantity, 2);
  assert.equal(s.riskUsage.totalCost, 202);
  assert.equal(s.reservedCash, 0);
  assert.deepEqual(await new PaperAccount(f.opts).snapshot(), s);
});
test("market-buy caps include fees and count distinct held/pending markets until cancellation or full exit", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  await f.risk({ maxOrderCost: 110, maxMarkets: 1 });
  await assert.rejects(
    f.submit({
      type: "market",
      price: undefined,
      maxNotional: 110,
      feePercent: 1,
    }),
    /per-order/,
  );
  let s = await f.submit();
  await assert.rejects(f.submit({ symbol: "ETHUSDT" }), /market-count/);
  s = await f.a.cancel({ expectedRevision: s.revision, id: s.orders[0].id });
  await f.submit({ symbol: "ETHUSDT" });
  await f.process();
  await assert.rejects(f.submit(), /market-count/);
  await f.submit({
    symbol: "ETHUSDT",
    side: "sell",
    type: "market",
    price: undefined,
  });
  await f.process();
  await f.submit();
  assert.equal((await f.a.snapshot()).riskUsage.markets, 1);
});
test("tightening limits preserves prior fills and rejects executable pending buys in monitor evaluation without creating linked exits", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  await f.submit();
  await f.process();
  await f.submit({
    bracket: { stop: 90, targets: [{ price: 120, quantity: 1 }] },
  });
  const s = await f.risk({ maxTotalCost: 150 });
  assert.equal(s.orders.at(-1).status, "pending");
  await f.a.evaluateSymbol("BTCUSDT", await f.opts.quote("BTCUSDT"));
  const result = await f.a.snapshot();
  assert.equal(result.orders.length, 2);
  assert.equal(result.orders[1].status, "rejected");
  assert.match(result.orders[1].reason, /total limit/);
  assert.equal(result.fills.length, 1);
  assert.equal(result.reservedCash, 0);
  assert.deepEqual(await new PaperAccount(f.opts).snapshot(), result);
});
test("paused buys never block sell exits, including linked stop/OCO processing", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  await f.submit({
    bracket: { stop: 90, targets: [{ price: 120, quantity: 1 }] },
  });
  await f.process();
  await f.risk({ pauseBuys: true, maxTotalCost: 1 });
  await assert.rejects(f.submit(), /paused/);
  f.prices(80, 81);
  await f.a.evaluateSymbol("BTCUSDT", await f.opts.quote("BTCUSDT"));
  const s = await f.a.snapshot();
  assert.equal(s.positions.BTCUSDT.quantity, 0);
  assert.equal(s.orders.find((o) => o.leg === "stop").status, "filled");
  assert.equal(s.orders.find((o) => o.leg === "target").status, "cancelled");
});
test("paused pending limit buys wait until executable, then reject atomically with a durable reason", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  await f.submit({ price: 90 });
  await f.risk({ pauseBuys: true });
  assert.match((await f.process()).message, /not been reached/);
  assert.equal((await f.a.snapshot()).orders[0].status, "pending");
  f.prices(89, 90);
  const s = (await f.process()).account;
  assert.equal(s.orders[0].status, "rejected");
  assert.match(s.orders[0].reason, /paused/);
  assert.equal(s.availableCash, 1000);
});
test("daily budget sums realized losing exits after fees, profits do not reset it, and the UTC boundary resets usage without rewriting history", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  await f.risk({ dailyLossLimit: 11 });
  await f.submit({ quantity: 2, feePercent: 1 });
  await f.process();
  // Pending entry must be rechecked after a later realized loss.
  const pending = (await f.submit()).orders.at(-1).id;
  f.prices(90, 91);
  await f.submit({ side: "sell", type: "market", price: undefined });
  await f.process();
  assert.equal((await f.a.snapshot()).riskUsage.dailyLoss, 11);
  await assert.rejects(f.submit(), /Daily realized/);
  const denied = (await f.process(pending)).account;
  assert.equal(denied.orders.find((o) => o.id === pending).status, "rejected");
  f.prices(120, 121);
  await f.submit({ side: "sell", type: "market", price: undefined });
  await f.process();
  assert.equal(
    (await new PaperAccount(f.opts).snapshot()).riskUsage.dailyLoss,
    11,
  );
  await assert.rejects(f.submit(), /Daily realized/);
  const before = f.doc();
  f.time(Date.UTC(2026, 9, 31));
  assert.equal((await f.a.snapshot()).riskUsage.dailyLoss, 0);
  assert.deepEqual(f.doc(), before);
  await f.submit();
});
test("risk policy updates validate strictly and use revision guards and atomic persistence", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  const before = f.doc();
  for (const patch of [
    { maxOrderCost: 0 },
    { maxMarkets: 1.5 },
    { maxTotalCost: Infinity },
    { pauseBuys: "true" },
    { extra: true },
  ])
    assert.equal(
      paperRiskSchema.safeParse({ ...defaultPaperRisk(), ...patch }).success,
      false,
    );
  f.fail(true);
  await assert.rejects(f.risk({ pauseBuys: true }), /disk full/);
  assert.deepEqual(f.doc(), before);
  f.fail(false);
  await f.risk({ pauseBuys: true });
  await assert.rejects(
    f.a.setRisk({ expectedRevision: 1, policy: defaultPaperRisk() }),
    /changed elsewhere/,
  );
  assert.equal((await f.a.snapshot()).risk.pauseBuys, true);
});
test("legacy accounts retain disabled defaults without rewriting and migrate on a successful policy update", async () => {
  for (const version of [1, 2]) {
    const f = fixture();
    await f.a.create({ initialCash: 1000 });
    const legacy = { ...f.doc(), version };
    f.setDoc(legacy);
    assert.deepEqual((await f.a.snapshot()).risk, defaultPaperRisk());
    assert.deepEqual(f.doc(), legacy);
    await f.risk({ maxMarkets: 3 });
    assert.equal(f.doc().version, 3);
    assert.equal(
      (await new PaperAccount(f.opts).snapshot()).risk.maxMarkets,
      3,
    );
  }
});
test("MCP risk edits require research, full explicit policy and current revision; read account exposes usage", () => {
  const defs = toolDefinitions(),
    d = defs.find((d) => d.name === "paper_set_risk");
  assert.equal(d.capability, "research");
  assert.equal(d.action, "paperSetRisk");
  assert.equal(
    d.schema.safeParse({ expectedRevision: 1, policy: defaultPaperRisk() })
      .success,
    true,
  );
  assert.equal(
    d.schema.safeParse({ expectedRevision: 1, policy: { pauseBuys: true } })
      .success,
    false,
  );
  assert.equal(defs.find((d) => d.name === "paper_account").capability, "read");
});

test("non-mutating process responses and idempotent retries report current UTC usage", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  await f.submit();
  await f.process();
  await f.submit({ side: "sell", type: "market", price: undefined });
  await f.process();
  const s = await f.a.snapshot();
  const args = {
    expectedRevision: s.revision,
    requestId: randomUUID(),
    input: {
      symbol: "BTCUSDT",
      side: "buy",
      type: "limit",
      price: 90,
      quantity: 1,
    },
  };
  assert.equal((await f.a.submit(args)).riskUsage.dailyLoss, 1);
  f.time(Date.UTC(2026, 9, 31));
  const before = f.doc();
  assert.equal((await f.a.submit(args)).riskUsage.dailyLoss, 0);
  assert.equal((await f.process()).account.riskUsage.dailyLoss, 0);
  assert.deepEqual(f.doc(), before);
});
