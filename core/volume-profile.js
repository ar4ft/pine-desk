import {
  tradeSizeSettings,
  matchesTradeSize,
  tradeFilterStats,
} from "./trade-filter.js";
import { validateTrades } from "./data.js";
import { bucketIndex, priceAt, volumeValueArea } from "./orderflow.js";
const minute = 60000;
const maxTime = 8.64e15;
export function profileSettings(input = {}) {
  const {
    source = "imported",
    mode = "session",
    tickSize = 10,
    valueAreaPercent = 70,
    sessionDate,
    sessionOpen = 0,
    sessionMinutes = 1440,
    sessionEndDate,
    weekdays = [0, 1, 2, 3, 4, 5, 6],
  } = input;
  if (
    !["imported", "live"].includes(source) ||
    !["session", "anchored", "composite"].includes(mode)
  )
    throw Error(
      "Choose imported/live trades and session/anchored/composite profile mode.",
    );
  if (
    !Number.isFinite(tickSize) ||
    tickSize <= 0 ||
    !Number.isFinite(valueAreaPercent) ||
    valueAreaPercent < 1 ||
    valueAreaPercent > 100
  )
    throw Error("Use a positive price bucket and value area 1–100%.");
  let from, to;
  const windows = [];
  if (mode !== "anchored") {
    if (
      typeof sessionDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate) ||
      !Number.isFinite(Date.parse(sessionDate + "T00:00:00Z")) ||
      new Date(sessionDate + "T00:00:00Z").toISOString().slice(0, 10) !==
        sessionDate
    )
      throw Error("Choose a valid UTC session date (YYYY-MM-DD).");
    if (
      !Number.isInteger(sessionOpen) ||
      sessionOpen < 0 ||
      sessionOpen > 1439 ||
      !Number.isInteger(sessionMinutes) ||
      sessionMinutes < 1 ||
      sessionMinutes > 1440
    )
      throw Error(
        "Session open must be 0–1439 UTC minutes; duration 1–1440 minutes.",
      );
    const firstDay = Date.parse(sessionDate + "T00:00:00Z");
    let lastDay = firstDay;
    if (mode === "composite") {
      if (
        typeof sessionEndDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(sessionEndDate) ||
        !Number.isFinite(Date.parse(sessionEndDate + "T00:00:00Z")) ||
        new Date(sessionEndDate + "T00:00:00Z").toISOString().slice(0, 10) !==
          sessionEndDate
      )
        throw Error("Choose a valid last session opening date (YYYY-MM-DD).");
      lastDay = Date.parse(sessionEndDate + "T00:00:00Z");
      if (lastDay < firstDay || lastDay - firstDay > 30 * 86400000)
        throw Error(
          "Composite must span 1–31 calendar opening dates in ascending order.",
        );
      if (
        !Array.isArray(weekdays) ||
        !weekdays.length ||
        weekdays.length > 7 ||
        new Set(weekdays).size !== weekdays.length ||
        weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
      )
        throw Error(
          "Choose unique opening weekdays 0–6 (Sunday–Saturday), at least one.",
        );
    }
    for (let day = firstDay; day <= lastDay; day += 86400000) {
      if (mode === "composite" && !weekdays.includes(new Date(day).getUTCDay()))
        continue;
      const begin = day + sessionOpen * minute;
      windows.push({
        sessionDate: new Date(day).toISOString().slice(0, 10),
        from: begin,
        to: begin + sessionMinutes * minute,
      });
    }
    if (!windows.length)
      throw Error("No opening dates match the selected weekdays.");
    from = windows[0].from;
    to = windows.at(-1).to;
  } else {
    from = input.from;
    to = input.to;
    windows.push({ from, to });
  }
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to > maxTime ||
    from >= to
  )
    throw Error(
      "Use UTC millisecond boundaries from 1970 onward with start before end (end exclusive).",
    );
  return {
    source,
    mode,
    tickSize,
    valueAreaPercent,
    ...tradeSizeSettings(input),
    windows,
    from,
    to,
    ...(mode !== "anchored"
      ? { sessionDate, sessionOpen, sessionMinutes, timezone: "UTC" }
      : {}),
    ...(mode === "composite"
      ? { sessionEndDate, weekdays: [...weekdays].sort() }
      : {}),
  };
}
export function profileTrades(snapshot) {
  const trades = validateTrades(snapshot.trades);
  if (trades.some((t) => !Number.isSafeInteger(t.time) || t.time > maxTime))
    throw Error(
      "Trade timestamp must be a supported integer millisecond date.",
    );
  return trades;
}
export function profileCoverage(snapshot, trades, from, to, first, last) {
  return {
    retainedFrom: trades[0].time,
    retainedTo: trades.at(-1).time,
    observedFrom: first,
    observedTo: last,
    startsBeforeRetained: from < trades[0].time,
    endsAfterRetained: to - 1 > trades.at(-1).time,
    gaps: (snapshot.gaps ?? []).filter(
      (g) => (g.from == null || g.from < to) && (g.to == null || g.to >= from),
    ),
    note: "Observed trades only. Retained timestamps and known gaps do not establish complete session coverage. No backfill or interpolation.",
  };
}
export function volumeProfile(snapshot, input = {}) {
  const settings = profileSettings(input),
    trades = profileTrades(snapshot);
  const { from, to, tickSize, valueAreaPercent } = settings,
    levels = new Map();
  const sessions = settings.windows.map((w) => ({
    ...w,
    observedTrades: 0,
    totalTrades: 0,
    buy: 0,
    sell: 0,
    first: null,
    last: null,
  }));
  let sessionIndex = 0;
  let buy = 0,
    sell = 0,
    totalTrades = 0,
    first = null,
    last = null,
    observedTrades = 0;
  for (const t of trades) {
    while (
      sessionIndex < sessions.length &&
      t.time >= sessions[sessionIndex].to
    )
      sessionIndex++;
    const session = sessions[sessionIndex];
    if (!session || t.time < session.from) continue;
    observedTrades++;
    session.observedTrades++;
    first ??= t.time;
    last = t.time;
    session.first ??= t.time;
    session.last = t.time;
    if (!matchesTradeSize(t, settings)) continue;
    session.totalTrades++;
    session[t.side] += t.size;
    const index = bucketIndex(t.price, tickSize);
    if (!levels.has(index)) {
      if (levels.size >= 50000)
        throw Error(
          "Profile exceeds 50,000 occupied rows; increase price bucket or shorten the range.",
        );
      levels.set(index, {
        index,
        price: priceAt(index, tickSize),
        buy: 0,
        sell: 0,
      });
    }
    levels.get(index)[t.side] += t.size;
    if (t.side === "buy") buy += t.size;
    else sell += t.size;
    totalTrades++;
    first ??= t.time;
    last = t.time;
  }
  if (!Number.isFinite(buy + sell))
    throw Error("Trade volume exceeds numeric capacity.");
  const profile = [...levels.values()].sort((a, b) => b.index - a.index);
  return {
    settings,
    symbol: snapshot.symbol,
    origin: snapshot.origin ?? "Imported trade range",
    calculatedAt: Date.now(),
    totalTrades,
    filter: tradeFilterStats(observedTrades, totalTrades, settings),
    sessions: sessions.map(({ first, last, ...session }) => ({
      ...session,
      delta: session.buy - session.sell,
      filter: tradeFilterStats(
        session.observedTrades,
        session.totalTrades,
        settings,
      ),
      coverage: profileCoverage(
        snapshot,
        trades,
        session.from,
        session.to,
        first,
        last,
      ),
    })),
    buy,
    sell,
    delta: buy - sell,
    profile,
    valueArea: volumeValueArea(profile, tickSize, valueAreaPercent),
    coverage: profileCoverage(
      {
        ...snapshot,
        gaps: (snapshot.gaps ?? []).filter((g) =>
          settings.windows.some(
            (w) =>
              (g.from == null || g.from < w.to) &&
              (g.to == null || g.to >= w.from),
          ),
        ),
      },
      trades,
      from,
      to,
      first,
      last,
    ),
  };
}
