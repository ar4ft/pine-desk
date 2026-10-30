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
  new Date(v).toISOString().replace("T", " ").replace(".000Z", " UTC");
export const newPaperState = () => ({
  account: null,
  loaded: false,
  loading: false,
  plans: [],
  error: "",
  message: "",
  requestId: crypto.randomUUID(),
  planRequestId: crypto.randomUUID(),
  planId: "",
  draft: {
    initialCash: 10000,
    symbol: "BTCUSDT",
    side: "buy",
    type: "market",
    quantity: 0.001,
    price: "",
    maxNotional: 1000,
    feePercent: 0.1,
    slippage: 0,
  },
});
export function retainPaperDraft(s) {
  if (!document.getElementById("paper-view")) return;
  for (const key of Object.keys(s.draft)) {
    const el = document.getElementById("paper-" + key);
    if (el) s.draft[key] = el.value;
  }
  const plan = document.getElementById("paper-plan");
  if (plan) s.planId = plan.value;
}
function results(s) {
  const a = s.account;
  if (!a) return "";
  const pending = a.orders.filter((o) => o.status === "pending");
  const history = a.orders
    .filter((o) => o.status !== "pending")
    .slice(-100)
    .reverse();
  const rows = [...pending, ...history];
  return `<div class="metrics paper-metrics"><div><span>Cash · USDT</span><strong>${num(a.cash)}</strong></div><div><span>Available cash</span><strong>${num(a.availableCash)}</strong></div><div><span>Reserved cash</span><strong>${num(a.reservedCash)}</strong></div><div><span>Realized P&L · after fees</span><strong>${num(a.realizedPnl)}</strong></div></div><p class="footnote">Account revision ${a.revision} · Initial cash ${num(a.initialCash)} USDT · Cost-basis accounting. Cash is not total equity; positions are not marked to market.</p>
  <section class="plot-card"><div class="panel-heading"><span>POSITIONS</span><span>Spot holdings · USDT cost basis</span></div><div class="table-wrap"><table id="paper-positions"><thead><tr><th>Market</th><th>Quantity</th><th>Reserved exits</th><th>Average cost incl. fees</th><th>Remaining cost</th><th>Realized P&L</th></tr></thead><tbody>${
    Object.entries(a.positions)
      .map(
        ([symbol, p]) =>
          `<tr><td>${esc(symbol)}</td><td>${num(p.quantity)}</td><td>${num(a.reservedQuantity[symbol] ?? 0)}</td><td>${p.quantity ? num(p.cost / p.quantity) : "—"}</td><td>${num(p.cost)}</td><td>${num(p.realizedPnl)}</td></tr>`,
      )
      .join("") || '<tr><td colspan="6">No simulated positions yet.</td></tr>'
  }</tbody></table></div></section>
  <section class="plot-card"><div class="panel-heading"><span>ORDERS</span><span>${pending.length} pending · ${a.orders.length} total</span></div><p class="footnote">Process checks one order against a new quote now. Limits and stops stay pending until you process them at a qualifying price. No background execution; missed crossings are not replayed.</p><div class="table-wrap"><table id="paper-orders"><thead><tr><th>Market / order</th><th>Quantity</th><th>Price / cap</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map((o) => `<tr data-paper-order="${o.id}"><td>${esc(o.symbol)} · ${esc(o.side)} ${esc(o.type)}<small>${date(o.submittedAt)}${o.plan ? `<br>Plan: ${esc(o.plan.name)} · r${o.plan.revision}` : ""}</small></td><td>${num(o.quantity)}</td><td>${o.price ? num(o.price) : o.maxNotional ? `Cap ${num(o.maxNotional)} USDT` : "Current bid"}<small>Fee ${num(o.feePercent)}% · slippage ${num(o.slippage)}</small></td><td>${esc(o.status)}${o.reason ? `<small>${esc(o.reason)}</small>` : ""}</td><td>${o.status === "pending" ? `<button data-paper-process="${o.id}">Process</button><button data-paper-cancel="${o.id}">Cancel</button>` : "—"}</td></tr>`).join("") || '<tr><td colspan="5">No paper orders. Queue one above.</td></tr>'}</tbody></table></div><p class="footnote">All pending orders and the latest 100 completed orders are shown. Export includes the complete ledger.</p></section>
  <section class="plot-card"><div class="panel-heading"><span>SIMULATED FILLS</span><span>${a.fills.length} total · latest 100</span></div><div class="table-wrap"><table id="paper-fills"><thead><tr><th>Time / market</th><th>Side / quantity</th><th>Fill price</th><th>Fee</th><th>Realized P&L</th><th>Observed bid / ask</th></tr></thead><tbody>${
    a.fills
      .slice(-100)
      .reverse()
      .map(
        (f) =>
          `<tr><td>${date(f.at)}<small>${esc(f.symbol)}</small></td><td>${esc(f.side)} · ${num(f.quantity)}</td><td>${num(f.price)}</td><td>${num(f.fee)}</td><td>${num(f.realizedPnl)}</td><td>${num(f.quote.bid)} / ${num(f.quote.ask)}<small>Retrieved ${date(f.quote.receivedAt)}</small></td></tr>`,
      )
      .join("") || '<tr><td colspan="6">No simulated fills yet.</td></tr>'
  }</tbody></table></div></section>
  <details class="plot-card paper-ledger"><summary>Event ledger · ${a.ledger.length} events · latest 100</summary><ol>${
    a.ledger
      .slice(-100)
      .reverse()
      .map(
        (e) =>
          `<li>${date(e.at)} · ${esc(e.kind)} · <code>${esc(e.id)}</code></li>`,
      )
      .join("") || "<li>Account created; no orders yet.</li>"
  }</ol></details>`;
}
export function paperView(s) {
  const d = s.draft;
  const field = (key, label, type = "number") =>
    `<label>${label}<input id="paper-${key}" type="${type}" ${type === "number" ? 'step="any"' : ""} value="${esc(d[key])}"></label>`;
  return `<section id="paper-view"><div class="page-intro"><span class="eyebrow">SIMULATED CASH ACCOUNT</span><h1>Practice the execution. Keep the record.</h1><p>Binance USDT spot · long holdings · local paper orders. Process each order explicitly against a fresh public bid/ask. No real money or exchange orders.</p></div><div class="searchbar"><button id="paper-refresh">Refresh account</button><button id="paper-export" ${s.account ? "" : "disabled"}>Export account and ledger</button></div><p id="paper-error" role="alert">${esc(s.error)}</p><p id="paper-message" role="status">${esc(s.message)}</p>
  ${!s.loaded ? '<p class="footnote">Loading paper account…</p>' : !s.account ? `<section class="plot-card"><div class="panel-heading"><span>START A PAPER ACCOUNT</span></div><div class="plan-fields">${field("initialCash", "Initial simulated cash (USDT)")}</div><p class="footnote">One persistent account. Initial cash cannot be changed after creation. No automatic resets or deposits.</p><button id="paper-create" class="primary">Create paper account</button></section>` : `<div class="plan-columns"><section class="plot-card"><div class="panel-heading"><span>QUEUE A PAPER ORDER</span><span>Reserves funds / holdings</span></div><div class="plan-fields">${field("symbol", "Binance USDT symbol", "text")}<label>Side<select id="paper-side"><option value="buy" ${d.side === "buy" ? "selected" : ""}>Buy</option><option value="sell" ${d.side === "sell" ? "selected" : ""}>Sell held quantity</option></select></label><label>Order type<select id="paper-type">${["market", "limit", "stop"].map((t) => `<option value="${t}" ${d.type === t ? "selected" : ""}>${t === "stop" ? "Sell stop" : t[0].toUpperCase() + t.slice(1)}</option>`).join("")}</select></label>${field("quantity", "Quantity (base asset)")}${field("price", "Limit price / sell-stop trigger")}${field("maxNotional", "Market-buy notional cap (USDT)")}${field("feePercent", "Fee per fill (%)")}${field("slippage", "Adverse slippage per fill (price units)")}</div><p class="footnote">Whole-order synthetic fills at ask + slippage for buys, bid − slippage for sells. Limit fills respect your limit; stops can gap. Manual quantity and costs; exchange lot sizes, liquidity, queue position and minimum notional are not modeled.</p><button id="paper-submit" class="primary">Queue paper order</button></section><section class="plot-card"><div class="panel-heading"><span>START FROM A SAVED PLAN</span></div><div class="plan-fields"><label>Saved plan<select id="paper-plan"><option value="">Choose a plan</option>${s.plans.map((p) => `<option value="${p.id}" ${p.id === s.planId ? "selected" : ""}>${esc(p.estimate.input.name)} · ${esc(p.estimate.input.symbol)} · r${p.revision}</option>`).join("")}</select></label></div><p class="footnote">Queues a limit buy at the saved entry using the saved quantity, fees and slippage. Requires a draft, long, Binance spot plan in USDT. Available account cash is checked again.</p><p class="footnote"><strong>Stops and targets are not activated.</strong> After entry fills, submit sell exits separately. Each exit reserves its quantity; linked brackets and OCO orders are not supported.</p><button id="paper-plan-submit">Queue saved plan entry</button><p class="footnote">Pending orders survive restart. Nothing processes while the app is closed or until you press Process. REST retrieval time establishes quote freshness; the endpoint does not provide an exchange event timestamp.</p></section></div>`}
  <div id="paper-results">${results(s)}</div></section>`;
}
export function bindPaper({ state: s, call, task, render, exportFile }) {
  if (!document.getElementById("paper-view")) return;
  const replace = () => {
    document.getElementById("paper-view")?.remove();
    render();
  };
  const draw = () => {
    if (!document.getElementById("paper-view")) return;
    document.getElementById("paper-results").innerHTML = results(s);
    document.getElementById("paper-error").textContent = s.error;
    document.getElementById("paper-message").textContent = s.message;
    actions();
  };
  const operation = (fn) =>
    task(async () => {
      retainPaperDraft(s);
      try {
        await fn();
        s.error = "";
      } catch (e) {
        s.error = e.message;
        s.message = "";
      }
      draw();
    });
  const refresh = async () => {
    const [account, plans] = await Promise.all([
      call("paperSnapshot"),
      call("planList"),
    ]);
    s.account = account;
    s.plans = plans;
    s.loaded = true;
  };
  const actions = () => {
    document.querySelectorAll("[data-paper-process]").forEach(
      (el) =>
        (el.onclick = () =>
          operation(async () => {
            const r = await call("paperProcess", {
              id: el.dataset.paperProcess,
              expectedRevision: s.account.revision,
            });
            s.account = r.account;
            s.message = r.message;
          })),
    );
    document.querySelectorAll("[data-paper-cancel]").forEach(
      (el) =>
        (el.onclick = () =>
          operation(async () => {
            s.account = await call("paperCancel", {
              id: el.dataset.paperCancel,
              expectedRevision: s.account.revision,
            });
            s.message = "Paper order cancelled; reservation released.";
          })),
    );
  };
  document.getElementById("paper-refresh").onclick = () =>
    operation(async () => {
      await refresh();
      s.message = "Account refreshed.";
      replace();
    });
  document.getElementById("paper-export").onclick = () =>
    operation(async () => {
      const account = await call("paperSnapshot");
      await exportFile(
        "paper-account.json",
        JSON.stringify({ modelVersion: 1, account }, null, 2),
      );
      s.message = "Exported the latest saved account and complete ledger.";
    });
  const create = document.getElementById("paper-create");
  if (create)
    create.onclick = () =>
      operation(async () => {
        s.account = await call("paperCreate", {
          initialCash: Number(s.draft.initialCash),
        });
        s.message = "Paper account created.";
        replace();
      });
  const submit = document.getElementById("paper-submit");
  if (submit) {
    const visibility = () => {
      const type = document.getElementById("paper-type").value,
        side = document.getElementById("paper-side").value;
      document.getElementById("paper-price").parentElement.hidden =
        type === "market";
      document.getElementById("paper-maxNotional").parentElement.hidden =
        type !== "market" || side !== "buy";
    };
    for (const key of Object.keys(s.draft)) {
      const el = document.getElementById("paper-" + key);
      if (el)
        el.oninput = () => {
          s.requestId = crypto.randomUUID();
          visibility();
        };
    }
    visibility();
    submit.onclick = () =>
      operation(async () => {
        const d = s.draft,
          input = {
            symbol: d.symbol.trim().toUpperCase(),
            side: d.side,
            type: d.type,
            quantity: Number(d.quantity),
            feePercent: Number(d.feePercent),
            slippage: Number(d.slippage),
            ...(d.type !== "market"
              ? { price: Number(d.price) }
              : d.side === "buy"
                ? { maxNotional: Number(d.maxNotional) }
                : {}),
          };
        s.account = await call("paperSubmit", {
          input,
          requestId: s.requestId,
          expectedRevision: s.account.revision,
        });
        s.requestId = crypto.randomUUID();
        s.message =
          "Paper order queued. Press Process to evaluate it against a new quote.";
      });
    document.getElementById("paper-plan").onchange = () => {
      s.planRequestId = crypto.randomUUID();
    };
    document.getElementById("paper-plan-submit").onclick = () =>
      operation(async () => {
        const plan = s.plans.find((p) => p.id === s.planId);
        if (!plan) throw Error("Choose a saved plan first.");
        s.account = await call("paperSubmitPlan", {
          planId: plan.id,
          planRevision: plan.revision,
          requestId: s.planRequestId,
          expectedRevision: s.account.revision,
        });
        s.planRequestId = crypto.randomUUID();
        s.message = "Plan entry queued. Stops and targets are not activated.";
      });
  }
  actions();
  if (!s.loaded && !s.loading) {
    s.loading = true;
    refresh()
      .then(() => {
        if (document.getElementById("paper-view")) {
          retainPaperDraft(s);
          replace();
        }
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
