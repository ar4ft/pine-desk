import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sizePaperOrder, paperSizingSchema } from "../core/paper-sizing.js";
import { toolDefinitions } from "../core/mcp-tools.js";
import { performanceFixture } from "./helpers/paper-performance.js";
const input = (patch = {}) => ({
  symbol: "BTCUSDT",
  price: 100,
  stop: 90,
  riskBudget: 20,
  maxNotional: 1000,
  quantityStep: 0.1,
  feePercent: 0,
  slippage: 0,
  targets: [{ price: 120, percent: 100 }],
  ...patch,
});
test("cash sizing includes entry/stop fees and slippage, and rounds down under both caps", () => {
  const s = sizePaperOrder(input({ feePercent: 1, slippage: 1 }));
  assert.equal(s.entryFill, 101);
  assert.equal(s.stopFill, 89);
  assert.equal(s.perUnitRisk, 13.9);
  assert.equal(s.quantity, 1.4);
  assert.ok(s.risk <= 20);
  assert.equal(s.order.price, 100);
  const capped = sizePaperOrder(
    input({ maxNotional: 150, feePercent: 1, slippage: 1 }),
  );
  assert.equal(capped.quantity, 1.4);
  assert.ok(capped.entryNotional <= 150);
  assert.equal(capped.estimatedEntryCost, capped.entryNotional * 1.01);
  // Preserve the shared plan model's conservative floating-point boundary.
  assert.equal(sizePaperOrder(input({ maxNotional: 30 })).quantity, 0.2);
});
test("whole-increment allocation gives the remainder to the final target and rejects empty slices", () => {
  const s = sizePaperOrder(
    input({
      riskBudget: 11,
      targets: [
        { price: 110, percent: 33 },
        { price: 120, percent: 33 },
        { price: 130, percent: 34 },
      ],
    }),
  );
  assert.deepEqual(
    s.order.bracket.targets.map((t) => t.quantity),
    [0.3, 0.3, 0.5],
  );
  assert.equal(s.quantity, 1.1);
  assert.throws(() => sizePaperOrder(input({ riskBudget: 0.1 })), /empty/);
  assert.throws(
    () =>
      sizePaperOrder(
        input({
          riskBudget: 1,
          targets: [
            { price: 110, percent: 50 },
            { price: 120, percent: 50 },
          ],
        }),
      ),
    /empty/,
  );
  assert.throws(
    () =>
      sizePaperOrder(
        input({ riskBudget: 1e12, quantityStep: 1e-8, maxNotional: 1e12 }),
      ),
    /increments/,
  );
});
test("sizing rejects invalid allocation, direction, precision/capacity and unsupported fields", () => {
  for (const patch of [
    { stop: 100 },
    { stop: 1, slippage: 2 },
    { riskBudget: 0 },
    { quantityStep: 0 },
    { feePercent: 6 },
    { targets: [{ price: 110, percent: 90 }] },
    {
      targets: [
        { price: 120, percent: 50 },
        { price: 110, percent: 50 },
      ],
    },
    { targets: [{ price: 110, percent: 0.5 }] },
    { side: "sell" },
    { expectedRevision: 1 },
  ])
    assert.throws(() => sizePaperOrder(input(patch)));
  assert.throws(
    () =>
      sizePaperOrder(
        input({
          price: 1e-6,
          stop: 1e-7,
          riskBudget: 1e6,
          maxNotional: 1e6,
          quantityStep: 1,
          targets: [{ price: 1, percent: 100 }],
        }),
      ),
    /quantity|1000000000/,
  );
  assert.equal(paperSizingSchema.parse(input()).symbol, "BTCUSDT");
});
test("sizing makes no account changes; review enforces available cash and risk separately, then submit preserves calculated slices", async () => {
  const f = performanceFixture();
  await f.a.create({ initialCash: 150 });
  const before = f.raw(),
    sized = sizePaperOrder(input());
  assert.deepEqual(f.raw(), before);
  await assert.rejects(
    f.a.preview({ expectedRevision: 1, input: sized.order }),
    /cash/,
  );
  const smaller = sizePaperOrder(
    input({
      maxNotional: 100,
      targets: [
        { price: 110, percent: 40 },
        { price: 120, percent: 60 },
      ],
    }),
  );
  await f.a.preview({ expectedRevision: 1, input: smaller.order });
  assert.deepEqual(f.raw(), before);
  const s = await f.a.submit({
    expectedRevision: 1,
    requestId: randomUUID(),
    input: smaller.order,
  });
  assert.deepEqual(s.orders[0].bracket, smaller.order.bracket);
  await f.a.setRisk({
    expectedRevision: s.revision,
    policy: { ...s.risk, pauseBuys: true },
  });
  await assert.rejects(
    f.a.preview({ expectedRevision: s.revision + 1, input: smaller.order }),
    /paused/,
  );
});
test("paper_size is read-only and strict while submitting stays research-scoped", () => {
  const defs = toolDefinitions(),
    tool = defs.find((t) => t.name === "paper_size");
  assert.equal(tool.capability, "read");
  assert.equal(tool.action, "paperSize");
  assert.ok(tool.readOnly);
  assert.throws(() => tool.schema.parse(input({ apiKey: "unused" })));
  assert.equal(
    defs.find((t) => t.name === "paper_submit").capability,
    "research",
  );
});
