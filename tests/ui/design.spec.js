import { test, expect } from "@playwright/test";

test("desktop navigation and focus mode preserve the chart and editor", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#pine-editor .cm-content").waitFor();
  await expect(page.locator("#nav [data-page]")).toHaveCount(11);
  await expect(page.locator("#nav .nav-group-label")).toHaveText([
    "Markets",
    "Research",
    "Connections",
  ]);
  const source = await page.locator("#source").inputValue();
  await page.evaluate(() => {
    window.reviewChart = document.querySelector("#chart");
  });
  await page.locator("#focus-chart").click();
  await expect(page.locator("#focus-chart")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".editor")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.querySelector("#chart") === window.reviewChart,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator(".editor")).toBeVisible();
  await expect(page.locator("#source")).toHaveValue(source);
  await page.keyboard.press("Control+Shift+f");
  await expect(page.locator("#focus-chart")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("#focus-chart")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.locator(".workspace-utilities").scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.locator('#nav [data-page="education"]').click();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.locator('#nav [data-page="crypto"]').click();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("core screens fit smaller desktop widths in both themes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/");
    await page.locator('#nav [data-page="workspace"]').click();
    for (const section of [
      "workspace",
      "backtest",
      "education",
      "options",
      "orderflow",
      "library",
      "edge",
      "whale",
      "mcp",
      "crypto",
      "settings",
    ]) {
      await page.locator(`#nav [data-page="${section}"]`).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        `${section}/${theme} horizontal overflow`,
      ).toBe(true);
    }
  }
});
