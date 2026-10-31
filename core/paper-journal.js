import { z } from "zod";

export const journalInput = z
  .object({
    thesis: z.string().trim().max(2000),
    review: z.string().trim().max(4000),
    tags: z
      .array(z.string().trim().min(1).max(30))
      .max(10)
      .transform((tags) => [...new Set(tags.map((t) => t.toLowerCase()))]),
    adherence: z.enum(["unreviewed", "followed-plan", "deviated", "no-plan"]),
  })
  .strict();
export const emptyJournalInput = () => ({
  thesis: "",
  review: "",
  tags: [],
  adherence: "unreviewed",
});
const time = z.number().int().positive().max(8.64e15);
const entrySchema = z
  .object({
    orderId: z.string().uuid(),
    revision: z.number().int().positive(),
    createdAt: time,
    updatedAt: time,
    input: journalInput,
  })
  .strict();
const archive = z
  .object({
    version: z.literal(1),
    accountId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    entries: z.array(entrySchema).max(1000),
  })
  .strict();

export class PaperJournal {
  constructor({ account, storage, now = Date.now }) {
    this.account = account;
    this.storage = storage;
    this.now = now;
    this.queue = Promise.resolve();
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
        revision: 0,
        entries: [],
      };
    const doc = archive.parse(raw);
    if (doc.accountId !== account?.id)
      throw Error("Journal belongs to a different paper account.");
    if (doc.revision !== doc.entries.reduce((n, e) => n + e.revision, 0))
      throw Error("Invalid paper journal revision history.");
    const ids = new Set();
    for (const e of doc.entries) {
      const fill = account.fills.find((f) => f.orderId === e.orderId);
      if (
        !fill ||
        ids.has(e.orderId) ||
        e.createdAt < fill.at ||
        e.updatedAt < e.createdAt ||
        e.revision > doc.revision
      )
        throw Error(
          "Invalid paper journal references or revisions; archive was not reset.",
        );
      ids.add(e.orderId);
    }
    return doc;
  }
  snapshot() {
    return this.serial(async () => {
      const account = await this.account.snapshot(),
        doc = await this.read(account);
      return {
        accountId: doc.accountId,
        revision: doc.revision,
        entries: (account?.fills ?? []).map((fill) => {
          const entry = doc.entries.find((e) => e.orderId === fill.orderId),
            order = account.orders.find((o) => o.id === fill.orderId);
          return {
            orderId: fill.orderId,
            revision: entry?.revision ?? 0,
            createdAt: entry?.createdAt ?? null,
            updatedAt: entry?.updatedAt ?? null,
            input: entry?.input ?? emptyJournalInput(),
            fill,
            plan: order.plan,
            parentId: order.parentId ?? null,
            leg: order.leg ?? null,
          };
        }),
      };
    });
  }
  save({ orderId, expectedRevision, input }) {
    return this.serial(async () => {
      z.string().uuid().parse(orderId);
      z.number().int().nonnegative().parse(expectedRevision);
      input = journalInput.parse(input);
      const account = await this.account.snapshot();
      if (!account) throw Error("Create a paper account first.");
      const fill = account.fills.find((f) => f.orderId === orderId);
      if (!fill)
        throw Error(
          "Journal entries must reference an existing simulated fill.",
        );
      const doc = await this.read(account),
        previous = doc.entries.find((e) => e.orderId === orderId);
      if ((previous?.revision ?? 0) !== expectedRevision)
        throw Error(
          "Journal entry changed elsewhere; load the fill again before saving.",
        );
      const at = Math.max(this.now(), fill.at, previous?.updatedAt ?? 0);
      const entry = {
        orderId,
        revision: expectedRevision + 1,
        createdAt: previous?.createdAt ?? at,
        updatedAt: at,
        input,
      };
      const next = archive.parse({
        ...doc,
        revision: doc.revision + 1,
        entries: [...doc.entries.filter((e) => e.orderId !== orderId), entry],
      });
      await this.storage.write(next);
      return { ...entry, journalRevision: next.revision };
    });
  }
  close() {
    return this.queue;
  }
}
