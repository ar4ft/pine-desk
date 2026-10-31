import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PaperAccount } from "../core/paper-account.js";
import { PaperJournal, emptyJournalInput } from "../core/paper-journal.js";
import { PaperHistory, MAX_PAPER_SAMPLES } from "../core/paper-history.js";
import { PaperMonitor, paperValuation } from "../core/paper-monitor.js";
import { toolDefinitions } from "../core/mcp-tools.js";
const memory = () => {
  let doc = null,
    fail = false;
  return {
    read: async () => structuredClone(doc),
    write: async (d) => {
      if (fail) throw Error("disk full");
      doc = structuredClone(d);
    },
    raw: () => structuredClone(doc),
    set: (d) => {
      doc = structuredClone(d);
    },
    fail: (v) => {
      fail = v;
    },
  };
};
function fixture() {
  let at = Date.UTC(2026, 9, 30, 12),
    bid = 99,
    ask = 100,
    offline = false;
  const storage = memory(),
    journalStore = memory(),
    historyStore = memory();
  const a = new PaperAccount({
    storage,
    now: () => at,
    validateMarket: async () => {},
    quote: async (symbol) => {
      if (offline) throw Error("offline");
      return {
        symbol,
        bid,
        ask,
        requestedAt: at,
        receivedAt: at,
        source: "Binance public bookTicker REST",
      };
    },
  });
  const journal = new PaperJournal({
    account: a,
    storage: journalStore,
    now: () => at,
  });
  const history = new PaperHistory({ account: a, storage: historyStore });
  const monitor = new PaperMonitor({
    account: a,
    history,
    now: () => at,
    clock: { setTimeout: () => 1, clearTimeout: () => {} },
  });
  const submit = async (patch = {}, extra = {}) =>
    a.submit({
      expectedRevision: (await a.snapshot()).revision,
      requestId: randomUUID(),
      input: {
        symbol: "BTCUSDT",
        side: "buy",
        type: "market",
        quantity: 2,
        maxNotional: 220,
        feePercent: 0,
        ...patch,
      },
      ...extra,
    });
  const fill = async () => {
    const s = await a.snapshot();
    return a.process({ expectedRevision: s.revision, id: s.orders.at(-1).id });
  };
  const record = async (
    session = "11111111-1111-4111-a111-111111111111",
    quotes,
  ) =>
    history.record(
      await a.snapshot(),
      quotes ?? { BTCUSDT: await a.quote("BTCUSDT") },
      at,
      session,
    );
  return {
    a,
    journal,
    history,
    monitor,
    storage,
    journalStore,
    historyStore,
    submit,
    fill,
    record,
    time: () => at,
    advance: (ms = 60000) => {
      at += ms;
    },
    prices: (b, q = b + 1) => {
      bid = b;
      ask = q;
    },
    offline: (v) => {
      offline = v;
    },
  };
}
test("journal binds annotations to immutable fills/plans and persists independently of account revisions", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  const plan = { id: randomUUID(), revision: 3, name: "Original plan" };
  await f.submit({}, { plan });
  await f.fill();
  const before = f.storage.raw(),
    j = await f.journal.snapshot(),
    row = j.entries[0];
  assert.equal(row.revision, 0);
  assert.deepEqual(row.plan, plan);
  const saved = await f.journal.save({
    orderId: row.orderId,
    expectedRevision: 0,
    input: {
      ...emptyJournalInput(),
      thesis: " Breakout ",
      review: "Used the wrong size",
      tags: ["Setup", "setup"],
      adherence: "deviated",
    },
  });
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.input.tags, ["setup"]);
  assert.equal(saved.input.thesis, "Breakout");
  assert.deepEqual(f.storage.raw(), before);
  const reopened = new PaperJournal({ account: f.a, storage: f.journalStore });
  assert.equal(
    (await reopened.snapshot()).entries[0].input.review,
    "Used the wrong size",
  );
  assert.equal((await reopened.snapshot()).entries[0].fill.price, 100);
  assert.equal((await reopened.snapshot()).entries[0].plan.revision, 3);
});
test("journal refuses stale/concurrent edits, nonfills, invalid input and failed writes without losing notes", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  const s = await f.submit();
  const args = {
    orderId: s.orders[0].id,
    expectedRevision: 0,
    input: emptyJournalInput(),
  };
  await assert.rejects(f.journal.save(args), /existing simulated fill/);
  await f.fill();
  const results = await Promise.allSettled([
    f.journal.save(args),
    f.journal.save(args),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await assert.rejects(f.journal.save(args), /changed elsewhere/);
  const before = f.journalStore.raw();
  f.journalStore.fail(true);
  await assert.rejects(
    f.journal.save({
      ...args,
      expectedRevision: 1,
      input: { ...args.input, review: "Lost write" },
    }),
    /disk full/,
  );
  assert.deepEqual(f.journalStore.raw(), before);
  f.journalStore.fail(false);
  await assert.rejects(
    f.journal.save({
      ...args,
      expectedRevision: 1,
      input: { ...args.input, review: "x".repeat(4001) },
    }),
  );
  await assert.rejects(
    f.journal.save({
      ...args,
      expectedRevision: 1,
      input: { ...args.input, quote: { bid: 1 } },
    }),
  );
  const cleared = await f.journal.save({ ...args, expectedRevision: 1 });
  assert.equal(cleared.revision, 2);
});
test("journal rejects corrupt or foreign archives instead of resetting", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  await f.submit();
  await f.fill();
  const e = (await f.journal.snapshot()).entries[0];
  await f.journal.save({
    orderId: e.orderId,
    expectedRevision: 0,
    input: emptyJournalInput(),
  });
  const good = f.journalStore.raw();
  for (const raw of [
    false,
    { ...good, accountId: randomUUID() },
    { ...good, revision: 99 },
    { ...good, entries: [...good.entries, good.entries[0]] },
    { ...good, entries: [{ ...good.entries[0], orderId: randomUUID() }] },
  ]) {
    f.journalStore.set(raw);
    await assert.rejects(f.journal.snapshot());
    assert.deepEqual(f.journalStore.raw(), raw);
  }
});
test("equity history records bid marks and sampled drawdown, throttles unchanged accounts and never mutates the order ledger", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  await f.submit();
  await f.fill();
  const ledger = f.storage.raw();
  await f.record();
  f.advance(5000);
  f.prices(110);
  assert.equal((await f.record()).saved, false);
  f.advance(55000);
  await f.record();
  f.advance();
  f.prices(90);
  await f.record();
  const h = await f.history.snapshot();
  assert.deepEqual(
    h.samples.map((s) => s.equity),
    [998, 1020, 980],
  );
  assert.equal(h.samples[0].drawdown, 2);
  assert.equal(h.maxDrawdown, 40);
  assert.equal(h.maxDrawdownPercent, (40 / 1020) * 100);
  assert.equal(h.samples[2].unrealizedPnl, -20);
  assert.equal(h.samples[1].gapBefore, false);
  assert.deepEqual(f.storage.raw(), ledger);
  assert.deepEqual(
    await new PaperHistory({
      account: f.a,
      storage: f.historyStore,
    }).snapshot(),
    h,
  );
});
test("missing quotes, recovery, session boundaries and long intervals preserve gaps and never substitute zero equity", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  await f.submit();
  await f.fill();
  await f.record();
  f.advance(5000);
  await f.record(undefined, {});
  f.advance(5000);
  f.prices(80);
  await f.record();
  f.advance(5000);
  await f.record(randomUUID());
  f.advance(120000);
  await f.record();
  const h = await f.history.snapshot();
  assert.equal(h.samples.length, 5);
  assert.equal(h.samples[1].equity, null);
  assert.equal(h.samples[1].drawdown, null);
  assert.deepEqual(h.samples[1].missingSymbols, ["BTCUSDT"]);
  assert.equal(h.gapSamples, 1);
  assert.ok(h.samples.every((s) => s.gapBefore));
  assert.equal(h.maxDrawdown, 40);
});
test("account changes bypass sampling interval; cash-only history has complete marks without quotes", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  await f.record(undefined, {});
  await f.submit();
  await f.fill();
  f.advance(1000);
  await f.record();
  const h = await f.history.snapshot();
  assert.equal(h.count, 2);
  assert.equal(h.samples[0].equity, 1000);
  assert.equal(h.samples[0].oldestQuoteAt, null);
  assert.equal(h.samples[1].accountRevision, 3);
});
test("history handles failed writes, invalid clocks, foreign/corrupt data and cancellation without pruning", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  await f.record(undefined, {});
  const good = f.historyStore.raw();
  f.advance();
  f.historyStore.fail(true);
  await assert.rejects(f.record(undefined, {}), /disk full/);
  assert.deepEqual(f.historyStore.raw(), good);
  assert.equal(f.history.status.count, 1);
  f.historyStore.fail(false);
  assert.equal(
    (
      await f.history.record(
        await f.a.snapshot(),
        {},
        f.time(),
        randomUUID(),
        () => false,
      )
    ).saved,
    false,
  );
  f.advance(-120000);
  await assert.rejects(f.record(undefined, {}), /Clock moved backwards/);
  for (const raw of [
    false,
    { ...good, accountId: randomUUID() },
    { ...good, samples: [{ ...good.samples[0], positionValue: null }] },
    { ...good, samples: [{ ...good.samples[0], accountRevision: 999 }] },
  ]) {
    f.historyStore.set(raw);
    await assert.rejects(f.history.snapshot());
    assert.deepEqual(f.historyStore.raw(), raw);
  }
});
test("full equity history remains exportable and stops recording without deleting any sample", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  await f.record(undefined, {});
  const doc = f.historyStore.raw(),
    first = doc.samples[0];
  doc.samples = Array.from({ length: MAX_PAPER_SAMPLES }, (_, i) => ({
    ...first,
    at: first.at + i * 60000,
  }));
  f.historyStore.set(doc);
  f.advance(MAX_PAPER_SAMPLES * 60000);
  await assert.rejects(f.record(undefined, {}), /history is full/);
  assert.equal((await f.history.snapshot()).count, MAX_PAPER_SAMPLES);
  assert.deepEqual(f.historyStore.raw(), doc);
});
test("monitor records after fills, reports history failures without stopping execution, and does not restore live marks on restart", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  await f.submit();
  f.historyStore.fail(true);
  try {
    await f.monitor.start();
    await f.monitor.running;
    let s = await f.monitor.snapshot();
    assert.equal(s.account.fills.length, 1);
    assert.equal(s.active, true);
    assert.match(s.history.error, /disk full/);
    f.historyStore.fail(false);
    f.advance(5000);
    await f.monitor.cycle();
    s = await f.monitor.snapshot();
    assert.equal(s.history.error, null);
    assert.equal(s.history.count, 1);
    await f.monitor.stop();
    const before = f.historyStore.raw();
    const reopened = new PaperMonitor({
      account: f.a,
      history: new PaperHistory({ account: f.a, storage: f.historyStore }),
      now: () => f.time(),
    });
    assert.equal((await reopened.snapshot()).valuation.equity, null);
    assert.equal((await reopened.snapshot()).active, false);
    assert.deepEqual(f.historyStore.raw(), before);
    await reopened.close();
  } finally {
    await f.monitor.close();
  }
});
test("valuation refuses future request times, nonfinite bids and stale marks", () => {
  const a = {
    revision: 1,
    cash: 100,
    positions: { BTCUSDT: { quantity: 1, cost: 100 } },
  };
  for (const q of [
    { bid: -1, requestedAt: 100, receivedAt: 100 },
    { bid: Infinity, requestedAt: 100, receivedAt: 100 },
    { bid: 10, requestedAt: 300, receivedAt: 100 },
  ]) {
    assert.equal(paperValuation(a, { BTCUSDT: q }, 200).equity, null);
  }
  assert.equal(
    paperValuation(
      a,
      { BTCUSDT: { bid: 10, requestedAt: 100, receivedAt: 100 } },
      20000,
    ).equity,
    null,
  );
  assert.equal(
    paperValuation(
      a,
      { BTCUSDT: { bid: 10, requestedAt: 100, receivedAt: 100 } },
      200,
    ).equity,
    110,
  );
});
test("journal/history MCP reads are read-only; note writes require research and reject quote or equity injection", () => {
  const defs = toolDefinitions();
  for (const name of ["paper_history", "paper_journal"]) {
    const d = defs.find((d) => d.name === name);
    assert.equal(d.capability, "read");
    assert.equal(d.schema.safeParse({ equity: 10000 }).success, false);
  }
  const d = defs.find((d) => d.name === "paper_journal_save");
  assert.equal(d.capability, "research");
  assert.equal(
    d.schema.safeParse({
      orderId: randomUUID(),
      expectedRevision: 0,
      input: emptyJournalInput(),
    }).success,
    true,
  );
});
