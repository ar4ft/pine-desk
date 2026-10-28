import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { BinanceDepth, DepthBook } from "../core/depth.js";
import { toolDefinitions } from "../core/mcp-tools.js";
const snap = (lastUpdateId = 100) => ({
  lastUpdateId,
  bids: [
    ["99", "2"],
    ["98", "3"],
  ],
  asks: [
    ["101", "4"],
    ["102", "1"],
  ],
});
const event = (U = 101, u = U, extra = {}) => ({
  e: "depthUpdate",
  s: "BTCUSDT",
  E: 100000,
  U,
  u,
  b: [],
  a: [],
  ...extra,
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  let now = 100000;
  const sockets = [],
    timers = new Map(),
    intervals = new Set(),
    requests = [];
  const depth = new BinanceDepth({
    now: () => now,
    clock: {
      setTimeout: (fn, ms) => {
        timers.set(fn, ms);
        return fn;
      },
      clearTimeout: (fn) => timers.delete(fn),
      setInterval: (fn) => {
        intervals.add(fn);
        return fn;
      },
      clearInterval: (fn) => intervals.delete(fn),
    },
    createSocket: (url) => {
      const socket = new EventEmitter();
      socket.url = url;
      socket.terminate = () => {
        socket.closed = true;
        socket.emit("close");
      };
      sockets.push(socket);
      return socket;
    },
    fetcher: (url, options) =>
      new Promise((resolve) => requests.push({ url, options, resolve })),
  });
  return {
    depth,
    sockets,
    timers,
    intervals,
    requests,
    advance: (ms) => {
      now += ms;
    },
    send: (data, socket = sockets.at(-1)) =>
      socket.emit("message", JSON.stringify(data)),
    retry: () => {
      const fn = timers.keys().next().value;
      timers.delete(fn);
      fn();
    },
    ready: async (snapshot = snap()) => {
      depth.start();
      sockets.at(-1).emit("open");
      requests.at(-1).resolve({ ok: true, json: async () => snapshot });
      await flush();
    },
  };
}
test("depth uses absolute quantities, deletes zero levels and computes bounded cumulative depth", () => {
  const book = new DepthBook(snap());
  assert.equal(
    book.apply(
      event(99, 101, {
        b: [
          ["99", "5"],
          ["97", "500"],
        ],
        a: [["101", "0"]],
      }),
    ),
    true,
  );
  const s = book.view(2);
  assert.deepEqual(s.bids, [
    { price: 99, size: 5, cumulative: 5 },
    { price: 98, size: 3, cumulative: 8 },
  ]);
  assert.equal(s.asks[0].price, 102);
  assert.equal(s.spread, 3);
  assert.equal(s.mid, 100.5);
  assert.equal(s.imbalance, 7 / 9);
  assert.equal(s.coverage.bidFloor, 98);
  assert.equal(book.apply(event(101, 101, { b: [["99", "1"]] })), false);
  assert.equal(book.view(1).bidSize, 5);
  assert.throws(() => book.apply(event(103)), /sequence gap/);
});
test("depth buffers events until REST snapshot, discards old events and requires a bridging update", async () => {
  const f = fixture();
  f.depth.start();
  f.sockets[0].emit("open");
  f.send(event(98, 100));
  f.send(event(100, 102, { b: [["99", "7"]] }));
  assert.equal(f.depth.snapshot().stale, true);
  f.requests[0].resolve({ ok: true, json: async () => snap() });
  await flush();
  assert.equal(f.depth.snapshot().lastUpdateId, 102);
  assert.equal(f.depth.snapshot().bids[0].size, 7);
  assert.equal(f.depth.snapshot().stale, false);
  assert.ok(f.requests[0].url.endsWith("symbol=BTCUSDT&limit=1000"));
  f.depth.stop();
  const g = fixture();
  await g.ready();
  assert.equal(g.depth.snapshot().status, "syncing");
  assert.equal(g.depth.snapshot().stale, true);
  g.send(event());
  assert.equal(g.depth.snapshot().status, "streaming");
  g.depth.stop();
});
test("sequence gaps clear all prices, reconnect with a new snapshot, and ignore retired sockets", async () => {
  const f = fixture();
  await f.ready();
  f.send(event());
  f.send(event(103));
  assert.equal(f.depth.snapshot().status, "reconnecting");
  assert.deepEqual(f.depth.snapshot().bids, []);
  assert.match(f.depth.snapshot().error, /sequence gap/);
  assert.equal(f.timers.size, 1);
  f.retry();
  f.sockets[1].emit("open");
  f.requests[1].resolve({ ok: true, json: async () => snap(110) });
  await flush();
  f.send(event(111), f.sockets[0]);
  assert.equal(f.depth.snapshot().stale, true);
  f.send(event(110, 112));
  assert.equal(f.depth.snapshot().lastUpdateId, 112);
  assert.equal(f.depth.snapshot().resyncs, 1);
  f.depth.stop();
  assert.equal(f.timers.size, 0);
  assert.equal(f.intervals.size, 0);
});
test("stale depth is hidden before watchdog reconnect; duplicate sequences do not freshen it", async () => {
  const f = fixture();
  await f.ready();
  f.send(event());
  f.advance(5001);
  f.send(event(101, 101, { E: 105001 }));
  assert.equal(f.depth.snapshot().stale, true);
  assert.equal(f.depth.snapshot().spread, null);
  f.advance(10000);
  for (const fn of f.intervals) fn();
  assert.equal(f.depth.snapshot().status, "reconnecting");
  assert.match(f.depth.snapshot().error, /timed out/);
  f.depth.stop();
});
test("bad timestamps, crossed or exhausted books, malformed levels and old REST snapshots resynchronize", async () => {
  for (const bad of [
    event(101, 101, { E: 90000 }),
    event(101, 101, { E: 110000 }),
    event(101, 101, { b: [["103", "1"]] }),
    event(101, 101, {
      b: [
        ["99", "0"],
        ["98", "0"],
      ],
    }),
    event(101, 101, { b: [["99", "-1"]] }),
    event(101, 100),
    event(102),
  ]) {
    const f = fixture();
    await f.ready();
    f.send(bad);
    assert.equal(f.depth.snapshot().status, "reconnecting");
    assert.deepEqual(f.depth.snapshot().bids, []);
    f.depth.stop();
  }
  const f = fixture();
  f.depth.start();
  f.sockets[0].emit("open");
  f.send(event(110));
  f.requests[0].resolve({ ok: true, json: async () => snap() });
  await flush();
  assert.match(f.depth.snapshot().error, /sequence gap/);
  f.depth.stop();
  for (const snapshot of [
    { ...snap(), bids: [] },
    {
      ...snap(),
      bids: [
        ["99", "1"],
        ["99", "2"],
      ],
    },
    { ...snap(), asks: [["90", "2"]] },
    { ...snap(), lastUpdateId: Infinity },
  ])
    assert.throws(() => new DepthBook(snapshot));
});
test("symbol switches and stop abort snapshots; late responses cannot resurrect a retired book", async () => {
  const f = fixture();
  f.depth.start();
  f.sockets[0].emit("open");
  assert.throws(() => f.depth.start({ symbol: "../invalid" }), /Binance spot/);
  f.depth.start();
  assert.equal(f.sockets.length, 1);
  f.depth.start({ symbol: "ETHUSDT" });
  assert.equal(f.requests[0].options.signal.aborted, true);
  f.sockets[1].emit("open");
  f.requests[0].resolve({ ok: true, json: async () => snap() });
  await flush();
  assert.equal(f.depth.snapshot().symbol, "ETHUSDT");
  assert.equal(f.depth.book, null);
  f.depth.stop();
  f.requests[1].resolve({ ok: true, json: async () => snap() });
  await flush();
  assert.equal(f.depth.snapshot().status, "stopped");
  assert.equal(f.depth.book, null);
});
test("network errors, buffer overflow and construction failures use bounded cancellable retries", async () => {
  const f = fixture();
  f.depth.start();
  f.sockets[0].emit("open");
  f.requests[0].resolve({ ok: false, status: 429 });
  await flush();
  assert.match(f.depth.snapshot().error, /429/);
  assert.equal([...f.timers.values()][0], 1000);
  for (let i = 0; i < 7; i++) {
    f.retry();
    f.sockets.at(-1).emit("error", Error("offline"));
  }
  assert.equal([...f.timers.values()][0], 30000);
  f.depth.stop();
  const g = fixture();
  g.depth.start();
  g.sockets[0].emit("open");
  for (let i = 0; i < 2001; i++) g.send(event());
  assert.match(g.depth.snapshot().error, /buffer full/);
  g.depth.stop();
  const h = fixture();
  h.depth.createSocket = () => {
    throw Error("No network");
  };
  h.depth.start();
  assert.match(h.depth.snapshot().error, /No network/);
  assert.equal(h.timers.size, 1);
  h.depth.stop();
});
test("depth MCP tools separate read from stream authority and reject invalid limits/symbols", () => {
  const tools = Object.fromEntries(
    toolDefinitions()
      .filter((t) => t.name.startsWith("depth_"))
      .map((t) => [t.name, t]),
  );
  assert.equal(tools.depth_snapshot.capability, "read");
  assert.equal(tools.depth_start.capability, "streams");
  assert.equal(tools.depth_stop.capability, "streams");
  assert.throws(() => tools.depth_start.schema.parse({ symbol: "btc/usdt" }));
  for (const limit of [0, 101, 1.5, "20"]) {
    assert.throws(() => tools.depth_snapshot.schema.parse({ limit }));
    assert.throws(() => new BinanceDepth().snapshot({ limit }));
  }
  assert.throws(() =>
    tools.depth_start.schema.parse({
      symbol: "BTCUSDT",
      endpoint: "http://untrusted",
    }),
  );
});
