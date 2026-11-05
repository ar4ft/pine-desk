import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PaperAccount, paperAmendSchema } from "../core/paper-account.js";
import { paperOrderChart } from "../core/paper-order-chart.js";
import { toolDefinitions } from "../core/mcp-tools.js";
function fixture() {
  let doc = null,
    now = Date.now(),
    fail = false;
  const opts = {
    now: () => now,
    validateMarket: async () => {},
    storage: {
      read: async () => structuredClone(doc),
      write: async (d) => {
        if (fail) throw Error("disk full");
        doc = structuredClone(d);
      },
    },
    quote: async (symbol) => ({
      symbol,
      bid: 99,
      ask: 100,
      requestedAt: now,
      receivedAt: now,
      source: "Binance public bookTicker REST",
    }),
  };
  const a = new PaperAccount(opts);
  const submit = async (patch = {}, plan = null) =>
    a.submit({
      expectedRevision: (await a.snapshot()).revision,
      requestId: randomUUID(),
      input: {
        symbol: "BTCUSDT",
        side: "buy",
        type: "limit",
        quantity: 1,
        price: 100,
        feePercent: 0,
        ...patch,
      },
      plan,
    });
  const amend = async (id, price) =>
    a.amend({ expectedRevision: (await a.snapshot()).revision, id, price });
  return {
    a,
    opts,
    submit,
    amend,
    doc: () => structuredClone(doc),
    setDoc: (d) => (doc = d),
    fail: (v) => (fail = v),
    tick: () => ++now,
  };
}
test("price edits replace cash reservations including fees, preserve identity and replay original plan and submit", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 202 });
  const plan = { id: randomUUID(), revision: 2, name: "Entry thesis" };
  let s = await f.submit({ feePercent: 1 }, plan);
  const old = s.orders[0];
  s = await f.amend(old.id, 200);
  assert.equal(s.reservedCash, 202);
  assert.equal(s.availableCash, 0);
  assert.deepEqual(
    {
      ...s.orders[0],
      price: old.price,
      amendedAt: undefined,
      amendments: undefined,
    },
    { ...old, amendedAt: undefined, amendments: undefined },
  );
  await assert.rejects(f.amend(old.id, 201), /cash/);
  assert.deepEqual(await new PaperAccount(f.opts).snapshot(), s);
  const submitEvent = f.doc().events[0];
  assert.equal(
    (
      await f.a.submit({
        expectedRevision: 1,
        requestId: submitEvent.requestId,
        input: submitEvent.input,
        plan,
      })
    ).orders.length,
    1,
  );
  assert.equal(f.doc().events[0].input.price, 100);
});
test("amendments recheck risk without double reservation, reject malformed and no-op edits, and never persist failed writes", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  let s = await f.submit();
  const id = s.orders[0].id;
  await f.a.setRisk({
    expectedRevision: s.revision,
    policy: {
      ...s.risk,
      maxOrderCost: 150,
      maxSymbolCost: 150,
      maxTotalCost: 150,
    },
  });
  s = await f.amend(id, 150);
  assert.equal(s.riskUsage.totalCost, 150);
  const before = f.doc();
  await assert.rejects(f.amend(id, 151), /per-order/);
  await assert.rejects(f.amend(id, 150), /different/);
  for (const patch of [
    { price: 0 },
    { price: Infinity },
    { price: NaN },
    { quantity: 0 },
    { id: "bad" },
    { expectedRevision: 0 },
  ])
    assert.equal(
      paperAmendSchema.safeParse({
        id,
        price: 125,
        expectedRevision: s.revision,
        ...patch,
      }).success,
      false,
    );
  f.fail(true);
  await assert.rejects(f.amend(id, 125), /disk full/);
  f.fail(false);
  assert.deepEqual(f.doc(), before);
  await f.a.setRisk({
    expectedRevision: s.revision,
    policy: { ...s.risk, pauseBuys: true },
  });
  await assert.rejects(f.amend(id, 125), /paused/);
});
test("bracket entry edits preserve levels; linked exits cannot cross and remain editable with buys paused", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  let s = await f.submit({
    bracket: { stop: 90, targets: [{ price: 120, quantity: 1 }] },
  });
  const id = s.orders[0].id;
  await assert.rejects(f.amend(id, 90), /below/);
  await assert.rejects(f.amend(id, 120), /above/);
  s = await f.amend(id, 105);
  f.tick();
  s = (await f.a.process({ expectedRevision: s.revision, id })).account;
  const stop = s.orders.find((o) => o.leg === "stop"),
    target = s.orders.find((o) => o.leg === "target");
  await f.a.setRisk({
    expectedRevision: s.revision,
    policy: { ...s.risk, pauseBuys: true },
  });
  await assert.rejects(f.amend(stop.id, 120), /below/);
  await assert.rejects(f.amend(target.id, 90), /below/);
  await f.amend(stop.id, 95);
  s = await f.amend(target.id, 125);
  assert.equal(s.reservedQuantity.BTCUSDT, 1);
  f.tick();
  const q = await f.opts.quote("BTCUSDT");
  q.bid = 94;
  q.ask = 95;
  await f.a.evaluateSymbol("BTCUSDT", q);
  s = await f.a.snapshot();
  assert.equal(s.orders.find((o) => o.id === stop.id).status, "filled");
  assert.equal(s.orders.find((o) => o.id === target.id).status, "cancelled");
  await assert.rejects(f.amend(target.id, 130), /no longer pending/);
  assert.deepEqual(await new PaperAccount(f.opts).snapshot(), s);
});
test("pre-edit and same-millisecond quotes cannot fill an amended order; fresh quotes fill at updated price", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  let s = await f.submit({ price: 90 });
  const id = s.orders[0].id,
    old = await f.opts.quote("BTCUSDT");
  f.tick();
  s = await f.amend(id, 110);
  assert.equal((await f.a.evaluateSymbol("BTCUSDT", old)).changed, false);
  assert.equal(
    (await f.a.evaluateSymbol("BTCUSDT", await f.opts.quote("BTCUSDT")))
      .changed,
    false,
  );
  await assert.rejects(
    f.a.process({ expectedRevision: s.revision, id }),
    /predates/,
  );
  f.tick();
  assert.equal(
    (await f.a.evaluateSymbol("BTCUSDT", await f.opts.quote("BTCUSDT")))
      .changed,
    true,
  );
  s = await f.a.snapshot();
  assert.equal(s.orders[0].price, 110);
  assert.equal(s.fills[0].price, 100);
  await assert.rejects(f.amend(id, 120), /no longer pending/);
});
test("amend versus cancel or fill races serialize behind revision guards; market orders are ineligible", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  let s = await f.submit();
  const id = s.orders[0].id;
  const results = await Promise.allSettled([
    f.a.cancel({ expectedRevision: s.revision, id }),
    f.a.amend({ expectedRevision: s.revision, id, price: 110 }),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.match(results[1].reason.message, /changed elsewhere/);
  s = await f.submit();
  const next = s.orders.at(-1).id;
  const fill = await Promise.allSettled([
    f.a.process({ expectedRevision: s.revision, id: next }),
    f.a.amend({ expectedRevision: s.revision, id: next, price: 110 }),
  ]);
  assert.equal(fill[0].status, "fulfilled");
  assert.match(fill[1].reason.message, /changed elsewhere/);
  s = await f.submit({ type: "market", price: undefined, maxNotional: 120 });
  await assert.rejects(f.amend(s.orders.at(-1).id, 120), /Only pending/);
});
test("legacy v1-v4 accounts migrate on price edit, with no read-time rewrite", async () => {
  for (const version of [1, 2, 3, 4]) {
    const f = fixture();
    await f.a.create({ initialCash: 1000 });
    const s = await f.submit();
    f.setDoc({ ...f.doc(), version });
    await f.a.snapshot();
    assert.equal(f.doc().version, version);
    await f.amend(s.orders[0].id, 110);
    assert.equal(f.doc().version, 5);
    assert.equal(
      (await new PaperAccount(f.opts).snapshot()).orders[0].price,
      110,
    );
  }
});
test("chart reads use the selected order market and interval, never process orders, and reject terminal races", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  const s = await f.submit({ symbol: "ETHUSDT" }),
    id = s.orders[0].id,
    before = f.doc();
  const bars = [
    { time: 1, open: 100, high: 101, low: 99, close: 100, volume: 10 },
  ];
  const data = await paperOrderChart(
    f.a,
    { id, timeframe: "5m" },
    async (args) => {
      assert.deepEqual(args, {
        symbol: "ETHUSDT",
        timeframe: "5m",
        limit: 300,
      });
      return bars;
    },
  );
  assert.equal(data.orderId, id);
  assert.deepEqual(data.bars, bars);
  assert.deepEqual(f.doc(), before);
  await assert.rejects(
    paperOrderChart(f.a, { id, symbol: "BTCUSDT" }),
    /Unrecognized/,
  );
  await assert.rejects(
    paperOrderChart(f.a, { id }, async () => {
      await f.a.cancel({ expectedRevision: s.revision, id });
      return bars;
    }),
    /no longer pending/,
  );
});
test("MCP amendments require research and strict revision/price inputs; order charts are read-only", () => {
  const defs = toolDefinitions(),
    d = defs.find((x) => x.name === "paper_amend");
  assert.equal(d.capability, "research");
  assert.equal(d.action, "paperAmend");
  assert.equal(
    d.schema.safeParse({
      id: randomUUID(),
      price: 100,
      expectedRevision: 2,
      feePercent: 1,
    }).success,
    false,
  );
  assert.equal(
    defs.find((x) => x.name === "paper_order_chart").capability,
    "read",
  );
});
