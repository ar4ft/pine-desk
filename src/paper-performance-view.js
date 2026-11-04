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
const date = (v) =>
  v === null
    ? "Open"
    : new Date(v)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, " UTC");
const duration = (ms) =>
  ms === null
    ? "—"
    : ms < 60000
      ? `${num(ms / 1000)}s`
      : ms < 3600000
        ? `${num(ms / 60000)}m`
        : `${num(ms / 3600000)}h`;
const draft = (s) => (s.performanceDraft ??= { symbol: "", from: "", to: "" });
function filter(s) {
  const d = draft(s),
    args = {};
  if (d.symbol.trim()) args.symbol = d.symbol.trim().toUpperCase();
  for (const key of ["from", "to"]) {
    if (!d[key]) continue;
    const at = Date.parse(`${d[key]}T00:00:00Z`);
    if (
      !Number.isFinite(at) ||
      new Date(at).toISOString().slice(0, 10) !== d[key]
    )
      throw Error("Choose valid UTC dates for the close-time filter.");
    args[key] = at;
  }
  if (args.from !== undefined && args.to !== undefined && args.from >= args.to)
    throw Error("Close date From must be earlier than Before (exclusive).");
  return args;
}
export function paperPerformanceStatus(s) {
  if (!s.performance)
    return "Load an analysis of the saved fill ledger. This does not fetch quotes or enable monitoring.";
  let changed = false;
  try {
    changed =
      JSON.stringify(filter(s)) !== JSON.stringify(s.performance.filter);
  } catch {
    changed = true;
  }
  return `Loaded account r${s.performance.accountRevision}.${s.account?.revision !== s.performance.accountRevision ? " Account changed: refresh to include newer orders/fills." : ""}${changed ? " Draft filters differ from the loaded analysis. Apply filters to update results." : ""} Exports contain this loaded snapshot.`;
}
function curve(points) {
  if (!points.length)
    return '<p class="footnote">No completed trades in this close-time window.</p>';
  const values = [0, ...points.map((p) => p.cumulativePnl)],
    min = Math.min(...values),
    max = Math.max(...values),
    pad = (max - min || 1) * 0.08;
  const x = (i) => 85 + (i / points.length) * 895,
    y = (v) => 210 - ((v - (min - pad)) / (max - min + 2 * pad)) * 180;
  let path = `M${x(0)},${y(0)}`;
  const dots = points
    .map((p, i) => {
      path += `H${x(i + 1)}V${y(p.cumulativePnl)}`;
      return `<circle cx="${x(i + 1)}" cy="${y(p.cumulativePnl)}" r="2"><title>${date(p.closedAt)} · ${num(p.cumulativePnl)} USDT cumulative closed P&amp;L · trade ${esc(p.tradeId.slice(0, 8))}</title></circle>`;
    })
    .join("");
  return `<svg class="paper-history-chart paper-performance-chart" viewBox="0 0 1000 245" role="img" aria-label="Cumulative completed-trade net P&L, not account equity; horizontal axis is trade closure sequence"><g class="history-axis">${[min, (min + max) / 2, max].map((v) => `<line x1="85" x2="980" y1="${y(v)}" y2="${y(v)}"/><text x="77" y="${y(v) + 4}" text-anchor="end">${num(v)}</text>`).join("")}<text x="85" y="238">0 · before selected closes</text><text x="980" y="238" text-anchor="end">${points.length} completed trades · closure order</text></g><path d="${path}"/>${dots}</svg>`;
}
function body(s) {
  const p = s.performance;
  if (!p)
    return '<p class="footnote">A trade starts with a buy from zero holdings and completes when that market returns to zero. Scale-ins, partial exits and overlapping plans stay together.</p>';
  const m = p.summary,
    r = p.reconciliation;
  const metric = (label, value) =>
    `<div><span>${label}</span><strong>${value}</strong></div>`;
  return `<p class="footnote">Applied scope: ${esc(p.filter.symbol ?? "All markets")} · closes from ${p.filter.from === undefined ? "account start" : date(p.filter.from)} · before ${p.filter.to === undefined ? "no end date" : date(p.filter.to)} (exclusive). ${m.closedCount} selected of ${p.totals.closedCount} completed trades.</p><div class="metrics paper-metrics">${metric("Completed · wins / losses / breakeven", `${m.closedCount} · ${m.wins} / ${m.losses} / ${m.breakeven}`)}${metric("Completed net P&L · USDT", num(m.netPnl))}${metric("Win rate · includes breakeven", m.winRatePercent === null ? "—" : `${num(m.winRatePercent)}%`)}${metric("Profit factor · net winners / net losers", m.profitFactor === null ? (m.closedCount ? "No losing trades" : "—") : num(m.profitFactor))}${metric("Expectancy · USDT per completed trade", num(m.expectancy))}${metric("Mean winning / losing trade · USDT", `${num(m.averageWin)} / ${num(m.averageLoss)}`)}${metric("Completed-trade fees · USDT", num(m.fees))}${metric("Average completed holding time", duration(m.averageHoldingMs))}</div>${curve(m.curve)}<p class="footnote">Completed-trade P&amp;L curve, reset to zero before selected closes; not account equity. Maximum decline in this curve: ${num(m.maxClosedPnlDrawdown)} USDT. Best / worst completed trade: ${num(m.bestTrade)} / ${num(m.worstTrade)} USDT. Longest winning / losing streak: ${m.maxWinningStreak} / ${m.maxLosingStreak}; breakeven breaks a streak.</p><p class="footnote">${p.openSummary.count} open trades for the selected market scope, regardless of the date window: ${num(p.openSummary.realizedPnl)} USDT realized from partial exits; ${num(p.openSummary.remainingCost)} USDT remaining cost basis. Open trades are excluded from completed-trade statistics. No unrealized P&amp;L is inferred.</p><details class="paper-performance-method"><summary>Method and reconciliation</summary><p class="footnote">${esc(p.method)} Return on buy cost divides completed net P&amp;L by all entry outlays including fees; it is not a portfolio or annualized return. Tiny numeric residuals within each trade's exported tolerance classify as breakeven; raw P&amp;L is retained.</p><p class="footnote">Whole account before filters: ${num(r.closedRealizedPnl)} completed + ${num(r.openRealizedPnl)} open realized = ${num(r.accountRealizedPnl)} ledger realized P&amp;L (difference ${num(r.delta)} USDT). ${p.totals.fillCount} fills. This view derives from the saved account and does not change it.</p></details><div class="searchbar"><label>Trade list<select id="paper-performance-tab"><option value="closed" ${s.performanceTab !== "open" ? "selected" : ""}>Completed trades</option><option value="open" ${s.performanceTab === "open" ? "selected" : ""}>Open trades · all dates</option></select></label></div><div id="paper-performance-rows">${rows(s)}</div><div id="paper-performance-detail">${detail(s)}</div>`;
}
function rows(s) {
  const open = s.performanceTab === "open",
    list = open ? s.performance.openTrades : s.performance.closedTrades;
  const pages = Math.max(1, Math.ceil(list.length / 100));
  s.performancePage = Math.min(s.performancePage ?? 0, pages - 1);
  const end = list.length - s.performancePage * 100;
  return `<div class="searchbar"><button id="paper-performance-newer" ${s.performancePage === 0 ? "disabled" : ""}>Newer</button><button id="paper-performance-older" ${s.performancePage + 1 >= pages ? "disabled" : ""}>Older</button><span>Page ${s.performancePage + 1} / ${pages} · ${list.length} trades · up to 100 per page</span></div><div class="table-wrap"><table id="paper-performance-table"><thead><tr><th>Market / trade</th><th>Opened / closed</th><th>Bought / sold / remaining</th><th>Realized P&amp;L / fees · USDT</th><th>${open ? "Remaining cost · USDT" : "Return on total buy cost"}</th></tr></thead><tbody>${
    list
      .slice(Math.max(0, end - 100), end)
      .reverse()
      .map(
        (t) =>
          `<tr><td>${esc(t.symbol)}<small>${esc(t.id.slice(0, 8))} · ${open ? "open" : esc(t.outcome)}</small><button data-paper-trade="${t.id}">Inspect fills</button></td><td>${date(t.openedAt)}<small>${date(t.closedAt)}${open ? "" : ` · ${duration(t.holdingMs)}`}</small></td><td>${num(t.buyQuantity)} / ${num(t.sellQuantity)} / ${num(t.quantity)}</td><td>${num(t.realizedPnl)}<small>Fees ${num(t.fees)} · ${t.fills.length} fills</small></td><td>${open ? num(t.remainingCost) : `${num(t.returnOnBuyCostPercent)}%`}</td></tr>`,
      )
      .join("") || '<tr><td colspan="5">No matching trades.</td></tr>'
  }</tbody></table></div>`;
}
function detail(s) {
  const t = [...s.performance.closedTrades, ...s.performance.openTrades].find(
    (t) => t.id === s.performanceTrade,
  );
  if (!t)
    return '<p class="footnote">Inspect a trade to see every contributing fill, its source plan and its journal review.</p>';
  const pages = Math.max(1, Math.ceil(t.fills.length / 100));
  s.performanceFillPage = Math.min(s.performanceFillPage ?? 0, pages - 1);
  const start = s.performanceFillPage * 100;
  return `<div class="panel-heading"><span>${esc(t.symbol)} · ${esc(t.status)} trade · ${esc(t.id.slice(0, 8))}</span><span>${t.fills.length} fills · ledger order</span></div><p class="footnote">Overlapping entries share this position cycle; these are not separate per-plan trades. Existing fill reviews keep their own revisions. Review fill opens that fill's journal editor and replaces its current draft.</p><div class="searchbar"><button id="paper-performance-fill-prev" ${s.performanceFillPage === 0 ? "disabled" : ""}>Earlier fills</button><button id="paper-performance-fill-next" ${s.performanceFillPage + 1 >= pages ? "disabled" : ""}>Later fills</button><span>Fill page ${s.performanceFillPage + 1} / ${pages}</span></div><div class="table-wrap"><table id="paper-performance-fills"><thead><tr><th>Time / order</th><th>Side / quantity / price</th><th>Fee / realized · USDT</th><th>Source plan</th><th></th></tr></thead><tbody>${t.fills
    .slice(start, start + 100)
    .map(
      (f) =>
        `<tr><td>${date(f.at)}<small>${esc(f.orderId.slice(0, 8))}</small></td><td>${esc(f.side)} ${num(f.quantity)} @ ${num(f.price)}</td><td>${num(f.fee)}<small>${f.side === "sell" ? `${num(f.realizedPnl)} realized` : "Entry cost added"}</small></td><td>${f.plan ? `${esc(f.plan.name)} · r${f.plan.revision}` : "Manual order"}${f.parentId ? `<small>Linked ${esc(f.leg)} · ${esc(f.parentId.slice(0, 8))}</small>` : ""}</td><td><button data-performance-review="${f.orderId}">Review fill</button></td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}
