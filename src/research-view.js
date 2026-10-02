const $ = (s) => document.querySelector(s),
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const n = (v) =>
  Number.isFinite(v)
    ? v.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "—";
export function newResearchState() {
  return {
    kind: "sweep",
    grid: '{"Fast length":[8,12,20],"Slow length":[20,26,40]}',
    inputs: "{}",
    objective: "netProfit",
    trainBars: "200",
    testBars: "100",
    folds: "3",
    warmupBars: "100",
    session: "",
    audit: null,
    job: null,
    saved: [],
    comparison: null,
    selected: [],
  };
}
export function retainResearchDraft(r) {
  for (const key of [
    "kind",
    "grid",
    "inputs",
    "objective",
    "trainBars",
    "testBars",
    "folds",
    "warmupBars",
    "session",
  ]) {
    const field = $(`#research-${key}`);
    if (field) r[key] = field.value;
  }
  if (document.querySelector("[data-compare-run]"))
    r.selected = [
      ...document.querySelectorAll("[data-compare-run]:checked"),
    ].map((el) => el.dataset.compareRun);
}
export function researchView(r, runs) {
  const job = r.job,
    result = job?.result;
  return `<section id="research-panel" class="plot-card research-panel"><div class="panel-heading"><span>PARAMETER RESEARCH</span><span>Settled candles · saved snapshots</span></div><div class="edge-form"><label>Study<select id="research-kind"><option value="sweep" ${r.kind === "sweep" ? "selected" : ""}>Parameter sweep</option><option value="walkForward" ${r.kind === "walkForward" ? "selected" : ""}>Walk-forward</option></select></label><label>Training objective<select id="research-objective"><option value="netProfit" ${r.objective === "netProfit" ? "selected" : ""}>Maximize closed net profit</option><option value="maxDrawdown" ${r.objective === "maxDrawdown" ? "selected" : ""}>Minimize equity drawdown</option></select></label><label>Train bars<input id="research-trainBars" type="number" min="20" value="${esc(r.trainBars)}"></label><label>Test bars<input id="research-testBars" type="number" min="10" value="${esc(r.testBars)}"></label><label>Folds<input id="research-folds" type="number" min="1" max="10" value="${esc(r.folds)}"></label></div><div class="edge-form"><label class="edge-preset">Pine input grid (JSON arrays)<textarea id="research-grid" spellcheck="false">${esc(r.grid)}</textarea></label><label class="edge-preset">Base inputs for single runs and studies (JSON)<textarea id="research-inputs" spellcheck="false">${esc(r.inputs)}</textarea></label></div><details class="learning-note"><summary>Validation and calendar settings</summary><label>Historical warmup bars<input id="research-warmupBars" type="number" min="0" max="5000" value="${esc(r.warmupBars)}"></label><label>Session calendar JSON (blank for continuous markets)<textarea id="research-session" placeholder='{"timeZone":"America/New_York","startMinute":570,"endMinute":960,"weekdays":[1,2,3,4,5],"closedDates":[]}'>${esc(r.session)}</textarea></label><p>Warmup bars precede the test period; entry orders remain blocked. Supply holidays and early closes for session markets.</p></details><div class="edge-form"><button id="strategy-audit">Validate bias & warmup</button><button id="research-start" class="primary" ${job?.status === "running" ? "disabled" : ""}>Start study</button><button id="research-cancel" ${job?.status === "running" ? "" : "disabled"}>Cancel study</button><button id="research-export" ${result ? "" : "disabled"}>Export study ↓</button><select id="research-saved" aria-label="Saved research"><option value="">Saved studies (${r.saved.length})</option>${r.saved.map((j) => `<option value="${esc(j.id)}">${esc(j.kind)} · ${esc(j.status)} · ${esc(new Date(j.createdAt).toISOString())}</option>`).join("")}</select></div><p class="footnote">Grid keys are unique Pine input titles or IDs. Up to 25 combinations, 100 executions and 180 seconds per study. Ranking excludes errors and zero-closed-trade candidates. Walk-forward uses rolling training and disjoint fresh-start test windows, with configurable historical warmup; entries are blocked before each test boundary.</p><div id="research-progress" role="status">${job ? `${esc(job.status)} · ${job.completed}/${job.total} executions${job.error ? ` · ${esc(job.error)}` : ""}` : "No study running."}</div>${r.audit ? `<details open class="learning-note"><summary>Strategy validation · ${esc(r.audit.result.status)}</summary><p>${r.audit.result.prefix.reduce((n, p) => n + p.differences.length, 0)} sampled prefix differences · ${r.audit.result.recursive.reduce((n, p) => n + p.differences.length, 0)} startup plot differences.</p><p>${esc(r.audit.result.warnings.join(" "))}</p><pre>${esc(JSON.stringify(r.audit.result, null, 2))}</pre></details>` : ""}${result ? studyResult(job) : ""}</section><section class="plot-card research-panel"><div class="panel-heading"><span>COMPARE SAVED RUNS</span><span>Equity as return on starting capital</span></div><div class="run-choices">${runs.map((run) => `<label><input type="checkbox" data-compare-run="${esc(run.id)}" ${r.selected.includes(run.id) ? "checked" : ""}>${esc(run.result.title)} · ${esc(run.dataset.symbol)} · ${esc(new Date(run.createdAt).toISOString())} · net ${n(run.result.metrics.netProfit)}</label>`).join("") || '<p class="footnote">Save at least two backtest runs to compare.</p>'}</div><div class="edge-form"><button id="compare-runs">Compare selected runs</button><button id="compare-export" ${r.comparison ? "" : "disabled"}>Export comparison ↓</button></div>${r.comparison ? comparisonView(r.comparison) : ""}</section>`;
}
function studyResult(job) {
  const r = job.result;
  return `<p class="edge-disclaimer">${esc(r.note)}</p>${r.kind === "sweep" ? `<div class="table-wrap"><table><thead><tr><th>Rank</th><th>Inputs</th><th>Net profit</th><th>Drawdown</th><th>Trades</th><th>Win rate</th><th>Open</th><th>Inspect</th></tr></thead><tbody>${r.candidates.map((c) => `<tr><td>${r.ranking.includes(c.index) ? r.ranking.indexOf(c.index) + 1 : "Unranked"}</td><td><code>${esc(JSON.stringify(c.inputs))}</code></td>${c.result ? `<td>${n(c.result.metrics.netProfit)}</td><td>${n(c.result.metrics.maxDrawdown)}</td><td>${c.result.metrics.totalTrades}</td><td>${n(c.result.metrics.winRate)}%</td><td>${c.result.openTrades.length}</td><td><button data-study-run="${c.index}">Save & open run</button></td>` : `<td colspan="6">${esc(c.error)}</td>`}</tr>`).join("")}</tbody></table></div>` : `<div class="edge-form"><strong>Out-of-sample closed net P&L: ${n(r.totalClosedNetProfit)}</strong><span>${r.totalClosedTrades} closed trades · ${r.unusedBars} unused trailing bars</span><span>Stitched modeled return ${n(r.stitchedEquity?.returnPercent)}% (independent resets)</span></div><div class="table-wrap"><table><thead><tr><th>Fold</th><th>Train / test UTC</th><th>Selected inputs</th><th>Training net</th><th>Test net</th><th>Test drawdown</th><th>Trades / open</th><th>Inspect</th></tr></thead><tbody>${r.folds.map((f) => `<tr><td>${f.index + 1}</td><td>${esc(new Date(f.trainFrom).toISOString())} — ${esc(new Date(f.trainTo).toISOString())}<br>${esc(new Date(f.testFrom).toISOString())} — ${esc(new Date(f.testTo).toISOString())}</td><td><code>${esc(JSON.stringify(f.inputs))}</code></td><td>${n(f.trainingMetrics.netProfit)}</td><td>${n(f.testResult.metrics.netProfit)}</td><td>${n(f.testResult.metrics.maxDrawdown)}</td><td>${f.testResult.metrics.totalTrades} / ${f.testResult.openTrades.length}</td><td><button data-study-fold="${f.index}">Save & open test</button></td></tr>`).join("")}</tbody></table></div>`}<details class="edge-registry"><summary>Study provenance, errors and full results</summary><pre>${esc(JSON.stringify(job, null, 2))}</pre></details>`;
}
function comparisonView(c) {
  return `<p class="edge-disclaimer">${esc(c.note)}</p><div class="table-wrap"><table><thead><tr><th>Run</th><th>Net closed P&L</th><th>Equity return</th><th>Drawdown (%)</th><th>Trades</th><th>Costs & inputs</th></tr></thead><tbody>${c.runs.map((r, i) => `<tr><td><span style="color:${["#63dfbd", "#69c9ec", "#f4bd78", "#c792ea", "#f17789", "#ffffff"][i]}">●</span> ${esc(r.title)} · ${esc(r.symbol)}</td><td>${n(r.metrics.netProfit)}</td><td>${n((r.metrics.equity / r.metrics.initialCapital - 1) * 100)}%</td><td>${n(r.metrics.maxDrawdownPercent)}</td><td>${r.metrics.totalTrades} closed / ${r.openPositions} open</td><td><code>${esc(JSON.stringify({ settings: r.settings, effectiveSettings: r.effectiveSettings, inputs: r.inputs }))}</code></td></tr>`).join("")}</tbody></table></div><canvas id="comparison-plot"></canvas><p class="footnote">UTC time alignment, normalized to each run’s starting capital; differing data ranges retain their actual dates.</p>`;
}
export function bindResearch({
  research: r,
  call,
  task,
  render,
  exportFile,
  start,
  onOpen,
}) {
  const on = (id, fn) => {
    const el = $(`#${id}`);
    if (el) el.onclick = () => task(fn);
  };
  on("research-start", start);
  on("strategy-audit", async () => {
    retainResearchDraft(r);
    r.audit = await call("strategyAudit", {
      source: document.querySelector("#source")?.value ?? r.currentSource,
      inputs: JSON.parse(r.inputs),
      settings: r.currentSettings,
    });
    render();
  });
  on("research-cancel", async () => {
    await call("researchCancel", { id: r.job.id });
  });
  on("research-export", () =>
    exportFile("pine-desk-study.json", JSON.stringify(r.job, null, 2)),
  );
  on("compare-runs", async () => {
    retainResearchDraft(r);
    r.selected = [
      ...document.querySelectorAll("[data-compare-run]:checked"),
    ].map((el) => el.dataset.compareRun);
    r.comparison = await call("compareRuns", { ids: r.selected });
    render();
  });
  on("compare-export", () =>
    exportFile(
      "pine-desk-comparison.json",
      JSON.stringify(r.comparison, null, 2),
    ),
  );
  if ($("#research-saved"))
    $("#research-saved").onchange = (event) =>
      task(async () => {
        if (event.target.value) {
          r.job = await call("researchGet", { id: event.target.value });
          render();
        }
      });
  document.querySelectorAll("[data-study-run],[data-study-fold]").forEach(
    (el) =>
      (el.onclick = () =>
        task(async () => {
          const run = await call("researchSaveRun", {
            id: r.job.id,
            ...(el.dataset.studyRun !== undefined
              ? { index: Number(el.dataset.studyRun) }
              : { fold: Number(el.dataset.studyFold) }),
          });
          await onOpen(run);
          render();
        })),
  );
}
export function paintComparison(comparison) {
  const canvas = $("#comparison-plot");
  if (!canvas || !comparison) return;
  const box = canvas.getBoundingClientRect(),
    dpr = devicePixelRatio;
  canvas.width = box.width * dpr;
  canvas.height = box.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const points = comparison.runs.flatMap((r) => r.equity);
  if (!points.length) return;
  let t0 = Infinity,
    t1 = -Infinity,
    min = 0,
    max = 0;
  for (const p of points) {
    t0 = Math.min(t0, p.time);
    t1 = Math.max(t1, p.time);
    min = Math.min(min, p.value);
    max = Math.max(max, p.value);
  }
  const pad = 48,
    w = box.width,
    h = box.height,
    x = (t) => pad + ((t - t0) / (t1 - t0 || 1)) * (w - pad - 18),
    y = (v) => h - pad - ((v - min) / (max - min || 1)) * (h - pad - 24);
  ctx.font = "11px monospace";
  for (let i = 0; i < 5; i++) {
    const v = min + ((max - min) * i) / 4;
    ctx.strokeStyle = "#24364a";
    ctx.beginPath();
    ctx.moveTo(pad, y(v));
    ctx.lineTo(w - 10, y(v));
    ctx.stroke();
    ctx.fillStyle = "#8ea2b8";
    ctx.fillText(`${n(v)}%`, 2, y(v));
  }
  comparison.runs.forEach((r, index) => {
    ctx.strokeStyle = [
      "#63dfbd",
      "#69c9ec",
      "#f4bd78",
      "#c792ea",
      "#f17789",
      "#ffffff",
    ][index];
    ctx.lineWidth = 2;
    ctx.beginPath();
    r.equity.forEach((p, i) =>
      i ? ctx.lineTo(x(p.time), y(p.value)) : ctx.moveTo(x(p.time), y(p.value)),
    );
    ctx.stroke();
  });
  ctx.fillStyle = "#8ea2b8";
  ctx.fillText(new Date(t0).toISOString().slice(0, 10), pad, h - 15);
  ctx.fillText(
    new Date(t1).toISOString().slice(0, 10),
    Math.max(pad, w - 105),
    h - 15,
  );
}
