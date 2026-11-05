import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performanceFixture } from "./helpers/paper-performance.js";
import { paperDraftChart } from "../core/paper-order-chart.js";
import { toolDefinitions } from "../core/mcp-tools.js";
const buy = {
  symbol: "BTCUSDT",
  side: "buy",
  type: "limit",
  quantity: 1,
  price: 100,
  feePercent: 1,
  slippage: 0,
  bracket: { stop: 90, targets: [{ price: 120, quantity: 1 }] },
};
test("preview uses submit reservations and bracket validation without writing or requesting execution quotes", async () => {
  const f = performanceFixture();
  await f.a.create({ initialCash: 1000 });
  let checked = 0;
  f.a.validateMarket = async (s) => {
    assert.equal(s, "BTCUSDT");
    checked++;
  };
  f.a.quote = async () => {
    throw Error("Preview must not request quotes");
  };
  const before = f.raw(),
    p = await f.a.preview({ expectedRevision: 1, input: buy });
  assert.equal(checked, 1);
  assert.equal(p.availableCashBefore, 1000);
  assert.equal(p.availableCashAfter, 899);
  assert.equal(p.reservedCashAdded, 101);
  assert.equal(p.reservedQuantityAdded, 0);
  assert.deepEqual(f.raw(), before);
  const a = await f.a.submit({
    expectedRevision: 1,
    requestId: randomUUID(),
    input: p.input,
  });
  assert.equal(a.availableCash, p.availableCashAfter);
  assert.equal(a.reservedCash, p.reservedCashAdded);
  assert.equal(a.orders.length, 1);
  await assert.rejects(
    f.a.preview({
      expectedRevision: a.revision,
      input: {
        ...buy,
        bracket: { stop: 101, targets: [{ price: 120, quantity: 1 }] },
      },
    }),
    /below/,
  );
});
test("previews recheck shared cash, sell reservations, risk and stale revisions; success cannot bypass changed account state", async () => {
  const f = performanceFixture();
  await f.a.create({ initialCash: 1000 });
  await f.fill({ quantity: 2 });
  let s = await f.a.snapshot();
  const sell = {
    symbol: "BTCUSDT",
    side: "sell",
    type: "stop",
    price: 90,
    quantity: 1,
    feePercent: 0,
  };
  const p = await f.a.preview({ expectedRevision: s.revision, input: sell });
  assert.equal(p.reservedQuantityAdded, 1);
  assert.equal(p.reservedCashAdded, 0);
  s = await f.a.submit({
    expectedRevision: s.revision,
    requestId: randomUUID(),
    input: { ...sell, quantity: 2 },
  });
  await assert.rejects(
    f.a.submit({
      expectedRevision: p.accountRevision,
      requestId: randomUUID(),
      input: p.input,
    }),
    /changed elsewhere/,
  );
  await assert.rejects(
    f.a.preview({ expectedRevision: s.revision, input: sell }),
    /quantity|holdings/i,
  );
  await assert.rejects(
    f.a.preview({
      expectedRevision: s.revision,
      input: { ...buy, quantity: 10, bracket: undefined },
    }),
    /cash/,
  );
  s = await f.a.setRisk({
    expectedRevision: s.revision,
    policy: { ...s.risk, pauseBuys: true },
  });
  await assert.rejects(
    f.a.preview({ expectedRevision: s.revision, input: buy }),
    /paused/,
  );
  await assert.rejects(
    f.a.preview({ expectedRevision: s.revision, input: buy, quote: 100 }),
    /Unrecognized/,
  );
  assert.equal((await f.a.snapshot()).revision, s.revision);
});
test("preview respects unavailable markets and order capacity without allocating a real request ID", async () => {
  const f = performanceFixture();
  await f.a.create({ initialCash: 10000 });
  f.a.validateMarket = async () => {
    throw Error("Market inactive");
  };
  await assert.rejects(
    f.a.preview({ expectedRevision: 1, input: buy }),
    /Market inactive/,
  );
  f.a.validateMarket = async () => {};
  for (let i = 0; i < 50; i++) {
    const s = await f.a.snapshot();
    await f.a.submit({
      expectedRevision: s.revision,
      requestId: randomUUID(),
      input: { ...buy, bracket: undefined },
    });
  }
  const before = f.raw();
  await assert.rejects(
    f.a.preview({ expectedRevision: 51, input: buy }),
    /limit|capacity|pending/i,
  );
  assert.deepEqual(f.raw(), before);
});
test("draft chart validates its own market/interval and does not mutate or process the account", async () => {
  const f = performanceFixture();
  await f.a.create({ initialCash: 1000 });
  const before = f.raw();
  let validated;
  f.a.validateMarket = async (s) => (validated = s);
  const bars = [
    { time: 1, open: 100, high: 101, low: 99, close: 100, volume: 10 },
  ];
  const d = await paperDraftChart(
    f.a,
    { symbol: "ETHUSDT", timeframe: "5m" },
    async (args) => {
      assert.deepEqual(args, {
        symbol: "ETHUSDT",
        timeframe: "5m",
        limit: 300,
      });
      return bars;
    },
  );
  assert.equal(validated, "ETHUSDT");
  assert.equal(d.symbol, "ETHUSDT");
  assert.deepEqual(d.bars, bars);
  assert.deepEqual(f.raw(), before);
  await assert.rejects(
    paperDraftChart(f.a, { symbol: "ETHUSDT", timeframe: "2m" }),
  );
  await assert.rejects(
    paperDraftChart(f.a, { symbol: "ETHUSDT", quantity: 2 }),
  );
});
test("MCP preview and draft candles are read-only; submitting still requires research", () => {
  const d = toolDefinitions();
  for (const name of ["paper_preview", "paper_draft_chart"])
    assert.equal(d.find((t) => t.name === name).capability, "read");
  assert.equal(d.find((t) => t.name === "paper_submit").capability, "research");
  assert.equal(
    d
      .find((t) => t.name === "paper_preview")
      .schema.safeParse({ input: buy, expectedRevision: 1 }).success,
    true,
  );
});

test("preview keeps small proposed reservations visible beside large balances", async () => {
  const f = performanceFixture();
  await f.a.create({ initialCash: 1e12 });
  const p = await f.a.preview({
    expectedRevision: 1,
    input: {
      symbol: "BTCUSDT",
      side: "buy",
      type: "limit",
      price: 1,
      quantity: 0.000001,
      feePercent: 0,
    },
  });
  assert.equal(p.reservedCashAdded, 0.000001);
  assert.equal((await f.a.snapshot()).revision, 1);
});
