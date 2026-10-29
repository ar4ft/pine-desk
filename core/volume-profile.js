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
  } = input;
  if (
    !["imported", "live"].includes(source) ||
    !["session", "anchored"].includes(mode)
  )
    throw Error(
      "Choose imported/live trades and session/anchored profile mode.",
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
  if (mode === "session") {
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
    from = Date.parse(sessionDate + "T00:00:00Z") + sessionOpen * minute;
    to = from + sessionMinutes * minute;
  } else {
    from = input.from;
    to = input.to;
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
    from,
    to,
    ...(mode === "session"
      ? { sessionDate, sessionOpen, sessionMinutes, timezone: "UTC" }
      : {}),
  };
}
export function volumeProfile(snapshot, input = {}) {
  const settings = profileSettings(input),
    trades = validateTrades(snapshot.trades);
  if (trades.some((t) => !Number.isSafeInteger(t.time) || t.time > maxTime))
    throw Error(
      "Trade timestamp must be a supported integer millisecond date.",
    );
  const { from, to, tickSize, valueAreaPercent } = settings,
    levels = new Map();
  let buy = 0,
    sell = 0,
    totalTrades = 0,
    first = null,
    last = null;
  for (const t of trades) {
    if (t.time < from || t.time >= to) continue;
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
  const gaps = (snapshot.gaps ?? []).filter(
    (g) => (g.from == null || g.from < to) && (g.to == null || g.to >= from),
  );
  return {
    settings,
    symbol: snapshot.symbol,
    origin: snapshot.origin ?? "Imported trade range",
    calculatedAt: Date.now(),
    totalTrades,
    buy,
    sell,
    delta: buy - sell,
    profile,
    valueArea: volumeValueArea(profile, tickSize, valueAreaPercent),
    coverage: {
      retainedFrom: trades[0].time,
      retainedTo: trades.at(-1).time,
      observedFrom: first,
      observedTo: last,
      startsBeforeRetained: from < trades[0].time,
      endsAfterRetained: to - 1 > trades.at(-1).time,
      gaps,
      note: "Observed trades only. Retained timestamps and known gaps do not establish complete session coverage. No backfill or interpolation.",
    },
  };
}
