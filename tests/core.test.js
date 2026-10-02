import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCSV,
  validateBars,
  validateTrades,
  demoBars,
  timestamp,
  fetchBinance,
} from "../core/data.js";
import { runBacktest, simulate } from "../core/backtest.js";
import { orderflow } from "../core/orderflow.js";
const start = Date.UTC(2026, 0, 1);
const bars = [100, 110, 120, 130, 140].map((p, i) => ({
  time: start + i * 3600000,
  open: p,
  close: p,
  high: p + 5,
  low: p - 5,
  volume: 10,
}));
const source = `//@version=6
strategy("Known fills", overlay=true)
if bar_index == 0
    strategy.entry("Long", strategy.long, qty=1)
if bar_index == 2
    strategy.close("Long")`;
test("OHLCV imports normalize time, sort, and reject bad candles/duplicates", () => {
  assert.equal(timestamp("2026-01-01T00:00:00Z"), start);
  assert.equal(timestamp(start / 1000), start);
  assert.equal(
    parseCSV(
      "time,open,high,low,close,volume\n1767225600,100,110,90,105,10\n1767229200,105,115,95,110,20",
    )[0].time,
    start,
  );
  assert.throws(() => validateBars([bars[0], bars[0]]), /Duplicate/);
  assert.throws(
    () => validateBars([{ ...bars[0], high: 90 }, bars[1]]),
    /Invalid OHLCV/,
  );
  assert.throws(
    () =>
      validateTrades([{ time: start, price: 100, size: 1, side: "unknown" }]),
    /Invalid trade/,
  );
});
test("native strategy fills next bar at known prices, deducts both commissions, tracks equity", async () => {
  const r = await runBacktest({
    bars,
    source,
    settings: { initial_capital: 1000, commission_value: 0.1, slippage: 0 },
  });
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.equal(t.entry_bar_index, 1);
  assert.equal(t.exit_bar_index, 3);
  assert.equal(t.entry_price, 110);
  assert.equal(t.exit_price, 130);
  assert.ok(Math.abs(t.commission - 0.24) < 1e-8);
  assert.ok(Math.abs(t.profit - 19.76) < 1e-8);
  assert.ok(Math.abs(r.metrics.netProfit - 19.76) < 1e-8);
  assert.equal(r.equity.length, bars.length);
  assert.equal(r.equity[0].time, start);
  assert.ok(Math.abs(r.equity.at(-1).value - 1019.76) < 1e-8);
});
test("costs lower returns; open positions stay open; source and settings validation", async () => {
  const noCost = await runBacktest({
    bars,
    source,
    settings: { initial_capital: 1000, commission_value: 0, slippage: 0 },
  });
  const costs = await runBacktest({
    bars,
    source,
    settings: { initial_capital: 1000, commission_value: 0.5, slippage: 5 },
  });
  assert.ok(costs.metrics.netProfit < noCost.metrics.netProfit);
  const open = await runBacktest({
    bars,
    source: source.replace('if bar_index == 2\n    strategy.close("Long")', ""),
    settings: { initial_capital: 1000, commission_value: 0.1, slippage: 0 },
  });
  assert.equal(open.openTrades.length, 1);
  assert.equal(open.trades.length, 0);
  assert.equal(open.metrics.netProfit, 0);
  assert.ok(open.metrics.openProfit > 0);
  assert.ok(open.metrics.openEntryCommission > 0);
  await assert.rejects(
    runBacktest({
      bars,
      source: '//@version=6\nindicator("Only")\nplot(close)',
    }),
    /requires a strategy/,
  );
  assert.throws(
    () => runBacktest({ bars, source, settings: { initial_capital: -1 } }),
    /Invalid/,
  );
  assert.throws(
    () => runBacktest({ bars, source, settings: { slippage: 1.5 } }),
    /Invalid/,
  );
});
test("worker execution has a deadline and terminates", async () => {
  await assert.rejects(
    runBacktest({ bars: demoBars(), source, timeoutMs: 1 }),
    /execution limit/,
  );
});
test("trade footprint, delta, CVD and price profile use explicit sides", () => {
  const trades = [
    { time: start, price: 101, size: 2, side: "buy" },
    { time: start + 1, price: 101, size: 1, side: "sell" },
    { time: start + 3600000, price: 109, size: 4, side: "sell" },
  ];
  const r = orderflow(trades, { timeframe: "1h", tickSize: 5 });
  assert.equal(r.totalTrades, 3);
  assert.equal(r.bars[0].delta, 1);
  assert.equal(r.bars[1].cvd, -3);
  assert.equal(r.bars[0].buyCount, 1);
  assert.equal(r.bars[0].sellCount, 1);
  assert.equal(r.profile.find((l) => l.price === 100).buy, 2);
  assert.equal(r.poc, 105);
  assert.throws(() => orderflow(trades, { tickSize: 0 }), /positive/);
});
test("Monte Carlo is seeded, uses net P&L, and rejects empty runs", () => {
  const trades = [{ profit: 20 }, { profit: -10 }, { profit: 15 }];
  assert.deepEqual(
    simulate(trades, { seed: 12 }),
    simulate(trades, { seed: 12 }),
  );
  assert.throws(() => simulate([]), /closed trades/);
  assert.throws(() => simulate(trades, { paths: 0 }), /Invalid/);
});
test("market fetch validates requests before network access", () => {
  return assert.rejects(fetchBinance({ symbol: "BAD/URL" }), /Invalid/);
});