export function paperPerformanceView(s) {
  if (!s.account) return "";
  const d = draft(s);
  return `<section class="plot-card" id="paper-performance"><div class="panel-heading"><span>COMPLETED TRADES & PERFORMANCE</span><span>Flat to flat · after fees</span></div><div class="searchbar"><label>Market (blank for all)<input id="paper-performance-symbol" type="text" placeholder="BTCUSDT" value="${esc(d.symbol)}"></label><label>Close from · UTC<input id="paper-performance-from" type="date" value="${esc(d.from)}"></label><label>Close before · UTC, exclusive<input id="paper-performance-to" type="date" value="${esc(d.to)}"></label><button id="paper-performance-load">Load / apply filters</button><button id="paper-performance-json" ${s.performance ? "" : "disabled"}>Export loaded JSON</button><button id="paper-performance-csv" ${s.performance ? "" : "disabled"}>Export trades CSV</button></div><p class="footnote" id="paper-performance-status" role="status">${esc(paperPerformanceStatus(s))}</p><div id="paper-performance-body">${body(s)}</div></section>`;
}
export function bindPaperPerformance({
  s,
  call,
  operation,
  exportFile,
  reviewFill,
}) {
  if (!document.getElementById("paper-performance")) return;
  const status = () => {
    document.getElementById("paper-performance-status").textContent =
      paperPerformanceStatus(s);
  };
  const bindDetail = () => {
    for (const [id, delta] of [
      ["paper-performance-fill-prev", -1],
      ["paper-performance-fill-next", 1],
    ]) {
      const el = document.getElementById(id);
      if (el)
        el.onclick = () => {
          s.performanceFillPage += delta;
          paintDetail();
        };
    }
    document.querySelectorAll("[data-performance-review]").forEach(
      (el) =>
        (el.onclick = () =>
          operation(async () => {
            await reviewFill(el.dataset.performanceReview);
          })),
    );
  };
  const paintDetail = () => {
    document.getElementById("paper-performance-detail").innerHTML = detail(s);
    bindDetail();
  };
  const bindRows = () => {
    for (const [id, delta] of [
      ["paper-performance-newer", -1],
      ["paper-performance-older", 1],
    ])
      document.getElementById(id).onclick = () => {
        s.performancePage += delta;
        paintRows();
      };
    document.querySelectorAll("[data-paper-trade]").forEach(
      (el) =>
        (el.onclick = () => {
          s.performanceTrade = el.dataset.paperTrade;
          s.performanceFillPage = 0;
          paintDetail();
        }),
    );
  };
  const paintRows = () => {
    document.getElementById("paper-performance-rows").innerHTML = rows(s);
    bindRows();
  };
  const bindBody = () => {
    if (!s.performance) return;
    document.getElementById("paper-performance-tab").onchange = (e) => {
      s.performanceTab = e.target.value;
      s.performancePage = 0;
      paintRows();
    };
    bindRows();
    bindDetail();
  };
  for (const key of ["symbol", "from", "to"])
    document.getElementById(`paper-performance-${key}`).oninput = (e) => {
      draft(s)[key] = e.target.value;
      status();
    };
  document.getElementById("paper-performance-load").onclick = () =>
    operation(async () => {
      const report = await call("paperPerformance", filter(s));
      s.performance = report;
      s.performancePage = 0;
      s.performanceFillPage = 0;
      document.getElementById("paper-performance-body").innerHTML = body(s);
      bindBody();
      status();
      for (const format of ["json", "csv"])
        document.getElementById(`paper-performance-${format}`).disabled = false;
      s.message =
        "Paper performance loaded from saved fills; monitoring was not started.";
    });
  for (const format of ["json", "csv"])
    document.getElementById(`paper-performance-${format}`).onclick = () =>
      operation(async () => {
        const p = s.performance;
        if (!p) throw Error("Load performance before exporting.");
        const keys = [
          "id",
          "symbol",
          "status",
          "openedAt",
          "closedAt",
          "buyQuantity",
          "sellQuantity",
          "quantity",
          "buyCost",
          "netProceeds",
          "fees",
          "realizedPnl",
          "remainingCost",
          "returnOnBuyCostPercent",
          "outcome",
          "breakEvenTolerance",
        ];
        const quote = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
        const content =
          format === "json"
            ? JSON.stringify(p, null, 2)
            : [
                "accountRevision," + keys.join(","),
                ...[...p.closedTrades, ...p.openTrades].map((t) =>
                  [p.accountRevision, ...keys.map((k) => t[k])]
                    .map(quote)
                    .join(","),
                ),
              ].join("\n");
        await exportFile(
          `paper-performance-r${p.accountRevision}.${format}`,
          content,
        );
        s.message =
          "Loaded performance snapshot exported, including all matching trades, not just this page.";
      });
  bindBody();
}
