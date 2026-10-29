import test from "node:test";
import assert from "node:assert/strict";
import { profileSettings, volumeProfile } from "../core/volume-profile.js";
import { toolDefinitions } from "../core/mcp-tools.js";
const day = Date.UTC(2026, 0, 1),
  hour = 3600000;
const t = (time, price = 100, size = 1, side = "buy") => ({
  time,
  price,
  size,
  side,
});
const snapshot = (trades) => ({ trades, symbol: "TEST", origin: "Fixture" });
const anchored = (from, to, extra = {}) => ({
  mode: "anchored",
  from,
  to,
  tickSize: 1,
  ...extra,
});
test("anchored profile includes exact start and excludes exact end, without rounding to bars", () => {
  const r = volumeProfile(
    snapshot([
      t(day),
      t(day + 1, 101, 4),
      t(day + 2, 102, 3, "sell"),
      t(day + 3, 103, 10),
    ]),
    anchored(day + 1, day + 3),
  );
  assert.equal(r.totalTrades, 2);
  assert.equal(r.buy, 4);
  assert.equal(r.sell, 3);
  assert.equal(r.delta, 1);
  assert.deepEqual(
    r.profile.map((l) => l.price),
    [102, 101],
  );
  assert.equal(r.coverage.observedFrom, day + 1);
  assert.equal(r.coverage.observedTo, day + 2);
  assert.equal(r.symbol, "TEST");
  assert.equal(r.origin, "Fixture");
});
test("UTC overnight session uses opening date and fixed duration across DST dates", () => {
  const args = {
    mode: "session",
    sessionDate: "2026-03-08",
    sessionOpen: 22 * 60,
    sessionMinutes: 480,
    tickSize: 1,
  };
  const c = profileSettings(args);
  assert.equal(c.from, Date.UTC(2026, 2, 8, 22));
  assert.equal(c.to, Date.UTC(2026, 2, 9, 6));
  assert.equal(c.to - c.from, 8 * hour);
  assert.equal(c.timezone, "UTC");
  const r = volumeProfile(
    snapshot([t(c.from - 1), t(c.from), t(c.to - 1), t(c.to)]),
    args,
  );
  assert.equal(r.totalTrades, 2);
  const next = profileSettings({ ...args, sessionDate: "2026-03-09" });
  assert.equal(next.from - c.from, 24 * hour);
});
test("coverage keeps overlapping/open gaps and does not invent missing volume", () => {
  const r = volumeProfile(
    {
      ...snapshot([t(day + 1), t(day + 10)]),
      gaps: [
        { from: day - 5, to: day - 1 },
        { from: day + 2, to: day + 3 },
        { from: day + 4, to: null },
        { from: day + 20, to: null },
      ],
    },
    anchored(day, day + 20),
  );
  assert.equal(r.coverage.startsBeforeRetained, true);
  assert.equal(r.coverage.endsAfterRetained, true);
  assert.equal(r.coverage.gaps.length, 2);
  assert.equal(r.totalTrades, 2);
  assert.match(r.coverage.note, /do not establish complete/);
});
test("empty requested window returns zero totals, null value area and original retained coverage", () => {
  const r = volumeProfile(
    snapshot([t(day)]),
    anchored(day + hour, day + 2 * hour),
  );
  assert.equal(r.totalTrades, 0);
  assert.equal(r.valueArea, null);
  assert.deepEqual(r.profile, []);
  assert.equal(r.coverage.observedFrom, null);
  assert.equal(r.coverage.retainedFrom, day);
});
test("profile shares decimal bucketing and sparse value area tie rules with footprints", () => {
  const r = volumeProfile(
    snapshot([t(day, 0.1), t(day + 1, 0.3), t(day + 2, 1000000)]),
    anchored(day, day + 3, { tickSize: 0.1, valueAreaPercent: 50 }),
  );
  assert.deepEqual(
    r.profile.map((l) => l.index),
    [10000000, 3, 1],
  );
  assert.equal(r.valueArea.poc, 1000000);
  assert.equal(r.valueArea.low, 0.3);
  assert.equal(r.valueArea.high, 1000000.1);
  assert.equal(r.valueArea.volume, 2);
});
test("settings reject malformed calendar dates, invalid boundaries and unknown modes", () => {
  for (const sessionDate of [
    "2026-02-30",
    "2026-2-01",
    "invalid",
    "1969-01-01",
  ])
    assert.throws(() => profileSettings({ sessionDate }));
  for (const extra of [
    { from: day, to: day },
    { from: NaN, to: day },
    { from: day, to: Infinity },
    { from: day + 0.5, to: day + 2 },
    { tickSize: 0 },
    { valueAreaPercent: 101 },
    { mode: "constructor" },
    { source: "other" },
  ])
    assert.throws(() => profileSettings(anchored(day, day + 1, extra)));
  for (const extra of [
    { sessionOpen: 1440 },
    { sessionMinutes: 0 },
    { sessionMinutes: 1441 },
    { sessionMinutes: 1.5 },
  ])
    assert.throws(() =>
      profileSettings({ sessionDate: "2026-01-01", ...extra }),
    );
});
test("profile rejects unbounded row counts and nonfinite totals", () => {
  assert.throws(
    () =>
      volumeProfile(
        snapshot(Array.from({ length: 50001 }, (_, i) => t(day, i + 1))),
        anchored(day, day + 1),
      ),
    /50,000/,
  );
  assert.throws(
    () =>
      volumeProfile(
        snapshot([t(day, 1, 1e308), t(day, 1, 1e308)]),
        anchored(day, day + 1),
      ),
    /capacity/,
  );
  assert.throws(
    () => volumeProfile(snapshot([t(day, 1e20)]), anchored(day, day + 1)),
    /too small/,
  );
});
test("MCP profile tool is read-only, with strict source and boundary schema", () => {
  const def = toolDefinitions().find((t) => t.name === "volume_profile");
  assert.equal(def.action, "volumeProfile");
  assert.equal(def.capability, "read");
  assert.equal(def.readOnly, true);
  const c = def.schema.parse(anchored(day, day + 1));
  assert.equal(c.source, "imported");
  assert.throws(() => def.schema.parse({ ...c, from: "2026-01-01" }));
  assert.throws(() => def.schema.parse({ ...c, source: "external" }));
  assert.throws(() => def.schema.parse({ ...c, unknown: 1 }));
});

