import { BinanceLive, validateLiveRequest } from "./live.js";
import { fetchBinance } from "./data.js";

export const panelIds = ["compare-1", "compare-2", "compare-3"];
export function validatePanelRequests(panels) {
  if (!Array.isArray(panels) || panels.length > 3)
    throw Error("Choose up to three comparison charts.");
  const ids = new Set();
  return panels.map((p) => {
    if (
      !panelIds.includes(p.id) ||
      ids.has(p.id) ||
      typeof p.live !== "boolean"
    )
      throw Error("Invalid or duplicate comparison chart.");
    ids.add(p.id);
    return { id: p.id, ...validateLiveRequest(p), live: p.live };
  });
}
const key = (p) => `${p.symbol}:${p.timeframe}`;

// All windows/agents read this one bounded set of subscriptions. Comparison data
// never replaces the research dataset or writes to the primary bars store.
export class ChartPanels {
  constructor({
    primary,
    createLive = () => new BinanceLive({ maxBars: 1000, maxTrades: 1000 }),
    fetchHistory = async (request) => ({
      bars: await fetchBinance(request),
      symbol: request.symbol,
      timeframe: request.timeframe,
      origin: "Binance spot • comparison snapshot",
      loadedAt: Date.now(),
    }),
  } = {}) {
    this.primary = primary;
    this.createLive = createLive;
    this.fetchHistory = fetchHistory;
    this.panels = [];
    this.entries = new Map();
  }
  async configure(panels, { refresh = false } = {}) {
    const next = validatePanelRequests(panels);
    this.panels = next;
    const wanted = new Set(next.map(key));
    for (const [id, entry] of this.entries) {
      if (!wanted.has(id)) {
        entry.owned?.stop();
        this.entries.delete(id);
      }
    }
    for (const p of next) {
      if (!this.entries.has(key(p))) this.entries.set(key(p), { request: p });
    }
    if (refresh)
      for (const entry of this.entries.values()) entry.dataset = null;
    this.reconcile();
    await Promise.all(
      [...this.entries.values()].map(async (entry) => {
        if (
          !next.some((p) => key(p) === key(entry.request) && !p.live) ||
          entry.dataset
        )
          return;
        entry.loading ??= this.fetchHistory({ ...entry.request, limit: 1000 })
          .then((dataset) => {
            entry.dataset = dataset;
            entry.error = null;
          })
          .catch((error) => {
            entry.error = error.message;
          })
          .finally(() => {
            entry.loading = null;
          });
        await entry.loading;
      }),
    );
    return this.snapshot();
  }
  preparePrimary(args) {
    const request = validateLiveRequest(args);
    const entry = this.entries.get(key(request));
    entry?.owned?.stop();
    if (entry) entry.owned = null;
  }
  reconcile() {
    const primary = this.primary?.snapshot();
    for (const [id, entry] of this.entries) {
      const wanted = this.panels.some((p) => key(p) === id && p.live);
      const shared = wanted && primary?.active && key(primary) === id;
      if ((!wanted || shared) && entry.owned) {
        entry.owned.stop();
        entry.owned = null;
      }
      if (wanted && !shared && !entry.owned) {
        entry.owned = this.createLive();
        entry.owned.start(entry.request).catch((e) => {
          entry.error = e.message;
        });
      }
      entry.shared = !!shared;
    }
  }
  snapshot() {
    this.reconcile();
    return this.panels.map((p) => {
      const entry = this.entries.get(key(p));
      const stream = p.live
        ? (entry.shared ? this.primary : entry.owned)?.snapshot()
        : null;
      return {
        ...p,
        ...(stream ?? {
          active: false,
          status: entry.loading
            ? "loading"
            : entry.error
              ? "error"
              : "snapshot",
          dataset: entry.dataset ?? null,
          forming: null,
          error: entry.error ?? null,
        }),
        id: p.id,
        sharedWithPrimary: p.live && entry.shared,
      };
    });
  }
  stop() {
    for (const entry of this.entries.values()) entry.owned?.stop();
    this.entries.clear();
    this.panels = [];
  }
}
