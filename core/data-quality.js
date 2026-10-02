export const providerCapabilities = {
  massive: {
    market: "Licensed US stock/ETF option quote history",
    history: "Explicit contracts, up to seven days per bounded backfill",
    credentials: true,
    verification: "Fixtures only; paid access requires a configured key",
  },
  import: {
    market: "Normalized USD or crypto option archives",
    history: "Imported source is unverified",
    live: false,
  },
  binance: {
    market: "spot",
    history: "REST candles, CSV import",
    live: "candles and raw trades",
    options: false,
  },
  deribit: {
    market: "BTC/ETH inverse options",
    history: "local observations and imports",
    live: "selected ticker, currency trades and optional bounded expiry tickers",
    fullChain: "REST snapshot",
  },
  bybit: {
    market: "BTC/ETH stablecoin options",
    history: "local observations and imports",
    live: "30-second REST polling",
    verification:
      "Fixtures passed; live access returned HTTP 403 in build environment",
  },
  okx: {
    market: "BTC/ETH inverse options",
    history: "local observations and imports",
    live: "30-second REST polling",
    verification:
      "Fixtures passed; live access returned HTTP 403 in build environment",
  },
  unusualWhales: {
    market: "US equity/index options analytics",
    history: "provider entitlements; no historical contract replay adapter",
    live: "options prints and GEX",
    credentials: true,
  },
};
export function dataQuality(snapshot, now = Date.now()) {
  const rows = snapshot.rows ?? [],
    bars = snapshot.bars ?? snapshot.dataset?.bars ?? [],
    at =
      snapshot.fetchedAt ?? snapshot.loadedAt ?? snapshot.lastMessageAt ?? null;
  const observed = rows.map((r) => r.quoteAt).filter(Number.isFinite),
    missing = {};
  for (const key of ["bid", "ask", "iv", "oi", "bidSize", "askSize"])
    missing[key] = rows.filter((r) => !Number.isFinite(r[key])).length;
  return {
    provider:
      snapshot.exchange ??
      (snapshot.origin?.startsWith("Binance") ? "binance" : "import/demo"),
    status: snapshot.status ?? "dataset",
    observedAt: at,
    ageMs: at === null ? null : Math.max(0, now - at),
    contracts: rows.length,
    bars: bars.length,
    from: bars[0]?.time ?? null,
    to: bars.at(-1)?.time ?? null,
    quoteRange: observed.length
      ? [Math.min(...observed), Math.max(...observed)]
      : null,
    missing,
    crossed: rows.filter(
      (r) => Number.isFinite(r.bid) && Number.isFinite(r.ask) && r.bid > r.ask,
    ).length,
    gaps: snapshot.gaps ?? snapshot.candleGaps ?? [],
    coverage: snapshot.coverage ?? snapshot.origin ?? "Unspecified source",
    limitations: [
      "Response observation time does not prove last quote-change time.",
      "Missing size prevents a size-constrained fill assumption.",
    ],
  };
}
