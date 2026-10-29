import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  DepthHistory,
  DepthRecorder,
  validateDepthFrame,
} from "../core/depth-history.js";
import { depthHeatmap } from "../core/depth-heatmap.js";
import { toolDefinitions } from "../core/mcp-tools.js";
export function memoryStore() {
  const files = new Map();
  return {
    files,
    read: async (k, id) => structuredClone(files.get(`${k}/${id}`) ?? null),
    write: async (k, v, id) => {
      files.set(`${k}/${id}`, structuredClone(v));
      return v;
    },
    list: async (k) =>
      [...files]
        .filter(([key]) => key.startsWith(k + "/"))
        .map(([, v]) => structuredClone(v)),
    remove: async (k, id) => {
      files.delete(`${k}/${id}`);
    },
    writeCompressed: async (k, v, id) => {
      files.set(`${k}/${id}`, gzipSync(JSON.stringify(v)));
    },
    readCompressed: async (k, id) => {
      const bytes = files.get(`${k}/${id}`);
      return bytes ? JSON.parse(gunzipSync(bytes)) : null;
    },
    removeCompressed: async (k, id) => {
      files.delete(`${k}/${id}`);
    },
  };
}
function setup(options = {}) {
  let now = 100000;
  const storage = memoryStore(),
    timers = new Set();
  const history = new DepthHistory({ storage, now: () => now, ...options });
  const depth = {
    active: true,
    symbol: "BTCUSDT",
    status: "streaming",
    connection: 1,
    stale: false,
    snapshot({ limit }) {
      return {
        provider: "binance",
        assetType: "spot",
        symbol: this.symbol,
        stale: this.stale,
        lastUpdateId: now,
        connection: this.connection,
        eventAt: now,
        receivedAt: now,
        status: this.status,
        bids: [
          { price: 99, size: 2, cumulative: 2 },
          { price: 98, size: 3, cumulative: 5 },
        ].slice(0, limit),
        asks: [
          { price: 101, size: 1, cumulative: 1 },
          { price: 102, size: 4, cumulative: 5 },
        ].slice(0, limit),
        mid: 100,
        spread: 2,
        coverage: { bidFloor: 98, askCeiling: 102 },
      };
    },
  };
  const recorder = new DepthRecorder({
    history,
    depth,
    now: () => now,
    clock: {
      setTimeout: (fn) => {
        timers.add(fn);
        return fn;
      },
      clearTimeout: (fn) => timers.delete(fn),
    },
  });
  return {
    history,
    storage,
    recorder,
    depth,
    timers,
    advance: (ms = 1000) => {
      now += ms;
    },
    sample: async (ms = 1000) => {
      now += ms;
      await recorder.serial(() => recorder.capture());
    },
  };
}
test("depth archives commit first sample, batch subsequent frames, flush on stop and replay exact quantities", async () => {
  const f = setup();
  await f.recorder.start({ name: "BTC test", levels: 20 });
  const id = f.recorder.status().meta.id;
  assert.equal(f.recorder.status().meta.count, 1);
  for (let i = 0; i < 9; i++) await f.sample();
  assert.equal(f.recorder.status().pending, 9);
  assert.equal((await f.history.get({ id })).frames.length, 1);
  await f.sample();
  assert.equal(f.recorder.status().meta.count, 11);
  await f.sample();
  await f.recorder.stop();
  assert.equal(f.recorder.status().pending, 0);
  assert.equal(f.timers.size, 0);
  const result = await f.history.get({ id, offset: 1, limit: 10 });
  assert.equal(result.frames.length, 10);
  assert.equal(result.frames[0].at, 101000);
  assert.equal(result.frames[9].at, 110000);
  assert.equal(result.frames[0].book.bids[0].size, 2);
  assert.equal(result.meta.status, "stopped");
  assert.equal(f.depth.active, true);
  await f.history.remove(id);
  assert.equal((await f.history.list()).length, 0);
  assert.equal(f.storage.files.size, 0);
});
test("gaps preserve stale observations, reset boundaries, missed samples and symbol isolation", async () => {
  const f = setup();
  await f.recorder.start();
  const id = f.recorder.status().meta.id;
  f.depth.stale = true;
  await f.sample();
  f.depth.stale = false;
  f.depth.connection++;
  await f.sample();
  f.depth.connection++;
  await f.sample();
  await f.sample(30000);
  await f.recorder.stop();
  const { frames } = await f.history.get({ id });
  assert.equal(frames[1].book, null);
  assert.match(frames[1].reason, /no fresh/);
  assert.match(frames[3].gapBefore.reason, /resynchronized/);
  assert.equal(frames[4].gapBefore.to - frames[4].gapBefore.from, 29000);
  const h = setup();
  await h.recorder.start();
  h.depth.symbol = "ETHUSDT";
  await h.sample();
  assert.equal(h.recorder.status().active, false);
  assert.equal(h.recorder.status().meta.count, 1);
  assert.match(h.recorder.status().meta.reason, /changed symbol/);
});
test("restart marks unclosed recordings interrupted and never invents uncommitted samples", async () => {
  const f = setup();
  await f.recorder.start();
  const id = f.recorder.status().meta.id;
  await f.sample();
  const reopened = new DepthHistory({ storage: f.storage });
  const records = await reopened.list();
  assert.equal(records[0].status, "interrupted");
  assert.equal(records[0].count, 1);
  assert.equal((await reopened.get({ id })).frames.length, 1);
  // Simulated owner died; do not finalize its pending memory after reopening.
});
test("write failures stop recording, hide uncommitted chunks and retain saved samples", async () => {
  const f = setup();
  await f.recorder.start();
  const id = f.recorder.status().meta.id;
  const write = f.storage.write;
  f.storage.write = async (k, v, id) => {
    if (k === "depth-recordings" && v.count > 1) throw Error("Disk full");
    return write(k, v, id);
  };
  for (let i = 0; i < 10; i++) await f.sample();
  assert.equal(f.recorder.status().active, false);
  assert.match(f.recorder.status().error, /Disk full/);
  assert.equal(f.recorder.status().pending, 0);
  assert.equal(f.depth.active, true);
  assert.equal((await f.history.get({ id })).frames.length, 1);
  assert.equal(
    [...f.storage.files.keys()].filter((k) => k.startsWith("depth-frames/"))
      .length,
    1,
  );
});
test("count and byte quotas preserve archives; corrupt chunks and invalid ranges fail explicitly", async () => {
  const f = setup({ maxSessions: 1 });
  await f.recorder.start();
  const id = f.recorder.status().meta.id;
  await assert.rejects(f.history.remove(id), /Stop this recording/);
  await f.recorder.stop();
  await assert.rejects(f.recorder.start(), /archive is full/);
  for (const args of [
    { id, limit: 601 },
    { id, offset: -1 },
    { id, offset: 2 },
    { id: "../other" },
  ])
    await assert.rejects(f.history.get(args));
  const meta = (await f.history.list())[0],
    key = `depth-frames/${meta.chunks[0].id}`;
  const chunk = await f.storage.readCompressed(
    "depth-frames",
    meta.chunks[0].id,
  );
  chunk.frames[0].book.bids[0].size = 999;
  f.storage.files.set(key, gzipSync(JSON.stringify(chunk)));
  await assert.rejects(f.history.get({ id }), /integrity/);
  const g = setup({ maxBytes: 1 });
  await g.recorder.start();
  assert.equal(g.recorder.status().active, false);
  assert.match(g.recorder.status().error, /storage limit/);
  assert.equal(g.recorder.status().meta.count, 0);
});
test("recording validation rejects cross-market, future, unordered books and backwards clocks", async () => {
  const f = setup();
  await f.recorder.start();
  const meta = f.recorder.status().meta;
  const frame = {
    at: 100000,
    gapBefore: null,
    reason: null,
    book: f.depth.snapshot({ limit: 50 }),
  };
  for (const mutate of [
    (b) => (b.symbol = "ETHUSDT"),
    (b) => (b.eventAt = 120000),
    (b) => b.bids.reverse(),
    (b) => (b.bids[0].size = -1),
    (b) => (b.asks[0].price = 90),
  ]) {
    const copy = structuredClone(frame);
    mutate(copy.book);
    assert.throws(() => validateDepthFrame(copy, meta));
  }
  f.advance(-1000);
  await f.recorder.serial(() => f.recorder.capture());
  assert.equal(f.recorder.status().active, false);
  assert.match(f.recorder.status().meta.reason, /clock moved backwards/);
  const g = setup();
  await assert.rejects(g.recorder.start({ intervalSeconds: 0 }));
  g.depth.active = false;
  await assert.rejects(g.recorder.start(), /Start a Binance depth/);
});
test("heatmap uses real time, aggregates each side separately and never fills reset or sampling gaps", async () => {
  const f = setup();
  await f.recorder.start();
  f.depth.connection++;
  await f.sample();
  f.depth.stale = true;
  await f.sample();
  f.depth.stale = false;
  await f.sample(10000);
  await f.recorder.stop();
  const record = await f.history.get({ id: f.recorder.status().meta.id }),
    map = depthHeatmap(record, { rows: 10 });
  assert.equal(map.from, 100000);
  assert.equal(map.to, 113000);
  assert.equal(map.low, 98);
  assert.equal(map.high, 102);
  assert.equal(map.peak, 4);
  assert.ok(map.gaps.some((g) => g.from === 103000 && g.to === 112000));
  assert.equal(map.cells.filter((c) => c.index === 2).length, 0);
  assert.ok(
    map.cells.filter((c) => c.index === 0).every((c) => c.to === c.from),
  );
  assert.ok(map.cells.some((c) => c.side === "bids" && c.size === 3));
  assert.throws(() => depthHeatmap(record, { rows: 0 }));
});
test("recording tools separate read, stream management and destructive archive access", () => {
  const tools = Object.fromEntries(toolDefinitions().map((t) => [t.name, t]));
  for (const name of [
    "depth_record_status",
    "depth_recordings",
    "depth_recording_get",
  ])
    assert.equal(tools[name].capability, "read");
  for (const name of ["depth_record_start", "depth_record_stop"])
    assert.equal(tools[name].capability, "streams");
  assert.equal(tools.depth_recording_delete.capability, "research");
  assert.throws(() =>
    tools.depth_record_start.schema.parse({ intervalSeconds: 3 }),
  );
  assert.throws(() =>
    tools.depth_recording_get.schema.parse({ id: "x", limit: 1000 }),
  );
});

test("recorder stops at 3600 samples and flushes the final partial chunk", async () => {
  const f = setup();
  await f.recorder.start();
  for (let i = 1; i < 3600; i++) await f.sample();
  const status = f.recorder.status();
  assert.equal(status.active, false);
  assert.equal(status.meta.count, 3600);
  assert.equal(status.meta.status, "complete");
  assert.equal(status.pending, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(status.meta.chunks.length, 361);
  const last = await f.history.get({ id: status.meta.id, limit: 2 });
  assert.equal(last.offset, 3598);
  assert.equal(last.frames.length, 2);
});
