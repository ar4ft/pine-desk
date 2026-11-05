import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export async function desktopPaperSmoke({ app, page, client, call }) {
  await app.evaluate(({ app }) => {
    const path = process.getBuiltinModule("node:path"),
      require = process
        .getBuiltinModule("node:module")
        .createRequire(path.join(app.getAppPath(), "package.json"));
    const { paperAccount, paperMonitor } = require(
      path.join(app.getAppPath(), "core/service.js"),
    );
    globalThis.pineDeskPaperSmoke = {
      paperAccount,
      paperMonitor,
      clock: paperMonitor.clock,
      fetch: globalThis.fetch,
      bid: 99,
      ask: 100,
      quote: paperAccount.quote,
      validateMarket: paperAccount.validateMarket,
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      const u = new URL(String(url));
      if (
        u.hostname === "data-api.binance.vision" &&
        u.pathname === "/api/v3/klines"
      ) {
        const end = Number(u.searchParams.get("endTime"));
        const rows = Array.from(
          { length: Number(u.searchParams.get("limit")) },
          (_, i) => {
            const time = end - (300 - i) * 3600000;
            return [time, "110", "115", "105", "112", "100", time + 3599999];
          },
        );
        return new Response(JSON.stringify(rows), { status: 200 });
      }
      return originalFetch(url, options);
    };
    paperMonitor.clock = { setTimeout: () => 1, clearTimeout: () => {} };
    paperAccount.validateMarket = async () => {};
    paperAccount.quote = async (symbol) => {
      const now = Date.now();
      return {
        symbol,
        bid: globalThis.pineDeskPaperSmoke.bid,
        ask: globalThis.pineDeskPaperSmoke.ask,
        requestedAt: now,
        receivedAt: now,
        source: "Binance public bookTicker REST",
      };
    };
  });
  try {
    assert.equal(await call(client, "paper_account"), null);
    let account = await call(client, "paper_create", { initialCash: 1000 });
    account = await call(client, "paper_submit", {
      expectedRevision: account.revision,
      requestId: randomUUID(),
      input: {
        symbol: "BTCUSDT",
        side: "buy",
        type: "market",
        quantity: 2,
        maxNotional: 220,
        feePercent: 1,
        slippage: 1,
      },
    });
    await call(client, "desktop_navigate", { page: "paper" });
    await page
      .locator(`[data-paper-process="${account.orders[0].id}"]`)
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector("#paper-message")
        ?.textContent.includes("Simulated fill recorded"),
    );
    account = await call(client, "paper_account");
    assert.equal(account.fills.length, 1);
    assert.equal(account.positions.BTCUSDT.quantity, 2);
    assert.equal(account.revision, 3);
    await page.locator("#paper-side").selectOption("sell");
    await page.locator("#paper-quantity").fill("0.5");
    await page.locator("#paper-feePercent").fill("0");
    await page.locator("#paper-slippage").fill("0");
    await page.locator("#paper-submit").click();
    await page.locator("[data-paper-process]").click();
    await page.waitForFunction(
      () => document.querySelectorAll("#paper-fills tbody tr").length === 2,
    );
    account = await call(client, "paper_account");
    assert.equal(account.positions.BTCUSDT.quantity, 1.5);
    assert.equal(account.cash, 845.48);
    await call(client, "paper_submit", {
      expectedRevision: account.revision,
      requestId: randomUUID(),
      input: {
        symbol: "BTCUSDT",
        side: "buy",
        type: "limit",
        quantity: 1,
        price: 100,
        feePercent: 0,
        slippage: 0,
        bracket: { stop: 90, targets: [{ price: 110, quantity: 1 }] },
      },
    });
    await call(client, "paper_monitor_start");
    await page.waitForFunction(
      () => document.querySelectorAll("#paper-fills tbody tr").length === 3,
    );
    await page.locator("#paper-quantity").fill("0.123");
    await app.evaluate(async () => {
      const f = globalThis.pineDeskPaperSmoke;
      f.bid = 111;
      f.ask = 112;
      await f.paperMonitor.cycle();
    });
    await page.waitForFunction(
      () => document.querySelectorAll("#paper-fills tbody tr").length === 4,
    );
    assert.equal(await page.locator("#paper-quantity").inputValue(), "0.123");
    const monitor = await call(client, "paper_monitor_stop");
    assert.equal(monitor.active, false);
    assert.equal(monitor.account.cash, 856.48);
    assert.equal(monitor.account.positions.BTCUSDT.quantity, 1.5);
    assert.equal(
      monitor.account.orders.find((o) => o.leg === "stop").status,
      "cancelled",
    );
    assert.ok(Math.abs(monitor.valuation.equity - 1022.98) < 1e-8);
    await call(client, "paper_set_risk", {
      expectedRevision: monitor.account.revision,
      policy: { ...monitor.account.risk, pauseBuys: true, maxMarkets: 2 },
    });
    await page.waitForFunction(() =>
      document
        .querySelector("#paper-risk-status")
        ?.textContent.includes("BUYS PAUSED"),
    );
    await page.locator("#paper-risk-editor summary").click();
    await page.locator("#paper-risk-load").click();
    await page.waitForFunction(
      () => document.querySelector("#paper-risk-pauseBuys")?.checked,
    );
    await page.locator("#paper-risk-maxOrderCost").fill("150");
    await page.locator("#paper-risk-save").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#paper-message")
        ?.textContent.includes("Risk limits saved"),
    );
    account = await call(client, "paper_account");
    assert.equal(account.risk.maxOrderCost, 150);
    assert.equal(account.risk.pauseBuys, true);
    const journal = await call(client, "paper_journal");
    assert.equal(journal.entries.length, 4);
    const entry = journal.entries[0];
    await call(client, "paper_journal_save", {
      orderId: entry.orderId,
      expectedRevision: 0,
      input: {
        thesis: "MCP entry thesis",
        review: "MCP review",
        tags: ["practice"],
        adherence: "followed-plan",
      },
    });
    await page.locator("#paper-journal-load").click();
    await page.locator(`[data-journal-edit="${entry.orderId}"]`).click();
    assert.equal(
      await page.locator("#paper-journal-review").inputValue(),
      "MCP review",
    );
    await page
      .locator("#paper-journal-review")
      .fill("Desktop fill review survives restart");
    await page.locator("#paper-journal-save").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#paper-message")
        ?.textContent.includes("Fill review saved"),
    );
    assert.equal((await call(client, "paper_journal")).entries[0].revision, 2);
    assert.equal((await call(client, "paper_account")).revision, 10);
    const history = await call(client, "paper_history");
    assert.equal(history.count, 2);
    assert.ok(Math.abs(history.samples.at(-1).equity - 1022.98) < 1e-8);
    await call(client, "paper_history_rollover", {
      expectedPeriod: history.period,
      expectedTotalCount: history.totalCount,
    });
    assert.equal((await call(client, "paper_history")).count, 0);
    assert.equal((await call(client, "paper_history", { period: 1 })).count, 2);
    await page.locator("#paper-history-load").click();
    await page.locator("#paper-history-period").selectOption("1");
    await page.waitForFunction(() =>
      document
        .querySelector("#paper-history-body")
        ?.textContent.includes("1,022.98"),
    );
    account = await call(client, "paper_submit", {
      expectedRevision: (await call(client, "paper_account")).revision,
      requestId: randomUUID(),
      input: {
        symbol: "BTCUSDT",
        side: "sell",
        type: "limit",
        quantity: 0.5,
        price: 130,
        feePercent: 0,
      },
    });
    const pending = account.orders.at(-1);
    const chart = await call(client, "paper_order_chart", {
      id: pending.id,
      timeframe: "1h",
    });
    assert.equal(chart.symbol, "BTCUSDT");
    assert.equal(chart.bars.length, 300);
    await page.locator(`[data-paper-edit="${pending.id}"]`).click();
    await page.waitForFunction(
      () =>
        document.querySelector("#paper-edit-chart")?.dataset.ready === "true",
    );
    const resizePreview = await call(client, "paper_amend_preview", {
      id: pending.id,
      expectedRevision: account.revision,
      price: 135,
      quantity: 0.4,
    });
    assert.equal(resizePreview.quantityReservationAfter, 0.4);
    assert.equal(
      (await call(client, "paper_account")).revision,
      account.revision,
    );
    await page.locator("#paper-edit-price").fill("135");
    await page.locator("#paper-edit-quantity").fill("0.4");
    await page.locator("#paper-edit-review").click();
    await page.waitForFunction(
      () => !document.querySelector("#paper-edit-apply")?.disabled,
    );
    await page.locator("#paper-edit-apply").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#paper-message")
        ?.textContent.includes("Paper order updated"),
    );
    account = await call(client, "paper_account");
    assert.equal(account.revision, 12);
    assert.equal(account.orders.at(-1).price, 135);
    account = await call(client, "paper_amend", {
      id: pending.id,
      expectedRevision: account.revision,
      price: 136,
      quantity: 0.3,
    });
    assert.equal(account.revision, 13);
    assert.equal(account.orders.at(-1).price, 136);
    assert.equal(account.orders.at(-1).quantity, 0.3);
    const performance = await call(client, "paper_performance");
    assert.equal(performance.accountRevision, 13);
    assert.equal(performance.summary.closedCount, 0);
    assert.equal(performance.openTrades.length, 1);
    assert.equal(performance.openTrades[0].fills.length, 4);
    assert.ok(
      Math.abs(
        performance.reconciliation.openRealizedPnl - account.realizedPnl,
      ) < 1e-8,
    );
    await page.locator("#paper-performance-load").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#paper-performance-status")
        ?.textContent.includes("Loaded account r13"),
    );
    await page.locator("#paper-performance-tab").selectOption("open");
    await page.locator("[data-paper-trade]").click();
    assert.equal(
      await page.locator("#paper-performance-fills tbody tr").count(),
      4,
    );
    await page.locator("[data-performance-review]").first().click();
    assert.equal(
      await page.locator("#paper-journal-review").inputValue(),
      "Desktop fill review survives restart",
    );
    assert.equal((await call(client, "paper_account")).revision, 13);
    const draftBars = await call(client, "paper_draft_chart", {
      symbol: "BTCUSDT",
      timeframe: "1h",
    });
    assert.equal(draftBars.bars.length, 300);
    const preview = await call(client, "paper_preview", {
      expectedRevision: 13,
      input: {
        symbol: "BTCUSDT",
        side: "sell",
        type: "limit",
        quantity: 0.25,
        price: 150,
        feePercent: 0,
        slippage: 0,
      },
    });
    assert.equal(preview.reservedQuantityAdded, 0.25);
    assert.equal((await call(client, "paper_account")).revision, 13);
    await page.locator("#paper-compose-mode").selectOption("sell-limit");
    await page.locator("#paper-compose-quantity").fill("0.25");
    await page.locator("#paper-compose-price").fill("150");
    await page.locator("#paper-compose-load").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#paper-compose-chart")?.dataset.ready ===
        "true",
    );
    await page.locator("#paper-compose-review").click();
    await page.waitForFunction(
      () => !document.querySelector("#paper-compose-submit")?.disabled,
    );
    await page.locator("#paper-compose-submit").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#paper-compose-notice")
        ?.textContent.includes("is recorded"),
    );
    account = await call(client, "paper_account");
    assert.equal(account.revision, 14);
    assert.equal(account.orders.at(-1).price, 150);
    assert.equal(account.orders.at(-1).quantity, 0.25);
    assert.equal(account.fills.length, 4);
  } finally {
    await app.evaluate(async () => {
      const f = globalThis.pineDeskPaperSmoke;
      await f.paperMonitor.close();
      globalThis.fetch = f.fetch;
      f.paperMonitor.clock = f.clock;
      f.paperAccount.quote = f.quote;
      f.paperAccount.validateMarket = f.validateMarket;
      delete globalThis.pineDeskPaperSmoke;
    });
  }
}
