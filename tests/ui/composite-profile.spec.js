import { test, expect } from "@playwright/test";
import { volumeProfile } from "../../core/volume-profile.js";
import { tpoProfile } from "../../core/tpo.js";
import { orderflow } from "../../core/orderflow.js";
import { dispatch } from "../../core/service.js";
const day = Date.UTC(2026, 0, 1),
  D = 86400000,
  hour = 3600000;
test.use({ timezoneId: "America/New_York" });
test("composite sessions and size filters show applied scope, empty sessions and unfiltered coverage", async ({
  page,
}) => {
  const snap = {
    symbol: "COMPOSITE",
    trades: [
      [22 * hour, 1],
      [22 * hour + 1, 2],
      [D + hour, 3],
      [D + 12 * hour, 100],
      [D + 22 * hour, 4],
    ].map(([offset, size]) => ({
      time: day + offset,
      price: 100 + size,
      size,
      side: "buy",
    })),
  };
  let exported;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("backendCall", (action, args) =>
    action === "volumeProfile"
      ? volumeProfile(snap, args)
      : action === "tpoProfile"
        ? tpoProfile(snap, args)
        : action === "orderflow"
          ? { ...orderflow(snap.trades, args), symbol: snap.symbol }
          : dispatch(action, args),
  );
  await page.exposeFunction("exportResult", (name, text) => {
    exported = { name, text };
  });
  await page.addInitScript(() => {
    window.desk = {
      call: (a, b) => window.backendCall(a, b),
      exportFile: (n, t) => window.exportResult(n, t),
    };
  });
  await page.goto("/");
  await expect(page.locator("#chart")).toHaveAttribute("data-ready", "true");
  await page.locator('[data-page="orderflow"]').click();
  await page.locator('[data-flow-tab="profiles"]').click();
  await page.locator("#vp-mode").selectOption("composite");
  await page.locator("#vp-sessionDate").fill("2026-01-01");
  await page.locator("#vp-sessionEndDate").fill("2026-01-03");
  await page.locator("#vp-sessionOpen").fill("22:00");
  await page.locator("#vp-sessionMinutes").fill("240");
  await page.locator("#vp-tickSize").fill("1");
  await page.locator("#vp-minTradeSize").fill("2");
  await page.locator("#vp-maxTradeSize").fill("3");
  await page.locator("#vp-compute").click();
  await expect(page.locator(".trade-filter-summary")).toContainText(
    "2 matching / 4 observed",
  );
  await expect(page.locator("#vp-sessions tbody tr")).toHaveCount(3);
  await expect(page.locator("#vp-sessions tbody tr").last()).toContainText(
    "No observed trades",
  );
  await expect(page.locator("#vp-table tbody tr")).toHaveCount(2);
  await page.locator('[data-vp-weekday="5"]').uncheck();
  await page.locator("#vp-compute").click();
  await expect(page.locator("#vp-sessions tbody tr")).toHaveCount(2);
  await expect(page.locator(".trade-filter-summary")).toContainText(
    "2 matching / 3 observed",
  );
  await page.locator("#vp-maxTradeSize").fill("1");
  await page.locator("#vp-compute").click();
  await expect(page.locator("#vp-error")).toContainText("previous calculation");
  await page.locator("#vp-export").click();
  await expect.poll(() => exported?.name).toBe("volume-profile.json");
  expect(JSON.parse(exported.text).settings.maxTradeSize).toBe(3);
  expect(JSON.parse(exported.text).sessions).toHaveLength(2);
  await page.locator("#vp-maxTradeSize").fill("");
  await page.locator("#vp-minTradeSize").fill("10");
  await page.locator("#vp-compute").click();
  await expect(page.locator("#vp-area")).toContainText("No trades match");
  await expect(page.locator("#vp-sessions tbody tr").first()).toContainText(
    "0 / 3",
  );
  await page.locator("#vp-minTradeSize").fill("2");
  await page.locator("#vp-maxTradeSize").fill("3");
  await page.locator("#vp-compute").click();
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1100, height: 850 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/composite-${theme}.png`,
      fullPage: true,
      style: "#toast {visibility:hidden}",
    });
  }
  await page.locator('[data-flow-tab="tpo"]').click();
  await expect(page.locator('#vp-mode option[value="composite"]')).toHaveCount(
    0,
  );
  await page.locator("#vp-sessionDate").fill("2026-01-01");
  await page.locator("#vp-minTradeSize").fill("10");
  await page.locator("#vp-compute").click();
  await expect(page.locator(".trade-filter-summary")).toContainText(
    "0 matching / 2 observed",
  );
  await expect(page.locator("#vp-area")).toContainText("No trades match");
  await page.locator('[data-flow-tab="trades"]').click();
  await page.locator("#ff-minTradeSize").fill("200");
  await page.locator("#refresh-flow").click();
  await expect(page.locator(".trade-filter-summary")).toContainText(
    "0 matching / 5 observed",
  );
  await expect(page.locator(".footprint-table tbody tr")).toHaveCount(0);
  await page.locator("#footprint-follow").uncheck();
  await page.locator("#footprint-follow").check();
  await page.locator("#ff-minTradeSize").fill("2");
  await page.locator("#ff-maxTradeSize").fill("3");
  await page.locator("#refresh-flow").click();
  await expect(page.locator(".trade-filter-summary")).toContainText(
    "2 matching / 5 observed",
  );
  await page.locator('[data-flow-tab="profiles"]').click();
  await expect(page.locator('[data-vp-weekday="5"]')).not.toBeChecked();
  await expect(page.locator("#vp-maxTradeSize")).toHaveValue("3");
  expect(errors).toEqual([]);
});
