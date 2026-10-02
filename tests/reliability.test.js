import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import { runBacktest } from "../core/backtest.js";
import { auditStrategy, compareSeries } from "../core/strategy-audit.js";
import { validateCalendar } from "../core/session-calendar.js";
import { stitchFolds } from "../core/research.js";
import { fillQuote } from "../core/execution-model.js";
import {
  selectOptionLegs,
  runOptionStrategy,
} from "../core/options-strategy.js";
import { dataQuality } from "../core/data-quality.js";
import { americanTree } from "../core/american-options.js";
import { calculateGreeks, greekCurve } from "../core/greeks.js";
import {
  validateOptionSnapshot,
  OptionHistory,
} from "../core/option-history.js";
import { fetchBinance } from "../core/data.js";
import { optionFixture } from "./fixtures/option-chain.js";
const at = Date.UTC(2026, 0, 1),
  bars = Array.from({ length: 60 }, (_, i) => ({
    time: at + i * 60000,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100 + i,
    volume: 1,
  }));
test("historical warmup computes plots without permitting entry orders", async () => {
  const source =
    '//@version=6\nstrategy("Warmup")\nstrategy.entry("L", strategy.long, qty=1)\nplot(ta.ema(close, 10), "EMA")';
  const result = await runBacktest({
    bars,
    source,
    warmupBars: 20,
    diagnostics: true,
    timeframe: "1m",
  });
  assert.equal(result.openTrades[0].entry_bar_index, 21);
  assert.equal(result.equity[0].time, bars[20].time);
  assert.equal(result.diagnostics.EMA.length, 51);
  assert.equal(result.warmup.ordersBlocked, true);
});
test("sampled audit preserves honest EMA prefixes and reports startup sensitivity", async () => {
  const source =
    '//@version=6\nstrategy("Audit")\nplot(ta.ema(close, 20), "EMA")';
  const nonlinear = bars.map((b, i) => {
    const shift = Math.sin(i / 3) * 10;
    return {
      ...b,
      open: b.open + shift,
      high: b.high + shift,
      low: b.low + shift,
      close: b.close + shift,
    };
  });
  const result = await auditStrategy({
    bars: nonlinear,
    source,
    timeframe: "1m",
  });
  assert.equal(result.status, "no sampled prefix differences");
  assert.ok(result.recursive.some((r) => r.differences.length));
  assert.equal(
    compareSeries(
      { x: [{ time: 1, value: 2 }] },
      { x: [{ time: 1, value: 3 }] },
    ).length,
    1,
  );
});
test("runtime VM has no host process/require and external requests fail closed", async () => {
  const context = vm.createContext(Object.create(null));
  vm.runInContext(
    fs.readFileSync(
      new URL(
        "../node_modules/pinets/dist/pinets.min.browser.js",
        import.meta.url,
      ),
      "utf8",
    ),
    context,
  );
  assert.equal(vm.runInContext("typeof process", context), "undefined");
  assert.equal(vm.runInContext("typeof require", context), "undefined");
  // The runner installs its explicit denial before loading the bundle.
  vm.runInContext(
    "globalThis.fetch=()=>{throw Error('External requests disabled')}",
    context,
  );
  assert.throws(
    () => vm.runInContext("fetch('https://example.com')", context),
    /disabled/,
  );
});
test("explicit session calendars accept closed sessions and reject missing open bars", () => {
  const b = (time) => ({ time }),
    session = {
      timeZone: "America/New_York",
      startMinute: 570,
      endMinute: 960,
    };
  assert.equal(
    validateCalendar(
      [b(Date.UTC(2026, 0, 2, 20, 59)), b(Date.UTC(2026, 0, 5, 14, 30))],
      "1m",
      session,
    ).kind,
    "explicit-session",
  );
  assert.throws(
    () =>
      validateCalendar(
        [b(Date.UTC(2026, 0, 5, 14, 30)), b(Date.UTC(2026, 0, 5, 14, 32))],
        "1m",
        session,
      ),
    /Missing in-session/,
  );
  assert.throws(
    () => validateCalendar([b(Date.UTC(2026, 0, 3, 14, 30))], "1m", session),
    /outside/,
  );
});
test("stitched equity compounds independent normalized folds without changing source runs", () => {
  const fold = (index, capital, value) => ({
    index,
    testResult: {
      metrics: { initialCapital: capital, equity: value },
      equity: [{ time: index + 1, value }],
    },
  });
  const s = stitchFolds([fold(0, 100, 110), fold(1, 200, 180)]);
  assert.ok(Math.abs(s.finalEquity - 99) < 1e-9);
  assert.equal(s.curve.length, 2);
});
test("fill models respect side, quoted size, partial remainder and configurable fee cap", () => {
  const q = {
    instrument: "C",
    bid: 1,
    ask: 2,
    bidSize: 0.5,
    askSize: 0.25,
    payoffType: "inverse",
  };
  assert.throws(
    () => fillQuote(q, 1, { sizePolicy: "reject" }),
    /Insufficient/,
  );
  const partial = fillQuote(q, 1, {
    sizePolicy: "partial",
    liquidityFraction: 0.5,
    feeBps: 0,
  });
  assert.equal(partial.quantity, 0.125);
  assert.equal(partial.remainingQuantity, 0.875);
  assert.equal(partial.cashChange, -0.25);
  assert.throws(
    () => fillQuote({ ...q, askSize: null }, 1, { sizePolicy: "partial" }),
    /Missing/,
  );
  const capped = fillQuote(q, 1, {
    feeModel: "underlying-capped",
    underlyingRate: 0.1,
    premiumCap: 0.01,
  });
  assert.equal(capped.fee, 0.02);
});
function records({ n = 6, days = 1, sizes = 10 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const snapshot = optionFixture({
      at: at + i * days * 86400000,
      expiry: at + 30 * 86400000,
      spot: 100 + i,
    });
    for (const q of snapshot.rows) {
      q.bidSize = sizes;
      q.askSize = sizes;
    }
    return {
      id: String(i),
      sha256: "fixture",
      origin: "Synthetic fixture",
      snapshot,
    };
  });
}
test("rule selection uses DTE/delta, delayed entries, real quote sides and frozen evidence", () => {
  const rs = records(),
    rules = {
      targetDTE: 30,
      minDTE: 7,
      maxDTE: 60,
      maxHoldDays: 2,
      profitTarget: 10,
      stopLoss: 10,
      feeBps: 0,
    };
  const legs = selectOptionLegs(rs[0].snapshot, rules);
  assert.equal(legs.length, 1);
  assert.equal(legs[0].type, "call");
  const result = runOptionStrategy(rs, { rules, initialCapital: 1 });
  assert.equal(result.fills[0].at, rs[1].snapshot.fetchedAt);
  assert.equal(
    result.fills[0].price,
    rs[1].snapshot.rows.find((q) => q.instrument === legs[0].instrument).ask,
  );
  assert.ok(result.trades.length >= 1);
  assert.ok(result.usedQuotes.some((e) => e.rows.length));
  const cash =
    1 +
    result.fills
      .filter((f) => f.cashChange !== undefined)
      .reduce((n, f) => n + f.cashChange, 0);
  const last = rs.at(-1).snapshot;
  const liquidation = result.openPositions.reduce((n, q) => {
    const row = last.rows.find((r) => r.instrument === q.instrument);
    return n + q.quantity * (q.quantity > 0 ? row.bid : row.ask);
  }, 0);
  assert.ok(
    Math.abs(result.curve.at(-1).equitySettlement - (cash + liquidation)) <
      1e-10,
  );
});
test("partial exits retain exposure and never consume the same size twice in an observation", () => {
  const rs = records({ sizes: 0.25 });
  for (const q of rs[1].snapshot.rows) q.askSize = 1;
  const result = runOptionStrategy(rs, {
    initialCapital: 2,
    rules: {
      targetDTE: 30,
      maxHoldDays: 1,
      profitTarget: 10,
      stopLoss: 10,
      feeBps: 0,
      sizePolicy: "partial",
    },
  });
  const exits = result.fills.filter((f) => f.action === "exit");
  assert.ok(exits.length >= 2);
  assert.ok(exits.every((f) => Math.abs(f.quantity) <= 0.25));
  assert.equal(new Set(exits.map((f) => f.at)).size, exits.length);
});
test("calendar legs require two expiries and use equal strike, opposite sides", () => {
  const first = optionFixture({ at, expiry: at + 30 * 86400000 }),
    later = optionFixture({ at, expiry: at + 60 * 86400000 });
  first.rows.push(...later.rows);
  const legs = selectOptionLegs(first, {
    template: "call-calendar",
    targetDTE: 30,
    maxDTE: 90,
  });
  assert.equal(legs.length, 2);
  assert.equal(legs[0].strike, legs[1].strike);
  assert.ok(legs[0].quantity < 0 && legs[1].quantity > 0);
  assert.ok(legs[1].expiry > legs[0].expiry);
});
test("quality report distinguishes missing depth, crossed quotes and archived age", () => {
  const snapshot = optionFixture({ at });
  snapshot.rows[0].ask = null;
  snapshot.rows[1].bid = snapshot.rows[1].ask * 2;
  const q = dataQuality(snapshot, at + 60000);
  assert.equal(q.ageMs, 60000);
  assert.equal(q.missing.ask, 1);
  assert.equal(q.crossed, 1);
  assert.equal(q.missing.bidSize, snapshot.rows.length);
});
test("American pricing includes early exercise value and preserves style in plotted curves", () => {
  const p = {
    spot: 100,
    strike: 100,
    days: 365,
    volatility: 20,
    rate: 5,
    type: "put",
    exerciseStyle: "american",
    steps: 500,
  };
  const tree = americanTree(p);
  assert.ok(Math.abs(tree.price - 6.0896) < 0.002);
  assert.ok(
    tree.price > calculateGreeks({ ...p, exerciseStyle: "european" }).price,
  );
  assert.ok(tree.delta < 0 && tree.gamma > 0);
  const model = calculateGreeks(p);
  assert.equal(model.vanna, null);
  assert.ok(model.vega > 0);
  assert.equal(model.model.exerciseStyle, "american");
  const curve = greekCurve(
    { ...p, steps: 100 },
    { metric: "price", axis: "spot", points: 3 },
  );
  assert.ok(curve[0].y >= 50);
  const cashDividends = [{ days: 180, amount: 10 }];
  assert.ok(americanTree({ ...p, type: "call", cashDividends }).price >= 0);
  assert.throws(
    () => americanTree({ ...p, cashDividends: [{ days: 100, amount: 200 }] }),
    /exceed/,
  );
});
test("imported USD American exercises deliver shares and supplied dividends reconcile cash", () => {
  const rs = records({ n: 4 });
  for (let i = 0; i < rs.length; i++) {
    const s = rs[i].snapshot;
    s.exchange = "import";
    s.currency = "SPY";
    s.settlement = "USD";
    s.spot = 100 + i * 5;
    for (const q of s.rows) {
      q.exchange = "import";
      q.currency = "SPY";
      q.settlement = "USD";
      q.premiumCurrency = "USD";
      q.payoffType = "linear";
      q.exerciseStyle = "american";
      q.settlementType = "physical";
      q.contractSize = 100;
      q.bid *= 100;
      q.ask *= 100;
      q.bidSize = 1000;
      q.askSize = 1000;
    }
    rs[i].snapshot = validateOptionSnapshot(s);
  }
  const rules = {
      template: "long-call",
      targetDTE: 30,
      targetDelta: 0.5,
      quantity: 100,
      entryEvery: 1000,
      maxHoldDays: 20,
      profitTarget: 10,
      stopLoss: 10,
      feeBps: 0,
      hedgeFeeBps: 0,
    },
    contract = selectOptionLegs(rs[0].snapshot, rules)[0].instrument;
  const result = runOptionStrategy(rs, {
    initialCapital: 20000,
    rules,
    exerciseEvents: [
      {
        time: rs[2].snapshot.fetchedAt,
        instrument: contract,
        quantity: 100,
        kind: "exercise",
        source: "Synthetic supplied event",
      },
    ],
    dividends: [{ time: rs[3].snapshot.fetchedAt, amount: 0.5 }],
  });
  const entry = result.fills.find((f) => f.action === "entry"),
    delivery = result.fills.find((f) => f.action === "physical-delivery");
  assert.equal(delivery.shares, 100);
  assert.equal(result.curve[2].underlyingShares, 100);
  assert.equal(result.metrics.dividendsSettlement, 50);
  const strike = rs[0].snapshot.rows.find(
    (q) => q.instrument === contract,
  ).strike;
  assert.ok(
    Math.abs(
      result.metrics.netPnLSettlement -
        (-entry.price * 100 + 100 * (rs[3].snapshot.spot - strike) + 50),
    ) < 1e-8,
  );
  assert.throws(
    () =>
      runOptionStrategy(rs, {
        initialCapital: 20000,
        rules,
        exerciseEvents: [
          {
            time: rs[2].snapshot.fetchedAt,
            instrument: contract,
            quantity: 101,
            kind: "exercise",
            source: "test",
          },
        ],
      }),
    /inconsistent/,
  );
});
test("historical Binance pagination deduplicates boundaries, respects range and excludes forming candles", async () => {
  let calls = 0;
  const rows = Array.from({ length: 1100 }, (_, i) => [
    at + i * 60000,
    "100",
    "101",
    "99",
    "100",
    "1",
    at + i * 60000 + 59999,
  ]);
  const fetcher = async (url) => {
    calls++;
    const end = Number(url.searchParams.get("endTime")),
      count = Number(url.searchParams.get("limit"));
    return {
      ok: true,
      json: async () => rows.filter((r) => r[0] <= end).slice(-count),
    };
  };
  const result = await fetchBinance({
    limit: 1100,
    to: rows.at(-1)[0],
    fetcher,
  });
  assert.equal(result.length, 1100);
  assert.equal(calls, 2);
  assert.equal(result[0].time, at);
});

