import { randomUUID } from "node:crypto";
import { paperValuation } from "./paper-valuation.js";
export { paperValuation } from "./paper-valuation.js";
import { freshPaperQuote } from "./paper-account.js";
const symbolsFor = (account) =>
  [
    ...new Set([
      ...account.orders
        .filter((o) => o.status === "pending")
        .map((o) => o.symbol),
      ...Object.entries(account.positions)
        .filter(([, p]) => p.quantity > 0)
        .map(([symbol]) => symbol),
    ]),
  ].sort();
export class PaperMonitor {
  constructor({ account, history = null, now = Date.now, clock = globalThis }) {
    this.account = account;
    this.history = history;
    this.historyError = null;
    this.now = now;
    this.clock = clock;
    this.active = false;
    this.generation = 0;
    this.quotes = {};
    this.errors = {};
    this.symbols = [];
    this.lastCycleAt = null;
  }
  async snapshot() {
    const account = await this.account.snapshot();
    return {
      active: this.active,
      busy: !!this.running,
      intervalSeconds: 5,
      startedAt: this.startedAt ?? null,
      lastCycleAt: this.lastCycleAt,
      symbols: [...this.symbols],
      errors: { ...this.errors },
      account,
      valuation: paperValuation(account, this.quotes, this.now()),
      history: this.history
        ? { ...this.history.status, error: this.historyError }
        : null,
    };
  }
  async start() {
    if (this.active) return this.snapshot();
    const generation = ++this.generation;
    await this.running;
    const account = await this.account.snapshot();
    if (generation !== this.generation) return this.snapshot();
    if (!account) throw Error("Create a paper account first.");
    if (symbolsFor(account).length > 50)
      throw Error(
        "Monitoring supports up to 50 distinct pending/held markets.",
      );
    this.active = true;
    this.startedAt = this.now();
    this.sessionId = randomUUID();
    this.errors = {};
    this.quotes = {};
    this.cycle(generation);
    return this.snapshot();
  }
  cycle(generation = this.generation) {
    if (!this.active || generation !== this.generation || this.running)
      return this.running;
    const current = () => this.active && generation === this.generation;
    this.running = (async () => {
      try {
        const account = await this.account.snapshot();
        if (!current()) return;
        const symbols = symbolsFor(account);
        if (symbols.length > 50)
          throw Error(
            "Monitoring paused: more than 50 distinct pending/held markets. Reduce the set before restarting.",
          );
        this.symbols = symbols;
        this.quotes = Object.fromEntries(
          Object.entries(this.quotes).filter(([s]) => symbols.includes(s)),
        );
        this.errors = {};
        let index = 0;
        await Promise.all(
          Array.from({ length: Math.min(4, symbols.length) }, async () => {
            while (current() && index < symbols.length) {
              const symbol = symbols[index++];
              try {
                const quote = await this.account.quote(symbol);
                if (!current()) return;
                freshPaperQuote(quote, symbol, this.now());
                this.quotes[symbol] = quote;
                await this.account.evaluateSymbol(symbol, quote, current);
              } catch (e) {
                if (current()) {
                  this.errors[symbol] = e.message;
                  delete this.quotes[symbol];
                }
              }
            }
          }),
        );
        if (current()) {
          this.lastCycleAt = this.now();
          if (this.history) {
            try {
              const observed = await this.account.snapshot();
              if (!current()) return;
              await this.history.record(
                observed,
                this.quotes,
                this.now(),
                this.sessionId,
                current,
              );
              if (current()) this.historyError = null;
            } catch (e) {
              if (current()) this.historyError = e.message;
            }
          }
        }
      } catch (e) {
        if (current()) {
          this.errors.monitor = e.message;
          this.active = false;
        }
      }
    })().finally(() => {
      this.running = null;
      if (current()) {
        this.timer = this.clock.setTimeout(() => this.cycle(generation), 5000);
        this.timer?.unref?.();
      }
    });
    return this.running;
  }
  async close() {
    this.active = false;
    this.generation++;
    this.clock.clearTimeout(this.timer);
    await this.running;
  }
  async stop() {
    await this.close();
    return this.snapshot();
  }
}
