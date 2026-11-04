import { z } from "zod";

const timestamp = z.number().int().nonnegative().max(8.64e15);
export const paperPerformanceFields = {
  symbol: z
    .string()
    .regex(/^[A-Z0-9]{2,20}USDT$/)
    .optional(),
  from: timestamp.optional(),
  to: timestamp.optional(),
};
export const paperPerformanceSchema = z
  .object(paperPerformanceFields)
  .strict()
  .refine(
    (v) => v.from === undefined || v.to === undefined || v.from < v.to,
    "Close-time range must have from < to (to is exclusive).",
  );
const clean = (n) => Number(n.toPrecision(15));
const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);
const tolerance = (...values) =>
  Math.max(1e-8, 32 * Number.EPSILON * Math.max(0, ...values.map(Math.abs)));
const close = (a, b) => Math.abs(a - b) <= tolerance(a, b);

function summarize(trades) {
  const wins = trades.filter((t) => t.outcome === "win"),
    losses = trades.filter((t) => t.outcome === "loss");
  const grossProfit = sum(wins, "realizedPnl"),
    grossLoss = -sum(losses, "realizedPnl");
  let pnl = 0,
    peak = 0,
    maxDrawdown = 0,
    winningStreak = 0,
    losingStreak = 0,
    maxWinningStreak = 0,
    maxLosingStreak = 0;
  const curve = trades.map((t) => {
    pnl += t.realizedPnl;
    peak = Math.max(peak, pnl);
    const drawdown = peak - pnl;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    winningStreak = t.outcome === "win" ? winningStreak + 1 : 0;
    losingStreak = t.outcome === "loss" ? losingStreak + 1 : 0;
    maxWinningStreak = Math.max(maxWinningStreak, winningStreak);
    maxLosingStreak = Math.max(maxLosingStreak, losingStreak);
    return {
      tradeId: t.id,
      closedAt: t.closedAt,
      cumulativePnl: pnl,
      drawdown,
    };
  });
  return {
    closedCount: trades.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: trades.length - wins.length - losses.length,
    netPnl: sum(trades, "realizedPnl"),
    fees: sum(trades, "fees"),
    grossProfit,
    grossLoss,
    winRatePercent: trades.length ? (wins.length / trades.length) * 100 : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    averageWin: wins.length ? grossProfit / wins.length : null,
    averageLoss: losses.length ? -grossLoss / losses.length : null,
    expectancy: trades.length ? pnl / trades.length : null,
    averageHoldingMs: trades.length
      ? sum(trades, "holdingMs") / trades.length
      : null,
    bestTrade: trades.length
      ? Math.max(...trades.map((t) => t.realizedPnl))
      : null,
    worstTrade: trades.length
      ? Math.min(...trades.map((t) => t.realizedPnl))
      : null,
    maxClosedPnlDrawdown: maxDrawdown,
    maxWinningStreak,
    maxLosingStreak,
    curve,
  };
}

