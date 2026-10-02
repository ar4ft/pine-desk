import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { calculateGreeks, greekCurve } from "../core/greeks.js";
import {
  DeribitOptions,
  normalizeChain,
  normalizeTrade,
  termStructure,
  finite,
} from "../core/deribit.js";
const near = (a, b, tolerance = 1e-5) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const model = {
  spot: 100,
  strike: 100,
  days: 365,
  volatility: 20,
  rate: 5,
  dividend: 0,
  type: "call",
};
test("BSM reference prices, put-call parity, Greek signs and bounded input", () => {
  const c = calculateGreeks(model),
    p = calculateGreeks({ ...model, type: "put" });
  near(c.price, 10.4505836, 2e-5);
  near(p.price, 5.573526, 2e-5);
  near(c.price - p.price, 100 - 100 * Math.exp(-0.05), 1e-10);
  near(c.delta - p.delta, 1);
  near(c.gamma, p.gamma);
  near(c.vega, p.vega);
  assert.ok(c.theta < 0 && p.theta < 0 && c.rho > 0 && p.rho < 0);
  for (const type of ["call", "put"]) {
    const q = calculateGreeks({ ...model, type, dividend: 2 });
    assert.ok(
      Object.values(q)
        .filter((v) => typeof v === "number")
        .every(Number.isFinite),
    );
  }
  for (const key of ["spot", "strike", "days", "volatility"])
    assert.throws(() => calculateGreeks({ ...model, [key]: 0 }));
  assert.throws(() => greekCurve(model, { points: 1000 }));
  assert.equal(
    greekCurve(model, { metric: "color", axis: "days" }).length,
    101,
  );
});
test("all first and higher sensitivities agree with independent finite differences in displayed units", () => {
  for (const type of ["call", "put"]) {
    const p = { ...model, spot: 110, dividend: 2, type },
      g = calculateGreeks(p);
    const derivative = (metric, key, step) => {
      const plus = calculateGreeks({ ...p, [key]: p[key] + step })[metric],
        minus = calculateGreeks({ ...p, [key]: p[key] - step })[metric];
      return (plus - minus) / (2 * step);
    };
    for (const [metric, source, key, sign] of [
      ["delta", "price", "spot", 1],
      ["gamma", "delta", "spot", 1],
      ["vega", "price", "volatility", 1],
      ["theta", "price", "days", -1],
      ["rho", "price", "rate", 1],
      ["vanna", "delta", "volatility", 1],
      ["vomma", "vega", "volatility", 1],
      ["charm", "delta", "days", -1],
      ["speed", "gamma", "spot", 1],
      ["color", "gamma", "days", -1],
      ["zomma", "gamma", "volatility", 1],
      ["ultima", "vomma", "volatility", 1],
    ])
      near(g[metric], sign * derivative(source, key, 0.005), 1e-5);
  }
});
const now = Date.UTC(2026, 0, 1),
  day = 86400000;
const instruments = [
  {
    instrument_name: "BTC-2JAN26-100-C",
    kind: "option",
    is_active: true,
    instrument_type: "reversed",
    base_currency: "BTC",
    settlement_currency: "BTC",
    expiration_timestamp: now + day,
    contract_size: 1,
    strike: 100,
    option_type: "call",
  },
  {
    instrument_name: "BTC-3JAN26-100-P",
    kind: "option",
    is_active: true,
    instrument_type: "reversed",
    base_currency: "BTC",
    settlement_currency: "BTC",
    expiration_timestamp: now + 2 * day,
    contract_size: 1,
    strike: 100,
    option_type: "put",
  },
];
const summaries = instruments.map((i, n) => ({
  instrument_name: i.instrument_name,
  bid_price: null,
  ask_price: "",
  mark_price: 0.03,
  mark_iv: n ? 10 : 50,
  open_interest: n ? 0 : null,
  creation_timestamp: now,
}));
const trade = {
  trade_id: "1",
  instrument_name: instruments[0].instrument_name,
  timestamp: now,
  amount: 2,
  price: 0.01,
  index_price: 100,
  direction: "buy",
  iv: 20,
};
const request = async (method) =>
  ({
    get_instruments: instruments,
    get_book_summary_by_currency: summaries,
    get_index_price: { index_price: 100 },
    get_last_trades_by_currency: { trades: [trade], has_more: true },
    ticker: {
      instrument_name: instruments[0].instrument_name,
      timestamp: now,
      mark_price: 0.03,
      greeks: { delta: 0.5, gamma: null },
    },
  })[method];
