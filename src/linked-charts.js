import { Vela } from "@luxalgo/vela";
import { PineWorkerEngine } from "@luxalgo/vela-pinets";
import { captureChart, restoreChart } from "./workspace-customization.js";
import { makeLiveChartFeed } from "./live-chart-feed.js";
import { datasetInstrument } from "../core/instruments.js";

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function linkedToolbar(layout) {
  return `<div class="linked-toolbar" aria-label="Linked charts"><label>Chart layout <select id="chart-count">${[1, 2, 4].map((n) => `<option value="${n}" ${n === layout.count ? "selected" : ""}>${n === 1 ? "Single chart" : n + " charts"}</option>`).join("")}</select></label><span>Link</span>${[
    ["linkSymbol", "Symbol"],
    ["linkTimeframe", "Timeframe"],
    ["linkRange", "Time range"],
    ["linkCrosshair", "Crosshair"],
  ]
    .map(
      ([key, label]) =>
        `<label><input type="checkbox" data-chart-link="${key}" ${layout[key] ? "checked" : ""}>${label}</label>`,
    )
    .join("")}<small>Editor & backtests use the primary chart</small></div>`;
}
export function comparisonCards(layout, liveIds) {
  return layout.panels
    .slice(0, layout.count - 1)
    .map(
      (p, i) =>
        `<section class="chart-panel comparison-panel" data-panel="${p.id}"><div class="comparison-controls"><strong>${i + 2}</strong><label><span class="sr-only">${p.id} symbol</span><input data-panel-symbol="${p.id}" value="${esc(p.symbol)}" maxlength="24" ${layout.linkSymbol ? "disabled" : ""}></label><select data-panel-timeframe="${p.id}" aria-label="${p.id} timeframe" ${layout.linkTimeframe ? "disabled" : ""}>${["1m", "5m", "15m", "1h", "4h", "1d"].map((t) => `<option ${t === p.timeframe ? "selected" : ""}>${t}</option>`).join("")}</select><button data-panel-load="${p.id}">Load</button><label><input type="checkbox" data-panel-live="${p.id}" ${liveIds.has(p.id) ? "checked" : ""}>Live</label></div><div id="${p.id}" class="comparison-chart"></div><p data-panel-status="${p.id}" class="comparison-status" role="status">Loading comparison…</p></section>`,
    )
    .join("");
}

