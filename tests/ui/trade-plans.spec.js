import { test, expect } from "@playwright/test";
import { TradePlans, estimatePlan } from "../../core/trade-plans.js";
import { dispatch } from "../../core/service.js";
test("trade plans calculate, save/reopen, reject stale edits, preserve exports and capture chart reference", async ({
  page,
}) => {
  let doc = null,
    exported;
  const plans = new TradePlans({
    storage: {
      read: async () => structuredClone(doc),
      write: async (next) => {
        doc = structuredClone(next);
      },
    },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.exposeFunction("backendCall", (action, args) => {
    if (action === "planEstimate") return estimatePlan(args.input);
    if (action === "planList") return plans.list();
    if (action === "planGet") return plans.get(args.id);
    if (action === "planSave") return plans.save(args);
    if (action === "planDelete") return plans.remove(args);
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
  await page.locator('[data-page="plans"]').click();
  await page.locator("#plan-entry").fill("100");
  await page.locator("#plan-stop").fill("90");
  await page.locator("#plan-target-0").fill("120");
  await page.locator("#plan-quantityStep").fill("1");
  await page.locator("#plan-feePercent").fill("0");
  await page.locator("#plan-calculate").click();
  await expect(page.locator("#plan-result .metrics")).toContainText("100");
  await expect(page.locator("#plan-target-results tbody tr")).toHaveCount(1);
  await page.locator("#plan-save").click();
  await expect(page.locator("#plan-editing")).toContainText("revision 1");
  await expect(page.locator("#plan-list tbody tr")).toHaveCount(1);
  const record = (await plans.list())[0];
  await plans.save({
    id: record.id,
    expectedRevision: 1,
    input: { ...record.estimate.input, name: "MCP edit" },
  });
  await page.locator("#plan-notes").fill("My draft survives conflicts");
  await page.locator("#plan-save").click();
  await expect(page.locator("#plan-error")).toContainText("changed elsewhere");
  await expect(page.locator("#plan-notes")).toHaveValue(
    "My draft survives conflicts",
  );
  await page.locator("#plan-refresh").click();
  await page.locator("[data-plan-open]").click();
  await expect(page.locator("#plan-editing")).toContainText("revision 2");
  await expect(page.locator("#plan-name")).toHaveValue("MCP edit");
  await page.locator("#plan-stop").fill("101");
  await page.locator("#plan-calculate").click();
  await expect(page.locator("#plan-error")).toContainText(
    "previous successful estimate",
  );
  await page.locator("#plan-export").click();
  await expect.poll(() => exported?.name).toBe("trade-plan.json");
  expect(JSON.parse(exported.text).calculation.input.stop).toBe(90);
  await page.locator("#plan-stop").fill("90");
  await page.locator("#plan-status").selectOption("archived");
  await page.locator("#plan-save").click();
  await expect(page.locator("#plan-list")).toContainText("archived");
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1300, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/plans-${theme}.png`,
      fullPage: true,
      style: "#toast {visibility:hidden}",
    });
  }
  await page.reload();
  await page.locator('[data-page="plans"]').click();
  await page.locator("[data-plan-open]").click();
  await expect(page.locator("#plan-name")).toHaveValue("MCP edit");
  await page.locator("#plan-delete").click();
  await expect(page.locator("#plans-saved")).toContainText("No saved plans");
  await page.locator('[data-page="workspace"]').click();
  await expect(page.locator("#chart")).toHaveAttribute("data-ready", "true");
  await page.locator("#create-trade-plan").click();
  await expect(page.locator("#plan-reference")).toContainText("settled bar");
  await expect(page.locator("#plan-currency")).toHaveValue("");
  const entry = Number(await page.locator("#plan-entry").inputValue());
  await page.locator("#plan-currency").fill("USD");
  await page.locator("#plan-stop").fill(String(entry * 0.9));
  await page.locator("#plan-target-0").fill(String(entry * 1.1));
  await page.locator("#plan-save").click();
  await expect(page.locator("#plan-editing")).toContainText("revision 1");
  const chartPlan = (await plans.list())[0];
  expect(chartPlan.estimate.input.reference.price).toBe(entry);
  expect(chartPlan.estimate.input.reference.time).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
