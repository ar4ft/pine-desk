import { credential } from "./credentials.js";
import { calculateGreeks } from "./greeks.js";
const origin = "https://api.massive.com";
export function impliedVolatility({
  spot,
  strike,
  days,
  type,
  exerciseStyle = "european",
  price,
  rate = 0,
}) {
  if (!(spot > 0 && strike > 0 && days > 0 && price > 0)) return null;
  let low = Math.max(0.1, Math.abs(rate) * Math.sqrt(days / 365 / 100) * 1.01),
    high = 300;
  const value = (v) =>
    calculateGreeks({
      spot,
      strike,
      days,
      type,
      volatility: v,
      rate,
      exerciseStyle,
      steps: 100,
    }).price;
  try {
    if (price < value(low) || price > value(high)) return null;
    for (let i = 0; i < 28; i++) {
      const mid = (low + high) / 2;
      if (value(mid) > price) high = mid;
      else low = mid;
    }
    return (low + high) / 2;
  } catch {
    return null;
  }
}
export class LicensedOptionHistory {
  constructor({
    fetcher = fetch,
    getToken = () => credential("massiveKey"),
  } = {}) {
    this.fetcher = fetcher;
    this.getToken = getToken;
  }
  async load({
    underlying,
    contracts,
    from,
    to,
    intervalSeconds = 300,
    rate = 0,
  } = {}) {
    if (
      !/^[A-Z][A-Z0-9.-]{0,14}$/.test(underlying) ||
      !Array.isArray(contracts) ||
      !contracts.length ||
      contracts.length > 8 ||
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from <= 0 ||
      to <= from ||
      to - from > 7 * 86400000 ||
      !Number.isInteger(intervalSeconds) ||
      intervalSeconds < 60 ||
      intervalSeconds > 3600 ||
      !Number.isFinite(rate) ||
      rate < 0 ||
      rate > 20
    )
      throw Error(
        "Backfill needs one equity underlying, 1–8 explicit contracts, up to seven days, and a 60–3600 second sampling interval.",
      );
    if (
      contracts.some(
        (c) =>
          !/^O:[A-Z0-9]{8,40}$/.test(c.ticker) ||
          !["call", "put"].includes(c.type) ||
          !Number.isFinite(c.strike) ||
          c.strike <= 0 ||
          !Number.isFinite(c.expiry) ||
          c.expiry <= to ||
          !["european", "american"].includes(c.exerciseStyle) ||
          !["cash", "physical"].includes(c.settlementType) ||
          c.contractSize !== 100,
      ) ||
      new Set(contracts.map((c) => c.ticker)).size !== contracts.length
    )
      throw Error(
        "Specify unique standard 100-share option contracts, strike, exact expiry time, exercise style and delivery type. Expiry must follow the requested period; adjusted contracts are unsupported.",
      );
    const token = await this.getToken();
    if (!token)
      throw Error(
        "Add a Massive API key in Settings with historical options quotes and stock aggregates access.",
      );
    const signal = AbortSignal.timeout(60000);
    let requests = 0;
    const request = async (url) => {
      if (
        url.origin !== origin ||
        !/^\/v[23]\/(quotes\/O%3A|quotes\/O:|aggs\/ticker\/|reference\/options\/contracts\/O%3A|reference\/options\/contracts\/O:)/.test(
          url.pathname,
        )
      )
        throw Error("Historical provider returned an unsupported endpoint.");
      if (++requests > 40)
        throw Error(
          "Backfill exceeds 40 provider requests; narrow the time range. No partial archive was saved.",
        );
      let response;
      try {
        response = await this.fetcher(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        });
      } catch {
        throw Error("Historical provider connection failed or timed out.");
      }
      if (!response.ok)
        throw Error(
          `Historical provider HTTP ${response.status}; check API plan, quota and regional access.`,
        );
      const body = await response.json();
      if (body.status === "ERROR" || body.error)
        throw Error("Historical provider rejected this request.");
      return body;
    };
    const paginate = async (url) => {
      const rows = [],
        seen = new Set();
      while (url) {
        if (seen.has(url.href))
          throw Error("Historical provider repeated a page.");
        seen.add(url.href);
        const page = await request(url);
        if (!Array.isArray(page.results))
          throw Error("Historical provider response lacks results.");
        rows.push(...page.results);
        if (rows.length > 50000)
          throw Error(
            "Backfill exceeds 50,000 rows per series; narrow the range.",
          );
        url = page.next_url ? new URL(page.next_url, origin) : null;
      }
      return rows;
    };
    for (const c of contracts) {
      const url = new URL(
        `/v3/reference/options/contracts/${encodeURIComponent(c.ticker)}`,
        origin,
      );
      url.searchParams.set("as_of", new Date(from).toISOString().slice(0, 10));
      const result = (await request(url)).results;
      if (
        !result ||
        result.underlying_ticker !== underlying ||
        result.contract_type !== c.type ||
        Number(result.strike_price) !== c.strike ||
        result.shares_per_contract !== 100 ||
        result.exercise_style !== c.exerciseStyle ||
        result.additional_underlyings?.length
      )
        throw Error(
          "Contract reference mismatch or adjusted deliverable; backfill refused.",
        );
      const expiryDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(c.expiry);
      if (expiryDate !== result.expiration_date)
        throw Error(
          "Supplied exact expiry time does not match the provider expiration date.",
        );
    }
    const aggURL = new URL(
      `/v2/aggs/ticker/${encodeURIComponent(underlying)}/range/1/minute/${Math.floor(from)}/${Math.floor(to)}`,
      origin,
    );
    for (const [k, v] of Object.entries({
      adjusted: false,
      sort: "asc",
      limit: 50000,
    }))
      aggURL.searchParams.set(k, String(v));
    const bars = (await paginate(aggURL))
      .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.c) && b.c > 0)
      .sort((a, b) => a.t - b.t);
    const quotes = [];
    for (const c of contracts) {
      const url = new URL(`/v3/quotes/${encodeURIComponent(c.ticker)}`, origin);
      for (const [k, v] of Object.entries({
        "timestamp.gte": (BigInt(Math.floor(from)) * 1000000n).toString(),
        "timestamp.lte": (BigInt(Math.floor(to)) * 1000000n).toString(),
        sort: "timestamp",
        order: "asc",
        limit: 50000,
      }))
        url.searchParams.set(k, String(v));
      quotes.push(
        (await paginate(url))
          .map((q) => ({
            ...q,
            at: Math.floor(Number(q.sip_timestamp) / 1000000),
          }))
          .filter((q) => Number.isFinite(q.at) && q.at >= from && q.at <= to)
          .sort((a, b) => a.at - b.at),
      );
    }
    const cursors = contracts.map(() => -1),
      snapshots = [];
    let barCursor = -1;
    for (let time = from; time <= to; time += intervalSeconds * 1000) {
      while (
        barCursor + 1 < bars.length &&
        bars[barCursor + 1].t + 60000 <= time
      )
        barCursor++;
      const bar = bars[barCursor];
      if (!bar || time - (bar.t + 60000) > 60000) continue;
      const rows = [];
      contracts.forEach((c, i) => {
        while (
          cursors[i] + 1 < quotes[i].length &&
          quotes[i][cursors[i] + 1].at <= time
        )
          cursors[i]++;
        const q = quotes[i][cursors[i]];
        if (!q) return;
        const bid = Number(q.bid_price),
          ask = Number(q.ask_price);
        if (
          !Number.isFinite(bid) ||
          !Number.isFinite(ask) ||
          bid < 0 ||
          ask < 0
        )
          return;
        const iv = impliedVolatility({
          spot: bar.c,
          strike: c.strike,
          days: (c.expiry - time) / 86400000,
          type: c.type,
          exerciseStyle: c.exerciseStyle,
          price: (bid + ask) / 2,
          rate,
        });
        rows.push({
          instrument: c.ticker.replace(":", "-"),
          currency: underlying,
          settlement: "USD",
          premiumCurrency: "USD",
          payoffType: "linear",
          quantityUnit: "contracts",
          contractSize: 100,
          exerciseStyle: c.exerciseStyle,
          settlementType: c.settlementType,
          type: c.type,
          strike: c.strike,
          expiry: c.expiry,
          bid,
          ask,
          bidSize: Number.isFinite(q.bid_size) ? q.bid_size * 100 : null,
          askSize: Number.isFinite(q.ask_size) ? q.ask_size * 100 : null,
          iv,
          modelRate: rate,
          ivAt: time,
          oi: null,
          mark: (bid + ask) / 2,
          underlying: bar.c,
          index: bar.c,
          quoteAt: q.at,
          quoteTimeKind:
            "Massive SIP quote timestamp; size converted from contracts to shares; IV fitted from midpoint with supplied rate",
        });
      });
      if (rows.length)
        snapshots.push({
          exchange: "import",
          currency: underlying,
          settlement: "USD",
          spot: bar.c,
          fetchedAt: time,
          rows,
          coverage: `Massive licensed historical quotes for ${contracts.length} explicitly selected contracts; last fully closed unadjusted 1-minute underlying bar, at most 60 seconds old. IV is model-derived at ${rate}% rate, zero dividend yield; OI unavailable. This is not a historical full chain.`,
        });
      if (snapshots.length > 2000)
        throw Error(
          "Backfill exceeds 2000 sampled observations; increase interval.",
        );
    }
    if (!snapshots.length)
      throw Error(
        "No supported observations align with closed underlying bars. No history saved.",
      );
    return {
      snapshots,
      requests,
      provider: "Massive",
      sourceVerified: false,
      warnings: [
        "Paid live entitlement has not been validated without a key.",
        "No lookback before the supplied quote range is filled. Quotes remain asynchronous/stale until a new event.",
        "Corporate actions, cash dividends, assignment events and exact expiry timing are not inferred.",
        "Nanosecond timestamps are reduced to millisecond observations. Midpoint-derived IV is a pricing assumption, not provider-reported IV.",
      ],
    };
  }
}
