import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
let dir, dispatch;
test.beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pine-desk-ui-"));
  process.env.PINE_DESK_DATA_DIR = dir;
  ({ dispatch } = await import("../../core/service.js"));
});
test.afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
test("chart, Pine worker, actual backtest backend, analysis tabs, and order flow", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("backendCall", (action, args) =>
    dispatch(action, args),
  );
  await page.addInitScript(() => {
    window.desk = { call: (a, b) => window.backendCall(a, b) };
  });
  await page.goto("/");
  await expect(page.locator("#pine-editor .cm-content")).toBeVisible();
  await expect(page.locator("#chart canvas").first()).toBeVisible();
  await page.locator("#run-chart").click();
  await expect(page.locator("#toast")).toContainText("Script rendered", {
    timeout: 30000,
  });
  await page.locator("#run-backtest").click();
  await expect(page.locator("#title")).toHaveText("Strategy research", {
    timeout: 30000,
  });
  await expect(page.locator("#equity-plot")).toBeVisible();
  await page.locator('[data-tab="log"]').click();
  await expect(page.locator("tbody tr")).toHaveCount(5);
  await page.locator('[data-tab="analysis"]').click();
  await expect(page.locator("#trade-plot")).toBeVisible();
  await page.locator('[data-tab="simulation"]').click();
  await page.locator("#simulate").click();
  await expect(page.locator("#simulation-metrics")).toContainText("Median");
  await dispatch("importTrades", {
    symbol: "FIXTURE",
    csv: "time,price,size,side\n1767225600,65000,2,buy\n1767225601,65010,1,sell\n1767229200,65020,3,buy",
  });
  await page.locator('[data-page="orderflow"]').click();
  await page.locator("#refresh-flow").click();
  await expect(page.locator("#cvd-plot")).toBeVisible();
  await page.locator('[data-page="mcp"]').click();
  await expect(page.getByText("MCP CLIENT CONFIGURATION")).toBeVisible();
  await page.locator('[data-page="workspace"]').click();
  await expect(page.locator("#chart")).toHaveAttribute("data-ready", "true");
  await page.screenshot({ path: "test-results/workspace.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("library browse, search, import and saved Pine source", async ({
  page,
}) => {
  const source =
    '//@version=6\nindicator("Library fixture", overlay=true)\nplot(ta.ema(close, 20), "EMA")';
  await page.exposeFunction("backendCall", (action, args) => {
    if (action === "libraryList")
      return {
        total: 1,
        indicators: [
          {
            slug: "fixture",
            name: "Library fixture",
            family: "trend",
            description: "A local test fixture.",
          },
        ],
      };
    if (action === "librarySearch")
      return {
        results: [
          {
            slug: "fixture",
            name: "Library fixture",
            family: "trend",
            description: "A local test fixture.",
          },
        ],
      };
    if (action === "librarySource")
      return {
        available: true,
        slug: "fixture",
        name: "Library fixture",
        source,
      };
    return dispatch(action, args);
  });
  await page.addInitScript(() => {
    window.desk = { call: (a, b) => window.backendCall(a, b) };
  });
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("Local workspace");
  await page.locator('[data-page="library"]').click();
  await page.locator("#browse-empty").click();
  await expect(page.locator(".library-card h3")).toHaveText("Library fixture");
  await page.locator("#library-query").fill("EMA");
  await page.locator("#search-library").click();
  await expect(page.locator("[data-import-source]")).toBeVisible();
  await page.locator("[data-import-source]").click();
  await expect(page.locator("#source")).toHaveValue(source);
  await page.locator("#run-chart").click();
  await expect(page.locator("#toast")).toContainText("Script rendered");
  const workspace = await dispatch("workspace");
  assertSource(workspace, source);
});
function assertSource(workspace, source) {
  expect(
    workspace.scripts.some(
      (s) => s.source === source && s.provenance?.slug === "fixture",
    ),
  ).toBeTruthy();
}
test("Edge Stats evidence and Whale Options audit panels preserve upstream caveats", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const config = { mode: "local", endpoint: "http://127.0.0.1:3344/mcp" };
  const report = {
    n: 2,
    successes: 1,
    estimate: null,
    ci95: null,
    query: {
      dsl: "gapFill",
      outcome: "gapFill",
      symbol: "TEST",
      sessionKey: "rth",
    },
    guards: { lowSample: true, refused: true },
    disclaimer: "Historical conditional frequencies. Not predictions.",
    sessions: [],
    perYear: [],
  };
  await page.exposeFunction("backendCall", async (action, args) => {
    if (action === "edgeConfigure") return config;
    if (action === "edgeOverview")
      return {
        config,
        coverage: {
          symbols: [
            { symbol: "TEST", tf: "1m", lastBar: "2024-12-30T20:59:00Z" },
          ],
          engineVersion: "0.1.0",
        },
        catalog: {
          presets: [
            { id: "gap-fill", title: "Gap Fill", summary: "Test definition" },
          ],
        },
        retrievedAt: Date.now(),
      };
    if (action === "edgeReport")
      return { config, result: report, retrievedAt: Date.now() };
    if (action === "whaleConfigure") return args;
    if (action === "whaleStatus")
      return {
        result: {
          ticks: 100,
          events: 1,
          cold_start: true,
          live_engine: false,
          baseline_sessions: 0,
          chains_available: [{ underlying: "NVDA" }],
        },
      };
    if (action === "whaleRecent")
      return {
        result: {
          events: [
            {
              id: "test",
              ts: Date.now(),
              underlying: "NVDA",
              contract: "FIXTURE",
              kind: "sweep",
              side: "unknown",
              premium: 50000,
              score: 60,
              cold_start: true,
            },
          ],
        },
      };
    if (action === "whaleEvent")
      return {
        result: {
          id: "test",
          cold_start: true,
          legs_detail: [{ nbbo_at_print: null }],
          score_breakdown: { missing: ["volumeVsBaseline"] },
        },
      };
    if (action === "whaleGex")
      return {
        result: {
          snapshot_age_ms: 60000,
          gex: {
            convention: "dealer-long-calls-short-puts",
            conventionNote: "Dealer positioning is an assumption.",
            totalGex: 1,
            perStrike: [],
            skippedContracts: 0,
          },
        },
      };
    return dispatch(action, args);
  });
  await page.addInitScript(() => {
    window.desk = { call: (a, b) => window.backendCall(a, b) };
  });
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("Local workspace");
  await page.locator('[data-page="edge"]').click();
  await page.locator("#edge-mode").selectOption("local");
  await page.locator("#edge-connect").click();
  await expect(page.locator("#edge-symbol")).toHaveValue("TEST");
  await page.locator("#edge-run-report").click();
  await expect(page.locator(".edge-warning")).toContainText(
    "ESTIMATE WITHHELD",
  );
  await expect(page.locator(".edge-metrics")).toContainText("Withheld");
  await expect(page.locator(".edge-metrics")).toContainText("2");
  await page.locator('[data-page="whale"]').click();
  await page.locator("#whale-source").selectOption("synthetic");
  await page.locator("#whale-connect").click();
  await expect(page.locator("#whale-panel")).toContainText("COLD START");
  await page.locator("#whale-recent").click();
  await expect(page.locator("#whale-panel tbody")).toContainText("unknown");
  await page.locator("[data-whale-event]").click();
  await expect(page.locator("#whale-panel")).toContainText("nbbo_at_print");
  await page.locator('[data-whale-analysis="gex"]').click();
  await expect(page.locator("#whale-panel")).toContainText(
    "Dealer positioning is an assumption.",
  );
  expect(errors).toEqual([]);
});
test("Pine editor highlights, completes, reports errors, and runs sweeps and walk-forward studies", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("backendCall", (action, args) =>
    dispatch(action, args),
  );
  await page.addInitScript(() => {
    window.desk = { call: (a, b) => window.backendCall(a, b) };
  });
  await page.goto("/");
  await expect(page.locator("#pine-editor .cm-content")).toBeVisible();
  const editor = page.locator("#pine-editor .cm-content");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await editor.fill('//@version=6\nindicator("Complete")\nplot(ta.em');
  await editor.press("Control+Space");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText(
    "ta.ema",
  );
  await editor.press("Escape");
  await editor.fill('//@version=6\nindicator("Bad")\nplot(');
  await page.locator("#run-chart").click();
  await expect(page.locator("#editor-errors")).toContainText("error", {
    timeout: 30000,
  });
  const source =
    '//@version=6\nstrategy("Research fixture")\nexitBar = input.int(4, "Exit bar")\nif bar_index == 0\n    strategy.entry("Long", strategy.long, qty=0.01)\nif bar_index == exitBar\n    strategy.close("Long")';
  await editor.fill(source);
  await page.locator("#run-backtest").click();
  await expect(page.locator("#research-panel")).toBeVisible();
  await page.locator("#research-grid").fill('{"Exit bar":[2,4]}');
  await page.locator("#research-start").click();
  await expect(page.locator("#research-progress")).toContainText("completed", {
    timeout: 30000,
  });
  await expect(page.locator("[data-study-run]")).toHaveCount(2);
  await page.locator("[data-study-run]").first().click();
  await expect(page.locator("#research-inputs")).toHaveValue('{"Exit bar":2}');
  await page.locator("[data-compare-run]").first().check();
  await page.locator("[data-compare-run]").nth(1).check();
  await page.locator("#compare-runs").click();
  await expect(page.locator("#comparison-plot")).toBeVisible();
  await page.locator("#research-kind").selectOption("walkForward");
  await page.locator("#research-trainBars").fill("200");
  await page.locator("#research-testBars").fill("100");
  await page.locator("#research-folds").fill("2");
  await page.locator("#research-start").click();
  await expect(page.locator("#research-progress")).toContainText("completed", {
    timeout: 30000,
  });
  await expect(page.locator("[data-study-fold]")).toHaveCount(2);
  await expect(page.locator("#research-panel")).toContainText(
    "entries blocked before the boundary",
  );
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/research.png", fullPage: true });
});
test("continuous live updates preserve editor drafts and drive live order flow from the backend", async ({
  page,
}) => {
  const { live } = await import("../../core/service.js");
  const { EventEmitter } = await import("node:events");
  const oldHistory = live.fetchHistory,
    oldSocket = live.createSocket;
  let socket;
  const start = Date.UTC(2026, 0, 1),
    history = [0, 1].map((i) => ({
      time: start + i * 60000,
      open: 100,
      high: 105,
      low: 95,
      close: 101 + i,
      volume: 10,
    }));
  live.fetchHistory = async () => history;
  live.createSocket = () => {
    socket = new EventEmitter();
    socket.terminate = () => socket.emit("close");
    queueMicrotask(() => socket.emit("open"));
    return socket;
  };
  try {
    await page.exposeFunction("backendCall", (action, args) =>
      dispatch(action, args),
    );
    await page.addInitScript(() => {
      window.desk = { call: (a, b) => window.backendCall(a, b) };
    });
    await page.goto("/");
    await expect(page.locator("#status")).toHaveText("Local workspace");
    await page.locator("#timeframe").selectOption("1m");
    await page.locator("#live-start").click();
    await expect(page.locator("#live-status")).toContainText("STREAMING", {
      timeout: 10000,
    });
    const draft = '//@version=6\nindicator("Live draft")\nplot(close)';
    await page.locator("#pine-editor .cm-content").fill(draft);
    socket.emit(
      "message",
      JSON.stringify({
        e: "kline",
        s: "BTCUSDT",
        k: {
          t: start + 120000,
          i: "1m",
          o: "102",
          h: "110",
          l: "100",
          c: "108",
          v: "4",
          x: false,
        },
      }),
    );
    socket.emit(
      "message",
      JSON.stringify({
        e: "trade",
        s: "BTCUSDT",
        t: 1,
        T: start + 120001,
        p: "108",
        q: "2",
        m: false,
      }),
    );
    socket.emit(
      "message",
      JSON.stringify({
        e: "trade",
        s: "BTCUSDT",
        t: 2,
        T: start + 120002,
        p: "107",
        q: "1",
        m: true,
      }),
    );
    await expect(page.locator("#market-price")).toHaveText("108.00", {
      timeout: 10000,
    });
    await expect(page.locator("#source")).toHaveValue(draft);
    assertBars(live.snapshot().dataset.bars, 2);
    socket.emit(
      "message",
      JSON.stringify({
        e: "kline",
        s: "BTCUSDT",
        k: {
          t: start + 300000,
          i: "1m",
          o: "102",
          h: "112",
          l: "100",
          c: "110",
          v: "4",
          x: true,
        },
      }),
    );
    socket.emit(
      "message",
      JSON.stringify({
        e: "kline",
        s: "BTCUSDT",
        k: {
          t: start + 360000,
          i: "1m",
          o: "110",
          h: "115",
          l: "108",
          c: "112",
          v: "4",
          x: false,
        },
      }),
    );
    await expect(page.locator("#market-price")).toHaveText("112.00");
    await expect(page.locator("#live-status")).not.toContainText("error");
    await expect(page.locator("#source")).toHaveValue(draft);
    await page.locator('[data-page="orderflow"]').click();
    await page.locator("#flow-source").selectOption("live");
    await expect(page.locator("#cvd-plot")).toBeVisible();
    await expect(page.locator(".metrics")).toContainText("2");
    await page.locator('[data-page="workspace"]').click();
    await page.locator("#live-stop").click();
    await expect(page.locator("#live-status")).toContainText("stopped");
    await expect(page.locator("#source")).toHaveValue(draft);
  } finally {
    live.stop();
    live.fetchHistory = oldHistory;
    live.createSocket = oldSocket;
  }
});
function assertBars(bars, length) {
  expect(bars.length).toEqual(length);
}

