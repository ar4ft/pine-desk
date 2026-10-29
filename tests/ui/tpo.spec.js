import { test, expect } from "@playwright/test";
import { tpoProfile } from "../../core/tpo.js";
import { dispatch } from "../../core/service.js";
test.use({ timezoneId: "America/New_York" });
const start = Date.UTC(2026, 0, 1),
  minute = 60000;
test("TPO letters, count value area, initial balance, coverage, paging and isolated drafts", async ({
  page,
}) => {
  let trades = [
    [0, 100, 100],
    [1, 100, 99],
    [30000, 102, 1],
    [2 * minute, 101, 1],
    [2 * minute + 1, 102, 1],
    [4 * minute, 102, 1],
  ].map(([offset, price, size]) => ({
    time: start + offset,
    price,
    size,
    side: "buy",
  }));
  let exported;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("backendCall", (action, args) =>
    action === "tpoProfile"
      ? tpoProfile(
          {
            symbol: "TPO-FIXTURE",
            trades,
            gaps: [{ from: start + minute, to: start + minute + 1 }],
          },
          args,
        )
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
  await page.locator('[data-flow-tab="tpo"]').click();
  await page.locator("#vp-sessionDate").fill("2026-01-01");
  await page.locator("#vp-sessionMinutes").fill("6");
  await page.locator("#vp-tickSize").fill("1");
  await page.locator("#vp-periodMinutes").fill("2");
  await page.locator("#vp-initialBalanceMinutes").fill("3");
  await page.locator("#vp-compute").click();
  await expect(page.locator("#vp-area")).toContainText("80% of TPOs");
  await expect(page.locator("#tpo-table tbody tr")).toHaveCount(3);
  await expect(
    page.locator("#tpo-table tbody tr").first().locator(".tpo-letter"),
  ).toHaveText(["A", "B", "C"]);
  await expect(page.locator("#tpo-ib")).toContainText("Low 100 · high 103");
  await expect(page.locator("#vp-coverage")).toContainText(
    "1 known overlapping gap",
  );
  await page.locator(".tpo-periods summary").click();
  await expect(page.locator(".tpo-periods tbody tr")).toHaveCount(3);
  await expect(page.locator(".tpo-periods tbody tr").first()).toContainText(
    "1 known gap",
  );
  await page.locator("#vp-periodMinutes").fill("0");
  await page.locator("#vp-compute").click();
  await expect(page.locator("#vp-error")).toContainText("previous calculation");
  await page.locator("#vp-export").click();
  await expect.poll(() => exported?.name).toBe("tpo-profile.json");
  expect(JSON.parse(exported.text).settings.periodMinutes).toBe(2);
  await page.locator('[data-flow-tab="profiles"]').click();
  await page.locator("#vp-tickSize").fill("50");
  await page.locator('[data-flow-tab="tpo"]').click();
  await expect(page.locator("#vp-tickSize")).toHaveValue("1");
  await expect(page.locator("#vp-periodMinutes")).toHaveValue("0");
  await page.locator("#vp-periodMinutes").fill("2");
  await page.locator("#vp-mode").selectOption("anchored");
  await page.locator("#vp-from").fill("2026-01-01T00:02");
  await page.locator("#vp-to").fill("2026-01-01T00:05");
  await page.locator("#vp-source").selectOption("live");
  await page.locator("#vp-compute").click();
  await expect(
    page.locator("#tpo-table tbody tr").first().locator(".tpo-letter"),
  ).toHaveText(["A", "B"]);
  await page.locator(".tpo-periods summary").click();
  await expect(page.locator(".tpo-periods tbody tr").last()).toContainText(
    "Partial interval",
  );
  await page.locator("#vp-mode").selectOption("session");
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
      path: `test-results/tpo-${theme}.png`,
      fullPage: true,
      style: "#toast {visibility:hidden}",
    });
  }
  trades = Array.from({ length: 205 }, (_, i) => ({
    time: start,
    price: 100 + i,
    size: 1,
    side: "buy",
  }));
  await page.locator("#vp-compute").click();
  await expect(page.locator("#tpo-table tbody tr")).toHaveCount(100);
  await page.locator("#vp-lower").click();
  await page.locator("#vp-lower").click();
  await expect(page.locator("#tpo-table tbody tr")).toHaveCount(5);
  await page.locator("#vp-next").click();
  await page.locator("#vp-compute").click();
  await expect(page.locator("#vp-area")).toContainText("No trades");
  await expect(page.locator("#tpo-ib")).toContainText("range unavailable");
  expect(errors).toEqual([]);
});
