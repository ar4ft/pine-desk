import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { PaperAccount } from "../../core/paper-account.js";
import { PaperMonitor } from "../../core/paper-monitor.js";
import { paperOrderChart } from "../../core/paper-order-chart.js";
import { dispatch } from "../../core/service.js";
test("resize reviews explicit bracket allocations, preserves stale drafts, and edits linked exits together", async ({
  page,
}) => {
  let doc = null;
  const a = new PaperAccount({
    storage: {
      read: async () => structuredClone(doc),
      write: async (d) => (doc = structuredClone(d)),
    },
    validateMarket: async () => {},
    quote: async (symbol) => {
      const now = Date.now();
      return {
        symbol,
        bid: 99,
        ask: 100,
        requestedAt: now,
        receivedAt: now,
        source: "Binance public bookTicker REST",
      };
    },
  });
  const monitor = new PaperMonitor({ account: a });
  await a.create({ initialCash: 1000 });
  let s = await a.submit({
    expectedRevision: 1,
    requestId: randomUUID(),
    input: {
      symbol: "BTCUSDT",
      side: "buy",
      type: "limit",
      quantity: 1,
      price: 100,
      feePercent: 0,
      bracket: {
        stop: 90,
        targets: [
          { price: 120, quantity: 0.4 },
          { price: 140, quantity: 0.6 },
        ],
      },
    },
  });
  const id = s.orders[0].id;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("backendCall", async (action, args) => {
    if (action === "paperMonitorStatus") return monitor.snapshot();
    if (action === "paperSnapshot") return a.snapshot();
    if (action === "paperAmend") return a.amend(args);
    if (action === "paperAmendPreview") return a.amendPreview(args);
    if (action === "paperOrderChart")
      return paperOrderChart(a, args, async () =>
        Array.from({ length: 100 }, (_, i) => ({
          time: Date.UTC(2026, 10, 1) + i * 3600000,
          open: 100,
          high: 105,
          low: 95,
          close: 101,
          volume: 10,
        })),
      );
    return dispatch(action, args);
  });
  await page.addInitScript(
    () => (window.desk = { call: (a, b) => window.backendCall(a, b) }),
  );
  try {
    await page.goto("/");
    await page.locator('[data-page="paper"]').click();
    await page.locator(`[data-paper-edit="${id}"]`).click();
    await page.locator("#paper-edit-quantity").fill("2");
    await expect(page.locator("#paper-edit-apply")).toBeDisabled();
    await page.locator("#paper-edit-review").click();
    await expect(page.locator("#paper-edit-error")).toContainText(
      "sum to entry quantity",
    );
    await page.locator("#paper-edit-target-0").fill("0.8");
    await page.locator("#paper-edit-target-1").fill("1.2");
    await page.locator("#paper-edit-review").click();
    await expect(page.locator("#paper-edit-review-body")).toContainText(
      "100 → 200",
    );
    expect((await a.snapshot()).orders[0].quantity).toBe(1);
    await page.locator("#paper-edit-apply").click();
    await expect(page.locator("#paper-message")).toContainText(
      "Paper order updated",
    );
    s = await a.snapshot();
    expect(s.orders[0].quantity).toBe(2);
    expect(s.reservedCash).toBe(200);
    await page.locator("#paper-edit-quantity").fill("3");
    await a.setRisk({
      expectedRevision: s.revision,
      policy: { ...s.risk, maxMarkets: 2 },
    });
    await expect(page.locator("#paper-edit-notice")).toContainText(
      "Account changed",
    );
    await expect(page.locator("#paper-edit-quantity")).toHaveValue("3");
    await expect(page.locator("#paper-edit-review")).toBeDisabled();
    await page.locator("#paper-edit-reload").click();
    await expect(page.locator("#paper-edit-quantity")).toHaveValue("2");
    s = await a.snapshot();
    s = (await a.process({ expectedRevision: s.revision, id })).account;
    await expect(page.locator("#paper-edit-notice")).toContainText(
      "no longer pending",
    );
    await expect(page.locator("#paper-edit-quantity")).toBeDisabled();
    const stop = s.orders.find((o) => o.leg === "stop"),
      target = s.orders.find((o) => o.leg === "target");
    await page.locator(`[data-paper-edit="${stop.id}"]`).click();
    await page.locator("#paper-edit-quantity").fill("0.4");
    await page.locator("#paper-edit-review").click();
    await expect(page.locator("#paper-edit-review-body")).toContainText(
      "stop 0.4",
    );
    await expect(page.locator("#paper-edit-review-body")).toContainText(
      "target 0.4",
    );
    for (const theme of ["dark", "light"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 1100, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page
        .locator("#paper-order-editor")
        .screenshot({ path: `test-results/paper-resize-${theme}.png` });
    }
    await page.locator('[data-page="workspace"]').click();
    await page.locator('[data-page="paper"]').click();
    await expect(page.locator("#paper-edit-quantity")).toHaveValue("0.4");
    await expect(page.locator("#paper-edit-apply")).toBeEnabled();
    await page.locator("#paper-edit-apply").click();
    await expect
      .poll(
        async () =>
          (await a.snapshot()).orders.find((o) => o.id === target.id).quantity,
      )
      .toBe(0.4);
    expect((await a.snapshot()).reservedQuantity.BTCUSDT).toBe(1.6);
    await page.locator("#paper-edit-quantity").fill("0.9");
    await page.locator("#paper-edit-review").click();
    await expect(page.locator("#paper-edit-error")).toContainText(
      "original target allocation",
    );
    await expect(page.locator("#paper-edit-apply")).toBeDisabled();
    expect((await monitor.snapshot()).active).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await monitor.close();
  }
});