test("options settings, actual Vela level overlays, GEX graph, stream markers and mismatched ticker isolation", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const bars = Array.from({ length: 20 }, (_, i) => ({
    time: Date.parse("2026-09-30T14:30:00Z") + i * 300000,
    open: 500 + i / 10,
    high: 503 + i / 10,
    low: 498 + i / 10,
    close: 501 + i / 10,
    volume: 100,
  }));
  const fixture = {
    provider: "Unusual Whales",
    active: false,
    status: "stopped",
    ticker: "SPY",
    timeframe: "5m",
    bars,
    gex: [
      {
        strike: 495,
        call: 100000,
        put: -150000,
        net: -50000,
        spot: 502,
        time: bars[0].time,
      },
      {
        strike: 510,
        call: 200000,
        put: -80000,
        net: 120000,
        spot: 502,
        time: bars[0].time,
      },
    ],
    totalGex: 70000,
    levels: {
      callWall: 510,
      putWall: 495,
      zeroGamma: 500,
      nearbyFlips: [500, 501],
      source: "oi",
      time: bars[0].time,
      method: "Provider cumulative crossing",
    },
    trades: [],
    gaps: [],
    errors: {},
    revision: 1,
  };
  await page.exposeFunction("backendCall", async (action, args) => {
    if (action === "optionsRefresh") return structuredClone(fixture);
    if (action === "optionsStart") {
      fixture.active = true;
      fixture.status = "streaming";
      fixture.revision++;
      fixture.trades = [
        {
          id: "ui-live-1",
          time: bars[5].time + 5000,
          ticker: "SPY",
          contract: "SPY261002C00510000",
          type: "call",
          side: "ask",
          premium: 60000,
          underlyingPrice: 502,
        },
      ];
      return structuredClone(fixture);
    }
    if (action === "optionsSnapshot") return structuredClone(fixture);
    if (action === "optionsStop") {
      fixture.active = false;
      fixture.status = "stopped";
      return structuredClone(fixture);
    }
    return dispatch(action, args);
  });
  await page.addInitScript(() => {
    window.desk = { call: (a, b) => window.backendCall(a, b) };
  });
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("Local workspace");
  await page.locator('[data-page="settings"]').click();
  await expect(page.locator("#credential-unusualWhales")).toHaveAttribute(
    "type",
    "password",
  );
  await expect(page.locator("#engine-feed")).toHaveValue("synthetic");
  await page.locator('[data-page="options"]').first().click();
  await page.locator("#options-refresh").click();
  await expect(page.locator('#options-chart[data-ready="true"]')).toBeVisible();
  await expect(page.locator("#options-chart-counts")).toHaveText(
    "3 level lines · 0 flow markers",
  );
  await expect(page.locator("#options-gex svg")).toBeVisible();
  await expect(page.locator("#options-summary")).toContainText("70,000");
  await page.locator("#options-start").click();
  await expect(page.locator("#options-chart-counts")).toHaveText(
    "3 level lines · 1 flow markers",
  );
  await expect(page.locator("#options-trades")).toContainText(
    "SPY261002C00510000",
  );
  await page.locator("#options-levels").uncheck();
  await expect(page.locator("#options-chart-counts")).toHaveText(
    "0 level lines · 1 flow markers",
  );
  // Inspect real Vela output through its public API, independent of UI count labels.
  const rendered = await page.evaluate(
    async ({ bars, snapshot }) => {
      const { createOptionsPriceChart, attachOptionsChart } = await import(
        "/src/options-chart.js"
      );
      const div = document.createElement("div");
      div.style.cssText = "width:700px;height:400px";
      document.body.append(div);
      const c = createOptionsPriceChart(div, bars, "5m");
      await c.ready();
      const overlay = attachOptionsChart(
        c,
        () => snapshot,
        "SPY",
        () => bars,
        "5m",
      );
      overlay.update();
      await new Promise((r) => setTimeout(r, 50));
      const info = c.inspect();
      const marks = c.marks.all().length;
      const mismatch = attachOptionsChart(
        c,
        () => snapshot,
        "QQQ",
        () => bars,
        "5m",
      );
      mismatch.update();
      const unmatched = c.marks.all().length;
      await new Promise((r) => setTimeout(r, 50));
      c.destroy();
      div.remove();
      return { info, marks, unmatched };
    },
    { bars, snapshot: structuredClone(fixture) },
  );
  expect(rendered.info.totals.priceLines).toBe(3);
  expect(rendered.marks).toBe(1);
  expect(rendered.unmatched).toBe(0);
  await page.locator("#options-stop").click();
  await expect(page.locator("#options-status")).toContainText("stopped");
  expect(errors).toEqual([]);
});

