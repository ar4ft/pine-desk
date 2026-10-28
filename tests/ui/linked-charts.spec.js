import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chartLayout } from "../../core/chart-layout.js";
import { demoBars } from "../../core/data.js";
let dir, service, previousUI, previousHistory, previousLayouts;
test.beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pine-linked-ui-"));
  process.env.PINE_DESK_DATA_DIR = dir;
  service = await import("../../core/service.js");
  previousUI = await service.dispatch("uiConfig");
  previousLayouts = await service.dispatch("layoutList");
  previousHistory = service.chartPanels.fetchHistory;
  await service.dispatch("uiConfigure", { watchlist: [] });
  service.chartPanels.fetchHistory = async (r) => ({
    symbol: r.symbol,
    timeframe: r.timeframe,
    origin: "Binance fixture",
    bars: demoBars()
      .slice(-200)
      .map((b) => ({
        ...b,
        open: b.open / 20,
        high: b.high / 20,
        low: b.low / 20,
        close: b.close / 20,
      })),
  });
});
test.afterAll(async () => {
  await service.dispatch("uiConfigure", previousUI);
  for (const layout of await service.dispatch("layoutList"))
    if (!previousLayouts.some((p) => p.id === layout.id))
      await service.dispatch("layoutDelete", { id: layout.id });
  service.chartPanels.fetchHistory = previousHistory;
  await service.shutdown();
  await fs.rm(dir, { recursive: true, force: true });
});
async function setup(page, override = () => undefined) {
  await page.exposeFunction(
    "backendCall",
    async (action, args) =>
      override(action, args) ?? service.dispatch(action, args),
  );
  await page.addInitScript(() => {
    window.desk = {
      call: (a, b) => window.backendCall(a, b),
      onAgentCommand: (fn) => {
        window.agentCommand = fn;
      },
    };
  });
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("Local workspace");
  await expect(page.locator("#chart")).toHaveAttribute("data-ready", "true");
}
const state = (page) =>
  page.evaluate(() => window.agentCommand("desktopState"));
