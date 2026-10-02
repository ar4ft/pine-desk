// Optional live check: start the documented local Edge Stats demo and Whale synthetic servers first.
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dir = await fs.mkdtemp(
  path.join(os.tmpdir(), "pine-desk-integrations-electron-"),
);
const app = await electron.launch({
  args: process.platform === "linux" ? [".", "--no-sandbox"] : ["."],
  env: { ...process.env, PINE_DESK_DATA_DIR: dir },
});
try {
  const page = await app.firstWindow();
  await page.waitForSelector("#pine-editor .cm-content");
  await expect(page.locator("#status")).toHaveText("Local workspace");
  await page.locator('[data-page="edge"]').click();
  await page.locator("#edge-mode").selectOption("local");
  await page.locator("#edge-connect").click();
  await expect(page.locator("#edge-symbol")).toBeVisible();
  await page.locator("#edge-symbol").selectOption("DEMO_STK");
  await page.locator("#edge-run-query").click();
  await expect(page.locator(".edge-metrics")).toContainText("102");
  await page.locator("[data-edge-session]").first().click();
  await expect(
    page.locator("#edge-session-chart canvas").first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/edge-stats.png",
    fullPage: true,
  });
  await page.locator('[data-page="whale"]').click();
  await page.locator("#whale-source").selectOption("synthetic");
  await page.locator("#whale-connect").click();
  await expect(page.locator("#whale-panel")).toContainText("RECORDER STATUS");
  await page.locator("#whale-recent").click();
  await expect(page.locator("[data-whale-event]").first()).toBeVisible();
  await page.locator("[data-whale-event]").first().click();
  await expect(page.locator("#whale-panel")).toContainText("nbbo_at_print");
  await page.locator('[data-whale-analysis="gex"]').click();
  await expect(page.locator("#whale-panel")).toContainText(
    "assumption about positioning",
  );
  await page.screenshot({
    path: "test-results/whale-options.png",
    fullPage: true,
  });
  console.log(
    "Upstream desktop integration passed: Edge DSL, session bars on Vela, Whale synthetic events, NBBO audits and GEX assumptions.",
  );
} finally {
  await app.close();
  await fs.rm(dir, { recursive: true, force: true });
}
