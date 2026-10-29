import { test, expect } from "@playwright/test";
import { volumeProfile } from "../../core/volume-profile.js";
import { dispatch } from "../../core/service.js";
test.use({ timezoneId: "America/New_York" });
const day = Date.UTC(2026, 0, 1);
test("UTC and anchored profiles preserve drafts, page rows, expose coverage and export the applied snapshot", async ({
  page,
}) => {
  let calls = 0,
    exported;
  const trades = Array.from({ length: 205 }, (_, i) => ({
    time: day + i * 1000,
    price: 100 + i,
    size: 1,
    side: i % 2 ? "buy" : "sell",
  }));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("backendCall", (action, args) => {
    if (action === "volumeProfile") {
      calls++;
      return volumeProfile(
        {
          symbol: "FIXTURE",
          trades,
          gaps: [{ from: day + 1000, to: day + 2000 }],
          origin: "UI fixture",
        },
        args,
      );
    }
    return dispatch(action, args);
  });
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
  await page.locator("#vp-sessionDate").fill("2026-01-01");
  await page.locator("#vp-tickSize").fill("1");
  await page.locator("#vp-compute").click();
  await expect(page.locator("#vp-applied")).toContainText("FIXTURE");
  await expect(page.locator("#vp-coverage")).toContainText(
    "1 known overlapping gap",
  );
  await expect(page.locator("#vp-coverage")).toContainText(
    "Requested end extends beyond retained trades",
  );
  await expect(page.locator("#vp-table tbody tr")).toHaveCount(100);
  await page.locator("#vp-lower").click();
  await expect(page.locator("#vp-page")).toContainText("101–200 of 205");
  await page.locator("#vp-lower").click();
  await expect(page.locator("#vp-table tbody tr")).toHaveCount(5);
  await page.locator("#vp-mode").selectOption("anchored");
  await page.locator("#vp-from").fill("2026-01-01T00:00:01");
  await page.locator("#vp-to").fill("2026-01-01T00:00:03");
  await page.locator("#vp-source").selectOption("live");
  await page.locator("#vp-compute").click();
  await expect(page.locator("#vp-table tbody tr")).toHaveCount(2);
  await expect(page.locator("#vp-area")).toContainText("POC 102");
  await page.locator("#vp-tickSize").fill("0");
  await page.locator("#vp-compute").click();
  await expect(page.locator("#vp-error")).toContainText("previous calculation");
  await expect(page.locator("#vp-table tbody tr")).toHaveCount(2);
  await page.locator("#vp-export").click();
  await expect.poll(() => exported?.name).toBe("volume-profile.json");
  const result = JSON.parse(exported.text);
  expect(result.settings.tickSize).toBe(1);
  expect(result.settings.source).toBe("live");
  expect(result.totalTrades).toBe(2);
  await page.locator('[data-flow-tab="trades"]').click();
  await page.locator('[data-flow-tab="profiles"]').click();
  await expect(page.locator("#vp-from")).toHaveValue("2026-01-01T00:00:01");
  await expect(page.locator("#vp-tickSize")).toHaveValue("0");
  await page.locator("#vp-tickSize").fill("1");
  await page.locator("#vp-mode").selectOption("session");
  await page.locator("#vp-next").click();
  await expect(page.locator("#vp-sessionDate")).toHaveValue("2026-01-02");
  await page.locator("#vp-compute").click();
  await expect(page.locator("#vp-area")).toContainText("No trades");
  expect(calls).toBe(4);
  await page.locator("#vp-previous").click();
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
      path: `test-results/volume-profile-${theme}.png`,
      fullPage: true,
      style: "#toast {visibility:hidden}",
    });
  }
  expect(errors).toEqual([]);
});