test("themes follow OS, strategy files import safely, layouts restore and watchlists persist across reloads", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const source =
    '//@version=6\nindicator("Imported workspace")\nplot(close, "Close")\n// License preserved';
  await page.exposeFunction("backendCall", async (action, args) => {
    if (action === "watchlistQuotes")
      return {
        quotes: { BTCUSDT: { price: 64000, change: 2.5 } },
        retrievedAt: Date.now(),
        errors: {},
      };
    if (action === "loadMarket")
      return dispatch("importBars", {
        bars: Array.from({ length: 30 }, (_, i) => ({
          time: Date.parse("2026-09-30T00:00:00Z") + i * 3600000,
          open: 100 + i,
          high: 105 + i,
          low: 95 + i,
          close: 101 + i,
          volume: 10,
        })),
        symbol: args.symbol,
        timeframe: args.timeframe,
      });
    return dispatch(action, args);
  });
  await page.addInitScript((source) => {
    window.desk = {
      call: (a, b) => window.backendCall(a, b),
      importScript: async () => ({ name: "Custom idea.pine", source }),
    };
  }, source);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("#chart[data-ready=true]")).toBeVisible();
  await page.locator("[data-page=settings]").click();
  await page.locator("#appearance-theme").selectOption("system");
  await page.locator("#appearance-editorFontSize").fill("16");
  await page.locator("#appearance-save").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator("[data-page=workspace]").click();
  await page.locator("#import-script").click();
  await expect(page.locator("#source")).toHaveValue(source);
  await expect(page.locator("#script-name")).toHaveValue("Custom idea");
  await page.locator("#run-chart").click();
  await expect(page.locator("#toast")).toContainText("Script rendered");
  await page.locator("#layout-name").fill("Imported research");
  await page.locator("#layout-save").click();
  await expect(page.locator("#toast")).toContainText("Layout saved");
  const layouts = await dispatch("layoutList");
  const saved = await dispatch("layoutRead", { id: layouts[0].id });
  expect(saved.snapshot.chart.indicators.some((i) => i.source === source)).toBe(
    true,
  );
  await page
    .locator("#pine-editor .cm-content")
    .fill('//@version=6\nindicator("Other")\nplot(open)');
  await page.locator("#toggle-editor").click();
  await page.locator("#layout-select").selectOption(layouts[0].id);
  await page.locator("#layout-load").click();
  await expect(page.locator("#source")).toHaveValue(source);
  await expect(page.locator("#script-name")).toHaveValue("Custom idea");
  await expect(page.locator("#chart[data-ready=true]")).toBeVisible();
  await page.locator("#watch-symbol").fill("BTCUSDT");
  await page.locator("#watch-add").click();
  await expect(page.locator("[data-watch-open]")).toContainText("BTCUSDT");
  await page.locator("#watch-refresh").click();
  await expect(page.locator(".watch-items")).toContainText("64,000");
  await page.locator("[data-watch-open]").click();
  await expect(page.locator(".market-title strong")).toHaveText("BTCUSDT");
  await page.locator("#toggle-editor").click();
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator("#chart[data-ready=true]")).toBeVisible();
  await expect(page.locator("#toggle-editor")).toBeVisible();
  await expect(page.locator("#pine-editor")).toHaveCount(0);
  await expect(page.locator("[data-watch-open]")).toContainText("BTCUSDT");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator("#toggle-editor").click();
  await expect(page.locator("#source")).toHaveValue(source);
  expect(
    await page
      .locator("#pine-editor .cm-editor")
      .evaluate((el) => getComputedStyle(el).fontSize),
  ).toBe("16px");
  expect(errors).toEqual([]);
});

