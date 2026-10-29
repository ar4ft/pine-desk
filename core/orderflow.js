import { durations, validateTrades } from "./data.js";
export const flowDefaults = {
  timeframe: "1h",
  tickSize: 10,
  imbalanceRatio: 3,
  minImbalanceVolume: 0,
  stackLength: 3,
  zeroDenominator: "exclude",
  valueAreaPercent: 70,
};
export function flowSettings(input = {}) {
  const s = { ...flowDefaults, ...input };
  if (
    !Object.hasOwn(durations, s.timeframe) ||
    !Number.isFinite(s.tickSize) ||
    s.tickSize <= 0
  )
    throw Error(
      "Use a supported fixed timeframe and positive price bucket size.",
    );
  if (
    !Number.isFinite(s.imbalanceRatio) ||
    s.imbalanceRatio < 1 ||
    s.imbalanceRatio > 100 ||
    !Number.isFinite(s.minImbalanceVolume) ||
    s.minImbalanceVolume < 0 ||
    !Number.isInteger(s.stackLength) ||
    s.stackLength < 2 ||
    s.stackLength > 20 ||
    !["exclude", "flag"].includes(s.zeroDenominator) ||
    !Number.isFinite(s.valueAreaPercent) ||
    s.valueAreaPercent < 1 ||
    s.valueAreaPercent > 100
  )
    throw Error(
      "Use imbalance ratio 1–100, nonnegative minimum size, stack length 2–20 and value area 1–100%.",
    );
  return Object.fromEntries(Object.keys(flowDefaults).map((k) => [k, s[k]]));
}
export const priceAt = (index, tick) => {
  const price = Number((index * tick).toPrecision(15));
  if (!Number.isFinite(price))
    throw Error("Price bucket exceeds numeric capacity.");
  return price;
};
export function bucketIndex(price, tick) {
  let ratio = price / tick;
  if (!Number.isFinite(ratio) || ratio > 1e12)
    throw Error(
      "Price bucket is too small for this market; use at most 10¹² price steps.",
    );
  // Correct floating-point representation at decimal boundaries (e.g. 0.3 / 0.1).
  const nearest = Math.round(ratio);
  if (
    Math.abs(ratio - nearest) <=
    Number.EPSILON * Math.max(1, Math.abs(ratio)) * 4
  )
    ratio = nearest;
  return Math.floor(ratio);
}
export function volumeValueArea(input, tickSize, percent = 70) {
  const levels = [...input].sort((a, b) => a.index - b.index);
  if (!levels.length) return null;
  const volume = (l) => l.buy + l.sell;
  let total = 0,
    poc = 0;
  for (let i = 0; i < levels.length; i++) {
    total += volume(levels[i]);
    if (volume(levels[i]) >= volume(levels[poc])) poc = i;
  }
  if (!Number.isFinite(total))
    throw Error("Trade volume exceeds numeric capacity.");
  let low = poc,
    high = poc,
    included = volume(levels[poc]);
  const target = total * (percent / 100);
  // Nearest occupied rows; no dense allocation across untraded price gaps.
  while (included < target && (low > 0 || high < levels.length - 1)) {
    if (
      high < levels.length - 1 &&
      (low === 0 || volume(levels[high + 1]) >= volume(levels[low - 1]))
    )
      included += volume(levels[++high]);
    else included += volume(levels[--low]);
  }
  return {
    poc: levels[poc].price,
    low: levels[low].price,
    high: priceAt(levels[high].index + 1, tickSize),
    targetPercent: percent,
    actualPercent: (included / total) * 100,
    volume: included,
    totalVolume: total,
    rows: high - low + 1,
    method:
      "nearest-occupied-row; ties choose higher price; VAH is exclusive bucket upper edge",
  };
}
function footprint(levelMap, settings) {
  const {
    tickSize,
    imbalanceRatio,
    minImbalanceVolume,
    stackLength,
    zeroDenominator,
  } = settings;
  const levels = [...levelMap.values()].sort((a, b) => a.index - b.index);
  const first = levels[0].index,
    last = levels.at(-1).index;
  for (const level of levels) {
    for (const side of ["buy", "sell"]) {
      const index = level.index + (side === "buy" ? -1 : 1),
        inside = index >= first && index <= last;
      const denominator = inside
        ? (levelMap.get(index)?.[side === "buy" ? "sell" : "buy"] ?? 0)
        : null;
      const numerator = level[side];
      const ratio = denominator > 0 ? numerator / denominator : null;
      if (ratio !== null && !Number.isFinite(ratio))
        throw Error("Imbalance ratio exceeds numeric capacity.");
      level[side + "Ratio"] = ratio;
      level[side + "Zero"] = inside && denominator === 0;
      level[side + "Imbalance"] =
        inside &&
        numerator > 0 &&
        numerator >= minImbalanceVolume &&
        (denominator > 0
          ? numerator / denominator >= imbalanceRatio
          : zeroDenominator === "flag");
      level[side + "Stack"] = false;
    }
  }
  const stacks = [];
  for (const side of ["buy", "sell"]) {
    let run = [];
    const flush = () => {
      if (run.length >= stackLength) {
        for (const row of run) row[side + "Stack"] = true;
        stacks.push({
          side,
          from: run[0].price,
          to: priceAt(run.at(-1).index + 1, tickSize),
          levels: run.length,
        });
      }
      run = [];
    };
    for (const row of levels) {
      if (!row[side + "Imbalance"]) {
        flush();
        continue;
      }
      if (run.length && row.index !== run.at(-1).index + 1) flush();
      run.push(row);
    }
    flush();
  }
  return {
    levels: levels.reverse(),
    stacks,
    valueArea: volumeValueArea(levels, tickSize, settings.valueAreaPercent),
  };
}
export function orderflow(input, options = {}) {
  const settings = flowSettings(options),
    trades = validateTrades(input),
    duration = durations[settings.timeframe],
    buckets = new Map(),
    profile = new Map();
  let levelCount = 0;
  for (const t of trades) {
    if (t.time > 8.64e15)
      throw Error("Trade timestamp exceeds the supported date range.");
    const time = Math.floor(t.time / duration) * duration,
      index = bucketIndex(t.price, settings.tickSize),
      price = priceAt(index, settings.tickSize);
    if (!buckets.has(time)) {
      if (buckets.size >= 10000)
        throw Error(
          "Order flow exceeds 10,000 occupied bars; increase aggregation or shorten the trade range.",
        );
      buckets.set(time, {
        time,
        buy: 0,
        sell: 0,
        buyCount: 0,
        sellCount: 0,
        levels: new Map(),
      });
    }
    const b = buckets.get(time);
    b[t.side] += t.size;
    b[t.side + "Count"]++;
    if (!b.levels.has(index)) {
      if (++levelCount > 50000)
        throw Error(
          "Order flow exceeds 50,000 occupied footprint rows; increase price bucket or shorten the trade range.",
        );
      b.levels.set(index, { index, price, buy: 0, sell: 0 });
    }
    b.levels.get(index)[t.side] += t.size;
    if (!profile.has(index))
      profile.set(index, { index, price, buy: 0, sell: 0 });
    profile.get(index)[t.side] += t.size;
  }
  let cvd = 0;
  const bars = [...buckets.values()].map((b) => {
    const delta = b.buy - b.sell;
    cvd += delta;
    return { ...b, delta, cvd, ...footprint(b.levels, settings) };
  });
  const levels = [...profile.values()].sort((a, b) => b.index - a.index),
    valueArea = volumeValueArea(
      levels,
      settings.tickSize,
      settings.valueAreaPercent,
    );
  return {
    bars,
    profile: levels,
    poc: valueArea.poc,
    valueArea,
    settings,
    totalTrades: trades.length,
    buy: bars.reduce((s, b) => s + b.buy, 0),
    sell: bars.reduce((s, b) => s + b.sell, 0),
    from: trades[0].time,
    to: trades.at(-1).time,
  };
}
