import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dispatch, paperAccount, tradePlans } from "../core/service.js";
test("saved-plan entries use exact compatible revisions and copy only entry assumptions", async () => {
  const old = {
    paper: paperAccount.storage,
    plans: tradePlans.storage,
    validate: paperAccount.validateMarket,
  };
  const memory = () => {
    let value = null;
    return {
      read: async () => structuredClone(value),
      write: async (d) => {
        value = structuredClone(d);
      },
    };
  };
  paperAccount.storage = memory();
  tradePlans.storage = memory();
  paperAccount.validateMarket = async () => {};
  try {
    await dispatch("paperCreate", { initialCash: 10000 });
    const input = {
      name: "Entry fixture",
      symbol: "BTCUSDT",
      venue: "Binance",
      currency: "USDT",
      side: "long",
      assetType: "spot",
      equity: 10000,
      riskPercent: 1,
      entry: 100,
      stop: 90,
      quantityStep: 1,
      multiplier: 1,
      feePercent: 0.1,
      slippage: 1,
      maxNotional: 10000,
      targets: [{ price: 120, percent: 100 }],
    };
    let plan = await dispatch("planSave", { input });
    const args = {
      expectedRevision: 1,
      requestId: randomUUID(),
      planId: plan.id,
      planRevision: 1,
    };
    const s = await dispatch("paperSubmitPlan", args);
    assert.equal(s.orders.length, 1);
    assert.equal(s.orders[0].type, "limit");
    assert.equal(s.orders[0].quantity, plan.estimate.quantity);
    assert.equal(s.orders[0].price, 100);
    assert.equal(s.orders[0].slippage, 1);
    assert.equal(s.orders[0].plan.revision, 1);
    assert.equal(s.orders[0].stop, undefined);
    assert.equal(s.fills.length, 0);
    assert.deepEqual(await dispatch("paperSubmitPlan", args), s);
    plan = await dispatch("planSave", {
      id: plan.id,
      expectedRevision: 1,
      input: { ...input, status: "archived" },
    });
    await assert.rejects(
      dispatch("paperSubmitPlan", {
        ...args,
        requestId: randomUUID(),
        expectedRevision: 2,
      }),
      /Saved plan changed/,
    );
    await assert.rejects(
      dispatch("paperSubmitPlan", {
        ...args,
        requestId: randomUUID(),
        expectedRevision: 2,
        planRevision: 2,
      }),
      /draft, long/,
    );
    assert.equal((await dispatch("paperSnapshot")).orders.length, 1);
    const restored = await dispatch("planSave", {
      id: plan.id,
      expectedRevision: 2,
      input,
    });
    const linked = await dispatch("paperSubmitPlan", {
      ...args,
      requestId: randomUUID(),
      expectedRevision: 2,
      planRevision: restored.revision,
      linkedExits: true,
    });
    assert.equal(linked.orders[1].bracket.stop, 90);
    assert.deepEqual(
      linked.orders[1].bracket.targets,
      restored.estimate.targets
        .filter((t) => t.quantity > 0)
        .map((t) => ({ price: t.price, quantity: t.quantity })),
    );
    const guarded = await dispatch("paperSetRisk", {
      expectedRevision: linked.revision,
      policy: { ...linked.risk, pauseBuys: true },
    });
    await assert.rejects(
      dispatch("paperSubmitPlan", {
        ...args,
        requestId: randomUUID(),
        expectedRevision: guarded.revision,
        planRevision: restored.revision,
      }),
      /paused/,
    );
  } finally {
    await paperAccount.close();
    await tradePlans.close();
    paperAccount.storage = old.paper;
    tradePlans.storage = old.plans;
    paperAccount.validateMarket = old.validate;
  }
});
