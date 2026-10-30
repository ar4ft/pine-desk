import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PaperAccount, paperQuote } from "../core/paper-account.js";
import { MarketSearch } from "../core/market-quotes.js";
// Real public quotes, in-memory paper ledger. Never touches the user's account.
let doc = null;
const markets = new MarketSearch();
const paper = new PaperAccount({
  storage: {
    read: async () => structuredClone(doc),
    write: async (next) => {
      doc = structuredClone(next);
    },
  },
  quote: paperQuote,
  validateMarket: async (symbol) => {
    const result = await markets.search(symbol);
    assert.ok(
      result.markets.some((m) => m.symbol === symbol && m.quote === "USDT"),
    );
  },
});
try {
  let account = await paper.create({ initialCash: 1000 });
  account = await paper.submit({
    expectedRevision: account.revision,
    requestId: randomUUID(),
    input: {
      symbol: "BTCUSDT",
      side: "buy",
      type: "market",
      quantity: 0.00001,
      maxNotional: 100,
      feePercent: 0.1,
      slippage: 0,
    },
  });
  account = (
    await paper.process({
      expectedRevision: account.revision,
      id: account.orders[0].id,
    })
  ).account;
  assert.equal(account.orders[0].status, "filled");
  assert.equal(account.positions.BTCUSDT.quantity, 0.00001);
  account = await paper.submit({
    expectedRevision: account.revision,
    requestId: randomUUID(),
    input: {
      symbol: "BTCUSDT",
      side: "sell",
      type: "market",
      quantity: 0.00001,
      feePercent: 0.1,
      slippage: 0,
    },
  });
  account = (
    await paper.process({
      expectedRevision: account.revision,
      id: account.orders[1].id,
    })
  ).account;
  assert.equal(account.fills.length, 2);
  assert.equal(account.positions.BTCUSDT.quantity, 0);
  assert.equal(account.positions.BTCUSDT.cost, 0);
  console.log(
    JSON.stringify(
      {
        simulation: true,
        storage: "in-memory; discarded",
        fills: account.fills.map((f) => ({
          side: f.side,
          price: f.price,
          fee: f.fee,
          quoteRoundTripMs: f.quote.receivedAt - f.quote.requestedAt,
        })),
        realizedPnl: account.realizedPnl,
        cash: account.cash,
      },
      null,
      2,
    ),
  );
} finally {
  await paper.close();
}
