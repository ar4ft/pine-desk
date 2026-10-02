import { durations } from "./data.js";
export function validateCalendar(bars, timeframe, session) {
  const step = durations[timeframe];
  if (!session) {
    if (bars.some((b, i) => i && b.time - bars[i - 1].time !== step))
      throw Error(
        "Research requires contiguous candles or an explicit session calendar.",
      );
    return { kind: "continuous", gaps: 0 };
  }
  const {
    timeZone,
    startMinute,
    endMinute,
    weekdays = [1, 2, 3, 4, 5],
    closedDates = [],
    earlyCloses = {},
  } = session;
  if (
    !Number.isInteger(startMinute) ||
    !Number.isInteger(endMinute) ||
    startMinute < 0 ||
    endMinute > 1440 ||
    endMinute <= startMinute ||
    !Array.isArray(weekdays) ||
    !weekdays.length ||
    weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    !Array.isArray(closedDates) ||
    closedDates.length > 1000 ||
    typeof earlyCloses !== "object" ||
    Object.values(earlyCloses).some(
      (n) => !Number.isInteger(n) || n <= startMinute || n > endMinute,
    )
  )
    throw Error("Invalid session calendar.");
  const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }),
    days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const open = (time) => {
    const parts = Object.fromEntries(
        formatter.formatToParts(time).map((p) => [p.type, p.value]),
      ),
      date = `${parts.year}-${parts.month}-${parts.day}`,
      minute = Number(parts.hour) * 60 + Number(parts.minute);
    return (
      weekdays.includes(days.indexOf(parts.weekday)) &&
      !closedDates.includes(date) &&
      minute >= startMinute &&
      minute < (earlyCloses[date] ?? endMinute)
    );
  };
  let skipped = 0;
  for (let i = 0; i < bars.length; i++) {
    if (!open(bars[i].time))
      throw Error(
        `Candle outside the supplied session at ${new Date(bars[i].time).toISOString()}.`,
      );
    if (!i) continue;
    if ((bars[i].time - bars[i - 1].time) % step !== 0)
      throw Error("Candle timestamps do not align to the timeframe.");
    const slots = (bars[i].time - bars[i - 1].time) / step;
    if (slots > 100000)
      throw Error("Session gap exceeds validation limit; split the study.");
    for (let t = bars[i - 1].time + step; t < bars[i].time; t += step) {
      if (open(t))
        throw Error(
          `Missing in-session candle at ${new Date(t).toISOString()}.`,
        );
      skipped++;
    }
  }
  return {
    kind: "explicit-session",
    session,
    closedSlots: skipped,
    assumption:
      "Holiday and early-close dates must be supplied; no exchange calendar is downloaded.",
  };
}
