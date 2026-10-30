import { z } from "zod";

const cap = z.number().finite().positive().max(1e12).nullable();
export const paperRiskSchema = z
  .object({
    pauseBuys: z.boolean(),
    maxOrderCost: cap,
    maxSymbolCost: cap,
    maxTotalCost: cap,
    maxMarkets: z.number().int().min(1).max(50).nullable(),
    dailyLossLimit: cap,
  })
  .strict();
export const defaultPaperRisk = () => ({
  pauseBuys: false,
  maxOrderCost: null,
  maxSymbolCost: null,
  maxTotalCost: null,
  maxMarkets: null,
  dailyLossLimit: null,
});
const clean = (n) => Number(n.toPrecision(15));
export const paperEntryCost = (o) =>
  clean(
    (o.type === "market" ? o.maxNotional : o.quantity * o.price) *
      (1 + o.feePercent / 100),
  );

// Cost commitments, never a market-value or liquidation-risk estimate.
export function paperRiskUsage(s, at, excludeId) {
  const symbolCosts = {};
  for (const [symbol, p] of Object.entries(s.positions))
    if (p.quantity > 0) symbolCosts[symbol] = p.cost;
  for (const o of s.orders)
    if (o.side === "buy" && o.status === "pending" && o.id !== excludeId)
      symbolCosts[o.symbol] = clean(
        (symbolCosts[o.symbol] ?? 0) + paperEntryCost(o),
      );
  const day = Math.floor(at / 86400000);
  const dailyLoss = clean(
    s.fills.reduce(
      (sum, f) =>
        Math.floor(f.at / 86400000) === day
          ? sum + Math.max(0, -f.realizedPnl)
          : sum,
      0,
    ),
  );
  return {
    day: new Date(day * 86400000).toISOString().slice(0, 10),
    dailyLoss,
    symbolCosts,
    totalCost: clean(Object.values(symbolCosts).reduce((a, b) => a + b, 0)),
    markets: Object.keys(symbolCosts).length,
  };
}
export function paperRiskViolation(
  s,
  order,
  at,
  cost = paperEntryCost(order),
  excludeId,
) {
  if (order.side !== "buy") return null;
  const r = s.risk,
    u = paperRiskUsage(s, at, excludeId);
  if (r.pauseBuys) return "New buys are paused.";
  if (r.dailyLossLimit !== null && u.dailyLoss >= r.dailyLossLimit)
    return "Daily realized losing-trade budget reached (UTC).";
  if (r.maxOrderCost !== null && cost > r.maxOrderCost)
    return "Order cost exceeds the per-order limit, including fees.";
  if (
    r.maxSymbolCost !== null &&
    clean((u.symbolCosts[order.symbol] ?? 0) + cost) > r.maxSymbolCost
  )
    return "Committed cost exceeds the per-market limit, including pending buys.";
  if (r.maxTotalCost !== null && clean(u.totalCost + cost) > r.maxTotalCost)
    return "Committed cost exceeds the total limit, including pending buys.";
  if (
    r.maxMarkets !== null &&
    u.markets + (Object.hasOwn(u.symbolCosts, order.symbol) ? 0 : 1) >
      r.maxMarkets
  )
    return "Open and pending markets exceed the market-count limit.";
  return null;
}
