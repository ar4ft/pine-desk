import { runBacktest, validateSource } from "./backtest.js";
import { validateBars } from "./data.js";
export function compareSeries(
  baseline,
  candidate,
  { from = 0, to = Infinity, tolerance = 1e-8 } = {},
) {
  const differences = [];
  for (const [name, points] of Object.entries(baseline ?? {})) {
    const other = new Map(
      (candidate?.[name] ?? []).map((p) => [p.time, p.value]),
    );
    for (const p of points) {
      if (p.time < from || p.time > to) continue;
      const value = other.get(p.time);
      if (
        value === undefined ||
        Math.abs(value - p.value) > tolerance * Math.max(1, Math.abs(p.value))
      )
        differences.push({
          series: name,
          time: p.time,
          baseline: p.value,
          candidate: value ?? null,
        });
      if (differences.length >= 100) return differences;
    }
  }
  return differences;
}
export async function auditStrategy(input, { runner = runBacktest } = {}) {
  const bars = validateBars(input.bars);
  validateSource(input.source);
  if (bars.length < 30 || bars.length > 10000)
    throw Error("Validation needs 30–10,000 settled bars.");
  const common = { ...input, bars, diagnostics: true, warmupBars: 0 };
  const baseline = await runner(common),
    prefix = [];
  for (const fraction of [0.5, 0.75]) {
    const n = Math.floor(bars.length * fraction),
      candidate = await runner({ ...common, bars: bars.slice(0, n) }),
      to = bars[n - 2].time;
    const plots = compareSeries(baseline.diagnostics, candidate.diagnostics, {
      to,
    });
    const equity = compareSeries(
      { equity: baseline.equity },
      { equity: candidate.equity },
      { to },
    );
    prefix.push({
      bars: n,
      through: to,
      differences: [...plots, ...equity].slice(0, 100),
    });
  }
  const recursive = [];
  for (const fraction of [0.25, 0.5]) {
    const start = Math.floor(bars.length * fraction),
      candidate = await runner({ ...common, bars: bars.slice(start) }),
      from = bars.at(-5).time;
    recursive.push({
      startupBars: bars.length - start,
      differences: compareSeries(baseline.diagnostics, candidate.diagnostics, {
        from,
      }),
    });
  }
  return {
    kind: "Sampled prefix invariance and startup sensitivity",
    createdAt: Date.now(),
    bars: bars.length,
    prefix,
    recursive,
    plotCount: Object.keys(baseline.diagnostics ?? {}).length,
    status: prefix.some((p) => p.differences.length)
      ? "differences detected"
      : "no sampled prefix differences",
    warnings: [
      "This samples two boundaries and up to 20 numeric plots; it cannot prove absence of lookahead or repainting.",
      "Last-bar-dependent plots and viewport logic can produce intentional differences.",
      "Startup sensitivity measures plot differences; position-dependent equity is excluded from that check.",
    ],
  };
}