test("two/four charts link ranges, isolate research, save snapshots and restore without streams", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page);
  const initial = await state(page);
  await page.locator("#chart-count").selectOption("2");
  await expect(page.locator("#compare-1")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.locator("#status")).toHaveText("Local workspace");
  let observed = await state(page);
  expect(observed.panels).toHaveLength(2);
  expect(observed.panels[0].instrument).toEqual(initial.panels[0].instrument);
  expect(observed.panels[1].instrument.symbol).toBe("ETHUSDT");
  const range = {
    from: observed.panels[1].lastBarAt - 70 * 3600000,
    to: observed.panels[1].lastBarAt,
  };
  await page.evaluate(
    (range) =>
      window.agentCommand("desktopSetRange", {
        panelId: "compare-1",
        ...range,
      }),
    range,
  );
  observed = await state(page);
  expect(
    Math.abs(
      observed.panels[0].chart.range.from - observed.panels[1].range.from,
    ),
  ).toBeLessThan(3600000);
  expect(
    Math.abs(observed.panels[0].chart.range.to - observed.panels[1].range.to),
  ).toBeLessThan(3600000);
  await page.locator('[data-chart-link="linkRange"]').uncheck();
  await expect(page.locator("#status")).toHaveText("Local workspace");
  const before = await state(page);
  await page.evaluate(
    (range) =>
      window.agentCommand("desktopSetRange", {
        panelId: "compare-1",
        from: range.from + 20 * 3600000,
        to: range.to,
      }),
    range,
  );
  observed = await state(page);
  expect(observed.panels[0].chart.range).toEqual(before.panels[0].chart.range);
  await page.locator("#chart-count").selectOption("4");
  await expect(page.locator("#compare-3")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.locator("#status")).toHaveText("Local workspace");
  expect((await state(page)).panels).toHaveLength(4);
  await page.screenshot({
    path: "test-results/linked-charts.png",
    fullPage: true,
    style: "#toast { visibility: hidden; }",
  });
  await page.locator("#layout-name").fill("Four market comparison");
  await page.locator("#layout-save").click();
  await expect(page.locator("#toast")).toContainText("Layout saved");
  const layouts = await service.dispatch("layoutList");
  const saved = await service.dispatch("layoutRead", { id: layouts[0].id });
  expect(saved.snapshot.multiChart.panels[0].dataset.symbol).toBe("ETHUSDT");
  expect(saved.snapshot.multiChart.panels[2].dataset.symbol).toBe("BTCUSDT");
  await page.locator("#chart-count").selectOption("1");
  await expect(page.locator("#status")).toHaveText("Local workspace");
  expect(await service.dispatch("chartPanelsSnapshot")).toEqual([]);
  await page.locator("#layout-select").selectOption(layouts[0].id);
  await page.locator("#layout-load").click();
  await expect(page.locator("#compare-3")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.locator('[data-panel-status="compare-1"]')).toContainText(
    "saved snapshot",
  );
  expect(await service.dispatch("chartPanelsSnapshot")).toEqual([]);
  await page.locator("#run-backtest").click();
  await expect(page.locator("#title")).toHaveText("Strategy research");
  const workspace = await service.dispatch("workspace");
  expect(workspace.runs[0].dataset.symbol).toBe(
    initial.panels[0].instrument.symbol,
  );
  expect(errors).toEqual([]);
});
test("search adds provider-qualified markets and streaming watchlist paints without destroying charts", async ({
  page,
}) => {
  let active = false,
    ticks = 0;
  await setup(page, (action) => {
    if (action === "marketSearch")
      return {
        markets: [
          {
            symbol: "ETHUSDT",
            base: "ETH",
            quote: "USDT",
            provider: "binance",
          },
        ],
      };
    if (action === "watchlistStart") {
      active = true;
      return { active, status: "waiting", quotes: {} };
    }
    if (action === "watchlistStop") {
      active = false;
      return { active, status: "stopped", quotes: {} };
    }
    if (action === "watchlistSnapshot")
      return {
        active,
        status: active ? "streaming" : "stopped",
        quotes: active
          ? {
              ETHUSDT: {
                price: 2000 + ++ticks,
                change: 1.25,
                eventAt: Date.now(),
                receivedAt: Date.now(),
                stale: ticks >= 3,
              },
            }
          : {},
      };
  });
  await page.locator("#market-search").fill("ETH");
  await page.locator("#market-search-button").click();
  await page.locator('[data-market-result="ETHUSDT"]').click();
  await expect(page.locator("#watch-symbol")).toHaveValue("ETHUSDT");
  await page.locator("#watch-add").click();
  await expect(page.locator('[data-watch-quote="ETHUSDT"]')).toBeVisible();
  await page.locator("#watch-live").click();
  await expect(page.locator("#status")).toHaveText("Local workspace");
  await expect(page.locator("#chart")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => {
    window.originalCanvas = document.querySelector("#chart canvas");
  });
  await expect(page.locator('[data-watch-quote="ETHUSDT"]')).toContainText(
    "1.25%",
  );
  await expect(page.locator('[data-watch-quote="ETHUSDT"]')).toContainText(
    "stale",
    { timeout: 10000 },
  );
  expect(
    await page.evaluate(
      () => document.querySelector("#chart canvas") === window.originalCanvas,
    ),
  ).toBe(true);
  await page.locator("#watch-live").click();
  await expect(page.locator("#watch-live")).toHaveText("Start live quotes");
});

test("rerender during restored-grid history loading awaits the shared request", async ({
  page,
}) => {
  let release;
  const layout = chartLayout();
  layout.count = 2;
  await page.addInitScript((layout) => {
    localStorage.setItem(
      "pine-desk-session",
      JSON.stringify({
        page: "workspace",
        source: '//@version=6\nindicator("Draft")\nplot(close)',
        editor: true,
        multiChart: layout,
      }),
    );
  }, layout);
  await setup(page, (action, args) => {
    if (action === "chartPanelsConfigure" && args.panels.length)
      return new Promise((resolve) => {
        release = () => resolve(service.dispatch(action, args));
      });
  });
  await expect.poll(() => !!release).toBe(true);
  await page.locator("#toggle-editor").click();
  await expect(page.locator("#pine-editor")).toHaveCount(0);
  release();
  await expect(page.locator("#compare-1")).toHaveAttribute(
    "data-ready",
    "true",
  );
  expect((await state(page)).panels[1].settledBars).toBe(200);
  await page.locator("#chart-count").selectOption("1");
  await expect(page.locator("#status")).toHaveText("Local workspace");
});