test("inverse units, missing values and non-positive forward variance are preserved", () => {
  const rows = normalizeChain("BTC", instruments, summaries, now);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].oi, null);
  assert.equal(rows[1].oi, 0);
  assert.equal(rows[0].ask, null);
  assert.equal(finite(null), null);
  assert.equal(finite("abc"), null);
  const t = normalizeTrade(trade, "BTC");
  near(t.premiumUSD, 2);
  assert.equal(t.amount, 2);
  assert.equal(
    normalizeTrade({ ...trade, index_price: null }, "BTC").premiumUSD,
    null,
  );
  assert.equal(normalizeTrade({ ...trade, amount: null }, "BTC"), null);
  const term = termStructure(rows, 100, now);
  assert.equal(term.length, 2);
  assert.equal(term[1].forwardIV, null);
  assert.match(term[1].forwardReason, /Non-positive/);
  assert.equal(termStructure(rows, 200, now).length, 0);
  assert.throws(() => normalizeChain("DOGE", [], []));
  assert.equal(
    normalizeChain(
      "BTC",
      [{ ...instruments[0], instrument_type: "linear" }],
      summaries,
      now,
    ).length,
    0,
  );
});
test("Deribit subscription acknowledgement, heartbeat, monotonic ticker, dedupe, retention, reconnect and stop", async () => {
  const sockets = [],
    timeouts = [];
  const clock = {
    setTimeout: (fn) => {
      timeouts.push(fn);
      return timeouts.length;
    },
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
  };
  const d = new DeribitOptions({
    request,
    now: () => now,
    clock,
    createSocket: () => {
      const s = new EventEmitter();
      s.sent = [];
      s.send = (v) => s.sent.push(JSON.parse(v));
      s.terminate = () => s.emit("close");
      sockets.push(s);
      return s;
    },
  });
  await d.refresh();
  await assert.rejects(d.select({ instrument: "OTHER" }));
  await d.select({ instrument: instruments[0].instrument_name });
  assert.equal(d.snapshot().ticker.greeks.gamma, null);
  d.start();
  const s = sockets[0];
  s.emit("open");
  assert.equal(d.snapshot().status, "connecting");
  const channels = s.sent[0].params.channels;
  assert.equal(channels.length, 2);
  const message = (m) => s.emit("message", JSON.stringify(m));
  message({ id: 1, result: channels });
  assert.equal(d.snapshot().status, "streaming");
  message({ method: "heartbeat", params: { type: "test_request" } });
  assert.equal(s.sent.at(-1).method, "public/test");
  message({
    method: "subscription",
    params: {
      channel: channels[0],
      data: {
        instrument_name: instruments[0].instrument_name,
        timestamp: now + 10,
        greeks: { delta: 0.6 },
      },
    },
  });
  message({
    method: "subscription",
    params: {
      channel: channels[0],
      data: {
        instrument_name: instruments[0].instrument_name,
        timestamp: now,
        greeks: { delta: 0.3 },
      },
    },
  });
  assert.equal(d.snapshot().ticker.greeks.delta, 0.6);
  message({
    method: "subscription",
    params: {
      channel: channels[1],
      data: Array.from({ length: 1010 }, (_, i) => ({
        ...trade,
        trade_id: String(i + 1),
        timestamp: now + i,
      })),
    },
  });
  assert.equal(d.snapshot().trades.length, 1000);
  s.emit("close");
  assert.equal(d.snapshot().status, "reconnecting");
  assert.equal(d.snapshot().gaps.length, 1);
  timeouts.at(-1)();
  assert.equal(sockets.length, 2);
  d.stop();
  timeouts.at(-1)();
  assert.equal(sockets.length, 2);
  assert.equal(d.snapshot().active, false);
});
test("failed refresh keeps timestamped prior data with an explicit error and stale completions cannot overwrite", async () => {
  const d = new DeribitOptions({ request, now: () => now });
  await d.refresh();
  d.request = async () => {
    throw Error("rate limited");
  };
  await assert.rejects(d.refresh({ currency: "ETH" }), /rate limited/);
  assert.equal(d.snapshot().currency, "BTC");
  assert.equal(d.snapshot().fetchedAt, now);
  assert.equal(d.snapshot().status, "error");
  assert.match(d.snapshot().error, /rate limited/);
  let finish;
  d.request = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const selecting = d.select({ instrument: instruments[0].instrument_name });
  d.stop();
  finish(await request("ticker"));
  await assert.rejects(selecting, /cancelled/);
  assert.equal(d.snapshot().ticker, null);
});

test("bounded expiry subscriptions update depth and event timestamps without refreshing untouched rows", async () => {
  const sockets = [];
  const d = new DeribitOptions({
    request,
    now: () => now,
    createSocket: () => {
      const s = new EventEmitter();
      s.sent = [];
      s.send = (v) => s.sent.push(JSON.parse(v));
      s.terminate = () => s.emit("close");
      sockets.push(s);
      return s;
    },
  });
  try {
    await d.refresh();
    await d.select({ instrument: instruments[0].instrument_name });
    d.start({ expiry: instruments[1].expiration_timestamp, maxContracts: 1 });
    const s = sockets[0];
    s.emit("open");
    const channels = s.sent[0].params.channels;
    assert.equal(channels.length, 3);
    s.emit("message", JSON.stringify({ id: 1, result: channels }));
    const untouched = d.snapshot().rows[0].quoteAt,
      root = d.snapshot().fetchedAt;
    s.emit(
      "message",
      JSON.stringify({
        method: "subscription",
        params: {
          channel: channels[2],
          data: {
            instrument_name: instruments[1].instrument_name,
            timestamp: now + 1000,
            best_bid_price: 0.01,
            best_ask_price: 0.02,
            best_bid_amount: 2,
            best_ask_amount: 3,
            mark_iv: 40,
            index_price: 101,
          },
        },
      }),
    );
    const result = d.snapshot();
    assert.equal(result.chainUpdates, 1);
    assert.equal(result.rows[1].bidSize, 2);
    assert.equal(result.rows[1].quoteAt, now + 1000);
    assert.equal(result.rows[0].quoteAt, untouched);
    assert.equal(result.fetchedAt, root);
    s.emit(
      "message",
      JSON.stringify({
        method: "subscription",
        params: {
          channel: channels[2],
          data: {
            instrument_name: instruments[1].instrument_name,
            timestamp: now,
            best_bid_price: 0.5,
          },
        },
      }),
    );
    assert.equal(d.snapshot().chainUpdates, 1);
    assert.equal(d.snapshot().rows[1].bid, 0.01);
  } finally {
    d.stop();
  }
});
