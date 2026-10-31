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
    ? v.toLocaleString("en-US", { maximumFractionDigits: 4 })
    : "—";
const date = (v) =>
  new Date(v)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
const adherence = {
  unreviewed: "Unreviewed",
  "followed-plan": "Followed plan",
  deviated: "Deviated from plan",
  "no-plan": "No plan",
};

export function retainPaperResearchDraft(s) {
  if (!s.journalDraft || !document.getElementById("paper-journal-thesis"))
    return;
  for (const k of ["thesis", "review", "tags", "adherence"])
    s.journalDraft[k] = document.getElementById(`paper-journal-${k}`).value;
}
function journalRows(s) {
  if (!s.journal)
    return '<p class="footnote">Load the journal to review simulated fills and their source plans.</p>';
  const q = (s.journalFilter ?? "").trim().toLowerCase();
  const entries = s.journal.entries.filter(
    (e) =>
      !q ||
      [e.fill.symbol, e.plan?.name ?? "", ...e.input.tags]
        .join(" ")
        .toLowerCase()
        .includes(q),
  );
  const pages = Math.max(1, Math.ceil(entries.length / 100));
  s.journalPage = Math.min(s.journalPage ?? 0, pages - 1);
  const end = entries.length - s.journalPage * 100;
  return `<div class="searchbar"><button id="paper-journal-newer" ${s.journalPage === 0 ? "disabled" : ""}>Newer</button><button id="paper-journal-older" ${s.journalPage + 1 >= pages ? "disabled" : ""}>Older</button><span>Page ${s.journalPage + 1} / ${pages}</span></div><p class="footnote">${entries.length} matching fills · 100 per page. Each row is one fill, not a complete round-trip trade. Refreshing the list preserves your draft.</p><div class="table-wrap"><table id="paper-journal-table"><thead><tr><th>Time / market</th><th>Fill / realized P&L</th><th>Source plan / exit</th><th>Review / tags</th><th></th></tr></thead><tbody>${
    entries
      .slice(Math.max(0, end - 100), end)
      .reverse()
      .map(
        (e) =>
          `<tr><td>${date(e.fill.at)}<small>${esc(e.fill.symbol)}</small></td><td>${esc(e.fill.side)} ${num(e.fill.quantity)} @ ${num(e.fill.price)}<small>${e.fill.side === "sell" ? `${num(e.fill.realizedPnl)} USDT realized` : "Entry cost added to holdings"}</small></td><td>${e.plan ? `${esc(e.plan.name)} · r${e.plan.revision}` : "Manual order"}${e.parentId ? `<small>Linked ${esc(e.leg)} · parent ${esc(e.parentId.slice(0, 8))}</small>` : ""}</td><td>${esc(adherence[e.input.adherence])}<small>${e.input.tags.map(esc).join(" · ")}</small>${e.revision ? `<small>Notes r${e.revision}</small>` : ""}</td><td><button data-journal-edit="${e.orderId}">Review fill</button></td></tr>`,
      )
      .join("") || '<tr><td colspan="5">No matching simulated fills.</td></tr>'
  }</tbody></table></div>`;
}
function journalEditor(s) {
  const d = s.journalDraft;
  if (!d)
    return '<p class="footnote">Choose Review fill to add a thesis, tags and a post-fill review.</p>';
  return `<div class="panel-heading"><span>REVIEW · ${esc(d.label)}</span><span>Notes r${d.revision} · ${esc(d.orderId.slice(0, 8))}</span></div><div class="plan-fields"><label>Thesis / setup<textarea id="paper-journal-thesis" rows="4" maxlength="2000">${esc(d.thesis)}</textarea></label><label>Review / lessons<textarea id="paper-journal-review" rows="4" maxlength="4000">${esc(d.review)}</textarea></label><label>Tags (comma-separated, up to 10)<input id="paper-journal-tags" type="text" value="${esc(d.tags)}"></label><label>Plan adherence<select id="paper-journal-adherence">${Object.entries(
    adherence,
  )
    .map(
      ([k, v]) =>
        `<option value="${k}" ${d.adherence === k ? "selected" : ""}>${v}</option>`,
    )
    .join(
      "",
    )}</select></label></div><p class="footnote">Annotations describe this fill; they do not change orders, fills or saved plans. Only the latest note text is retained. Choosing another fill or reloading it replaces this draft.</p><div class="searchbar"><button id="paper-journal-save">Save review</button><button id="paper-journal-reload">Reload this fill</button></div>`;
}
function historyChart(samples, mode) {
  if (!samples.length)
    return '<p class="footnote">No recorded samples yet. Start paper monitoring to begin recording.</p>';
  const key = mode === "drawdown" ? "drawdownPercent" : "equity";
  const values = samples.map((s) => s[key]).filter(Number.isFinite);
  if (!values.length)
    return '<p class="footnote">This window contains only missing-price observations; no equity line can be drawn.</p>';
  const start = samples[0].at,
    end = samples.at(-1).at;
  let min = mode === "drawdown" ? 0 : Math.min(...values),
    max = Math.max(...values);
  const pad = (max - min || Math.max(1, Math.abs(max) * 0.02)) * 0.08;
  min = mode === "drawdown" ? 0 : min - pad;
  max += pad;
  const x = (at) => 80 + ((at - start) / Math.max(1, end - start)) * 900;
  const y = (v) => 215 - ((v - min) / (max - min)) * 190;
  let path = "",
    previous = false;
  const dots = [];
  for (const s of samples) {
    const v = s[key];
    if (v === null) {
      previous = false;
      continue;
    }
    const px = x(s.at).toFixed(2),
      py = y(v).toFixed(2);
    path += `${previous && !s.gapBefore ? "L" : "M"}${px},${py} `;
    previous = true;
    dots.push(
      `<circle cx="${px}" cy="${py}" r="2"><title>${date(s.at)} · ${num(s.equity)} USDT equity · ${num(s.drawdownPercent)}% sampled drawdown · account r${s.accountRevision}</title></circle>`,
    );
  }
  return `<svg class="paper-history-chart ${mode === "drawdown" ? "drawdown" : ""}" viewBox="0 0 1000 250" role="img" aria-label="${mode === "drawdown" ? "Sampled drawdown percent" : "Recorded bid equity in USDT"}; lines break across missing observations and monitoring sessions"><g class="history-axis">${[min, (min + max) / 2, max].map((v) => `<line x1="80" x2="980" y1="${y(v)}" y2="${y(v)}"/><text x="72" y="${y(v) + 4}" text-anchor="end">${esc(num(v))}${mode === "drawdown" ? "%" : ""}</text>`).join("")}<text x="80" y="242">${date(start)}</text><text x="980" y="242" text-anchor="end">${date(end)}</text></g><path d="${path}"/>${dots.join("")}</svg>`;
}
function historyBody(s) {
  const h = s.paperHistory;
  if (!h)
    return '<p class="footnote">Load recorded history to see equity and sampled drawdown. Recording runs with the paper monitor; this view does not start monitoring.</p>';
  const samples = h.samples.slice(-(s.historyWindow ?? 500));
  return `<div class="metrics paper-metrics"><div><span>Last recorded equity · USDT</span><strong>${num(h.samples.at(-1)?.equity)}</strong></div><div><span>Recorded peak / initial baseline</span><strong>${num(h.peak)}</strong></div><div><span>Max sampled drawdown · all history</span><strong>${num(h.maxDrawdownPercent)}%</strong></div><div><span>Complete / missing-price samples</span><strong>${h.completeSamples} / ${h.gapSamples}</strong></div></div>${historyChart(samples, s.historyMode ?? "equity")}<p class="footnote">Showing latest ${samples.length} of ${h.count} saved observations. ${esc(h.method)} Hover a point for values. Historical marks are not current quotes.</p><details><summary>Latest 20 recorded observations</summary><div class="table-wrap"><table id="paper-history-table"><thead><tr><th>Time / account revision</th><th>Equity · USDT</th><th>Unrealized P&L</th><th>Sampled drawdown</th><th>Coverage</th></tr></thead><tbody>${h.samples
    .slice(-20)
    .reverse()
    .map(
      (p) =>
        `<tr><td>${date(p.at)}<small>Account r${p.accountRevision}</small></td><td>${num(p.equity)}</td><td>${num(p.unrealizedPnl)}</td><td>${num(p.drawdownPercent)}${p.drawdownPercent === null ? "" : "%"}</td><td>${p.missingSymbols.length ? `Missing: ${p.missingSymbols.map(esc).join(", ")}` : p.holdingCount ? `${p.holdingCount} holdings marked` : "Cash only"}${p.gapBefore ? "<small>Line break / session start</small>" : ""}</td></tr>`,
    )
    .join("")}</tbody></table></div></details>`;
}
export function paperHistoryStatus(s) {
  const h = s.monitor?.history;
  return `<p class="footnote">${h?.loaded ? `${h.count} / ${h.limit} samples recorded${h.lastSavedAt ? ` · last ${date(h.lastSavedAt)}` : ""}` : "History records with the owning paper monitor."}${h?.loaded && s.paperHistory && h.count !== s.paperHistory.count ? " · New samples available: refresh history." : ""} About once a minute, plus account/session and quote-coverage changes. No backfill or automatic pruning.</p>${h?.error ? `<p class="paper-monitor-error">Recording: ${esc(h.error)}</p>` : ""}${h?.full ? '<p class="paper-monitor-error">History is full. Export it; existing samples are retained. Paper execution continues.</p>' : ""}`;
}
export function paperResearchView(s) {
  if (!s.account) return "";
  return `<section class="plot-card" id="paper-history"><div class="panel-heading"><span>RECORDED EQUITY & DRAWDOWN</span><span>Sampled observations · USDT</span></div><div id="paper-history-status">${paperHistoryStatus(s)}</div><div class="searchbar"><button id="paper-history-load">Load / refresh history</button><button id="paper-history-export">Export history JSON</button><button id="paper-history-csv">Export history CSV</button><label>Chart<select id="paper-history-mode"><option value="equity" ${s.historyMode !== "drawdown" ? "selected" : ""}>Bid equity</option><option value="drawdown" ${s.historyMode === "drawdown" ? "selected" : ""}>Sampled drawdown %</option></select></label><label>Window<select id="paper-history-window">${[100, 500, 2000].map((n) => `<option value="${n}" ${(s.historyWindow ?? 500) === n ? "selected" : ""}>Latest ${n}</option>`).join("")}</select></label></div><div id="paper-history-body">${historyBody(s)}</div></section>
  <section class="plot-card" id="paper-journal"><div class="panel-heading"><span>FILL JOURNAL</span><span>Thesis · execution review · source plans</span></div><div class="searchbar"><button id="paper-journal-load">Load / refresh journal</button><button id="paper-journal-export">Export journal JSON</button><label>Filter by market, tag or plan<input id="paper-journal-filter" type="search" value="${esc(s.journalFilter ?? "")}"></label></div><div id="paper-journal-editor">${journalEditor(s)}</div><div id="paper-journal-rows">${journalRows(s)}</div></section>`;
}
export function bindPaperResearch({ s, call, operation, exportFile }) {
  if (!document.getElementById("paper-history")) return;
  const paintHistory = () => {
    document.getElementById("paper-history-body").innerHTML = historyBody(s);
  };
  const loadDraft = (e) => {
    s.journalDraft = {
      orderId: e.orderId,
      revision: e.revision,
      label: `${e.fill.symbol} · ${e.fill.side} ${num(e.fill.quantity)} @ ${num(e.fill.price)}`,
      ...e.input,
      tags: e.input.tags.join(", "),
    };
    document.getElementById("paper-journal-editor").innerHTML =
      journalEditor(s);
    bindEditor();
  };
  const paintRows = () => {
    document.getElementById("paper-journal-rows").innerHTML = journalRows(s);
    for (const [id, delta] of [
      ["paper-journal-newer", -1],
      ["paper-journal-older", 1],
    ]) {
      const button = document.getElementById(id);
      if (button)
        button.onclick = () =>
          operation(async () => {
            s.journalPage += delta;
            paintRows();
          });
    }
    document.querySelectorAll("[data-journal-edit]").forEach((el) => {
      el.onclick = () =>
        operation(async () =>
          loadDraft(
            s.journal.entries.find((e) => e.orderId === el.dataset.journalEdit),
          ),
        );
    });
  };
  const lockEditor = async (fn) => {
    const controls = () =>
      document.querySelectorAll(
        "#paper-journal-editor input, #paper-journal-editor textarea, #paper-journal-editor select, #paper-journal-editor button",
      );
    controls().forEach((el) => {
      el.disabled = true;
    });
    try {
      return await fn();
    } finally {
      controls().forEach((el) => {
        el.disabled = false;
      });
    }
  };
  const bindEditor = () => {
    const save = document.getElementById("paper-journal-save");
    if (!save) return;
    save.onclick = () =>
      operation(() =>
        lockEditor(async () => {
          retainPaperResearchDraft(s);
          const d = s.journalDraft;
          const entry = await call("paperJournalSave", {
            orderId: d.orderId,
            expectedRevision: d.revision,
            input: {
              thesis: d.thesis,
              review: d.review,
              tags: d.tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
              adherence: d.adherence,
            },
          });
          const row = s.journal.entries.find(
            (e) => e.orderId === entry.orderId,
          );
          const { journalRevision, ...saved } = entry;
          s.journal.revision = journalRevision;
          Object.assign(row, saved);
          loadDraft(row);
          paintRows();
          s.message =
            "Fill review saved. Paper orders and balances are unchanged.";
        }),
      );
    document.getElementById("paper-journal-reload").onclick = () =>
      operation(() =>
        lockEditor(async () => {
          s.journal = await call("paperJournal");
          const e = s.journal.entries.find(
            (e) => e.orderId === s.journalDraft.orderId,
          );
          if (!e) throw Error("Fill is no longer in this account.");
          loadDraft(e);
          paintRows();
          s.message = "Saved fill review loaded; draft replaced.";
        }),
      );
  };
  document.getElementById("paper-journal-load").onclick = () =>
    operation(async () => {
      s.journal = await call("paperJournal");
      paintRows();
      s.message = "Journal list refreshed; draft preserved.";
    });
  document.getElementById("paper-journal-filter").oninput = (e) => {
    s.journalFilter = e.target.value;
    s.journalPage = 0;
    paintRows();
  };
  document.getElementById("paper-history-load").onclick = () =>
    operation(async () => {
      s.paperHistory = await call("paperHistory");
      paintHistory();
      s.message = "Recorded history loaded; no monitoring was started.";
    });
  document.getElementById("paper-history-mode").onchange = (e) => {
    s.historyMode = e.target.value;
    paintHistory();
  };
  document.getElementById("paper-history-window").onchange = (e) => {
    s.historyWindow = Number(e.target.value);
    paintHistory();
  };
  document.getElementById("paper-journal-export").onclick = () =>
    operation(async () => {
      const journal = await call("paperJournal");
      await exportFile(
        "paper-journal.json",
        JSON.stringify({ version: 1, journal }, null, 2),
      );
      s.message = "Latest saved journal exported; unsaved drafts are excluded.";
    });
  for (const format of ["json", "csv"])
    document.getElementById(
      format === "json" ? "paper-history-export" : "paper-history-csv",
    ).onclick = () =>
      operation(async () => {
        const history = await call("paperHistory");
        const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
        const keys = [
          "at",
          "accountRevision",
          "sessionId",
          "cash",
          "positionCost",
          "positionValue",
          "equity",
          "unrealizedPnl",
          "peak",
          "drawdown",
          "drawdownPercent",
          "gapBefore",
          "oldestQuoteAt",
          "newestQuoteAt",
          "missingSymbols",
        ];
        const content =
          format === "json"
            ? JSON.stringify({ version: 1, history }, null, 2)
            : [
                keys.join(","),
                ...history.samples.map((p) =>
                  keys
                    .map((k) =>
                      csv(
                        k === "at"
                          ? date(p.at)
                          : k === "missingSymbols"
                            ? p[k].join(";")
                            : p[k],
                      ),
                    )
                    .join(","),
                ),
              ].join("\n");
        await exportFile(`paper-equity-history.${format}`, content);
        s.message =
          "Complete recorded history exported. Missing observations remain empty.";
      });
  bindEditor();
  paintRows();
}
