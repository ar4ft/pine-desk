import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const evidenceDir = path.resolve("test-results/desktop");
await fs.mkdir(evidenceDir, { recursive: true });
let stage = "launch";
const mark = (value) => {
  stage = value;
  console.log(`[desktop ${new Date().toISOString()}] ${value}`);
};
let app;
const watchdog = setTimeout(() => {
  console.error(`Desktop smoke exceeded 180 seconds at ${stage}`);
  app?.process()?.kill("SIGKILL");
  process.exit(1);
}, 180000);
async function closeDesktop() {
  if (!app) return;
  let timer;
  try {
    await Promise.race([
      app.close(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("Electron did not quit within 10 seconds")),
          10000,
        );
      }),
    ]);
  } catch (error) {
    app.process()?.kill("SIGKILL");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pine-desk-electron-"));
const args = process.env.PINE_DESK_PACKAGED_PATH ? [] : ["."];
if (process.platform === "linux") args.push("--no-sandbox");
try {
  app = await electron.launch({
    args,
    ...(process.env.PINE_DESK_PACKAGED_PATH
      ? { executablePath: process.env.PINE_DESK_PACKAGED_PATH }
      : {}),
    env: { ...process.env, PINE_DESK_DATA_DIR: dir },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => console.error("[renderer]", error.message));
  mark("chart and Pine worker");
  await page.waitForSelector("#pine-editor .cm-content");
  const workspace = await page.evaluate(() => window.desk.call("workspace"));
  assert.equal(workspace.dataset.bars.length, 500);
  await page.locator("#run-chart").click();
  await page.waitForFunction(() =>
    document.querySelector("#toast")?.textContent.includes("Script rendered"),
  );
  await page.locator("#run-backtest").click();
  await page.waitForSelector("#equity-plot", { timeout: 30000 });
  const saved = await page.evaluate(() => window.desk.call("workspace"));
  assert.equal(saved.runs.length, 1);
  assert.equal(saved.runs[0].result.metrics.totalTrades, 5);
  const job = await page.evaluate(
    (source) =>
      window.desk.call("researchStart", {
        kind: "sweep",
        source,
        grid: { "Fast length": [10, 12], "Slow length": [26] },
      }),
    saved.runs[0].source,
  );
  let study;
  const deadline = Date.now() + 30000;
  do {
    study = await page.evaluate(
      (id) => window.desk.call("researchGet", { id }),
      job.id,
    );
    if (study.status === "running")
      await new Promise((resolve) => setTimeout(resolve, 20));
  } while (study.status === "running" && Date.now() < deadline);
  assert.equal(study.status, "completed");
  assert.equal(study.result.candidates.length, 2);
  const candidate = await page.evaluate(
    (id) => window.desk.call("researchSaveRun", { id, index: 0 }),
    job.id,
  );
  const comparison = await page.evaluate(
    (ids) => window.desk.call("compareRuns", { ids }),
    [saved.runs[0].id, candidate.id],
  );
  assert.equal(comparison.sameData, true);
  const diagnostic = await page.evaluate(async () => {
    try {
      await window.desk.call("backtest", {
        source: '//@version=6\nstrategy("Broken")\nplot(',
      });
      return null;
    } catch (error) {
      return error.message;
    }
  });
  assert.match(diagnostic, /pineDeskError/);
  const providerSettings = await page.evaluate(() =>
    window.desk.call("providerSettings"),
  );
  mark("credentials, education and option research");
  if (providerSettings.credentials.available) {
    await page.evaluate(() =>
      window.desk.call("saveCredentials", {
        unusualWhales: "desktop-encryption-test",
      }),
    );
    const encrypted = await fs.readFile(
      path.join(dir, "credentials/current.json"),
      "utf8",
    );
    assert.ok(!encrypted.includes("desktop-encryption-test"));
    await page.evaluate(() =>
      window.desk.call("saveCredentials", { unusualWhales: null }),
    );
  } else {
    const rejected = await page.evaluate(async () => {
      try {
        await window.desk.call("saveCredentials", {
          unusualWhales: "desktop-encryption-test",
        });
        return false;
      } catch {
        return true;
      }
    });
    assert.equal(rejected, true);
  }
  const model = await page.evaluate(() =>
    window.desk.call("optionsGreeks", {
      model: {
        spot: 100,
        strike: 100,
        days: 365,
        volatility: 20,
        rate: 5,
        type: "call",
      },
    }),
  );
  assert.ok(Math.abs(model.values.price - 10.45058) < 0.0001);
  await page.locator('[data-page="education"]').click();
  await page.waitForSelector("#learn-curve svg");
  await page.locator('[data-learn-greek="gamma"]').click();
  await page.locator('[data-learn-preset="expiry"]').click();
  assert.equal(await page.locator("#learn-values button").count(), 13);
  await page.locator('[data-page="crypto"]').click();
  await page.waitForSelector("#crypto-refresh");
  assert.equal(
    (await page.evaluate(() => window.desk.call("deribitSnapshot"))).active,
    false,
  );
  const { optionFixture } = await import("../tests/fixtures/option-chain.js");
  const optionFirst = optionFixture({ at: Date.now() }),
    optionSecond = optionFixture({
      at: optionFirst.fetchedAt + 1000,
      expiry: optionFirst.rows[0].expiry,
      spot: 105,
    }),
    archiveFile = path.join(dir, "options.json");
  await fs.writeFile(
    archiveFile,
    JSON.stringify({
      schemaVersion: 1,
      snapshots: [optionFirst, optionSecond],
    }),
  );
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, archiveFile);
  await page.locator("#option-history-import").click();
  await page.waitForFunction(
    () => document.querySelectorAll("[data-history-select]").length === 2,
  );
  for (const checkbox of await page.locator("[data-history-select]").all())
    await checkbox.check();
  await page.locator("[data-history-use]").last().click();
  await page.waitForFunction(() =>
    document
      .querySelector("#crypto-status")
      ?.textContent.includes("Archived chain"),
  );
  await page.locator("#surface-fit").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#surface-results")
      ?.textContent.includes("Training RMSE"),
  );
  await page
    .locator("[data-option-candidate]")
    .filter({ hasText: "Call debit vertical" })
    .click();
  await page.locator("#portfolio-model").click();
  await page.waitForSelector("#portfolio-results svg");
  await page.locator("#option-replay").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#option-run-results")
      ?.textContent.includes("Net P&L"),
  );
  const optionRuns = await page.evaluate(() => window.desk.call("optionRuns"));
  assert.equal(optionRuns.length, 1);
  const optionRun = await page.evaluate(
    (id) => window.desk.call("optionRunGet", { id }),
    optionRuns[0].id,
  );
  assert.equal(optionRun.result.usedQuotes.length, 2);

  await page.locator('[data-page="settings"]').click();
  await page.waitForSelector("#credential-unusualWhales");
  await page.locator('[data-page="workspace"]').click();
  await page.waitForSelector("#import-script");
  const strategyFile = path.join(dir, "Imported desktop.pine");
  const importedSource =
    '//@version=6\nindicator("Desktop file import")\nplot(close)\n// Original license';
  await fs.writeFile(strategyFile, importedSource);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, strategyFile);
  await page.locator("#import-script").click();
  await page.waitForFunction(
    (source) => document.querySelector("#source")?.value === source,
    importedSource,
  );
  assert.equal(
    await page.locator("#script-name").inputValue(),
    "Imported desktop",
  );
  const imported = await page.evaluate(() => window.desk.call("workspace"));
  assert.ok(
    imported.scripts.some(
      (s) => s.provenance?.filename === "Imported desktop.pine",
    ),
  );
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await page.locator("#import-script").click();
  assert.equal(await page.locator("#source").inputValue(), importedSource);
  const invalidFile = path.join(dir, "Invalid.pine");
  await fs.writeFile(invalidFile, Buffer.from([0xff, 0xfe, 0x00]));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, invalidFile);
  await page.locator("#import-script").click();
  await page.waitForFunction(() =>
    document.querySelector("#toast")?.textContent.includes("UTF-8"),
  );
  assert.equal(await page.locator("#source").inputValue(), importedSource);
  await page.locator('[data-page="settings"]').click();
  await page.locator("#appearance-theme").selectOption("light");
  await page.locator("#appearance-save").click();
  await page.waitForFunction(() =>
    document.querySelector("#toast")?.textContent.includes("Appearance saved"),
  );
  await page.locator('[data-page="workspace"]').click();
  await page.locator("#toggle-editor").click();
  await page.waitForTimeout(400);
  mark("quit and reopen");
  await closeDesktop();
  app = await electron.launch({
    args,
    ...(process.env.PINE_DESK_PACKAGED_PATH
      ? { executablePath: process.env.PINE_DESK_PACKAGED_PATH }
      : {}),
    env: { ...process.env, PINE_DESK_DATA_DIR: dir },
    timeout: 30000,
  });
  const reopened = await app.firstWindow();
  await reopened.waitForSelector("#chart[data-ready=true]");
  assert.equal(await reopened.locator("#pine-editor").count(), 0);
  assert.equal(
    await reopened.locator("html").getAttribute("data-theme"),
    "light",
  );
  await reopened.locator("#toggle-editor").click();
  assert.equal(await reopened.locator("#source").inputValue(), importedSource);
  const bounds = JSON.parse(
    await fs.readFile(path.join(dir, "window-state/current.json"), "utf8"),
  );
  assert.ok(bounds.width >= 1100 && bounds.height >= 740);
  console.log(
    "Desktop smoke passed: CodeMirror, Pine worker, isolated IPC, backtests, research workers, comparisons, diagnostics, Greeks education, crypto archive import, SABR, multi-leg replay and persistence.",
  );
} catch (error) {
  console.error(`Desktop smoke failed at ${stage}:`, error);
  await fs.writeFile(
    path.join(evidenceDir, "failure.txt"),
    `${stage}\n${error.stack}`,
  );
  try {
    await app.windows()[0]?.screenshot({
      path: path.join(evidenceDir, "failure.png"),
      timeout: 5000,
    });
  } catch {}
  throw error;
} finally {
  mark("cleanup");
  try {
    await closeDesktop();
  } finally {
    clearTimeout(watchdog);
  }
  await fs.rm(dir, { recursive: true, force: true });
}
