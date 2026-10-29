export function tradeSizeSettings(input = {}) {
  const { minTradeSize = 0, maxTradeSize = null } = input;
  if (
    !Number.isFinite(minTradeSize) ||
    minTradeSize < 0 ||
    (maxTradeSize !== null &&
      (!Number.isFinite(maxTradeSize) ||
        maxTradeSize <= 0 ||
        maxTradeSize < minTradeSize))
  )
    throw Error(
      "Trade-size filter requires a nonnegative minimum and a positive maximum ≥ minimum, or no maximum.",
    );
  return { minTradeSize, maxTradeSize };
}
export const matchesTradeSize = (trade, settings) =>
  trade.size >= settings.minTradeSize &&
  (settings.maxTradeSize === null || trade.size <= settings.maxTradeSize);
export const tradeFilterStats = (observed, matched, settings) => ({
  ...tradeSizeSettings(settings),
  observedTrades: observed,
  matchedTrades: matched,
  excludedTrades: observed - matched,
  units:
    "supplied trade size; Binance spot base asset; inclusive bounds applied to individual prints before aggregation",
});
