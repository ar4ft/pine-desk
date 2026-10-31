import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { PaperAccount } from "../../core/paper-account.js";
import { PaperMonitor } from "../../core/paper-monitor.js";
import { PaperJournal, emptyJournalInput } from "../../core/paper-journal.js";
import { PaperHistory } from "../../core/paper-history.js";
import { dispatch } from "../../core/service.js";
const memory = () => {
  let doc = null;
  return {
    read: async () => structuredClone(doc),
    write: async (d) => {
      doc = structuredClone(d);
    },
  };
};

test("fill journal preserves drafts and rejects conflicting notes; recorded equity preserves gaps, exports and survives reload", async ({
  page,
}) => {
  let now = Date.now(),
    bid = 99,
    ask = 100,
    offline = false,
    exported;
  const a = new PaperAccount({
    storage: memory(),
    now: () => now,
    validateMarket: async () => {},
    quote: async (symbol) => {
      if (offline) throw Error("offline");
      return {
        symbol,
        bid,
        ask,
        requestedAt: now,
        receivedAt: now,
        source: "Binance public bookTicker REST",
      };
    },
  });
  const history = new PaperHistory({ account: a, storage: memory() });
  const journal = new PaperJournal({
    account: a,
    storage: memory(),
    now: () => now,
  });
  const monitor = new PaperMonitor({
    account: a,
    history,
    now: () => now,
    clock: { setTimeout: () => 1, clearTimeout: () => {} },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("backendCall", (action, args) => {
    const account = {
      paperCreate: "create",
      paperSubmit: "submit",
      paperSnapshot: "snapshot",
    };
    if (account[action]) return a[account[action]](args);
    if (action === "paperMonitorStatus") return monitor.snapshot();
    if (action === "paperMonitorStart") return monitor.start();
    if (action === "paperMonitorStop") return monitor.stop();
    if (action === "paperJournal") return journal.snapshot();
    if (action === "paperJournalSave") return journal.save(args);
    if (action === "paperHistory") return history.snapshot();
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
  try {
    await page.goto("/");
    await page.locator('[data-page="paper"]').click();
    await page.locator("#paper-initialCash").fill("1000");
    await page.locator("#paper-create").click();
    await page.locator("#paper-quantity").fill("2");
    await page.locator("#paper-maxNotional").fill("220");
    await page.locator("#paper-feePercent").fill("0");
    await page.locator("#paper-submit").click();
    await page.locator("#paper-monitor-start").click();
    await expect.poll(() => history.status.count).toBe(1);
    await page.locator("#paper-journal-load").click();
    await page.locator("[data-journal-edit]").click();
    const thesis = "<img src=x onerror=alert(1)> Range breakout";
    await page.locator("#paper-journal-thesis").fill(thesis);
    await page
      .locator("#paper-journal-review")
      .fill("Wait for confirmation next time.");
    await page.locator("#paper-journal-tags").fill("Breakout, Practice");
    await page.locator("#paper-journal-adherence").selectOption("deviated");
    now += 60000;
    bid = 110;
    ask = 111;
    await monitor.cycle();
    await expect(page.locator("#paper-marks")).toContainText("220");
    await expect(page.locator("#paper-journal-thesis")).toHaveValue(thesis);
    await page.locator("#paper-journal-load").click();
    await expect(page.locator("#paper-journal-review")).toHaveValue(
      "Wait for confirmation next time.",
    );
    const before = (await a.snapshot()).revision;
    await page.locator("#paper-journal-save").click();
    await expect(page.locator("#paper-message")).toContainText(
      "Fill review saved",
    );
    expect((await a.snapshot()).revision).toBe(before);
    await expect(page.locator("#paper-journal-table")).toContainText(
      "deviated".replace("d", "D"),
    );
    expect(await page.locator("#paper-journal img").count()).toBe(0);
    await page.locator("#paper-journal-review").fill("My unsaved draft");
    const e = (await journal.snapshot()).entries[0];
    await journal.save({
      orderId: e.orderId,
      expectedRevision: e.revision,
      input: { ...emptyJournalInput(), review: "External review" },
    });
    await page.locator("#paper-journal-save").click();
    await expect(page.locator("#paper-error")).toContainText(
      "changed elsewhere",
    );
    await expect(page.locator("#paper-journal-review")).toHaveValue(
      "My unsaved draft",
    );
    await page.locator("#paper-journal-reload").click();
    await expect(page.locator("#paper-journal-review")).toHaveValue(
      "External review",
    );
    await page.locator("#paper-journal-tags").fill("practice");
    await page.locator("#paper-journal-save").click();
    await expect(page.locator("#paper-message")).toContainText(
      "Fill review saved",
    );
    await page.locator("#paper-journal-filter").fill("missing");
    await expect(page.locator("#paper-journal-table")).toContainText(
      "No matching",
    );
    await page.locator("#paper-journal-filter").fill("practice");
    await expect(page.locator("[data-journal-edit]")).toHaveCount(1);
    now += 5000;
    offline = true;
    await monitor.cycle();
    now += 5000;
    offline = false;
    bid = 90;
    ask = 91;
    await monitor.cycle();
    await page.locator("#paper-monitor-stop").click();
    await page.locator("#paper-history-load").click();
    await expect(page.locator("#paper-history-body")).toContainText("3.9216%");
    await expect(page.locator(".paper-history-chart circle")).toHaveCount(3);
    const path = await page
      .locator(".paper-history-chart path")
      .getAttribute("d");
    expect(path.match(/M/g)).toHaveLength(2);
    await page.locator("#paper-history-mode").selectOption("drawdown");
    await expect(page.locator(".paper-history-chart")).toHaveAttribute(
      "aria-label",
      /drawdown percent/,
    );
    await page.locator("#paper-history-window").selectOption("100");
    await page.locator("#paper-history details summary").click();
    await expect(page.locator("#paper-history-table")).toContainText(
      "Missing: BTCUSDT",
    );
    await page.locator("#paper-history-export").click();
    await expect.poll(() => exported?.name).toBe("paper-equity-history.json");
    expect(JSON.parse(exported.text).history.samples[2].equity).toBeNull();
    await page.locator("#paper-history-csv").click();
    await expect.poll(() => exported?.name).toBe("paper-equity-history.csv");
    expect(exported.text.split("\n")).toHaveLength(5);
    await page.locator("#paper-journal-export").click();
    await expect.poll(() => exported?.name).toBe("paper-journal.json");
    expect(JSON.parse(exported.text).journal.entries[0].input.review).toBe(
      "External review",
    );
    for (const theme of ["dark", "light"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 1100, height: 900 });
      await page.waitForTimeout(200);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page
        .locator("#paper-history")
        .screenshot({ path: `test-results/paper-history-${theme}.png` });
      await page
        .locator("#paper-journal")
        .screenshot({ path: `test-results/paper-journal-${theme}.png` });
    }
    await page.reload();
    await page.locator('[data-page="paper"]').click();
    await page.locator("#paper-journal-load").click();
    await page.locator("[data-journal-edit]").click();
    await expect(page.locator("#paper-journal-review")).toHaveValue(
      "External review",
    );
    await page.locator("#paper-history-load").click();
    await expect(page.locator("#paper-history-body")).toContainText(
      "latest 4 of 4",
    );
    expect((await monitor.snapshot()).active).toBe(false);
    for (let i = 0; i < 100; i++) {
      const current = await a.snapshot();
      const next = await a.submit({
        expectedRevision: current.revision,
        requestId: randomUUID(),
        input: {
          symbol: "BTCUSDT",
          side: "buy",
          type: "market",
          quantity: 0.001,
          maxNotional: 1,
          feePercent: 0,
        },
      });
      await a.process({
        expectedRevision: next.revision,
        id: next.orders.at(-1).id,
      });
    }
    await page.locator("#paper-journal-load").click();
    await expect(page.locator("[data-journal-edit]")).toHaveCount(100);
    await page.locator("#paper-journal-older").click();
    await expect(page.locator("[data-journal-edit]")).toHaveCount(1);
    await expect(
      page.locator(`[data-journal-edit="${e.orderId}"]`),
    ).toBeVisible();
    await page.locator("#paper-journal-newer").click();
    await expect(page.locator("[data-journal-edit]")).toHaveCount(100);
    await page.locator("#paper-journal-filter").fill("practice");
    await expect(page.locator("[data-journal-edit]")).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    await monitor.close();
  }
});
