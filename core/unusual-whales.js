import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import { credential } from "./credentials.js";
import {
  tickerValue,
  normalizeStrike,
  normalizeLevels,
  normalizeOptionTrade,
  optionsBars,
} from "./options-model.js";
export class UnusualWhales {
  constructor({
    fetcher = fetch,
    socketFactory = (url, options) => new WebSocket(url, options),
    getToken = () => credential("unusualWhales"),
  } = {}) {
    this.fetcher = fetcher;
    this.socketFactory = socketFactory;
    this.getToken = getToken;
    this.generation = 0;
    this.state = {
      active: false,
      status: "stopped",
      ticker: null,
      timeframe: "5m",
      gex: [],
      levels: null,
      bars: [],
      trades: [],
      gaps: [],
      errors: {},
      channels: {},
      revision: 0,
    };
    this.ids = new Set();
  }
  async request(path, query = {}, signal) {
    const token = await this.getToken();
    if (!token) throw new Error("Add an Unusual Whales API token in Settings.");
    const url = new URL(path, "https://api.unusualwhales.com");
    for (const [k, v] of Object.entries(query))
      if (v !== undefined) url.searchParams.set(k, String(v));
    let response;
    try {
      response = await this.fetcher(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "PineDesk/0.3.0",
          Accept: "application/json",
        },
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error(
        "Unusual Whales request failed or timed out. Check your connection.",
      );
    }
    if (!response.ok) {
      const reason =
        {
          401: "Token was rejected.",
          403: "Your API plan does not permit this endpoint.",
          429: "Rate limit reached.",
          503: "Exposure data is loading; retry later.",
        }[response.status] ?? "Provider request failed.";
      const retry = response.headers?.get("retry-after");
      throw new Error(
        `Unusual Whales ${response.status}: ${reason}${
          retry
            ? ` Retry-After: ${String(retry)
                .replace(/[^0-9.]/g, "")
                .slice(0, 10)} seconds.`
            : ""
        }`,
      );
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error("Unusual Whales returned invalid JSON.");
    }
    return body;
  }
  validate(args) {
    const ticker = tickerValue(args.ticker),
      timeframe = args.timeframe ?? "5m";
    if (!["1m", "5m", "15m", "1h", "4h"].includes(timeframe))
      throw new Error("Unsupported options chart timeframe.");
    return { ticker, timeframe };
  }
  async refresh(args) {
    const config = this.validate(args);
    if (
      this.state.active &&
      (config.ticker !== this.state.ticker ||
        config.timeframe !== this.state.timeframe)
    )
      throw new Error("Stop the options stream before changing its market.");
    if (
      config.ticker !== this.state.ticker ||
      config.timeframe !== this.state.timeframe
    ) {
      this.stop();
      this.state = {
        ...this.state,
        ...config,
        gex: [],
        levels: null,
        bars: [],
        trades: [],
        gaps: [],
        errors: {},
        channels: {},
      };
      this.ids.clear();
    }
    if (this.refreshing) return this.refreshing;
    const generation = this.generation,
      controller = new AbortController();
    this.controller = controller;
    const deadline = setTimeout(() => controller.abort(), 60000);
    deadline.unref?.();
    const run = async () => {
      const results = await Promise.allSettled([
        this.gex(config.ticker, controller.signal),
        this.request(
          `/api/stock/${config.ticker}/gex-levels`,
          { source: "oi" },
          controller.signal,
        ).then((r) => normalizeLevels(r, "oi")),
        this.request(
          `/api/stock/${config.ticker}/ohlc/${config.timeframe}`,
          { limit: 500 },
          controller.signal,
        ).then((r) => optionsBars(r, config.timeframe)),
      ]);
      if (generation !== this.generation) return this.snapshot();
      for (let i = 0; i < results.length; i++) {
        const k = ["gex", "levels", "bars"][i],
          r = results[i];
        if (r.status === "fulfilled") {
          if (k === "gex") {
            const latest = new Map(this.state.gex.map((s) => [s.strike, s]));
            this.state.gex = r.value.map((s) => {
              const old = latest.get(s.strike);
              return old && old.time > s.time ? old : s;
            });
          } else this.state[k] = r.value;
          delete this.state.errors[k];
        } else this.state.errors[k] = r.reason.message;
      }
      this.state.retrievedAt = Date.now();
      this.state.revision++;
      return this.snapshot();
    };
    const pending = run();
    this.refreshing = pending;
    try {
      return await pending;
    } finally {
      clearTimeout(deadline);
      if (this.refreshing === pending) this.refreshing = null;
    }
  }
  async gex(ticker, signal) {
    const rows = [];
    for (let page = 0; page < 20; page++) {
      const response = await this.request(
        `/api/stock/${ticker}/spot-exposures/strike`,
        { page, limit: 500 },
        signal,
      );
      if (!Array.isArray(response.data))
        throw new Error("Invalid GEX response.");
      if (!response.data.length)
        return [...new Map(rows.map((r) => [r.strike, r])).values()].sort(
          (a, b) => a.strike - b.strike,
        );
      rows.push(...response.data.map(normalizeStrike));
    }
    throw new Error(
      "GEX exceeds 20 pages. Incomplete exposure totals have been withheld.",
    );
  }
  async start(args) {
    this.stop();
    const generation = this.generation;
    const config = this.validate(args);
    const token = await this.getToken();
    if (generation !== this.generation) return this.snapshot();
    if (!token) throw new Error("Add an Unusual Whales API token in Settings.");
    this.state = {
      active: true,
      status: "synchronizing",
      ...config,
      gex: [],
      levels: null,
      bars: [],
      trades: [],
      gaps: [],
      errors: {},
      channels: {},
      revision: 0,
    };
    this.ids.clear();
    this.attempt = 0;
    await this.refresh(config);
    if (generation !== this.generation || !this.state.active)
      return this.snapshot();
    this.connect(token, generation);
    this.interval = setInterval(() => {
      if (this.state.active) this.refresh(this.state).catch(() => {});
    }, 30000);
    this.interval.unref?.();
    return this.snapshot();
  }
  connect(token, generation) {
    if (generation !== this.generation || !this.state.active) return;
    this.state.status = "connecting";
    const url = `wss://api.unusualwhales.com/socket?token=${encodeURIComponent(token)}`;
    let socket;
    try {
      socket = this.socketFactory(url, {
        headers: { "User-Agent": "PineDesk/0.3.0" },
        handshakeTimeout: 15000,
        maxPayload: 2000000,
        ...(process.env.HTTPS_PROXY
          ? { agent: new HttpsProxyAgent(process.env.HTTPS_PROXY) }
          : {}),
      });
    } catch {
      this.retry(token, generation);
      return;
    }
    this.socket = socket;
    let failed = false;
    const fail = () => {
      if (failed || generation !== this.generation || !this.state.active)
        return;
      failed = true;
      clearInterval(this.heartbeat);
      clearTimeout(this.joinTimer);
      socket.terminate();
      this.retry(token, generation);
    };
    socket.on("open", () => {
      if (generation !== this.generation) return socket.terminate();
      this.alive = true;
      this.joinTimer = setTimeout(() => {
        if (this.state.status === "connecting") {
          this.state.errors.connection =
            "Options subscription acknowledgement timed out.";
          fail();
        }
      }, 20000);
      this.joinTimer.unref?.();
      this.heartbeat = setInterval(() => {
        if (!this.alive) return fail();
        this.alive = false;
        socket.ping();
      }, 20000);
      this.heartbeat.unref?.();
      for (const channel of [
        `option_trades:${this.state.ticker}`,
        `gex_strike:${this.state.ticker}`,
      ])
        socket.send(JSON.stringify({ channel, msg_type: "join" }));
    });
    socket.on("pong", () => {
      this.alive = true;
    });
    socket.on("message", (bytes) => {
      if (generation !== this.generation) return;
      try {
        this.ingest(JSON.parse(bytes.toString()));
      } catch {
        this.state.errors.frame =
          "An invalid options stream frame was ignored.";
      }
    });
    socket.on("unexpected-response", (_request, response) => {
      if ([401, 403].includes(response.statusCode)) {
        response.resume();
        this.stop();
        this.state.status = "authorization-error";
        this.state.errors.connection = `Options WebSocket ${response.statusCode}: token rejected or streaming entitlement unavailable.`;
      } else {
        response.resume();
        this.state.errors.connection = "Options WebSocket handshake failed.";
        fail();
      }
    });
    socket.on("error", () => {
      this.state.errors.connection =
        "Options WebSocket failed. Check token, entitlement and connection.";
      fail();
    });
    socket.on("close", fail);
  }
  ingest(frame) {
    if (!Array.isArray(frame) || frame.length !== 2) return;
    const [channel, row] = frame;
    if (
      ![
        `option_trades:${this.state.ticker}`,
        `gex_strike:${this.state.ticker}`,
      ].includes(channel)
    )
      return;
    if (row.status) {
      this.state.channels[channel] = row.status;
      if (row.status !== "ok") {
        this.state.errors[channel] =
          "Subscription rejected. Check your WebSocket entitlement.";
        this.state.status = "subscription-error";
      } else {
        delete this.state.errors[channel];
        if (
          Object.values(this.state.channels).length === 2 &&
          Object.values(this.state.channels).every((s) => s === "ok")
        ) {
          this.state.status = "streaming";
          clearTimeout(this.joinTimer);
          this.attempt = 0;
          delete this.state.errors.connection;
        }
      }
      return;
    }
    this.state.lastEventAt = Date.now();
    if (channel.startsWith("option_trades:")) {
      const trade = normalizeOptionTrade(row);
      if (trade.ticker !== this.state.ticker || this.ids.has(trade.id)) return;
      this.ids.add(trade.id);
      this.state.trades.push(trade);
      if (this.state.trades.length > 2000) {
        const removed = this.state.trades.shift();
        this.ids.delete(removed.id);
      }
    } else {
      if (row.ticker && row.ticker !== this.state.ticker) return;
      const strike = normalizeStrike(row),
        i = this.state.gex.findIndex((s) => s.strike === strike.strike);
      if (i >= 0) {
        if (this.state.gex[i].time <= strike.time) this.state.gex[i] = strike;
      } else if (this.state.gex.length < 10000) {
        this.state.gex.push(strike);
        this.state.gex.sort((a, b) => a.strike - b.strike);
      }
    }
    const gap = this.state.gaps.at(-1);
    if (gap && gap.to === null) gap.to = Date.now();
    this.state.revision++;
  }
  retry(token, generation) {
    if (generation !== this.generation || !this.state.active) return;
    this.state.status = "reconnecting";
    this.state.channels = {};
    if (!this.state.gaps.at(-1) || this.state.gaps.at(-1).to !== null) {
      this.state.gaps.push({
        from: Date.now(),
        to: null,
        reason:
          "Disconnected; missed trades and intraday GEX are not replayed.",
      });
      this.state.gaps = this.state.gaps.slice(-50);
    }
    this.timer = setTimeout(
      () => {
        if (generation !== this.generation) return;
        this.refresh(this.state).catch(() => {});
        this.connect(token, generation);
      },
      Math.min(30000, 1000 * 2 ** this.attempt++),
    );
    this.timer.unref?.();
  }
  stop() {
    this.generation++;
    clearTimeout(this.timer);
    clearTimeout(this.joinTimer);
    clearInterval(this.interval);
    clearInterval(this.heartbeat);
    this.controller?.abort();
    this.refreshing = null;
    this.socket?.removeAllListeners();
    this.socket?.on("error", () => {});
    this.socket?.terminate();
    this.socket = null;
    this.state.active = false;
    this.state.status = "stopped";
    return this.snapshot();
  }
  snapshot() {
    return structuredClone({
      ...this.state,
      provider: "Unusual Whales",
      basis: "oi",
      totalGex: this.state.gex.length
        ? this.state.gex.reduce((sum, r) => sum + r.net, 0)
        : null,
      coverage:
        "Retained live prints only; no replay. Underlying candles and level estimates refresh every 30 seconds. Strike timestamps can differ. Dealer positioning is assumed.",
    });
  }
}
