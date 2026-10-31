import { createHash } from "node:crypto";
import { z } from "zod";
import { paperValuation } from "./paper-valuation.js";

export const MAX_PAPER_SAMPLES = 10000;
export const MAX_PAPER_ARCHIVES = 100;
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
const legacySchema = z
  .object({
    version: z.literal(1),
    accountId: z.string().uuid(),
    initialCash: money.positive(),
    samples: z.array(sampleSchema).max(MAX_PAPER_SAMPLES),
  })
  .strict();
const seedSchema = z
  .object({
    peak: money,
    maxDrawdown: money,
    maxDrawdownPercent: z.number().finite().min(0).max(100),
    completeSamples: z.number().int().nonnegative(),
    gapSamples: z.number().int().nonnegative(),
    previous: sampleSchema.nullable(),
  })
  .strict();
const refSchema = z
  .object({
    period: z.number().int().positive(),
    id: z.string().regex(/^period-[0-9]+-[a-f0-9]{64}$/),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    count: z.number().int().min(1).max(MAX_PAPER_SAMPLES),
    firstAt: time,
    lastAt: time,
    end: seedSchema,
  })
  .strict();
const archiveSchema = z
  .object({
    version: z.literal(2),
    accountId: z.string().uuid(),
    initialCash: money.positive(),
    period: z
      .number()
      .int()
      .min(1)
      .max(MAX_PAPER_ARCHIVES + 1),
    seed: seedSchema,
    archives: z.array(refSchema).max(MAX_PAPER_ARCHIVES),
    samples: z.array(sampleSchema).max(MAX_PAPER_SAMPLES),
  })
  .strict();
const periodSchema = z
  .object({
    version: z.literal(1),
    accountId: z.string().uuid(),
    initialCash: money.positive(),
    period: z.number().int().positive(),
    seed: seedSchema,
    samples: z.array(sampleSchema).min(1).max(MAX_PAPER_SAMPLES),
  })
  .strict();
const initialSeed = (cash) => ({
  peak: cash,
  maxDrawdown: 0,
  maxDrawdownPercent: 0,
  completeSamples: 0,
  gapSamples: 0,
  previous: null,
});
const digest = (text) => createHash("sha256").update(text).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function ending(doc) {
  const s = equitySeries(doc);
  return {
    peak: s.peak,
    maxDrawdown: s.maxDrawdown,
    maxDrawdownPercent: s.maxDrawdownPercent,
    completeSamples: s.completeSamples,
    gapSamples: s.gapSamples,
    previous: doc.samples.at(-1) ?? doc.seed.previous,
  };
}
function chronology(samples, account, previous = null) {
  for (const s of samples) {
    if (
      s.at < account.createdAt ||
      s.accountRevision > account.revision ||
      (previous &&
        (s.at < previous.at || s.accountRevision < previous.accountRevision))
    )
      throw Error("Invalid paper history chronology; archive was not reset.");
    previous = s;
  }
}

