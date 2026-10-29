import test from "node:test";
import assert from "node:assert/strict";
import { tpoProfile, periodLabel } from "../core/tpo.js";
import { toolDefinitions } from "../core/mcp-tools.js";
const start = Date.UTC(2026, 0, 1),
  minute = 60000;
const trade = (offset, price, size = 1, side = "buy") => ({
  time: start + offset,
  price,
  size,
  side,
});
const snap = (trades) => ({ symbol: "TPO", trades, origin: "Fixture" });
const args = (extra = {}) => ({
  mode: "anchored",
  from: start,
  to: start + 6 * minute,
  tickSize: 1,
  periodMinutes: 2,
  initialBalanceMinutes: 3,
  ...extra,
});
const fixture = () => [
  trade(0, 100, 100),
  trade(1, 100, 99, "sell"),
  trade(30000, 102),
  trade(2 * minute, 101),
  trade(2 * minute + 1, 102),
  trade(4 * minute, 102),
  trade(6 * minute, 999),
];
test("TPO deduplicates each price/period and ignores size/side without filling gaps", () => {
  const r = tpoProfile(snap(fixture()), args());
  assert.equal(r.totalTrades, 6);
  assert.equal(r.totalTpos, 5);
  assert.equal(r.onePeriodRows, 2);
  assert.deepEqual(
    r.profile.map((l) => [l.price, l.count, l.periods]),
    [
      [102, 3, [0, 1, 2]],
      [101, 1, [1]],
      [100, 1, [0]],
    ],
  );
  const changed = tpoProfile(
    snap(fixture().map((t) => ({ ...t, size: 1e308, side: "sell" }))),
    args(),
  );
  assert.deepEqual(changed.profile, r.profile);
  assert.deepEqual(changed.valueArea, r.valueArea);
  assert.equal(r.periods[0].tpoCount, 2);
});
test("TPO POC and value area weight counts, with higher-price ties and exclusive VAH", () => {
  const r = tpoProfile(snap(fixture()), args());
  assert.equal(r.valueArea.poc, 102);
  assert.equal(r.valueArea.low, 101);
  assert.equal(r.valueArea.high, 103);
  assert.equal(r.valueArea.actualPercent, 80);
  assert.equal(r.valueArea.tpoCount, 4);
  assert.equal(r.valueArea.totalTpos, 5);
  assert.equal(r.valueArea.volume, undefined);
  const tied = tpoProfile(
    snap([trade(0, 100), trade(0, 101)]),
    args({ valueAreaPercent: 50 }),
  );
  assert.equal(tied.valueArea.poc, 101);
  assert.equal(tied.valueArea.low, 101);
});
test("periods begin at requested anchor, keep empty intervals and clip the last period", () => {
  const from = start + 17000;
  const r = tpoProfile(
    snap([
      trade(16999, 99),
      trade(17000, 100),
      trade(17000 + 4 * minute, 103),
      trade(17000 + 5 * minute, 105),
    ]),
    args({ from, to: from + 5 * minute }),
  );
  assert.equal(r.totalTrades, 2);
  assert.equal(r.periods.length, 3);
  assert.equal(r.periods[0].from, from);
  assert.equal(r.periods[1].totalTrades, 0);
  assert.equal(r.periods[2].partial, true);
  assert.equal(r.periods[2].to, from + 5 * minute);
  assert.deepEqual(r.profile[0].periods, [2]);
});
test("initial balance includes only its observed opening trades, independent of period boundaries", () => {
  const r = tpoProfile(
    snap([...fixture(), trade(4 * minute + 1, 200)]),
    args(),
  );
  assert.equal(r.initialBalance.low, 100);
  assert.equal(r.initialBalance.high, 103);
  assert.equal(r.initialBalance.totalTrades, 5);
  assert.equal(r.initialBalance.to, start + 3 * minute);
  assert.equal(r.initialBalance.clipped, false);
  const empty = tpoProfile(snap([trade(4 * minute, 105)]), args());
  assert.equal(empty.initialBalance.low, null);
  assert.equal(empty.initialBalance.high, null);
  const clipped = tpoProfile(
    snap(fixture()),
    args({ initialBalanceMinutes: 60 }),
  );
  assert.equal(clipped.initialBalance.to, start + 6 * minute);
  assert.equal(clipped.initialBalance.clipped, true);
});
test("overnight UTC sessions and decimal buckets remain exact and empty windows have no inferred occupancy", () => {
  const r = tpoProfile(
    snap([trade(23 * 60 * minute, 0.3), trade(24 * 60 * minute, 0.5)]),
    {
      mode: "session",
      sessionDate: "2026-01-01",
      sessionOpen: 23 * 60,
      sessionMinutes: 120,
      periodMinutes: 60,
      tickSize: 0.1,
    },
  );
  assert.equal(r.settings.to, start + 25 * 60 * minute);
  assert.equal(r.profile[1].index, 3);
  assert.equal(r.valueArea.high, 0.6);
  assert.equal(r.periods[1].from, start + 24 * 60 * minute);
  const empty = tpoProfile(snap([trade(10 * minute, 100)]), args());
  assert.equal(empty.valueArea, null);
  assert.equal(empty.totalTpos, 0);
  assert.equal(empty.occupiedPeriods, 0);
  assert.equal(empty.periods.length, 3);
  assert.equal(empty.coverage.observedFrom, null);
});
test("coverage gaps remain visible at profile, period and initial-balance scopes", () => {
  const r = tpoProfile(
    {
      ...snap([trade(minute, 100), trade(5 * minute, 101)]),
      gaps: [
        { from: start + minute, to: start + 3 * minute },
        { from: start + 5 * minute, to: null },
      ],
    },
    args(),
  );
  assert.equal(r.coverage.gaps.length, 2);
  assert.equal(r.coverage.startsBeforeRetained, true);
  assert.equal(r.periods[0].knownGaps, 1);
  assert.equal(r.periods[1].knownGaps, 1);
  assert.equal(r.periods[2].knownGaps, 1);
  assert.equal(r.initialBalance.coverage.gaps.length, 1);
  assert.equal(r.totalTpos, 2);
});
test("letter labels do not wrap and limits reject oversized or invalid inputs", () => {
  assert.deepEqual([0, 25, 26, 51, 52, 287].map(periodLabel), [
    "A",
    "Z",
    "AA",
    "AZ",
    "BA",
    "KB",
  ]);
  for (const extra of [
    { periodMinutes: 0 },
    { periodMinutes: 241 },
    { periodMinutes: 1.5 },
    { initialBalanceMinutes: 0 },
    { initialBalanceMinutes: 1441 },
    { to: start + 289 * minute, periodMinutes: 1 },
  ])
    assert.throws(() => tpoProfile(snap(fixture()), args(extra)));
  assert.equal(
    tpoProfile(
      snap(fixture()),
      args({ to: start + 288 * minute, periodMinutes: 1 }),
    ).periods.length,
    288,
  );
  assert.throws(
    () =>
      tpoProfile(
        snap(Array.from({ length: 50001 }, (_, i) => trade(0, i + 1))),
        args(),
      ),
    /50,000/,
  );
});
test("MCP TPO schema is read-only and preserves shared session/anchor validation", () => {
  const def = toolDefinitions().find((t) => t.name === "tpo_profile");
  assert.equal(def.action, "tpoProfile");
  assert.equal(def.capability, "read");
  const parsed = def.schema.parse({ sessionDate: "2026-01-01" });
  assert.equal(parsed.periodMinutes, 30);
  assert.equal(parsed.initialBalanceMinutes, 60);
  assert.equal(parsed.source, "imported");
  assert.equal(parsed.mode, "session");
  assert.throws(() => def.schema.parse({ ...parsed, periodMinutes: 0 }));
  assert.throws(() => def.schema.parse({ ...parsed, approximate: true }));
});
