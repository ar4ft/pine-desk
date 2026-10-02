import test from "node:test";
import assert from "node:assert/strict";
import {
  LicensedOptionHistory,
  impliedVolatility,
} from "../core/licensed-option-history.js";
import { calculateGreeks } from "../core/greeks.js";
import { validateOptionSnapshot } from "../core/option-history.js";
const from = Date.UTC(2026, 0, 2, 14, 30),
  to = from + 6 * 60000,
  expiry = Date.UTC(2026, 0, 30, 21),
  ticker = "O:SPY260130C00100000";
const input = {
  underlying: "SPY",
  from,
  to,
  intervalSeconds: 60,
  contracts: [
    {
      ticker,
      strike: 100,
      type: "call",
      expiry,
      exerciseStyle: "european",
      settlementType: "cash",
      contractSize: 100,
    },
  ],
};
const reference = {
  underlying_ticker: "SPY",
  contract_type: "call",
  strike_price: 100,
  shares_per_contract: 100,
  exercise_style: "european",
  expiration_date: "2026-01-30",
};
function fixture({ badReference = false, nextURL } = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers });
    if (url.pathname.includes("/reference/"))
      return {
        ok: true,
        json: async () => ({
          results: {
            ...reference,
            ...(badReference
              ? { additional_underlyings: [{ ticker: "OTHER" }] }
              : {}),
          },
        }),
      };
    if (url.pathname.includes("/aggs/"))
      return {
        ok: true,
        json: async () => ({
          results: Array.from({ length: 6 }, (_, i) => ({
            t: from + i * 60000,
            c: 100,
          })),
        }),
      };
    const price = calculateGreeks({
      spot: 100,
      strike: 100,
      days: (expiry - from) / 86400000,
      volatility: 20,
      rate: 0,
      type: "call",
    }).price;
    return {
      ok: true,
      json: async () => ({
        results: [
          {
            sip_timestamp: (BigInt(from) * 1000000n).toString(),
            bid_price: price * 0.99,
            ask_price: price * 1.01,
            bid_size: 2,
            ask_size: 3,
          },
        ],
        ...(nextURL ? { next_url: nextURL } : {}),
      }),
    };
  };
  return {
    calls,
    provider: new LicensedOptionHistory({
      fetcher,
      getToken: async () => "fixture-token",
    }),
  };
}
test("licensed adapter authenticates at fixed origin, verifies reference and joins only past closed bars/quotes", async () => {
  const { provider, calls } = fixture();
  const result = await provider.load(input);
  assert.equal(result.snapshots.length, 6);
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every(
      (c) =>
        c.url.startsWith("https://api.massive.com/") &&
        c.headers.Authorization === "Bearer fixture-token" &&
        !c.url.includes("fixture-token"),
    ),
  );
  const snapshot = validateOptionSnapshot(result.snapshots[0]);
  assert.equal(snapshot.fetchedAt, from + 60000);
  assert.equal(snapshot.rows[0].bidSize, 200);
  assert.equal(snapshot.rows[0].askSize, 300);
  assert.equal(snapshot.rows[0].oi, null);
  assert.ok(Math.abs(snapshot.rows[0].iv - 20) < 0.02);
  assert.equal(snapshot.rows[0].quoteAt, from);
  assert.match(snapshot.coverage, /not a historical full chain/);
});
test("historical adapter rejects adjusted deliverables, external pagination and missing tokens before recording", async () => {
  await assert.rejects(
    fixture({ badReference: true }).provider.load(input),
    /adjusted/,
  );
  await assert.rejects(
    fixture({ nextURL: "https://example.com/steal" }).provider.load(input),
    /unsupported endpoint/,
  );
  let called = false;
  const provider = new LicensedOptionHistory({
    getToken: async () => null,
    fetcher: async () => {
      called = true;
    },
  });
  await assert.rejects(provider.load(input), /API key/);
  assert.equal(called, false);
});
test("historical provider errors never expose response bodies or credentials", async () => {
  const provider = new LicensedOptionHistory({
    getToken: async () => "fixture-secret",
    fetcher: async () => ({
      ok: false,
      status: 403,
      json: async () => ({ message: "fixture-secret" }),
    }),
  });
  await assert.rejects(
    provider.load(input),
    (error) =>
      /HTTP 403/.test(error.message) &&
      !error.message.includes("fixture-secret"),
  );
});
test("midpoint implied volatility inversion recovers a European reference and rejects out-of-range prices", () => {
  const model = { spot: 100, strike: 100, days: 30, type: "call", rate: 0 },
    price = calculateGreeks({ ...model, volatility: 25 }).price;
  assert.ok(Math.abs(impliedVolatility({ ...model, price }) - 25) < 1e-4);
  assert.equal(impliedVolatility({ ...model, price: 10000 }), null);
});
