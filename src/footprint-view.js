const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const num = (value, d = 8) =>
  Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";
const utc = (at) =>
  new Date(at).toISOString().replace("T", " ").replace(".000Z", " UTC");
const duration = {
  "1m": 60000,
  "5m": 300000,
  "15m": 900000,
  "1h": 3600000,
  "4h": 14400000,
  "1d": 86400000,
};
export const newFootprintState = () => ({
  follow: true,
  time: null,
  levelOffset: 0,
  profileOffset: 0,
  scope: "range",
});
export function footprintControls(s) {
  return `<div class="searchbar footprint-settings"><label>Imbalance ratio<input id="imbalance-ratio" type="number" min="1" max="100" step=".1" value="${s.imbalanceRatio ?? 3}"></label><label>Minimum side size<input id="imbalance-min" type="number" min="0" step="any" value="${s.minImbalanceVolume ?? 0}"></label><label>Stack length<input id="imbalance-stack" type="number" min="2" max="20" value="${s.stackLength ?? 3}"></label><label>Zero denominator<select id="imbalance-zero"><option value="exclude" ${s.zeroDenominator !== "flag" ? "selected" : ""}>Exclude</option><option value="flag" ${s.zeroDenominator === "flag" ? "selected" : ""}>Flag positive size</option></select></label><label>Value area %<input id="value-area-percent" type="number" min="1" max="100" step="any" value="${s.valueAreaPercent ?? 70}"></label></div><p class="footnote">Apply changes with Recompute. Buy compares to sells one bucket below; sell compares to buys one bucket above. Size uses supplied trade units; Binance spot uses base-asset size.</p>`;
}
export function readFootprintSettings() {
  return {
    imbalanceRatio: Number(document.getElementById("imbalance-ratio").value),
    minImbalanceVolume: Number(document.getElementById("imbalance-min").value),
    stackLength: Number(document.getElementById("imbalance-stack").value),
    zeroDenominator: document.getElementById("imbalance-zero").value,
    valueAreaPercent: Number(
      document.getElementById("value-area-percent").value,
    ),
  };
}
function selected(flow, s) {
  return s.follow
    ? flow.bars.length - 1
    : flow.bars.findIndex((b) => b.time === s.time);
}
function areaText(area) {
  return area
    ? `POC ${num(area.poc)} · VAL ${num(area.low)} · VAH ${num(area.high)} · ${num(area.actualPercent, 2)}% achieved (${num(area.targetPercent)}% target)`
    : "No volume value area available.";
}
export function footprintResults(flow, s) {
  if (!flow) return "";
  const index = selected(flow, s),
    bar = flow.bars[index],
    gaps = flow.gaps ?? [];
  const barGaps = bar
    ? gaps.filter(
        (g) =>
          (g.from == null ||
            g.from < bar.time + duration[flow.settings?.timeframe ?? "1h"]) &&
          (g.to == null || g.to >= bar.time),
      )
    : [];
  const rows = bar?.levels ?? [],
    profile = s.scope === "bar" ? rows : flow.profile,
    area = s.scope === "bar" ? bar?.valueArea : flow.valueArea;
  const offset = Math.min(
    s.levelOffset,
    Math.max(0, Math.floor((rows.length - 1) / 100) * 100),
  );
  const po = Math.min(
    s.profileOffset,
    Math.max(0, Math.floor((profile.length - 1) / 100) * 100),
  );
  s.levelOffset = offset;
  s.profileOffset = po;
  const peak = Math.max(1e-300, ...profile.map((l) => l.buy + l.sell));
  const ratio = (r, side) =>
    r[side + "Ratio"] !== null && r[side + "Ratio"] !== undefined
      ? num(r[side + "Ratio"], 2) + "×"
      : r[side + "Zero"] && r[side] > 0
        ? "÷0"
        : "—";
  const sizeClass = (r, side) =>
    r[side + "Stack"]
      ? "stacked " + side
      : r[side + "Imbalance"]
        ? "imbalanced " + side
        : "";
  const cfg = flow.settings;
  return `${cfg ? `<p id="flow-applied" class="footnote">Applied: ${esc(flow.symbol)} · ${esc(cfg.timeframe)} · price bucket ${num(cfg.tickSize)} · ratio ≥${num(cfg.imbalanceRatio)}× · minimum side size ${num(cfg.minImbalanceVolume)} · stack ${cfg.stackLength} · zero denominator ${esc(cfg.zeroDenominator)} · VA ${num(cfg.valueAreaPercent)}%</p>` : ""}<div class="metrics"><div><span>Executed prints</span><strong>${num(flow.totalTrades, 0)}</strong></div><div><span>Aggressor buys</span><strong class="positive">${num(flow.buy)}</strong></div><div><span>Aggressor sells</span><strong class="negative">${num(flow.sell)}</strong></div><div><span>Net delta</span><strong>${num(flow.buy - flow.sell)}</strong></div><div><span>Range POC</span><strong>${num(flow.poc)}</strong></div></div>
 <div class="plot-card"><div class="panel-heading"><span>CUMULATIVE VOLUME DELTA</span><span>${esc(flow.origin ?? "Imported range")} · ${gaps.length} gap warnings</span></div><canvas id="cvd-plot"></canvas></div>
 <div class="searchbar footprint-navigation"><button id="footprint-oldest">Oldest</button><button id="footprint-prev" ${index <= 0 ? "disabled" : ""}>← Previous</button><label>Occupied bar<input id="footprint-index" aria-label="Footprint bar number" type="number" min="1" max="${flow.bars.length}" value="${index >= 0 ? index + 1 : ""}" placeholder="Not retained"></label><span>of ${flow.bars.length}</span><button id="footprint-next" ${index < 0 || index >= flow.bars.length - 1 ? "disabled" : ""}>Next →</button><label class="footprint-follow"><input type="checkbox" id="footprint-follow" ${s.follow ? "checked" : ""}> Follow latest</label></div>
 <p id="footprint-selection" class="footnote">${bar ? `${utc(bar.time)} · ${esc(flow.settings?.timeframe ?? "configured timeframe")} · ${num(bar.buyCount + bar.sellCount, 0)} prints · delta ${num(bar.delta)} · ${s.follow ? "following latest" : "pinned historical bar"}` : `Selected bar ${s.time ? utc(s.time) : ""} is outside the current retained data. Choose Oldest or Follow latest.`}</p>
 ${barGaps.length ? `<p class="footprint-gap">Incomplete trade coverage: ${barGaps.length} known gap(s) overlap this bar. Imbalances and value area use only observed trades.</p>` : ""}
 <div class="flow-grid"><section class="plot-card"><div class="panel-heading"><span>HISTORICAL FOOTPRINT</span><span>Sell / buy aggressor volume</span></div><p id="footprint-area" class="footnote">${areaText(bar?.valueArea)}</p>
 <div class="table-wrap footprint-table"><table><thead><tr><th>Price bucket</th><th>Sell</th><th>Buy</th><th>Delta</th><th>Sell ratio</th><th>Buy ratio</th></tr></thead><tbody>${rows
   .slice(offset, offset + 100)
   .map(
     (r) =>
       `<tr class="${bar.valueArea && r.price >= bar.valueArea.low && r.price < bar.valueArea.high ? "in-value-area" : ""}"><td>${num(r.price)}${r.price === bar.valueArea?.poc ? ' <span class="tag">POC</span>' : ""}</td><td class="${sizeClass(r, "sell")}" title="${r.sellStack ? "Stacked sell imbalance" : r.sellImbalance ? "Sell imbalance" : "Sell size"}">${num(r.sell)}${r.sellStack ? " <small>STACK</small>" : r.sellImbalance ? " <small>IMB</small>" : ""}</td><td class="${sizeClass(r, "buy")}" title="${r.buyStack ? "Stacked buy imbalance" : r.buyImbalance ? "Buy imbalance" : "Buy size"}">${num(r.buy)}${r.buyStack ? " <small>STACK</small>" : r.buyImbalance ? " <small>IMB</small>" : ""}</td><td>${num(r.buy - r.sell)}</td><td>${ratio(r, "sell")}</td><td>${ratio(r, "buy")}</td></tr>`,
   )
   .join("")}</tbody></table></div>
 <div class="footprint-pager"><button data-flow-rows="levels:-1" ${offset === 0 ? "disabled" : ""}>↑ Higher prices</button><span>${rows.length ? offset + 1 : 0}–${Math.min(offset + 100, rows.length)} of ${rows.length} occupied rows</span><button data-flow-rows="levels:1" ${offset + 100 >= rows.length ? "disabled" : ""}>Lower prices ↓</button></div>
 <p id="footprint-stacks" class="footnote">${bar?.stacks?.length ? bar.stacks.map((z) => `${z.side.toUpperCase()} stack: ${num(z.from)}–${num(z.to)} (${z.levels} buckets; upper edge exclusive)`).join(" · ") : "No qualifying stacks in the selected bar."}</p></section>
 <section class="plot-card"><div class="panel-heading"><span>VOLUME PROFILE</span><select id="profile-scope" aria-label="Profile scope"><option value="range" ${s.scope === "range" ? "selected" : ""}>Retained range</option><option value="bar" ${s.scope === "bar" ? "selected" : ""}>Selected bar</option></select></div><p id="profile-area" class="footnote">${areaText(area)}</p><div class="profile footprint-profile">${profile
   .slice(po, po + 100)
   .map(
     (r) =>
       `<div class="${area && r.price >= area.low && r.price < area.high ? "in-value-area" : ""}"><span>${num(r.price)}${r.price === area?.poc ? " · POC" : ""}</span><div class="profile-track"><i style="width:${(r.sell / peak) * 100}%;background:var(--red)"></i><i style="width:${(r.buy / peak) * 100}%;background:var(--green)"></i></div><small>${num(r.buy + r.sell)}</small></div>`,
   )
   .join(
     "",
   )}</div><div class="footprint-pager"><button data-flow-rows="profile:-1" ${po === 0 ? "disabled" : ""}>↑ Higher prices</button><span>${profile.length ? po + 1 : 0}–${Math.min(po + 100, profile.length)} of ${profile.length}</span><button data-flow-rows="profile:1" ${po + 100 >= profile.length ? "disabled" : ""}>Lower prices ↓</button></div></section></div>
 <p class="footnote">${esc(flow.symbol)} · ${utc(flow.from)} — ${utc(flow.to)} · ${esc(flow.status ?? "saved trades")}. CVD, imbalances and value areas cover observed retained trades only; an unflagged bar is not proof of complete coverage. VA uses nearest occupied rows, ties toward higher prices. Shading marks VA; VAH is the exclusive upper bucket edge. Empty price rows break stacks.</p>${gaps.length ? `<details class="footprint-gap"><summary>Known trade coverage gaps (${gaps.length})</summary><pre>${esc(JSON.stringify(gaps, null, 2))}</pre></details>` : ""}`;
}
export function bindFootprints({ flow, state: s, paint }) {
  if (!flow || !document.getElementById("footprint-index")) return;
  const select = (index) => {
    const bar = flow.bars[index];
    if (!bar) return;
    s.time = bar.time;
    s.follow = false;
    s.levelOffset = s.profileOffset = 0;
    paint();
  };
  document.getElementById("footprint-oldest").onclick = () => select(0);
  document.getElementById("footprint-prev").onclick = () =>
    select(selected(flow, s) - 1);
  document.getElementById("footprint-next").onclick = () =>
    select(selected(flow, s) + 1);
  document.getElementById("footprint-index").onchange = () => {
    const i = Number(document.getElementById("footprint-index").value) - 1;
    if (Number.isInteger(i)) select(i);
  };
  document.getElementById("footprint-follow").onchange = () => {
    s.follow = document.getElementById("footprint-follow").checked;
    if (!s.follow) s.time = flow.bars.at(-1).time;
    s.levelOffset = s.profileOffset = 0;
    paint();
  };
  document.getElementById("profile-scope").onchange = () => {
    s.scope = document.getElementById("profile-scope").value;
    s.profileOffset = 0;
    paint();
  };
  document.querySelectorAll("[data-flow-rows]").forEach(
    (el) =>
      (el.onclick = () => {
        const [kind, direction] = el.dataset.flowRows.split(":"),
          key = kind === "levels" ? "levelOffset" : "profileOffset";
        const idx = selected(flow, s),
          count =
            kind === "levels"
              ? (flow.bars[idx]?.levels.length ?? 0)
              : s.scope === "bar"
                ? (flow.bars[idx]?.levels.length ?? 0)
                : flow.profile.length;
        s[key] = Math.max(
          0,
          Math.min(
            Math.floor(Math.max(0, count - 1) / 100) * 100,
            s[key] + Number(direction) * 100,
          ),
        );
        paint();
      }),
  );
}
