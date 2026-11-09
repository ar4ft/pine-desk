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
const targetFields = [
  ["target", "targetQuantity"],
  ["target2", "targetQuantity2"],
  ["target3", "targetQuantity3"],
];
const percentFields = ["targetPercent", "targetPercent2", "targetPercent3"];
const sizingKeys = [
  "riskBudget",
  "maxNotional",
  "quantityStep",
  ...percentFields,
];
const selectedTargets = (d) => targetFields.slice(0, Number(d.targetCount));
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
  target2: "",
  target3: "",
  targetCount: "1",
  targetQuantity: "",
  targetQuantity2: "",
  targetQuantity3: "",
  bracket: false,
  riskSizing: false,
  riskBudget: "10",
  maxNotional: "1000",
  quantityStep: "0.000001",
  targetPercent: "",
  targetPercent2: "",
  targetPercent3: "",
  sizing: null,
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
  "targetCount",
  ...targetFields.flat(),
  "bracket",
  "riskSizing",
  ...sizingKeys,
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
    )}</select></label><label>Candles<select id="paper-compose-timeframe">${["1m", "5m", "15m", "1h", "4h", "1d"].map((t) => `<option ${d.timeframe === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>${field("quantity", "Quantity (base asset)")}${field("feePercent", "Fee per fill (%)")}${field("slippage", "Adverse slippage (price units)")}${field("price", "Entry / exit price · amber")}<label id="paper-compose-bracket-label"><span><input id="paper-compose-bracket" type="checkbox" ${d.bracket ? "checked" : ""}> Linked stop and targets after entry fills</span></label>${field("stop", "Linked stop · red")}<label id="paper-compose-target-count-label">Targets<select id="paper-compose-targetCount">${[1, 2, 3].map((n) => `<option value="${n}" ${Number(d.targetCount) === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>${targetFields.map(([price, quantity], i) => `${field(price, `Target ${i + 1} price · green`)}${field(quantity, `Target ${i + 1} quantity`)}`).join("")}</div><div id="paper-compose-sizing-controls"><label><span><input id="paper-compose-riskSizing" type="checkbox" ${d.riskSizing ? "checked" : ""}> Size by cash risk</span></label><div id="paper-compose-sizing-fields"><div class="plan-fields">${field("riskBudget", "Risk budget (USDT)")}${field("maxNotional", "Entry notional cap (USDT, before fees)")}${field("quantityStep", "Quantity increment (base asset)")}${percentFields.map((key, i) => field(key, `Target ${i + 1} allocation (%)`)).join("")}</div><button id="paper-compose-calculate">Calculate quantity</button><p class="footnote">Sizing uses entry plus slippage, stop minus slippage and fees on both fills. Stop risk is a scenario, not a guaranteed loss cap. Choose the quantity increment explicitly; exchange lot sizes are not fetched. Calculate again after changing inputs, then Review order to check account cash and limits.</p></div></div><div id="paper-compose-sizing-result"></div><div class="searchbar"><button id="paper-compose-load">Load chart · seed blank levels</button><button id="paper-compose-fit">Fit draft levels</button><button id="paper-compose-review">Review order</button><button id="paper-compose-submit">Queue reviewed order</button><button id="paper-compose-check">Check submission</button><button id="paper-compose-new">New draft</button></div><p class="footnote" id="paper-compose-notice" role="status"></p><p class="paper-monitor-error" id="paper-compose-error" role="alert"></p><div id="paper-compose-review-body"></div><p class="footnote" id="paper-compose-chart-status"></p><div id="paper-compose-chart" aria-label="New paper order chart"></div><p class="footnote">Drag the amber price and optional red stop/green targets, or type exact values. Loading seeds only blank levels from the last settled close: entry at close, stop 2% below and targets 2%, 4% and 6% above. These are editable starting values. Candles never trigger fills. Review checks current funds, holdings and risk limits without reserving anything; Queue submits the reviewed order. A running monitor can then fill it. A single target uses the full entry quantity. With two or three targets in manual sizing, enter each quantity explicitly; the total must match the entry and prices must increase above it. Each target has its own linked stop slice and activates only after the entry fills. No exchange orders.</p></section>`;
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
  const sizingEnabled = () =>
    d.mode === "buy-limit" && d.bracket && d.riskSizing;
  const sizingArgs = () => ({
    symbol: d.symbol.trim().toUpperCase(),
    price: Number(d.price),
    stop: Number(d.stop),
    riskBudget: Number(d.riskBudget),
    maxNotional: Number(d.maxNotional),
    quantityStep: Number(d.quantityStep),
    feePercent: Number(d.feePercent),
    slippage: Number(d.slippage),
    targets: selectedTargets(d).map(([price], i) => ({
      price: Number(d[price]),
      percent: Number(d.targetCount) === 1 ? 100 : Number(d[percentFields[i]]),
    })),
  });
  const sized = () =>
    !sizingEnabled() || d.sizing?.fingerprint === JSON.stringify(sizingArgs());
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
            targets: selectedTargets(d).map(([price, quantity]) => ({
              price: Number(d[price]),
              quantity:
                Number(d.targetCount) === 1
                  ? Number(d.quantity)
                  : Number(d[quantity]),
            })),
          },
        }
      : {}),
  });
  const levels = () => [
    ["price", "PRICE", "#e9b45d"],
    ...(d.mode === "buy-limit" && d.bracket
      ? [
          ["stop", "STOP", "#e27685"],
          ...selectedTargets(d).map(([k], i) => [
            k,
            `TARGET ${i + 1}`,
            "#4db994",
          ]),
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
    const linked = d.mode === "buy-limit" && d.bracket;
    el("sizing-controls").hidden = !linked;
    el("sizing-fields").hidden = !sizingEnabled();
    el("calculate").disabled = frozen || !sizingEnabled();
    el("quantity").readOnly = sizingEnabled();
    percentFields.forEach((key, i) => {
      el(key).parentElement.hidden = i >= Number(d.targetCount);
      el(key).readOnly = Number(d.targetCount) === 1;
      el(key).value = Number(d.targetCount) === 1 && i === 0 ? "100" : d[key];
    });
    el("sizing-result").innerHTML = sizingEnabled()
      ? d.sizing && sized()
        ? `<p class="footnote"><strong>Calculated quantity ${esc(d.sizing.result.quantity)}</strong> · modeled stop loss ${esc(Number(d.sizing.result.risk.toPrecision(12)))} / ${esc(d.sizing.result.riskBudget)} USDT budget · scenario entry cost including fees ${esc(Number(d.sizing.result.estimatedEntryCost.toPrecision(12)))} USDT. ${d.sizing.result.targets.map((t, i) => `Target ${i + 1}: ${esc(t.quantity)}`).join(" · ")}. ${d.sizing.result.warnings.map(esc).join(" ")}</p>`
        : '<p class="footnote">Calculate quantity for the current inputs before reviewing. Displayed quantities may be from an earlier draft.</p>'
      : "";
    el("stop").parentElement.hidden = !linked;
    el("target-count-label").hidden = !linked;
    targetFields.forEach(([price, quantity], i) => {
      for (const k of [price, quantity])
        el(k).parentElement.hidden = !linked || i >= Number(d.targetCount);
      el(quantity).readOnly = sizingEnabled() || Number(d.targetCount) === 1;
      el(quantity).value =
        Number(d.targetCount) === 1 && i === 0 ? d.quantity : d[quantity];
    });
    for (const k of ["load", "review", "fit"]) el(k).disabled = frozen;
    el("review").disabled = frozen || !sized();
    el("submit").disabled = frozen || !d.preview || stale || !sized();
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
      ? `<p class="footnote"><strong>Reviewed account r${p.accountRevision}</strong> · ${esc(p.input.symbol)} · ${esc(p.input.side)} ${esc(p.input.type)} · ${p.input.quantity} @ ${p.input.price} · fee ${p.input.feePercent}% · slippage ${p.input.slippage}${p.input.bracket ? ` · linked stop ${p.input.bracket.stop}; ${p.input.bracket.targets.map((t, i) => `target ${i + 1}: ${t.quantity} @ ${t.price}`).join("; ")} (one stop/target pair per allocation)` : ""}<br>Additional cash reservation: ${money(p.reservedCashAdded)} USDT · additional held quantity reserved: ${p.reservedQuantityAdded}. Available cash: ${money(p.availableCashBefore)} → ${money(p.availableCashAfter)} USDT. No funds are reserved until Queue succeeds.</p>`
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
    d.sizing = null;
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
      d[k] = ["bracket", "riskSizing"].includes(k)
        ? e.target.checked
        : e.target.value;
      if (k === "symbol") {
        d.dataset = null;
        d.price = "";
        d.stop = "";
        for (const [k] of targetFields) d[k] = "";
        for (const v of ["price", "stop", ...targetFields.map(([k]) => k)])
          el(v).value = "";
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
      syncLines(k === "targetCount");
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
          ...selectedTargets(d).map(([k], i) => [
            k,
            data.bars.at(-1).close * (1 + (i + 1) * 0.02),
          ]),
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
  el("calculate").onclick = () =>
    run(async () => {
      if (!sizingEnabled())
        throw Error("Cash-risk sizing requires a limit buy with linked exits.");
      const args = sizingArgs(),
        fingerprint = JSON.stringify(args);
      changed();
      const result = await call("paperSize", args);
      if (!valid() || fingerprint !== JSON.stringify(sizingArgs())) return;
      d.quantity = String(result.order.quantity);
      el("quantity").value = d.quantity;
      selectedTargets(d).forEach(([, quantity], i) => {
        d[quantity] = String(result.order.bracket.targets[i].quantity);
        el(quantity).value = d[quantity];
      });
      d.sizing = { fingerprint, result };
      s.message =
        "Quantity calculated. Review the order to validate account cash and limits.";
    });
  el("fit").onclick = () => syncLines(true);
  el("review").onclick = () =>
    run(async () => {
      if (!sized())
        throw Error(
          "Calculate quantity for the current inputs before reviewing.",
        );
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
        !sized() ||
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
      if (["bracket", "riskSizing"].includes(k)) el(k).checked = d[k];
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
