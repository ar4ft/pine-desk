import { test, expect } from "@playwright/test";
import { PaperAccount } from "../../core/paper-account.js";
import { dispatch } from "../../core/service.js";
import { randomUUID } from "node:crypto";
test("paper account queues, fills, exits, handles conflicts and exports a persistent ledger", async ({
  page,
}) => {
  let doc = null,
    exported,
    bid = 99,
    ask = 100,
    offline = false;
  const a = new PaperAccount({
    storage: {
      read: async () => structuredClone(doc),
      write: async (d) => {
        doc = structuredClone(d);
      },
    },
    validateMarket: async () => {},
    quote: async (symbol) => {
      if (offline) throw Error("Quote unavailable; order remains pending.");
      const now = Date.now();
      return {
        symbol,
        bid,
        ask,
        requestedAt: now,
        receivedAt: now,
        source: "Binance public bookTicker REST",
      };
    },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("backendCall", (action, args) => {
    if (action === "paperSnapshot") return a.snapshot();
    if (action === "paperCreate") return a.create(args);
    if (action === "paperSubmit") return a.submit(args);
    if (action === "paperProcess") return a.process(args);
    if (action === "paperCancel") return a.cancel(args);
    return dispatch(action, args);
  });
  await page.exposeFunction("exportResult", (name, text) => {
    exported = { name, text };
  });
  await page.addInitScript(() => {
    window.desk = {
      call: (a, b) => window.backendCall(a, b),
      exportFile: (n, t) => window.exportResult(n, t),
    };
  });
  await page.goto("/");
  await expect(page.locator("#chart")).toHaveAttribute("data-ready", "true");
  await page.locator('[data-page="paper"]').click();
  await page.locator("#paper-initialCash").fill("1000");
  await page.locator("#paper-create").click();
  await expect(page.locator("#paper-submit")).toBeVisible();
  await page.locator("#paper-quantity").fill("2");
  await page.locator("#paper-maxNotional").fill("220");
  await page.locator("#paper-feePercent").fill("1");
  await page.locator("#paper-slippage").fill("1");
  await page.locator("#paper-submit").click();
  await expect(page.locator("#paper-orders")).toContainText("pending");
  offline = true;
  await page.locator("[data-paper-process]").click();
  await expect(page.locator("#paper-error")).toContainText(
    "order remains pending",
  );
  offline = false;
  await page.locator("[data-paper-process]").click();
  await expect(page.locator("#paper-fills tbody tr")).toHaveCount(1);
  await expect(page.locator("#paper-fills")).toContainText("101");
  bid = 120;
  ask = 121;
  await page.locator("#paper-side").selectOption("sell");
  await page.locator("#paper-quantity").fill("0.5");
  await page.locator("#paper-submit").click();
  await page.locator("[data-paper-process]").click();
  await expect(page.locator("#paper-positions")).toContainText("1.5");
  await expect(page.locator("#paper-positions")).toContainText("7.9");
  const current = await a.snapshot();
  const external = await a.submit({
    expectedRevision: current.revision,
    requestId: randomUUID(),
    input: {
      symbol: "BTCUSDT",
      side: "sell",
      type: "limit",
      price: 130,
      quantity: 0.5,
    },
  });
  await page.locator("#paper-submit").click();
  await expect(page.locator("#paper-error")).toContainText("changed elsewhere");
  await expect(page.locator("#paper-quantity")).toHaveValue("0.5");
  await page.locator("#paper-refresh").click();
  await expect(page.locator("[data-paper-process]")).toHaveCount(1);
  await page.locator("[data-paper-process]").click();
  await expect(page.locator("#paper-message")).toContainText(
    "not been reached",
  );
  await page.locator("[data-paper-cancel]").click();
  await expect(
    page.locator(`[data-paper-order="${external.orders.at(-1).id}"]`),
  ).toContainText("cancelled");
  await page.locator("#paper-export").click();
  await expect.poll(() => exported?.name).toBe("paper-account.json");
  expect(JSON.parse(exported.text).account.fills).toHaveLength(2);
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1300, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.waitForTimeout(200); // Allow the theme color transition to settle.
    await page.screenshot({
      path: `test-results/paper-${theme}.png`,
      fullPage: true,
      style: "#toast {visibility:hidden}",
    });
  }
  await page.reload();
  await page.locator('[data-page="paper"]').click();
  await expect(page.locator("#paper-fills tbody tr")).toHaveCount(2);
  await expect(page.locator("#paper-positions")).toContainText("1.5");
  expect(errors).toEqual([]);
});
