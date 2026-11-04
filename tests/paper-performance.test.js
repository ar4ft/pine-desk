import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PaperAccount } from "../core/paper-account.js";
import { paperPerformance } from "../core/paper-performance.js";
import { toolDefinitions } from "../core/mcp-tools.js";
import {
  performanceFixture,
  seedPerformance,
} from "./helpers/paper-performance.js";
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
test("scale-ins and partial exits group flat to flat across plans, with cost and realized P&L reconciliation", async () => {
  const f = performanceFixture(),
    account = await seedPerformance(f),
    before = f.raw(),
    writes = f.writes();
  const p = paperPerformance(account);
  assert.equal(p.closedTrades.length, 3);
  assert.equal(p.openTrades.length, 1);
  const t = p.closedTrades[0];
  assert.equal(t.fills.length, 5);
  assert.equal(t.fills[0].plan.revision, 2);
  assert.equal(t.fills[1].plan.name, "Plan B");
  assert.equal(t.id, t.fills[0].orderId);
  assert.equal(t.quantity, 0);
  assert.equal(t.buyQuantity, 4);
  assert.equal(t.sellQuantity, 4);
  near(t.buyCost, 414.1);
  near(t.netProceeds, 495);
  near(t.fees, 9.1);
  near(t.grossPnl, 90);
  near(t.realizedPnl, 80.9);
  near(t.returnOnBuyCostPercent, (80.9 / 414.1) * 100);
  assert.equal(t.holdingMs, 4000);
  assert.equal(p.openTrades[0].quantity, 1);
  near(p.openSummary.remainingCost, 50.5);
  near(p.openSummary.realizedPnl, 8.9);
  assert.equal(p.openTrades[0].outcome, null);
  assert.equal(p.openTrades[0].returnOnBuyCostPercent, null);
  near(p.reconciliation.closedRealizedPnl, 60.9);
  near(p.reconciliation.openRealizedPnl, 8.9);
  near(p.reconciliation.accountRealizedPnl, 69.8);
  near(p.reconciliation.delta, 0);
  assert.equal(f.writes(), writes);
  assert.deepEqual(f.raw(), before);
  assert.deepEqual(
    paperPerformance(await new PaperAccount(f.opts).snapshot()),
    p,
  );
});
test("completed statistics count cycles, retain fees, exclude open exits and distinguish breakeven", async () => {
  const f = performanceFixture(),
    p = paperPerformance(await seedPerformance(f)),
    s = p.summary;
  assert.equal(s.closedCount, 3);
  assert.equal(s.wins, 1);
  assert.equal(s.losses, 1);
  assert.equal(s.breakeven, 1);
  near(s.netPnl, 60.9);
  near(s.fees, 9.1);
  near(s.winRatePercent, 100 / 3);
  near(s.profitFactor, 4.045);
  near(s.expectancy, 20.3);
  near(s.averageWin, 80.9);
  near(s.averageLoss, -20);
  near(s.maxClosedPnlDrawdown, 20);
  assert.equal(s.maxWinningStreak, 1);
  assert.equal(s.maxLosingStreak, 1);
  near(s.curve.at(-1).cumulativePnl, 60.9);
  near(s.averageHoldingMs, 2000);
  assert.equal(JSON.stringify(p).includes("Infinity"), false);
});
test("filters operate on complete close-time cycles with inclusive from/exclusive to; open cycles ignore date bounds", async () => {
  const f = performanceFixture(),
    a = await seedPerformance(f),
    all = paperPerformance(a),
    first = all.closedTrades[0];
  const p = paperPerformance(a, {
    from: first.closedAt,
    to: all.closedTrades[1].closedAt,
  });
  assert.equal(p.closedTrades.length, 1);
  assert.equal(p.closedTrades[0].fills.length, 5);
  assert.equal(p.openTrades.length, 1);
  near(p.reconciliation.accountRealizedPnl, a.realizedPnl);
  assert.equal(
    paperPerformance(a, { from: first.closedAt + 1 }).closedTrades.length,
    2,
  );
  const sol = paperPerformance(a, {
    symbol: "SOLUSDT",
    from: Date.UTC(2027, 0, 1),
  });
  assert.equal(sol.closedTrades.length, 0);
  assert.equal(sol.openTrades.length, 1);
  const eth = paperPerformance(a, { symbol: "ETHUSDT" });
  assert.equal(eth.summary.breakeven, 1);
  assert.equal(eth.openSummary.count, 0);
  for (const args of [
    { symbol: "BTC" },
    { from: 1, to: 1 },
    { from: 2, to: 1 },
    { to: Infinity },
    { from: "today" },
    { period: 1 },
  ])
    assert.throws(() => paperPerformance(a, args));
});
test("same-timestamp reopens respect ledger order and quantities close exactly without a dust threshold", async () => {
  const f = performanceFixture();
  await f.a.create({ initialCash: 10000 });
  const atTime = Date.UTC(2026, 10, 2);
  await f.fill({ quantity: 0.1, atTime });
  await f.fill({ quantity: 0.2, atTime });
  await f.fill({ side: "sell", quantity: 0.2999999, atTime });
  let p = paperPerformance(await f.a.snapshot());
  assert.equal(p.closedTrades.length, 0);
  assert.ok(p.openTrades[0].quantity > 0);
  await f.fill({ side: "sell", quantity: p.openTrades[0].quantity, atTime });
  await f.fill({ quantity: 1, atTime });
  await f.fill({ side: "sell", atTime, atPrice: 101 });
  p = paperPerformance(await f.a.snapshot());
  assert.equal(p.closedTrades.length, 2);
  assert.equal(p.closedTrades[0].holdingMs, 0);
  assert.equal(p.closedTrades[0].fills.length, 4);
  assert.equal(p.closedTrades[1].fills.length, 2);
  assert.ok(p.closedTrades[0].closeIndex < p.closedTrades[1].closeIndex);
});
test("empty accounts and no-loss/no-win cases use explicit null ratios and a finite realized curve", async () => {
  const empty = paperPerformance(null);
  assert.equal(empty.accountId, null);
  assert.equal(empty.summary.winRatePercent, null);
  assert.equal(empty.summary.profitFactor, null);
  assert.equal(empty.summary.expectancy, null);
  const f = performanceFixture();
  await f.a.create({ initialCash: 1000 });
  await f.fill();
  await f.fill({ side: "sell", atPrice: 110 });
  let s = paperPerformance(await f.a.snapshot()).summary;
  assert.equal(s.profitFactor, null);
  assert.equal(s.winRatePercent, 100);
  assert.equal(s.averageLoss, null);
  const p = paperPerformance(await f.a.snapshot(), {
    from: Date.UTC(2027, 0, 1),
  });
  assert.equal(p.summary.closedCount, 0);
  assert.equal(p.summary.bestTrade, null);
  const g = performanceFixture();
  await g.a.create({ initialCash: 1000 });
  await g.fill();
  await g.fill({ side: "sell", atPrice: 90 });
  s = paperPerformance(await g.a.snapshot()).summary;
  assert.equal(s.profitFactor, 0);
  assert.equal(s.averageWin, null);
  assert.equal(s.maxClosedPnlDrawdown, 10);
});
test("linked exits share the position cycle; cancelled or price-edited pending orders create no phantom trades", async () => {
  const f = performanceFixture();
  await f.a.create({ initialCash: 1000 });
  let s = await f.a.submit({
    expectedRevision: 1,
    requestId: randomUUID(),
    input: {
      symbol: "BTCUSDT",
      side: "buy",
      type: "limit",
      price: 100,
      quantity: 1,
      feePercent: 0,
      bracket: {
        stop: 90,
        targets: [
          { price: 110, quantity: 0.5 },
          { price: 120, quantity: 0.5 },
        ],
      },
    },
  });
  s = (await f.a.process({ id: s.orders[0].id, expectedRevision: s.revision }))
    .account;
  for (const price of [110, 120]) {
    await f.a.evaluateSymbol("BTCUSDT", {
      symbol: "BTCUSDT",
      bid: price,
      ask: price,
      requestedAt: f.opts.now(),
      receivedAt: f.opts.now(),
      source: "Binance public bookTicker REST",
    });
  }
  s = await f.a.snapshot();
  const p = paperPerformance(s);
  assert.equal(p.closedTrades.length, 1);
  assert.equal(p.closedTrades[0].fills.length, 3);
  assert.equal(p.closedTrades[0].fills[1].leg, "target");
  near(p.summary.netPnl, 15);
  s = await f.a.submit({
    expectedRevision: s.revision,
    requestId: randomUUID(),
    input: {
      symbol: "BTCUSDT",
      side: "buy",
      type: "limit",
      price: 90,
      quantity: 1,
    },
  });
  const id = s.orders.at(-1).id;
  s = await f.a.amend({ expectedRevision: s.revision, id, price: 95 });
  s = await f.a.cancel({ expectedRevision: s.revision, id });
  assert.deepEqual(paperPerformance(s).summary, p.summary);
});
test("invalid references or inconsistent realized/holding balances fail explicitly, without partial analytics", async () => {
  const f = performanceFixture(),
    a = await seedPerformance(f);
  for (const mutate of [
    (a) => a.orders.splice(0, 1),
    (a) => (a.realizedPnl += 1),
    (a) => (a.positions.SOLUSDT.quantity += 1),
    (a) => (a.positions.SOLUSDT.cost += 1),
    (a) => (a.fills[2].realizedPnl += 1),
  ]) {
    const changed = structuredClone(a);
    mutate(changed);
    assert.throws(() => paperPerformance(changed), /Paper performance/);
  }
});
test("performance is available to read-only MCP clients and rejects unknown parameters", () => {
  const d = toolDefinitions().find((d) => d.name === "paper_performance");
  assert.equal(d.capability, "read");
  assert.equal(d.readOnly, true);
  assert.equal(d.action, "paperPerformance");
  assert.equal(
    d.schema.safeParse({ symbol: "BTCUSDT", from: 0, to: 1000 }).success,
    true,
  );
  assert.equal(d.schema.safeParse({ price: 100 }).success, false);
});
