import { test, expect } from "@playwright/test";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BinanceDepth } from "../../core/depth.js";
let dir, dispatch;
test.beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pd-depth-ui-"));
  process.env.PINE_DESK_DATA_DIR = dir;
  ({ dispatch } = await import("../../core/service.js"));
});
test.afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
test("depth ladder updates, preserves inputs and scroll, hides stale prices, and leaves executed flow available", async ({
  page,
}) => {
  let offset = 0,
    socket,
    starts = 0;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const depth = new BinanceDepth({
    now: () => Date.now() + offset,
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        lastUpdateId: 100,
        bids: Array.from({ length: 100 }, (_, i) => [
          String(65000 - i),
          String(i + 1),
        ]),
        asks: Array.from({ length: 100 }, (_, i) => [
          String(65001 + i),
          String(i + 2),
        ]),
      }),
    }),
    createSocket: () => {
      starts++;
      socket = new EventEmitter();
      socket.terminate = () => socket.emit("close");
      queueMicrotask(() => socket.emit("open"));
      return socket;
    },
  });
  try {
    await page.exposeFunction("backendCall", (action, args = {}) => {
      if (action === "depthStart") return depth.start(args);
      if (action === "depthStop") return depth.stop();
      if (action === "depthSnapshot") return depth.snapshot(args);
      return dispatch(action, args);
    });
    await page.addInitScript(() => {
      window.desk = { call: (a, b) => window.backendCall(a, b) };
    });
    await page.goto("/");
    await expect(page.locator("#chart")).toHaveAttribute("data-ready", "true");
    await page.locator('[data-page="orderflow"]').click();
    await page.locator('[data-flow-tab="depth"]').click();
    await expect(page.locator("#depth-stop")).toBeDisabled();
    await page.locator("#depth-start").click();
    await expect(page.locator("#depth-status")).toContainText("syncing");
    const send = (id = 101) =>
      socket.emit(
        "message",
        JSON.stringify({
          e: "depthUpdate",
          s: depth.symbol,
          E: Date.now() + offset,
          U: id,
          u: id,
          b: [["65000", "5"]],
          a: [],
        }),
      );
    send();
    await expect(page.locator(".depth-identity")).toContainText("BTCUSDT");
    await expect(page.locator(".depth-ladder.bids tbody tr")).toHaveCount(20);
    await page.locator("#depth-symbol").fill("Unsubmitted");
    await page.locator("#depth-limit").selectOption("50");
    await expect(page.locator(".depth-ladder.bids tbody tr")).toHaveCount(50);
    await page.locator(".depth-ladder.bids .table-wrap").evaluate((el) => {
      el.scrollTop = 150;
    });
    send(102);
    await expect(page.locator(".depth-identity")).toContainText("Sequence 102");
    expect(
      await page
        .locator(".depth-ladder.bids .table-wrap")
        .evaluate((el) => el.scrollTop),
    ).toBe(150);
    await expect(page.locator("#depth-symbol")).toHaveValue("Unsubmitted");
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 1100, height: 800 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/depth-${theme}.png`,
        fullPage: true,
        style: "#toast { visibility:hidden; }",
      });
    }
    await page.locator('[data-page="education"]').click();
    expect(depth.active).toBe(true);
    await page.locator('[data-page="orderflow"]').click();
    await expect(page.locator(".depth-identity")).toContainText("BTCUSDT");
    expect(starts).toBe(1);
    offset += 6000;
    await expect(page.locator(".depth-ladder")).toHaveCount(0);
    await expect(page.locator("#depth-status")).toContainText(
      "no fresh synchronized book",
    );
    offset = 0;
    await page.locator("#depth-symbol").fill("ethusdt");
    await page.locator("#depth-start").click();
    await expect(page.locator("#depth-status")).toContainText("ETHUSDT");
    send();
    await expect(page.locator(".depth-identity")).toContainText("ETHUSDT");
    expect(starts).toBe(2);
    await page.locator("#depth-stop").click();
    await expect(page.locator("#depth-status")).toContainText("stopped");
    await expect(page.locator(".depth-ladder")).toHaveCount(0);
    await page.locator('[data-flow-tab="trades"]').click();
    await expect(page.locator("#refresh-flow")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    depth.stop();
  }
});
