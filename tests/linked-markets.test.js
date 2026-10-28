import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { ChartPanels } from "../core/chart-panels.js";
import { MarketQuotes, MarketSearch } from "../core/market-quotes.js";
import { chartLayout } from "../core/chart-layout.js";
import { validateLayout } from "../core/workspace-ui.js";
import { demoBars } from "../core/data.js";
const dataset = (symbol = "BTCUSDT", timeframe = "1h") => ({
  symbol,
  timeframe,
  origin: "Binance fixture",
  bars: demoBars().slice(-20),
});
class FakeLive {
  constructor() {
    this.active = false;
    this.stops = 0;
    this.starts = 0;
  }
  async start(args) {
    this.args = args;
    this.active = true;
    this.starts++;
  }
  stop() {
    this.active = false;
    this.stops++;
  }
  snapshot() {
    return {
      ...this.args,
      active: this.active,
      status: this.active ? "streaming" : "stopped",
      dataset: this.args
        ? dataset(this.args.symbol, this.args.timeframe)
        : null,
    };
  }
}
test("comparison charts share subscriptions, reuse primary and release only unused streams", async () => {
  const primary = new FakeLive(),
    streams = [],
    requests = [];
  const pool = new ChartPanels({
    primary,
    createLive: () => {
      const live = new FakeLive();
      streams.push(live);
      return live;
    },
    fetchHistory: async (r) => {
      requests.push(r);
      return dataset(r.symbol, r.timeframe);
    },
  });
  const panels = ["compare-1", "compare-2"].map((id) => ({
    id,
    symbol: "ETHUSDT",
    timeframe: "1h",
    live: true,
  }));
  await pool.configure(panels);
  assert.equal(streams.length, 1);
  await pool.configure(panels.slice(1));
  assert.equal(streams[0].stops, 0);
  await primary.start(panels[0]);
  assert.equal(pool.snapshot()[0].sharedWithPrimary, true);
  assert.equal(streams[0].stops, 1);
  primary.stop();
  assert.equal(pool.snapshot()[0].sharedWithPrimary, false);
  assert.equal(streams.length, 2);
  const result = await pool.configure([{ ...panels[0], live: false }]);
  assert.equal(streams[1].stops, 1);
  assert.equal(result[0].active, false);
  assert.equal(requests.length, 1);
  assert.equal(result[0].dataset.symbol, "ETHUSDT");
  await pool.configure([]);
  assert.equal(pool.entries.size, 0);
  assert.equal(primary.stops, 1);
});
test("comparison validation is atomic; shared history failures are explicit and can retry", async () => {
  let calls = 0;
  const pool = new ChartPanels({
    fetchHistory: async (r) => {
      if (++calls === 1) throw Error("offline");
      return dataset(r.symbol, r.timeframe);
    },
  });
  const p = {
    id: "compare-1",
    symbol: "BTCUSDT",
    timeframe: "1h",
    live: false,
  };
  assert.equal((await pool.configure([p]))[0].error, "offline");
  assert.equal((await pool.configure([p]))[0].status, "snapshot");
  await assert.rejects(pool.configure([p, p]), /duplicate/);
  assert.equal(pool.snapshot().length, 1);
  await assert.rejects(
    pool.configure([{ ...p, symbol: "../../secret" }]),
    /Binance/,
  );
  pool.stop();
});
test("removed panel cannot be resurrected by late history responses", async () => {
  let resolve;
  const pool = new ChartPanels({
    fetchHistory: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const load = pool.configure([
    { id: "compare-1", symbol: "ETHUSDT", timeframe: "1h", live: false },
  ]);
  await pool.configure([]);
  resolve(dataset("ETHUSDT"));
  assert.deepEqual(await load, []);
  assert.equal(pool.entries.size, 0);
});
function quoteFixture() {
  let now = 100000;
  const sockets = [],
    timers = new Set();
  const quotes = new MarketQuotes({
    now: () => now,
    clock: {
      setTimeout: (fn) => {
        timers.add(fn);
        return fn;
      },
      clearTimeout: (fn) => timers.delete(fn),
      setInterval: () => 1,
      clearInterval: () => {},
    },
    createSocket: (url) => {
      const socket = new EventEmitter();
      socket.url = url;
      socket.terminate = () => socket.emit("close");
      sockets.push(socket);
      return socket;
    },
  });
  return {
    quotes,
    sockets,
    timers,
    advance: () => {
      now += 31000;
    },
  };
}
test("live watchlist validates, deduplicates, rejects old/invalid quotes and exposes per-symbol staleness", () => {
  const { quotes, sockets, advance } = quoteFixture();
  quotes.start(["BTCUSDT", "ETHUSDT", "BTCUSDT"]);
  quotes.start(["ETHUSDT", "BTCUSDT"]);
  assert.equal(sockets.length, 1);
  const emit = (data) => sockets[0].emit("message", JSON.stringify({ data }));
  sockets[0].emit("open");
  emit({ e: "24hrTicker", s: "BTCUSDT", E: 100000, c: "50000", P: "2.1" });
  emit({ e: "24hrTicker", s: "BTCUSDT", E: 99999, c: "1", P: "0" });
  emit({ e: "24hrTicker", s: "BTCUSDT", E: 100001, c: "Infinity", P: "0" });
  assert.equal(quotes.snapshot().quotes.BTCUSDT.price, 50000);
  assert.equal(quotes.snapshot().quotes.BTCUSDT.stale, false);
  advance();
  emit({ e: "24hrTicker", s: "ETHUSDT", E: 131000, c: "2000", P: "-1" });
  assert.equal(quotes.snapshot().quotes.BTCUSDT.stale, true);
  assert.equal(quotes.snapshot().quotes.ETHUSDT.stale, false);
  assert.throws(() => quotes.start(["invalid/path"]), /50 Binance/);
  assert.equal(quotes.snapshot().active, true);
  quotes.stop();
  assert.equal(quotes.snapshot().quotes.ETHUSDT.stale, true);
});
test("watchlist reconnects with bounded backoff and ignores old sockets after reconfiguration", () => {
  const { quotes, sockets, timers } = quoteFixture();
  quotes.start(["BTCUSDT"]);
  sockets[0].emit("error", Error("network"));
  assert.equal(quotes.snapshot().status, "reconnecting");
  assert.equal(timers.size, 1);
  quotes.start(["ETHUSDT"]);
  assert.equal(timers.size, 0);
  sockets[0].emit(
    "message",
    JSON.stringify({
      e: "24hrTicker",
      s: "ETHUSDT",
      E: 100000,
      c: "12",
      P: "0",
    }),
  );
  assert.deepEqual(quotes.snapshot().quotes, {});
  quotes.stop();
  assert.equal(timers.size, 0);
});
test("market search caches bounded, trading-only spot results and surfaces provider errors", async () => {
  let calls = 0;
  const search = new MarketSearch({
    fetcher: async () => {
      calls++;
      return {
        ok: true,
        json: async () => ({
          symbols: [
            {
              symbol: "BTCUSDT",
              baseAsset: "BTC",
              quoteAsset: "USDT",
              status: "TRADING",
              isSpotTradingAllowed: true,
            },
            { symbol: "BTCOLD", baseAsset: "BTC", status: "BREAK" },
            {
              symbol: "BTCFUT",
              baseAsset: "BTC",
              status: "TRADING",
              isSpotTradingAllowed: false,
            },
          ],
        }),
      };
    },
  });
  assert.equal((await search.search("btc")).markets.length, 1);
  assert.equal((await search.search("BTCUSDT")).markets[0].provider, "binance");
  assert.equal(calls, 1);
  const offline = new MarketSearch({
    fetcher: async () => ({ ok: false, status: 451 }),
  });
  await assert.rejects(offline.search("BTC"), /451/);
});
test("named layouts validate comparison snapshots and discard live intent", () => {
  const layout = chartLayout();
  layout.count = 4;
  layout.panels[0].dataset = dataset("ETHUSDT");
  layout.panels[0].live = true;
  const input = {
    name: "Research grid",
    snapshot: {
      page: "workspace",
      source: "",
      editor: true,
      multiChart: layout,
    },
  };
  const saved = validateLayout(input);
  assert.equal(saved.snapshot.multiChart.count, 4);
  assert.equal(saved.snapshot.multiChart.panels[0].dataset.symbol, "ETHUSDT");
  assert.equal(saved.snapshot.multiChart.panels[0].live, undefined);
  layout.panels[0].dataset.symbol = "BTCUSDT";
  assert.throws(() => validateLayout(input), /does not match/);
  layout.count = 3;
  assert.throws(() => chartLayout(layout), /Invalid linked/);
});

test("default comparison history adapter wraps real REST candles with market identity", async (t) => {
  const bars = demoBars().slice(-3);
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () =>
      bars.map((b) => [
        b.time,
        String(b.open),
        String(b.high),
        String(b.low),
        String(b.close),
        String(b.volume),
        b.time + 3599999,
      ]),
  }));
  const pool = new ChartPanels();
  const snapshots = await pool.configure([
    { id: "compare-1", symbol: "ETHUSDT", timeframe: "1h", live: false },
  ]);
  assert.equal(snapshots[0].error, null);
  assert.equal(snapshots[0].dataset.symbol, "ETHUSDT");
  assert.equal(snapshots[0].dataset.bars.length, 3);
  assert.equal(snapshots[0].dataset.bars[0].close, bars[0].close);
  pool.stop();
});
