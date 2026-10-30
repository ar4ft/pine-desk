import {
  newPaperState,
  retainPaperDraft,
  paperView,
  bindPaper,
} from "./paper-view.js";
import "./paper-style.css";
import {
  newPlansState,
  retainPlanDraft,
  primeTradePlan,
  plansView,
  bindPlans,
} from "./trade-plans-view.js";
import "./trade-plans-style.css";
import {
  newVolumeProfileState,
  retainVolumeProfileDraft,
  volumeProfileView,
  bindVolumeProfile,
} from "./volume-profile-view.js";
import {
  newFootprintState,
  footprintControls,
  readFootprintSettings,
  footprintResults,
  bindFootprints,
} from "./footprint-view.js";
import "./footprint-style.css";
import {
  newDepthHistoryState,
  depthHistoryView,
  retainDepthHistoryDraft,
  DepthHistoryView,
} from "./depth-history-view.js";
import {
  newDepthState,
  depthView,
  retainDepthDraft,
  pollDepth,
  bindDepth,
} from "./depth-view.js";
import "./depth-style.css";
import {
  newAlertsState,
  alertsView,
  retainAlertDraft,
  primeAlert,
  refreshAlerts,
  paintAlerts,
  bindAlerts,
} from "./alerts-view.js";
import "./alerts-style.css";
import { chartLayout } from "../core/chart-layout.js";
import {
  LinkedCharts,
  linkedToolbar,
  comparisonCards,
} from "./linked-charts.js";
import "./linked-charts.css";
import { uiIcon, navGroups } from "./ui-icons.js";
import { version } from "../package.json";
import { agentConfig, agentAccessView } from "./agent-access.js";
import { datasetInstrument } from "../core/instruments.js";
import {
  workflowView,
  qualityView,
  bindWorkflow,
} from "./research-workflow.js";
import { Vela } from "@luxalgo/vela";
import { PineWorkerEngine } from "@luxalgo/vela-pinets";
import { examples } from "../core/examples.js";
import { demoBars, durations } from "../core/data.js";
import "./style.css";
import {
  defaultAppearance,
  resolvedTheme,
  applyAppearance,
  appearanceView,
  layoutView,
  watchlistView,
  captureChart,
  restoreChart,
} from "./workspace-customization.js";
import "./customization-style.css";
import {
  newOptionsState,
  retainOptionsDraft,
  optionsView,
  paintOptions,
  bindOptions,
} from "./options-view.js";
import { settingsView, bindProviderSettings } from "./provider-settings.js";
import {
  attachOptionsChart,
  createOptionsPriceChart,
} from "./options-chart.js";
import "./options-style.css";
import {
  newLearningState,
  learningView,
  bindLearning,
} from "./options-learning.js";
import {
  newCryptoState,
  cryptoView,
  bindCrypto,
  paintCrypto,
} from "./crypto-options-view.js";
import "./options-learning.css";
import { paintRecording } from "./option-research-view.js";
import { makeLiveChartFeed } from "./live-chart-feed.js";
import { mountPineEditor } from "./pine-editor.js";
import { executionDiagnostic } from "../core/diagnostics.js";
import {
  newResearchState,
  retainResearchDraft,
  researchView,
  bindResearch,
  paintComparison,
} from "./research-view.js";
import "./research-style.css";
import {
  newEdgeState,
  retainEdgeDraft,
  edgeView,
  bindEdge,
} from "./edge-view.js";
import "./edge-style.css";
import "./design-system.css";
import {
  newWhaleState,
  retainWhaleDraft,
  whaleView,
  bindWhale,
} from "./whale-view.js";

const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const num = (v, d = 2) =>
  Number.isFinite(v)
    ? v.toLocaleString("en-US", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      })
    : "—";
const money = (v) => `${v < 0 ? "−" : ""}$${num(Math.abs(v))}`;
const date = (t) =>
  new Date(t).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
const titles = {
  workspace: "Chart workspace",
  alerts: "Local alerts",
  plans: "Trade plans",
  paper: "Paper trading",
  library: "Indicator library",
  backtest: "Strategy research",
  orderflow: "Order flow",
  mcp: "Connect your agent",
  edge: "Edge Stats",
  whale: "Whale Options",
  options: "Options chart",
  crypto: "Crypto options",
  education: "Greeks Lab",
  settings: "Settings",
};
const state = {
  depthHistory: newDepthHistoryState(),
  depth: newDepthState(),
  flowTab: "trades",
  volumeProfile: newVolumeProfileState(),
  tpoProfile: newVolumeProfileState("tpo"),
  alerts: newAlertsState(),
  plans: newPlansState(),
  paper: newPaperState(),
  learning: newLearningState(),
  crypto: newCryptoState(),
  appearance: defaultAppearance,
  watchlist: [],
  quotes: {},
  layouts: [],
  chartMemory: null,
  multiChart: chartLayout(),
  watchLive: { active: false, status: "stopped", quotes: {} },
  options: newOptionsState(),
  providerSettings: null,
  agentAccess: null,
  research: newResearchState(),
  diagnostic: null,
  live: { status: "stopped", active: false },
  flowSource: "imported",
  footprint: newFootprintState(),
  flowSettings: {
    timeframe: "1h",
    tickSize: 10,
    imbalanceRatio: 3,
    minImbalanceVolume: 0,
    stackLength: 3,
    zeroDenominator: "exclude",
    valueAreaPercent: 70,
  },
  whale: newWhaleState(),
  edge: newEdgeState(),
  page: "workspace",
  tab: "performance",
  dataset: {
    bars: demoBars(),
    symbol: "DEMO",
    timeframe: "1h",
    origin: "Synthetic demonstration",
  },
  scripts: examples,
  source: localStorage.getItem("pine-desk-draft") ?? examples[0].source,
  name: "EMA crossover strategy",
  runs: [],
  run: null,
  library: null,
  libraryPage: 0,
  flow: null,
  busy: false,
  editor: true,
  settings: {
    initial_capital: 10000,
    default_qty_value: 20,
    commission_value: 0.1,
    slippage: 2,
    pyramiding: 1,
  },
};
let chart,
  engine,
  handle,
  pineEditor,
  chartFeed,
  optionsOverlay,
  chartOwner,
  chartIdentity,
  optionsBarsRevision = "";
let chartMount = Promise.resolve();
const api = window.desk;
const linkedCharts = new LinkedCharts({
  getLayout: () => state.multiChart,
  getPrimary: () => ({
    chart: chartOwner === "workspace" ? chart : null,
    dataset: state.dataset,
  }),
  appearance: chartAppearance,
  call: (action, args) => (api ? call(action, args) : Promise.resolve([])),
  changed: scheduleSession,
  error: (e) => toast(e.message, true),
});
let alertsPolling = false;
let hydrated = !api,
  restoringChart = false,
  sessionTimer;
