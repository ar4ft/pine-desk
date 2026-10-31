import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PaperHistory,
  MAX_PAPER_SAMPLES,
  MAX_PAPER_ARCHIVES,
} from "../core/paper-history.js";
import { paperHistoryStorage } from "../core/paper-history-storage.js";
import { toolDefinitions } from "../core/mcp-tools.js";
function fixture() {
  let doc = null,
    at = 10000,
    bid = 100,
    writeFailure = false,
    archiveFailure = false,
    writes = 0;
  const blobs = new Map();
  const account = {
    id: randomUUID(),
    initialCash: 1000,
    createdAt: 10000,
    revision: 3,
    cash: 800,
    positions: { BTCUSDT: { quantity: 2, cost: 200 } },
  };
  const storage = {
    read: async () => structuredClone(doc),
    write: async (d) => {
      writes++;
      if (writeFailure === true || writes === writeFailure)
        throw Error("active disk full");
      doc = structuredClone(d);
    },
    readArchive: async (id) => blobs.get(id),
    writeArchive: async (id, text) => {
      if (archiveFailure) throw Error("archive disk full");
      if (blobs.has(id) && blobs.get(id) !== text)
        throw Error("immutable conflict");
      blobs.set(id, text);
    },
  };
  const opts = {
    account: { snapshot: async () => structuredClone(account) },
    storage,
  };
  const history = new PaperHistory(opts);
  const session = randomUUID();
  return {
    history,
    opts,
    account,
    blobs,
    storage,
    raw: () => structuredClone(doc),
    set: (d) => {
      doc = structuredClone(d);
    },
    advance: (ms = 60000) => {
      at += ms;
    },
    bid: (b) => {
      bid = b;
    },
    failWrite: (v) => {
      writeFailure = v;
    },
    failArchive: (v) => {
      archiveFailure = v;
    },
    writes: () => writes,
    record: () =>
      history.record(
        account,
        { BTCUSDT: { bid, requestedAt: at, receivedAt: at } },
        at,
        session,
      ),
    roll: async () => {
      const h = await history.snapshot();
      return history.rollover({
        expectedPeriod: h.period,
        expectedTotalCount: h.totalCount,
      });
    },
  };
}
test("rollover preserves sampled peaks, drawdown, timestamps, gaps and all older observations across restart", async () => {
  const f = fixture();
  await f.record();
  f.advance();
  f.bid(150);
  await f.record();
  const before = await f.history.snapshot();
  await f.roll();
  assert.equal(f.blobs.size, 1);
  let h = await f.history.snapshot();
  assert.equal(h.period, 2);
  assert.equal(h.count, 0);
  assert.equal(h.totalCount, 2);
  assert.equal(h.peak, 1100);
  f.advance();
  f.bid(90);
  await f.record();
  h = await f.history.snapshot();
  assert.equal(h.maxDrawdown, 120);
  assert.equal(h.samples[0].drawdownPercent, (120 / 1100) * 100);
  assert.equal(h.samples[0].gapBefore, false);
  assert.equal(h.completeSamples, 3);
  assert.equal(h.periodCompleteSamples, 1);
  const old = await f.history.snapshot({ period: 1 });
  assert.deepEqual(old.samples, before.samples);
  assert.equal(old.archived, true);
  assert.equal(old.peak, 1100);
  assert.equal(old.maxDrawdown, 0);
  assert.deepEqual(await new PaperHistory(f.opts).snapshot(), h);
  assert.equal(
    (await new PaperHistory(f.opts).snapshot({ period: 1 })).count,
    2,
  );
});
test("legacy v1 history is read without rewriting and rolls automatically at 10,000 samples", async () => {
  const f = fixture();
  await f.record();
  const current = f.raw(),
    first = current.samples[0];
  const legacy = {
    version: 1,
    accountId: current.accountId,
    initialCash: current.initialCash,
    samples: Array.from({ length: MAX_PAPER_SAMPLES }, (_, i) => ({
      ...first,
      at: first.at + i * 60000,
      oldestQuoteAt: first.at + i * 60000,
      newestQuoteAt: first.at + i * 60000,
    })),
  };
  f.set(legacy);
  await f.history.snapshot();
  assert.deepEqual(f.raw(), legacy);
  f.advance(MAX_PAPER_SAMPLES * 60000);
  await f.record();
  const h = await f.history.snapshot();
  assert.equal(h.period, 2);
  assert.equal(h.count, 1);
  assert.equal(h.totalCount, 10001);
  assert.equal(f.raw().version, 2);
  assert.deepEqual(
    (await f.history.snapshot({ period: 1 })).samples.map(
      ({
        equity,
        unrealizedPnl,
        peak,
        drawdown,
        drawdownPercent,
        gapBefore,
        ...raw
      }) => raw,
    ),
    legacy.samples,
  );
});
test("failed archive or index writes retain current history and deterministic retry never duplicates an archive", async () => {
  const f = fixture();
  await f.record();
  const before = f.raw();
  f.failArchive(true);
  await assert.rejects(f.roll(), /archive disk full/);
  assert.deepEqual(f.raw(), before);
  f.failArchive(false);
  f.failWrite(true);
  await assert.rejects(f.roll(), /active disk full/);
  assert.deepEqual(f.raw(), before);
  assert.equal(f.blobs.size, 1);
  f.failWrite(false);
  await f.roll();
  assert.equal(f.blobs.size, 1);
  assert.equal((await f.history.snapshot()).period, 2);
  await assert.rejects(
    f.history.rollover({ expectedPeriod: 1, expectedTotalCount: 1 }),
    /changed elsewhere/,
  );
  await assert.rejects(f.roll(), /No samples/);
});
test("an interrupted first write in the next automatic period preserves the archive and retries safely", async () => {
  const f = fixture();
  await f.record();
  const doc = f.raw(),
    first = doc.samples[0];
  doc.samples = Array.from({ length: MAX_PAPER_SAMPLES }, () => ({ ...first }));
  f.set(doc);
  f.advance();
  f.failWrite(f.writes() + 2); // rollover index succeeds, new sample write fails
  await assert.rejects(f.record(), /active disk full/);
  assert.equal(f.raw().period, 2);
  assert.equal(f.raw().samples.length, 0);
  assert.equal((await f.history.snapshot({ period: 1 })).count, 10000);
  f.failWrite(false);
  await f.record();
  assert.equal((await f.history.snapshot()).totalCount, 10001);
  assert.equal(f.blobs.size, 1);
});
test("checksum and manifest corruption fail explicitly and never reset retained data", async () => {
  const f = fixture();
  await f.record();
  await f.roll();
  const doc = f.raw(),
    id = doc.archives[0].id,
    text = f.blobs.get(id);
  f.blobs.set(id, text + " ");
  await assert.rejects(f.history.snapshot({ period: 1 }), /checksum/);
  assert.deepEqual(f.raw(), doc);
  f.blobs.delete(id);
  await assert.rejects(f.history.snapshot({ period: 1 }), /checksum|missing/);
  f.blobs.set(id, text);
  const bad = structuredClone(doc);
  bad.seed.peak += 1;
  f.set(bad);
  await assert.rejects(f.history.snapshot(), /carry-forward/);
  f.set(doc);
  await assert.rejects(f.history.snapshot({ period: 99 }), /does not exist/);
});
test("100 archived periods stop further rollover without deleting anything; current samples remain usable", async () => {
  const f = fixture();
  for (let i = 0; i < MAX_PAPER_ARCHIVES; i++) {
    await f.record();
    await f.roll();
    f.advance();
  }
  await f.record();
  await assert.rejects(f.roll(), /capacity/);
  assert.equal(f.blobs.size, 100);
  const h = await f.history.snapshot();
  assert.equal(h.period, 101);
  assert.equal(h.canRollover, false);
  assert.equal(h.full, false);
  const doc = f.raw();
  doc.samples = Array.from({ length: MAX_PAPER_SAMPLES }, () => ({
    ...doc.samples[0],
  }));
  f.set(doc);
  f.advance();
  await assert.rejects(f.record(), /capacity/);
  assert.equal((await f.history.snapshot()).full, true);
  assert.equal((await f.history.snapshot({ period: 1 })).count, 1);
});
test("archive filesystem commits immutable files and refuses conflicting rewrites or path traversal", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pine-history-roll-"));
  try {
    const storage = paperHistoryStorage(dir),
      content = '{"sample":1}',
      hash = createHash("sha256").update(content).digest("hex"),
      id = `period-1-${hash}`;
    await storage.writeArchive(id, content);
    await storage.writeArchive(id, content);
    assert.equal(await storage.readArchive(id), content);
    await assert.rejects(storage.writeArchive(id, "different"), /conflicts/);
    assert.equal(await storage.readArchive(id), content);
    await assert.rejects(storage.readArchive("../../secret"), /Invalid/);
    assert.deepEqual(await fs.readdir(path.join(dir, "archives")), [
      `${id}.json`,
    ]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("rollover is a research action; archive period reads do not grant writes", () => {
  const defs = toolDefinitions();
  const read = defs.find((d) => d.name === "paper_history"),
    roll = defs.find((d) => d.name === "paper_history_rollover");
  assert.equal(read.capability, "read");
  assert.equal(read.schema.safeParse({ period: 2 }).success, true);
  assert.equal(roll.capability, "research");
  assert.equal(
    roll.schema.safeParse({ expectedPeriod: 1, expectedTotalCount: 10000 })
      .success,
    true,
  );
});

test("stop during archive creation leaves current samples in place and permits a safe retry", async () => {
  const f = fixture();
  await f.record();
  const before = f.raw(),
    write = f.storage.writeArchive;
  let active = true;
  f.storage.writeArchive = async (...args) => {
    await write(...args);
    active = false;
  };
  assert.equal(await f.history.rotate(before, () => active), null);
  assert.deepEqual(f.raw(), before);
  assert.equal(f.blobs.size, 1);
  f.storage.writeArchive = write;
  await f.roll();
  assert.equal(f.blobs.size, 1);
  assert.equal((await f.history.snapshot({ period: 1 })).count, 1);
});
