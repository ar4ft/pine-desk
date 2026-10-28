import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";

const SNAPSHOT_LEVELS = 1000;
const MAX_LEVELS = 10000;
const STALE_MS = 5000;
const number = (value) => {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value))
    throw Error("Invalid depth price or quantity.");
  const n = Number(value);
  if (!Number.isFinite(n)) throw Error("Invalid depth price or quantity.");
  return n;
};
function levels(input, max) {
  if (!Array.isArray(input) || input.length > max)
    throw Error("Invalid depth levels.");
  return input.map((row) => {
    if (!Array.isArray(row) || row.length !== 2)
      throw Error("Invalid depth level.");
    const price = number(row[0]),
      size = number(row[1]);
    if (price <= 0) throw Error("Invalid depth price.");
    return [price, size];
  });
}
function updateId(id) {
  if (!Number.isSafeInteger(id) || id < 0)
    throw Error("Invalid depth sequence ID.");
  return id;
}
export function depthSymbol(symbol) {
  if (typeof symbol !== "string" || !/^[A-Z0-9]{3,24}$/.test(symbol))
    throw Error("Choose a Binance spot symbol, such as BTCUSDT.");
  return symbol;
}
export function depthLimit(limit = 20) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw Error("Choose 1–100 order-book levels per side.");
  return limit;
}

// Track only the price range covered by the REST snapshot. Unchanged levels
// beyond that range are unknown, so isolated updates there must not look complete.
export class DepthBook {
  constructor(snapshot) {
    this.lastUpdateId = updateId(snapshot.lastUpdateId);
    for (const side of ["bids", "asks"]) {
      const rows = levels(snapshot[side], SNAPSHOT_LEVELS);
      if (
        !rows.length ||
        rows.some(
          ([p, q], i) =>
            q <= 0 ||
            (i &&
              (side === "bids" ? p >= rows[i - 1][0] : p <= rows[i - 1][0])),
        )
      )
        throw Error("Invalid or empty depth snapshot.");
      this[side] = new Map(rows);
    }
    this.bidFloor = Math.min(...this.bids.keys());
    this.askCeiling = Math.max(...this.asks.keys());
    this.check();
  }
  check() {
    if (!this.bids.size || !this.asks.size)
      throw Error("Known depth range exhausted; resynchronizing.");
    if (this.bids.size > MAX_LEVELS || this.asks.size > MAX_LEVELS)
      throw Error("Depth capacity reached; resynchronizing.");
    if (Math.max(...this.bids.keys()) >= Math.min(...this.asks.keys()))
      throw Error("Crossed order book; resynchronizing.");
  }
  apply(event) {
    const first = updateId(event.U),
      last = updateId(event.u);
    if (first > last) throw Error("Invalid depth sequence range.");
    if (last <= this.lastUpdateId) return false;
    if (first > this.lastUpdateId + 1)
      throw Error("Depth sequence gap; resynchronizing.");
    const bids = levels(event.b, MAX_LEVELS),
      asks = levels(event.a, MAX_LEVELS);
    for (const [side, rows] of [
      ["bids", bids],
      ["asks", asks],
    ])
      for (const [price, size] of rows) {
        if (side === "bids" ? price < this.bidFloor : price > this.askCeiling)
          continue;
        if (size === 0) this[side].delete(price);
        else this[side].set(price, size);
      }
    this.check();
    this.lastUpdateId = last;
    return true;
  }
  view(limit) {
    const side = (name) => {
      let cumulative = 0;
      return [...this[name]]
        .sort((a, b) => (name === "bids" ? b[0] - a[0] : a[0] - b[0]))
        .slice(0, limit)
        .map(([price, size]) => ({
          price,
          size,
          cumulative: (cumulative += size),
        }));
    };
    const bids = side("bids"),
      asks = side("asks");
    const bidSize = bids.at(-1).cumulative,
      askSize = asks.at(-1).cumulative;
    const mid = (bids[0].price + asks[0].price) / 2;
    const spread = asks[0].price - bids[0].price;
    return {
      bids,
      asks,
      mid,
      spread,
      spreadBps: (spread / mid) * 10000,
      imbalance: (bidSize - askSize) / (bidSize + askSize),
      bidSize,
      askSize,
      lastUpdateId: this.lastUpdateId,
      coverage: {
        bidFloor: this.bidFloor,
        askCeiling: this.askCeiling,
        bidLevels: this.bids.size,
        askLevels: this.asks.size,
        snapshotLevels: SNAPSHOT_LEVELS,
      },
    };
  }
}