test("service uses the saved snapshot or owning live buffer and preserves gap provenance", async (ctx) => {
  const fs = await import("node:fs/promises"),
    os = await import("node:os"),
    path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pd-profile-service-"));
  process.env.PINE_DESK_DATA_DIR = dir;
  const { dispatch, live, shutdown } = await import("../core/service.js");
  const store = await import("../core/store.js");
  ctx.after(async () => {
    await shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });
  await assert.rejects(
    dispatch("volumeProfile", anchored(day, day + 10)),
    /Import or save/,
  );
  const args = anchored(day, day + 10);
  await store.write("trades", {
    ...snapshot([t(day), t(day + 1)]),
    gaps: [{ from: day + 2, to: day + 3, reason: "saved interruption" }],
  });
  const saved = await dispatch("volumeProfile", args);
  assert.equal(saved.coverage.gaps[0].reason, "saved interruption");
  assert.equal(saved.totalTrades, 2);
  live.trades = [t(day), t(day + 1), t(day + 2)];
  live.maxTrades = 2;
  live.state.symbol = "LIVE";
  const result = await dispatch("volumeProfile", { ...args, source: "live" });
  assert.equal(result.totalTrades, 2);
  assert.equal(result.symbol, "LIVE");
  assert.equal(result.coverage.retainedFrom, day + 1);
  assert.equal(live.snapshot().active, false);
  assert.equal((await dispatch("volumeProfile", args)).symbol, "TEST");
});
