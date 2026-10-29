import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DepthHistory, DepthRecorder } from "../../core/depth-history.js";
let dir, dispatch;
test.beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pd-depth-history-ui-"));
  process.env.PINE_DESK_DATA_DIR = dir;
  ({ dispatch } = await import("../../core/service.js"));
});
test.afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
test("recorded liquidity heatmap, gaps, playback, export and deletion stay separate from live data", async ({
  page,
}) => {
  const files = new Map(),
    storage = {
      read: async (k, id) => structuredClone(files.get(`${k}/${id}`) ?? null),
      write: async (k, v, id) => files.set(`${k}/${id}`, structuredClone(v)),
      list: async (k) =>
        [...files]
          .filter(([key]) => key.startsWith(k + "/"))
          .map(([, v]) => structuredClone(v)),
      remove: async (k, id) => files.delete(`${k}/${id}`),
    };
  storage.readCompressed = storage.read;
  storage.writeCompressed = storage.write;
  storage.removeCompressed = storage.remove;
  let now = Date.now(),
    stale = false,
    connection = 1;
  const depth = {
    active: true,
    symbol: "BTCUSDT",
    status: "streaming",
    snapshot({ limit }) {
      return {
        provider: "binance",
        symbol: this.symbol,
        stale,
        connection,
        lastUpdateId: now,
        eventAt: now,
        receivedAt: now,
        status: stale ? "reconnecting" : "streaming",
        mid: 65000,
        spread: 1,
        bids: Array.from({ length: limit }, (_, i) => ({
          price: 64999.5 - i,
          size: 1 + ((i + now / 1000) % 9),
        })),
        asks: Array.from({ length: limit }, (_, i) => ({
          price: 65000.5 + i,
          size: 1 + ((i + now / 1000) % 13),
        })),
      };
    },
  };
  let history = new DepthHistory({ storage, now: () => now });
  const recorder = new DepthRecorder({
    history,
    depth,
    now: () => now,
    clock: { setTimeout: () => 1, clearTimeout: () => {} },
  });
  const errors = [],
    exports = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("backendCall", (action, args = {}) => {
    if (action === "depthRecordStart") return recorder.start(args);
    if (action === "depthRecordStop") return recorder.stop();
    if (action === "depthRecordStatus") return recorder.status();
    if (action === "depthRecordings") return history.list();
    if (action === "depthRecordingGet") return history.get(args);
    if (action === "depthRecordingDelete") return history.remove(args.id);
    return dispatch(action, args);
  });
  await page.exposeFunction("captureExport", (name, text) =>
    exports.push({ name, text }),
  );
  await page.addInitScript(() => {
    window.desk = {
      call: (a, b) => window.backendCall(a, b),
      exportFile: (n, t) => window.captureExport(n, t),
    };
  });
  try {
    await page.goto("/");
    await expect(page.locator("#chart")).toHaveAttribute("data-ready", "true");
    await page.locator('[data-page="orderflow"]').click();
    await page.locator('[data-flow-tab="history"]').click();
    await page.locator("#depth-record-name").fill("BTC liquidity study");
    await expect(page.locator("#depth-record-start")).toBeEnabled();
    await page.locator("#depth-record-start").click();
    await expect(page.locator("#depth-record-status")).toContainText("1 saved");
    await expect(page.locator("#depth-record-start")).toBeDisabled();
    await expect(page.locator("#depth-record-name")).toBeDisabled();
    const id = recorder.status().meta.id;
    for (let i = 0; i < 15; i++) {
      now += i === 8 ? 5000 : 1000;
      stale = i === 4 || i === 5;
      if (i === 10) connection++;
      await recorder.serial(() => recorder.capture());
    }
    await page.locator("#depth-record-stop").click();
    await expect(page.locator("#depth-record-status")).toContainText(
      "16 saved + 0 pending",
    );
    await expect(page.locator("#depth-history-meta")).toContainText(
      "BTC liquidity study",
    );
    await expect(page.locator("#depth-history-meta")).toContainText("stopped");
    expect(depth.active).toBe(true);
    await page.locator("#depth-replay-scrub").fill("5");
    await expect(page.locator("#depth-replay-detail")).toContainText(
      "Missing depth",
    );
    await page.locator("#depth-replay-scrub").fill("11");
    await expect(page.locator("#depth-replay-detail")).toContainText(
      "resynchronized",
    );
    await page.locator("#depth-replay-scrub").fill("0");
    await page.locator("#depth-replay-speed").selectOption("20");
    await page.locator("#depth-replay-play").click();
    await expect(page.locator("#depth-replay-scrub")).not.toHaveValue("0");
    await page.locator("#depth-replay-scrub").fill("3");
    const colors = await page.locator("#depth-heatmap").evaluate((el) => {
      const d = el
        .getContext("2d")
        .getImageData(0, 0, el.width, el.height).data;
      let green = 0,
        red = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 1] > d[i] + 30) green++;
        if (d[i] > d[i + 1] + 30) red++;
      }
      return { green, red };
    });
    expect(colors.green).toBeGreaterThan(100);
    expect(colors.red).toBeGreaterThan(100);
    await page.locator("#depth-history-export").click();
    expect(exports).toHaveLength(1);
    const saved = JSON.parse(exports[0].text);
    expect(saved.frames).toHaveLength(16);
    expect(saved.frames[5].book).toBeNull();
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 1100, height: 800 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/depth-history-${theme}.png`,
        fullPage: true,
        style: "#toast {visibility:hidden}",
      });
    }
    history = new DepthHistory({ storage, now: () => now });
    await page.reload();
    await page.locator('[data-flow-tab="history"]').click();
    await page.locator("#depth-history-select").selectOption(id);
    await expect(page.locator("#depth-history-meta")).toContainText("16");
    expect(depth.active).toBe(true);
    page.on("dialog", (dialog) => dialog.accept());
    await page.locator("#depth-history-delete").click();
    await expect(page.locator("#depth-history-meta")).toHaveText(
      "No archive selected.",
    );
    expect((await history.list()).length).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await recorder.stop();
  }
});
