import { Vela, registerNativeIndicator } from "@luxalgo/vela";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const type = "pine-desk-paper-order-levels";
registerNativeIndicator({
  type,
  title: "Paper order reference levels",
  overlay: true,
  paneHint: "price",
  legend: false,
  inputsSchema: () => [],
  defaultInputs: () => ({ levels: "[]" }),
  create() {
    let ctx, inputs;
    const emit = () =>
      ctx?.emit({
        priceLines: JSON.parse(inputs.levels).map((l, i) => ({
          id: `paper-ref-${i}`,
          paneId: "price",
          ...l,
          width: 1,
          lineStyle: "dashed",
        })),
      });
    return {
      start(c, i) {
        ctx = c;
        inputs = i;
        emit();
      },
      setInputs(i) {
        inputs = i;
        emit();
      },
      onBars: emit,
      onViewport() {},
      suspend() {},
      resume: emit,
      stop() {
        ctx = null;
      },
    };
  },
});
export function destroyPaperOrderEditor(s) {
  s.orderEditorController?.dispose();
  s.orderEditorController = null;
}
export function paperOrderEditorView(s) {
  return s.account
    ? '<section class="plot-card" id="paper-order-editor"><div class="panel-heading"><span>EDIT A PAPER ORDER ON THE CHART</span><span>Draft changes · explicit Apply</span></div><div id="paper-order-editor-body"></div></section>'
    : "";
}
export function bindPaperOrderEditor({
  s,
  call,
  operation,
  appearance = () => ({ theme: "dark" }),
}) {
  const host = document.getElementById("paper-order-editor-body");
  if (!host) return { paint() {}, bindRows() {} };
  destroyPaperOrderEditor(s);
  let chart = null,
    native = null,
    lineId = null,
    disposed = false,
    generation = 0,
    syncing = false,
    applying = false;
  const valid = () => !disposed && host.isConnected;
  const destroyChart = () => {
    generation++;
    chart?.destroy();
    chart = null;
    native = null;
    lineId = null;
  };
  const activeOrder = () =>
    s.account?.orders.find((o) => o.id === s.orderEdit?.id);
  const priceValid = () =>
    Number.isFinite(Number(s.orderEdit?.price)) &&
    Number(s.orderEdit.price) > 0 &&
    Number(s.orderEdit.price) <= 1e12;
  const paint = () => {
    if (!valid() || !s.orderEdit) return;
    const d = s.orderEdit,
      order = activeOrder(),
      terminal = order?.status !== "pending",
      stale = s.account.revision !== d.expectedRevision;
    const notice = document.getElementById("paper-edit-notice");
    if (notice)
      notice.textContent = terminal
        ? "This order is no longer pending. Choose another order; this draft cannot be applied."
        : stale
          ? "Account changed while editing. Reload order before applying; your draft is preserved until then."
          : "Drag the amber draft line or enter a price, then Apply. The saved order remains active until Apply succeeds.";
    const apply = document.getElementById("paper-edit-apply");
    if (apply)
      apply.disabled =
        applying ||
        terminal ||
        stale ||
        !priceValid() ||
        Number(d.price) === d.order.price;
    const error = document.getElementById("paper-edit-error");
    if (error) error.textContent = d.applyError || "";
    const input = document.getElementById("paper-edit-price");
    if (input) input.disabled = applying || terminal;
    if (chart && lineId) {
      const locked = applying || terminal;
      if (
        !!chart.drawings.all().find((l) => l.id === lineId)?.locked !== locked
      ) {
        syncing = true;
        try {
          chart.drawings.lock(lineId, locked);
        } finally {
          syncing = false;
        }
      }
    }
    const chartStatus = document.getElementById("paper-edit-chart-status");
    if (chartStatus)
      chartStatus.textContent =
        d.chartError ||
        (d.dataset
          ? `${d.dataset.origin} · ${d.dataset.timeframe} · last settled candle ${new Date(d.dataset.bars.at(-1).time).toISOString()} · snapshots do not process orders`
          : "Loading public candles… Numeric editing remains available if loading fails.");
  };
  const levels = (includeDraft = false) => {
    const d = s.orderEdit,
      list = [{ price: d.order.price, title: "Saved order", color: "#8c96a5" }];
    if (d.order.bracket) {
      list.push({
        price: d.order.bracket.stop,
        title: "Attached stop · activates on fill",
        color: "#e27685",
      });
      d.order.bracket.targets.forEach((t, i) =>
        list.push({
          price: t.price,
          title: `Attached target ${i + 1}`,
          color: "#4db994",
        }),
      );
    }
    if (d.sibling)
      list.push({
        price: d.sibling.price,
        title: `Paired ${d.sibling.leg} · saved`,
        color: d.sibling.leg === "stop" ? "#e27685" : "#4db994",
      });
    if (includeDraft && priceValid())
      list.push({
        price: Number(d.price),
        title: "Draft range",
        color: "transparent",
      });
    return list;
  };
  const addLine = () => {
    if (!chart || !s.orderEdit?.dataset || !priceValid()) return;
    const d = s.orderEdit;
    syncing = true;
    try {
      const line = chart.drawings.add("hline", {
        paneId: "price",
        anchors: [{ time: d.dataset.bars.at(-1).time, price: Number(d.price) }],
        style: { lineColor: "#e9b45d", lineWidth: 2, lineStyle: "solid" },
        text: {
          value: "DRAFT",
          size: "small",
          hAlign: "left",
          vAlign: "top",
        },
      });
      lineId = line?.id ?? null;
      if (!lineId)
        throw Error(
          "Interactive drawing is unavailable; use the numeric price field.",
        );
    } finally {
      syncing = false;
    }
  };
  const setLine = (fit = false) => {
    if (!chart || !priceValid()) {
      paint();
      return;
    }
    syncing = true;
    try {
      if (lineId)
        chart.drawings.update(lineId, {
          anchors: [
            {
              time: s.orderEdit.dataset.bars.at(-1).time,
              price: Number(s.orderEdit.price),
            },
          ],
        });
      else addLine();
      if (fit) native?.setInputs({ levels: JSON.stringify(levels(true)) });
    } finally {
      syncing = false;
    }
    const element = document.getElementById("paper-edit-chart");
    if (element) element.dataset.draftPrice = String(s.orderEdit.price);
    paint();
  };
  const mount = async () => {
    destroyChart();
    const d = s.orderEdit,
      node = document.getElementById("paper-edit-chart");
    if (!valid() || !node || !d?.dataset) return;
    const token = generation;
    node.dataset.ready = "false";
    try {
      chart = new Vela(node, {
        data: d.dataset.bars,
        symbol: d.order.symbol,
        timeframe: d.dataset.timeframe,
        ...appearance(),
        drawings: { toolbar: false },
        animations: { intro: false },
      });
      const instance = chart;
      await instance.ready();
      if (!valid() || generation !== token || chart !== instance) return;
      native = instance.addNativeIndicator(type);
      native.setInputs({ levels: JSON.stringify(levels(true)) });
      addLine();
      instance.on("drawing:edited", ({ id }) => {
        if (
          !valid() ||
          syncing ||
          applying ||
          id !== lineId ||
          activeOrder()?.status !== "pending"
        )
          return;
        const line = instance.drawings.all().find((l) => l.id === lineId),
          price = line?.anchors?.[0]?.price;
        if (!Number.isFinite(price)) return;
        d.price = String(Number(price.toPrecision(12)));
        document.getElementById("paper-edit-price").value = d.price;
        node.dataset.draftPrice = d.price;
        paint();
      });
      instance.on("drawing:removed", ({ id }) => {
        if (valid() && !syncing && id === lineId) {
          lineId = null;
          addLine();
          paint();
        }
      });
      node.dataset.ready = "true";
      node.dataset.draftPrice = d.price;
      paint();
    } catch (e) {
      if (valid() && generation === token) {
        d.chartError = e.message;
        destroyChart();
        paint();
      }
    }
  };
  const renderEditor = () => {
    destroyChart();
    const d = s.orderEdit;
    if (!d) {
      host.innerHTML =
        '<p class="footnote">Choose Edit on chart beside a pending limit or sell-stop order below.</p>';
      return;
    }
    host.innerHTML = `<div class="panel-heading"><span>${esc(d.order.symbol)} · ${esc(d.order.side)} ${esc(d.order.type)}${d.order.leg ? ` · linked ${esc(d.order.leg)}` : ""}</span><span>Order ${esc(d.id.slice(0, 8))} · account r${d.expectedRevision}</span></div><p class="footnote">Quantity ${esc(d.order.quantity)} · saved price ${esc(d.order.price)} · fee ${esc(d.order.feePercent)}% · slippage ${esc(d.order.slippage)}${d.order.plan ? ` · source plan ${esc(d.order.plan.name)} r${d.order.plan.revision}` : ""}</p><p class="footnote">${levels()
      .map((l) => `${esc(l.title)}: ${esc(l.price)}`)
      .join(
        " · ",
      )}</p><p id="paper-edit-notice" role="status" class="footnote"></p><p id="paper-edit-error" role="alert" class="footnote"></p><div class="searchbar"><label>Draft price (USDT)<input id="paper-edit-price" type="number" step="any" value="${esc(d.price)}"></label><button id="paper-edit-apply">Apply price edit</button><button id="paper-edit-reload">Reload order · discard draft</button><label>Candle interval<select id="paper-edit-timeframe">${["1m", "5m", "15m", "1h", "4h", "1d"].map((t) => `<option value="${t}" ${d.timeframe === t ? "selected" : ""}>${t}</option>`).join("")}</select></label><button id="paper-edit-candles">Refresh candles</button><button id="paper-edit-fit">Fit draft level</button></div><p id="paper-edit-chart-status" class="footnote"></p><div id="paper-edit-chart" data-order-id="${d.id}" aria-label="Paper order price editor"></div><p class="footnote">Only the amber line changes this price draft. Reference lines are saved levels. No quantity, cost assumption or source-plan edits. Attached bracket levels stay unchanged. Deleting a drawing does not cancel an order; use Cancel in the order list. Monitoring can fill orders while you edit; stale drafts must be reloaded.</p>`;
    document.getElementById("paper-edit-price").oninput = (e) => {
      d.price = e.target.value;
      setLine();
    };
    document.getElementById("paper-edit-fit").onclick = () => setLine(true);
    document.getElementById("paper-edit-candles").onclick = () =>
      operation(async () => {
        await candles();
      });
    document.getElementById("paper-edit-timeframe").onchange = () =>
      operation(async () => {
        d.timeframe = document.getElementById("paper-edit-timeframe").value;
        await candles();
      });
    document.getElementById("paper-edit-reload").onclick = () =>
      operation(async () => {
        await open(d.id);
      });
    document.getElementById("paper-edit-apply").onclick = () =>
      operation(async () => {
        const price = Number(d.price);
        d.applyError = "";
        applying = true;
        paint();
        try {
          s.account = await call("paperAmend", {
            id: d.id,
            expectedRevision: d.expectedRevision,
            price,
          });
          if (!valid()) return;
          choose(d.id, d.dataset);
          renderEditor();
          await mount();
          s.message =
            "Paper order price updated. Its next fill requires a new quote requested after the edit.";
        } catch (e) {
          d.applyError = e.message;
          throw e;
        } finally {
          applying = false;
          paint();
        }
      });
    paint();
  };
  const choose = (id, dataset) => {
    const order = s.account?.orders.find((o) => o.id === id);
    if (!order || order.status !== "pending" || order.type === "market")
      throw Error("Choose a pending limit or sell-stop order.");
    s.orderEdit = {
      id,
      order: structuredClone(order),
      price: String(order.price),
      expectedRevision: s.account.revision,
      timeframe: s.orderEdit?.timeframe ?? "1h",
      dataset: dataset?.symbol === order.symbol ? dataset : null,
      chartError: dataset ? "" : (s.orderEdit?.chartError ?? ""),
      sibling: order.ocoGroup
        ? s.account.orders.find(
            (o) =>
              o.id !== id &&
              o.ocoGroup === order.ocoGroup &&
              o.status === "pending",
          )
        : null,
    };
  };
  const candles = async () => {
    const d = s.orderEdit;
    d.chartError = "";
    try {
      const data = await call("paperOrderChart", {
        id: d.id,
        timeframe: d.timeframe,
      });
      if (!valid() || s.orderEdit !== d) return;
      if (
        data.orderId !== d.id ||
        data.symbol !== d.order.symbol ||
        data.timeframe !== d.timeframe
      )
        throw Error("Chart response does not match the selected order.");
      d.dataset = data;
      await mount();
    } catch (e) {
      if (valid() && s.orderEdit === d) {
        d.dataset = null;
        d.chartError = `Candles unavailable: ${e.message} Numeric editing remains available.`;
        destroyChart();
        document.getElementById("paper-edit-chart").replaceChildren();
      }
    }
    paint();
  };
  const open = async (id) => {
    const old = s.orderEdit;
    s.account = await call("paperSnapshot");
    if (!valid()) return;
    choose(id, old?.id === id ? old.dataset : null);
    renderEditor();
    document
      .getElementById("paper-order-editor")
      .scrollIntoView({ block: "start" });
    if (s.orderEdit.dataset) await mount();
    else await candles();
  };
  const controller = {
    paint,
    bindRows() {
      document.querySelectorAll("[data-paper-edit]").forEach((el) => {
        el.onclick = () =>
          operation(async () => {
            await open(el.dataset.paperEdit);
          });
      });
    },
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
  s.orderEditorController = controller;
  renderEditor();
  if (s.orderEdit?.dataset) void mount();
  return controller;
}
