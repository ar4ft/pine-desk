const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const num = (value) =>
  Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: 8 })
    : "—";
const utc = (value) =>
  value == null
    ? "none"
    : new Date(value).toISOString().replace("T", " ").replace("Z", " UTC");
export function tpoResults(s) {
  const r = s.result;
  if (!r)
    return '<div class="empty-state"><h2>See price through time.</h2><p>Choose a session or range and compute TPO from imported trades or the existing live buffer. Each letter means a price bucket was observed in one period, irrespective of traded volume.</p></div>';
  const { settings: c, coverage: v, valueArea: a, initialBalance: ib } = r;
  return `<p id="vp-applied" class="footnote">Calculated ${utc(r.calculatedAt)} · ${esc(r.symbol)} · ${esc(r.origin)} · ${esc(c.mode)} · bucket ${num(c.tickSize)} · ${c.periodMinutes}-minute TPO periods · ${c.valueAreaPercent}% TPO value area<br>Applied window: ${utc(c.from)} ≤ time &lt; ${utc(c.to)} (end exclusive). Snapshot; press Compute to refresh.</p>
  <div class="metrics"><div><span>Total TPOs</span><strong>${num(r.totalTpos)}</strong></div><div><span>Occupied periods</span><strong>${r.occupiedPeriods} / ${r.periods.length}</strong></div><div><span>One-period rows</span><strong>${num(r.onePeriodRows)}</strong></div><div><span>Observed prints</span><strong>${num(r.totalTrades)}</strong></div></div>
  <p id="vp-coverage" class="footprint-gap">Retained source: ${utc(v.retainedFrom)} — ${utc(v.retainedTo)}.<br>Observed in window: ${utc(v.observedFrom)} — ${utc(v.observedTo)}.<br>${v.startsBeforeRetained ? "Requested start precedes retained trades. " : ""}${v.endsAfterRetained ? "Requested end extends beyond retained trades. " : ""}${v.gaps.length} known overlapping gap(s). ${esc(v.note)}</p>
  <section class="plot-card"><div class="panel-heading"><span>OBSERVED-TRADE TPO PROFILE</span><button id="vp-export">Export result JSON</button></div><p id="vp-area" class="footnote">${a ? `TPO POC ${num(a.poc)} · VAL ${num(a.low)} · VAH ${num(a.high)} · ${num(a.actualPercent)}% of TPOs (${num(a.targetPercent)}% target)` : "No trades in the requested window; no TPO value area."}</p>
  <div class="table-wrap footprint-table"><table id="tpo-table"><thead><tr><th>Price bucket</th><th>TPO count</th><th>Observed periods</th></tr></thead><tbody>${r.profile
    .slice(s.offset, s.offset + 100)
    .map(
      (l) =>
        `<tr class="${a && l.price >= a.low && l.price < a.high ? "in-value-area" : ""}"><td>${num(l.price)}${l.price === a?.poc ? ' <span class="tag">POC</span>' : ""}</td><td>${l.count}${l.count === 1 ? " <small>ONE PERIOD</small>" : ""}</td><td><div class="tpo-letters">${l.periods.map((i) => `<span class="tpo-letter" title="${esc(r.periods[i].label)}: ${utc(r.periods[i].from)} to ${utc(r.periods[i].to)} (exclusive)${r.periods[i].knownGaps ? " · known coverage gap" : ""}">${esc(r.periods[i].label)}</span>`).join("")}</div></td></tr>`,
    )
    .join("")}</tbody></table></div>
  <div class="footprint-pager"><button id="vp-higher" ${s.offset === 0 ? "disabled" : ""}>↑ Higher prices</button><span id="vp-page">${r.profile.length ? s.offset + 1 : 0}–${Math.min(s.offset + 100, r.profile.length)} of ${r.profile.length} occupied rows</span><button id="vp-lower" ${s.offset + 100 >= r.profile.length ? "disabled" : ""}>Lower prices ↓</button></div>
  <p class="footnote">One TPO per observed price bucket per period; repeat prints, size and side do not add TPOs. Letters run A–Z, AA–AZ, BA… from the requested start. No prices are filled between a period's high and low. POC/value area use TPO counts, with ties toward higher prices; VAH is exclusive. One-period rows include extremes and are not automatically trading signals.</p></section>
  <section class="plot-card"><div class="panel-heading"><span>OBSERVED INITIAL BALANCE</span><span>First ${c.initialBalanceMinutes} minutes${ib.clipped ? " · clipped to requested window" : ""}</span></div><p id="tpo-ib" class="footnote">${ib.totalTrades ? `Low ${num(ib.low)} · high ${num(ib.high)} (exclusive bucket edge) · ${num(ib.totalTrades)} prints` : "No observed trades in the initial-balance interval; range unavailable."}<br>${utc(ib.from)} ≤ time &lt; ${utc(ib.to)}<br>${ib.coverage.startsBeforeRetained ? "Initial balance starts before retained trades. " : ""}${ib.coverage.endsAfterRetained ? "Initial balance ends after retained trades. " : ""}${ib.coverage.gaps.length} known overlapping gap(s). Observed range only; incomplete coverage can understate its extent.</p></section>
  <details class="plot-card tpo-periods"><summary>Period times and coverage (${r.periods.length})</summary><p class="footnote">Periods are anchored to the requested start. Empty periods are retained in this list; zero observed trades does not prove the market was inactive. A partial period is shorter because the requested end cuts it off.</p><div class="table-wrap footprint-table"><table><thead><tr><th>Letter</th><th>UTC start / exclusive end</th><th>Prints</th><th>TPOs</th><th>Coverage</th></tr></thead><tbody>${r.periods.map((p) => `<tr><td>${esc(p.label)}</td><td>${utc(p.from)}<br>${utc(p.to)}</td><td>${p.totalTrades}</td><td>${p.tpoCount}</td><td>${[p.partial ? "Partial interval" : "", !p.totalTrades ? "No observed trades" : "", p.startsBeforeRetained ? "Starts before retention" : "", p.endsAfterRetained ? "Ends after retention" : "", p.knownGaps ? `${p.knownGaps} known gap(s)` : ""].filter(Boolean).join(" · ") || "Observed; completeness unverified"}</td></tr>`).join("")}</tbody></table></div></details>
  ${v.gaps.length ? `<details class="footprint-gap"><summary>Known trade gaps</summary><pre>${esc(JSON.stringify(v.gaps, null, 2))}</pre></details>` : ""}`;
}
