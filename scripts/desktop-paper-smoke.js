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
      bid: 99,
      ask: 100,
      quote: paperAccount.quote,
      validateMarket: paperAccount.validateMarket,
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
  } finally {
    await app.evaluate(async () => {
      const f = globalThis.pineDeskPaperSmoke;
      await f.paperMonitor.close();
      f.paperMonitor.clock = f.clock;
      f.paperAccount.quote = f.quote;
      f.paperAccount.validateMarket = f.validateMarket;
      delete globalThis.pineDeskPaperSmoke;
    });
  }
}
