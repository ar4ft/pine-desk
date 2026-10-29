const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const num = (n) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: 8 })
    : "—";
export function tradeFilterControls(prefix, s) {
  return `<label>Minimum print size<input id="${prefix}-minTradeSize" type="number" min="0" step="any" value="${esc(s.minTradeSize ?? 0)}"></label><label>Maximum print size<input id="${prefix}-maxTradeSize" type="number" min="0" step="any" placeholder="No maximum" value="${esc(s.maxTradeSize ?? "")}"></label>`;
}
export function readTradeFilters(prefix) {
  const max = document.getElementById(prefix + "-maxTradeSize").value;
  return {
    minTradeSize: Number(
      document.getElementById(prefix + "-minTradeSize").value,
    ),
    maxTradeSize: max.trim() === "" ? null : Number(max),
  };
}
export function tradeFilterSummary(f) {
  return f
    ? `<p class="footnote trade-filter-summary">Applied print-size filter: ${num(f.minTradeSize)} ≤ size${f.maxTradeSize === null ? " (no maximum)" : ` ≤ ${num(f.maxTradeSize)}`} · ${num(f.matchedTrades)} matching / ${num(f.observedTrades)} observed · ${num(f.excludedTrades)} excluded by size. Bounds apply to each print before aggregation, in supplied size units (Binance spot: base asset). Coverage timestamps and gaps describe unfiltered observations.</p>`
    : "";
}
export function compositeSessions(r) {
  if (r.settings.mode !== "composite") return "";
  const utc = (t) =>
    t == null
      ? "none"
      : new Date(t).toISOString().replace("T", " ").replace("Z", " UTC");
  return `<details id="vp-sessions" class="plot-card tpo-periods" open><summary>Included sessions (${r.sessions.length})</summary><p class="footnote">Only the listed [start, end) intervals contribute. Weekdays refer to UTC opening dates. Volumes are summed, without equal-day weighting. Empty sessions remain visible. Coverage and observed counts precede size filtering.</p><div class="table-wrap footprint-table"><table><thead><tr><th>UTC opening date / interval</th><th>Matching / observed</th><th>Buy / sell</th><th>Delta</th><th>Coverage</th></tr></thead><tbody>${r.sessions.map((w) => `<tr><td>${esc(w.sessionDate)}<br>${utc(w.from)}<br>${utc(w.to)} (exclusive)</td><td>${num(w.totalTrades)} / ${num(w.observedTrades)}</td><td>${num(w.buy)} / ${num(w.sell)}</td><td>${num(w.delta)}</td><td>${w.coverage.startsBeforeRetained ? "Starts before retained data. " : ""}${w.coverage.endsAfterRetained ? "Ends after retained data. " : ""}${w.coverage.gaps.length} known gap(s). ${w.observedTrades ? `${utc(w.coverage.observedFrom)} — ${utc(w.coverage.observedTo)}` : "No observed trades."} Completeness unverified.</td></tr>`).join("")}</tbody></table></div></details>`;
}
