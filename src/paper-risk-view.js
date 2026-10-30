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
    : "Off";
const fields = {
  maxOrderCost: "Maximum order cost (USDT)",
  maxSymbolCost: "Maximum cost per market (USDT)",
  maxTotalCost: "Maximum total committed cost (USDT)",
  maxMarkets: "Maximum open / pending markets",
  dailyLossLimit: "Daily losing-trade budget (USDT · UTC)",
};
export function loadRiskDraft(s) {
  s.riskBase = JSON.stringify(s.account.risk);
  s.riskDraft = { ...s.account.risk };
}
export function retainRiskDraft(s) {
  if (!document.getElementById("paper-risk-save")) return;
  for (const key of Object.keys(fields))
    s.riskDraft[key] = document.getElementById(`paper-risk-${key}`).value;
  s.riskDraft.pauseBuys = document.getElementById(
    "paper-risk-pauseBuys",
  ).checked;
}
export function riskStatus(s) {
  const a = s.account,
    u = a?.riskUsage,
    r = a?.risk;
  if (!u || !r) return "";
  return `<div class="panel-heading"><span>ENTRY RISK · ${r.pauseBuys ? "BUYS PAUSED" : "BUYS ENABLED"}</span><span>Saved policy · persists after restart</span></div><div class="metrics paper-metrics"><div><span>Committed cost / cap · USDT</span><strong>${num(u.totalCost)} / ${num(r.maxTotalCost)}</strong></div><div><span>Open + pending markets / cap</span><strong>${u.markets} / ${num(r.maxMarkets)}</strong></div><div><span>Losing exits / budget · ${esc(u.day)} UTC</span><strong>${num(u.dailyLoss)} / ${num(r.dailyLossLimit)}</strong></div><div><span>Order / market cost caps · USDT</span><strong>${num(r.maxOrderCost)} / ${num(r.maxSymbolCost)}</strong></div></div>${r.dailyLossLimit !== null && u.dailyLoss >= r.dailyLossLimit ? '<p class="paper-monitor-error">Daily loss budget reached. New buys are blocked until the next UTC day or a policy change. Sell exits remain available.</p>' : ""}<p class="footnote">Held cost basis plus pending buy reservations, including fees. This does not cap market value or unrealized losses. Daily usage sums realized losing exits; profits do not replenish it. Sell exits and cancellations remain available. A blocked pending buy rejects when its price condition next qualifies; no position is liquidated automatically.</p>`;
}
export function riskView(s) {
  if (!s.account) return "";
  if (!s.riskDraft) loadRiskDraft(s);
  const d = s.riskDraft;
  return `<section class="plot-card" id="paper-risk"><div id="paper-risk-status">${riskStatus(s)}</div><details id="paper-risk-editor"><summary>Edit entry risk limits</summary><p class="footnote">Blank caps are off. Fields are drafts until saved. Lower limits do not cancel orders immediately or force exits.</p><div class="plan-fields"><label class="paper-risk-toggle"><input id="paper-risk-pauseBuys" type="checkbox" ${d.pauseBuys ? "checked" : ""}> Pause all new buy entries</label>${Object.entries(
    fields,
  )
    .map(
      ([key, label]) =>
        `<label>${label}<input id="paper-risk-${key}" type="number" min="${key === "maxMarkets" ? "1" : "0"}" step="${key === "maxMarkets" ? "1" : "any"}" value="${esc(d[key])}"></label>`,
    )
    .join(
      "",
    )}</div><div class="searchbar"><button id="paper-risk-save">Save risk limits</button><button id="paper-risk-load">Load saved limits</button></div></details></section>`;
}
export function bindRisk({ s, operation, call }) {
  const save = document.getElementById("paper-risk-save");
  if (!save) return;
  save.onclick = () =>
    operation(async () => {
      retainRiskDraft(s);
      if (s.riskBase !== JSON.stringify(s.account.risk))
        throw Error(
          "Risk limits changed elsewhere. Load saved limits before editing again.",
        );
      const policy = { pauseBuys: s.riskDraft.pauseBuys };
      for (const key of Object.keys(fields)) {
        const v = s.riskDraft[key];
        policy[key] = v === "" || v === null ? null : Number(v);
      }
      s.account = await call("paperSetRisk", {
        expectedRevision: s.account.revision,
        policy,
      });
      loadRiskDraft(s);
      s.message = "Risk limits saved. Sell exits remain available.";
    });
  document.getElementById("paper-risk-load").onclick = () =>
    operation(async () => {
      s.account = await call("paperSnapshot");
      loadRiskDraft(s);
      for (const key of Object.keys(fields))
        document.getElementById(`paper-risk-${key}`).value =
          s.riskDraft[key] ?? "";
      document.getElementById("paper-risk-pauseBuys").checked =
        s.riskDraft.pauseBuys;
      s.message = "Saved risk limits loaded; draft edits replaced.";
    });
}
