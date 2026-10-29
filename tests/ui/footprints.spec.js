import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { orderflow } from "../../core/orderflow.js";
import { demoBars } from "../../core/data.js";
let dir, dispatch;
test.beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pd-footprint-ui-"));
  process.env.PINE_DESK_DATA_DIR = dir;
  ({ dispatch } = await import("../../core/service.js"));
});
test.afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
const start = Date.UTC(2026, 0, 1);
const tradesFor = (time, buy = 9, sell = 1) =>
  [100, 101, 102, 103].flatMap((price) => [
    { time, price, size: buy, side: "buy" },
    { time: time + 1, price, size: sell, side: "sell" },
  ]);
test("historical footprints, diagonal stacks, bar/range value areas and explicit row paging", async ({
  page,
}) => {
  let trades = [...tradesFor(start), ...tradesFor(start + 60000, 1, 9)];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("backendCall", (action, args) =>
    action === "orderflow"
      ? {
          ...orderflow(trades, args),
          symbol: "FIXTURE",
          gaps: [
            {
              from: start + 60000,
              to: start + 61000,
              reason: "Fixture missing prints",
            },
          ],
        }
      : dispatch(action, args),
  );
  await page.addInitScript(() => {
    window.desk = { call: (a, b) => window.backendCall(a, b) };
  });
  await page.goto("/");
  await expect(page.locator("#chart")).toHaveAttribute("data-ready", "true");
  await page.locator('[data-page="orderflow"]').click();
  await page.locator("#flow-timeframe").selectOption("1m");
  await page.locator("#tick-size").fill("1");
  await page.locator("#refresh-flow").click();
  await expect(page.locator("#footprint-stacks")).toContainText(
    "SELL stack: 100–103",
  );
  await expect(page.locator(".footprint-gap").first()).toContainText(
    "Incomplete trade coverage",
  );
  await page.locator("#footprint-prev").click();
  await expect(page.locator("#footprint-selection")).toContainText(
    "pinned historical bar",
  );
  await expect(page.locator("#footprint-stacks")).toContainText(
    "BUY stack: 101–104",
  );
  await expect(page.locator(".stacked.buy")).toHaveCount(3);
  await expect(page.locator("#footprint-area")).toContainText("75% achieved");
  await page.locator("#profile-scope").selectOption("bar");
  await expect(page.locator("#profile-area")).toContainText("VAL 101");
  await page.locator("#footprint-index").fill("2");
  await page.locator("#footprint-index").press("Enter");
  await expect(page.locator("#footprint-stacks")).toContainText("SELL stack");
  await page.locator("#imbalance-min").fill("10");
  await page.locator("#refresh-flow").click();
  await expect(page.locator("#footprint-stacks")).toContainText(
    "No qualifying stacks",
  );
  await expect(page.locator("#footprint-index")).toHaveValue("2");
  await page.locator("#imbalance-min").fill("0");
  await page.locator("#refresh-flow").click();
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1100, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/footprints-${theme}.png`,
      fullPage: true,
      style: "#toast {visibility:hidden}",
    });
  }
  trades = Array.from({ length: 205 }, (_, i) => ({
    time: start + 60000,
    price: 100 + i,
    size: 1,
    side: "buy",
  }));
  await page.locator("#refresh-flow").click();
  await expect(page.locator(".footprint-table tbody tr")).toHaveCount(100);
  await expect(page.locator(".footprint-pager").first()).toContainText(
    "of 205",
  );
  await page.locator('[data-flow-rows="levels:1"]').click();
  await expect(page.locator(".footprint-pager").first()).toContainText(
    "101–200",
  );
  await page.locator('[data-flow-rows="levels:1"]').click();
  await expect(page.locator(".footprint-table tbody tr")).toHaveCount(5);
  expect(errors).toEqual([]);
});

test("live refresh preserves historical pin and settings drafts, and reports an evicted bar", async ({
  page,
}) => {
  let trades = [...tradesFor(start), ...tradesFor(start + 60000, 1, 9)],
    calls = 0;
  const dataset = {
    bars: demoBars().slice(-3),
    symbol: "BTCUSDT",
    timeframe: "1h",
    origin: "Binance fixture",
  };
  await page.exposeFunction("backendCall", (action, args) => {
    if (action === "liveSnapshot")
      return {
        active: true,
        status: "streaming",
        dataset,
        tradeCount: trades.length,
        gaps: [],
        forming: null,
      };
    if (action === "liveFlow") {
      calls++;
      return {
        ...orderflow(trades, args),
        symbol: "BTCUSDT",
        gaps: [],
        status: "streaming",
      };
    }
    return dispatch(action, args);
  });
  await page.addInitScript(() => {
    window.desk = { call: (a, b) => window.backendCall(a, b) };
  });
  await page.goto("/");
  await expect(page.locator("#chart")).toHaveAttribute("data-ready", "true");
  await page.locator('[data-page="orderflow"]').click();
  await page.locator("#flow-timeframe").selectOption("1m");
  await page.locator("#tick-size").fill("1");
  await page.locator("#flow-source").selectOption("live");
  await expect(page.locator("#cvd-plot")).toBeVisible();
  await page.locator("#footprint-prev").click();
  await page.locator("#imbalance-ratio").fill("7.5");
  const before = calls;
  trades.push(...tradesFor(start + 120000));
  await expect.poll(() => calls).toBeGreaterThan(before);
  await expect(page.locator("#footprint-index")).toHaveValue("1");
  await expect(page.locator("#footprint-stacks")).toContainText("BUY stack");
  await expect(page.locator("#imbalance-ratio")).toHaveValue("7.5");
  trades = trades.filter((t) => t.time >= start + 60000);
  await expect(page.locator("#footprint-selection")).toContainText(
    "outside the current retained data",
    { timeout: 10000 },
  );
  await page.locator("#footprint-follow").check();
  await expect(page.locator("#footprint-selection")).toContainText(
    "following latest",
  );
  await expect(page.locator("#footprint-index")).toHaveValue("2");
});
