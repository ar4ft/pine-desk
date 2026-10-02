import { durations, validateTrades } from "./data.js";
export function orderflow(input, { timeframe = "1h", tickSize = 10 } = {}) {
  const trades = validateTrades(input),
    duration = durations[timeframe];
  if (!duration || !Number.isFinite(tickSize) || tickSize <= 0)
    throw new Error(
      "Use a supported fixed timeframe and positive price bucket size.",
    );
  const buckets = new Map(),
    profile = new Map();
  for (const t of trades) {
    const time = Math.floor(t.time / duration) * duration,
      price = Number(
        (Math.floor(t.price / tickSize) * tickSize).toPrecision(12),
      );
    if (!buckets.has(time))
      buckets.set(time, {
        time,
        buy: 0,
        sell: 0,
        buyCount: 0,
        sellCount: 0,
        levels: new Map(),
      });
    const b = buckets.get(time);
    b[t.side] += t.size;
    b[`${t.side}Count`]++;
    if (!b.levels.has(price)) b.levels.set(price, { price, buy: 0, sell: 0 });
    b.levels.get(price)[t.side] += t.size;
    if (!profile.has(price)) profile.set(price, { price, buy: 0, sell: 0 });
    profile.get(price)[t.side] += t.size;
  }
  let cvd = 0;
  const bars = [...buckets.values()].map((b) => {
    const delta = b.buy - b.sell;
    cvd += delta;
    return {
      ...b,
      delta,
      cvd,
      levels: [...b.levels.values()].sort((a, b) => b.price - a.price),
    };
  });
  const levels = [...profile.values()].sort((a, b) => b.price - a.price);
  const poc = levels.reduce(
    (best, l) => (!best || l.buy + l.sell > best.buy + best.sell ? l : best),
    null,
  );
  return {
    bars,
    profile: levels,
    poc: poc?.price,
    totalTrades: trades.length,
    buy: bars.reduce((s, b) => s + b.buy, 0),
    sell: bars.reduce((s, b) => s + b.sell, 0),
    from: trades[0].time,
    to: trades.at(-1).time,
  };
}