export function equitySeries(doc) {
  const seed = doc.seed ?? initialSeed(doc.initialCash);
  let peak = seed.peak,
    maxDrawdown = seed.maxDrawdown,
    maxDrawdownPercent = seed.maxDrawdownPercent,
    previous = seed.previous;
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
    completeSamples:
      seed.completeSamples + samples.filter((s) => s.equity !== null).length,
    gapSamples:
      seed.gapSamples + samples.filter((s) => s.equity === null).length,
    periodCompleteSamples: samples.filter((s) => s.equity !== null).length,
    periodGapSamples: samples.filter((s) => s.equity === null).length,
    seed,
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
        version: 2,
        accountId: account?.id ?? null,
        initialCash: account?.initialCash ?? 0,
        period: 1,
        seed: initialSeed(account?.initialCash ?? 0),
        archives: [],
        samples: [],
      };
    const old = raw.version === 1 ? legacySchema.parse(raw) : null;
    const doc = old
      ? {
          ...old,
          version: 2,
          period: 1,
          seed: initialSeed(old.initialCash),
          archives: [],
        }
      : archiveSchema.parse(raw);
    if (
      doc.accountId !== account?.id ||
      doc.initialCash !== account.initialCash
    )
      throw Error("Equity history belongs to a different paper account.");
    if (doc.period !== doc.archives.length + 1)
      throw Error("Invalid history period index.");
    let count = 0,
      previous = null;
    for (const [i, ref] of doc.archives.entries()) {
      count += ref.count;
      if (
        ref.period !== i + 1 ||
        ref.id !== `period-${ref.period}-${ref.digest}` ||
        ref.firstAt > ref.lastAt ||
        ref.end.completeSamples + ref.end.gapSamples !== count ||
        ref.end.previous?.at !== ref.lastAt ||
        (previous &&
          (ref.firstAt < previous.at ||
            ref.end.peak < doc.archives[i - 1].end.peak))
      )
        throw Error("Invalid history archive index.");
      chronology([ref.end.previous], account, previous);
      previous = ref.end.previous;
    }
    if (
      !same(doc.seed, doc.archives.at(-1)?.end ?? initialSeed(doc.initialCash))
    )
      throw Error(
        "History carry-forward state does not match the archive index.",
      );
    chronology(doc.samples, account, doc.seed.previous);
    return doc;
  }
  updateStatus(doc) {
    this.status = {
      loaded: true,
      count: doc.samples.length,
      totalCount:
        doc.seed.completeSamples + doc.seed.gapSamples + doc.samples.length,
      period: doc.period,
      archivedPeriods: doc.archives.length,
      lastSavedAt: doc.samples.at(-1)?.at ?? doc.seed.previous?.at ?? null,
      full:
        doc.samples.length >= MAX_PAPER_SAMPLES &&
        doc.archives.length >= MAX_PAPER_ARCHIVES,
      canRollover:
        doc.samples.length > 0 && doc.archives.length < MAX_PAPER_ARCHIVES,
      limit: MAX_PAPER_SAMPLES,
      archiveLimit: MAX_PAPER_ARCHIVES,
    };
  }
  async loadPeriod(doc, period, account) {
    if (period === undefined || period === doc.period) return doc;
    const ref = doc.archives.find((r) => r.period === period);
    if (!ref) throw Error("Recorded period does not exist.");
    if (!this.storage.readArchive)
      throw Error("History archive storage is unavailable.");
    const text = await this.storage.readArchive(ref.id);
    if (typeof text !== "string" || digest(text) !== ref.digest)
      throw Error("History archive checksum mismatch or missing file.");
    const saved = periodSchema.parse(JSON.parse(text));
    const seed =
      period === 1
        ? initialSeed(doc.initialCash)
        : doc.archives[period - 2].end;
    if (
      saved.accountId !== doc.accountId ||
      saved.initialCash !== doc.initialCash ||
      saved.period !== period ||
      saved.samples.length !== ref.count ||
      saved.samples[0].at !== ref.firstAt ||
      saved.samples.at(-1).at !== ref.lastAt ||
      !same(saved.seed, seed) ||
      !same(ending(saved), ref.end)
    )
      throw Error("History archive does not match its index.");
    chronology(saved.samples, account, seed.previous);
    return saved;
  }
  snapshot({ period } = {}) {
    return this.serial(async () => {
      if (period !== undefined) z.number().int().positive().parse(period);
      const account = await this.account.snapshot(),
        doc = await this.read(account);
      this.updateStatus(doc);
      const selected = await this.loadPeriod(doc, period, account);
      return {
        ...equitySeries(selected),
        ...this.status,
        count: selected.samples.length,
        selectedPeriod: selected.period,
        archived: selected.period !== doc.period,
        archives: doc.archives.map(({ end, ...ref }) => ref),
      };
    });
  }
  async rotate(doc, current = () => true) {
    if (!doc.samples.length)
      throw Error("No samples to archive in the current period.");
    if (doc.archives.length >= MAX_PAPER_ARCHIVES)
      throw Error(
        "History archive capacity reached (100 periods); all existing samples are retained.",
      );
    if (!this.storage.writeArchive || !this.storage.readArchive)
      throw Error(
        "History archive storage is unavailable; samples are retained.",
      );
    const payload = periodSchema.parse({
      version: 1,
      accountId: doc.accountId,
      initialCash: doc.initialCash,
      period: doc.period,
      seed: doc.seed,
      samples: doc.samples,
    });
    const text = JSON.stringify(payload),
      hash = digest(text),
      id = `period-${doc.period}-${hash}`;
    await this.storage.writeArchive(id, text);
    if ((await this.storage.readArchive(id)) !== text)
      throw Error(
        "History archive verification failed; current samples are retained.",
      );
    if (!current()) return null;
    const end = ending(doc);
    const next = archiveSchema.parse({
      ...doc,
      version: 2,
      period: doc.period + 1,
      seed: end,
      samples: [],
      archives: [
        ...doc.archives,
        {
          id,
          digest: hash,
          period: doc.period,
          count: doc.samples.length,
          firstAt: doc.samples[0].at,
          lastAt: doc.samples.at(-1).at,
          end,
        },
      ],
    });
    await this.storage.write(next);
    this.updateStatus(next);
    return next;
  }
  rollover({ expectedPeriod, expectedTotalCount }) {
    return this.serial(async () => {
      const account = await this.account.snapshot(),
        doc = await this.read(account);
      this.updateStatus(doc);
      if (
        expectedPeriod !== doc.period ||
        expectedTotalCount !== this.status.totalCount
      )
        throw Error("History changed elsewhere; refresh before rolling over.");
      await this.rotate(doc);
      return { ...this.status };
    });
  }
  record(account, quotes, at, sessionId, current = () => true) {
    return this.serial(async () => {
      if (!current()) return { saved: false };
      if (!account) throw Error("Create a paper account first.");
      let doc = await this.read(account);
      const last = doc.samples.at(-1) ?? doc.seed.previous;
      this.updateStatus(doc);
      if (this.status.full)
        throw Error(
          "Equity history capacity reached (100 archived periods plus current). Existing history is retained; paper execution continues.",
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
        doc.samples.length > 0 &&
        last &&
        last.sessionId === sessionId &&
        last.accountRevision === sample.accountRevision &&
        at - last.at < 60000 &&
        JSON.stringify(last.missingSymbols) === JSON.stringify(missingSymbols)
      )
        return { saved: false };
      if (!current()) return { saved: false };
      if (doc.samples.length >= MAX_PAPER_SAMPLES) {
        doc = await this.rotate(doc, current);
        if (!doc || !current()) return { saved: false };
      }
      const next = archiveSchema.parse({
        ...doc,
        version: 2,
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
