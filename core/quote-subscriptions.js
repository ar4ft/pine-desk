import { validateQuoteSymbols } from "./market-quotes.js";

// Only these two bounded consumers may own the combined ticker connection.
// Removing a watchlist must not disconnect enabled alert rules.
export class QuoteSubscriptions {
  constructor(feed) {
    this.feed = feed;
    this.consumers = new Map();
  }
  set(owner, symbols) {
    if (!["watchlist", "alerts"].includes(owner))
      throw Error("Unknown quote consumer.");
    const selected = validateQuoteSymbols(symbols);
    this.consumers.set(owner, selected);
    const combined = [...new Set([...this.consumers.values()].flat())].sort();
    if (combined.length) this.feed.start(combined);
    else this.feed.stop();
    return this.snapshot(owner);
  }
  snapshot(owner) {
    const symbols = this.consumers.get(owner) ?? [],
      snapshot = this.feed.snapshot();
    return {
      ...snapshot,
      active: !!symbols.length && snapshot.active,
      status: symbols.length ? snapshot.status : "stopped",
      symbols,
      quotes: Object.fromEntries(
        Object.entries(snapshot.quotes).filter(([symbol]) =>
          symbols.includes(symbol),
        ),
      ),
    };
  }
  subscribe(listener) {
    return this.feed.subscribe(listener);
  }
  stop() {
    this.consumers.clear();
    this.feed.stop();
  }
}
