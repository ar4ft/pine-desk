import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pine-layouts-"));
process.env.PINE_DESK_DATA_DIR = dir;
const { dispatch } = await import("../core/service.js");
const { validateAppearance, validateWatchlist, validateLayout } = await import(
  "../core/workspace-ui.js"
);
const source = '//@version=6\nindicator("Imported")\nplot(close)';
test("appearance and provider-qualified watchlists persist, reject invalid entries and duplicate markets", async () => {
  const ui = await dispatch("uiConfigure", {
    appearance: {
      theme: "light",
      upColor: "#127853",
      downColor: "#b0324f",
      editorFontSize: 16,
    },
    watchlist: [
      { symbol: "btcusdt", provider: "binance", timeframe: "1h" },
      { symbol: "SPY", provider: "unusualWhales", timeframe: "5m" },
    ],
  });
  assert.equal(ui.watchlist[0].symbol, "BTCUSDT");
  assert.deepEqual(await dispatch("uiConfig"), ui);
  assert.throws(
    () => validateAppearance({ ...ui.appearance, upColor: "url(secret)" }),
    /theme/,
  );
  assert.throws(
    () => validateWatchlist([...ui.watchlist, ui.watchlist[0]]),
    /Duplicate/,
  );
  assert.throws(
    () =>
      validateWatchlist([
        { symbol: "SPY", provider: "unusualWhales", timeframe: "1d" },
      ]),
    /Invalid/,
  );
  await assert.rejects(
    dispatch("watchlistQuotes", { symbols: ["../../bad"] }),
    /Invalid/,
  );
});
test("strategy import keeps comments, removes UTF-8 BOM, records filename and never executes", async () => {
  const script = await dispatch("importScriptFile", {
    name: "Mean reversion.pine",
    source: "\uFEFF" + source + "\n// Author and license preserved",
  });
  assert.equal(script.name, "Mean reversion");
  assert.equal(script.source, source + "\n// Author and license preserved");
  assert.equal(script.provenance.filename, "Mean reversion.pine");
  assert.equal((await dispatch("workspace")).runs.length, 0);
  assert.ok(
    (await dispatch("workspace")).scripts.some((s) => s.id === script.id),
  );
  await assert.rejects(
    dispatch("importScriptFile", {
      name: "bad.pine",
      source: "//@version=6\n\0bad",
    }),
    /plain/,
  );
  await assert.rejects(
    dispatch("importScriptFile", { name: "bad.js", source }),
    /\.pine/,
  );
  await assert.rejects(
    dispatch("importScriptFile", {
      name: "bad.pine",
      source: 'strategy("Missing version")',
    }),
    /v5\/v6/,
  );
});
test("named layouts snapshot settled data, indicator settings and drafts without provider secrets; activation and deletion persist", async () => {
  const workspace = await dispatch("workspace");
  const saved = await dispatch("layoutSave", {
    name: "Research",
    credentials: { apiKey: "never-save-this" },
    snapshot: {
      page: "workspace",
      editor: true,
      source,
      name: "Draft",
      settings: { initial_capital: 10000 },
      inputs: "{}",
      tab: "performance",
      dataset: workspace.dataset,
      chart: {
        symbol: workspace.dataset.symbol,
        timeframe: "1h",
        range: null,
        drawings: { version: 1, drawings: [] },
        indicators: [{ source, inputs: {}, props: {}, visible: true }],
      },
      providerSettings: { key: "never-save-this" },
    },
  });
  assert.equal(JSON.stringify(saved).includes("never-save-this"), false);
  assert.equal((await dispatch("layoutList"))[0].id, saved.id);
  assert.equal(
    (await dispatch("layoutRead", { id: saved.id })).snapshot.chart
      .indicators[0].source,
    source,
  );
  const active = await dispatch("layoutActivate", { id: saved.id });
  assert.equal(active.snapshot.dataset.bars.length, 500);
  assert.match((await dispatch("workspace")).dataset.origin, /Synthetic/);
  assert.throws(
    () =>
      validateLayout({
        name: "Invalid",
        snapshot: {
          ...saved.snapshot,
          chart: { ...saved.snapshot.chart, range: { from: 10, to: 1 } },
        },
      }),
    /range/,
  );
  await dispatch("layoutDelete", { id: saved.id });
  await assert.rejects(dispatch("layoutRead", { id: saved.id }), /not found/);
  assert.deepEqual(await dispatch("layoutList"), []);
});
test.after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
