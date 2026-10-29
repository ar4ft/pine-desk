import test from "node:test";
import assert from "node:assert/strict";
import { orderflow, flowSettings } from "../core/orderflow.js";
import { toolDefinitions } from "../core/mcp-tools.js";
const start = Date.UTC(2026, 0, 1);
const trade = (price, size, side = "buy", time = start) => ({
  time,
  price,
  size,
  side,
});
const rows = (prices, buy = 9, sell = 1) =>
  prices.flatMap((price) => [trade(price, buy), trade(price, sell, "sell")]);
test("diagonal buy/sell ratios compare the correct neighboring buckets and flag complete consecutive stacks", () => {
  const f = orderflow(rows([100, 101, 102, 103]), {
    tickSize: 1,
    stackLength: 3,
  });
  const b = f.bars[0],
    byPrice = new Map(b.levels.map((l) => [l.price, l]));
  assert.equal(byPrice.get(100).buyImbalance, false);
  assert.equal(byPrice.get(101).buyRatio, 9);
  assert.equal(byPrice.get(101).buyStack, true);
  assert.equal(byPrice.get(103).buyStack, true);
  assert.equal(byPrice.get(103).sellRatio, null);
  assert.deepEqual(b.stacks, [{ side: "buy", from: 101, to: 104, levels: 3 }]);
  const sell = orderflow(rows([100, 101, 102, 103], 1, 9), { tickSize: 1 });
  assert.deepEqual(sell.bars[0].stacks, [
    { side: "sell", from: 100, to: 103, levels: 3 },
  ]);
  assert.equal(sell.bars[0].levels.find((l) => l.price === 100).sellRatio, 9);
});
test("zero denominator is explicit, 0/0 and outside-range comparisons never flag, holes break stacks", () => {
  const trades = [
    trade(100, 1, "sell"),
    trade(101, 9),
    trade(102, 9),
    trade(104, 9),
    trade(105, 9),
  ];
  const excluded = orderflow(trades, { tickSize: 1 });
  assert.equal(
    excluded.bars[0].levels.find((l) => l.price === 102).buyImbalance,
    false,
  );
  const f = orderflow(trades, {
    tickSize: 1,
    zeroDenominator: "flag",
    stackLength: 3,
  });
  assert.equal(f.bars[0].stacks.length, 0);
  const r = f.bars[0].levels.find((l) => l.price === 102);
  assert.equal(r.buyZero, true);
  assert.equal(r.buyRatio, null);
  assert.equal(r.buyImbalance, true);
  assert.equal(
    f.bars[0].levels.find((l) => l.price === 100).buyImbalance,
    false,
  );
  assert.ok(!JSON.stringify(f).includes("Infinity"));
});
test("minimum size and ratio boundaries are inclusive; stacks do not cross bars", () => {
  const trades = [
    ...rows([100, 101, 102], 3, 1),
    ...rows([100, 101, 102], 3, 1).map((t) => ({
      ...t,
      time: start + 3600000,
    })),
  ];
  const f = orderflow(trades, {
    tickSize: 1,
    imbalanceRatio: 3,
    minImbalanceVolume: 3,
    stackLength: 3,
  });
  assert.equal(f.bars.length, 2);
  assert.ok(f.bars.every((b) => b.stacks.length === 0));
  assert.equal(f.bars[0].levels[0].buyImbalance, true);
  const below = orderflow(trades, { tickSize: 1, minImbalanceVolume: 3.01 });
  assert.ok(below.bars.every((b) => b.levels.every((l) => !l.buyImbalance)));
});
test("value areas choose highest-price POC ties, expand by larger neighboring occupied volume and report overshoot", () => {
  const f = orderflow(
    [trade(98, 3), trade(99, 4), trade(100, 10), trade(101, 4), trade(102, 1)],
    { tickSize: 1, valueAreaPercent: 70 },
  );
  assert.equal(f.valueArea.poc, 100);
  assert.equal(f.valueArea.low, 99);
  assert.equal(f.valueArea.high, 102);
  assert.equal(f.valueArea.volume, 18);
  assert.equal(f.valueArea.totalVolume, 22);
  assert.ok(f.valueArea.actualPercent > 70);
  assert.deepEqual(f.bars[0].valueArea, f.valueArea);
  const tie = orderflow([trade(100, 5), trade(101, 5)], {
    tickSize: 1,
    valueAreaPercent: 1,
  });
  assert.equal(tie.poc, 101);
  assert.equal(tie.valueArea.low, 101);
  assert.equal(tie.valueArea.high, 102);
  const all = orderflow([trade(90, 1), trade(100, 8), trade(200, 1)], {
    tickSize: 1,
    valueAreaPercent: 100,
  });
  assert.equal(all.valueArea.low, 90);
  assert.equal(all.valueArea.high, 201);
  assert.equal(all.valueArea.rows, 3);
  assert.equal(all.valueArea.actualPercent, 100);
});
test("decimal bucket boundaries are stable, sparse ranges bounded and range/bar areas remain distinct", () => {
  const f = orderflow(
    [
      trade(0.3, 1),
      trade(0.31, 2, "sell"),
      trade(0.5, 5, "buy", start + 3600000),
    ],
    { tickSize: 0.1 },
  );
  assert.equal(f.bars[0].levels.length, 1);
  assert.equal(f.bars[0].levels[0].price, 0.3);
  assert.equal(f.bars[0].valueArea.high, 0.4);
  assert.equal(f.valueArea.poc, 0.5);
  assert.equal(f.bars[0].valueArea.poc, 0.3);
  const sparse = orderflow([trade(1, 1), trade(1e9, 2)], { tickSize: 1 });
  assert.equal(sparse.profile.length, 2);
  assert.equal(sparse.bars[0].levels.length, 2);
  assert.equal(sparse.bars[0].stacks.length, 0);
  assert.throws(
    () => orderflow([trade(1e9, 1)], { tickSize: 1e-9 }),
    /too small/,
  );
});
test("invalid settings and excessive aggregation fail before returning misleading metrics", () => {
  for (const settings of [
    { timeframe: "constructor" },
    { imbalanceRatio: 0.5 },
    { stackLength: 1 },
    { stackLength: 2.5 },
    { zeroDenominator: "guess" },
    { minImbalanceVolume: -1 },
    { valueAreaPercent: 0 },
    { valueAreaPercent: 101 },
  ])
    assert.throws(() => flowSettings(settings));
  assert.throws(
    () => orderflow([trade(100, 1e308), trade(101, 1e308)], { tickSize: 1 }),
    /numeric capacity/,
  );
  assert.throws(
    () =>
      orderflow(
        Array.from({ length: 10001 }, (_, i) =>
          trade(100, 1, "buy", start + i * 60000),
        ),
        { timeframe: "1m", tickSize: 1 },
      ),
    /10,000 occupied bars/,
  );
  assert.throws(
    () =>
      orderflow(
        Array.from({ length: 50001 }, (_, i) => trade(100 + i, 1)),
        { tickSize: 1 },
      ),
    /50,000 occupied/,
  );
});
test("both imported and live MCP tools accept the same explicit analytics settings", () => {
  for (const name of ["order_flow", "live_order_flow"]) {
    const tool = toolDefinitions().find((t) => t.name === name),
      settings = tool.schema.parse({ timeframe: "1m", tickSize: 0.1 });
    assert.equal(tool.capability, "read");
    assert.equal(settings.valueAreaPercent, 70);
    assert.equal(settings.zeroDenominator, "exclude");
    assert.throws(() => tool.schema.parse({ ...settings, stackLength: 1 }));
  }
});

test("large finite volume targets do not overflow and invalid dates/prices fail clearly", () => {
  const f = orderflow([trade(100, 8e306), trade(101, 2e306)], {
    tickSize: 1,
    valueAreaPercent: 70,
  });
  assert.equal(f.valueArea.rows, 1);
  assert.equal(f.valueArea.actualPercent, 80);
  assert.throws(() => orderflow([trade(100, 1, "buy", 1e20)]), /date range/);
  assert.throws(
    () => orderflow([trade(1e308, 1)], { tickSize: 1e308 }),
    /numeric capacity/,
  );
});