try {
  const saved = JSON.parse(localStorage.getItem("pine-desk-session"));
  if (
    saved &&
    typeof saved.source === "string" &&
    saved.source.length <= 200000
  ) {
    state.source = saved.source;
    state.name = saved.name ?? state.name;
    state.editor = saved.editor !== false;
    state.page = titles[saved.page] ? saved.page : "workspace";
    state.tab = ["performance", "log", "analysis", "simulation"].includes(
      saved.tab,
    )
      ? saved.tab
      : "performance";
    state.settings = { ...state.settings, ...saved.settings };
    state.research.inputs = saved.inputs ?? "{}";
    state.chartMemory = saved.chart ?? null;
    state.multiChart = chartLayout(saved.multiChart);
  }
} catch {}
applyAppearance(state.appearance);
function captureWorkspaceChart() {
  if (hydrated && chart && chartOwner === "workspace" && !restoringChart)
    state.chartMemory = captureChart(chart, chartIdentity);
}
function sessionSnapshot(withData = false) {
  saveDraft();
  retainResearchDraft(state.research);
  captureWorkspaceChart();
  return {
    page: state.page,
    editor: state.editor,
    source: state.source,
    name: state.name,
    settings: state.settings,
    inputs: state.research.inputs,
    tab: state.tab,
    chart: state.chartMemory,
    dataset: withData ? state.dataset : null,
    multiChart: linkedCharts.capture(withData),
  };
}
function persistSession() {
  try {
    localStorage.setItem(
      "pine-desk-session",
      JSON.stringify(sessionSnapshot()),
    );
  } catch (e) {
    toast("Workspace persistence failed: " + e.message, true);
  }
}
function scheduleSession() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(persistSession, 300);
}
function chartAppearance() {
  const theme = resolvedTheme(state.appearance);
  return {
    ...state.appearance,
    theme,
    upColor:
      theme === "light" &&
      state.appearance.upColor === defaultAppearance.upColor
        ? "#198467"
        : state.appearance.upColor,
    downColor:
      theme === "light" &&
      state.appearance.downColor === defaultAppearance.downColor
        ? "#bd4259"
        : state.appearance.downColor,
  };
}
function updateAppearance() {
  linkedCharts.updateAppearance();
  applyAppearance(state.appearance);
  if (chart) {
    chart.setTheme(resolvedTheme(state.appearance));
    chart.renderer.set({
      upColor: chartAppearance().upColor,
      downColor: chartAppearance().downColor,
    });
  }
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.appearance.theme === "system") updateAppearance();
});
window.addEventListener("beforeunload", persistSession);
async function call(action, args) {
  if (!api)
    throw new Error(
      "Open Pine Desk in the desktop app to load data, save, backtest, or connect MCP. Browser preview renders the synthetic chart.",
    );
  try {
    return await api.call(action, args);
  } catch (error) {
    const start = error.message.indexOf('{"pineDeskError"');
    if (start >= 0) {
      try {
        const parsed = JSON.parse(error.message.slice(start));
        const e = new Error(parsed.diagnostic.message);
        e.diagnostic = parsed.diagnostic;
        throw e;
      } catch (e) {
        if (e.diagnostic) throw e;
      }
    }
    throw error;
  }
}
function toast(message, error = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = `toast show ${error ? "error" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.className = "toast"), 6500);
}
function syncBusyControls() {
  document
    .querySelectorAll(
      "#depth-start, #depth-limit, [data-flow-tab], #toggle-editor, #chart-count, [data-chart-link], [data-panel-load], [data-panel-live], #alert-save, #alerts-toggle, #alerts-notifications, [data-alert-edit], [data-alert-enable], [data-alert-delete], [data-alert-ack]",
    )
    .forEach((el) => {
      el.disabled = state.busy;
    });
  depthHistoryController.controls();
  if ($("#depth-stop"))
    $("#depth-stop").disabled = state.busy || !state.depth.snapshot?.active;
}
async function pollOrderBook() {
  if (
    !api ||
    state.page !== "orderflow" ||
    state.flowTab !== "depth" ||
    state.busy
  )
    return;
  await pollDepth(
    state.depth,
    call,
    () =>
      !state.busy && state.page === "orderflow" && state.flowTab === "depth",
  );
}
async function task(fn) {
  if (state.busy) return;
  state.busy = true;
  syncBusyControls();
  $("#status").textContent = "Working…";
  try {
    await fn();
  } catch (e) {
    toast(e.message, true);
  } finally {
    state.busy = false;
    syncBusyControls();
    $("#status").textContent = "Local workspace";
  }
}
function settings() {
  return state.settings;
}
function saveDraft() {
  if (pineEditor) state.source = pineEditor.getValue();
  else if ($("#source")) state.source = $("#source").value;
  localStorage.setItem("pine-desk-draft", state.source);
  if ($("#script-name")) state.name = $("#script-name").value;
}
function setSource(source) {
  state.source = source;
  if (pineEditor) pineEditor.setValue(source);
  if ($("#source")) $("#source").value = source;
  localStorage.setItem("pine-desk-draft", source);
}
function editorError(error) {
  state.diagnostic =
    error.diagnostic ??
    executionDiagnostic(
      error,
      /transpil|parse|syntax|Unexpected token/i.test(error.message)
        ? "compile"
        : "execution",
    );
  pineEditor?.diagnostic(state.diagnostic);
  const panel = $("#editor-errors");
  if (panel) {
    panel.innerHTML = errorView();
    if ($("#jump-error"))
      $("#jump-error").onclick = () =>
        pineEditor?.jumpTo(state.diagnostic?.line);
  }
}
function errorView() {
  const d = state.diagnostic;
  return d
    ? `<strong>${esc(d.phase)} error${d.line ? ` · line ${d.line}` : ""}</strong><br>${esc(d.message)}<br><small>${esc(d.hint)}</small>${d.line ? '<br><button id="jump-error">Go to line</button>' : ""}`
    : "";
}
function baseInputs() {
  retainResearchDraft(state.research);
  let inputs;
  try {
    inputs = JSON.parse(state.research.inputs);
  } catch {
    throw new Error("Base inputs must be a JSON object.");
  }
  return inputs;
}

function setChartFocus(active) {
  state.focusChart = active;
  document.body.dataset.focus = active ? "chart" : "";
  const button = document.querySelector("#focus-chart");
  if (button) {
    button.setAttribute("aria-pressed", String(active));
    button.querySelector("span").textContent = active
      ? "Exit focus"
      : "Focus chart";
    button.querySelector("kbd").textContent = active
      ? "Esc"
      : navigator.platform.includes("Mac")
        ? "⌘⇧F"
        : "Ctrl⇧F";
  }
}
window.addEventListener("keydown", (event) => {
  if (state.page !== "workspace") return;
  if (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === "f"
  ) {
    event.preventDefault();
    setChartFocus(!state.focusChart);
  } else if (event.key === "Escape" && state.focusChart) setChartFocus(false);
});

const depthHistoryController = new DepthHistoryView({
  busy: () => state.busy,
  state: state.depthHistory,
  call,
  task,
  exportFile,
  canPaint: () => state.page === "orderflow" && state.flowTab === "history",
});
function destroyChart() {
  linkedCharts.destroyViews();
  chartOwner = null;
  optionsOverlay = null;
  handle = null;
  chart?.destroy();
  engine?.terminate();
  chart = null;
  engine = null;
  chartFeed = null;
}
function render() {
  linkedCharts.requests();
  const destinationChanged = document.body.dataset.section !== state.page;
  captureWorkspaceChart();
  linkedCharts.capture();
  retainVolumeProfileDraft(state.volumeProfile);
  retainVolumeProfileDraft(state.tpoProfile);
  retainDepthHistoryDraft(state.depthHistory);
  retainDepthDraft(state.depth);
  retainAlertDraft(state.alerts);
  retainPlanDraft(state.plans);
  retainPaperDraft(state.paper);
  retainOptionsDraft(state.options);
  retainResearchDraft(state.research);
  retainWhaleDraft(state.whale);
  retainEdgeDraft(state.edge);
  saveDraft();
  pineEditor?.destroy();
  pineEditor = null;
  destroyChart();
  $("#nav").innerHTML = navGroups
    .map(
      ([label, keys]) =>
        `<div class="nav-group"><div class="nav-group-label">${label}</div>${keys.map((key) => `<button class="nav-item ${state.page === key ? "active" : ""}" data-page="${key}" ${state.page === key ? 'aria-current="page"' : ""}><span>${uiIcon(key)}</span>${titles[key].replace("Chart workspace", "Workspace").replace("Indicator library", "Library").replace("Strategy research", "Backtests").replace("Connect your agent", "MCP & setup")}</button>`).join("")}</div>`,
    )
    .join("");
  document.body.dataset.section = state.page;
  document.body.dataset.focus =
    state.page === "workspace" && state.focusChart ? "chart" : "";
  $("#title").textContent = titles[state.page];
  state.research.currentSource = state.source;
  state.research.currentSettings = state.settings;
  $("#page").innerHTML = {
    workspace: workspace,
    alerts: () => alertsView(state.alerts),
    plans: () => plansView(state.plans),
    paper: () => paperView(state.paper),
    library: library,
    backtest: backtests,
    orderflow: flow,
    mcp: mcp,
    edge: () => edgeView(state.edge),
    whale: () => whaleView(state.whale),
    options: () => optionsView(state.options),
    crypto: () => cryptoView(state.crypto),
    education: () => learningView(state.learning),
    settings: () =>
      appearanceView(state.appearance) + settingsView(state.providerSettings),
  }[state.page]();
  if (["workspace", "backtest", "crypto", "options"].includes(state.page))
    $("#page").insertAdjacentHTML("afterbegin", workflowView(state));
  bind();
  syncBusyControls();
  bindWorkflow({
    navigate: (page, step) => {
      if (state.busy) return;
      state.page = page;
      if (step === "1") state.editor = true;
      render();
      const target =
        step === "0"
          ? "#load-market"
          : step === "1"
            ? "#pine-editor"
            : step === "2"
              ? "#strategy-audit"
              : step === "3"
                ? "#compare-runs"
                : "#crypto-refresh";
      document
        .querySelector(target)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
      document.querySelector(target)?.focus();
    },
  });
  if (state.page === "workspace") {
    chartMount = mountChart();
    chartMount.catch((error) => toast(error.message, true));
    mountEditor();
  }
  updateLiveStatus();
  if (state.page === "edge" && state.edge.session) mountEdgeChart();
  if (state.page === "backtest") {
    if (state.run) paintBacktest();
    requestAnimationFrame(() => paintComparison(state.research.comparison));
  }
  if (state.page === "orderflow" && state.flowTab === "trades" && state.flow)
    paintFlow();
  scheduleSession();
  if (state.page === "options") {
    paintOptions(state.options);
    mountOptionsChart().catch((e) => toast(e.message, true));
  }
  if (destinationChanged) window.scrollTo({ top: 0, behavior: "instant" });
}
function workspace() {
  const b = state.dataset.bars,
    last = b.at(-1),
    change = (last.close / b[0].close - 1) * 100;
  return `<div class="market-overview"><div class="market-title"><span class="market-symbol">${uiIcon("workspace")}</span><div><strong>${esc(state.dataset.symbol)}</strong><small>${esc(state.dataset.origin)}</small></div></div><strong class="price" id="market-price">${num(last.close)}</strong><span id="market-change" class="${change >= 0 ? "positive" : "negative"}">${change >= 0 ? "+" : ""}${num(change)}%</span></div><div class="marketbar"><label class="sr-only" for="symbol">Market symbol</label><input id="symbol" aria-label="Market symbol" value="${esc(state.dataset.symbol === "DEMO" ? "BTCUSDT" : state.dataset.symbol)}" maxlength="24"><select id="timeframe" aria-label="Timeframe">${["1m", "5m", "15m", "1h", "4h", "1d"].map((t) => `<option ${t === state.dataset.timeframe ? "selected" : ""}>${t}</option>`).join("")}</select><label>History bars<input id="history-limit" type="number" min="2" max="50000" value="1000" style="width:85px"></label><button id="load-market">Load market</button><button id="live-start" class="primary">Start live</button><button id="live-stop" ${state.live.active ? "" : "disabled"}>Stop live</button><button id="import-bars">Import CSV</button><button id="create-price-alert">Price alert</button><button id="create-trade-plan">Trade plan</button><div class="spacer"></div><button id="toggle-editor" class="icon-btn" title="Toggle editor" aria-label="Toggle editor">${uiIcon("mcp")}</button><button id="focus-chart" aria-pressed="${!!state.focusChart}" title="Focus chart (⌘⇧F)">${uiIcon("focus")}<span>${state.focusChart ? "Exit focus" : "Focus chart"}</span><kbd>${state.focusChart ? "Esc" : navigator.platform.includes("Mac") ? "⌘⇧F" : "Ctrl⇧F"}</kbd></button></div><p id="live-status"></p>${linkedToolbar(state.multiChart)}<div class="workspace-grid ${state.editor ? "" : "no-editor"} ${state.multiChart.count > 1 ? "has-comparisons" : ""}"><div class="chart-matrix" data-chart-count="${state.multiChart.count}"><section class="chart-panel primary-chart"><span class="primary-chart-label" ${state.multiChart.count === 1 ? "hidden" : ""}>1 · Primary · Editor & backtests</span><div class="panel-heading"><span>Price action <i class="dot"></i> ${esc(state.dataset.timeframe)}</span><span>Vela™ / PineTS</span></div><div id="chart"></div><div class="chart-footer"><span>${b.length} settled bars · ${date(b[0].time)} — ${date(last.time)} UTC</span><span>Live forming bar stays outside research snapshots</span></div></section>${comparisonCards(state.multiChart, linkedCharts.liveIds)}</div>${state.editor ? `<section class="editor"><div class="panel-heading"><span>Pine editor</span><span class="tag">v5 / v6</span></div><div class="editor-tools"><select id="script-select" aria-label="Saved script"><option value="">Choose a script…</option>${state.scripts.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</select><button id="save-script">Save</button><button id="import-script">Import .pine / .txt</button></div><input id="script-name" value="${esc(state.name)}" aria-label="Script name"><div id="pine-editor"></div><textarea hidden id="source" spellcheck="false" aria-label="Pine Script source">${esc(state.source)}</textarea><div id="editor-errors" class="editor-errors">${errorView()}</div><div class="editor-bottom"><span>Pine v5/v6 · Tab indents · Ctrl-Space completes</span><div><button id="run-chart">Run chart</button><button id="run-backtest" class="primary">Backtest</button></div></div></section>` : ""}</div><div class="summary-strip"><div><span class="eyebrow">Strategy snapshot</span><strong>${state.run ? esc(state.run.result.title) : "No saved strategy run"}</strong></div>${state.run ? metrics(state.run.result.metrics, true) : "<p>Run a strategy to inspect its trades, costs, and equity curve.</p>"}<button id="view-backtest">Open backtest →</button></div><section class="workspace-utilities" aria-label="Workspace tools"><h2>Workspace tools</h2>${qualityView(state.dataset)}${layoutView(state.layouts)}${watchlistView(state.watchlist, state.quotes, state.watchLive)}</section>`;
}
function metrics(m, compact = false) {
  return `<div class="metrics ${compact ? "compact" : ""}">${[
    [
      "Net profit",
      money(m.netProfit),
      m.netProfit >= 0 ? "positive" : "negative",
    ],
    ["Closed trades", num(m.totalTrades, 0), ""],
    ["Win rate", num(m.winRate) + "%", ""],
    ["Max drawdown", money(m.maxDrawdown), "negative"],
    ["Profit factor", m.profitFactor === null ? "—" : num(m.profitFactor), ""],
  ]
    .map(
      ([label, value, cls]) =>
        `<div><span>${label}</span><strong class="${cls}">${value}</strong></div>`,
    )
    .join("")}</div>`;
}
function library() {
  const lib = state.library,
    items = lib?.indicators ?? lib?.results ?? [];
  return `<div class="page-intro"><span class="eyebrow">THE LUXALGO LIBRARY</span><h1>Find your next edge.</h1><p>Browse the full public catalog. Bring available Pine source into your own workspace.</p></div><div class="searchbar"><input id="library-query" placeholder="Search indicators, concepts, or a trading idea…" aria-label="Search library"><button id="search-library" class="primary">Search library</button><button id="browse-library">Browse all</button></div><div class="section-label"><span>${lib ? `${num(lib.total ?? items.length, 0)} indicators · page ${state.libraryPage + 1}` : "CONNECTED THROUGH OFFICIAL LUXALGO MCP"}</span><span>Sources fetched on demand</span></div>${items.length ? `<div class="library-grid">${items.map((item) => `<article class="library-card"><div><span class="family">${esc(item.family ?? "Indicator")}</span><span class="muted">${uiIcon("external")}</span></div><h3>${esc(item.name ?? item.title)}</h3><p>${esc(item.description ?? item.excerpt ?? "Open the source to inspect this indicator.")}</p><div><button data-import-source="${esc(item.slug)}">Import source →</button><button data-link="${esc(item.url ?? `https://www.luxalgo.com/library/indicator/${item.slug}/`)}" class="text-btn">Docs</button></div></article>`).join("")}</div><div class="pagination"><button id="previous-page" ${state.libraryPage === 0 ? "disabled" : ""}>← Previous</button><span>Page ${state.libraryPage + 1}</span><button id="next-page" ${(state.libraryPage + 1) * 24 >= (lib.total ?? 0) ? "disabled" : ""}>Next →</button></div>` : `<div class="empty-state"><span class="empty-icon">${uiIcon("library")}</span><h2>Your research starts here.</h2><p>Search a topic or browse every indicator in the catalog.<br>Source availability and licenses vary by script.</p><button id="browse-empty" class="primary">Browse the catalog</button></div>`}`;
}
function backtests() {
  const r = state.run;
  return `<div class="page-intro tight"><span class="eyebrow">REPRODUCIBLE RESEARCH</span><h1>Test the idea. Read the evidence.</h1><p>Native PineTS strategy engine · closed candles · costs included · market orders fill on the next bar.</p></div><div class="backtest-controls"><label>Initial capital<input type="number" min="1" id="capital" value="${state.settings.initial_capital}"></label><label>Position (% equity)<input type="number" min=".01" max="100" id="size" value="${state.settings.default_qty_value}"></label><label>Commission (%)<input type="number" step=".01" min="0" id="commission" value="${state.settings.commission_value}"></label><label>Slippage (ticks)<input type="number" min="0" id="slippage" value="${state.settings.slippage}"></label><button id="rerun" class="primary">Run strategy</button><select id="saved-runs" aria-label="Saved backtests"><option value="">Saved runs (${state.runs.length})</option>${state.runs.map((run) => `<option value="${run.id}">${esc(run.result.title)} · ${esc(run.dataset.symbol)} · ${date(run.createdAt)}</option>`).join("")}</select></div>${state.diagnostic ? `<div class="editor-errors">${errorView()}<br><button id="open-error-editor">Open editor</button></div>` : ""}${
    r
      ? `<div class="run-heading"><strong>${esc(r.result.title)} <span class="tag">${esc(r.dataset.symbol)} · ${esc(r.dataset.timeframe)}</span></strong><span>${date(r.dataset.bars[0].time)} — ${date(r.dataset.bars.at(-1).time)} UTC <button id="export-run" class="text-btn">Export run ↓</button></span></div>${metrics(r.result.metrics)}<div class="tabs">${[
          ["performance", "Performance"],
          ["analysis", "Trades analysis"],
          ["log", "Trades log"],
          ["simulation", "Simulation"],
        ]
          .map(
            ([key, label]) =>
              `<button data-tab="${key}" class="${state.tab === key ? "selected" : ""}">${label}</button>`,
          )
          .join(
            "",
          )}</div><div class="backtest-content">${backtestTab(r)}</div><p class="footnote">${esc(r.dataset.origin)} · ${r.result.openTrades.length} open position(s) · open P&L ${money(r.result.metrics.openProfit)} · source, candle history, and settings saved with this run. Results depend on the feed and PineTS fill model.</p>${r.result.warnings?.length ? `<details class="warnings"><summary>${r.result.warnings.length} engine warnings</summary><pre>${esc(JSON.stringify(r.result.warnings, null, 2))}</pre></details>` : ""}`
      : `<div class="empty-state"><span class="empty-icon">${uiIcon("backtest")}</span><h2>Give your strategy a history.</h2><p>The current Pine script runs against ${state.dataset.bars.length} ${esc(state.dataset.symbol)} candles.<br>Edit a strategy in the workspace, set costs, then run it here.</p></div>`
  }${researchView(state.research, state.runs)}`;
}
function backtestTab(r) {
  const trades = r.result.trades;
  if (state.tab === "performance")
    return `<div class="plot-card"><div class="panel-heading"><span>MARK-TO-MARKET EQUITY</span><span>Includes unrealized P&L</span></div><canvas id="equity-plot"></canvas></div><div class="split-cards">${[
      "All trades",
      "Longs",
      "Shorts",
    ]
      .map((label, i) => {
        const t = trades.filter(
          (t) => i === 0 || (i === 1 ? t.size > 0 : t.size < 0),
        );
        return `<div class="stat-card"><span>${label}</span><strong class="${t.reduce((s, t) => s + t.profit, 0) >= 0 ? "positive" : "negative"}">${money(t.reduce((s, t) => s + t.profit, 0))}</strong><small>${t.length} trades · ${t.length ? num((t.filter((t) => t.profit > 0).length / t.length) * 100) : "0"}% win rate</small></div>`;
      })
      .join("")}</div>`;
  if (state.tab === "log")
    return `<div class="table-wrap"><table><thead><tr><th>#</th><th>Direction</th><th>Entry (UTC)</th><th>Exit (UTC)</th><th>Entry price</th><th>Exit price</th><th>Quantity</th><th>Fees</th><th>Net P&L</th></tr></thead><tbody>${trades.map((t, i) => `<tr><td>${i + 1}</td><td><span class="tag ${t.size > 0 ? "positive" : "negative"}">${t.size > 0 ? "LONG" : "SHORT"}</span></td><td>${date(t.entry_time)}</td><td>${date(t.exit_time)}</td><td>${num(t.entry_price)}</td><td>${num(t.exit_price)}</td><td>${num(Math.abs(t.size), 4)}</td><td>${money(t.commission)}</td><td class="${t.profit >= 0 ? "positive" : "negative"}">${money(t.profit)}</td></tr>`).join("")}</tbody></table>${trades.length ? "" : '<p class="muted">No closed trades in this run.</p>'}</div>`;
  if (state.tab === "analysis") {
    const profits = trades.map((t) => t.profit);
    return `<div class="split-cards"><div class="stat-card"><span>Average trade</span><strong>${profits.length ? money(profits.reduce((a, b) => a + b, 0) / profits.length) : "—"}</strong></div><div class="stat-card"><span>Best trade</span><strong class="positive">${profits.length ? money(Math.max(...profits)) : "—"}</strong></div><div class="stat-card"><span>Worst trade</span><strong class="negative">${profits.length ? money(Math.min(...profits)) : "—"}</strong></div></div><div class="plot-card"><div class="panel-heading"><span>TRADE NET P&L</span><span>Each closed trade, after commission</span></div><canvas id="trade-plot"></canvas></div>`;
  }
  return `<div class="plot-card"><div class="panel-heading"><span>MONTE CARLO RESAMPLING</span><button id="simulate" class="primary">Simulate 200 paths</button></div><canvas id="simulation-plot"></canvas><div id="simulation-metrics" class="simulation-metrics">Seed 42 · sampling closed-trade net P&L with replacement, at fixed cash size.<br>This model excludes intra-trade equity, serial dependence, and changing position sizes.</div></div>`;
}
function flow() {
  const tabs = `<div class="flow-tabs" role="group" aria-label="Order flow view"><button data-flow-tab="trades" aria-pressed="${state.flowTab === "trades"}">Executed trades</button><button data-flow-tab="depth" aria-pressed="${state.flowTab === "depth"}">Live order book / DOM</button><button data-flow-tab="history" aria-pressed="${state.flowTab === "history"}">Recorded liquidity</button><button data-flow-tab="profiles" aria-pressed="${state.flowTab === "profiles"}">Volume profiles</button><button data-flow-tab="tpo" aria-pressed="${state.flowTab === "tpo"}">TPO analysis</button></div>`;
  if (state.flowTab === "tpo")
    return tabs + volumeProfileView(state.tpoProfile);
  if (state.flowTab === "profiles")
    return tabs + volumeProfileView(state.volumeProfile);
  if (state.flowTab === "history")
    return tabs + depthHistoryView(state.depthHistory);
  if (state.flowTab === "depth") return tabs + depthView(state.depth);
  const f = state.flow;
  return `${tabs}<div class="page-intro"><span class="eyebrow">FOLLOW THE EXECUTED VOLUME</span><h1>Read what traded.</h1><p>Footprints, cumulative delta, and volume at price from trades with an explicit aggressor side.</p></div><div class="searchbar"><label>Source<select id="flow-source"><option value="imported" ${state.flowSource === "imported" ? "selected" : ""}>Imported / saved trades</option><option value="live" ${state.flowSource === "live" ? "selected" : ""}>Live Binance retained window</option></select></label><label>Market label<input id="trade-symbol" value="${esc(f?.symbol ?? "BTCUSDT")}" aria-label="Trade market label"></label><label>Aggregation<select id="flow-timeframe">${["1m", "5m", "15m", "1h", "4h", "1d"].map((t) => `<option ${t === state.flowSettings.timeframe ? "selected" : ""}>${t}</option>`).join("")}</select></label><label>Price bucket<input id="tick-size" type="number" min=".000001" step="any" value="${state.flowSettings.tickSize}"></label><button id="import-trades" class="primary">Import trade CSV</button><button id="refresh-flow">Recompute</button><button id="save-live-trades">Save live trade snapshot</button></div>${footprintControls(state.flowSettings)}<div id="flow-results">${f ? footprintResults(f, state.footprint) : `<div class="empty-state"><span class="empty-icon">${uiIcon("orderflow")}</span><h2>Real trades. Real delta.</h2><p>Import CSV with <code>time,price,size,side</code>.<br>Side is the aggressor: <code>buy</code> or <code>sell</code>. Time accepts ISO, seconds, or milliseconds.<br>Candles cannot supply this data. Label the market before importing.</p><button id="sample-trades">Download CSV template</button></div>`}</div>`;
}

