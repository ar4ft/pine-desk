import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";

export function validateQuoteSymbols(symbols) {
  if (
    !Array.isArray(symbols) ||
    symbols.length > 50 ||
    symbols.some((s) => !/^[A-Z0-9]{3,24}$/.test(s))
  )
    throw Error("Choose up to 50 Binance spot symbols.");
  return [...new Set(symbols)].sort();
}
export class MarketQuotes {
  constructor({ createSocket, now = Date.now, clock = globalThis } = {}) {
    this.createSocket =
      createSocket ??
      ((url) =>
        new WebSocket(url, {
          ...(process.env.HTTPS_PROXY
            ? { agent: new HttpsProxyAgent(process.env.HTTPS_PROXY) }
            : {}),
          handshakeTimeout: 15000,
          maxPayload: 1000000,
        }));
    this.now = now;
    this.clock = clock;
    this.symbols = [];
    this.quotes = {};
    this.generation = 0;
    this.status = "stopped";
  }
  start(symbols) {
    symbols = validateQuoteSymbols(symbols);
    if (this.active && JSON.stringify(symbols) === JSON.stringify(this.symbols))
      return this.snapshot();
    this.stop();
    this.symbols = symbols;
    this.quotes = {};
    this.error = null;
    this.active = !!symbols.length;
    this.retries = 0;
    if (this.active) {
      this.connect(this.generation);
      this.watchdog = this.clock.setInterval(() => {
        if (this.now() - this.lastMessageAt > 30000) {
          this.error = "No recent ticker events; reconnecting.";
          this.socket?.terminate();
        }
      }, 10000);
      this.watchdog?.unref?.();
    }
    return this.snapshot();
  }
  connect(generation) {
    if (!this.active || generation !== this.generation) return;
    this.status = "connecting";
    this.lastMessageAt = this.now();
    let socket;
    try {
      socket = this.createSocket(
        `wss://data-stream.binance.vision/stream?streams=${this.symbols.map((s) => s.toLowerCase() + "@ticker").join("/")}`,
      );
    } catch (e) {
      this.error = e.message;
      this.retry(generation);
      return;
    }
    this.socket = socket;
    const current = () =>
      this.active && generation === this.generation && this.socket === socket;
    socket.on("open", () => {
      if (current()) this.status = "waiting";
    });
    socket.on("message", (raw) => {
      if (!current()) return;
      try {
        const envelope = JSON.parse(String(raw)),
          d = envelope.data ?? envelope;
        if (d.e !== "24hrTicker" || !this.symbols.includes(d.s)) return;
        const price = Number(d.c),
          change = Number(d.P),
          eventAt = Number(d.E);
        if (
          !(price > 0) ||
          !Number.isFinite(price) ||
          !Number.isFinite(change) ||
          !Number.isFinite(eventAt) ||
          eventAt <= 0
        )
          return;
        if (this.quotes[d.s]?.eventAt > eventAt) return;
        this.lastMessageAt = this.now();
        this.quotes[d.s] = { price, change, eventAt, receivedAt: this.now() };
        this.status = "streaming";
        this.error = null;
        this.retries = 0;
      } catch {
        /* Ignore malformed network events, never replace a valid quote. */
      }
    });
    socket.on("error", () => {
      if (current()) {
        this.error = "Binance ticker connection failed.";
        socket.terminate();
      }
    });
    socket.on("close", () => {
      if (current()) this.retry(generation);
    });
  }
  retry(generation) {
    if (!this.active || generation !== this.generation) return;
    this.status = "reconnecting";
    this.retryTimer = this.clock.setTimeout(
      () => this.connect(generation),
      Math.min(30000, 1000 * 2 ** Math.min(this.retries++, 5)),
    );
    this.retryTimer?.unref?.();
  }
  snapshot() {
    const now = this.now();
    return {
      active: !!this.active,
      status: this.status,
      symbols: this.symbols,
      error: this.error ?? null,
      quotes: Object.fromEntries(
        Object.entries(this.quotes).map(([s, q]) => [
          s,
          {
            ...q,
            stale:
              !this.active ||
              this.status !== "streaming" ||
              now - q.receivedAt > 30000 ||
              now - q.eventAt > 30000,
          },
        ]),
      ),
    };
  }
  stop() {
    this.active = false;
    this.generation++;
    this.clock.clearTimeout(this.retryTimer);
    this.clock.clearInterval(this.watchdog);
    this.socket?.terminate();
    this.socket = null;
    this.status = "stopped";
    return this.snapshot();
  }
}

// Cached exchange metadata supplies searchable, provider-qualified symbols.
export class MarketSearch {
  constructor({ fetcher = fetch, now = Date.now } = {}) {
    this.fetcher = fetcher;
    this.now = now;
  }
  async search(query) {
    if (typeof query !== "string" || query.length > 40)
      throw Error("Search up to 40 characters.");
    if (!this.markets || this.now() - this.loadedAt > 3600000) {
      this.loading ??= (async () => {
        const response = await this.fetcher(
          "https://data-api.binance.vision/api/v3/exchangeInfo",
          { signal: AbortSignal.timeout(15000), redirect: "error" },
        );
        if (!response.ok)
          throw Error(
            `Binance market search unavailable (${response.status}).`,
          );
        const data = await response.json();
        if (!Array.isArray(data.symbols))
          throw Error("Invalid exchange market metadata.");
        this.markets = data.symbols
          .filter(
            (m) =>
              m.status === "TRADING" &&
              m.isSpotTradingAllowed !== false &&
              /^[A-Z0-9]{3,24}$/.test(m.symbol),
          )
          .map((m) => ({
            provider: "binance",
            symbol: m.symbol,
            base: String(m.baseAsset),
            quote: String(m.quoteAsset),
          }));
        this.loadedAt = this.now();
      })().finally(() => {
        this.loading = null;
      });
      await this.loading;
    }
    const q = query.trim().toUpperCase();
    return {
      markets: this.markets
        .filter((m) => m.symbol.includes(q) || m.base.includes(q))
        .sort(
          (a, b) =>
            Number(b.symbol === q) - Number(a.symbol === q) ||
            Number(b.symbol.startsWith(q)) - Number(a.symbol.startsWith(q)) ||
            a.symbol.localeCompare(b.symbol),
        )
        .slice(0, 30),
      retrievedAt: this.loadedAt,
    };
  }
}
