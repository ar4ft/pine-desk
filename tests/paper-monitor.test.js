import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PaperAccount } from "../core/paper-account.js";
import { PaperMonitor, paperValuation } from "../core/paper-monitor.js";
function setup() {
  let doc = null,
    time = 10000,
    bid = 99,
    ask = 100,
    offline = false,
    writeFail = false,
    delay = null,
    calls = 0,
    timer;
  const account = new PaperAccount({
    storage: {
      read: async () => structuredClone(doc),
      write: async (d) => {
        if (writeFail) throw Error("disk full");
        doc = structuredClone(d);
      },
    },
    now: () => time,
    validateMarket: async () => {},
    quote: async (symbol) => {
      calls++;
      const requestedAt = time;
      if (delay) await delay;
      if (offline) throw Error("offline");
      return {
        symbol,
        bid,
        ask,
        requestedAt,
        receivedAt: time,
        source: "Binance public bookTicker REST",
      };
    },
  });
  const monitor = new PaperMonitor({
    account,
    now: () => time,
    clock: {
      setTimeout: (fn) => {
        timer = fn;
        return 1;
      },
      clearTimeout: () => {
        timer = null;
      },
    },
  });
  return {
    account,
    monitor,
    doc: () => doc,
    setDoc: (d) => {
      doc = d;
    },
    tick: async () => {
      time += 6000;
      timer?.();
      await monitor.running;
    },
    prices: (b, a) => {
      bid = b;
      ask = a;
    },
    advance: (n) => {
      time += n;
    },
    offline: (v) => {
      offline = v;
    },
    fail: (v) => {
      writeFail = v;
    },
    delay: (p) => {
      delay = p;
    },
    calls: () => calls,
  };
}
const entry = (extra = {}) => ({
  symbol: "BTCUSDT",
  side: "buy",
  type: "limit",
  price: 100,
  quantity: 2,
  feePercent: 0,
  slippage: 0,
  ...extra,
});
async function submit(a, input = entry(), extra = {}) {
  return a.submit({
    expectedRevision: (await a.snapshot()).revision,
    requestId: randomUUID(),
    input,
    ...extra,
  });
}
const bracket = {
  stop: 90,
  targets: [
    { price: 110, quantity: 0.5 },
    { price: 120, quantity: 1.5 },
  ],
};
test("linked targets share reservations, partial target cancels its stop, remaining stop gaps out", async () => {
  const f = setup(),
    a = f.account;
  await a.create({ initialCash: 1000 });
  let s = await submit(a, entry({ bracket }));
  s = (await a.process({ expectedRevision: s.revision, id: s.orders[0].id }))
    .account;
  assert.equal(s.orders.length, 5);
  assert.equal(s.reservedQuantity.BTCUSDT, 2);
  assert.equal(s.orders.filter((o) => o.status === "pending").length, 4);
  await assert.rejects(
    submit(a, entry({ side: "sell", quantity: 0.1 })),
    /Insufficient unreserved/,
  );
  f.prices(111, 112);
  const first = s.orders.find((o) => o.leg === "target");
  s = (await a.process({ expectedRevision: s.revision, id: first.id })).account;
  assert.equal(s.positions.BTCUSDT.quantity, 1.5);
  assert.equal(s.reservedQuantity.BTCUSDT, 1.5);
  assert.equal(
    s.orders.find((o) => o.ocoGroup === first.ocoGroup && o.leg === "stop")
      .status,
    "cancelled",
  );
  f.prices(80, 81);
  const stop = s.orders.find((o) => o.status === "pending" && o.leg === "stop");
  s = (await a.process({ expectedRevision: s.revision, id: stop.id })).account;
  assert.equal(s.positions.BTCUSDT.quantity, 0);
  assert.equal(s.fills.at(-1).price, 80);
  assert.equal(s.orders.filter((o) => o.status === "pending").length, 0);
  assert.equal(s.cash, 975.5);
  assert.equal((await a.snapshot()).fills.length, 3);
});
test("cancelling either linked child cancels the pair and releases just that slice", async () => {
  const f = setup(),
    a = f.account;
  await a.create({ initialCash: 1000 });
  let s = await submit(a, entry({ bracket }));
  s = (await a.process({ expectedRevision: s.revision, id: s.orders[0].id }))
    .account;
  const target = s.orders.find((o) => o.leg === "target");
  s = await a.cancel({ expectedRevision: s.revision, id: target.id });
  assert.equal(s.reservedQuantity.BTCUSDT, 1.5);
  assert.equal(
    s.orders.filter(
      (o) => o.ocoGroup === target.ocoGroup && o.status === "cancelled",
    ).length,
    2,
  );
  await submit(a, entry({ side: "sell", quantity: 0.5 }));
});
test("invalid brackets reject and contingent child slots are reserved before entry", async () => {
  const f = setup(),
    a = f.account;
  await a.create({ initialCash: 10000 });
  for (const b of [
    { ...bracket, stop: 101 },
    { ...bracket, targets: [{ price: 99, quantity: 2 }] },
    { ...bracket, targets: [{ price: 110, quantity: 1 }] },
    {
      ...bracket,
      targets: [
        { price: 120, quantity: 1 },
        { price: 110, quantity: 1 },
      ],
    },
  ])
    await assert.rejects(submit(a, entry({ bracket: b })));
  for (let i = 0; i < 10; i++) await submit(a, entry({ bracket }));
  await assert.rejects(submit(a), /50 pending/);
});
test("monitor fills entries once, activates exits for later quotes, marks equity and stops safely", async () => {
  const f = setup(),
    a = f.account,
    m = f.monitor;
  await a.create({ initialCash: 1000 });
  await submit(a, entry({ bracket }));
  await m.start();
  await m.running;
  let s = await m.snapshot();
  assert.equal(s.account.fills.length, 1);
  assert.equal(s.account.reservedQuantity.BTCUSDT, 2);
  assert.equal(s.valuation.equity, 998);
  assert.equal(s.valuation.unrealizedPnl, -2);
  f.prices(111, 112);
  await f.tick();
  s = await m.snapshot();
  assert.equal(s.account.fills.length, 2);
  assert.equal(s.account.positions.BTCUSDT.quantity, 1.5);
  f.prices(80, 81);
  await f.tick();
  s = await m.snapshot();
  assert.equal(s.account.fills.length, 3);
  assert.equal(s.valuation.equity, 975.5);
  const stopped = await m.stop();
  assert.equal(stopped.active, false);
  const n = f.calls();
  await f.tick();
  assert.equal(f.calls(), n);
  const reopened = new PaperMonitor({ account: a });
  assert.equal((await reopened.snapshot()).active, false);
});
test("unavailable/stale marks suppress totals; recovery uses current quotes without replaying crossings", async () => {
  const f = setup(),
    a = f.account,
    m = f.monitor;
  await a.create({ initialCash: 1000 });
  await submit(a);
  await m.start();
  await m.running;
  f.advance(16000);
  assert.equal((await m.snapshot()).valuation.equity, null);
  f.offline(true);
  await f.tick();
  let s = await m.snapshot();
  assert.match(s.errors.BTCUSDT, /offline/);
  assert.equal(s.valuation.complete, false);
  f.offline(false);
  f.prices(105, 106);
  await f.tick();
  s = await m.snapshot();
  assert.equal(s.valuation.equity, 1010);
  assert.equal(s.account.fills.length, 1);
  await m.stop();
  f.advance(16000);
  assert.equal((await m.snapshot()).valuation.equity, null);
});
test("stop invalidates fetched in-flight quotes before any fill can commit", async () => {
  const f = setup(),
    a = f.account,
    m = f.monitor;
  await a.create({ initialCash: 1000 });
  await submit(a);
  let release;
  f.delay(
    new Promise((r) => {
      release = r;
    }),
  );
  await m.start();
  while (f.calls() === 0) await new Promise((r) => setImmediate(r));
  const stopping = m.stop();
  release();
  await stopping;
  assert.equal((await a.snapshot()).fills.length, 0);
  assert.equal((await a.snapshot()).orders[0].status, "pending");
  f.delay(null);
  await m.start();
  await m.running;
  assert.equal((await a.snapshot()).fills.length, 1);
  await m.stop();
});
test("cancel during a network request wins and failed writes do not expose phantom fills", async () => {
  const f = setup(),
    a = f.account,
    m = f.monitor;
  await a.create({ initialCash: 1000 });
  let s = await submit(a);
  let release;
  f.delay(
    new Promise((r) => {
      release = r;
    }),
  );
  await m.start();
  while (f.calls() === 0) await new Promise((r) => setImmediate(r));
  await a.cancel({ expectedRevision: s.revision, id: s.orders[0].id });
  release();
  await m.running;
  assert.equal((await a.snapshot()).fills.length, 0);
  f.delay(null);
  await submit(a);
  f.fail(true);
  await f.tick();
  s = await m.snapshot();
  assert.equal(s.account.fills.length, 0);
  assert.match(s.errors.BTCUSDT, /disk full/);
  f.fail(false);
  await f.tick();
  assert.equal((await a.snapshot()).fills.length, 1);
  await m.stop();
});
test("version-1 accounts retain history and upgrade only when a mutation commits", async () => {
  const f = setup(),
    a = f.account;
  await a.create({ initialCash: 1000 });
  await submit(a);
  f.doc().version = 1;
  const original = structuredClone(f.doc());
  assert.equal((await a.snapshot()).orders.length, 1);
  assert.deepEqual(f.doc(), original);
  const s = await a.snapshot();
  await a.cancel({ expectedRevision: s.revision, id: s.orders[0].id });
  assert.equal(f.doc().version, 3);
  assert.deepEqual(f.doc().events[0], original.events[0]);
});
test("valuation does not present missing holdings or future quotes as zero-priced assets", () => {
  const a = {
    revision: 1,
    cash: 100,
    positions: {
      BTCUSDT: { quantity: 2, cost: 90 },
      ETHUSDT: { quantity: 1, cost: 50 },
    },
  };
  const v = paperValuation(
    a,
    { BTCUSDT: { bid: 50, requestedAt: 100, receivedAt: 100 } },
    200,
  );
  assert.equal(v.complete, false);
  assert.equal(v.equity, null);
  assert.equal(v.positions[0].unrealizedPnl, 10);
  assert.equal(v.positions[1].value, null);
  assert.equal(
    paperValuation(
      a,
      { BTCUSDT: { bid: 50, requestedAt: 300, receivedAt: 300 } },
      200,
    ).positions[0].stale,
    true,
  );
});
