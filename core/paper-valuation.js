export function paperValuation(account, quotes, now) {
  if (!account) return null;
  const positions = Object.entries(account.positions)
    .filter(([, p]) => p.quantity > 0)
    .map(([symbol, p]) => {
      const q = quotes[symbol],
        valid =
          q &&
          Number.isFinite(q.bid) &&
          q.bid > 0 &&
          Number.isFinite(q.requestedAt) &&
          Number.isFinite(q.receivedAt) &&
          q.requestedAt <= q.receivedAt &&
          q.receivedAt <= now &&
          now - q.requestedAt <= 15000;
      const value = valid ? p.quantity * q.bid : null;
      const usable =
        value !== null &&
        Number.isFinite(value) &&
        Number.isFinite(value - p.cost);
      return {
        symbol,
        quantity: p.quantity,
        cost: p.cost,
        bid: usable ? q.bid : null,
        value: usable ? value : null,
        unrealizedPnl: usable ? value - p.cost : null,
        requestedAt: q?.requestedAt ?? null,
        receivedAt: q?.receivedAt ?? null,
        stale: !usable,
      };
    });
  const complete = positions.every((p) => !p.stale),
    equity = complete
      ? account.cash + positions.reduce((n, p) => n + p.value, 0)
      : null;
  return {
    at: now,
    accountRevision: account.revision,
    complete: complete && Number.isFinite(equity),
    equity: Number.isFinite(equity) ? equity : null,
    unrealizedPnl: complete
      ? positions.reduce((n, p) => n + p.unrealizedPnl, 0)
      : null,
    positions,
    method:
      "Current observed bid; excludes hypothetical exit fees/slippage. Missing or >15-second-old quotes suppress totals.",
  };
}
