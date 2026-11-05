import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PaperAccount, paperAmendSchema } from "../core/paper-account.js";
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
  const a = new PaperAccount(opts),
    submit = async (patch = {}) =>
      a.submit({
        expectedRevision: (await a.snapshot()).revision,
        requestId: randomUUID(),
        input: {
          symbol: "BTCUSDT",
          side: "buy",
          type: "limit",
          price: 100,
          quantity: 1,
          feePercent: 0,
          ...patch,
        },
      });
  const args = async (id, patch = {}) => ({
    expectedRevision: (await a.snapshot()).revision,
    id,
    price: (await a.snapshot()).orders.find((o) => o.id === id).price,
    ...patch,
  });
  return {
    a,
    opts,
    submit,
    args,
    doc: () => structuredClone(doc),
    setDoc: (d) => (doc = d),
    tick: () => ++now,
    fail: (v) => (fail = v),
  };
}
test("resize preview and apply replace fee-inclusive reservations without double counting or writing during review", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 202 });
  let s = await f.submit({ feePercent: 1 });
  const id = s.orders[0].id,
    before = f.doc(),
    args = await f.args(id, { quantity: 2 });
  const p = await f.a.amendPreview(args);
  assert.deepEqual(f.doc(), before);
  assert.equal(p.cashReservationBefore, 101);
  assert.equal(p.cashReservationAfter, 202);
  assert.equal(p.availableCashAfter, 0);
  assert.equal(p.orders[0].quantity, 2);
  s = await f.a.amend(args);
  assert.equal(s.availableCash, 0);
  assert.equal(s.orders[0].id, id);
  assert.equal(s.orders[0].quantity, 2);
  assert.equal(f.doc().events[0].input.quantity, 1);
  await assert.rejects(f.a.amend(await f.args(id, { quantity: 2.01 })), /cash/);
  s = await f.a.amend(await f.args(id, { quantity: 0.5, price: 110 }));
  assert.equal(s.reservedCash, 55.55);
  assert.deepEqual(await new PaperAccount(f.opts).snapshot(), s);
  const e = f.doc().events[0];
  assert.equal(
    (
      await f.a.submit({
        expectedRevision: 1,
        requestId: e.requestId,
        input: e.input,
      })
    ).orders.length,
    1,
  );
});
test("bracket resizing requires explicit existing target quantities that sum to the entry, and preserves prices/source plan", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  const plan = { id: randomUUID(), revision: 3, name: "Two targets" };
  let s = await f.a.submit({
    expectedRevision: 1,
    requestId: randomUUID(),
    plan,
    input: {
      symbol: "BTCUSDT",
      side: "buy",
      type: "limit",
      price: 100,
      quantity: 1,
      feePercent: 0,
      bracket: {
        stop: 90,
        targets: [
          { price: 120, quantity: 0.4 },
          { price: 140, quantity: 0.6 },
        ],
      },
    },
  });
  const id = s.orders[0].id;
  for (const patch of [
    { quantity: 2 },
    { quantity: 2, targetQuantities: [2] },
    { quantity: 2, targetQuantities: [1, 2] },
    { targetQuantities: [0.5, 0.5] },
  ])
    await assert.rejects(
      f.a.amend(await f.args(id, patch)),
      /explicit|count|sum/,
    );
  s = await f.a.amend(
    await f.args(id, { quantity: 2, targetQuantities: [0.8, 1.2] }),
  );
  assert.deepEqual(s.orders[0].plan, plan);
  assert.equal(s.orders[0].bracket.stop, 90);
  assert.deepEqual(s.orders[0].bracket.targets, [
    { price: 120, quantity: 0.8 },
    { price: 140, quantity: 1.2 },
  ]);
  f.tick();
  s = (await f.a.process({ expectedRevision: s.revision, id })).account;
  assert.equal(s.positions.BTCUSDT.quantity, 2);
  assert.deepEqual(
    s.orders.slice(1).map((o) => o.quantity),
    [0.8, 0.8, 1.2, 1.2],
  );
  assert.deepEqual(await new PaperAccount(f.opts).snapshot(), s);
});
test("active OCO pairs resize together, count their reservation once, preserve their original cap and reject pre-edit quotes for both legs", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  let s = await f.submit({
    bracket: { stop: 90, targets: [{ price: 120, quantity: 1 }] },
  });
  s = (await f.a.process({ expectedRevision: s.revision, id: s.orders[0].id }))
    .account;
  const stop = s.orders.find((o) => o.leg === "stop"),
    target = s.orders.find((o) => o.leg === "target");
  const old = await f.opts.quote("BTCUSDT");
  f.tick();
  const args = await f.args(stop.id, { quantity: 0.4 }),
    p = await f.a.amendPreview(args);
  assert.equal(p.orders.length, 2);
  assert.equal(p.quantityReservationBefore, 1);
  assert.equal(p.quantityReservationAfter, 0.4);
  assert.equal(p.unreservedHoldingAfter, 0.6);
  s = await f.a.amend(args);
  assert.equal(s.reservedQuantity.BTCUSDT, 0.4);
  assert.equal(s.orders.find((o) => o.id === target.id).quantity, 0.4);
  assert.equal(
    s.orders.find((o) => o.id === target.id).amendedAt,
    s.orders.find((o) => o.id === stop.id).amendedAt,
  );
  assert.equal(
    (await f.a.evaluateSymbol("BTCUSDT", { ...old, bid: 125, ask: 126 }))
      .changed,
    false,
  );
  assert.equal(
    (
      await f.a.evaluateSymbol("BTCUSDT", {
        ...(await f.opts.quote("BTCUSDT")),
        bid: 125,
        ask: 126,
      })
    ).changed,
    false,
  );
  await assert.rejects(
    f.a.amend(await f.args(stop.id, { quantity: 1.1 })),
    /original target allocation/,
  );
  s = await f.submit({ side: "sell", price: 150, quantity: 0.3 });
  const independent = s.orders.at(-1).id;
  await assert.rejects(
    f.a.amend(await f.args(target.id, { quantity: 0.8 })),
    /unreserved held quantity/,
  );
  await f.a.cancel({ expectedRevision: s.revision, id: independent });
  s = await f.a.amend(await f.args(target.id, { quantity: 0.8 }));
  assert.equal(s.reservedQuantity.BTCUSDT, 0.8);
  f.tick();
  await f.a.evaluateSymbol("BTCUSDT", {
    ...(await f.opts.quote("BTCUSDT")),
    bid: 125,
    ask: 126,
  });
  s = await f.a.snapshot();
  assert.equal(s.positions.BTCUSDT.quantity, 0.2);
  assert.equal(s.orders.find((o) => o.id === stop.id).status, "cancelled");
  assert.equal(s.fills.at(-1).quantity, 0.8);
  assert.deepEqual(await new PaperAccount(f.opts).snapshot(), s);
});
test("exit resizing respects other reservations and permits exits while buys are paused", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  let s = await f.submit({ quantity: 2 });
  s = (await f.a.process({ expectedRevision: s.revision, id: s.orders[0].id }))
    .account;
  s = await f.submit({ side: "sell", price: 130, quantity: 0.5 });
  const id = s.orders.at(-1).id;
  await f.submit({ side: "sell", type: "stop", price: 90, quantity: 1 });
  s = await f.a.snapshot();
  s = await f.a.setRisk({
    expectedRevision: s.revision,
    policy: { ...s.risk, pauseBuys: true },
  });
  s = await f.a.amend(await f.args(id, { quantity: 1 }));
  assert.equal(s.reservedQuantity.BTCUSDT, 2);
  await assert.rejects(
    f.a.amend(await f.args(id, { quantity: 1.01 })),
    /unreserved held quantity/,
  );
  await assert.rejects(
    f.a.amend(await f.args(id, { quantity: 1, targetQuantities: [1] })),
    /bracket entry/,
  );
});
test("buy resize rechecks risk and edits fail atomically on conflicts, terminal state, no-op and storage failure", async () => {
  const f = fixture();
  await f.a.create({ initialCash: 1000 });
  let s = await f.submit();
  const id = s.orders[0].id;
  s = await f.a.setRisk({
    expectedRevision: s.revision,
    policy: { ...s.risk, maxOrderCost: 150 },
  });
  await assert.rejects(
    f.a.amend(await f.args(id, { quantity: 2 })),
    /per-order/,
  );
  const args = await f.args(id, { quantity: 1.5 });
  await f.a.amendPreview(args);
  const before = f.doc();
  f.fail(true);
  await assert.rejects(f.a.amend(args), /disk full/);
  assert.deepEqual(f.doc(), before);
  f.fail(false);
  s = await f.a.amend(args);
  await assert.rejects(f.a.amend(args), /changed elsewhere/);
  await assert.rejects(
    f.a.amend(await f.args(id, { quantity: 1.5 })),
    /different/,
  );
  f.tick();
  s = (await f.a.process({ expectedRevision: s.revision, id })).account;
  await assert.rejects(
    f.a.amend(await f.args(id, { quantity: 1 })),
    /no longer pending/,
  );
});
test("legacy v1-v4 archives are unchanged by previews and upgrade only on successful resize", async () => {
  for (const version of [1, 2, 3, 4]) {
    const f = fixture();
    await f.a.create({ initialCash: 1000 });
    const s = await f.submit(),
      id = s.orders[0].id;
    f.setDoc({ ...f.doc(), version });
    const before = f.doc(),
      args = await f.args(id, { quantity: 2 });
    await f.a.amendPreview(args);
    assert.deepEqual(f.doc(), before);
    await f.a.amend(args);
    assert.equal(f.doc().version, 5);
    assert.equal(
      (await new PaperAccount(f.opts).snapshot()).orders[0].quantity,
      2,
    );
  }
});
test("MCP preview is read-only, amendments require research, and quantity inputs remain strict", () => {
  const defs = toolDefinitions();
  assert.equal(
    defs.find((t) => t.name === "paper_amend_preview").capability,
    "read",
  );
  assert.equal(
    defs.find((t) => t.name === "paper_amend").capability,
    "research",
  );
  for (const patch of [
    { quantity: 0 },
    { quantity: Infinity },
    { quantity: 1e-9 },
    { quantity: 1.2345678901234567 },
    { targetQuantities: [] },
    { targetQuantities: [0] },
    { feePercent: 2 },
  ])
    assert.equal(
      paperAmendSchema.safeParse({
        id: randomUUID(),
        expectedRevision: 1,
        price: 100,
        ...patch,
      }).success,
      false,
    );
  assert.equal(
    paperAmendSchema.safeParse({
      id: randomUUID(),
      expectedRevision: 1,
      price: 100,
      quantity: 2,
      targetQuantities: [1, 1],
    }).success,
    true,
  );
});
