import { test, expect } from "@playwright/test";
import { PaperMonitor } from "../../core/paper-monitor.js";
import { performanceFixture } from "../helpers/paper-performance.js";
import { paperDraftChart } from "../../core/paper-order-chart.js";
import { dispatch } from "../../core/service.js";
test("cash-risk chart sizing requires recalculation, preserves drafts, reviews real account limits and queues calculated allocations", async ({
  page,
}) => {
  const f = performanceFixture();
  await f.a.create({ initialCash: 150 });
  const monitor = new PaperMonitor({ account: f.a });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("backendCall", (action, args) => {
    if (action === "paperSnapshot") return f.a.snapshot();
    if (action === "paperMonitorStatus") return monitor.snapshot();
    if (action === "paperPreview") return f.a.preview(args);
    if (action === "paperSubmit") return f.a.submit(args);
    if (action === "paperDraftChart")
      return paperDraftChart(f.a, args, async () =>
        Array.from({ length: 100 }, (_, i) => ({
          time: Date.UTC(2026, 10, 1) + i * 3600000,
          open: 100,
          high: 101,
          low: 99,
          close: 100,
          volume: 10,
        })),
      );
    return dispatch(action, args);
  });
  await page.addInitScript(() => {
    window.desk = { call: (a, b) => window.backendCall(a, b) };
  });
  const field = (k) => page.locator(`#paper-compose-${k}`);
  try {
    await page.goto("/");
    await page.locator('[data-page="paper"]').click();
    await field("bracket").check();
    await field("riskSizing").check();
    await field("targetCount").selectOption("2");
    for (const [k, v] of [
      ["price", "100"],
      ["stop", "90"],
      ["target", "120"],
      ["target2", "130"],
      ["riskBudget", "20"],
      ["maxNotional", "150"],
      ["quantityStep", "0.1"],
      ["feePercent", "1"],
      ["slippage", "1"],
      ["targetPercent", "50"],
      ["targetPercent2", "40"],
    ])
      await field(k).fill(v);
    await expect(field("quantity")).toHaveAttribute("readonly", "");
    await expect(field("review")).toBeDisabled();
    await field("load").click();
    await expect(field("chart")).toHaveAttribute("data-ready", "true");
    await field("calculate").click();
    await expect(field("error")).toContainText("sum to 100");
    await field("targetPercent2").fill("50");
    await field("calculate").click();
    await expect(field("quantity")).toHaveValue("1.4");
    await expect(field("targetQuantity")).toHaveValue("0.7");
    await expect(field("targetQuantity2")).toHaveValue("0.7");
    await expect(field("targetQuantity2")).toHaveAttribute("readonly", "");
    expect((await f.a.snapshot()).orders).toHaveLength(0);
    await field("review").click();
    await expect(field("submit")).toBeEnabled();
    await expect(field("review-body")).toContainText("141.4 USDT");
    const chart = field("chart");
    await chart.scrollIntoViewIfNeeded();
    const locateStop = async () => {
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
        const { width: w, height: h } = canvas,
          pixels = ctx.getImageData(0, 0, w, h).data,
          box = node.getBoundingClientRect();
        for (let y = 0; y < h; y++) {
          let count = 0;
          for (let x = Math.floor(w * 0.15); x < w * 0.65; x++) {
            const k = (y * w + x) * 4;
            if (
              pixels[k] - pixels[k + 1] > 40 &&
              pixels[k + 2] - pixels[k + 1] > 5
            )
              count++;
          }
          if (count > w * 0.15)
            return {
              x: box.x + box.width * 0.4,
              y: box.y + (y / h) * box.height,
            };
        }
        return null;
      }, png);
    };
    await expect.poll(locateStop).not.toBeNull();
    const point = await locateStop();
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x, point.y + 12, { steps: 8 });
    await page.mouse.up();
    await expect(field("stop")).not.toHaveValue("90");
    await expect(field("review")).toBeDisabled();
    await expect(field("submit")).toBeDisabled();
    await expect(field("sizing-result")).toContainText("Calculate quantity");
    await field("stop").fill("90");
    await field("calculate").click();
    for (const theme of ["dark", "light"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 1100, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page
        .locator("#paper-composer")
        .screenshot({ path: `test-results/paper-sizing-${theme}.png` });
    }
    await page.locator('[data-page="workspace"]').click();
    await page.locator('[data-page="paper"]').click();
    await expect(field("riskSizing")).toBeChecked();
    await expect(field("quantity")).toHaveValue("1.4");
    await expect(field("review")).toBeEnabled();
    await field("maxNotional").fill("1000");
    await field("riskBudget").fill("200");
    await field("calculate").click();
    await expect(field("review")).toBeEnabled();
    await field("review").click();
    await expect(field("error")).toContainText("cash");
    expect((await f.a.snapshot()).orders).toHaveLength(0);
    await field("maxNotional").fill("150");
    await field("riskBudget").fill("20");
    await field("calculate").click();
    await field("review").click();
    const account = await f.a.snapshot();
    await f.a.setRisk({
      expectedRevision: account.revision,
      policy: { ...account.risk, maxMarkets: 2 },
    });
    await expect(field("notice")).toContainText("Account changed");
    await expect(field("submit")).toBeDisabled();
    await field("review").click();
    await field("submit").click();
    await expect(field("notice")).toContainText("is recorded");
    const saved = await f.a.snapshot();
    expect(saved.orders).toHaveLength(1);
    expect(saved.orders[0].quantity).toBe(1.4);
    expect(saved.orders[0].bracket.targets).toEqual([
      { price: 120, quantity: 0.7 },
      { price: 130, quantity: 0.7 },
    ]);
    await expect(field("calculate")).toBeDisabled();
    await field("new").click();
    await expect(field("riskSizing")).not.toBeChecked();
    await expect(field("quantity")).not.toHaveAttribute("readonly", "");
    await field("mode").selectOption("sell-stop");
    await expect(page.locator("#paper-compose-sizing-controls")).toBeHidden();
    expect((await monitor.snapshot()).active).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await monitor.close();
  }
});
