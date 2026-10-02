import { test, expect } from "@playwright/test";
import { DeribitOptions } from "../../core/deribit.js";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
let dir, dispatch;
test.beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pine-desk-education-"));
  process.env.PINE_DESK_DATA_DIR = dir;
  ({ dispatch } = await import("../../core/service.js"));
});
test.afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
test("interactive Greeks education reacts to parameters, axes, presets and invalid inputs", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator('[data-page="education"]').click();
  await expect(page.locator("#learn-values button")).toHaveCount(13);
  await expect(page.locator("#learn-curve svg")).toBeVisible();
  const delta = await page
    .locator('[data-learn-greek="delta"] strong')
    .textContent();
  await page.locator("#learn-type").selectOption("put");
  expect(
    await page.locator('[data-learn-greek="delta"] strong').textContent(),
  ).not.toEqual(delta);
  await expect(page.locator('[data-learn-greek="delta"] strong')).toContainText(
    "-",
  );
  await page.locator('[data-learn-greek="gamma"]').click();
  const gamma = await page
    .locator('[data-learn-greek="gamma"] strong')
    .textContent();
  await page.locator('[data-learn-preset="expiry"]').click();
  expect(
    await page.locator('[data-learn-greek="gamma"] strong').textContent(),
  ).not.toEqual(gamma);
  await page.locator('[data-model-number="spot"]').fill("1000");
  await expect(page.locator('[data-model-slider="spot"]')).toHaveAttribute(
    "max",
    "1500",
  );
  await page.locator("#learn-axis").selectOption("volatility");
  await expect(page.locator("#learn-curve svg")).toHaveAttribute(
    "aria-label",
    "Gamma versus IV (%)",
  );
  await page.locator('[data-model-number="volatility"]').fill("0");
  await expect(page.locator("#learn-error")).toContainText(
    "volatility must be",
  );
  await expect(page.locator("#learn-values button")).toHaveCount(0);
  await page.locator('[data-model-number="volatility"]').fill("40");
  await expect(page.locator("#learn-error")).toBeEmpty();
  await page.locator('[data-learn-greek="ultima"]').click();
  await expect(page.locator("#learn-explanation")).toContainText(
    "Third derivative",
  );
  await page.locator("#learn-answer").selectOption("price");
  await expect(page.locator("#learn-feedback")).toContainText("Correct");
  await page.locator("#learn-style").selectOption("american");
  await expect(page.locator("#learn-error")).toBeEmpty();
  await expect(page.locator("#learn-curve svg")).toBeVisible();
  await expect(page.locator('[data-learn-greek="vanna"] strong')).toContainText(
    "—",
  );
  expect(errors).toEqual([]);
});
test("Deribit explorer uses backend snapshots, contract Greeks and acknowledged live updates", async ({
  page,
}) => {
  const now = Date.now(),
    expiry = now + 86400000,
    contract = "BTC-TEST-100-C",
    sockets = [];
  const instruments = [
    {
      instrument_name: contract,
      kind: "option",
      is_active: true,
      instrument_type: "reversed",
      base_currency: "BTC",
      settlement_currency: "BTC",
      expiration_timestamp: expiry,
      contract_size: 1,
      strike: 100,
      option_type: "call",
    },
  ];
  const request = async (method) =>
    ({
      get_instruments: instruments,
      get_book_summary_by_currency: [
        {
          instrument_name: contract,
          mark_iv: 30,
          mark_price: 0.03,
          bid_price: null,
          ask_price: 0.04,
          open_interest: 12,
          creation_timestamp: now,
        },
      ],
      get_index_price: { index_price: 100 },
      get_last_trades_by_currency: {
        trades: [
          {
            trade_id: "1",
            instrument_name: contract,
            timestamp: now,
            price: 0.01,
            amount: 2,
            index_price: 100,
            direction: "sell",
          },
        ],
      },
      ticker: {
        instrument_name: contract,
        timestamp: now,
        mark_iv: 30,
        mark_price: 0.03,
        greeks: { delta: 0.55, gamma: 0.01 },
      },
    })[method];
  const d = new DeribitOptions({
    request,
    createSocket: () => {
      const s = new EventEmitter();
      s.send = (raw) => {
        const m = JSON.parse(raw);
        if (m.id === 1)
          setImmediate(() => {
            s.emit(
              "message",
              JSON.stringify({ id: 1, result: m.params.channels }),
            );
            s.emit(
              "message",
              JSON.stringify({
                method: "subscription",
                params: {
                  channel: m.params.channels[0],
                  data: {
                    instrument_name: contract,
                    timestamp: now + 1000,
                    mark_iv: 31,
                    mark_price: 0.04,
                    greeks: { delta: 0.65 },
                  },
                },
              }),
            );
          });
      };
      s.terminate = () => s.emit("close");
      sockets.push(s);
      setImmediate(() => s.emit("open"));
      return s;
    },
  });
  try {
    await page.exposeFunction(
      "backendCall",
      (a, b) =>
        ({
          deribitRefresh: () => d.refresh(b),
          deribitSelect: () => d.select(b),
          deribitStart: () => d.start(),
          deribitStop: () => d.stop(),
          deribitSnapshot: () => d.snapshot(),
        })[a]?.() ?? dispatch(a, b),
    );
    await page.addInitScript(() => {
      window.desk = { call: (a, b) => window.backendCall(a, b) };
    });
    await page.goto("/");
    await expect(page.locator("#pine-editor .cm-content")).toBeVisible();
    await page.locator('[data-page="crypto"]').click();
    await page.locator("#crypto-refresh").click();
    await expect(page.locator("[data-crypto-contract]")).toHaveText(contract);
    await expect(page.locator(".crypto-plots svg")).toHaveCount(2);
    await expect(page.locator("#crypto-content")).toContainText("Bid (BTC)");
    await page.locator("[data-crypto-contract]").click();
    await expect(page.locator("#crypto-ticker")).toContainText("0.55");
    await page.locator("#crypto-start").click();
    await expect(page.locator("#crypto-status")).toContainText("streaming");
    await expect(page.locator("#crypto-ticker")).toContainText("0.65");
    await page.locator("#crypto-stop").click();
    await expect(page.locator("#crypto-status")).toContainText("snapshot");
    expect(d.snapshot().active).toBe(false);
  } finally {
    d.stop();
  }
});
test("surface calibration, portfolio modeling, snapshot compare, archive viewer and saved quote replay", async ({
  page,
}) => {
  const { optionFixture } = await import("../fixtures/option-chain.js");
  const now = Date.now(),
    first = optionFixture({ at: now }),
    expiry = first.rows[0].expiry;
  const second = optionFixture({ at: now + 1000, expiry, spot: 105 });
  let sequence = 0;
  const enriched = (s) => ({ ...s, term: [], active: false });
  await page.exposeFunction("backendCall", async (a, b) => {
    if (a === "deribitRefresh") {
      const s = sequence++ ? second : first;
      const { deribit } = await import("../../core/service.js");
      deribit.state = enriched(s);
      return deribit.snapshot();
    }
    return dispatch(a, b);
  });
  await page.addInitScript(() => {
    window.desk = { call: (a, b) => window.backendCall(a, b) };
  });
  await page.goto("/");
  await expect(page.locator("#pine-editor .cm-content")).toBeVisible();
  await page.locator('[data-page="crypto"]').click();
  await page.locator("#crypto-refresh").click();
  await page.locator("#surface-fit").click();
  await expect(page.locator("#surface-results")).toContainText("Training RMSE");
  await expect(page.locator("#surface-results")).toContainText("Held-out RMSE");
  await expect(page.locator("[data-option-candidate]").first()).toBeVisible();
  await page
    .locator("[data-option-candidate]")
    .filter({ hasText: "Call debit vertical" })
    .click();
  await page.locator("#portfolio-model").click();
  await expect(page.locator("#portfolio-results")).toContainText(
    "not global maximum loss",
  );
  await expect(page.locator("#portfolio-results svg")).toBeVisible();
  await page.locator("#option-history-save").click();
  await expect(page.locator("[data-history-select]")).toHaveCount(1);
  await page.locator("#crypto-refresh").click();
  await page.locator("#option-history-save").click();
  await expect(page.locator("[data-history-select]")).toHaveCount(2);
  for (const check of await page.locator("[data-history-select]").all())
    await check.check();
  await page.locator("#option-history-compare").click();
  await expect(page.locator("#option-comparison")).toContainText(
    "2 observations",
  );
  await page.locator("[data-history-use]").last().click();
  await expect(page.locator("#crypto-status")).toContainText("Archived chain");
  await expect(page.locator("#crypto-start")).toBeDisabled();
  await page.locator("#surface-fit").click();
  await page
    .locator("[data-option-candidate]")
    .filter({ hasText: "Call debit vertical" })
    .click();
  await page.locator("#option-replay").click();
  await expect(page.locator("#option-run-results")).toContainText("Net P&L");
  await page.locator("#option-runs-load").click();
  await expect(page.locator("#option-saved-run option")).toHaveCount(2);
});
test("Bybit regional/API failures appear without fabricating a chain", async ({
  page,
}) => {
  await page.exposeFunction("backendCall", async (a, b) => {
    if (a === "cryptoRefresh")
      throw Error("bybit HTTP 403; check regional access");
    return dispatch(a, b);
  });
  await page.addInitScript(() => {
    window.desk = { call: (a, b) => window.backendCall(a, b) };
  });
  await page.goto("/");
  await expect(page.locator("#pine-editor .cm-content")).toBeVisible();
  await page.locator('[data-page="crypto"]').click();
  await page.locator("#crypto-exchange").selectOption("bybit");
  await expect(page.locator("#crypto-settlement")).toBeEnabled();
  await page.locator("#crypto-refresh").click();
  await expect(page.locator("#toast")).toContainText("HTTP 403");
  await expect(page.locator("[data-crypto-contract]")).toHaveCount(0);
  await expect(page.locator("#crypto-start")).toBeDisabled();
});

