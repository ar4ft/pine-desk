import assert from "node:assert/strict";
export async function desktopFootprintSmoke({ page, client, call }) {
  const start = Date.UTC(2026, 0, 1),
    rows = [];
  for (const [offset, buy, sell] of [
    [0, 9, 1],
    [60000, 1, 9],
  ])
    for (const price of [100, 101, 102, 103]) {
      rows.push(
        [start + offset, price, buy, "buy"],
        [start + offset + 1, price, sell, "sell"],
      );
    }
  await call(client, "import_trades", {
    symbol: "FOOTPRINT-FIXTURE",
    csv: "time,price,size,side\n" + rows.map((r) => r.join(",")).join("\n"),
  });
  const f = await call(client, "order_flow", { timeframe: "1m", tickSize: 1 });
  assert.equal(f.bars.length, 2);
  assert.deepEqual(f.bars[0].stacks, [
    { side: "buy", from: 101, to: 104, levels: 3 },
  ]);
  assert.equal(f.valueArea.actualPercent, 75);
  await call(client, "desktop_navigate", { page: "orderflow" });
  await page.locator('[data-flow-tab="trades"]').click();
  await page.locator("#flow-timeframe").selectOption("1m");
  await page.locator("#tick-size").fill("1");
  await page.locator("#refresh-flow").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#footprint-stacks")
      ?.textContent.includes("SELL stack"),
  );
  await page.locator("#footprint-prev").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#footprint-stacks")
      ?.textContent.includes("BUY stack"),
  );
  assert.equal(await page.locator(".stacked.buy").count(), 3);
  await page.locator("#profile-scope").selectOption("bar");
  assert.ok(
    (await page.locator("#profile-area").textContent()).includes(
      "75% achieved",
    ),
  );
}