test("hedged closed trades include closing hedge fees in account reconciliation", () => {
  const rs = records({ n: 4 });
  const result = runOptionStrategy(rs, {
    initialCapital: 2,
    rules: {
      targetDTE: 30,
      entryEvery: 1000,
      maxHoldDays: 1,
      profitTarget: 10,
      stopLoss: 10,
      hedgeDelta: true,
      hedgeFeeBps: 50,
      feeBps: 0,
    },
  });
  assert.equal(result.trades.length, 1);
  assert.ok(
    result.fills.some(
      (f) => f.action === "synthetic-hedge" && f.quantity === 0,
    ),
  );
  assert.ok(
    Math.abs(result.trades[0].pnl - result.metrics.netPnLSettlement) < 1e-10,
  );
});

test("option allocations normalize capital and compare basis values independent of object layout", async () => {
  const { compareOptionRuns } = await import("../core/option-comparison.js");
  const a = {
    id: "a",
    result: {
      basis: {
        exchange: "deribit",
        currency: "BTC",
        settlement: "BTC",
        payoffType: "inverse",
      },
      config: { initialCapital: 2 },
      curve: [
        { time: 1, spot: 100, equitySettlement: 2 },
        { time: 2, spot: 101, equitySettlement: 2.2 },
      ],
    },
  };
  const b = {
    id: "b",
    result: {
      basis: { settlement: "BTC", currency: "BTC", exchange: "deribit" },
      config: { initialCapital: 4 },
      curve: [
        { time: 1, spot: 100, equitySettlement: 4 },
        { time: 2, spot: 101, equitySettlement: 3.6 },
      ],
    },
  };
  const result = compareOptionRuns([a, b], {
    weights: [0.75, 0.25],
    initialCapital: 10,
  });
  assert.ok(Math.abs(result.metrics.netPnLSettlement - 0.5) < 1e-10);
  assert.throws(
    () =>
      compareOptionRuns([
        a,
        {
          ...b,
          result: {
            ...b.result,
            basis: { ...b.result.basis, currency: "ETH" },
          },
        },
      ]),
    /basis/,
  );
  assert.throws(
    () => compareOptionRuns([a, b], { weights: [0.5, 0.4] }),
    /sum/,
  );
});

test("compressed archives retain hashes and can still read legacy uncompressed records", async () => {
  const { spawnSync } = await import("node:child_process");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pine-gzip-test-"));
  try {
    const script = `import * as store from './core/store.js';import {OptionHistory} from './core/option-history.js';import {optionFixture} from './tests/fixtures/option-chain.js';import fs from 'node:fs/promises';import path from 'node:path';const h=new OptionHistory();const [record]=await h.save(optionFixture());const compressed=await h.get(record.id);const file=path.join(store.dataDir,'option-history',record.id+'.json.gz');const size=(await fs.stat(file)).size;if(size!==record.storedBytes)throw Error('storage accounting');await store.write('option-history',compressed,record.id);await fs.unlink(file);const legacy=await h.get(record.id);if(legacy.sha256!==record.sha256)throw Error('legacy hash');if((await h.coverage()).count!==1)throw Error('coverage');console.log('ok');`;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, PINE_DESK_DATA_DIR: dir },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ok/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
