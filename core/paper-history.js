import { z } from "zod";
import { paperValuation } from "./paper-valuation.js";

export const MAX_PAPER_SAMPLES = 10000;
const time = z.number().int().positive().max(8.64e15);
const money = z.number().finite().nonnegative().max(1e18);
const sampleSchema = z
  .object({
    at: time,
    sessionId: z.string().uuid(),
    accountRevision: z.number().int().positive(),
    cash: money,
    positionCost: money,
    positionValue: money.nullable(),
    holdingCount: z.number().int().min(0).max(1000),
    missingSymbols: z.array(z.string().regex(/^[A-Z0-9]{2,20}USDT$/)).max(1000),
    oldestQuoteAt: time.nullable(),
    newestQuoteAt: time.nullable(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const fail = () =>
      ctx.addIssue({ code: "custom", message: "Invalid paper equity sample." });
    if (
      new Set(s.missingSymbols).size !== s.missingSymbols.length ||
      s.missingSymbols.length > s.holdingCount
    )
      fail();
    if ((s.positionValue === null) !== s.missingSymbols.length > 0) fail();
    if (
      !s.holdingCount &&
      (s.positionCost !== 0 ||
        s.positionValue !== 0 ||
        s.oldestQuoteAt !== null ||
        s.newestQuoteAt !== null)
    )
      fail();
    if (
      s.holdingCount > s.missingSymbols.length &&
      (s.oldestQuoteAt === null ||
        s.newestQuoteAt === null ||
        s.oldestQuoteAt > s.newestQuoteAt ||
        s.newestQuoteAt > s.at ||
        s.at - s.oldestQuoteAt > 15000)
    )
      fail();
    if (
      s.holdingCount === s.missingSymbols.length &&
      (s.oldestQuoteAt !== null || s.newestQuoteAt !== null)
    )
      fail();
  });
const archiveSchema = z
  .object({
    version: z.literal(1),
    accountId: z.string().uuid(),
    initialCash: money.positive(),
    samples: z.array(sampleSchema).max(MAX_PAPER_SAMPLES),
  })
  .strict();

export function equitySeries(doc) {
  let peak = doc.initialCash,
    maxDrawdown = 0,
    maxDrawdownPercent = 0,
    previous = null;
  const samples = doc.samples.map((s) => {
    const equity = s.positionValue === null ? null : s.cash + s.positionValue;
    const gapBefore =
      !previous ||
      previous.sessionId !== s.sessionId ||
      s.at - previous.at > 90000 ||
      previous.positionValue === null ||
      equity === null;
    previous = s;
    if (equity !== null) peak = Math.max(peak, equity);
    const drawdown = equity === null ? null : peak - equity;
    const drawdownPercent = drawdown === null ? null : (drawdown / peak) * 100;
    if (drawdown !== null) {
      maxDrawdown = Math.max(maxDrawdown, drawdown);
      maxDrawdownPercent = Math.max(maxDrawdownPercent, drawdownPercent);
    }
    return {
      ...s,
      equity,
      unrealizedPnl: equity === null ? null : s.positionValue - s.positionCost,
      peak,
      drawdown,
      drawdownPercent,
      gapBefore,
    };
  });
  return {
    accountId: doc.accountId,
    initialCash: doc.initialCash,
    samples,
    peak,
    maxDrawdown,
    maxDrawdownPercent,
    completeSamples: samples.filter((s) => s.equity !== null).length,
    gapSamples: samples.filter((s) => s.equity === null).length,
    method:
      "Observed bid equity; excludes hypothetical exit costs. Drawdown uses initial cash and recorded peaks, not unobserved prices. Session changes, incomplete marks and intervals over 90 seconds break chart lines. No backfill.",
  };
}
export class PaperHistory {
  constructor({ account, storage }) {
    this.account = account;
    this.storage = storage;
    this.queue = Promise.resolve();
    this.status = {
      loaded: false,
      count: 0,
      lastSavedAt: null,
      full: false,
      limit: MAX_PAPER_SAMPLES,
    };
  }
  serial(fn) {
    const job = this.queue.then(fn);
    this.queue = job.catch(() => {});
    return job;
  }
  async read(account) {
    const raw = await this.storage.read();
    if (raw === null)
      return {
        version: 1,
        accountId: account?.id ?? null,
        initialCash: account?.initialCash ?? 0,
        samples: [],
      };
    const doc = archiveSchema.parse(raw);
    if (
      doc.accountId !== account?.id ||
      doc.initialCash !== account.initialCash
    )
      throw Error("Equity history belongs to a different paper account.");
    let previous = null;
    for (const s of doc.samples) {
      if (
        s.at < account.createdAt ||
        s.accountRevision > account.revision ||
        (previous &&
          (s.at < previous.at || s.accountRevision < previous.accountRevision))
      )
        throw Error("Invalid paper history chronology; archive was not reset.");
      previous = s;
    }
    return doc;
  }
  updateStatus(doc) {
    this.status = {
      loaded: true,
      count: doc.samples.length,
      lastSavedAt: doc.samples.at(-1)?.at ?? null,
      full: doc.samples.length >= MAX_PAPER_SAMPLES,
      limit: MAX_PAPER_SAMPLES,
    };
  }
  snapshot() {
    return this.serial(async () => {
      const account = await this.account.snapshot(),
        doc = await this.read(account);
      this.updateStatus(doc);
      return { ...equitySeries(doc), ...this.status };
    });
  }
  record(account, quotes, at, sessionId, current = () => true) {
    return this.serial(async () => {
      if (!current()) return { saved: false };
      if (!account) throw Error("Create a paper account first.");
      const doc = await this.read(account),
        last = doc.samples.at(-1);
      this.updateStatus(doc);
      if (this.status.full)
        throw Error(
          "Equity history is full (10,000 samples). Export it; existing history is retained. Paper execution continues.",
        );
      if (at < account.createdAt || (last && at < last.at))
        throw Error("Clock moved backwards; equity sample was not recorded.");
      const v = paperValuation(account, quotes, at),
        missingSymbols = v.positions
          .filter((p) => p.stale)
          .map((p) => p.symbol)
          .sort(),
        marked = v.positions.filter((p) => !p.stale);
      const sample = sampleSchema.parse({
        at,
        sessionId,
        accountRevision: account.revision,
        cash: account.cash,
        positionCost: v.positions.reduce((n, p) => n + p.cost, 0),
        positionValue: v.complete
          ? v.positions.reduce((n, p) => n + p.value, 0)
          : null,
        holdingCount: v.positions.length,
        missingSymbols,
        oldestQuoteAt: marked.length
          ? Math.min(...marked.map((p) => p.requestedAt))
          : null,
        newestQuoteAt: marked.length
          ? Math.max(...marked.map((p) => p.receivedAt))
          : null,
      });
      if (
        last &&
        last.sessionId === sessionId &&
        last.accountRevision === sample.accountRevision &&
        at - last.at < 60000 &&
        JSON.stringify(last.missingSymbols) === JSON.stringify(missingSymbols)
      )
        return { saved: false };
      if (!current()) return { saved: false };
      const next = archiveSchema.parse({
        ...doc,
        samples: [...doc.samples, sample],
      });
      await this.storage.write(next);
      this.updateStatus(next);
      return { saved: true };
    });
  }
  close() {
    return this.queue;
  }
}
