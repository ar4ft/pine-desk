import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { PaperAccount } from "../../core/paper-account.js";
import { PaperMonitor } from "../../core/paper-monitor.js";
import { paperOrderChart } from "../../core/paper-order-chart.js";
import { dispatch } from "../../core/service.js";

test("drag is draft-only, Apply persists, stale orders preserve drafts, and offline numeric edits work", async ({
  page,
}) => {
  let doc = null,
    offline = false;
  const a = new PaperAccount({
    storage: {
      read: async () => structuredClone(doc),
      write: async (d) => (doc = structuredClone(d)),
    },
    validateMarket: async () => {},
  });
  const monitor = new PaperMonitor({ account: a });
  await a.create({ initialCash: 10000 });
  const initial = await a.submit({
    expectedRevision: 1,
    requestId: randomUUID(),
    input: {
      symbol: "ETHUSDT",
      side: "buy",
      type: "limit",
      quantity: 1,
      price: 100,
      bracket: { stop: 90, targets: [{ price: 120, quantity: 1 }] },
    },
  });
  const id = initial.orders[0].id;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("backendCall", async (action, args) => {
    if (action === "paperMonitorStatus") return monitor.snapshot();
    if (action === "paperSnapshot") return a.snapshot();
    if (action === "paperAmend") return a.amend(args);
    if (action === "paperAmendPreview") return a.amendPreview(args);
    if (action === "paperOrderChart")
      return paperOrderChart(a, args, async ({ symbol }) => {
        expect(symbol).toBe("ETHUSDT");
        if (offline) throw Error("Network unavailable");
        return Array.from({ length: 100 }, (_, i) => ({
          time: Date.UTC(2026, 9, 1) + i * 3600000,
          open: 102 + Math.sin(i),
          high: 106,
          low: 98,
          close: 103 + Math.sin(i),
          volume: 100,
        }));
      });
    return dispatch(action, args);
  });
  await page.addInitScript(() => {
    window.desk = { call: (a, b) => window.backendCall(a, b) };
  });
  try {
    await page.goto("/");
    await page.locator('[data-page="paper"]').click();
    await page.locator(`[data-paper-edit="${id}"]`).click();
    const chart = page.locator("#paper-edit-chart");
    await expect(chart).toHaveAttribute("data-ready", "true");
    await expect(page.locator("#paper-order-editor")).toContainText("ETHUSDT");
    await expect(page.locator("#paper-edit-apply")).toBeDisabled();
    // Locate the amber horizontal line from rendered canvas pixels, then use real mouse input.
    const locate = async () => {
      const png = (await chart.screenshot()).toString("base64");
      return chart.evaluate(async (node, png) => {
        const img = new Image();
        img.src = `data:image/png;base64,${png}`;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const w = canvas.width,
          h = canvas.height,
          pixels = ctx.getImageData(0, 0, w, h).data,
          r = node.getBoundingClientRect();
        let best = null;
        for (let y = 0; y < h; y++) {
          let count = 0;
          for (let x = Math.floor(w * 0.15); x < Math.floor(w * 0.65); x++) {
            const p = (y * w + x) * 4;
            if (
              pixels[p] - pixels[p + 1] > 15 &&
              pixels[p + 1] - pixels[p + 2] > 20
            )
              count++;
          }
          if (count > w * 0.25 && (!best || count > best.count))
            best = {
              count,
              x: r.x + r.width * 0.4,
              y: r.y + (y / h) * r.height,
            };
        }
        return best;
      }, png);
    };
    await chart.scrollIntoViewIfNeeded();
    await expect.poll(locate).not.toBeNull();
    const point = await locate();
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x, point.y - 25, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator("#paper-edit-price")).not.toHaveValue("100");
    expect((await a.snapshot()).revision).toBe(initial.revision);
    const draft = Number(await page.locator("#paper-edit-price").inputValue());
    expect(draft).toBeGreaterThan(100);
    expect(draft).toBeLessThan(120);
    await page.locator("#paper-edit-review").click();
    await page.locator("#paper-edit-apply").click();
    await expect(page.locator("#paper-message")).toContainText(
      "Paper order updated",
    );
    expect((await a.snapshot()).orders[0].price).toBe(draft);
    await page.locator("#paper-edit-price").fill("110");
    await a.amend({
      id,
      expectedRevision: (await a.snapshot()).revision,
      price: 108,
    });
    await expect(page.locator("#paper-edit-notice")).toContainText(
      "Account changed",
    );
    await expect(page.locator("#paper-edit-price")).toHaveValue("110");
    await expect(page.locator("#paper-edit-apply")).toBeDisabled();
    await page.locator("#paper-edit-reload").click();
    await expect(page.locator("#paper-edit-price")).toHaveValue("108");
    await page.locator("#paper-edit-price").fill("120");
    await page.locator("#paper-edit-review").click();
    await expect(page.locator("#paper-edit-error")).toContainText(
      "above the entry limit",
    );
    expect((await a.snapshot()).orders[0].price).toBe(108);
    await page.locator("#paper-edit-price").fill("108");
    for (const theme of ["dark", "light"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 1100, height: 900 });
      await expect(chart).toHaveAttribute("data-ready", "true");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page
        .locator("#paper-order-editor")
        .screenshot({ path: `test-results/paper-order-editor-${theme}.png` });
    }
    await page.locator('[data-page="workspace"]').click();
    await page.locator('[data-page="paper"]').click();
    await expect(chart).toHaveAttribute("data-ready", "true");
    await expect(page.locator("#paper-edit-price")).toHaveValue("108");
    offline = true;
    await page.locator("#paper-edit-candles").click();
    await expect(page.locator("#paper-edit-chart-status")).toContainText(
      "Numeric editing remains available",
    );
    await page.locator("#paper-edit-price").fill("109");
    await page.locator("#paper-edit-review").click();
    await page.locator("#paper-edit-apply").click();
    await expect
      .poll(async () => (await a.snapshot()).orders[0].price)
      .toBe(109);
    await page.locator("#paper-edit-price").fill("111");
    await a.cancel({ id, expectedRevision: (await a.snapshot()).revision });
    await expect(page.locator("#paper-edit-notice")).toContainText(
      "no longer pending",
    );
    await expect(page.locator("#paper-edit-price")).toHaveValue("111");
    await expect(page.locator("#paper-edit-apply")).toBeDisabled();
    expect(errors).toEqual([]);
  } finally {
    await monitor.close();
  }
});
