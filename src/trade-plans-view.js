const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const num = (v) =>
  Number.isFinite(v)
    ? v.toLocaleString("en-US", { maximumFractionDigits: 8 })
    : "—";
const blank = () => ({
  name: "New trade plan",
  symbol: "BTCUSDT",
  venue: "Manual",
  currency: "USDT",
  side: "long",
  assetType: "spot",
  status: "draft",
  equity: 10000,
  riskPercent: 1,
  entry: "",
  stop: "",
  quantityStep: 0.00001,
  multiplier: 1,
  feePercent: 0.1,
  slippage: 0,
  maxNotional: 10000,
  targets: [
    { price: "", percent: 100 },
    { price: "", percent: 0 },
    { price: "", percent: 0 },
  ],
  notes: "",
  reference: null,
});
export const newPlansState = () => ({
  draft: blank(),
  editing: null,
  savedInput: null,
  estimate: null,
  list: [],
  error: "",
  loaded: false,
  loading: false,
});
export function retainPlanDraft(s) {
  if (!document.getElementById("trade-plan-view")) return;
  for (const key of Object.keys(s.draft)) {
    const el = document.getElementById("plan-" + key);
    if (el && "value" in el) s.draft[key] = el.value;
  }
  s.draft.targets = [0, 1, 2].map((i) => ({
    price: document.getElementById(`plan-target-${i}`).value,
    percent: document.getElementById(`plan-percent-${i}`).value,
  }));
}
export function primeTradePlan(s, dataset) {
  const last = dataset.bars.at(-1);
  s.draft = {
    ...blank(),
    name: `${dataset.symbol} plan`,
    symbol: dataset.symbol,
    venue: /Binance/i.test(dataset.origin) ? "Binance" : "Chart reference",
    currency: "",
    entry: last.close,
    reference: {
      symbol: dataset.symbol,
      origin: dataset.origin,
      time: last.time,
      price: last.close,
    },
  };
  s.editing = null;
  s.savedInput = null;
  s.estimate = null;
  s.error = "";
}
function inputDraft(d) {
  return {
    ...d,
    ...Object.fromEntries(
      [
        "equity",
        "riskPercent",
        "entry",
        "stop",
        "quantityStep",
        "multiplier",
        "feePercent",
        "slippage",
        "maxNotional",
      ].map((k) => [k, Number(d[k])]),
    ),
    targets: d.targets
      .filter((t) => String(t.price).trim() !== "" || Number(t.percent) !== 0)
      .map((t) => ({ price: Number(t.price), percent: Number(t.percent) })),
  };
}
function preview(e) {
  const p = e.input,
    levels = [
      { name: "Entry", price: p.entry, color: "var(--accent)" },
      { name: "Stop", price: p.stop, color: "var(--red)" },
      ...p.targets.map((t, i) => ({
        name: `Target ${i + 1}`,
        price: t.price,
        color: "var(--green)",
      })),
    ];
  const min = Math.min(...levels.map((l) => l.price)),
    max = Math.max(...levels.map((l) => l.price));
  return `<svg class="plan-levels" viewBox="0 0 600 250" role="img" aria-label="Planned entry, stop and target levels; not market data">${levels
    .map((l) => {
      const y = 25 + ((max - l.price) / (max - min)) * 200;
      return `<line x1="12" x2="380" y1="${y}" y2="${y}" stroke="${l.color}" stroke-width="2"/><text x="395" y="${y + 4}" fill="currentColor">${l.name} ${num(l.price)}</text>`;
    })
    .join("")}</svg>`;
}
function estimateView(s) {
  const e = s.estimate;
  if (!e)
    return '<p class="footnote">Enter your planned prices and assumptions, then Calculate. This is a planning worksheet; no orders or simulated fills are created.</p>';
  const p = e.input;
  return `<p id="plan-applied" class="footnote">Calculated assumptions: ${esc(p.symbol)} · ${esc(p.side)} · ${esc(p.currency)} · ${esc(p.assetType)} · multiplier ${num(p.multiplier)} · fee ${num(p.feePercent)}% per side · slippage ${num(p.slippage)} price units per fill.<br>Equity ${num(p.equity)} · risk ${num(p.riskPercent)}% · notional cap ${num(p.maxNotional)} · quantity increment ${num(p.quantityStep)}. Draft edits apply on Calculate or Save.</p><div class="metrics"><div><span>Quantity</span><strong>${num(e.quantity)}</strong></div><div><span>Stop-scenario risk (${esc(p.currency)})</span><strong>${num(e.risk)}</strong></div><div><span>Risk budget</span><strong>${num(e.riskBudget)}</strong></div><div><span>Entry notional</span><strong>${num(e.entryNotional)}</strong></div></div>${preview(e)}<p class="footnote">Assumed entry fill ${num(e.entryFill)} · stop fill ${num(e.stopFill)}. Net P&L if every target fills as planned: ${num(e.projectedReward)} ${esc(p.currency)} · reward/risk ${num(e.rewardRisk)}. This is a scenario, not a forecast.</p><div class="table-wrap"><table id="plan-target-results"><thead><tr><th>Target</th><th>Allocated quantity</th><th>Assumed fill</th><th>Net P&L</th><th>Level reward/risk</th></tr></thead><tbody>${e.targets.map((t, i) => `<tr><td>${i + 1} · ${t.percent}%</td><td>${num(t.quantity)}</td><td>${num(t.fill)}</td><td>${num(t.netReward)}</td><td>${num(t.rewardRisk)}</td></tr>`).join("")}</tbody></table></div>${e.warnings.length ? `<ul class="plan-warnings">${e.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}<p class="footnote">${esc(e.assumptions)}</p>`;
}
function listView(s) {
  return s.list.length
    ? `<div class="table-wrap"><table id="plan-list"><thead><tr><th>Plan</th><th>Market / side</th><th>Status</th><th>Saved risk</th><th>Revision</th><th></th></tr></thead><tbody>${s.list.map((r) => `<tr><td>${esc(r.estimate.input.name)}</td><td>${esc(r.estimate.input.symbol)} · ${esc(r.estimate.input.side)}</td><td>${esc(r.estimate.input.status)}</td><td>${num(r.estimate.risk)} ${esc(r.estimate.input.currency)}</td><td>${r.revision}</td><td><button data-plan-open="${r.id}">Open</button></td></tr>`).join("")}</tbody></table></div>`
    : '<p class="footnote">No saved plans. Create one here or start from the chart.</p>';
}
export function plansView(s) {
  const d = s.draft;
  const field = (key, label, extra = "") =>
    `<label>${label}<input id="plan-${key}" ${extra} value="${esc(d[key])}"></label>`;
  return `<section id="trade-plan-view"><div class="page-intro"><span class="eyebrow">PLAN BEFORE THE TRADE</span><h1>Define the risk. Size the idea.</h1><p>Local trade plans for spot and linear price exposure. Account equity and cash amounts are manual assumptions in one quote currency.</p></div><div class="searchbar"><button id="plan-new">New plan</button><button id="plan-refresh">Refresh saved plans</button><span id="plan-editing" class="footnote">${s.editing ? `Editing saved revision ${s.editing.revision}` : "Unsaved draft"}</span></div><div class="plan-columns"><section class="plot-card plan-form"><div class="panel-heading"><span>PLAN ASSUMPTIONS</span></div><div class="plan-fields">${field("name", "Plan name", 'maxlength="100"')}${field("symbol", "Symbol", 'maxlength="40"')}${field("venue", "Venue / source", 'maxlength="60"')}${field("currency", "Quote currency (all cash values)", 'maxlength="12" placeholder="Confirm currency"')}<label>Direction<select id="plan-side"><option value="long" ${d.side === "long" ? "selected" : ""}>Long</option><option value="short" ${d.side === "short" ? "selected" : ""}>Short</option></select></label><label>Exposure model<select id="plan-assetType"><option value="spot" ${d.assetType === "spot" ? "selected" : ""}>Spot · multiplier 1</option><option value="linear" ${d.assetType === "linear" ? "selected" : ""}>Linear contract</option></select></label>${field("entry", "Entry price", 'type="number" step="any"')}${field("stop", "Stop price", 'type="number" step="any"')}${field("equity", "Assumed account equity", 'type="number" step="any"')}${field("riskPercent", "Risk budget (%)", 'type="number" step="any"')}${field("maxNotional", "Maximum entry notional", 'type="number" step="any"')}${field("quantityStep", "Quantity increment", 'type="number" step="any"')}${field("multiplier", "Contract multiplier", 'type="number" step="any"')}${field("feePercent", "Fee per side (%)", 'type="number" step="any"')}${field("slippage", "Adverse slippage per fill (price units)", 'type="number" step="any"')}<label>Plan status<select id="plan-status"><option value="draft" ${d.status === "draft" ? "selected" : ""}>Draft</option><option value="archived" ${d.status === "archived" ? "selected" : ""}>Archived</option></select></label></div><p class="footnote">Targets must progress beyond entry and allocations total 100%. Leave unused target prices blank and their allocation at 0. Rounding remainder goes to the last target.</p><div class="plan-target-inputs">${d.targets.map((t, i) => `<label>Target ${i + 1} price<input id="plan-target-${i}" type="number" step="any" value="${esc(t.price)}"></label><label>Allocation %<input id="plan-percent-${i}" type="number" min="0" max="100" value="${esc(t.percent)}"></label>`).join("")}</div><label class="plan-notes">Notes<textarea id="plan-notes" maxlength="4000">${esc(d.notes)}</textarea></label><p id="plan-reference" class="footnote">${d.reference ? `Chart reference: ${esc(d.reference.symbol)} · ${esc(d.reference.origin)} · settled bar ${new Date(d.reference.time).toISOString()} · close ${num(d.reference.price)}. This is not a fresh executable quote.` : "Manual prices; no live quote is attached."}</p><div class="searchbar"><button id="plan-calculate">Calculate</button><button id="plan-save" class="primary">${s.editing ? "Save changes" : "Save plan"}</button><button id="plan-export" ${!s.estimate ? "disabled" : ""}>Export calculation</button>${s.editing ? '<button id="plan-delete">Delete saved plan</button>' : ""}</div><p id="plan-error" role="alert">${esc(s.error)}</p></section><section class="plot-card"><div class="panel-heading"><span>SIZING SCENARIO</span><span>Planning only</span></div><div id="plan-result">${estimateView(s)}</div></section></div><section class="plot-card"><div class="panel-heading"><span>SAVED PLANS</span><span>Up to 200 · draft and archived</span></div><div id="plans-saved">${listView(s)}</div></section></section>`;
}
export function bindPlans({ state: s, call, task, render, exportFile }) {
  if (!document.getElementById("trade-plan-view")) return;
  const draw = () => {
    if (!document.getElementById("trade-plan-view")) return;
    document.getElementById("plan-result").innerHTML = estimateView(s);
    document.getElementById("plans-saved").innerHTML = listView(s);
    document.getElementById("plan-error").textContent = s.error;
    document.getElementById("plan-export").disabled = !s.estimate;
    bindList();
  };
  const operation = (fn) =>
    task(async () => {
      try {
        await fn();
        s.error = "";
      } catch (e) {
        s.error =
          e.message +
          " Draft inputs have been preserved." +
          (s.estimate
            ? " The displayed calculation is the previous successful estimate."
            : "");
      }
      draw();
    });
  const open = async (id) => {
    const r = await call("planGet", { id });
    s.editing = { id: r.id, revision: r.revision };
    s.savedInput = structuredClone(r.estimate.input);
    s.draft = structuredClone(r.estimate.input);
    while (s.draft.targets.length < 3)
      s.draft.targets.push({ price: "", percent: 0 });
    s.estimate = r.estimate;
    s.error = "";
    replace();
  };
  // Remove the old form before render can recapture it into the new draft.
  const replace = () => {
    document.getElementById("trade-plan-view")?.remove();
    render();
  };
  const bindList = () =>
    document.querySelectorAll("[data-plan-open]").forEach(
      (el) =>
        (el.onclick = () =>
          operation(async () => {
            retainPlanDraft(s);
            if (
              JSON.stringify(inputDraft(s.draft)) !==
                JSON.stringify(s.savedInput ?? inputDraft(blank())) &&
              !confirm("Discard unsaved draft edits and open this saved plan?")
            )
              return;
            await open(el.dataset.planOpen);
          })),
    );
  const refresh = async () => {
    s.list = await call("planList");
    s.loaded = true;
  };
  document.getElementById("plan-refresh").onclick = () => operation(refresh);
  document.getElementById("plan-new").onclick = () =>
    operation(async () => {
      retainPlanDraft(s);
      if (
        JSON.stringify(inputDraft(s.draft)) !==
          JSON.stringify(s.savedInput ?? inputDraft(blank())) &&
        !confirm("Start a new plan and discard the current draft?")
      )
        return;
      s.draft = blank();
      s.savedInput = null;
      s.editing = null;
      s.estimate = null;
      s.error = "";
      replace();
    });
  document.getElementById("plan-calculate").onclick = () =>
    operation(async () => {
      retainPlanDraft(s);
      s.estimate = await call("planEstimate", { input: inputDraft(s.draft) });
    });
  document.getElementById("plan-save").onclick = () =>
    operation(async () => {
      retainPlanDraft(s);
      const r = await call("planSave", {
        input: inputDraft(s.draft),
        ...(s.editing
          ? { id: s.editing.id, expectedRevision: s.editing.revision }
          : {}),
      });
      s.editing = { id: r.id, revision: r.revision };
      s.savedInput = structuredClone(r.estimate.input);
      s.estimate = r.estimate;
      await refresh();
      replace();
    });
  document.getElementById("plan-export").onclick = () =>
    operation(() =>
      exportFile(
        "trade-plan.json",
        JSON.stringify({ calculation: s.estimate }, null, 2),
      ),
    );
  const del = document.getElementById("plan-delete");
  if (del)
    del.onclick = () =>
      operation(async () => {
        if (!confirm("Delete this saved trade plan permanently?")) return;
        await call("planDelete", {
          id: s.editing.id,
          expectedRevision: s.editing.revision,
        });
        s.editing = null;
        s.savedInput = null;
        await refresh();
        replace();
      });
  bindList();
  if (!s.loaded && !s.loading) {
    s.loading = true;
    call("planList")
      .then((list) => {
        s.list = list;
        s.loaded = true;
        draw();
      })
      .catch((e) => {
        s.error = e.message;
        draw();
      })
      .finally(() => {
        s.loading = false;
      });
  }
}
