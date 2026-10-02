import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { BinanceLive, parseBinanceMessage } from "../core/live.js";
import {
  ResearchJobs,
  parameterGrid,
  walkForwardWindows,
  rankCandidates,
  compareRuns,
} from "../core/research.js";
import { runBacktest } from "../core/backtest.js";
const start = Date.UTC(2026, 0, 1),
  bars = Array.from({ length: 80 }, (_, i) => ({
    time: start + i * 60000,
    open: 100 + i,
    high: 105 + i,
    low: 95 + i,
    close: 100 + i,
    volume: 10,
  }));
const source =
  '//@version=6\nstrategy("Input test")\nexitBar = input.int(4, "Exit bar")\nif bar_index == 0\n    strategy.entry("Long", strategy.long, qty=1)\nif bar_index == exitBar\n    strategy.close("Long")';
const candle = (time, closed, close = 103) => ({
  e: "kline",
  s: "BTCUSDT",
  k: {
    t: time,
    i: "1m",
    o: "100",
    h: "110",
    l: "90",
    c: String(close),
    v: "5",
    x: closed,
  },
});
const trade = (id, m = false) => ({
  e: "trade",
  s: "BTCUSDT",
  t: id,
  T: start + id,
  p: "101",
  q: "2",
  m,
});
const waitFor = async (predicate) => {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
test("Binance parsing inverts buyer-maker flag and never invents aggressor sides", () => {
  assert.equal(
    parseBinanceMessage(trade(1, true), { symbol: "BTCUSDT", timeframe: "1m" })
      .trade.side,
    "sell",
  );
  assert.equal(
    parseBinanceMessage(trade(2, false), { symbol: "BTCUSDT", timeframe: "1m" })
      .trade.side,
    "buy",
  );
  assert.throws(
    () =>
      parseBinanceMessage({ ...trade(3), m: undefined }, { symbol: "BTCUSDT" }),
    /Invalid/,
  );
  assert.equal(parseBinanceMessage(trade(2), { symbol: "ETHUSDT" }), null);
});
test("live sync buffers events, excludes forming bars, deduplicates trades, exposes gaps and reconnects", async () => {
  const sockets = [],
    timeouts = [];
  let historyCalls = 0;
  const settled = [];
  const clock = {
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: (fn) => {
      timeouts.push(fn);
      return timeouts.length;
    },
    clearTimeout() {},
  };
  const live = new BinanceLive({
    clock,
    maxTrades: 3,
    fetchHistory: async () => {
      historyCalls++;
      return bars.slice(0, 2);
    },
    createSocket: () => {
      const s = new EventEmitter();
      s.terminate = () => s.emit("close");
      sockets.push(s);
      return s;
    },
    onClosed: (d) => settled.push(structuredClone(d)),
  });
  await live.start({ symbol: "BTCUSDT", timeframe: "1m" });
  const s = sockets[0];
  s.emit("message", JSON.stringify(candle(start + 120000, false)));
  s.emit("open");
  await waitFor(() => live.state.status === "streaming");
  assert.equal(live.snapshot().dataset.bars.length, 2);
  assert.equal(live.snapshot().forming.time, start + 120000);
  s.emit("message", JSON.stringify(candle(start + 120000, true, 104)));
  assert.equal(live.snapshot().dataset.bars.length, 3);
  assert.equal(live.snapshot().forming, null);
  for (const event of [trade(1), trade(1), trade(2, true), trade(4)])
    s.emit("message", JSON.stringify(event));
  assert.equal(live.snapshot().tradeCount, 3);
  assert.equal(live.flow({ timeframe: "1m", tickSize: 1 }).totalTrades, 3);
  assert.equal(live.flow({ timeframe: "1m", tickSize: 1 }).buy, 4);
  assert.equal(live.flow({ timeframe: "1m", tickSize: 1 }).sell, 2);
  assert.equal(live.snapshot().gaps[0].missingTradeIds, 1);
  s.emit("close");
  assert.equal(live.state.status, "reconnecting");
  timeouts.at(-1)();
  sockets[1].emit("open");
  await waitFor(() => live.state.status === "streaming");
  assert.equal(historyCalls, 2);
  assert.equal(live.snapshot().dataset.bars.length, 3);
  sockets[1].emit("message", JSON.stringify(trade(5)));
  assert.ok(live.snapshot().gaps.every((gap) => gap.to !== null));
  live.stop();
  const n = sockets.length;
  timeouts.at(-1)();
  assert.equal(sockets.length, n);
  assert.equal(live.snapshot().active, false);
  assert.ok(settled.length >= 2);
});
test("parameter overrides change native fills and unknown input names are rejected", async () => {
  const early = await runBacktest({
    bars,
    source,
    inputs: { "Exit bar": 2 },
    settings: { initial_capital: 1000, commission_value: 0, slippage: 0 },
    timeframe: "1m",
  });
  const late = await runBacktest({
    bars,
    source,
    inputs: { "Exit bar": 5 },
    settings: { initial_capital: 1000, commission_value: 0, slippage: 0 },
    timeframe: "1m",
  });
  assert.equal(early.trades[0].exit_bar_index, 3);
  assert.equal(late.trades[0].exit_bar_index, 6);
  assert.ok(late.metrics.netProfit > early.metrics.netProfit);
  await assert.rejects(
    runBacktest({ bars, source, inputs: { Missing: 1 }, timeframe: "1m" }),
    /Unknown Pine input/,
  );
});
test("grid bounds and chronological disjoint train/test windows", () => {
  assert.equal(parameterGrid({ A: [1, 1, 2], B: [true, false] }).length, 4);
  assert.throws(
    () =>
      parameterGrid({
        A: Array.from({ length: 6 }, (_, i) => i),
        B: Array.from({ length: 6 }, (_, i) => i),
      }),
    /25 combinations/,
  );
  const windows = walkForwardWindows(80, {
    trainBars: 40,
    testBars: 20,
    folds: 2,
  });
  assert.deepEqual(windows, [
    { trainStart: 0, trainEnd: 40, testStart: 40, testEnd: 60 },
    { trainStart: 20, trainEnd: 60, testStart: 60, testEnd: 80 },
  ]);
  assert.throws(
    () => walkForwardWindows(50, { trainBars: 40, testBars: 20, folds: 2 }),
    /Not enough/,
  );
  assert.equal(
    rankCandidates([
      { index: 0, result: { metrics: { totalTrades: 0, netProfit: 100 } } },
      { index: 1, result: { metrics: { totalTrades: 1, netProfit: 5 } } },
    ])[0].index,
    1,
  );
});
test("walk-forward selects on training data only, resets test execution and persists provenance", async () => {
  const calls = [],
    saved = [];
  const runner = async (args) => {
    calls.push({
      from: args.bars[0].time,
      to: args.bars.at(-1).time,
      inputs: args.inputs,
    });
    const train = args.bars.length === 40;
    const net = train ? args.inputs.Length : -args.inputs.Length;
    return {
      metrics: {
        netProfit: net,
        totalTrades: 1,
        maxDrawdown: 1,
        initialCapital: 1000,
        equity: 1000 + net,
      },
      trades: [{ profit: net }],
      openTrades: [],
      equity: [],
    };
  };
  const jobs = new ResearchJobs({
    runner,
    persist: async (job) => saved.push(structuredClone(job)),
  });
  const job = jobs.start({
    kind: "walkForward",
    source,
    dataset: { bars, symbol: "TEST", timeframe: "1m" },
    grid: { Length: [1, 2] },
    windows: { trainBars: 40, testBars: 20, folds: 2 },
  });
  await waitFor(() => jobs.jobs.get(job.id).status !== "running");
  const done = await jobs.get(job.id);
  assert.equal(done.status, "completed");
  assert.equal(calls.length, 6);
  assert.deepEqual(
    calls.map((c) => c.inputs.Length),
    [1, 2, 2, 1, 2, 2],
  );
  assert.equal(calls[2].from, bars[40].time);
  assert.equal(calls[5].from, bars[60].time);
  assert.equal(done.result.totalClosedNetProfit, -4);
  assert.ok(saved.at(-1).request.source === source);
});
test("research cancellation terminates the active worker path and comparison warns on unlike datasets", async () => {
  const jobs = new ResearchJobs({
    runner: (args) =>
      new Promise((_, reject) =>
        args.signal.addEventListener("abort", () => reject(Error("cancelled"))),
      ),
    persist: async () => {},
  });
  const job = jobs.start({
    kind: "sweep",
    source,
    dataset: { bars, symbol: "TEST", timeframe: "1m" },
    grid: { Length: [1, 2] },
  });
  await new Promise((r) => setImmediate(r));
  await jobs.cancel(job.id);
  await waitFor(() => jobs.jobs.get(job.id).status !== "running");
  assert.equal((await jobs.get(job.id)).status, "cancelled");
  const run = {
    id: "a",
    dataset: { bars, symbol: "TEST", timeframe: "1m" },
    settings: {},
    result: {
      title: "A",
      metrics: { initialCapital: 1000 },
      openTrades: [],
      equity: [{ time: start, value: 1010 }],
    },
  };
  assert.equal(compareRuns([run, { ...run, id: "b" }]).sameData, true);
  const unlike = compareRuns([
    run,
    { ...run, id: "c", dataset: { ...run.dataset, symbol: "OTHER" } },
  ]);
  assert.equal(unlike.sameData, false);
  assert.ok(Math.abs(unlike.runs[0].equity[0].value - 1) < 1e-9);
});
