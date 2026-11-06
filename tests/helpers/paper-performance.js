import { randomUUID } from "node:crypto";
import { PaperAccount } from "../../core/paper-account.js";
export function performanceFixture() {
  let doc = null,
    at = Date.UTC(2026, 10, 1),
    price = 100,
    writes = 0;
  const opts = {
    now: () => at,
    validateMarket: async () => {},
    storage: {
      read: async () => structuredClone(doc),
      write: async (d) => {
        doc = structuredClone(d);
        writes++;
      },
    },
    quote: async (symbol) => ({
      symbol,
      bid: price,
      ask: price,
      requestedAt: at,
      receivedAt: at,
      source: "Binance public bookTicker REST",
    }),
  };
  const a = new PaperAccount(opts);
  const fill = async ({
    symbol = "BTCUSDT",
    side = "buy",
    quantity = 1,
    feePercent = 0,
    atPrice = 100,
    plan = null,
    atTime,
  } = {}) => {
    price = atPrice;
    at = atTime ?? at + 1000;
    const s = await a.submit({
      expectedRevision: (await a.snapshot()).revision,
      requestId: randomUUID(),
      input: {
        symbol,
        side,
        type: "market",
        quantity,
        feePercent,
        ...(side === "buy" ? { maxNotional: quantity * price * 1.01 } : {}),
      },
      plan,
    });
    return (
      await a.process({ expectedRevision: s.revision, id: s.orders.at(-1).id })
    ).account;
  };
  return {
    a,
    opts,
    fill,
    raw: () => structuredClone(doc),
    writes: () => writes,
    advance: (ms = 1000) => (at += ms),
  };
}
export async function seedPerformance(f) {
  await f.a.create({ initialCash: 10000 });
  const plan = {
    id: randomUUID(),
    revision: 2,
    name: "<img src=x onerror=alert(1)> Plan A",
  };
  await f.fill({ quantity: 2, feePercent: 1, plan });
  await f.fill({
    atPrice: 120,
    feePercent: 1,
    plan: { ...plan, id: randomUUID(), name: "Plan B" },
  });
  await f.fill({ side: "sell", atPrice: 110, feePercent: 1 });
  await f.fill({ atPrice: 90, feePercent: 1 });
  await f.fill({ side: "sell", quantity: 3, atPrice: 130, feePercent: 1 });
  await f.fill();
  await f.fill({ side: "sell", atPrice: 80 });
  await f.fill({ symbol: "ETHUSDT", atPrice: 50 });
  await f.fill({ symbol: "ETHUSDT", side: "sell", atPrice: 50 });
  await f.fill({ symbol: "SOLUSDT", quantity: 2, atPrice: 50, feePercent: 1 });
  return f.fill({
    symbol: "SOLUSDT",
    side: "sell",
    atPrice: 60,
    feePercent: 1,
  });
}