test("rule strategies, source filters, allocations and missing licensed credentials use the backend", async ({
  page,
}) => {
  const { optionFixture } = await import("../fixtures/option-chain.js");
  const at = Date.now(),
    expiry = at + 30 * 86400000;
  const snapshots = Array.from({ length: 3 }, (_, i) =>
    optionFixture({
      at: at + i * 86400000,
      expiry,
      exchange: "bybit",
      settlement: "USDC",
      spot: 100 + i,
    }),
  );
  await dispatch("optionHistoryImport", {
    json: JSON.stringify({ schemaVersion: 1, snapshots }),
  });
  await page.exposeFunction("backendCall", (a, b) => dispatch(a, b));
  await page.addInitScript(() => {
    window.desk = { call: (a, b) => window.backendCall(a, b) };
  });
  await page.goto("/");
  await page.locator('[data-page="crypto"]').click();
  await page.locator("#history-source").selectOption("bybit");
  await expect(page.locator("[data-history-select]")).toHaveCount(3);
  for (const c of await page.locator("[data-history-select]").all())
    await c.check();
  await page.getByText("Rule-driven options strategy", { exact: true }).click();
  await page.locator("#option-capital").fill("10000");
  await page.locator("#option-strategy-run").click();
  await expect(page.locator("#option-run-results")).toContainText("Net P&L");
  const firstRun = await page
    .locator("[data-option-run]")
    .getAttribute("data-option-run");
  await page.getByText("Rule-driven options strategy", { exact: true }).click();
  await page.locator("#rules-template").selectOption("long-put");
  await page.locator("#option-strategy-run").click();
  await expect(page.locator("#option-run-results")).toContainText("Net P&L");
  await expect(page.locator("[data-option-run]")).not.toHaveAttribute(
    "data-option-run",
    firstRun,
  );
  await page.locator("#option-runs-load").click();
  await page
    .getByText("Compare saved option strategies and allocation", {
      exact: true,
    })
    .click();
  const choices = await page
    .locator("#option-allocation-runs option")
    .evaluateAll((rows) => rows.slice(0, 2).map((r) => r.value));
  await page.locator("#option-allocation-runs").selectOption(choices);
  await page.locator("#option-allocation-compare").click();
  await expect(
    page.getByText("Modeled allocation return", { exact: false }),
  ).toBeVisible();
  await page
    .getByText("Licensed historical quote backfill · Massive", { exact: true })
    .click();
  await expect(page.locator("#backfill-underlying")).toHaveValue("SPY");
  await page.locator("#option-backfill").click();
  await expect(page.locator("#toast")).toContainText("Massive API key");
});
