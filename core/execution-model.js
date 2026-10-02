export function fillQuote(
  row,
  quantity,
  {
    feeBps = 10,
    slippageBps = 0,
    sizePolicy = "ignore",
    liquidityFraction = 1,
    feeModel = "premium",
    underlyingRate = 0.0003,
    premiumCap = 0.125,
    spot,
  } = {},
) {
  if (
    !Number.isFinite(quantity) ||
    quantity === 0 ||
    !["ignore", "reject", "partial"].includes(sizePolicy) ||
    !Number.isFinite(liquidityFraction) ||
    liquidityFraction <= 0 ||
    liquidityFraction > 1 ||
    !Number.isFinite(feeBps) ||
    feeBps < 0 ||
    feeBps > 1000 ||
    !Number.isFinite(slippageBps) ||
    slippageBps < 0 ||
    slippageBps > 2000 ||
    !["premium", "underlying-capped"].includes(feeModel) ||
    !Number.isFinite(underlyingRate) ||
    underlyingRate < 0 ||
    underlyingRate > 1 ||
    !Number.isFinite(premiumCap) ||
    premiumCap < 0 ||
    premiumCap > 1
  )
    throw Error("Invalid execution model.");
  const buy = quantity > 0,
    base = buy ? row.ask : row.bid,
    size = buy ? row.askSize : row.bidSize;
  if (!(base > 0) || !(row.bid > 0) || row.ask < row.bid)
    throw Error("Execution requires positive uncrossed bid/ask.");
  let amount = Math.abs(quantity);
  if (sizePolicy !== "ignore") {
    if (!Number.isFinite(size) || size < 0)
      throw Error(
        `Missing executable size for ${row.instrument}; cannot assume a fill.`,
      );
    const available = size * liquidityFraction;
    if (sizePolicy === "reject" && amount > available)
      throw Error(`Insufficient quoted size for ${row.instrument}.`);
    amount = Math.min(amount, available);
  }
  const filled = Math.sign(quantity) * amount,
    price = base * (1 + ((buy ? 1 : -1) * slippageBps) / 10000),
    premium = amount * price;
  const inverse = row.payoffType === "inverse";
  if (feeModel === "underlying-capped" && !inverse && !(spot > 0))
    throw Error("Linear underlying-based fee requires a positive index.");
  const fee =
    feeModel === "premium"
      ? (premium * feeBps) / 10000
      : Math.min(
          amount * underlyingRate * (inverse ? 1 : spot),
          premium * premiumCap,
        );
  return {
    quantity: filled,
    requestedQuantity: quantity,
    remainingQuantity: quantity - filled,
    side: buy ? "buy" : "sell",
    price,
    fee,
    cashChange: -filled * price - fee,
    quoteAt: row.quoteAt,
    size: size ?? null,
    sizePolicy,
    liquidityFraction,
    feeModel,
  };
}
