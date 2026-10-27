// Preserve unknown metadata rather than guessing stock/option or quote units
// from a display symbol. Provider adapters can supply richer metadata later.
export function datasetInstrument(dataset) {
  const symbol = String(dataset.symbol);
  const venue = /Binance/i.test(dataset.origin ?? "")
    ? "binance"
    : /Synthetic/i.test(dataset.origin ?? "")
      ? "synthetic"
      : "imported";
  const assetType = venue === "binance" ? "spot" : "unknown";
  return {
    id: [venue, assetType, symbol].map(encodeURIComponent).join(":"),
    venue,
    assetType,
    symbol,
    contract: null,
    quoteCurrency: null,
    settlementCurrency: null,
  };
}
