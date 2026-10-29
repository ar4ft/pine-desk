import test from "node:test";
import assert from "node:assert/strict";
import { orderflow } from "../core/orderflow.js";
import { volumeProfile, profileSettings } from "../core/volume-profile.js";
import { tpoProfile } from "../core/tpo.js";
import { tradeSizeSettings } from "../core/trade-filter.js";
import { toolDefinitions } from "../core/mcp-tools.js";
const day = Date.UTC(2026, 0, 1),
  minute = 60000,
  hour = 60 * minute,
  D = 24 * hour;
const t = (offset, size = 1, price = 100, side = "buy") => ({
  time: day + offset,
  size,
  price,
  side,
});
const snapshot = (trades) => ({ symbol: "TEST", trades });
const anchored = { mode: "anchored", from: day, to: day + hour, tickSize: 1 };
const composite = {
  mode: "composite",
  sessionDate: "2026-01-01",
  sessionEndDate: "2026-01-03",
  sessionOpen: 22 * 60,
  sessionMinutes: 240,
  tickSize: 1,
};
test("size bounds apply inclusively to individual prints before volume, footprint and TPO aggregation", () => {
  const trades = [t(0, 1), t(1, 2), t(2, 3, 101, "sell"), t(3, 4, 102)];
  const settings = { minTradeSize: 2, maxTradeSize: 3 };
  const flow = orderflow(trades, { ...settings, tickSize: 1 });
  assert.equal(flow.totalTrades, 2);
  assert.equal(flow.buy, 2);
  assert.equal(flow.sell, 3);
  assert.equal(flow.filter.excludedTrades, 2);
  const volume = volumeProfile(snapshot(trades), { ...anchored, ...settings });
  assert.equal(volume.totalTrades, 2);
  assert.equal(volume.filter.observedTrades, 4);
  assert.equal(volume.coverage.observedTo, day + 3);
  const tpo = tpoProfile(snapshot(trades), { ...anchored, ...settings });
  assert.equal(tpo.totalTpos, 2);
  assert.equal(tpo.periods[0].observedTrades, 4);
  assert.equal(tpo.initialBalance.filter.excludedTrades, 2);
  assert.equal(tpo.initialBalance.high, 102);
  assert.equal(tpo.coverage.observedTo, day + 3);
  assert.equal(
    orderflow([t(0, 1), t(1, 1)], { minTradeSize: 2 }).totalTrades,
    0,
  );
});
test("all-filtered results remain empty without losing unfiltered coverage and gap evidence", () => {
  const snap = {
    ...snapshot([t(0), t(minute)]),
    gaps: [{ from: day + 2, to: day + 3 }],
  };
  const args = { ...anchored, minTradeSize: 2 };
  const flow = orderflow(snap.trades, args);
  assert.equal(flow.poc, null);
  assert.equal(flow.valueArea, null);
  assert.deepEqual(flow.bars, []);
  assert.equal(flow.from, day);
  assert.equal(flow.to, day + minute);
  const volume = volumeProfile(snap, args);
  assert.equal(volume.valueArea, null);
  assert.equal(volume.sessions[0].observedTrades, 2);
  assert.equal(volume.coverage.gaps.length, 1);
  const tpo = tpoProfile(snap, args);
  assert.equal(tpo.totalTpos, 0);
  assert.equal(tpo.initialBalance.low, null);
  assert.equal(tpo.initialBalance.coverage.observedFrom, day);
  assert.equal(tpo.periods[0].observedTrades, 2);
  assert.equal(tpo.periods[0].totalTrades, 0);
});
test("composite includes overnight windows, excludes exact ends and off-session gaps, retains empty sessions", () => {
  const snap = {
    ...snapshot([
      t(22 * hour - 1, 100),
      t(22 * hour, 2),
      t(D + hour, 3),
      t(D + 2 * hour, 100),
      t(D + 12 * hour, 100),
      t(D + 22 * hour, 4),
      t(2 * D + 2 * hour, 100),
    ]),
    gaps: [
      { from: day + D + 5 * hour, to: day + D + 6 * hour },
      { from: day + D + 23 * hour, to: day + 2 * D + hour },
    ],
  };
  const r = volumeProfile(snap, composite);
  assert.equal(r.totalTrades, 3);
  assert.equal(r.buy, 9);
  assert.equal(r.sessions.length, 3);
  assert.deepEqual(
    r.sessions.map((w) => w.totalTrades),
    [2, 1, 0],
  );
  assert.equal(r.coverage.gaps.length, 1);
  assert.equal(r.sessions[0].coverage.gaps.length, 0);
  assert.equal(r.sessions[1].coverage.gaps.length, 1);
  assert.equal(r.sessions[2].coverage.observedFrom, null);
  assert.equal(r.sessions[2].coverage.endsAfterRetained, true);
  assert.equal(r.settings.to, day + 3 * D + 2 * hour);
});
test("opening weekdays govern overnight sessions and absent dates cannot leak into a composite", () => {
  const r = volumeProfile(
    snapshot([
      t(22 * hour, 1),
      t(D + hour, 2),
      t(D + 22 * hour, 100),
      t(2 * D + 22 * hour, 3),
    ]),
    { ...composite, weekdays: [4, 6] },
  );
  assert.deepEqual(
    r.sessions.map((w) => w.sessionDate),
    ["2026-01-01", "2026-01-03"],
  );
  assert.equal(r.totalTrades, 3);
  assert.equal(r.buy, 6);
  assert.equal(r.filter.observedTrades, 3);
});
test("adjacent full-day sessions count shared boundaries once and composite POC uses summed volume", () => {
  const r = volumeProfile(
    snapshot([t(0, 8, 100), t(1, 1, 101), t(D, 1, 100), t(D + 1, 20, 101)]),
    {
      ...composite,
      sessionOpen: 0,
      sessionMinutes: 1440,
      sessionEndDate: "2026-01-02",
    },
  );
  assert.equal(r.totalTrades, 4);
  assert.deepEqual(
    r.sessions.map((w) => w.totalTrades),
    [2, 2],
  );
  assert.equal(r.valueArea.poc, 101);
  assert.equal(r.profile[0].buy, 21);
});
test("filter and composite errors are explicit, including calendar span and weekday validation", () => {
  for (const s of [
    { minTradeSize: -1 },
    { maxTradeSize: 0 },
    { minTradeSize: 3, maxTradeSize: 2 },
    { maxTradeSize: Infinity },
    { minTradeSize: "1" },
  ])
    assert.throws(() => tradeSizeSettings(s));
  for (const s of [
    { sessionEndDate: "2026-02-01" },
    { sessionEndDate: "2025-12-31" },
    { sessionEndDate: "2026-02-30" },
    { weekdays: [] },
    { weekdays: [1, 1] },
    { weekdays: [7] },
    { weekdays: [1] },
  ])
    assert.throws(() => profileSettings({ ...composite, ...s }));
  assert.equal(
    profileSettings({ ...composite, sessionEndDate: "2026-01-31" }).windows
      .length,
    31,
  );
  assert.throws(
    () => tpoProfile(snapshot([t(0)]), composite),
    /Composite mode is available for volume/,
  );
});
test("MCP exposes shared size filters and composite volume mode under read access", () => {
  for (const name of [
    "volume_profile",
    "tpo_profile",
    "order_flow",
    "live_order_flow",
  ]) {
    const tool = toolDefinitions().find((t) => t.name === name);
    assert.equal(tool.capability, "read");
    const settings = tool.schema.parse({
      ...(name.endsWith("order_flow") ? { timeframe: "1m", tickSize: 1 } : {}),
      minTradeSize: 2,
      maxTradeSize: 3,
    });
    assert.equal(settings.minTradeSize, 2);
    assert.equal(settings.maxTradeSize, 3);
  }
  const defs = toolDefinitions();
  assert.equal(
    defs.find((t) => t.name === "volume_profile").schema.parse(composite).mode,
    "composite",
  );
  assert.throws(() =>
    defs.find((t) => t.name === "tpo_profile").schema.parse(composite),
  );
});
