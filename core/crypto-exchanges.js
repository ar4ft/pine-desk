import { finite, termStructure } from "./deribit.js";
const origins = { bybit: "https://api.bybit.com", okx: "https://www.okx.com" };
export async function exchangeRequest(exchange, path, params = {}, signal) {
  const origin = origins[exchange];
  if (!origin || !/^\/(v5\/market|api\/v5\/(public|market))\//.test(path))
    throw Error("Unsupported public exchange endpoint.");
  const url = new URL(path, origin);
  for (const [k, v] of Object.entries(params))
    url.searchParams.set(k, String(v));
  const r = await fetch(url, {
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  if (!r.ok)
    throw Error(
      `${exchange} HTTP ${r.status}; check regional access and API availability.`,
    );
  const body = await r.json();
  if (exchange === "bybit" && body.retCode !== 0)
    throw Error(`Bybit API ${body.retCode}: ${body.retMsg ?? "error"}`);
  if (exchange === "okx" && body.code !== "0")
    throw Error(`OKX API ${body.code}: ${body.msg ?? "error"}`);
  return body;
}
const greeks = (t) =>
  Object.fromEntries(
    ["delta", "gamma", "vega", "theta", "rho"].map((k) => [k, finite(t?.[k])]),
  );
function validateRequest(exchange, currency, settlement) {
  if (
    !["bybit", "okx"].includes(exchange) ||
    !["BTC", "ETH"].includes(currency) ||
    (exchange === "bybit" && !["USDC", "USDT"].includes(settlement))
  )
    throw Error("Choose a supported exchange, base and settlement currency.");
}
export function bybitRows(
  instruments,
  tickers,
  { currency, settlement, observedAt, now },
) {
  const quotes = new Map(tickers.map((t) => [t.symbol, t]));
  return instruments
    .filter(
      (i) =>
        i.baseCoin === currency &&
        i.settleCoin === settlement &&
        i.quoteCoin === settlement &&
        i.status === "Trading" &&
        Number(i.deliveryTime) > now,
    )
    .map((i) => {
      const match = /-([0-9]+(?:\.[0-9]+)?)-(C|P)(?:-(?:USDC|USDT))?$/.exec(
          i.symbol,
        ),
        t = quotes.get(i.symbol) ?? {};
      return {
        exchange: "bybit",
        instrument: i.symbol,
        type:
          i.optionsType === "Call"
            ? "call"
            : i.optionsType === "Put"
              ? "put"
              : null,
        strike: match ? Number(match[1]) : null,
        expiry: Number(i.deliveryTime),
        currency,
        settlement,
        premiumCurrency: settlement,
        payoffType: "linear",
        contractSize: 1,
        quantityUnit: "underlying",
        bid: finite(t.bid1Price),
        ask: finite(t.ask1Price),
        bidSize: finite(t.bid1Size),
        askSize: finite(t.ask1Size),
        mark: finite(t.markPrice),
        iv: finite(t.markIv) === null ? null : Number(t.markIv) * 100,
        bidIV: finite(t.bid1Iv) === null ? null : Number(t.bid1Iv) * 100,
        askIV: finite(t.ask1Iv) === null ? null : Number(t.ask1Iv) * 100,
        oi: finite(t.openInterest),
        volume: finite(t.volume24h),
        underlying: finite(t.underlyingPrice),
        index: finite(t.indexPrice),
        quoteAt: observedAt,
        ivAt: observedAt,
        quoteTimeKind: "API response observation; not last quote-change time",
        greeks: greeks(t),
      };
    })
    .filter((r) => r.strike > 0 && r.type)
    .sort(
      (a, b) =>
        a.expiry - b.expiry ||
        a.strike - b.strike ||
        a.type.localeCompare(b.type),
    );
}
export function okxRows(
  instruments,
  tickers,
  summaries,
  marks,
  interest,
  { currency, now },
) {
  const map = (list) => new Map(list.map((t) => [t.instId, t])),
    quotes = map(tickers),
    ivs = map(summaries),
    prices = map(marks),
    ois = map(interest);
  return instruments
    .filter(
      (i) =>
        i.instFamily === `${currency}-USD` &&
        i.state === "live" &&
        i.settleCcy === currency &&
        i.ctValCcy === currency &&
        Number(i.ctVal) > 0 &&
        Number(i.expTime) > now,
    )
    .map((i) => {
      const t = quotes.get(i.instId) ?? {},
        v = ivs.get(i.instId) ?? {},
        m = prices.get(i.instId) ?? {},
        o = ois.get(i.instId) ?? {},
        size = Number(i.ctVal) * (finite(i.ctMult) ?? 1);
      return {
        exchange: "okx",
        instrument: i.instId,
        type: i.optType === "C" ? "call" : i.optType === "P" ? "put" : null,
        strike: finite(i.stk),
        expiry: Number(i.expTime),
        currency,
        settlement: currency,
        premiumCurrency: currency,
        payoffType: "inverse",
        contractSize: size,
        quantityUnit: "contracts",
        bid: finite(t.bidPx),
        ask: finite(t.askPx),
        bidSize: finite(t.bidSz) === null ? null : finite(t.bidSz) * size,
        askSize: finite(t.askSz) === null ? null : finite(t.askSz) * size,
        mark: finite(m.markPx),
        iv: finite(v.markVol) === null ? null : Number(v.markVol) * 100,
        bidIV: finite(v.bidVol) === null ? null : Number(v.bidVol) * 100,
        askIV: finite(v.askVol) === null ? null : Number(v.askVol) * 100,
        oi: finite(o.oi) === null ? null : Number(o.oi) * size,
        rawOI: finite(o.oi),
        volume: finite(t.vol24h) === null ? null : Number(t.vol24h) * size,
        underlying: finite(v.fwdPx),
        quoteAt: finite(t.ts),
        ivAt: finite(v.ts),
        quoteTimeKind: "Exchange ticker timestamp; IV may be asynchronous",
        greeks: greeks({
          delta: v.deltaBS,
          gamma: v.gammaBS,
          vega: v.vegaBS,
          theta: v.thetaBS,
        }),
      };
    })
    .filter((r) => r.strike > 0 && r.type && r.contractSize > 0)
    .sort(
      (a, b) =>
        a.expiry - b.expiry ||
        a.strike - b.strike ||
        a.type.localeCompare(b.type),
    );
}
export class PublicOptionsExchange {
  constructor(
    exchange,
    { request = exchangeRequest, now = Date.now, clock = globalThis } = {},
  ) {
    this.exchange = exchange;
    this.request = request;
    this.now = now;
    this.clock = clock;
    this.generation = 0;
    this.state = { exchange, status: "idle", rows: [], trades: [], gaps: [] };
  }
  snapshot() {
    return structuredClone({ ...this.state, active: !!this.active });
  }
  stop() {
    this.generation++;
    this.active = false;
    this.abort?.abort();
    this.clock.clearTimeout(this.timer);
    this.state.status = this.state.rows.length ? "snapshot" : "idle";
    return this.snapshot();
  }
  async fetchChain({ currency = "BTC", settlement = "USDC" } = {}) {
    validateRequest(this.exchange, currency, settlement);
    const generation = this.generation;
    const abort = new AbortController();
    this.abort = abort;
    const get = (path, params) =>
      this.request(this.exchange, path, params, abort.signal);
    let rows,
      spot,
      trades = [],
      tradeCoverage;
    try {
      if (this.exchange === "bybit") {
        const instruments = [];
        let cursor = "",
          seen = new Set();
        for (let n = 0; n < 20; n++) {
          const body = await get("/v5/market/instruments-info", {
            category: "option",
            baseCoin: currency,
            limit: 1000,
            ...(cursor ? { cursor } : {}),
          });
          if (!Array.isArray(body.result?.list))
            throw Error("Invalid Bybit instruments.");
          instruments.push(...body.result.list);
          cursor = body.result.nextPageCursor ?? "";
          if (!cursor) break;
          if (seen.has(cursor) || n === 19)
            throw Error("Bybit instrument pagination did not finish.");
          seen.add(cursor);
        }
        const [quotes, prints] = await Promise.all([
          get("/v5/market/tickers", { category: "option", baseCoin: currency }),
          get("/v5/market/recent-trade", {
            category: "option",
            baseCoin: currency,
            limit: 100,
          }),
        ]);
        if (
          !Array.isArray(quotes.result?.list) ||
          !Array.isArray(prints.result?.list)
        )
          throw Error("Invalid Bybit market response.");
        rows = bybitRows(instruments, quotes.result.list, {
          currency,
          settlement,
          observedAt: finite(quotes.time),
          now: this.now(),
        });
        const indices = rows
          .map((r) => r.index)
          .filter((p) => p > 0)
          .sort((a, b) => a - b);
        spot = indices[Math.floor(indices.length / 2)];
        const meta = new Map(rows.map((r) => [r.instrument, r]));
        trades = prints.result.list.flatMap((t) => {
          const row = meta.get(t.symbol),
            amount = finite(t.size),
            price = finite(t.price);
          return row && amount > 0 && price >= 0 && finite(t.time) && t.execId
            ? [
                {
                  id: String(t.execId),
                  instrument: t.symbol,
                  time: Number(t.time),
                  amount,
                  price,
                  premiumUSD: amount * price,
                  side: ["buy", "sell"].includes(String(t.side).toLowerCase())
                    ? String(t.side).toLowerCase()
                    : "unknown",
                  currency,
                  premiumCurrency: settlement,
                },
              ]
            : [];
        });
        tradeCoverage =
          "Latest 100 currency option trades requested; only selected-settlement instruments retained. No complete-session coverage.";
      } else {
        const family = currency + "-USD";
        const [instruments, quotes, ivs, marks, oi, index] = await Promise.all([
          get("/api/v5/public/instruments", {
            instType: "OPTION",
            instFamily: family,
          }),
          get("/api/v5/market/tickers", {
            instType: "OPTION",
            instFamily: family,
          }),
          get("/api/v5/public/opt-summary", { instFamily: family }),
          get("/api/v5/public/mark-price", {
            instType: "OPTION",
            instFamily: family,
          }),
          get("/api/v5/public/open-interest", {
            instType: "OPTION",
            instFamily: family,
          }),
          get("/api/v5/market/index-tickers", { instId: family }),
        ]);
        if (
          ![instruments, quotes, ivs, marks, oi, index].every((b) =>
            Array.isArray(b.data),
          )
        )
          throw Error("Invalid OKX market response.");
        rows = okxRows(
          instruments.data,
          quotes.data,
          ivs.data,
          marks.data,
          oi.data,
          { currency, now: this.now() },
        );
        spot = finite(index.data[0]?.idxPx);
        if (this.state.instrument) {
          const row = rows.find((r) => r.instrument === this.state.instrument);
          if (row) {
            const prints = await get("/api/v5/market/trades", {
              instId: row.instrument,
              limit: 100,
            });
            trades = this.okxTrades(prints.data ?? [], row, spot);
          }
        }
        tradeCoverage =
          "OKX REST trades are loaded for the selected contract only; no currency-wide flow inferred.";
      }
      if (generation !== this.generation)
        throw Error("Exchange refresh cancelled.");
      if (!rows.length || !(spot > 0))
        throw Error("No supported options/index returned for this settlement.");
      const fetchedAt = this.now(),
        instrument = this.state.instrument,
        ticker = rows.find((r) => r.instrument === instrument);
      this.state = {
        exchange: this.exchange,
        currency,
        settlement: this.exchange === "okx" ? currency : settlement,
        status: this.active ? "polling" : "snapshot",
        rows,
        spot,
        fetchedAt,
        term: termStructure(rows, spot, fetchedAt),
        trades: trades.sort((a, b) => a.time - b.time).slice(-100),
        tradeCoverage,
        instrument: ticker ? instrument : null,
        ticker: ticker ? this.toTicker(ticker) : null,
        gaps: this.state.gaps ?? [],
        error: null,
        coverage:
          "REST chain snapshots. Explicit live mode polls every 30 seconds; no WebSocket or historical backfill. Stablecoin values use 1 USD parity for research.",
      };
      return this.snapshot();
    } catch (e) {
      abort.abort();
      if (generation === this.generation) {
        this.state.status = "error";
        this.state.error = e.message;
      }
      throw e;
    }
  }
  refresh(args) {
    this.stop();
    return this.fetchChain(args);
  }
  toTicker(r) {
    return {
      instrument: r.instrument,
      timestamp: r.quoteAt,
      mark: r.mark,
      bid: r.bid,
      ask: r.ask,
      iv: r.iv,
      index: r.index ?? this.state.spot,
      underlying: r.underlying,
      oi: r.oi,
      greeks: r.greeks,
      premiumCurrency: r.premiumCurrency,
    };
  }
  async select({ instrument }) {
    if (!this.state.rows.some((r) => r.instrument === instrument))
      throw Error("Select a contract from this exchange chain.");
    const request = {
      currency: this.state.currency,
      settlement: this.state.settlement,
    };
    this.stop();
    const generation = this.generation;
    await this.fetchChain(request);
    if (generation !== this.generation) throw Error("Selection cancelled.");
    const row = this.state.rows.find((r) => r.instrument === instrument);
    if (!row) throw Error("Contract no longer available.");
    this.state.instrument = instrument;
    this.state.ticker = this.toTicker(row);
    if (this.exchange === "okx") {
      const abort = new AbortController();
      this.abort = abort;
      const response = await this.request(
        "okx",
        "/api/v5/market/trades",
        { instId: instrument, limit: 100 },
        abort.signal,
      );
      if (generation !== this.generation) throw Error("Selection cancelled.");
      this.state.trades = this.okxTrades(
        response.data ?? [],
        row,
        this.state.spot,
      );
    }
    return this.snapshot();
  }
  okxTrades(data, row, spot) {
    return data.flatMap((t) => {
      const size = finite(t.sz),
        price = finite(t.px),
        amount = size === null ? null : size * row.contractSize;
      return amount > 0 && price >= 0 && finite(t.ts) && t.tradeId
        ? [
            {
              id: String(t.tradeId),
              instrument: row.instrument,
              time: Number(t.ts),
              amount,
              rawQuantity: size,
              price,
              premiumUSD: amount * price * spot,
              premiumUSDKind:
                "Estimate using selected snapshot index, not trade-time index",
              side: ["buy", "sell"].includes(t.side) ? t.side : "unknown",
              currency: row.currency,
              premiumCurrency: row.premiumCurrency,
            },
          ]
        : [];
    });
  }
  start() {
    if (!this.state.rows.length)
      throw Error("Refresh an exchange chain first.");
    if (this.active) return this.snapshot();
    this.active = true;
    this.state.status = "polling";
    this.schedule(this.generation);
    return this.snapshot();
  }
  schedule(generation) {
    this.timer = this.clock.setTimeout(async () => {
      if (!this.active || generation !== this.generation) return;
      try {
        await this.fetchChain({
          currency: this.state.currency,
          settlement: this.state.settlement,
        });
      } catch (e) {
        if (this.active && generation === this.generation) {
          this.state.gaps.push({ at: this.now(), reason: e.message });
          this.state.gaps = this.state.gaps.slice(-50);
        }
      }
      if (this.active && generation === this.generation)
        this.schedule(generation);
    }, 30000);
    this.timer?.unref?.();
  }
}
