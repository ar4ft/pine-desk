import assert from "node:assert/strict";
export const planFixture = {
  name: "Desktop plan fixture",
  symbol: "TEST",
  venue: "Fixture",
  currency: "USD",
  side: "long",
  assetType: "spot",
  equity: 10000,
  riskPercent: 1,
  entry: 100,
  stop: 90,
  quantityStep: 1,
  multiplier: 1,
  feePercent: 0,
  slippage: 0,
  maxNotional: 10000,
  targets: [{ price: 120, percent: 100 }],
};
export async function desktopPlanSmoke({ page, client, call }) {
  const estimate = await call(client, "plan_estimate", { input: planFixture });
  assert.equal(estimate.quantity, 10);
  assert.equal(estimate.risk, 100);
  const saved = await call(client, "plan_save", { input: planFixture });
  assert.equal(saved.revision, 1);
  await call(client, "desktop_navigate", { page: "plans" });
  await page.locator(`[data-plan-open="${saved.id}"]`).click();
  await page.waitForFunction(() =>
    document.querySelector("#plan-editing")?.textContent.includes("revision 1"),
  );
  assert.equal(await page.locator("#plan-entry").inputValue(), "100");
  await page.locator("#plan-notes").fill("Desktop plan reviewed");
  await page.locator("#plan-save").click();
  await page.waitForFunction(() =>
    document.querySelector("#plan-editing")?.textContent.includes("revision 2"),
  );
  const updated = await call(client, "plan_get", { id: saved.id });
  assert.equal(updated.estimate.input.notes, "Desktop plan reviewed");
  assert.equal(updated.estimate.quantity, 10);
  const conflict = await client.callTool({
    name: "plan_save",
    arguments: { id: saved.id, expectedRevision: 1, input: planFixture },
  });
  assert.equal(conflict.isError, true);
  assert.equal((await call(client, "plan_get", { id: saved.id })).revision, 2);
}