function mcp() {
  const config = agentConfig(state.dataDir);
  return `<div class="page-intro"><span class="eyebrow">YOUR WORKSPACE, WITH TOOLS</span><h1>Your agent, connected to this desktop.</h1><p>Read the displayed dataset, control the workspace chart and share this app’s existing live connections.</p></div>${agentAccessView(state.agentAccess, esc)}<div class="mcp-grid"><section class="plot-card"><div class="panel-heading"><span>MCP CLIENT CONFIGURATION</span><button id="export-config">Export JSON ↓</button></div><pre>${esc(JSON.stringify(config, null, 2))}</pre><p class="footnote">Install Node.js 22.16+ and this repository's dependencies. Replace the absolute path. Enable access above, then reconnect your MCP client. Desktop mode requires the app and never starts a second data service. The bundled desktop app alone does not install the Node MCP server.</p></section><section class="plot-card"><div class="panel-heading"><span>AVAILABLE LOCAL TOOLS</span><span class="tag">STDIO</span></div>${[
    [
      "desktop_state / desktop_navigate",
      "Inspect the running workspace or open a page",
    ],
    ["desktop_chart_*", "Edit source, run a script or set the visible range"],
    [
      "depth_snapshot / depth_start / depth_stop",
      "Read or manage the shared live spot order book",
    ],
    ["workspace", "Read scripts, data, saved runs"],
    ["load_market / import_bars", "Fetch settled candles or import OHLCV"],
    [
      "save_script / run_backtest",
      "Persist Pine source and execute strategies",
    ],
    ["import_trades / order_flow", "Trade footprints, delta, CVD, profile"],
    ["plan_* / plans_list", "Saved trade plans and linear risk sizing"],
    [
      "paper_*",
      "Simulated cash account, orders and fill ledger (research access)",
    ],
    ["volume_profile", "UTC session and anchored profiles with coverage"],
    ["tpo_profile", "Price/time occupancy, TPO value area and initial balance"],
    [
      "library_search / library_list / library_source",
      "Browse official catalog and get public source",
    ],
    ["live_*", "Continuous Binance candles, trades and live flow"],
    [
      "research_* / compare_runs",
      "Sweeps, walk-forward jobs and saved-run comparisons",
    ],
    ["edge_*", "Reports, custom queries, coverage and session verification"],
    ["whale_*", "Options events, quote audits, gamma and chain history"],
    ["options_*", "Unusual Whales snapshots, live prints and strike GEX"],
  ]
    .map(
      ([tool, desc]) =>
        `<div class="tool-row"><code>${tool}</code><small>${desc}</small></div>`,
    )
    .join(
      "",
    )}</section></div><div class="notice"><span>◉</span><div><strong>Your data stays in your workspace.</strong><p>Local MCP tools share the app's storage directory. Catalog and hosted Edge Stats calls go to LuxAlgo; market data calls go to Binance. Options calls go to Unusual Whales when configured. Local Edge Stats and Whale Options connect to your configured loopback services. Private account features and broker execution are not connected.</p><code>${esc(state.dataDir ?? "~/Library/Application Support/Pine Desk")}</code></div></div><div class="links"><button data-link="https://github.com/LuxAlgo/PineTS">PineTS ${uiIcon("external")}</button><button data-link="https://velacharts.dev/">VelaCharts ${uiIcon("external")}</button><button data-link="https://www.luxalgo.com/licensing/">Library licensing ${uiIcon("external")}</button><button data-link="https://docs.luxalgo.com/platform/charts/strategies">Backtest documentation ${uiIcon("external")}</button></div>`;
}

