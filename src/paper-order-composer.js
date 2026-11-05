import { Vela } from "@luxalgo/vela";
import { paperLevelsType } from "./paper-chart-levels.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (v) => v.toLocaleString("en-US", { maximumFractionDigits: 8 });
const initial = () => ({
  symbol: "BTCUSDT",
  timeframe: "1h",
  mode: "buy-limit",
  quantity: "0.001",
  feePercent: "0.1",
  slippage: "0",
  price: "",
  stop: "",
  target: "",
  bracket: false,
  dataset: null,
  preview: null,
  attempt: null,
  requestId: crypto.randomUUID(),
  error: "",
  chartError: "",
});
const state = (s) => (s.composeDraft ??= initial());
const keys = [
  "symbol",
  "timeframe",
  "mode",
  "quantity",
  "feePercent",
  "slippage",
  "price",
  "stop",
  "target",
  "bracket",
];
const number = (v) =>
  Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 1e12;
const message = (e) => {
  try {
    const issues = JSON.parse(e.message);
    if (Array.isArray(issues))
      return issues.map((i) => `${i.path?.join(".")}: ${i.message}`).join("; ");
  } catch {}
  return e.message;
};
export function destroyPaperComposer(s) {
  s.composerController?.dispose();
  s.composerController = null;
}
export function paperComposerView(s) {
  if (!s.account) return "";
  const d = state(s),
    field = (key, label) =>
      `<label>${label}<input id="paper-compose-${key}" type="number" step="any" value="${esc(d[key])}"></label>`;
  return `<section class="plot-card" id="paper-composer"><div class="panel-heading"><span>CREATE A PAPER ORDER ON THE CHART</span><span>Draft → review → queue</span></div><div class="plan-fields"><label>Binance USDT market<input id="paper-compose-symbol" value="${esc(d.symbol)}"></label><label>Order<select id="paper-compose-mode">${[
    ["buy-limit", "Limit buy"],
    ["sell-limit", "Limit exit"],
    ["sell-stop", "Sell stop"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}" ${d.mode === v ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select></label><label>Candles<select id="paper-compose-timeframe">${["1m", "5m", "15m", "1h", "4h", "1d"].map((t) => `<option ${d.timeframe === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>${field("quantity", "Quantity (base asset)")}${field("feePercent", "Fee per fill (%)")}${field("slippage", "Adverse slippage (price units)")}${field("price", "Entry / exit price · amber")}<label id="paper-compose-bracket-label"><span><input id="paper-compose-bracket" type="checkbox" ${d.bracket ? "checked" : ""}> Linked stop and target after entry fills</span></label>${field("stop", "Linked stop · red")}${field("target", "Linked target · green")}</div><div class="searchbar"><button id="paper-compose-load">Load chart · seed blank levels</button><button id="paper-compose-fit">Fit draft levels</button><button id="paper-compose-review">Review order</button><button id="paper-compose-submit">Queue reviewed order</button><button id="paper-compose-check">Check submission</button><button id="paper-compose-new">New draft</button></div><p class="footnote" id="paper-compose-notice" role="status"></p><p class="paper-monitor-error" id="paper-compose-error" role="alert"></p><div id="paper-compose-review-body"></div><p class="footnote" id="paper-compose-chart-status"></p><div id="paper-compose-chart" aria-label="New paper order chart"></div><p class="footnote">Drag the amber price and optional red stop/green target, or type exact values. Loading seeds only blank levels from the last settled close: entry at close, stop 2% below and target 2% above. These are editable starting values. Candles never trigger fills. Review checks current funds, holdings and risk limits without reserving anything; Queue submits the reviewed order. A running monitor can then fill it. Linked exits use the full entry quantity and activate only after its fill. No exchange orders.</p></section>`;
}
export function bindPaperComposer({
  s,
  call,
  operation,
  appearance = () => ({ theme: "dark" }),
}) {
  const host = document.getElementById("paper-composer");
  if (!host) return { paint() {} };
  destroyPaperComposer(s);
  const d = state(s),
    el = (k) => host.querySelector(`#paper-compose-${k}`),
    valid = () => !disposed && host.isConnected;
  let disposed = false,
    busy = false,
    chart = null,
    native = null,
    generation = 0,
    syncing = false,
    lines = new Map();
  const input = () => ({
    symbol: d.symbol.trim().toUpperCase(),
    side: d.mode === "buy-limit" ? "buy" : "sell",
    type: d.mode === "sell-stop" ? "stop" : "limit",
    quantity: Number(d.quantity),
    feePercent: Number(d.feePercent),
    slippage: Number(d.slippage),
    price: Number(d.price),
    ...(d.mode === "buy-limit" && d.bracket
      ? {
          bracket: {
            stop: Number(d.stop),
            targets: [
              { price: Number(d.target), quantity: Number(d.quantity) },
            ],
          },
        }
      : {}),
  });
  const levels = () => [
    ["price", "PRICE", "#e9b45d"],
    ...(d.mode === "buy-limit" && d.bracket
      ? [
          ["stop", "STOP", "#e27685"],
          ["target", "TARGET", "#4db994"],
        ]
      : []),
  ];
  const destroyChart = () => {
    generation++;
    chart?.destroy();
    chart = null;
    native = null;
    lines.clear();
    el("chart")?.replaceChildren();
  };
  const paint = () => {
    if (!valid()) return;
    const frozen = busy || !!d.attempt,
      stale = d.preview && d.preview.accountRevision !== s.account?.revision;
    for (const k of keys) el(k).disabled = frozen;
    el("bracket-label").hidden = d.mode !== "buy-limit";
    for (const k of ["stop", "target"])
      el(k).parentElement.hidden = d.mode !== "buy-limit" || !d.bracket;
    for (const k of ["load", "review", "fit"]) el(k).disabled = frozen;
    el("submit").disabled = frozen || !d.preview || stale;
    el("check").disabled = busy || !d.attempt || d.attempt.confirmed;
    el("new").disabled = busy || (!!d.attempt && !d.attempt.confirmed);
    el("notice").textContent = d.attempt?.confirmed
      ? `Order ${d.attempt.orderId} is recorded. Start a new draft to queue another order.`
      : d.attempt
        ? "Submission was not confirmed. Check its request ID before changing this draft; checking never submits another order."
        : stale
          ? "Account changed since review. Draft preserved; review again before queueing."
          : d.preview
            ? "Reviewed against the displayed account revision. Queue reviewed order explicitly to submit."
            : "Draft only. Review the proposed order before queueing.";
    el("error").textContent = d.error;
    el("chart-status").textContent =
      d.chartError ||
      (d.dataset
        ? `${d.dataset.symbol} · ${d.dataset.timeframe} · ${d.dataset.origin} · last settled candle ${new Date(d.dataset.bars.at(-1).time).toISOString()}`
        : "Load public candles for this market, or enter prices numerically.");
    const p = d.preview;
    el("review-body").innerHTML = p
      ? `<p class="footnote"><strong>Reviewed account r${p.accountRevision}</strong> · ${esc(p.input.symbol)} · ${esc(p.input.side)} ${esc(p.input.type)} · ${p.input.quantity} @ ${p.input.price} · fee ${p.input.feePercent}% · slippage ${p.input.slippage}${p.input.bracket ? ` · linked stop ${p.input.bracket.stop}, target ${p.input.bracket.targets[0].price} (full quantity)` : ""}<br>Additional cash reservation: ${money(p.reservedCashAdded)} USDT · additional held quantity reserved: ${p.reservedQuantityAdded}. Available cash: ${money(p.availableCashBefore)} → ${money(p.availableCashAfter)} USDT. No funds are reserved until Queue succeeds.</p>`
      : "";
    syncing = true;
    try {
      for (const id of lines.values())
        if (!!chart?.drawings.all().find((l) => l.id === id)?.locked !== frozen)
          chart?.drawings.lock(id, frozen);
    } finally {
      syncing = false;
    }
  };
  const changed = () => {
    d.preview = null;
    d.error = "";
    d.requestId = crypto.randomUUID();
    paint();
  };
  const syncLines = (fit = false) => {
    if (!chart || !d.dataset) return paint();
    const wanted = levels().filter(([k]) => number(d[k])),
      time = d.dataset.bars[Math.floor(d.dataset.bars.length / 2)].time;
    syncing = true;
    try {
      for (const [k, id] of lines)
        if (!wanted.some(([v]) => v === k)) {
          chart.drawings.remove(id);
          lines.delete(k);
        }
      for (const [k, title, color] of wanted) {
        if (lines.has(k))
          chart.drawings.update(lines.get(k), {
            anchors: [{ time, price: Number(d[k]) }],
          });
        else {
          const line = chart.drawings.add("hline", {
            paneId: "price",
            anchors: [{ time, price: Number(d[k]) }],
            style: { lineColor: color, lineWidth: 2, lineStyle: "solid" },
            text: {
              value: title,
              size: "small",
              hAlign: "left",
              vAlign: "top",
            },
          });
          if (!line)
            throw Error(
              "Drawing unavailable; numeric entry remains available.",
            );
          lines.set(k, line.id);
        }
      }
      if (fit)
        native?.setInputs({
          levels: JSON.stringify(
            wanted.map(([k]) => ({
              price: Number(d[k]),
              title: k,
              color: "transparent",
            })),
          ),
        });
      el("chart").dataset.price = d.price;
    } finally {
      syncing = false;
    }
    paint();
  };
  const mount = async () => {
    destroyChart();
    if (!valid() || !d.dataset) return;
    const token = generation,
      node = el("chart");
    node.dataset.ready = "false";
    try {
      chart = new Vela(node, {
        data: d.dataset.bars,
        symbol: d.dataset.symbol,
        timeframe: d.dataset.timeframe,
        ...appearance(),
        drawings: { toolbar: false },
        animations: { intro: false },
      });
      const instance = chart;
      await instance.ready();
      if (!valid() || token !== generation) return;
      native = instance.addNativeIndicator(paperLevelsType);
      syncLines(true);
      instance.on("drawing:edited", ({ id }) => {
        if (!valid() || syncing || busy || d.attempt) return;
        const key = [...lines].find(([, v]) => v === id)?.[0],
          price = instance.drawings.all().find((l) => l.id === id)
            ?.anchors[0]?.price;
        if (!key || !Number.isFinite(price)) return;
        d[key] = String(Number(price.toPrecision(12)));
        el(key).value = d[key];
        changed();
        el("chart").dataset.price = d.price;
      });
      instance.on("drawing:removed", ({ id }) => {
        if (!valid() || syncing) return;
        const key = [...lines].find(([, v]) => v === id)?.[0];
        if (key) {
          lines.delete(key);
          syncLines();
        }
      });
      node.dataset.ready = "true";
    } catch (e) {
      if (valid() && token === generation) {
        d.chartError = message(e);
        destroyChart();
        paint();
      }
    }
  };
  const run = (fn) =>
    operation(async () => {
      busy = true;
      d.error = "";
      paint();
      try {
        await fn();
      } catch (e) {
        d.error = message(e);
        throw Error(d.error);
      } finally {
        busy = false;
        paint();
      }
    });
  for (const k of keys)
    el(k).oninput = (e) => {
      d[k] = k === "bracket" ? e.target.checked : e.target.value;
      if (k === "symbol") {
        d.dataset = null;
        d.price = "";
        d.stop = "";
        d.target = "";
        for (const v of ["price", "stop", "target"]) el(v).value = "";
        destroyChart();
        d.chartError = "Market changed; load its candles or enter new prices.";
      }
      if (k === "timeframe") {
        d.dataset = null;
        destroyChart();
        d.chartError =
          "Interval changed; load candles again. Price drafts are preserved.";
      }
      if (k === "mode" && d.mode !== "buy-limit") {
        d.bracket = false;
        el("bracket").checked = false;
      }
      changed();
      syncLines();
    };
  el("load").onclick = () =>
    run(async () => {
      const symbol = d.symbol.trim().toUpperCase(),
        timeframe = d.timeframe;
      try {
        const data = await call("paperDraftChart", { symbol, timeframe });
        if (!valid()) return;
        if (data.symbol !== symbol || data.timeframe !== timeframe)
          throw Error(
            "Chart response does not match the draft market/interval.",
          );
        d.dataset = data;
        d.chartError = "";
        for (const [k, value] of [
          ["price", data.bars.at(-1).close],
          ["stop", data.bars.at(-1).close * 0.98],
          ["target", data.bars.at(-1).close * 1.02],
        ])
          if (!String(d[k]).trim()) {
            d[k] = String(Number(Number(value).toPrecision(12)));
            el(k).value = d[k];
          }
        changed();
        await mount();
      } catch (e) {
        if (valid()) {
          d.dataset = null;
          d.chartError = `Candles unavailable: ${message(e)} Numeric entry remains available.`;
          destroyChart();
        }
        throw e;
      }
    });
  el("fit").onclick = () => syncLines(true);
  el("review").onclick = () =>
    run(async () => {
      const proposed = input(),
        fingerprint = JSON.stringify(proposed);
      d.preview = null;
      s.account = await call("paperSnapshot");
      const result = await call("paperPreview", {
        input: proposed,
        expectedRevision: s.account.revision,
      });
      if (JSON.stringify(input()) !== fingerprint) return;
      d.preview = result;
      s.message = "Draft validated; nothing has been queued or reserved.";
    });
  el("submit").onclick = () =>
    run(async () => {
      if (
        !d.preview ||
        d.attempt ||
        d.preview.accountRevision !== s.account.revision
      )
        throw Error("Review this draft against the current account first.");
      d.attempt = {
        input: structuredClone(d.preview.input),
        expectedRevision: d.preview.accountRevision,
        requestId: d.requestId,
        confirmed: false,
      };
      paint();
      s.account = await call("paperSubmit", {
        input: d.attempt.input,
        expectedRevision: d.attempt.expectedRevision,
        requestId: d.attempt.requestId,
      });
      const order = s.account.orders.find(
        (o) => o.requestId === d.attempt.requestId,
      );
      if (!order)
        throw Error(
          "Submission response did not contain this request. Check submission.",
        );
      d.attempt.confirmed = true;
      d.attempt.orderId = order.id;
      s.message =
        "Reviewed paper order queued. An active monitor may process it.";
    });
  el("check").onclick = () =>
    run(async () => {
      s.account = await call("paperSnapshot");
      const order = s.account.orders.find(
        (o) => o.requestId === d.attempt.requestId,
      );
      if (order) {
        d.attempt.confirmed = true;
        d.attempt.orderId = order.id;
        s.message =
          "Submission found in the ledger; no duplicate order was queued.";
      } else {
        d.attempt = null;
        d.preview = null;
        s.message =
          "Request not found in the current ledger. Review again before queueing; the request ID is retained.";
      }
    });
  el("new").onclick = () => {
    const symbol = d.symbol,
      timeframe = d.timeframe;
    Object.assign(d, initial(), { symbol, timeframe });
    destroyChart();
    for (const k of keys)
      if (k === "bracket") el(k).checked = d[k];
      else el(k).value = d[k];
    paint();
  };
  const controller = {
    paint,
    dispose() {
      disposed = true;
      destroyChart();
    },
    appearance() {
      if (chart) {
        const a = appearance();
        chart.setTheme(a.theme);
        chart.renderer.set({ upColor: a.upColor, downColor: a.downColor });
      }
    },
  };
  s.composerController = controller;
  paint();
  if (d.dataset) void mount();
  return controller;
}
