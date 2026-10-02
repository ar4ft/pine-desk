import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import { fetchBinance, durations, validateBars } from "./data.js";
import { orderflow } from "./orderflow.js";
export function validateLiveRequest({
  symbol = "BTCUSDT",
  timeframe = "1m",
} = {}) {
  if (!/^[A-Z0-9]{3,24}$/.test(symbol) || !durations[timeframe])
    throw new Error("Choose a Binance spot symbol and supported timeframe.");
  return { symbol, timeframe };
}
export function parseBinanceMessage(raw, subscription) {
  const event = typeof raw === "string" ? JSON.parse(raw) : raw;
  const data = event.data ?? event;
  if (data.s !== subscription.symbol) return null;
  if (data.e === "trade") {
    const trade = {
      id: data.t,
      time: data.T,
      price: Number(data.p),
      size: Number(data.q),
      side: data.m ? "sell" : "buy",
    };
    if (
      !Number.isSafeInteger(trade.id) ||
      trade.id < 0 ||
      !Number.isFinite(trade.time) ||
      trade.time <= 0 ||
      !Number.isFinite(trade.price) ||
      trade.price <= 0 ||
      !Number.isFinite(trade.size) ||
      trade.size <= 0 ||
      typeof data.m !== "boolean"
    )
      throw new Error("Invalid Binance trade event.");
    return { type: "trade", trade };
  }
  if (data.e === "kline" && data.k?.i === subscription.timeframe) {
    const k = data.k,
      bar = {
        time: k.t,
        open: Number(k.o),
        high: Number(k.h),
        low: Number(k.l),
        close: Number(k.c),
        volume: Number(k.v),
      };
    if (
      typeof k.x !== "boolean" ||
      !Number.isFinite(bar.time) ||
      bar.time <= 0 ||
      ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(
        Number.isFinite,
      ) ||
      Math.min(bar.open, bar.high, bar.low, bar.close) <= 0 ||
      bar.volume < 0 ||
      bar.high < Math.max(bar.open, bar.close, bar.low) ||
      bar.low > Math.min(bar.open, bar.close, bar.high)
    )
      throw new Error("Invalid Binance candle event.");
    return { type: "candle", bar, closed: k.x };
  }
  return null;
}
export class BinanceLive {
  constructor({
    fetchHistory = fetchBinance,
    createSocket,
    now = Date.now,
    clock = globalThis,
    onClosed = () => {},
    maxTrades = 50000,
    maxBars = 50000,
  } = {}) {
    this.fetchHistory = fetchHistory;
    this.now = now;
    this.clock = clock;
    this.onClosed = onClosed;
    this.maxTrades = maxTrades;
    this.maxBars = maxBars;
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
    this.generation = 0;
    this.state = { status: "stopped" };
    this.bars = [];
    this.trades = [];
    this.gaps = [];
    this.candleGaps = [];
    this.forming = null;
  }
  snapshot() {
    return {
      ...this.state,
      active: this.active ?? false,
      forming: this.forming,
      dataset: this.bars.length
        ? {
            bars: this.bars,
            symbol: this.state.symbol,
            timeframe: this.state.timeframe,
            origin: "Binance live • settled candles",
            loadedAt: this.state.startedAt,
            candleGaps: this.candleGaps,
          }
        : null,
      tradeCount: Math.min(this.trades.length, this.maxTrades),
      tradeFrom:
        this.trades.at(-Math.min(this.trades.length, this.maxTrades))?.time ??
        null,
      tradeTo: this.trades.at(-1)?.time ?? null,
      gaps: this.gaps.slice(-50),
      candleGaps: this.candleGaps.slice(-50),
    };
  }
  async start(args) {
    const request = validateLiveRequest(args);
    this.stop();
    this.active = true;
    this.bars = [];
    this.trades = [];
    this.forming = null;
    this.lastTradeId = null;
    this.gaps = [];
    this.candleGaps = [];
    this.retries = 0;
    this.state = {
      ...request,
      status: "connecting",
      startedAt: this.now(),
      lastMessageAt: null,
      error: null,
    };
    const generation = ++this.generation;
    this.watchdog = this.clock.setInterval(() => {
      if (
        this.active &&
        this.state.lastMessageAt &&
        this.now() - this.state.lastMessageAt > 30000
      ) {
        this.state.error = "Stream stale; reconnecting.";
        this.socket?.terminate();
      }
    }, 10000);
    this.watchdog?.unref?.();
    this.connect(generation);
    return this.snapshot();
  }
  connect(generation) {
    if (!this.active || generation !== this.generation) return;
    this.state.status = "connecting";
    const { symbol, timeframe } = this.state;
    let socket;
    try {
      socket = this.createSocket(
        `wss://data-stream.binance.vision/stream?streams=${symbol.toLowerCase()}@kline_${timeframe}/${symbol.toLowerCase()}@trade`,
      );
    } catch (error) {
      this.state.error = error.message;
      this.retry(generation);
      return;
    }
    this.socket = socket;
    let syncing = true,
      buffer = [];
    const current = () =>
      this.active && generation === this.generation && socket === this.socket;
    socket.on("open", async () => {
      if (!current()) return;
      this.state.status = "syncing";
      this.state.lastMessageAt = this.now();
      try {
        const history = validateBars(
          await this.fetchHistory({ symbol, timeframe, limit: 1000 }),
        );
        if (!current()) return;
        const previous = this.bars.at(-1);
        if (previous && history[0].time > previous.time + durations[timeframe])
          this.candleGaps.push({
            from: previous.time + durations[timeframe],
            to: history[0].time,
            reason: "Reconnect exceeded REST candle lookback; missing candles.",
          });
        const merged = new Map(
          [...this.bars, ...history].map((bar) => [bar.time, bar]),
        );
        this.bars = [...merged.values()]
          .sort((a, b) => a.time - b.time)
          .slice(-this.maxBars);
        this.forming = null;
        this.candleGaps = this.bars.flatMap((bar, index) =>
          index && bar.time - this.bars[index - 1].time !== durations[timeframe]
            ? [
                {
                  from: this.bars[index - 1].time + durations[timeframe],
                  to: bar.time,
                  reason: "Missing candles after REST reconciliation.",
                },
              ]
            : [],
        );
        syncing = false;
        for (const item of buffer) this.ingest(item);
        buffer = [];
        this.state.status = "streaming";
        this.state.error = null;
        this.retries = 0;
        this.onClosed(this.snapshot().dataset);
      } catch (error) {
        if (current()) {
          this.state.error = error.message;
          socket.terminate();
        }
      }
    });
    socket.on("message", (raw) => {
      if (!current()) return;
      try {
        const parsed = parseBinanceMessage(String(raw), this.state);
        if (!parsed) return;
        this.state.lastMessageAt = this.now();
        if (syncing) {
          buffer.push(parsed);
          if (buffer.length > 10000) {
            this.state.error = "Synchronization buffer overflow; reconnecting.";
            socket.terminate();
          }
        } else this.ingest(parsed);
      } catch (error) {
        this.state.error = error.message;
      }
    });
    socket.on("error", (error) => {
      if (current())
        this.state.error = `Binance stream unavailable: ${error.message}`;
    });
    socket.on("close", () => {
      if (!current()) return;
      this.forming = null;
      this.gaps.push({
        from:
          this.trades.at(-1)?.time ?? this.state.lastMessageAt ?? this.now(),
        to: null,
        disconnectedAt: this.now(),
        reason: "Disconnected trade stream; missed trades are not backfilled.",
      });
      this.retry(generation);
    });
  }
  ingest(event) {
    if (event.type === "trade") {
      const t = event.trade;
      if (this.lastTradeId !== null && t.id <= this.lastTradeId) return;
      for (const gap of this.gaps) if (gap.to === null) gap.to = t.time;
      if (this.lastTradeId !== null && t.id > this.lastTradeId + 1)
        this.gaps.push({
          from: this.trades.at(-1)?.time ?? null,
          to: t.time,
          missingTradeIds: t.id - this.lastTradeId - 1,
          reason:
            "Missing trade IDs; CVD and profile have incomplete coverage.",
        });
      this.lastTradeId = t.id;
      this.trades.push(t);
      if (this.trades.length > this.maxTrades * 1.1)
        this.trades.splice(0, this.trades.length - this.maxTrades);
    } else {
      const { bar, closed } = event,
        last = this.bars.at(-1);
      if (closed) {
        if (last && bar.time < last.time) return;
        if (last?.time === bar.time) this.bars[this.bars.length - 1] = bar;
        else {
          if (last && bar.time > last.time + durations[this.state.timeframe])
            this.candleGaps.push({
              from: last.time + durations[this.state.timeframe],
              to: bar.time,
              reason: "Missing closed candles in stream.",
            });
          this.bars.push(bar);
          if (this.bars.length > this.maxBars) this.bars.shift();
        }
        if (this.forming && this.forming.time <= bar.time) this.forming = null;
        this.onClosed(this.snapshot().dataset);
      } else if (!last || bar.time > last.time) {
        if (!this.forming || bar.time >= this.forming.time) this.forming = bar;
      }
    }
    if (this.gaps.length > 100) this.gaps.splice(0, this.gaps.length - 100);
    if (this.candleGaps.length > 100)
      this.candleGaps.splice(0, this.candleGaps.length - 100);
  }
  retry(generation) {
    if (!this.active || generation !== this.generation) return;
    this.state.status = "reconnecting";
    this.retries++;
    this.state.retryInMs = Math.min(
      30000,
      1000 * 2 ** Math.min(this.retries - 1, 5),
    );
    this.retryTimer = this.clock.setTimeout(
      () => this.connect(generation),
      this.state.retryInMs,
    );
    this.retryTimer?.unref?.();
  }
  stop() {
    this.active = false;
    this.generation++;
    this.clock.clearTimeout(this.retryTimer);
    this.clock.clearInterval(this.watchdog);
    this.socket?.terminate();
    this.socket = null;
    this.state.status = "stopped";
    this.forming = null;
    return this.snapshot();
  }
  flow(args) {
    if (!this.trades.length)
      throw new Error(
        "No live trades recorded yet. Start the stream and wait for prints.",
      );
    return {
      ...orderflow(this.trades.slice(-this.maxTrades), args),
      symbol: this.state.symbol,
      origin: "Binance live retained trade window",
      gaps: this.retainedGaps(),
      status: this.state.status,
    };
  }
  retainedGaps() {
    const from = this.trades.at(
      -Math.min(this.trades.length, this.maxTrades),
    )?.time;
    return this.gaps
      .filter((gap) => from === undefined || gap.to === null || gap.to > from)
      .slice(-50);
  }
  tradeSnapshot() {
    if (!this.trades.length) throw new Error("No live trades recorded yet.");
    return {
      symbol: this.state.symbol,
      trades: this.trades.slice(-this.maxTrades),
      origin:
        "Binance live raw trades; aggressor derived from buyer-is-maker flag",
      gaps: this.retainedGaps(),
    };
  }
}
