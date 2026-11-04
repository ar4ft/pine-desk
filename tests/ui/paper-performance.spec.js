import { test, expect } from "@playwright/test";
import { PaperMonitor } from "../../core/paper-monitor.js";
import { PaperJournal } from "../../core/paper-journal.js";
import { paperPerformance } from "../../core/paper-performance.js";
import {
  performanceFixture,
  seedPerformance,
} from "../helpers/paper-performance.js";
import { dispatch } from "../../core/service.js";
test("completed performance filters whole trades, keeps open exits separate, links journal and exports the loaded revision", async ({
  page,
}) => {
  const f = performanceFixture();
  await seedPerformance(f);
  const monitor = new PaperMonitor({ account: f.a });
  let notes = null,
    exported,
    reads = 0;
  const journal = new PaperJournal({
    account: f.a,
    storage: { read: async () => notes, write: async (d) => (notes = d) },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("backendCall", async (action, args) => {
    if (action === "paperMonitorStatus") return monitor.snapshot();
    if (action === "paperPerformance") {
      reads++;
      return paperPerformance(await f.a.snapshot(), args);
    }
    if (action === "paperJournal") return journal.snapshot();
    if (action === "paperJournalSave") return journal.save(args);
    return dispatch(action, args);
  });
  await page.exposeFunction(
    "exportResult",
    (name, text) => (exported = { name, text }),
  );
  await page.addInitScript(() => {
    window.desk = {
      call: (a, b) => window.backendCall(a, b),
      exportFile: (n, t) => window.exportResult(n, t),
    };
  });
  try {
    await page.goto("/");
    await page.locator('[data-page="paper"]').click();
    await expect(page.locator("#paper-performance-json")).toBeDisabled();
    await page.locator("#paper-performance-load").click();
    await expect(page.locator("#paper-performance-table tbody tr")).toHaveCount(
      3,
    );
    await expect(page.locator("#paper-performance-body")).toContainText("60.9");
    await expect(page.locator("#paper-performance-body")).toContainText(
      "8.9 USDT realized from partial exits",
    );
    await expect(page.locator(".paper-performance-chart circle")).toHaveCount(
      3,
    );
    const p = paperPerformance(await f.a.snapshot()),
      id = p.closedTrades[0].id;
    await page.locator(`[data-paper-trade="${id}"]`).click();
    await expect(page.locator("#paper-performance-fills tbody tr")).toHaveCount(
      5,
    );
    await expect(page.locator("#paper-performance-fills")).toContainText(
      "Plan A",
    );
    expect(await page.locator("#paper-performance img").count()).toBe(0);
    await page.locator(`[data-performance-review="${id}"]`).click();
    await page.locator("#paper-journal-review").fill("Grouped trade lesson");
    await page.locator("#paper-journal-save").click();
    await expect(page.locator("#paper-message")).toContainText(
      "Fill review saved",
    );
    await page.locator("#paper-performance-tab").selectOption("open");
    await expect(page.locator("#paper-performance-table")).toContainText(
      "SOLUSDT",
    );
    await expect(page.locator("#paper-performance-table tbody tr")).toHaveCount(
      1,
    );
    await page.locator("#paper-performance-symbol").fill("ETHUSDT");
    await expect(page.locator("#paper-performance-status")).toContainText(
      "Draft filters differ",
    );
    await expect(page.locator("#paper-performance-body")).toContainText(
      "Applied scope: All markets",
    );
    await page.locator("#paper-performance-load").click();
    await page.locator("#paper-performance-tab").selectOption("closed");
    await expect(page.locator("#paper-performance-table tbody tr")).toHaveCount(
      1,
    );
    await expect(page.locator("#paper-performance-table")).toContainText(
      "breakeven",
    );
    await page.locator("#paper-performance-from").fill("2027-01-01");
    await page.locator("#paper-performance-to").fill("2026-01-01");
    await page.locator("#paper-performance-load").click();
    await expect(page.locator("#paper-error")).toContainText(
      "From must be earlier",
    );
    await expect(page.locator("#paper-performance-table")).toContainText(
      "ETHUSDT",
    );
    await page.locator("#paper-performance-symbol").fill("SOLUSDT");
    await page.locator("#paper-performance-to").fill("");
    await page.locator("#paper-performance-load").click();
    await expect(page.locator("#paper-performance-body")).toContainText(
      "No completed trades",
    );
    await page.locator("#paper-performance-tab").selectOption("open");
    await expect(page.locator("#paper-performance-table")).toContainText(
      "SOLUSDT",
    );
    await page.locator("#paper-performance-from").fill("");
    await page.locator("#paper-performance-symbol").fill("");
    await page.locator("#paper-performance-load").click();
    await page.locator("#paper-performance-tab").selectOption("closed");
    const loaded = paperPerformance(await f.a.snapshot());
    await f.fill({ symbol: "SOLUSDT", side: "sell", atPrice: 70 });
    await expect(page.locator("#paper-performance-status")).toContainText(
      "Account changed",
    );
    const readCount = reads;
    await page.locator("#paper-performance-json").click();
    await expect
      .poll(() => exported?.name)
      .toBe(`paper-performance-r${loaded.accountRevision}.json`);
    expect(JSON.parse(exported.text).summary.closedCount).toBe(3);
    expect(reads).toBe(readCount);
    await page.locator("#paper-performance-load").click();
    await expect(page.locator("#paper-performance-table tbody tr")).toHaveCount(
      4,
    );
    await page.locator("#paper-performance-csv").click();
    await expect.poll(() => exported?.name.endsWith(".csv")).toBe(true);
    expect(exported.text.split("\n")).toHaveLength(5);
    for (const theme of ["dark", "light"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 1100, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page
        .locator("#paper-performance")
        .screenshot({ path: `test-results/paper-performance-${theme}.png` });
    }
    await page.locator('[data-page="workspace"]').click();
    await page.locator('[data-page="paper"]').click();
    await expect(page.locator("#paper-performance-table tbody tr")).toHaveCount(
      4,
    );
    await expect(page.locator("#paper-journal-review")).toHaveValue(
      "Grouped trade lesson",
    );
    // More than a page of complete cycles: rows page, while metrics and export include all.
    for (let i = 0; i < 98; i++) {
      await f.fill();
      await f.fill({ side: "sell", atPrice: 101 });
    }
    await page.locator("#paper-performance-load").click();
    await expect(page.locator("#paper-performance-table tbody tr")).toHaveCount(
      100,
    );
    await page.locator("#paper-performance-older").click();
    await expect(page.locator("#paper-performance-table tbody tr")).toHaveCount(
      2,
    );
    await page.locator("#paper-performance-json").click();
    await expect
      .poll(() => JSON.parse(exported.text).closedTrades?.length)
      .toBe(102);
    expect((await monitor.snapshot()).active).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await monitor.close();
  }
});