export class BinanceDepth {
  constructor({
    fetcher = fetch,
    createSocket,
    now = Date.now,
    clock = globalThis,
  } = {}) {
    this.fetcher = fetcher;
    this.createSocket =
      createSocket ??
      ((url) =>
        new WebSocket(url, {
          ...(process.env.HTTPS_PROXY
            ? { agent: new HttpsProxyAgent(process.env.HTTPS_PROXY) }
            : {}),
          handshakeTimeout: 15000,
          maxPayload: 2_000_000,
        }));
    this.now = now;
    this.clock = clock;
    this.generation = 0;
    this.status = "stopped";
    this.active = false;
    this.resyncs = 0;
  }
  start({ symbol = "BTCUSDT" } = {}) {
    depthSymbol(symbol);
    if (this.active && this.symbol === symbol) return this.snapshot();
    this.stop();
    this.symbol = symbol;
    this.active = true;
    this.error = null;
    this.resyncs = 0;
    this.retries = 0;
    this.connect(this.generation);
    this.watchdog = this.clock.setInterval(() => {
      if (
        this.socket &&
        this.now() - (this.receivedAt ?? this.connectedAt) > 15000
      )
        this.fail("Depth feed timed out; resynchronizing.");
    }, 1000);
    this.watchdog?.unref?.();
    return this.snapshot();
  }
  connect(generation) {
    if (!this.active || generation !== this.generation) return;
    this.status = "connecting";
    this.connectedAt = this.now();
    this.book = null;
    this.receivedAt = this.eventAt = null;
    this.controller = new AbortController();
    let socket;
    try {
      socket = this.createSocket(
        `wss://data-stream.binance.vision/ws/${this.symbol.toLowerCase()}@depth@100ms`,
      );
    } catch (error) {
      this.fail(error.message);
      return;
    }
    this.socket = socket;
    const current = () =>
      this.active && generation === this.generation && socket === this.socket;
    let buffering = true,
      buffer = [],
      bufferedBytes = 0;
    socket.on("open", async () => {
      if (!current()) return;
      this.status = "syncing";
      try {
        const response = await this.fetcher(
          `https://data-api.binance.vision/api/v3/depth?symbol=${this.symbol}&limit=${SNAPSHOT_LEVELS}`,
          {
            signal: AbortSignal.any([
              this.controller.signal,
              AbortSignal.timeout(15000),
            ]),
            redirect: "error",
          },
        );
        if (!current()) return;
        if (!response.ok)
          throw Error(
            `Binance depth snapshot unavailable (${response.status}).`,
          );
        const snapshot = await response.json();
        if (!current()) return;
        this.book = new DepthBook(snapshot);
        buffering = false;
        for (const event of buffer) this.ingest(event);
        buffer = [];
        bufferedBytes = 0;
      } catch (error) {
        if (current()) this.fail(error.message);
      }
    });
    socket.on("message", (raw) => {
      if (!current()) return;
      try {
        const event = JSON.parse(String(raw));
        if (event.e !== "depthUpdate" || event.s !== this.symbol) return;
        if (
          !Number.isSafeInteger(event.E) ||
          event.E <= 0 ||
          event.E > this.now() + 5000 ||
          this.now() - event.E > STALE_MS
        )
          throw Error("Stale or invalid depth timestamp; resynchronizing.");
        // Validate before buffering to bound both retained bytes and level count.
        updateId(event.U);
        updateId(event.u);
        if (event.U > event.u) throw Error("Invalid depth sequence range.");
        levels(event.b, MAX_LEVELS);
        levels(event.a, MAX_LEVELS);
        if (buffering) {
          bufferedBytes += Buffer.byteLength(raw);
          if (buffer.length >= 2000 || bufferedBytes > 8_000_000)
            throw Error("Depth synchronization buffer full; resynchronizing.");
          buffer.push(event);
        } else this.ingest(event);
      } catch (error) {
        this.fail(error.message);
      }
    });
    socket.on("error", () => {
      if (current()) this.fail("Binance depth connection failed.");
    });
    socket.on("close", () => {
      if (current()) this.fail("Depth disconnected; resynchronizing.");
    });
  }
  ingest(event) {
    if (event.u <= this.book.lastUpdateId) return;
    if (this.now() - event.E > STALE_MS)
      throw Error("Buffered depth expired; resynchronizing.");
    if (!this.book.apply(event)) return;
    this.eventAt = event.E;
    this.receivedAt = this.now();
    this.status = "streaming";
    this.error = null;
    this.retries = 0;
  }
  fail(message) {
    if (!this.active) return;
    const socket = this.socket;
    this.socket = null;
    this.controller?.abort();
    socket?.terminate();
    this.book = null;
    this.status = "reconnecting";
    this.error = message;
    this.resyncs++;
    this.clock.clearTimeout(this.retryTimer);
    const generation = this.generation;
    this.retryTimer = this.clock.setTimeout(
      () => this.connect(generation),
      Math.min(30000, 1000 * 2 ** Math.min(this.retries++, 5)),
    );
    this.retryTimer?.unref?.();
  }
  snapshot({ limit = 20 } = {}) {
    depthLimit(limit);
    const stale =
      !this.active ||
      this.status !== "streaming" ||
      this.now() - this.receivedAt > STALE_MS ||
      this.now() - this.eventAt > STALE_MS;
    return {
      provider: "binance",
      assetType: "spot",
      symbol: this.symbol ?? null,
      active: this.active,
      status: this.status,
      stale,
      error: this.error ?? null,
      eventAt: this.eventAt ?? null,
      receivedAt: this.receivedAt ?? null,
      resyncs: this.resyncs,
      limit,
      units: { price: "quote asset", size: "base asset" },
      ...(stale
        ? {
            bids: [],
            asks: [],
            mid: null,
            spread: null,
            spreadBps: null,
            imbalance: null,
            bidSize: null,
            askSize: null,
            lastUpdateId: null,
            coverage: null,
          }
        : this.book.view(limit)),
    };
  }
  stop() {
    this.active = false;
    this.generation++;
    this.clock.clearInterval(this.watchdog);
    this.clock.clearTimeout(this.retryTimer);
    this.controller?.abort();
    const socket = this.socket;
    this.socket = null;
    socket?.terminate();
    this.book = null;
    this.status = "stopped";
    this.eventAt = this.receivedAt = null;
    return this.snapshot();
  }
}