test("saved chart documents restore native pane grouping, collapse and study drawings through public Vela APIs", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createOptionsPriceChart } = await import("/src/options-chart.js");
    const { captureChart, restoreChart } = await import(
      "/src/workspace-customization.js"
    );
    const bars = Array.from({ length: 40 }, (_, i) => ({
      time: Date.parse("2026-09-30T00:00:00Z") + i * 60000,
      open: 100 + i,
      high: 105 + i,
      low: 95 + i,
      close: 101 + i,
      volume: 100,
    }));
    const div = document.createElement("div");
    div.style.cssText = "width:800px;height:500px";
    document.body.append(div);
    let c = createOptionsPriceChart(div, bars, "1m");
    await c.ready();
    const a = c.addNativeIndicator("rsi"),
      b = c.addNativeIndicator("rsi");
    await new Promise((r) => setTimeout(r, 50));
    const pane = c.panes
      .list()
      .find((p) => p.indicators.some((i) => i.id === a.id));
    b.moveTo({ pane: pane.id });
    c.panes.collapse(pane.id, true);
    c.drawings.add("hline", {
      paneId: pane.id,
      anchors: [{ time: bars[5].time, price: 50 }],
    });
    const doc = captureChart(c, { symbol: "TEST", timeframe: "1m" });
    const before = c.panes.list().filter((p) => p.kind === "study");
    c.destroy();
    c = createOptionsPriceChart(div, bars, "1m");
    await c.ready();
    const errors = [];
    await restoreChart(c, doc, (e) => errors.push(e.message));
    const panes = c.panes.list().filter((p) => p.kind === "study"),
      drawings = c.drawings.toJSON();
    const out = { before, panes, drawings, errors };
    c.destroy();
    div.remove();
    return out;
  });
  expect(result.before).toHaveLength(1);
  expect(result.panes).toHaveLength(1);
  expect(result.panes[0].indicators).toHaveLength(2);
  expect(result.panes[0].collapsed).toBe(true);
  expect(result.drawings.drawings).toHaveLength(1);
  expect(result.drawings.drawings[0].paneId).toBe(result.panes[0].id);
  expect(result.errors).toEqual([]);
});
