const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const n = (v) =>
  Number.isFinite(v)
    ? v.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "—";
const raw = (r) =>
  `<details class="plot-card edge-registry"><summary>Complete upstream response & provenance</summary><pre>${esc(JSON.stringify(r, null, 2))}</pre></details>`;
export function newWhaleState() {
  return {
    config: { endpoint: "http://127.0.0.1:8788/mcp", source: "unverified" },
    status: null,
    events: null,
    detail: null,
    analytics: null,
    draft: { ticker: "NVDA", kind: "", side: "", premium: "0", expiry: "" },
  };
}
export function retainWhaleDraft(w) {
  for (const k of Object.keys(w.draft)) {
    const el = $(`#whale-${k}`);
    if (el) w.draft[k] = el.value;
  }
}
export function whaleView(w) {
  const s = w.status?.result;
  return `<div id="whale-panel"><div class="page-intro"><span class="eyebrow">LUXALGO WHALE OPTIONS</span><h1>Follow the recorded options tape.</h1><p>Inspect classified events, their score components and per-leg quotes, alongside gamma exposure and recorded chain history.</p></div><div class="searchbar edge-form"><label class="edge-preset">Local MCP URL<input id="whale-endpoint" value="${esc(w.config.endpoint)}"></label><label>Engine source (your label)<select id="whale-source">${["unverified", "synthetic", "licensed", "recording"].map((x) => `<option ${w.config.source === x ? "selected" : ""}>${x}</option>`).join("")}</select></label><button id="whale-connect" class="primary">Connect / refresh</button><button data-link="https://github.com/ar4ft/pine-desk/blob/main/docs/whale-options.md">Setup guide ↗</button></div><p class="footnote">Source label is user supplied. Synthetic data is a demonstration. Licensed feeds require your own entitlements. A running engine heartbeat does not establish that data is real-time.</p>${
    s
      ? `<section class="plot-card"><div class="panel-heading"><span>RECORDER STATUS · ${esc(w.config.source.toUpperCase())}</span><span>${s.live_engine ? "Engine heartbeat active" : "No active engine heartbeat"}</span></div><div class="metrics"><div><span>Recorded ticks</span><strong>${n(s.ticks)}</strong></div><div><span>Emitted events</span><strong>${n(s.events)}</strong></div><div><span>Baseline sessions</span><strong>${n(s.baseline_sessions)}</strong></div><div><span>Last tick UTC</span><strong>${s.last_tick_ts ? esc(new Date(s.last_tick_ts).toISOString()) : "None"}</strong></div></div><p class="footnote">${s.cold_start ? "COLD START: baselines are thin; score components can be missing." : "Check event-level cold-start flags and missing score components."} Available chains: ${esc((s.chains_available ?? []).map((c) => c.underlying).join(", ") || "None")}.</p></section><section class="plot-card edge-query-builder"><div class="panel-heading"><span>RECORDED FLOW & CHAIN ANALYTICS</span></div><div class="edge-form"><label>Ticker<input id="whale-ticker" value="${esc(w.draft.ticker)}"></label><label>Kind<select id="whale-kind">${["", "sweep", "block", "split", "print"].map((x) => `<option value="${x}" ${w.draft.kind === x ? "selected" : ""}>${x || "All kinds"}</option>`).join("")}</select></label><label>Side<select id="whale-side">${["", "buy", "sell", "mid", "unknown"].map((x) => `<option value="${x}" ${w.draft.side === x ? "selected" : ""}>${x || "All sides"}</option>`).join("")}</select></label><label>Min premium ($)<input id="whale-premium" type="number" min="0" value="${esc(w.draft.premium)}"></label><button id="whale-recent" class="primary">Recent events</button><button id="whale-top">Top scores</button></div><div class="edge-form"><label>Expiry (optional)<input id="whale-expiry" type="date" value="${esc(w.draft.expiry)}"></label>${[
          ["gex", "Gamma ladder"],
          ["oiDeltas", "OI changes"],
          ["maxPain", "Max pain"],
          ["ivRank", "IV history"],
          ["netFlow", "Net premium"],
        ]
          .map(
            ([op, label]) =>
              `<button data-whale-analysis="${op}">${label}</button>`,
          )
          .join(
            "",
          )}<button id="whale-export">Export JSON ↓</button></div><p class="footnote">Scores summarize classification inputs, not probabilities. Sides reflect NBBO comparison at print time; unknown sides remain unknown. Only emitted events enter these lists.</p></section>${w.events ? eventsView(w.events) : ""}${w.detail ? `<section class="plot-card edge-registry"><div class="panel-heading"><span>EVENT AUDIT · ${esc(w.detail.result.id)}</span></div><p class="footnote">Classification reasons, score weights, missing components and NBBO at each print are preserved below.</p><pre>${esc(JSON.stringify(w.detail.result, null, 2))}</pre></section>` : ""}${w.analytics ? analyticsView(w.analytics) : ""}${raw(w.status)}`
      : `<div class="empty-state"><span class="empty-icon">◉</span><h2>Connect your local flight recorder.</h2><p>Start the official Whale Options engine and HTTP MCP server.<br>The setup guide includes a synthetic feed requiring no market-data keys.</p></div>`
  }</div>`;
}
function eventsView(response) {
  const events = response.result.events ?? [];
  return `<section class="plot-card edge-sessions"><div class="panel-heading"><span>RECORDED EVENTS</span><span>${events.length} returned</span></div><div class="table-wrap"><table><thead><tr><th>UTC</th><th>Underlying</th><th>Contract</th><th>Kind / side</th><th>Premium</th><th>Score</th><th>Audit</th></tr></thead><tbody>${events.map((e) => `<tr><td>${esc(new Date(e.ts).toISOString())}</td><td>${esc(e.underlying)}</td><td>${esc(e.contract)}</td><td>${esc(e.kind)} / ${esc(e.side)}</td><td>$${n(e.premium)}</td><td>${n(typeof e.score === "number" ? e.score : e.score?.total)}${e.cold_start ? " · cold start" : ""}</td><td><button data-whale-event="${esc(e.id)}">Inspect →</button></td></tr>`).join("")}</tbody></table></div>${events.length ? "" : '<p class="footnote">No qualifying events. Check recorder status, filters and source coverage.</p>'}</section>${raw(response)}`;
}
function analyticsView(response) {
  const r = response.result,
    g = r.gex;
  return `<section class="plot-card edge-group-table"><div class="panel-heading"><span>${g ? "GAMMA EXPOSURE" : "CHAIN / FLOW ANALYTICS"}</span></div>${g ? `<p class="edge-disclaimer">${esc(g.conventionNote)} · Convention: ${esc(g.convention)} · Snapshot age: ${r.snapshot_age_ms < 0 ? "future timestamp — verify engine clock / synthetic replay time" : `${n(r.snapshot_age_ms / 1000)} seconds`}.</p><p class="footnote">Dealer positioning is assumed. Total GEX: ${n(g.totalGex)}. Zero gamma: ${n(g.zeroGamma?.level)} (${esc(g.zeroGamma?.method ?? "unavailable")}). Skipped contracts: ${n(g.skippedContracts)}.</p><div class="table-wrap"><table><thead><tr><th>Strike</th><th>Call GEX</th><th>Put GEX</th><th>Net GEX</th><th>Call OI</th><th>Put OI</th></tr></thead><tbody>${(g.perStrike ?? []).map((x) => `<tr>${["strike", "callGex", "putGex", "netGex", "callOi", "putOi"].map((k) => `<td>${n(x[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="edge-disclaimer">${esc(r.note ?? "Read the response notes and recorded history window before interpreting these values.")}</p><pre>${esc(JSON.stringify(r, null, 2))}</pre>`}</section>${raw(response)}`;
}
export function bindWhale({ whale: w, call, task, render, exportFile }) {
  if (!$("#whale-panel")) return;
  const on = (id, fn) => {
    const el = $(`#${id}`);
    if (el) el.onclick = () => task(fn);
  };
  on("whale-connect", async () => {
    retainWhaleDraft(w);
    w.config = await call("whaleConfigure", {
      endpoint: $("#whale-endpoint").value,
      source: $("#whale-source").value,
    });
    w.status = null;
    w.events = null;
    w.detail = null;
    w.analytics = null;
    try {
      w.status = await call("whaleStatus");
    } finally {
      render();
    }
  });
  const read = (op) => async () => {
    retainWhaleDraft(w);
    const premium = Number(w.draft.premium);
    if (!Number.isFinite(premium) || premium < 0)
      throw new Error("Premium floor must be nonnegative.");
    const args =
      op === "Recent"
        ? {
            ...(w.draft.ticker ? { ticker: w.draft.ticker } : {}),
            ...(w.draft.kind ? { kind: w.draft.kind } : {}),
            ...(w.draft.side ? { side: w.draft.side } : {}),
            min_premium: premium,
            limit: 100,
          }
        : {
            ...(w.draft.ticker ? { tickers: [w.draft.ticker] } : {}),
            min_score: 0,
            limit: 50,
          };
    w.events = await call(`whale${op}`, args);
    w.detail = null;
    render();
  };
  on("whale-recent", read("Recent"));
  on("whale-top", read("Top"));
  document.querySelectorAll("[data-whale-event]").forEach(
    (el) =>
      (el.onclick = () =>
        task(async () => {
          retainWhaleDraft(w);
          w.detail = await call("whaleEvent", { id: el.dataset.whaleEvent });
          render();
        })),
  );
  document.querySelectorAll("[data-whale-analysis]").forEach(
    (el) =>
      (el.onclick = () =>
        task(async () => {
          retainWhaleDraft(w);
          const op = el.dataset.whaleAnalysis;
          const args =
            op === "netFlow"
              ? {}
              : {
                  underlying: w.draft.ticker,
                  ...(["gex", "maxPain"].includes(op) && w.draft.expiry
                    ? { expiry: w.draft.expiry }
                    : {}),
                };
          w.analytics = await call(
            `whale${op[0].toUpperCase() + op.slice(1)}`,
            args,
          );
          render();
        })),
  );
  on("whale-export", () =>
    exportFile(
      "pine-desk-whale-options.json",
      JSON.stringify(
        {
          status: w.status,
          events: w.events,
          detail: w.detail,
          analytics: w.analytics,
        },
        null,
        2,
      ),
    ),
  );
}
