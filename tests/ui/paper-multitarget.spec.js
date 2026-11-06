import { test, expect } from "@playwright/test";
import { PaperAccount } from "../../core/paper-account.js";
import { PaperMonitor } from "../../core/paper-monitor.js";
import { paperDraftChart } from "../../core/paper-order-chart.js";
import { performanceFixture } from "../helpers/paper-performance.js";
import { dispatch } from "../../core/service.js";

test("chart brackets review explicit allocations, drag the third target, recover submissions and fill independent target pairs", async ({
  page,
}) => {
  const f = performanceFixture();
  await f.a.create({ initialCash: 1000 });
  const monitor = new PaperMonitor({ account: f.a });
  let loseReply = false;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("backendCall", async (action, args) => {
    if (action === "paperMonitorStatus") return monitor.snapshot();
    if (action === "paperSnapshot") return f.a.snapshot();
    if (action === "paperPreview") return f.a.preview(args);
    if (action === "paperSubmit") {
      const account = await f.a.submit(args);
      if (loseReply) {
        loseReply = false;
        throw Error("Reply lost after commit");
      }
      return account;
    }
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
    await field("quantity").fill("1");
    await field("feePercent").fill("0");
    await field("bracket").check();
    await expect(field("targetQuantity")).toHaveValue("1");
    await expect(field("targetQuantity")).toHaveAttribute("readonly", "");
    await field("targetCount").selectOption("3");
    await field("load").click();
    const chart = field("chart");
    await expect(chart).toHaveAttribute("data-ready", "true");
    for (const [k, price] of [
      ["target", "102"],
      ["target2", "104"],
      ["target3", "106"],
    ])
      await expect(field(k)).toHaveValue(price);
    await field("review").click();
    await expect(field("error")).toContainText("quantity");
    await expect(field("submit")).toBeDisabled();
    for (const [k, q] of [
      ["targetQuantity", "0.2"],
      ["targetQuantity2", "0.3"],
      ["targetQuantity3", "0.5"],
    ])
      await field(k).fill(q);
    await field("target2").fill("101");
    await field("review").click();
    await expect(field("error")).toContainText("progress above");
    await field("target2").fill("104");
    // Locate the highest green horizontal line in the actual Vela screenshot.
    await chart.scrollIntoViewIfNeeded();
    const locate = async () => {
      const png = (await chart.screenshot()).toString("base64");
      return chart.evaluate(async (node, png) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        const { width: w, height: h } = canvas,
          pixels = ctx.getImageData(0, 0, w, h).data,
          box = node.getBoundingClientRect();
        for (let y = 0; y < h; y++) {
          let count = 0;
          for (let x = Math.floor(w * 0.15); x < w * 0.65; x++) {
            const i = (y * w + x) * 4;
            if (
              pixels[i + 1] - pixels[i] > 30 &&
              pixels[i + 1] - pixels[i + 2] > 10
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
    await expect.poll(locate).not.toBeNull();
    const point = await locate();
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x, point.y + 12, { steps: 8 });
    await page.mouse.up();
    await expect(field("target3")).not.toHaveValue("106");
    expect(Number(await field("target3").inputValue())).toBeGreaterThan(104);
    const thirdPrice = Number(await field("target3").inputValue());
    await field("review").click();
    await expect(field("submit")).toBeEnabled();
    await expect(field("review-body")).toContainText("target 3: 0.5 @");
    expect((await f.a.snapshot()).orders).toHaveLength(0);
    await field("targetCount").selectOption("2");
    await expect(field("submit")).toBeDisabled();
    await expect(field("target3")).toBeHidden();
    await field("targetQuantity2").fill("0.8");
    await field("review").click();
    await expect(field("submit")).toBeEnabled();
    await expect(field("review-body")).not.toContainText("target 3:");
    await field("targetCount").selectOption("3");
    await expect(field("target3")).toHaveValue(String(thirdPrice));
    await field("targetQuantity2").fill("0.3");
    await field("review").click();
    await expect(field("submit")).toBeEnabled();
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
        .screenshot({ path: `test-results/paper-multitarget-${theme}.png` });
    }
    await page.locator('[data-page="workspace"]').click();
    await page.locator('[data-page="paper"]').click();
    await expect(field("targetCount")).toHaveValue("3");
    await expect(field("submit")).toBeEnabled();
    loseReply = true;
    await field("submit").click();
    await expect(field("error")).toContainText("Reply lost");
    for (const k of ["targetCount", "target2", "targetQuantity3"])
      await expect(field(k)).toBeDisabled();
    await field("check").click();
    await expect(field("notice")).toContainText("is recorded");
    let account = await f.a.snapshot();
    expect(account.orders).toHaveLength(1);
    expect(account.orders[0].bracket.targets).toEqual([
      { price: 102, quantity: 0.2 },
      { price: 104, quantity: 0.3 },
      { price: thirdPrice, quantity: 0.5 },
    ]);
    account = (
      await f.a.process({
        expectedRevision: account.revision,
        id: account.orders[0].id,
      })
    ).account;
    expect(account.orders).toHaveLength(7);
    expect(account.reservedQuantity.BTCUSDT).toBe(1);
    f.advance();
    await f.a.evaluateSymbol("BTCUSDT", {
      ...(await f.opts.quote("BTCUSDT")),
      requestedAt: f.opts.now(),
      receivedAt: f.opts.now(),
      bid: 104,
      ask: 104,
    });
    account = await f.a.snapshot();
    expect(account.fills).toHaveLength(3);
    expect(account.positions.BTCUSDT.quantity).toBe(0.5);
    expect(account.orders.filter((o) => o.status === "cancelled")).toHaveLength(
      2,
    );
    expect(
      account.orders
        .filter((o) => o.status === "pending")
        .map((o) => o.quantity),
    ).toEqual([0.5, 0.5]);
    expect(await new PaperAccount(f.opts).snapshot()).toEqual(account);
    await field("new").click();
    await field("bracket").check();
    await field("targetCount").selectOption("3");
    await field("load").click();
    await expect(field("target3")).toHaveValue("106");
    await field("symbol").fill("ETHUSDT");
    for (const k of ["price", "stop", "target", "target2", "target3"])
      await expect(field(k)).toHaveValue("");
    expect((await monitor.snapshot()).active).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await monitor.close();
  }
});
