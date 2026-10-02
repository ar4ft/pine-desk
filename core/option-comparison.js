export function compareOptionRuns(runs, { weights, initialCapital } = {}) {
  if (
    !Array.isArray(runs) ||
    runs.length < 2 ||
    runs.length > 6 ||
    new Set(runs.map((r) => r.id)).size !== runs.length
  )
    throw Error("Compare 2–6 distinct option runs.");
  const base = runs[0].result,
    basis = base.basis;
  const basisKey = (b) =>
    JSON.stringify([
      b.exchange,
      b.currency,
      b.settlement,
      b.payoffType ?? (b.settlement === b.currency ? "inverse" : "linear"),
    ]);
  if (runs.some((r) => basisKey(r.result.basis) !== basisKey(basis)))
    throw Error(
      "Option portfolio requires identical exchange, underlying and settlement basis.",
    );
  const w = weights ?? runs.map(() => 1 / runs.length),
    capital = initialCapital ?? base.config.initialCapital;
  if (
    w.length !== runs.length ||
    w.some((v) => !Number.isFinite(v) || v <= 0) ||
    Math.abs(w.reduce((n, v) => n + v, 0) - 1) > 1e-8 ||
    !Number.isFinite(capital) ||
    capital <= 0
  )
    throw Error(
      "Positive weights must sum to one and capital must be positive.",
    );
  const signature = (r) =>
    JSON.stringify(r.result.curve.map((p) => [p.time, p.spot]));
  const sameObservations = runs.every(
    (r) => signature(r) === signature(runs[0]),
  );
  if (!sameObservations)
    throw Error(
      "Option allocation requires identical observed times and index prices; rerun strategies on the same archive selection.",
    );
  let peak = capital,
    drawdown = 0;
  const curve = base.curve.map((p, i) => {
    const equity = runs.reduce(
      (sum, r, k) =>
        sum +
        (w[k] * capital * r.result.curve[i].equitySettlement) /
          r.result.config.initialCapital,
      0,
    );
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
    return {
      time: p.time,
      spot: p.spot,
      equitySettlement: equity,
      pnlSettlement: equity - capital,
    };
  });
  return {
    basis,
    weights: w,
    initialCapital: capital,
    curve,
    metrics: {
      netPnLSettlement: curve.at(-1).pnlSettlement,
      maxDrawdownSettlement: drawdown,
      returnPercent: (curve.at(-1).equitySettlement / capital - 1) * 100,
    },
    runs: runs.map((r, i) => ({
      id: r.id,
      weight: w[i],
      kind: r.result.kind,
      metrics: r.result.metrics,
      rules: r.result.rules ?? null,
    })),
    warnings: [
      "Static allocation of independently simulated strategies, normalized to their starting capital.",
      "This does not share buying power, aggregate fills, cross-margin, or account-level liquidation between strategies.",
      "Identical observation times/index values are required; this does not prove every contract quote was simultaneous.",
    ],
  };
}