async function mountChart() {
  chartOwner = "workspace";
  chartIdentity = {
    symbol: state.dataset.symbol,
    timeframe: state.dataset.timeframe,
  };
  engine = new PineWorkerEngine();
  const isLive =
    state.live.active && state.live.dataset?.symbol === state.dataset.symbol;
  chartFeed = isLive ? makeLiveChartFeed(() => state.live) : null;
  chart = new Vela(
    "#chart",
    {
      ...(isLive
        ? {
            symbol: state.dataset.symbol,
            bars: displayBars().length,
            live: true,
          }
        : { data: state.dataset.bars }),
      timeframe: state.dataset.timeframe,
      ...chartAppearance(),
      animations: { intro: false },
    },
    chartFeed ? { dataFeed: chartFeed } : undefined,
  );
  chart.registerEngine("pine", engine);
  const target = chart;
  await target.ready();
  if (chart === target) {
    if (hydrated && state.chartMemory) {
      const savedChart =
        state.chartMemory.symbol === chartIdentity.symbol &&
        state.chartMemory.timeframe === chartIdentity.timeframe
          ? state.chartMemory
          : {
              indicators: state.chartMemory.indicators,
              panes: state.chartMemory.panes,
            };
      const bars = state.dataset.bars;
      if (
        savedChart.range &&
        (savedChart.range.to < bars[0].time ||
          savedChart.range.from >
            bars.at(-1).time + durations[state.dataset.timeframe])
      )
        savedChart.range = null;
      restoringChart = true;
      let deadline;
      try {
        await Promise.race([
          restoreChart(target, savedChart, (e) =>
            toast("Saved indicator: " + e.message, true),
          ),
          new Promise((_, reject) => {
            deadline = setTimeout(
              () =>
                reject(
                  new Error("Restoring chart indicators exceeded 30 seconds."),
                ),
              30000,
            );
          }),
        ]);
      } catch (e) {
        if (chart === target) {
          state.chartMemory.indicators = [];
          destroyChart();
          mountChart();
          toast(e.message, true);
        }
        return;
      } finally {
        clearTimeout(deadline);
        restoringChart = false;
      }
      if (chart !== target) return;
      handle =
        target.indicators().find((i) => i.source === state.source) ?? null;
    }
    for (const event of [
      "viewport:changed",
      "drawing:created",
      "drawing:edited",
      "drawing:removed",
      "indicator:added",
      "indicator:removed",
      "indicator:inputs",
      "indicator:visibility",
      "indicator:moved",
      "pane:changed",
    ])
      target.on(event, scheduleSession);
    $("#chart").dataset.ready = "true";
    optionsOverlay = attachOptionsChart(
      chart,
      () => state.options.snapshot,
      state.dataset.symbol,
      displayBars,
      state.dataset.timeframe,
      () => state.options,
    );
    optionsOverlay.update();
    await linkedCharts.mount(target);
  }
}
async function runChart() {
  saveDraft();
  const executedSource = state.source;
  handle?.remove();
  const target = chart;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (chart === target) {
        destroyChart();
        mountChart();
      }
      reject(new Error("Chart script exceeded the 30-second execution limit."));
    }, 30000);
  });
  try {
    const result = await Promise.race([
      target.runIndicator(state.source, {
        inputs: baseInputs(),
        props: /^\s*strategy\(/m.test(state.source)
          ? {
              ...settings(),
              default_qty_type: "percent_of_equity",
              commission_type: "percent",
              process_orders_on_close: false,
            }
          : undefined,
      }),
      deadline,
    ]);
    if (chart !== target) return;
    if (!result.ok)
      throw new Error(
        typeof result.error === "string"
          ? result.error
          : (result.error?.message ?? "Script execution failed."),
      );
    handle = result.handle;
    handle.on("error", ({ error }) => {
      if (chart !== target) return;
      if (state.source === executedSource) editorError(error);
      else toast(`Running chart script failed: ${error.message}`, true);
    });
    state.diagnostic = null;
    pineEditor?.diagnostic(null);
    if ($("#editor-errors")) $("#editor-errors").textContent = "";
    toast("Script rendered on Vela.");
  } catch (error) {
    editorError(error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function collectSettings() {
  if ($("#capital"))
    state.settings = {
      ...state.settings,
      initial_capital: Number($("#capital").value),
      default_qty_value: Number($("#size").value),
      commission_value: Number($("#commission").value),
      slippage: Number($("#slippage").value),
    };
}
async function backtest() {
  saveDraft();
  collectSettings();
  try {
    if (state.live.active && !state.live.dataset)
      throw new Error(
        "Wait for the live candle history to synchronize, or stop the stream before backtesting.",
      );
    state.run = await call("backtest", {
      source: state.source,
      settings: settings(),
      inputs: baseInputs(),
      dataset: state.dataset,
    });
    state.runs.unshift(state.run);
    state.diagnostic = null;
    state.page = "backtest";
    state.tab = "performance";
    render();
    toast(
      `Backtest complete · ${state.run.result.metrics.totalTrades} closed trades`,
    );
  } catch (error) {
    editorError(error);
    if (state.page === "backtest") render();
    throw error;
  }
}
async function getCSV() {
  if (api) return api.importCSV();
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";
    input.onchange = async () =>
      resolve(input.files[0] ? await input.files[0].text() : null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
async function exportFile(name, text) {
  if (api) return api.exportFile(name, text);
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
function alertBindings() {
  bindAlerts({
    state: state.alerts,
    call,
    task,
    render,
    toast,
    exportFile: (name, text) =>
      api?.exportFile
        ? api.exportFile(name, text)
        : Promise.reject(
            Error("Open the desktop app to export alert history."),
          ),
  });
}
function bind() {
  if (state.page === "paper")
    bindPaper({ state: state.paper, call, task, render, exportFile });
  if (state.page === "plans")
    bindPlans({ state: state.plans, call, task, render, exportFile });
  if (state.page === "orderflow" && state.flowTab === "tpo")
    bindVolumeProfile({ state: state.tpoProfile, call, task, exportFile });
  if (state.page === "orderflow" && state.flowTab === "profiles")
    bindVolumeProfile({ state: state.volumeProfile, call, task, exportFile });
  if (state.page === "orderflow" && state.flowTab === "history")
    depthHistoryController.bind();
  document.querySelectorAll("[data-flow-tab]").forEach((el) => {
    el.onclick = () => {
      if (!state.busy) {
        state.flowTab = el.dataset.flowTab;
        render();
      }
    };
  });
  if (state.page === "orderflow" && state.flowTab === "depth") {
    bindDepth({ state: state.depth, call, task });
    pollOrderBook();
  }
  if (state.page === "alerts") {
    alertBindings();
    pollAlerts();
  }
  bindLearning(state.learning, render);
  bindCrypto({ state: state.crypto, call, task, render, exportFile });
  bindCustomization();
  bindProviderSettings({
    call,
    task,
    render,
    getSettings: () => state.providerSettings,
    setSettings: (s) => {
      state.providerSettings = s;
      state.whale.config = s.whale;
    },
  });
  bindOptions({
    options: state.options,
    call,
    task,
    render,
    exportFile,
    refreshChart: () => optionsOverlay?.update(),
  });
  bindResearch({
    research: state.research,
    call,
    task,
    render,
    exportFile,
    start: startStudy,
    onOpen: async (run) => {
      await stopLive();
      state.run = run;
      state.dataset = run.dataset;
      state.runs.unshift(run);
      state.source = run.source;
      state.settings = { ...state.settings, ...run.settings };
      state.research.inputs = JSON.stringify(run.inputs ?? {});
      if ($("#research-inputs"))
        $("#research-inputs").value = state.research.inputs;
      state.tab = "performance";
    },
  });
  bindWhale({ whale: state.whale, call, task, render, exportFile });
  bindEdge({ edge: state.edge, call, task, render, exportFile });
  document.querySelectorAll("[data-page]").forEach(
    (el) =>
      (el.onclick = () => {
        if (state.busy) return;
        if (el.dataset.page === "mcp" && api?.agentReady)
          call("agentStatus")
            .then((status) => {
              state.agentAccess = status;
              if (state.page === "mcp") render();
            })
            .catch((error) => toast(error.message, true));
        state.page = el.dataset.page;
        render();
      }),
  );
  if ($("#capital"))
    for (const id of ["capital", "size", "commission", "slippage"])
      $("#" + id).oninput = collectSettings;
  const on = (id, fn) => {
    const el = $("#" + id);
    if (el) el.onclick = () => task(fn);
  };
  on("create-trade-plan", () => {
    primeTradePlan(state.plans, state.dataset);
    state.page = "plans";
    render();
  });
  on("create-price-alert", async () => {
    primeAlert(state.alerts, state.dataset);
    await refreshAlerts(state.alerts, call);
    state.page = "alerts";
    render();
  });
  on("focus-chart", () => setChartFocus(!state.focusChart));
  on("toggle-editor", () => {
    state.editor = !state.editor;
    render();
  });
  on("load-market", async () => {
    await stopLive();
    state.dataset = await call("loadMarket", {
      limit: Number($("#history-limit")?.value ?? 1000),
      symbol: $("#symbol").value.toUpperCase(),
      timeframe: $("#timeframe").value,
      limit: 1000,
    });
    render();
    toast("Closed market candles loaded.");
  });
  on("import-bars", async () => {
    const symbol = $("#symbol").value,
      timeframe = $("#timeframe").value,
      csv = await getCSV();
    if (csv) {
      await stopLive();
      state.dataset = await call("importBars", { csv, symbol, timeframe });
      render();
      toast("OHLCV imported.");
    }
  });
  on("live-start", startLive);
  on("live-stop", stopLive);
  on("open-error-editor", () => {
    state.page = "workspace";
    render();
  });
  on("jump-error", () => pineEditor?.jumpTo(state.diagnostic?.line));
  on("save-script", async () => {
    saveDraft();
    state.name = $("#script-name").value;
    const s = await call("saveScript", {
      name: state.name,
      source: state.source,
    });
    state.scripts.push(s);
    toast("Script saved locally.");
  });
  if ($("#source")) $("#source").oninput = saveDraft;
  if ($("#script-select"))
    $("#script-select").onchange = (e) => {
      const s = state.scripts.find((s) => s.id === e.target.value);
      if (s) {
        state.source = s.source;
        state.name = s.name;
        setSource(s.source);
        $("#script-name").value = s.name;
        saveDraft();
      }
    };
  on("import-script", importStrategy);
  on("run-chart", runChart);
  on("run-backtest", backtest);
  on("rerun", backtest);
  on("view-backtest", () => {
    state.page = "backtest";
    render();
  });
  const browse = async () => {
    state.library = await call("libraryList", { page: state.libraryPage });
    render();
  };
  on("browse-library", () => {
    state.libraryPage = 0;
    return browse();
  });
  on("browse-empty", browse);
  on("next-page", () => {
    state.libraryPage++;
    return browse();
  });
  on("previous-page", () => {
    state.libraryPage--;
    return browse();
  });
  on("search-library", async () => {
    const query = $("#library-query").value.trim();
    if (!query) return;
    state.library = await call("librarySearch", { query });
    state.libraryPage = 0;
    render();
  });
  document.querySelectorAll("[data-import-source]").forEach(
    (el) =>
      (el.onclick = () =>
        task(async () => {
          const r = await call("librarySource", {
            slug: el.dataset.importSource,
          });
          if (!r.available || !r.source)
            throw new Error(
              "Source is not publicly served for this indicator.",
            );
          const s = await call("saveScript", {
            name: r.name,
            source: r.source,
            provenance: {
              slug: r.slug,
              url: `https://www.luxalgo.com/library/indicator/${r.slug}/`,
              retrievedAt: Date.now(),
              metadata: r,
            },
          });
          saveDraft();
          state.scripts.push(s);
          state.source = s.source;
          state.name = s.name;
          state.page = "workspace";
          render();
          $("#source").value = s.source;
          saveDraft();
          toast(
            "Public source imported. Original comments and metadata preserved.",
          );
        })),
  );
  document.querySelectorAll("[data-tab]").forEach(
    (el) =>
      (el.onclick = () => {
        collectSettings();
        state.tab = el.dataset.tab;
        render();
      }),
  );
  if ($("#saved-runs"))
    $("#saved-runs").onchange = (e) =>
      task(async () => {
        const r = state.runs.find((r) => r.id === e.target.value);
        if (r) {
          await stopLive();
          state.run = r;
          state.source = r.source;
          state.research.inputs = JSON.stringify(r.inputs ?? {});
          if ($("#research-inputs"))
            $("#research-inputs").value = state.research.inputs;
          state.dataset = r.dataset;
          state.settings = { ...state.settings, ...r.settings };
          render();
        }
      });
  on("export-run", () =>
    exportFile("pine-desk-backtest.json", JSON.stringify(state.run, null, 2)),
  );
  on("simulate", async () => {
    const sim = await call("simulate", {
      trades: state.run.result.trades,
      options: {
        initialCapital: state.run.result.metrics.initialCapital,
        paths: 200,
        seed: 42,
      },
    });
    plot(
      $("#simulation-plot"),
      sim.outcomes.slice(0, 60).map((o) => o.curve),
      "lines",
    );
    $("#simulation-metrics").textContent =
      `Seed 42 · 200 fixed-cash resampled paths · P05 ${money(sim.p05)} · Median ${money(sim.median)} · P95 ${money(sim.p95)} · Loss probability ${num(sim.lossProbability * 100)}% · excludes intra-trade equity and size compounding.`;
  });
  const recompute = async () => {
    const source = $("#flow-source").value;
    const settings = {
      timeframe: $("#flow-timeframe").value,
      tickSize: Number($("#tick-size").value),
      ...readFootprintSettings(),
    };
    const result = await call(
      source === "live" ? "liveFlow" : "orderflow",
      settings,
    );
    if (
      source !== state.flowSource ||
      settings.timeframe !== state.flowSettings.timeframe ||
      result.symbol !== state.flow?.symbol
    )
      state.footprint = newFootprintState();
    state.flowSource = source;
    state.flowSettings = settings;
    state.flow = result;
    refreshFootprints();
  };
  on("import-trades", async () => {
    const symbol = $("#trade-symbol").value,
      csv = await getCSV();
    if (csv) {
      await call("importTrades", { csv, symbol });
      state.footprint = newFootprintState();
      state.flowSource = "imported";
      $("#flow-source").value = "imported";
      await recompute();
      toast("Executed trades imported.");
    }
  });
  on("refresh-flow", recompute);
  if ($("#flow-source")) $("#flow-source").onchange = () => task(recompute);
  on("save-live-trades", async () => {
    await call("liveSaveTrades");
    toast("Retained live trades saved for offline order-flow analysis.");
  });
  on("sample-trades", () =>
    exportFile(
      "trades-template.csv",
      "time,price,size,side\n2026-01-01T00:00:01Z,65000,0.01,buy\n2026-01-01T00:00:02Z,64990,0.02,sell\n",
    ),
  );
  on("agent-save", async () => {
    state.agentAccess = await call(
      "agentConfigure",
      Object.fromEntries(
        ["enabled", "charts", "streams", "research", "alerts"].map((key) => [
          key,
          $("#agent-" + key).checked,
        ]),
      ),
    );
    render();
    toast("Agent access updated. Reconnect your MCP client.");
  });
  on("agent-revoke", async () => {
    state.agentAccess = await call("agentConfigure", {
      enabled: false,
      charts: false,
      streams: false,
      research: false,
    });
    render();
    toast("Agent access revoked.");
  });
  on("agent-refresh", async () => {
    state.agentAccess = await call("agentStatus");
    render();
  });
  on("export-config", () =>
    exportFile(
      "mcp-config.json",
      JSON.stringify(agentConfig(state.dataDir), null, 2),
    ),
  );
  document.querySelectorAll("[data-link]").forEach(
    (el) =>
      (el.onclick = () =>
        task(async () => {
          if (api) await api.openURL(el.dataset.link);
          else window.open(el.dataset.link, "_blank", "noopener");
        })),
  );
}
function plot(canvas, series, mode = "line") {
  if (!canvas) return;
  const box = canvas.getBoundingClientRect(),
    dpr = devicePixelRatio;
  canvas.width = box.width * dpr;
  canvas.height = box.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const w = box.width,
    h = box.height,
    pad = 42;
  const arrays = mode === "lines" ? series : [series];
  const values = arrays.flat().filter(Number.isFinite);
  if (!values.length) {
    ctx.fillStyle = "#8491a4";
    ctx.fillText("No data to display", 24, 40);
    return;
  }
  let min = values.reduce((a, b) => Math.min(a, b), Infinity),
    max = values.reduce((a, b) => Math.max(a, b), -Infinity);
  if (mode === "bars") {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  const span = max - min || 1,
    y = (v) => h - pad - ((v - min) / span) * (h - pad * 1.7),
    x = (i, n) => pad + (i / Math.max(1, n - 1)) * (w - pad - 20);
  ctx.font = "11px ui-monospace,monospace";
  for (let i = 0; i < 5; i++) {
    const v = min + (span * i) / 4,
      yy = y(v);
    ctx.strokeStyle = getComputedStyle(
      document.documentElement,
    ).getPropertyValue("--border");
    ctx.beginPath();
    ctx.moveTo(pad, yy);
    ctx.lineTo(w - 10, yy);
    ctx.stroke();
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(
      "--muted",
    );
    ctx.fillText(num(v, 0), 2, yy - 5);
  }
  for (const a of arrays) {
    if (mode === "bars") {
      a.forEach((v, i) => {
        ctx.fillStyle = v >= 0 ? "#63dfbd" : "#f17789";
        ctx.fillRect(
          x(i, a.length),
          Math.min(y(v), y(0)),
          Math.max(2, (w - pad - 20) / a.length - 3),
          Math.max(1, Math.abs(y(v) - y(0))),
        );
      });
    } else {
      ctx.strokeStyle = mode === "lines" ? "#63dfbd35" : "#63dfbd";
      ctx.lineWidth = mode === "lines" ? 1 : 2;
      ctx.beginPath();
      a.forEach((v, i) =>
        i ? ctx.lineTo(x(i, a.length), y(v)) : ctx.moveTo(x(i, a.length), y(v)),
      );
      ctx.stroke();
    }
  }
}
function mountEdgeChart() {
  const session = state.edge.session.result;
  if (session.bars?.length) {
    chart = new Vela("#edge-session-chart", {
      data: session.bars.map((b) => ({ ...b, time: b.ts })),
      timeframe: session.tf,
      ...chartAppearance(),
      animations: { intro: false },
    });
  }
}
function paintBacktest() {
  requestAnimationFrame(() => {
    if (state.tab === "performance")
      plot(
        $("#equity-plot"),
        state.run.result.equity.map((p) => p.value),
      );
    if (state.tab === "analysis")
      plot(
        $("#trade-plot"),
        state.run.result.trades.map((t) => t.profit),
        "bars",
      );
  });
}
function refreshFootprints({ background = false } = {}) {
  if (
    state.page !== "orderflow" ||
    state.flowTab !== "trades" ||
    !$("#flow-results")
  )
    return;
  const focused = document.activeElement;
  // Do not replace an input currently used to select a historical bar.
  if (background && focused?.id === "footprint-index") return;
  const scrollers = [
    ...document.querySelectorAll(".footprint-table, .footprint-profile"),
  ].map((el) => el.scrollTop);
  $("#flow-results").innerHTML = footprintResults(state.flow, state.footprint);
  bindFootprints({
    flow: state.flow,
    state: state.footprint,
    paint: refreshFootprints,
  });
  document
    .querySelectorAll(".footprint-table, .footprint-profile")
    .forEach((el, i) => {
      el.scrollTop = scrollers[i] ?? 0;
    });
  paintFlow();
}
function paintFlow() {
  bindFootprints({
    flow: state.flow,
    state: state.footprint,
    paint: refreshFootprints,
  });
  requestAnimationFrame(() => {
    if ($("#cvd-plot") && state.flow)
      plot(
        $("#cvd-plot"),
        state.flow.bars.map((b) => b.cvd),
      );
  });
}
function mountEditor() {
  const parent = $("#pine-editor");
  if (!parent) return;
  pineEditor = mountPineEditor(parent, state.source, (source) => {
    state.source = source;
    localStorage.setItem("pine-desk-draft", source);
    if ($("#source")) $("#source").value = source;
    state.diagnostic = null;
    scheduleSession();
    if ($("#editor-errors")) $("#editor-errors").textContent = "";
  });
  pineEditor.diagnostic(state.diagnostic);
  if ($("#jump-error"))
    $("#jump-error").onclick = () => pineEditor?.jumpTo(state.diagnostic?.line);
}
function displayBars() {
  return state.live.active &&
    state.live.forming &&
    state.live.dataset?.symbol === state.dataset.symbol
    ? [...state.dataset.bars, state.live.forming]
    : state.dataset.bars;
}
function updateLiveStatus() {
  const label = $("#live-status");
  if (!label) return;
  const l = state.live;
  label.className = `live-${l.status}`;
  label.textContent = l.active
    ? `${l.status.toUpperCase()} · ${l.symbol} ${l.timeframe} · ${l.tradeCount ?? 0} retained prints · ${l.gaps?.length ?? 0} trade gap warnings${l.error ? ` · ${l.error}` : ""}${l.lastMessageAt ? ` · last event ${date(l.lastMessageAt)} UTC` : ""} · forming candles excluded from backtests`
    : "Live stream stopped. Start live to follow candles and record executed trades.";
  if ($("#live-stop")) $("#live-stop").disabled = !l.active;
  const price =
    l.active && l.forming ? l.forming.close : state.dataset.bars.at(-1).close;
  if ($("#market-price")) $("#market-price").textContent = num(price);
  const change = (price / state.dataset.bars[0].close - 1) * 100;
  if ($("#market-change")) {
    $("#market-change").textContent =
      `${change >= 0 ? "+" : ""}${num(change)}%`;
    $("#market-change").className = change >= 0 ? "positive" : "negative";
  }
}
async function startLive() {
  saveDraft();
  state.live = await call("liveStart", {
    symbol: $("#symbol").value.trim().toUpperCase(),
    timeframe: $("#timeframe").value,
  });
  render();
  toast(
    "Connecting to Binance; live status will show synchronization and reconnects.",
  );
}
async function stopLive() {
  if (api && state.live.active) {
    state.live = await call("liveStop");
    if (state.live.dataset) state.dataset = state.live.dataset;
    render();
  }
}
function desktopSnapshot() {
  saveDraft();
  captureWorkspaceChart();
  const bars = state.dataset.bars;
  return {
    observedAt: Date.now(),
    busy: state.busy || restoringChart,
    page: state.page,
    multiChart: {
      count: state.multiChart.count,
      linkSymbol: state.multiChart.linkSymbol,
      linkTimeframe: state.multiChart.linkTimeframe,
      linkRange: state.multiChart.linkRange,
      linkCrosshair: state.multiChart.linkCrosshair,
    },
    panels: [
      {
        id: "workspace",
        visible: state.page === "workspace",
        instrument: datasetInstrument(state.dataset),
        timeframe: state.dataset.timeframe,
        origin: state.dataset.origin,
        settledBars: bars.length,
        firstBarAt: bars[0]?.time ?? null,
        lastBarAt: bars.at(-1)?.time ?? null,
        loadedAt: state.dataset.loadedAt ?? null,
        chart: state.chartMemory,
        editor: { name: state.name, source: state.source },
        live: {
          active: state.live.active,
          status: state.live.status,
          symbol: state.live.symbol ?? null,
          lastMessageAt: state.live.lastMessageAt ?? null,
          gaps: state.live.gaps ?? [],
          error: state.live.error ?? null,
        },
      },
      ...linkedCharts.describe(state.page === "workspace"),
    ],
  };
}
async function handleDesktopCommand(action, args = {}) {
  if (!hydrated) throw Error("Desktop is still loading.");
  if (action === "desktopState") return desktopSnapshot();
  if (action === "comparisonSnapshot")
    return structuredClone(
      linkedCharts.snapshots.filter((s) =>
        state.multiChart.panels
          .slice(0, state.multiChart.count - 1)
          .some((p) => p.id === s.id),
      ),
    );
  // Live synchronization can remount a chart between two agent commands.
  // Wait for that existing mount rather than rejecting an otherwise idle desk.
  if (!state.busy && restoringChart) await chartMount;
  if (state.busy || restoringChart)
    throw Error("Desktop is busy. Retry after the current operation finishes.");
  if (action === "researchSnapshot") {
    if (state.live.active && !state.live.dataset)
      throw Error(
        "Wait for the live candle history to synchronize before research.",
      );
    return {
      dataset: structuredClone(state.dataset),
      desktop: desktopSnapshot(),
    };
  }
  if (
    args.panelId &&
    args.panelId !== "workspace" &&
    !(
      action === "desktopSetRange" &&
      state.multiChart.panels
        .slice(0, state.multiChart.count - 1)
        .some((p) => p.id === args.panelId)
    )
  )
    throw Error("Unknown chart panel.");
  state.busy = true;
  syncBusyControls();
  $("#status").textContent = "Agent updating workspace…";
  try {
    let result;
    if (action === "desktopSetScript") {
      if (!/^\s*\/\/@version=[56]\s*$/m.test(args.source))
        throw Error("Use Pine v5/v6 source with a version declaration.");
      setSource(args.source);
      state.name = args.name;
      if ($("#script-name")) $("#script-name").value = args.name;
      state.diagnostic = null;
      state.page = "workspace";
      state.editor = true;
      render();
      await chartMount;
    } else if (action === "desktopRun" || action === "desktopSetRange") {
      if (state.page !== "workspace") {
        state.page = "workspace";
        render();
      }
      await chartMount;
      if (action === "desktopRun") await runChart();
      else {
        const targetView =
          args.panelId === "workspace"
            ? { chart, dataset: state.dataset }
            : linkedCharts.views.get(args.panelId);
        if (!targetView?.dataset)
          throw Error("Wait for the comparison chart to load.");
        const rangeDataset = targetView.dataset;
        if (
          args.from >= args.to ||
          args.to < rangeDataset.bars[0].time ||
          args.from >
            rangeDataset.bars.at(-1).time + durations[rangeDataset.timeframe]
        )
          throw Error(
            "Choose an ordered range overlapping the loaded candles, in Unix milliseconds.",
          );
        targetView.chart.setVisibleRange({ from: args.from, to: args.to });
      }
    } else if (action === "desktopNavigate") {
      if (!titles[args.page]) throw Error("Unknown desktop page.");
      if (args.page === "mcp") state.agentAccess = await call("agentStatus");
      state.page = args.page;
      render();
      if (state.page === "workspace") await chartMount;
    } else if (action === "serviceAction") {
      const request = args.args;
      switch (args.action) {
        case "loadMarket":
        case "importBars":
          state.dataset = await call(args.action, request);
          state.live = await call("liveSnapshot");
          state.page = "workspace";
          render();
          await chartMount;
          result = structuredClone(state.dataset);
          break;
        case "liveStart":
        case "liveStop":
          state.live = await call(args.action, request);
          if (state.live.dataset) state.dataset = state.live.dataset;
          state.page = "workspace";
          render();
          await chartMount;
          result = state.live;
          break;
        case "optionsRefresh":
        case "optionsStart":
        case "optionsStop":
          state.options.snapshot = await call(args.action, request);
          if (request.ticker) state.options.ticker = request.ticker;
          if (request.timeframe) state.options.timeframe = request.timeframe;
          for (const key of ["ticker", "timeframe"])
            if ($("#options-" + key))
              $("#options-" + key).value = state.options[key];
          state.page = "options";
          render();
          result = state.options.snapshot;
          break;
        case "cryptoRefresh":
        case "cryptoStart":
        case "cryptoStop":
        case "cryptoSelect":
          state.crypto.snapshot = await call(args.action, request);
          state.crypto.exchange = request.exchange ?? "deribit";
          if (request.currency) state.crypto.currency = request.currency;
          if (request.settlement) state.crypto.settlement = request.settlement;
          state.crypto.archiveId = null;
          if (args.action === "cryptoRefresh") {
            state.crypto.expiry = null;
            state.crypto.research.surface = null;
            state.crypto.research.risk = null;
            state.crypto.research.legs = [];
          }
          state.page = "crypto";
          render();
          result = state.crypto.snapshot;
          break;
        default:
          throw Error("Unsupported desktop service action.");
      }
    } else throw Error("Unsupported desktop command.");
    persistSession();
    toast("Agent updated the workspace.");
    state.busy = false;
    return result ?? desktopSnapshot();
  } finally {
    state.busy = false;
    syncBusyControls();
    $("#status").textContent = "Local workspace";
  }
}
api?.onAgentCommand?.(handleDesktopCommand);
api?.onServiceChanged?.(async () => {
  try {
    const workspace = await call("workspace");
    state.scripts = workspace.scripts;
    state.runs = workspace.runs;
    state.research.saved = workspace.savedStudies;
    // Preserve chart/draft/selection; the next navigation shows new saved work.
    toast(
      "Agent saved research. Open Backtests or the script list to inspect it.",
    );
  } catch (error) {
    toast(error.message, true);
  }
});
let livePolling = false,
  liveRevision = "",
  flowPulse = 0;
async function pollLive() {
  if (!api || livePolling) return;
  livePolling = true;
  try {
    const snapshot = await call("liveSnapshot");
    state.live = snapshot;
    if (snapshot.active && snapshot.dataset) {
      const previousDataset = state.dataset;
      const incoming = snapshot.dataset,
        changedMarket =
          state.dataset.symbol !== incoming.symbol ||
          state.dataset.timeframe !== incoming.timeframe;
      const last = incoming.bars.at(-1),
        revision = `${incoming.symbol}:${incoming.timeframe}:${incoming.bars.length}:${last.time}:${last.close}:${snapshot.forming?.time}:${snapshot.forming?.close}:${snapshot.forming?.volume}`;
      state.dataset = incoming;
      if (
        state.page === "workspace" &&
        (changedMarket || !chartFeed) &&
        !state.busy
      ) {
        render();
      } else if (
        state.page === "workspace" &&
        chart &&
        revision !== liveRevision
      ) {
        // Preserve view/editor; a REST reconnect can revise settled candles.
        if (
          incoming.bars[0].time !== previousDataset.bars[0].time ||
          last.time - previousDataset.bars.at(-1).time >
            durations[incoming.timeframe]
        )
          await chart.setMarket({
            data: displayBars(),
            visibleRange: chart.getVisibleRange(),
          });
        else chartFeed?.push(snapshot);
        if ($(".chart-footer span"))
          $(".chart-footer span").textContent =
            `${incoming.bars.length} settled bars · ${date(incoming.bars[0].time)} — ${date(last.time)} UTC`;
      }
      liveRevision = revision;
      if (
        state.page === "orderflow" &&
        state.flowTab === "trades" &&
        state.flowSource === "live" &&
        !state.busy &&
        Date.now() - flowPulse > 2000
      ) {
        flowPulse = Date.now();
        const source = $("#flow-source")?.value;
        if (source === "live") {
          if (snapshot.tradeCount) {
            const settings = state.flowSettings;
            const result = await call("liveFlow", settings);
            if (
              !state.busy &&
              state.flowSource === "live" &&
              state.flowSettings === settings
            ) {
              state.flow = result;
              refreshFootprints({ background: true });
            }
          }
        }
      }
    }
    updateLiveStatus();
  } catch (error) {
    if ($("#live-status"))
      $("#live-status").textContent = `Live feed error: ${error.message}`;
  } finally {
    livePolling = false;
  }
}
let studyPolling = false;
async function startStudy() {
  if (state.live.active && !state.live.dataset)
    throw new Error(
      "Wait for live candle synchronization before starting research.",
    );
  saveDraft();
  collectSettings();
  retainResearchDraft(state.research);
  const r = state.research;
  let grid;
  try {
    grid = JSON.parse(r.grid);
  } catch {
    throw new Error(
      "Parameter grid must be a JSON object of candidate arrays.",
    );
  }
  r.job = await call("researchStart", {
    kind: r.kind,
    grid,
    objective: r.objective,
    source: state.source,
    settings: state.settings,
    inputs: baseInputs(),
    dataset: state.dataset,
    warmupBars: Number(r.warmupBars),
    ...(r.session.trim() ? { session: JSON.parse(r.session) } : {}),
    windows: {
      trainBars: Number(r.trainBars),
      testBars: Number(r.testBars),
      folds: Number(r.folds),
    },
  });
  render();
}
async function pollStudy() {
  if (!api || studyPolling || state.research.job?.status !== "running") return;
  studyPolling = true;
  try {
    const previous = state.research.job;
    state.research.job = await call("researchGet", { id: previous.id });
    const job = state.research.job;
    if ($("#research-progress"))
      $("#research-progress").textContent =
        `${job.status} · ${job.completed}/${job.total} executions${job.error ? ` · ${job.error}` : ""}`;
    if (job.status !== "running") {
      const workspace = await call("workspace");
      state.research.saved = workspace.savedStudies ?? [];
      if (state.page === "backtest") render();
      toast(
        job.status === "completed"
          ? "Research study completed."
          : (job.error ?? job.status),
        job.status !== "completed",
      );
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    studyPolling = false;
  }
}
$("#app").innerHTML =
  `<aside aria-label="Pine Desk navigation"><div class="brand"><span class="brand-mark">${uiIcon("workspace")}</span>Pine<span>Desk</span></div><nav id="nav" aria-label="Sections"></nav><div class="aside-bottom"><div><i class="dot"></i><span id="status">Local workspace</span></div><small>PineTS + Vela</small><span class="version">v${version} · research edition</span></div></aside><main><header><div><span class="breadcrumb">Research desk / </span><strong id="title"></strong></div><span class="local-badge" id="preview-status">${api ? "Local on your Mac" : "Browser preview · synthetic data"}</span></header><div id="page"></div></main><div id="toast" class="toast" role="status"></div>`;
render();
if (api)
  task(async () => {
    const data = await call("workspace");
    Object.assign(state, data);
    state.research.saved = data.savedStudies ?? [];
    state.edge.config = await call("edgeConfig");
    state.whale.config = await call("whaleConfig");
    state.providerSettings = await call("providerSettings");
    if (api.agentReady) state.agentAccess = await call("agentStatus");
    const ui = await call("uiConfig");
    state.appearance = ui.appearance;
    state.watchlist = ui.watchlist;
    state.layouts = await call("layoutList");
    destroyChart();
    hydrated = true;
    updateAppearance();
    render();
    await api.agentReady?.();
  });
else
  $("#preview-status").title =
    "Start the Electron app to use local data, providers and research tools.";
window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    if (state.page === "workspace" || state.page === "backtest")
      task(state.page === "workspace" ? runChart : backtest);
  }
});

if (api) {
  setInterval(pollOptions, 1000);
  setInterval(pollEngine, 5000);
  setInterval(pollLive, 1000);
  setInterval(pollStudy, 500);
  setInterval(() => {
    if (state.page === "workspace" && !state.busy) linkedCharts.poll();
  }, 1000);
  setInterval(pollWatchlist, 1000);
  setInterval(pollAlerts, 2000);
  setInterval(pollOrderBook, 500);
  setInterval(() => depthHistoryController.tick(), 100);
  setInterval(() => {
    if (
      !state.busy &&
      state.page === "orderflow" &&
      state.flowTab === "history"
    )
      depthHistoryController.poll();
  }, 1000);
}

async function mountOptionsChart() {
  const s = state.options.snapshot;
  if (!s?.bars?.length) {
    $("#options-chart").innerHTML =
      '<p class="footnote">Load underlying candles from Unusual Whales to display price and options overlays.</p>';
    return;
  }
  chartOwner = "options";
  chart = createOptionsPriceChart(
    "#options-chart",
    s.bars,
    s.timeframe,
    chartAppearance(),
  );
  const target = chart;
  await target.ready();
  if (chart !== target) return;
  optionsBarsRevision = JSON.stringify(s.bars);
  optionsOverlay = attachOptionsChart(
    chart,
    () => state.options.snapshot,
    s.ticker,
    () => state.options.snapshot.bars,
    s.timeframe,
    () => state.options,
  );
  updateOptionsOverlay();
  $("#options-chart").dataset.ready = "true";
}
function updateOptionsOverlay() {
  const counts = optionsOverlay?.update();
  if ($("#options-chart-counts") && counts)
    $("#options-chart-counts").textContent =
      `${counts.lines} level lines · ${counts.markers} flow markers`;
}
let optionsPolling = false;
async function pollOptions() {
  if (optionsPolling || !state.options.snapshot?.active) return;
  optionsPolling = true;
  try {
    const previous = state.options.snapshot,
      s = await call("optionsSnapshot");
    state.options.snapshot = s;
    if (state.page === "options") {
      if (!chart && s.bars?.length) await mountOptionsChart();
      else if (chart && JSON.stringify(s.bars) !== optionsBarsRevision) {
        optionsBarsRevision = JSON.stringify(s.bars);
        await chart.setMarket({
          data: s.bars,
          visibleRange: chart.getVisibleRange(),
        });
      }
      if (
        previous.revision !== s.revision ||
        previous.status !== s.status ||
        JSON.stringify(previous.errors) !== JSON.stringify(s.errors)
      )
        paintOptions(state.options);
    }
    if (["options", "workspace"].includes(state.page)) updateOptionsOverlay();
  } catch (e) {
    if ($("#options-status")) $("#options-status").textContent = e.message;
  } finally {
    optionsPolling = false;
  }
}
async function pollEngine() {
  if (
    state.page !== "settings" ||
    !state.providerSettings?.engineStatus?.running
  )
    return;
  try {
    const settings = await call("providerSettings");
    state.providerSettings.engineStatus = settings.engineStatus;
    if ($("#engine-status"))
      $("#engine-status").textContent =
        settings.engineStatus.error ?? settings.engineStatus.status;
  } catch {}
}

async function importStrategy() {
  let file;
  if (api?.importScript) file = await api.importScript();
  else
    file = await new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".pine,.txt";
      input.oncancel = () => resolve(null);
      input.onchange = async () => {
        const f = input.files[0];
        if (!f) return resolve(null);
        if (f.size > 200000) {
          toast("Pine source must be smaller than 200 KB.", true);
          return resolve(null);
        }
        try {
          const source = new TextDecoder("utf-8", { fatal: true }).decode(
            await f.arrayBuffer(),
          );
          resolve({ name: f.name, source });
        } catch {
          toast("Save the script as UTF-8 text.", true);
          resolve(null);
        }
      };
      input.click();
    });
  if (!file) return;
  const script = await call("importScriptFile", file);
  state.scripts.push(script);
  state.source = script.source;
  state.name = script.name;
  state.diagnostic = null;
  setSource(script.source);
  if ($("#script-name")) $("#script-name").value = script.name;
  persistSession();
  toast(
    "Source imported and saved. Choose Run chart or Backtest to execute it.",
  );
}
function bindCustomization() {
  if ($("#chart-count"))
    $("#chart-count").onchange = () =>
      task(async () => {
        linkedCharts.capture();
        state.multiChart.count = Number($("#chart-count").value);
        for (const id of [...linkedCharts.liveIds])
          if (
            !state.multiChart.panels
              .slice(0, state.multiChart.count - 1)
              .some((p) => p.id === id)
          )
            linkedCharts.liveIds.delete(id);
        linkedCharts.saved = false;
        render();
        await chartMount;
      });
  document.querySelectorAll("[data-chart-link]").forEach(
    (el) =>
      (el.onchange = () =>
        task(async () => {
          state.multiChart[el.dataset.chartLink] = el.checked;
          linkedCharts.saved = false;
          render();
          await chartMount;
        })),
  );
  const loadPanel = (id) =>
    task(async () => {
      const p = state.multiChart.panels.find((p) => p.id === id);
      const next = {
        ...p,
        symbol: document
          .querySelector(`[data-panel-symbol="${id}"]`)
          .value.trim()
          .toUpperCase(),
        timeframe: document.querySelector(`[data-panel-timeframe="${id}"]`)
          .value,
      };
      chartLayout({
        ...state.multiChart,
        panels: state.multiChart.panels.map((item) =>
          item.id === id ? next : item,
        ),
      });
      Object.assign(p, next);
      const live = document.querySelector(`[data-panel-live="${id}"]`).checked;
      chartLayout(state.multiChart);
      if (live) linkedCharts.liveIds.add(id);
      else linkedCharts.liveIds.delete(id);
      await linkedCharts.configure(true);
      render();
      await chartMount;
    });
  document
    .querySelectorAll("[data-panel-load]")
    .forEach((el) => (el.onclick = () => loadPanel(el.dataset.panelLoad)));
  document
    .querySelectorAll("[data-panel-live]")
    .forEach((el) => (el.onchange = () => loadPanel(el.dataset.panelLive)));
  const on = (id, fn) => {
    const el = $("#" + id);
    if (el) el.onclick = () => task(fn);
  };
  const saveUI = async (args) => {
    const ui = await call("uiConfigure", args);
    state.appearance = ui.appearance;
    state.watchlist = ui.watchlist;
    if (state.watchLive.active)
      state.watchLive = await call("watchlistStart", {
        symbols: state.watchlist
          .filter((i) => i.provider === "binance")
          .map((i) => i.symbol),
      });
  };
  on("appearance-save", async () => {
    await saveUI({
      appearance: {
        theme: $("#appearance-theme").value,
        upColor: $("#appearance-upColor").value,
        downColor: $("#appearance-downColor").value,
        editorFontSize: Number($("#appearance-editorFontSize").value),
      },
    });
    updateAppearance();
    toast("Appearance saved.");
  });
  on("appearance-reset", async () => {
    await saveUI({ appearance: defaultAppearance });
    updateAppearance();
    for (const k of Object.keys(defaultAppearance))
      $("#appearance-" + k).value = defaultAppearance[k];
    toast("Default appearance restored.");
  });
  on("layout-save", async () => {
    const saved = await call("layoutSave", {
      name: $("#layout-name").value,
      snapshot: sessionSnapshot(true),
    });
    state.layouts = await call("layoutList");
    render();
    $("#layout-select").value = saved.id;
    toast("Layout saved with a settled market snapshot.");
  });
  on("layout-load", async () => {
    const id = $("#layout-select").value;
    if (!id) throw new Error("Choose a saved layout.");
    await stopLive();
    state.options.snapshot = await call("optionsStop");
    const saved = await call("layoutActivate", { id });
    captureWorkspaceChart();
    destroyChart();
    const s = saved.snapshot;
    if (s.dataset) state.dataset = s.dataset;
    state.chartMemory = s.chart;
    state.multiChart = chartLayout(s.multiChart);
    linkedCharts.reset(state.multiChart);
    state.source = s.source;
    state.name = s.name;
    state.editor = s.editor;
    state.settings = { ...state.settings, ...s.settings };
    state.research.inputs = s.inputs;
    state.tab = s.tab;
    state.page = s.page;
    state.diagnostic = null;
    setSource(s.source);
    if ($("#script-name")) $("#script-name").value = s.name;
    pineEditor?.destroy();
    pineEditor = null;
    localStorage.setItem("pine-desk-draft", s.source);
    render();
    persistSession();
    toast("Layout restored. Live streams stay stopped.");
  });
  on("layout-delete", async () => {
    const id = $("#layout-select").value;
    if (!id) throw new Error("Choose a saved layout.");
    state.layouts = await call("layoutDelete", { id });
    render();
    toast("Layout deleted.");
  });
  on("watch-add", async () => {
    await saveUI({
      watchlist: [
        ...state.watchlist,
        {
          provider: $("#watch-provider").value,
          symbol: $("#watch-symbol").value,
          timeframe: $("#watch-timeframe").value,
        },
      ],
    });
    render();
  });
  on("watch-live", async () => {
    state.watchLive = state.watchLive.active
      ? await call("watchlistStop")
      : await call("watchlistStart", {
          symbols: state.watchlist
            .filter((i) => i.provider === "binance")
            .map((i) => i.symbol),
        });
    render();
  });
  on("market-search-button", async () => {
    const result = await call("marketSearch", {
      query: $("#market-search").value,
    });
    $("#market-search-results").innerHTML =
      result.markets
        .map(
          (m) =>
            `<button data-market-result="${esc(m.symbol)}"><strong>${esc(m.symbol)}</strong> ${esc(m.base)} / ${esc(m.quote)} · Binance spot</button>`,
        )
        .join("") || "No matching spot markets.";
    document.querySelectorAll("[data-market-result]").forEach(
      (el) =>
        (el.onclick = () => {
          $("#watch-provider").value = "binance";
          $("#watch-symbol").value = el.dataset.marketResult;
          $("#symbol").value = el.dataset.marketResult;
          $("#watch-symbol").focus();
        }),
    );
  });
  on("watch-refresh", async () => {
    const response = await call("watchlistQuotes", {
      symbols: state.watchlist
        .filter((i) => i.provider === "binance")
        .map((i) => i.symbol),
    });
    state.quotes = response.quotes;
    render();
    $("#watch-quote-status").textContent =
      `Retrieved ${new Date(response.retrievedAt).toISOString()} · ${
        Object.entries(response.errors)
          .map(([s, e]) => s + ": " + e)
          .join("; ") || "Quotes loaded."
      } Rolling 24-hour change; snapshots do not stream.`;
  });
  document.querySelectorAll("[data-watch-remove]").forEach(
    (el) =>
      (el.onclick = () =>
        task(async () => {
          await saveUI({
            watchlist: state.watchlist.filter(
              (_, i) => i !== Number(el.dataset.watchRemove),
            ),
          });
          render();
        })),
  );
  document.querySelectorAll("[data-watch-open]").forEach(
    (el) =>
      (el.onclick = () =>
        task(async () => {
          const market = state.watchlist[Number(el.dataset.watchOpen)];
          if (market.provider === "binance") {
            await stopLive();
            state.dataset = await call("loadMarket", {
              limit: Number($("#history-limit")?.value ?? 1000),
              symbol: market.symbol,
              timeframe: market.timeframe,
              limit: 1000,
            });
            state.page = "workspace";
            render();
          } else {
            await call("optionsStop");
            state.options.ticker = market.symbol;
            state.options.timeframe = market.timeframe;
            state.options.snapshot = await call("optionsRefresh", {
              ticker: market.symbol,
              timeframe: market.timeframe,
            });
            state.page = "options";
            render();
          }
        })),
  );
  if ($("#script-name")) $("#script-name").oninput = scheduleSession;
}

let cryptoPolling = false;
async function pollCrypto() {
  if (cryptoPolling || !state.crypto.snapshot?.active) return;
  cryptoPolling = true;
  try {
    state.crypto.snapshot = await call(
      state.crypto.exchange === "deribit"
        ? "deribitSnapshot"
        : "cryptoSnapshot",
      { exchange: state.crypto.exchange },
    );
    if (state.page === "crypto") paintCrypto(state.crypto);
  } catch (e) {
    if (state.page === "crypto") toast(e.message, true);
  } finally {
    cryptoPolling = false;
  }
}
setInterval(pollCrypto, 1000);

let recordPolling = false;
async function pollOptionRecorder() {
  if (recordPolling || !state.crypto.research.recording.active) return;
  recordPolling = true;
  try {
    const previous = state.crypto.research.recording,
      s = await call("optionRecordStatus");
    state.crypto.research.recording = s;
    if (previous.saved !== s.saved) {
      state.crypto.research.history = await call("optionHistoryList");
      state.crypto.research.refreshHistoryView?.();
    }
    if (state.page === "crypto") paintRecording(state.crypto);
  } catch (e) {
    if (state.page === "crypto") toast(e.message, true);
  } finally {
    recordPolling = false;
  }
}
setInterval(pollOptionRecorder, 2000);

let watchPolling = false;
async function pollWatchlist() {
  if (watchPolling || !api) return;
  watchPolling = true;
  try {
    state.watchLive = await call("watchlistSnapshot");
    if (state.watchLive.active) {
      for (const [symbol, quote] of Object.entries(state.watchLive.quotes))
        state.quotes[symbol] = quote;
    }
    if ($("#watch-live"))
      $("#watch-live").textContent = state.watchLive.active
        ? "Stop live quotes"
        : "Start live quotes";
    if (state.watchLive.active && $("#watch-quote-status"))
      $("#watch-quote-status").textContent =
        `${state.watchLive.status} · Binance rolling 24-hour change · quotes older than 30 seconds are marked stale${state.watchLive.error ? " · " + state.watchLive.error : ""}`;
    document.querySelectorAll("[data-watch-quote]").forEach((el) => {
      const q = state.quotes[el.dataset.watchQuote];
      if (q) {
        el.textContent = `${q.price.toLocaleString()} · ${q.change >= 0 ? "+" : ""}${q.change.toFixed(2)}%${q.stale || (q.receivedAt && (!state.watchLive.active || !state.watchLive.quotes?.[el.dataset.watchQuote] || Date.now() - q.receivedAt > 30000)) ? " · stale" : ""}`;
        el.title = q.eventAt
          ? new Date(q.eventAt).toISOString()
          : "REST snapshot";
      }
    });
  } catch (e) {
    if ($("#watch-quote-status"))
      $("#watch-quote-status").textContent = e.message;
  } finally {
    watchPolling = false;
  }
}

async function pollAlerts() {
  if (!api || state.page !== "alerts" || alertsPolling || state.busy) return;
  alertsPolling = true;
  try {
    await refreshAlerts(state.alerts, call);
    if (state.page === "alerts" && !state.busy)
      paintAlerts(state.alerts, alertBindings);
  } catch (error) {
    if (state.page === "alerts") toast(error.message, true);
  } finally {
    alertsPolling = false;
  }
}
