import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export async function desktopPaperSmoke({ app, page, client, call }) {
  await app.evaluate(({ app }) => {
    const path = process.getBuiltinModule("node:path"),
      require = process
        .getBuiltinModule("node:module")
        .createRequire(path.join(app.getAppPath(), "package.json"));
    const { paperAccount } = require(
      path.join(app.getAppPath(), "core/service.js"),
    );
    globalThis.pineDeskPaperSmoke = {
      paperAccount,
      quote: paperAccount.quote,
      validateMarket: paperAccount.validateMarket,
    };
    paperAccount.validateMarket = async () => {};
    paperAccount.quote = async (symbol) => {
      const now = Date.now();
      return {
        symbol,
        bid: 99,
        ask: 100,
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
  } finally {
    await app.evaluate(() => {
      const f = globalThis.pineDeskPaperSmoke;
      f.paperAccount.quote = f.quote;
      f.paperAccount.validateMarket = f.validateMarket;
      delete globalThis.pineDeskPaperSmoke;
    });
  }
}
