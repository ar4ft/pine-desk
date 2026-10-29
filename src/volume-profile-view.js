import { tpoResults } from "./tpo-view.js";
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
export function newVolumeProfileState(kind = "volume") {
  const date = new Date().toISOString().slice(0, 10);
  return {
    kind,
    draft: {
      ...(kind === "tpo"
        ? { periodMinutes: 30, initialBalanceMinutes: 60 }
        : {}),
      source: "imported",
      mode: "session",
      tickSize: 10,
      valueAreaPercent: 70,
      sessionDate: date,
      sessionOpen: "00:00",
      sessionMinutes: 1440,
      from: date + "T00:00",
      to: new Date(Date.parse(date + "T00:00:00Z") + 86400000)
        .toISOString()
        .slice(0, 16),
    },
    result: null,
    offset: 0,
    error: "",
  };
}
export function retainVolumeProfileDraft(s) {
  if (
    document.getElementById("volume-profile-view")?.dataset.profileKind !==
    s.kind
  )
    return;
  for (const key of Object.keys(s.draft)) {
    const input = document.getElementById("vp-" + key);
    if (input) s.draft[key] = input.value;
  }
}
function resultView(s) {
  if (s.kind === "tpo") return tpoResults(s);
  const r = s.result;
  if (!r)
    return '<div class="empty-state"><h2>Choose the time window.</h2><p>Import trades under Executed trades, or use the existing Binance live buffer. Compute a profile to see volume at price.</p></div>';
  const { settings: c, coverage: v, valueArea: a } = r;
  const peak = Math.max(1e-300, ...r.profile.map((l) => l.buy + l.sell));
  const rows = r.profile.slice(s.offset, s.offset + 100);
  return `<p id="vp-applied" class="footnote">Calculated ${utc(r.calculatedAt)} · ${esc(r.symbol)} · ${esc(r.origin)} · ${esc(c.mode)} · bucket ${num(c.tickSize)} · VA ${num(c.valueAreaPercent)}%<br>Applied window: ${utc(c.from)} ≤ time &lt; ${utc(c.to)} (end exclusive). Snapshot; press Compute to refresh.</p>
  <div class="metrics"><div><span>Observed prints</span><strong>${num(r.totalTrades)}</strong></div><div><span>Buy volume</span><strong class="positive">${num(r.buy)}</strong></div><div><span>Sell volume</span><strong class="negative">${num(r.sell)}</strong></div><div><span>Delta</span><strong>${num(r.delta)}</strong></div></div>
  <p id="vp-coverage" class="footprint-gap">Retained source: ${utc(v.retainedFrom)} — ${utc(v.retainedTo)}.<br>Observed in window: ${utc(v.observedFrom)} — ${utc(v.observedTo)}.<br>${v.startsBeforeRetained ? "Requested start precedes retained trades. " : ""}${v.endsAfterRetained ? "Requested end extends beyond retained trades. " : ""}${v.gaps.length} known overlapping gap(s). ${esc(v.note)}</p>
  <section class="plot-card"><div class="panel-heading"><span>${c.mode === "session" ? "SESSION" : "ANCHORED"} VOLUME PROFILE</span><button id="vp-export">Export result JSON</button></div><p id="vp-area" class="footnote">${a ? `POC ${num(a.poc)} · VAL ${num(a.low)} · VAH ${num(a.high)} · ${num(a.actualPercent)}% achieved (${num(a.targetPercent)}% target)` : "No trades in the requested window; no value area."}</p>
  <div class="table-wrap footprint-table"><table id="vp-table"><thead><tr><th>Price bucket</th><th>Sell / buy volume</th><th>Sell</th><th>Buy</th><th>Total</th><th>Delta</th></tr></thead><tbody>${rows.map((l) => `<tr class="${a && l.price >= a.low && l.price < a.high ? "in-value-area" : ""}"><td>${num(l.price)}${l.price === a?.poc ? ' <span class="tag">POC</span>' : ""}</td><td><div class="profile-track"><i style="width:${(l.sell / peak) * 100}%;background:var(--red)"></i><i style="width:${(l.buy / peak) * 100}%;background:var(--green)"></i></div></td><td>${num(l.sell)}</td><td>${num(l.buy)}</td><td>${num(l.buy + l.sell)}</td><td>${num(l.buy - l.sell)}</td></tr>`).join("")}</tbody></table></div>
  <div class="footprint-pager"><button id="vp-higher" ${s.offset === 0 ? "disabled" : ""}>↑ Higher prices</button><span id="vp-page">${r.profile.length ? s.offset + 1 : 0}–${Math.min(s.offset + 100, r.profile.length)} of ${r.profile.length} occupied rows</span><button id="vp-lower" ${s.offset + 100 >= r.profile.length ? "disabled" : ""}>Lower prices ↓</button></div><p class="footnote">Red: sells · green: buys · shading: value area. Size uses supplied trade units; Binance spot uses base-asset size. POC and expansion ties choose higher price; expansion visits nearest occupied rows. VAH is the exclusive upper bucket edge.</p></section>
  ${v.gaps.length ? `<details class="footprint-gap"><summary>Known gaps</summary><pre>${esc(JSON.stringify(v.gaps, null, 2))}</pre></details>` : ""}`;
}
export function volumeProfileView(s) {
  const d = s.draft,
    tpo = s.kind === "tpo";
  return `<section id="volume-profile-view" data-profile-kind="${s.kind}"><div class="page-intro"><span class="eyebrow">${tpo ? "TIME AT PRICE" : "VOLUME THROUGH A CHOSEN WINDOW"}</span><h1>${tpo ? "See where price returned." : "Find where trading concentrated."}</h1><p>${tpo ? "Observed-trade TPO profiles: each price bucket counts once per period. Separate time occupancy from traded volume." : "Session and anchored profiles from executed trades. Fixed UTC sessions keep opening times and overnight boundaries explicit."}</p></div>
  <div class="searchbar footprint-settings"><label>Source<select id="vp-source"><option value="imported" ${d.source === "imported" ? "selected" : ""}>Imported / saved trades</option><option value="live" ${d.source === "live" ? "selected" : ""}>Live Binance retained window</option></select></label><label>Mode<select id="vp-mode"><option value="session" ${d.mode === "session" ? "selected" : ""}>UTC session</option><option value="anchored" ${d.mode === "anchored" ? "selected" : ""}>Anchored range</option></select></label><label>Price bucket<input id="vp-tickSize" type="number" step="any" min="0" value="${esc(d.tickSize)}"></label><label>Value area %<input id="vp-valueAreaPercent" type="number" min="1" max="100" value="${esc(d.valueAreaPercent)}"></label></div>
  <div id="vp-session-fields" ${d.mode !== "session" ? "hidden" : ""}><div class="searchbar footprint-settings"><button id="vp-previous">← Previous day</button><label>Session opening date (UTC)<input id="vp-sessionDate" type="date" min="1970-01-01" value="${esc(d.sessionDate)}"></label><button id="vp-next">Next day →</button><label>Open (UTC)<input id="vp-sessionOpen" type="time" value="${esc(d.sessionOpen)}"></label><label>Duration (minutes)<input id="vp-sessionMinutes" type="number" min="1" max="1440" value="${esc(d.sessionMinutes)}"></label></div></div>
  <div id="vp-anchor-fields" ${d.mode !== "anchored" ? "hidden" : ""}><div class="searchbar footprint-settings"><label>Anchor start (UTC, inclusive)<input id="vp-from" type="datetime-local" step="1" value="${esc(d.from)}"></label><label>End (UTC, exclusive)<input id="vp-to" type="datetime-local" step="1" value="${esc(d.to)}"></label></div></div>
  ${tpo ? `<div class="searchbar footprint-settings"><label>TPO period (minutes)<input id="vp-periodMinutes" type="number" min="1" max="240" value="${esc(d.periodMinutes)}"></label><label>Initial balance (minutes)<input id="vp-initialBalanceMinutes" type="number" min="1" max="1440" value="${esc(d.initialBalanceMinutes)}"></label><span class="footnote">Up to 288 periods. Letter A begins at the requested start.</span></div>` : ""}
  <div class="searchbar"><button id="vp-compute" class="primary">Compute profile</button><span class="footnote">Changes apply on Compute. This view does not start or alter a feed.</span></div><p class="footnote">UTC only; exchange calendars, holidays and daylight-saving shifts are not applied. Adjust the UTC open when needed. Results use retained prints; an entire session may need a historical trade import.</p><p id="vp-error" role="alert">${esc(s.error)}</p><div id="vp-results">${resultView(s)}</div></section>`;
}
export function bindVolumeProfile({ state: s, call, task, exportFile }) {
  if (!document.getElementById("vp-compute")) return;
  const bindResults = () => {
    const higher = document.getElementById("vp-higher"),
      lower = document.getElementById("vp-lower");
    if (higher)
      higher.onclick = () => {
        s.offset = Math.max(0, s.offset - 100);
        paint();
      };
    if (lower)
      lower.onclick = () => {
        s.offset = Math.min(
          Math.floor(Math.max(0, s.result.profile.length - 1) / 100) * 100,
          s.offset + 100,
        );
        paint();
      };
    const exp = document.getElementById("vp-export");
    if (exp)
      exp.onclick = () =>
        task(() =>
          exportFile(
            s.kind === "tpo" ? "tpo-profile.json" : "volume-profile.json",
            JSON.stringify(s.result, null, 2),
          ),
        );
  };
  const paint = () => {
    const target = document.getElementById("vp-results");
    if (target) {
      target.innerHTML = resultView(s);
      bindResults();
    }
  };
  document.getElementById("vp-mode").onchange = () => {
    retainVolumeProfileDraft(s);
    document.getElementById("vp-session-fields").hidden =
      s.draft.mode !== "session";
    document.getElementById("vp-anchor-fields").hidden =
      s.draft.mode !== "anchored";
  };
  for (const [id, step] of [
    ["vp-previous", -1],
    ["vp-next", 1],
  ])
    document.getElementById(id).onclick = () => {
      const el = document.getElementById("vp-sessionDate"),
        date = Date.parse(el.value + "T00:00:00Z") + step * 86400000;
      if (
        Number.isFinite(date) &&
        date >= 0 &&
        date <= Date.parse("9999-12-31T00:00:00Z")
      )
        el.value = new Date(date).toISOString().slice(0, 10);
      retainVolumeProfileDraft(s);
    };
  document.getElementById("vp-compute").onclick = () =>
    task(async () => {
      retainVolumeProfileDraft(s);
      const d = { ...s.draft },
        parts = d.sessionOpen.split(":");
      const args = {
        source: d.source,
        mode: d.mode,
        tickSize: Number(d.tickSize),
        valueAreaPercent: Number(d.valueAreaPercent),
        ...(s.kind === "tpo"
          ? {
              periodMinutes: Number(d.periodMinutes),
              initialBalanceMinutes: Number(d.initialBalanceMinutes),
            }
          : {}),
        ...(d.mode === "session"
          ? {
              sessionDate: d.sessionDate,
              sessionOpen:
                parts.length === 2
                  ? Number(parts[0]) * 60 + Number(parts[1])
                  : NaN,
              sessionMinutes: Number(d.sessionMinutes),
            }
          : { from: Date.parse(d.from + "Z"), to: Date.parse(d.to + "Z") }),
      };
      try {
        const result = await call(
          s.kind === "tpo" ? "tpoProfile" : "volumeProfile",
          args,
        );
        s.result = result;
        s.offset = 0;
        s.error = "";
        paint();
      } catch (e) {
        s.error =
          "Not applied: " +
          e.message +
          (s.result
            ? " The displayed result is the previous calculation."
            : "");
      }
      const error = document.getElementById("vp-error");
      if (error) error.textContent = s.error;
    });
  bindResults();
}