export class LinkedCharts {
  constructor({ getLayout, getPrimary, appearance, call, changed, error }) {
    Object.assign(this, {
      getLayout,
      getPrimary,
      appearance,
      call,
      changed,
      error,
    });
    this.liveIds = new Set();
    this.views = new Map();
    this.snapshots = [];
    this.generation = 0;
    this.requestGeneration = 0;
    this.signature = "";
    this.syncing = false;
    this.polling = false;
  }
  capture(withData = false) {
    const layout = this.getLayout();
    for (const p of layout.panels) {
      const view = this.views.get(p.id);
      if (view?.ready) p.chart = captureChart(view.chart, view.dataset);
    }
    return {
      ...layout,
      panels: layout.panels.map((p) => ({
        ...p,
        dataset: withData
          ? (this.snapshots.find((s) => s.id === p.id)?.dataset ?? p.dataset)
          : null,
      })),
    };
  }
  destroyViews() {
    this.generation++;
    this.primaryOff?.();
    this.primaryCrossOff?.();
    this.primaryOff = null;
    this.primaryCrossOff = null;
    for (const view of this.views.values()) {
      view.chart.destroy();
      view.engine.terminate();
    }
    this.views.clear();
  }
  reset(layout) {
    this.destroyViews();
    this.requestGeneration++;
    this.liveIds.clear();
    this.signature = "";
    this.snapshots = layout.panels
      .filter((p) => p.dataset)
      .map((p) => ({
        id: p.id,
        dataset: p.dataset,
        status: "saved snapshot",
        active: false,
      }));
    this.saved = this.snapshots.length > 0;
  }
  requests() {
    const layout = this.getLayout(),
      primary = this.getPrimary().dataset;
    return layout.panels.slice(0, layout.count - 1).map((p) => {
      if (layout.linkSymbol && /Binance/.test(primary.origin))
        p.symbol = primary.symbol;
      if (layout.linkTimeframe) p.timeframe = primary.timeframe;
      if (
        p.dataset &&
        (p.dataset.symbol !== p.symbol || p.dataset.timeframe !== p.timeframe)
      )
        p.dataset = null;
      return {
        id: p.id,
        symbol: p.symbol,
        timeframe: p.timeframe,
        live: this.liveIds.has(p.id),
      };
    });
  }
  async configure(force = false) {
    const requests = this.requests(),
      signature = JSON.stringify(requests);
    // A render may replace chart DOM while REST is pending. Every replacement
    // awaits the same request instead of mounting against an empty old snapshot.
    if (!force && signature === this.signature) return this.pending;
    this.signature = signature;
    const revision = ++this.requestGeneration;
    const pending = (async () => {
      try {
        if (this.saved && !force) {
          await this.call("chartPanelsConfigure", { panels: [] });
          return;
        }
        this.saved = false;
        const snapshots = await this.call("chartPanelsConfigure", {
          panels: requests,
          refresh: force,
        });
        if (revision === this.requestGeneration) this.snapshots = snapshots;
      } catch (e) {
        if (revision === this.requestGeneration) this.signature = "";
        throw e;
      }
    })();
    this.pending = pending;
    try {
      await pending;
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }
  async mount(primaryChart) {
    const generation = this.generation;
    this.primaryOff = primaryChart.on("viewport:changed", () =>
      this.syncRange(primaryChart),
    );
    this.primaryCrossOff = primaryChart.renderer.onCrosshairMove((event) =>
      this.syncCrosshair(primaryChart, this.getPrimary().dataset.symbol, event),
    );
    await this.configure();
    if (generation !== this.generation) return;
    await this.paint(generation);
    if (this.getLayout().linkRange) this.syncRange(primaryChart);
  }
  async paint(generation = this.generation) {
    for (const s of this.snapshots) {
      if (generation !== this.generation) return;
      const node = document.getElementById(s.id),
        status = document.querySelector(`[data-panel-status="${s.id}"]`);
      if (!node || !status) continue;
      status.textContent = `${s.dataset?.symbol ?? s.symbol ?? ""} ${s.dataset?.timeframe ?? s.timeframe ?? ""} · ${s.status}${s.error ? " · " + s.error : ""}${s.sharedWithPrimary ? " · shared primary stream" : ""}${s.lastMessageAt ? " · " + new Date(s.lastMessageAt).toLocaleTimeString() : ""}${s.candleGaps?.length ? " · candle gaps: " + s.candleGaps.length : ""}`;
      if (!s.dataset?.bars.length) continue;
      const identity = `${s.dataset.symbol}:${s.dataset.timeframe}:${!!s.active}`;
      let view = this.views.get(s.id);
      if (view && view.identity !== identity) {
        view.chart.destroy();
        view.engine.terminate();
        this.views.delete(s.id);
        view = null;
      }
      if (!view) {
        const feed = s.active
          ? makeLiveChartFeed(
              () => this.snapshots.find((x) => x.id === s.id) ?? s,
            )
          : null;
        const chart = new Vela(
          node,
          {
            ...(feed
              ? {
                  symbol: s.dataset.symbol,
                  live: true,
                  bars: s.dataset.bars.length,
                }
              : { data: s.dataset.bars }),
            timeframe: s.dataset.timeframe,
            ...this.appearance(),
            animations: { intro: false },
          },
          feed ? { dataFeed: feed } : undefined,
        );
        const engine = new PineWorkerEngine();
        chart.registerEngine("pine", engine);
        view = {
          chart,
          engine,
          feed,
          dataset: s.dataset,
          identity,
          ready: false,
        };
        this.views.set(s.id, view);
        await chart.ready();
        if (generation !== this.generation) return;
        const p = this.getLayout().panels.find((x) => x.id === s.id);
        // Drawings and saved studies belong to their original market.
        const saved =
          p.chart?.symbol === s.dataset.symbol &&
          p.chart?.timeframe === s.dataset.timeframe
            ? p.chart
            : null;
        if (saved) {
          let timer;
          try {
            await Promise.race([
              restoreChart(chart, saved, this.error),
              new Promise((_, reject) => {
                timer = setTimeout(
                  () =>
                    reject(
                      Error(
                        "Comparison indicator restore exceeded 30 seconds.",
                      ),
                    ),
                  30000,
                );
              }),
            ]);
          } catch (error) {
            if (generation === this.generation) {
              p.chart = null;
              chart.destroy();
              engine.terminate();
              this.views.delete(s.id);
              status.textContent =
                error.message + " Click Load to reopen this market.";
              this.error(error);
            }
            return;
          } finally {
            clearTimeout(timer);
          }
        }
        if (generation !== this.generation) return;
        view.ready = true;
        node.dataset.ready = "true";
        if (this.getPrimary().chart) this.syncRange(this.getPrimary().chart);
        chart.on("viewport:changed", () => {
          this.syncRange(chart);
          this.changed();
        });
        chart.renderer.onCrosshairMove((event) =>
          this.syncCrosshair(chart, view.dataset.symbol, event),
        );
        for (const event of [
          "drawing:created",
          "drawing:edited",
          "drawing:removed",
          "indicator:added",
          "indicator:removed",
          "indicator:inputs",
          "indicator:visibility",
          "pane:changed",
        ])
          chart.on(event, this.changed);
      } else if (s.active && view.ready) {
        const prev = view.dataset.bars,
          bars = s.dataset.bars;
        if (
          prev[0]?.time !== bars[0]?.time ||
          (prev.at(-1)?.time !== bars.at(-2)?.time &&
            prev.at(-1)?.time !== bars.at(-1)?.time)
        ) {
          await view.chart.setMarket({
            data: s.forming ? [...bars, s.forming] : bars,
            visibleRange: view.chart.getVisibleRange(),
          });
        } else view.feed?.push(s);
      }
      view.dataset = s.dataset;
    }
  }
  updateAppearance() {
    for (const { chart } of this.views.values()) {
      const appearance = this.appearance();
      chart.setTheme(appearance.theme);
      chart.renderer.set({
        upColor: appearance.upColor,
        downColor: appearance.downColor,
      });
    }
  }
  allCharts() {
    return [
      this.getPrimary().chart,
      ...[...this.views.values()].filter((v) => v.ready).map((v) => v.chart),
    ].filter(Boolean);
  }
  syncRange(source) {
    if (this.syncing || !this.getLayout().linkRange) return;
    const range = source.getVisibleRange();
    if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to))
      return;
    this.syncing = true;
    try {
      for (const chart of this.allCharts()) {
        if (chart === source) continue;
        const old = chart.getVisibleRange();
        if (
          !old ||
          Math.abs(old.from - range.from) > 1 ||
          Math.abs(old.to - range.to) > 1
        )
          chart.setVisibleRange(range);
      }
    } finally {
      this.syncing = false;
    }
  }
  syncCrosshair(source, symbol, event) {
    if (!this.getLayout().linkCrosshair) return;
    for (const chart of this.allCharts()) {
      if (chart === source) continue;
      const targetSymbol =
        chart === this.getPrimary().chart
          ? this.getPrimary().dataset.symbol
          : [...this.views.values()].find((v) => v.chart === chart)?.dataset
              .symbol;
      chart.renderer.setExternalCrosshair(
        event.time,
        symbol === targetSymbol && event.paneKind !== "study"
          ? event.price
          : null,
      );
    }
  }
  async poll() {
    if (this.polling || this.saved || !this.liveIds.size) return;
    this.polling = true;
    const revision = this.requestGeneration;
    try {
      const snapshots = await this.call("chartPanelsSnapshot");
      if (revision !== this.requestGeneration) return;
      this.snapshots = snapshots;
      await this.paint();
    } catch (e) {
      this.error(e);
    } finally {
      this.polling = false;
    }
  }
  describe(visible) {
    return this.getLayout()
      .panels.slice(0, this.getLayout().count - 1)
      .map((p) => {
        const s = this.snapshots.find((x) => x.id === p.id),
          view = this.views.get(p.id),
          dataset = s?.dataset;
        return {
          id: p.id,
          visible,
          instrument: dataset ? datasetInstrument(dataset) : null,
          timeframe: dataset?.timeframe ?? p.timeframe,
          settledBars: dataset?.bars.length ?? 0,
          firstBarAt: dataset?.bars[0]?.time ?? null,
          lastBarAt: dataset?.bars.at(-1)?.time ?? null,
          range: view?.ready
            ? view.chart.getVisibleRange()
            : (p.chart?.range ?? null),
          live: {
            active: !!s?.active,
            status: s?.status ?? "unloaded",
            error: s?.error ?? null,
          },
        };
      });
  }
}