// Called only with a validated, replayed PaperAccount snapshot. No quotes, storage writes or journal reads.
export function paperPerformance(account, args = {}) {
  const filter = paperPerformanceSchema.parse(args);
  const active = new Map(),
    closed = [],
    orders = new Map((account?.orders ?? []).map((o) => [o.id, o]));
  for (const [index, fill] of (account?.fills ?? []).entries()) {
    let t = active.get(fill.symbol);
    if (!t) {
      if (fill.side !== "buy")
        throw Error("Paper performance: exit without an opening fill.");
      t = {
        id: fill.orderId,
        symbol: fill.symbol,
        status: "open",
        openedAt: fill.at,
        closedAt: null,
        closeIndex: null,
        lastFillAt: fill.at,
        holdingMs: null,
        quantity: 0,
        remainingCost: 0,
        buyQuantity: 0,
        sellQuantity: 0,
        buyNotional: 0,
        sellNotional: 0,
        buyCost: 0,
        netProceeds: 0,
        fees: 0,
        realizedPnl: 0,
        grossPnl: null,
        returnOnBuyCostPercent: null,
        outcome: null,
        breakEvenTolerance: null,
        fills: [],
      };
      active.set(fill.symbol, t);
    }
    const order = orders.get(fill.orderId);
    if (!order || order.status !== "filled")
      throw Error("Paper performance: missing filled-order reference.");
    t.fills.push({
      ...fill,
      plan: order.plan ?? null,
      parentId: order.parentId ?? null,
      leg: order.leg ?? null,
    });
    t.lastFillAt = fill.at;
    t.fees += fill.fee;
    if (fill.side === "buy") {
      t.quantity = clean(t.quantity + fill.quantity);
      t.buyQuantity += fill.quantity;
      t.buyNotional += fill.notional;
      t.buyCost += fill.notional + fill.fee;
      t.remainingCost += fill.notional + fill.fee;
    } else {
      if (fill.quantity > t.quantity)
        throw Error("Paper performance: exit exceeds held quantity.");
      const cost =
        fill.quantity === t.quantity
          ? t.remainingCost
          : t.remainingCost * (fill.quantity / t.quantity);
      if (!close(fill.notional - fill.fee - cost, fill.realizedPnl))
        throw Error("Paper performance: fill cost basis does not reconcile.");
      t.quantity = clean(t.quantity - fill.quantity);
      t.remainingCost -= cost;
      t.sellQuantity += fill.quantity;
      t.sellNotional += fill.notional;
      t.netProceeds += fill.notional - fill.fee;
      t.realizedPnl += fill.realizedPnl;
      if (t.quantity === 0) {
        t.status = "closed";
        t.closedAt = fill.at;
        t.closeIndex = index;
        t.holdingMs = t.closedAt - t.openedAt;
        t.grossPnl = t.sellNotional - t.buyNotional;
        t.returnOnBuyCostPercent = (t.realizedPnl / t.buyCost) * 100;
        t.breakEvenTolerance = tolerance(t.buyCost, t.netProceeds);
        t.outcome =
          Math.abs(t.realizedPnl) <= t.breakEvenTolerance
            ? "breakeven"
            : t.realizedPnl > 0
              ? "win"
              : "loss";
        if (
          Math.abs(t.netProceeds - t.buyCost - t.realizedPnl) >
          t.breakEvenTolerance
        )
          throw Error("Paper performance: closed trade does not reconcile.");
        closed.push(t);
        active.delete(fill.symbol);
      }
    }
  }
  const open = [...active.values()];
  for (const [symbol, position] of Object.entries(account?.positions ?? {})) {
    const t = active.get(symbol);
    if (
      (t?.quantity ?? 0) !== position.quantity ||
      !close(t?.remainingCost ?? 0, position.cost)
    )
      throw Error("Paper performance: remaining holdings do not reconcile.");
  }
  if (open.some((t) => !account?.positions[t.symbol]))
    throw Error("Paper performance: holding missing from account.");
  const closedPnl = sum(closed, "realizedPnl"),
    openPnl = sum(open, "realizedPnl");
  const delta = closedPnl + openPnl - (account?.realizedPnl ?? 0);
  const allowed = tolerance(
    closedPnl,
    openPnl,
    ...(account?.fills ?? []).map((f) => f.notional),
  );
  if (Math.abs(delta) > allowed)
    throw Error(
      "Paper performance: realized P&L does not reconcile with the account.",
    );
  const selectedClosed = closed.filter(
    (t) =>
      (!filter.symbol || t.symbol === filter.symbol) &&
      (filter.from === undefined || t.closedAt >= filter.from) &&
      (filter.to === undefined || t.closedAt < filter.to),
  );
  const selectedOpen = open.filter(
    (t) => !filter.symbol || t.symbol === filter.symbol,
  );
  return {
    version: 1,
    accountId: account?.id ?? null,
    accountRevision: account?.revision ?? 0,
    currency: "USDT",
    filter,
    symbols: [...new Set([...closed, ...open].map((t) => t.symbol))].sort(),
    method:
      "One trade per market from flat to flat, in ledger fill order. Overlapping plans share a trade. Closed statistics use net realized P&L after entry/exit fees; slippage is already in fill prices. Close-time filters include complete trades; open trades ignore the date window. No live quotes or unrealized valuation.",
    totals: {
      closedCount: closed.length,
      openCount: open.length,
      fillCount: account?.fills.length ?? 0,
    },
    reconciliation: {
      scope: "Entire account, before filters",
      accountRealizedPnl: account?.realizedPnl ?? 0,
      closedRealizedPnl: closedPnl,
      openRealizedPnl: openPnl,
      delta,
      tolerance: allowed,
    },
    summary: summarize(selectedClosed),
    openSummary: {
      count: selectedOpen.length,
      realizedPnl: sum(selectedOpen, "realizedPnl"),
      remainingCost: sum(selectedOpen, "remainingCost"),
    },
    closedTrades: selectedClosed,
    openTrades: selectedOpen,
  };
}
