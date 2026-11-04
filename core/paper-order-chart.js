import { z } from "zod";
import { fetchBinance } from "./data.js";
export async function paperOrderChart(account, args, fetchBars = fetchBinance) {
  const { id, timeframe } = z
    .object({
      id: z.string().uuid(),
      timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).default("1h"),
    })
    .strict()
    .parse(args);
  const before = await account.snapshot(),
    order = before?.orders.find((o) => o.id === id);
  if (!order || order.status !== "pending" || order.type === "market")
    throw Error("Choose a pending limit or sell-stop order.");
  const bars = await fetchBars({ symbol: order.symbol, timeframe, limit: 300 });
  const current = await account.snapshot(),
    latest = current?.orders.find((o) => o.id === id);
  if (latest?.status !== "pending")
    throw Error("Order is no longer pending; refresh the paper account.");
  return {
    orderId: id,
    symbol: order.symbol,
    timeframe,
    bars,
    loadedAt: Date.now(),
    origin: "Binance public settled candles · chart snapshot only",
  };
}
