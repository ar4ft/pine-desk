import test from "node:test";
import assert from "node:assert/strict";
import { estimatePlan, TradePlans } from "../core/trade-plans.js";
import { toolDefinitions } from "../core/mcp-tools.js";
const input = (extra = {}) => ({
  name: "Plan",
  symbol: "TEST",
  venue: "Fixture",
  currency: "USD",
  side: "long",
  assetType: "spot",
  equity: 10000,
  riskPercent: 1,
  entry: 100,
  stop: 90,
  quantityStep: 1,
  multiplier: 1,
  feePercent: 0,
  slippage: 0,
  maxNotional: 10000,
  targets: [{ price: 120, percent: 100 }],
  ...extra,
});
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
test("long and short sizing includes adverse entry/exit slippage and fees", () => {
  const base = estimatePlan(input());
  assert.equal(base.quantity, 10);
  assert.equal(base.risk, 100);
  assert.equal(base.projectedReward, 200);
  assert.equal(base.rewardRisk, 2);
  const long = estimatePlan(input({ feePercent: 1, slippage: 1 }));
  assert.equal(long.entryFill, 101);
  assert.equal(long.stopFill, 89);
  assert.equal(long.quantity, 7);
  near(long.risk, 97.3);
  near(long.projectedReward, 110.6);
  const short = estimatePlan(
    input({
      side: "short",
      stop: 110,
      targets: [{ price: 80, percent: 100 }],
      feePercent: 1,
      slippage: 1,
    }),
  );
  assert.equal(short.entryFill, 99);
  assert.equal(short.stopFill, 111);
  assert.equal(short.quantity, 7);
  near(short.risk, 98.7);
  near(short.projectedReward, 113.4);
  assert.match(short.warnings.join(" "), /Borrow/);
});
test("quantity floors respect risk and notional caps with decimal increments", () => {
  for (const step of [1, 0.1, 0.01, 0.00001]) {
    const r = estimatePlan(
      input({
        quantityStep: step,
        maxNotional: 235.67,
        feePercent: 0.1,
        slippage: 0.25,
      }),
    );
    assert.ok(r.risk <= r.riskBudget);
    assert.ok(r.entryNotional <= 235.67);
    near(r.quantity / step, Math.round(r.quantity / step));
  }
  assert.equal(estimatePlan(input({ maxNotional: 250 })).quantity, 2);
  const none = estimatePlan(input({ maxNotional: 50 }));
  assert.equal(none.quantity, 0);
  assert.equal(none.rewardRisk, null);
  assert.match(none.warnings.join(" "), /cannot fund/);
});
test("linear contract multipliers and rounded target allocations use actual quantity", () => {
  const linear = estimatePlan(
    input({ assetType: "linear", multiplier: 50, stop: 98 }),
  );
  assert.equal(linear.quantity, 1);
  assert.equal(linear.risk, 100);
  assert.equal(linear.entryNotional, 5000);
  const multi = estimatePlan(
    input({
      maxNotional: 500,
      targets: [
        { price: 110, percent: 50 },
        { price: 120, percent: 30 },
        { price: 130, percent: 20 },
      ],
    }),
  );
  assert.deepEqual(
    multi.targets.map((t) => t.quantity),
    [2, 1, 2],
  );
  assert.equal(multi.projectedReward, 100);
  assert.equal(multi.rewardRisk, 2);
  const small = estimatePlan(
    input({
      maxNotional: 100,
      targets: [
        { price: 110, percent: 50 },
        { price: 120, percent: 50 },
      ],
    }),
  );
  assert.deepEqual(
    small.targets.map((t) => t.quantity),
    [0, 1],
  );
  assert.match(small.warnings.join(" "), /remaining increments/);
});
test("invalid directions, target allocations, nonlinear models and numeric overflow fail", () => {
  for (const patch of [
    { stop: 101 },
    { targets: [{ price: 99, percent: 100 }] },
    { targets: [{ price: 120, percent: 90 }] },
    {
      targets: [
        { price: 120, percent: 50 },
        { price: 110, percent: 50 },
      ],
    },
    { assetType: "option" },
    { multiplier: 50 },
    { currency: "" },
    { equity: Infinity },
    { quantityStep: 1e-10 },
    { slippage: 100 },
    { entry: 1e308, stop: 1e307, targets: [{ price: 1.5e308, percent: 100 }] },
    { equity: 1e20, maxNotional: 1e20, quantityStep: 0.00000001 },
  ])
    assert.throws(() => estimatePlan(input(patch)));
});
function repo() {
  let doc = null,
    fail = false;
  return {
    storage: {
      read: async () => structuredClone(doc),
      write: async (next) => {
        if (fail) throw Error("disk full");
        doc = structuredClone(next);
      },
    },
    fail: (v) => {
      fail = v;
    },
    doc: () => doc,
  };
}
test("plans persist with immutable returned snapshots, optimistic revisions and safe failed writes", async () => {
  const r = repo(),
    plans = new TradePlans({ storage: r.storage, now: () => 1000 });
  const a = await plans.save({ input: input() });
  assert.equal(a.revision, 1);
  a.estimate.input.name = "tampered";
  assert.equal((await plans.get(a.id)).estimate.input.name, "Plan");
  const edits = await Promise.allSettled([
    plans.save({
      id: a.id,
      expectedRevision: 1,
      input: input({ name: "one" }),
    }),
    plans.save({
      id: a.id,
      expectedRevision: 1,
      input: input({ name: "two" }),
    }),
  ]);
  assert.equal(edits.filter((e) => e.status === "fulfilled").length, 1);
  assert.match(
    edits.find((e) => e.status === "rejected").reason.message,
    /changed elsewhere/,
  );
  const saved = await plans.get(a.id);
  assert.equal(saved.revision, 2);
  r.fail(true);
  await assert.rejects(
    plans.save({
      id: a.id,
      expectedRevision: 2,
      input: input({ name: "failed" }),
    }),
    /disk full/,
  );
  r.fail(false);
  assert.equal((await plans.get(a.id)).revision, 2);
  const reopened = new TradePlans({ storage: r.storage });
  assert.equal((await reopened.list()).length, 1);
  assert.equal((await reopened.get(a.id)).estimate.input.name, "one");
  await assert.rejects(
    reopened.remove({ id: a.id, expectedRevision: 1 }),
    /changed elsewhere/,
  );
  await reopened.remove({ id: a.id, expectedRevision: 2 });
  assert.equal((await reopened.list()).length, 0);
});
test("archive corruption and altered saved calculations fail rather than being replaced", async () => {
  const r = repo(),
    plans = new TradePlans({ storage: r.storage });
  await plans.save({ input: input() });
  r.doc().plans[0].estimate.quantity = 999;
  await assert.rejects(plans.list(), /does not match/);
  r.doc().version = 999;
  await assert.rejects(
    plans.save({ input: input() }),
    /invalid or unsupported/,
  );
});
test("plan tools separate read estimates from durable research mutations", () => {
  const defs = toolDefinitions();
  for (const name of ["plan_estimate", "plan_get", "plans_list"])
    assert.equal(defs.find((t) => t.name === name).capability, "read");
  for (const name of ["plan_save", "plan_delete"])
    assert.equal(defs.find((t) => t.name === name).capability, "research");
  const estimate = defs.find((t) => t.name === "plan_estimate");
  assert.equal(estimate.schema.parse({ input: input() }).input.multiplier, 1);
  assert.throws(() =>
    estimate.schema.parse({ input: { ...input(), execute: true } }),
  );
  assert.equal(
    defs
      .find((t) => t.name === "desktop_navigate")
      .schema.parse({ page: "plans" }).page,
    "plans",
  );
});
