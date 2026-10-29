import {
  profileSettings,
  profileTrades,
  profileCoverage,
} from "./volume-profile.js";
import { bucketIndex, priceAt, volumeValueArea } from "./orderflow.js";
export function periodLabel(index) {
  let label = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  return label;
}
export function tpoProfile(snapshot, input = {}) {
  const settings = profileSettings(input);
  const { periodMinutes = 30, initialBalanceMinutes = 60 } = input;
  if (
    !Number.isInteger(periodMinutes) ||
    periodMinutes < 1 ||
    periodMinutes > 240 ||
    !Number.isInteger(initialBalanceMinutes) ||
    initialBalanceMinutes < 1 ||
    initialBalanceMinutes > 1440
  )
    throw Error(
      "Use TPO periods of 1–240 whole minutes and initial balance of 1–1440 minutes.",
    );
  const { from, to, tickSize, valueAreaPercent } = settings,
    duration = periodMinutes * 60000,
    periodCount = Math.ceil((to - from) / duration);
  if (periodCount > 288)
    throw Error(
      "TPO exceeds 288 periods; increase period length or shorten the window.",
    );
  const trades = profileTrades(snapshot),
    levels = new Map();
  const periods = Array.from({ length: periodCount }, (_, index) => ({
    index,
    label: periodLabel(index),
    from: from + index * duration,
    to: Math.min(to, from + (index + 1) * duration),
    totalTrades: 0,
    tpoCount: 0,
    observedFrom: null,
    observedTo: null,
  }));
  const ibEnd = Math.min(to, from + initialBalanceMinutes * 60000);
  let totalTrades = 0,
    totalTpos = 0,
    first = null,
    last = null,
    ibLow = Infinity,
    ibHigh = -Infinity,
    ibTrades = 0,
    ibFirst = null,
    ibLast = null;
  for (const t of trades) {
    if (t.time < from || t.time >= to) continue;
    const index = bucketIndex(t.price, tickSize),
      p = periods[Math.floor((t.time - from) / duration)];
    if (!levels.has(index)) {
      if (levels.size >= 50000)
        throw Error(
          "TPO exceeds 50,000 occupied rows; increase price bucket or shorten the window.",
        );
      levels.set(index, {
        index,
        price: priceAt(index, tickSize),
        periods: new Set(),
      });
    }
    const level = levels.get(index);
    if (!level.periods.has(p.index)) {
      level.periods.add(p.index);
      totalTpos++;
      p.tpoCount++;
    }
    p.totalTrades++;
    p.observedFrom ??= t.time;
    p.observedTo = t.time;
    totalTrades++;
    first ??= t.time;
    last = t.time;
    if (t.time < ibEnd) {
      ibLow = Math.min(ibLow, index);
      ibHigh = Math.max(ibHigh, index);
      ibTrades++;
      ibFirst ??= t.time;
      ibLast = t.time;
    }
  }
  const profile = [...levels.values()]
    .sort((a, b) => b.index - a.index)
    .map((l) => ({
      index: l.index,
      price: l.price,
      count: l.periods.size,
      periods: [...l.periods].sort((a, b) => a - b),
    }));
  const weightedArea = volumeValueArea(
    profile.map((l) => ({ ...l, buy: l.count, sell: 0 })),
    tickSize,
    valueAreaPercent,
  );
  const valueArea = weightedArea
    ? {
        poc: weightedArea.poc,
        low: weightedArea.low,
        high: weightedArea.high,
        targetPercent: weightedArea.targetPercent,
        actualPercent: weightedArea.actualPercent,
        tpoCount: weightedArea.volume,
        totalTpos: weightedArea.totalVolume,
        rows: weightedArea.rows,
        method:
          "TPO count; nearest-occupied-row expansion; POC/expansion ties higher; VAH exclusive",
      }
    : null;
  return {
    settings: { ...settings, periodMinutes, initialBalanceMinutes },
    symbol: snapshot.symbol,
    origin: snapshot.origin ?? "Imported trade range",
    calculatedAt: Date.now(),
    method:
      "Observed trade occupancy: one TPO per price bucket per period; no high-low filling; volume and side ignored",
    totalTrades,
    totalTpos,
    occupiedPeriods: periods.filter((p) => p.totalTrades > 0).length,
    onePeriodRows: profile.filter((l) => l.count === 1).length,
    profile,
    valueArea,
    periods: periods.map((p) => {
      const coverage = profileCoverage(
        snapshot,
        trades,
        p.from,
        p.to,
        p.observedFrom,
        p.observedTo,
      );
      return {
        ...p,
        partial: p.to - p.from < duration,
        knownGaps: coverage.gaps.length,
        startsBeforeRetained: coverage.startsBeforeRetained,
        endsAfterRetained: coverage.endsAfterRetained,
      };
    }),
    initialBalance: {
      from,
      to: ibEnd,
      requestedMinutes: initialBalanceMinutes,
      clipped: ibEnd - from < initialBalanceMinutes * 60000,
      low: ibTrades ? priceAt(ibLow, tickSize) : null,
      high: ibTrades ? priceAt(ibHigh + 1, tickSize) : null,
      totalTrades: ibTrades,
      coverage: profileCoverage(snapshot, trades, from, ibEnd, ibFirst, ibLast),
      method:
        "Observed bucket range in first configured minutes; upper edge exclusive; no inference from later periods",
    },
    coverage: profileCoverage(snapshot, trades, from, to, first, last),
  };
}
