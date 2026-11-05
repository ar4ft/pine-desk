import { test, expect } from "@playwright/test";
import { PaperMonitor } from "../../core/paper-monitor.js";
import { paperDraftChart } from "../../core/paper-order-chart.js";
import { performanceFixture } from "../helpers/paper-performance.js";
import { dispatch } from "../../core/service.js";
test("chart drafts drag three levels, review without orders, reject stale reviews and reconcile a lost submission reply", async ({
  page,
}) => {
  const f = performanceFixture();
  await f.a.create({ initialCash: 1000 });
  const monitor = new PaperMonitor({ account: f.a });
  let offline = false,
    loseReply = false;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("backendCall", async (action, args) => {
    if (action === "paperMonitorStatus") return monitor.snapshot();
    if (action === "paperSnapshot") return f.a.snapshot();
    if (action === "paperPreview") return f.a.preview(args);
    if (action === "paperSubmit") {
      const a = await f.a.submit(args);
      if (loseReply) {
        loseReply = false;
        throw Error("Reply lost after commit");
      }
      return a;
    }
    if (action === "paperDraftChart")
      return paperDraftChart(f.a, args, async () => {
        if (offline) throw Error("Offline");
        return Array.from({ length: 100 }, (_, i) => ({
          time: Date.UTC(2026, 10, 1) + i * 3600000,
          open: 100 + Math.sin(i) * 0.1,
          high: 101,
          low: 99,
          close: 100,
          volume: 100,
        }));
      });
    return dispatch(action, args);
  });
  await page.addInitScript(() => {
    window.desk = { call: (a, b) => window.backendCall(a, b) };
  });
  try {
    await page.goto("/");
    await page.locator('[data-page="paper"]').click();
    await page.locator("#paper-compose-quantity").fill("1");
    await page.locator("#paper-compose-bracket").check();
    await page.locator("#paper-compose-load").click();
    const chart = page.locator("#paper-compose-chart");
    await expect(chart).toHaveAttribute("data-ready", "true");
    const locate = async (color) => {
      const png = (await chart.screenshot()).toString("base64");
      return chart.evaluate(
        async (node, { png, color }) => {
          const img = new Image();
          img.src = `data:image/png;base64,${png}`;
          await img.decode();
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0);
          const w = c.width,
            h = c.height,
            p = ctx.getImageData(0, 0, w, h).data,
            r = node.getBoundingClientRect();
          let best = null;
          for (let y = 0; y < h; y++) {
            let count = 0;
            for (let x = Math.floor(w * 0.15); x < Math.floor(w * 0.65); x++) {
              const k = (y * w + x) * 4,
                R = p[k],
                G = p[k + 1],
                B = p[k + 2];
              if (
                color === "amber"
                  ? R - G > 15 && G - B > 20
                  : color === "red"
                    ? R - G > 40 && B - G > 5
                    : G - R > 30 && G - B > 10
              )
                count++;
            }
            if (count > w * 0.15 && (!best || count > best.count))
              best = {
                count,
                x: r.x + r.width * 0.4,
                y: r.y + (y / h) * r.height,
              };
          }
          return best;
        },
        { png, color },
      );
    };
    for (const [key, color, delta] of [
      ["price", "amber", -12],
      ["stop", "red", 12],
      ["target", "green", -12],
    ]) {
      const before = await page.locator(`#paper-compose-${key}`).inputValue();
      await chart.scrollIntoViewIfNeeded();
      await expect.poll(() => locate(color)).not.toBeNull();
      const p = await locate(color);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(p.x, p.y + delta, { steps: 8 });
      await page.mouse.up();
      await expect(page.locator(`#paper-compose-${key}`)).not.toHaveValue(
        before,
      );
    }
    expect((await f.a.snapshot()).orders.length).toBe(0);
    await page.locator("#paper-compose-review").click();
    await expect(page.locator("#paper-compose-submit")).toBeEnabled();
    expect((await f.a.snapshot()).revision).toBe(1);
    const s = await f.a.snapshot();
    await f.a.setRisk({
      expectedRevision: 1,
      policy: { ...s.risk, maxMarkets: 2 },
    });
    await expect(page.locator("#paper-compose-notice")).toContainText(
      "Account changed",
    );
    await expect(page.locator("#paper-compose-submit")).toBeDisabled();
    await page.locator("#paper-compose-review").click();
    await expect(page.locator("#paper-compose-review-body")).toContainText(
      "account r2",
    );
    for (const theme of ["dark", "light"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 1100, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page
        .locator("#paper-composer")
        .screenshot({ path: `test-results/paper-composer-${theme}.png` });
    }
    await page.locator('[data-page="workspace"]').click();
    await page.locator('[data-page="paper"]').click();
    await expect(chart).toHaveAttribute("data-ready", "true");
    await expect(page.locator("#paper-compose-submit")).toBeEnabled();
    const price = Number(
        await page.locator("#paper-compose-price").inputValue(),
      ),
      stop = Number(await page.locator("#paper-compose-stop").inputValue()),
      target = Number(await page.locator("#paper-compose-target").inputValue());
    loseReply = true;
    await page.locator("#paper-compose-submit").click();
    await expect(page.locator("#paper-compose-error")).toContainText(
      "Reply lost",
    );
    await expect(page.locator("#paper-compose-price")).toBeDisabled();
    await expect(page.locator("#paper-compose-new")).toBeDisabled();
    const saved = await f.a.snapshot();
    expect(saved.orders).toHaveLength(1);
    expect(saved.orders[0].price).toBe(price);
    expect(saved.orders[0].bracket).toEqual({
      stop,
      targets: [{ price: target, quantity: 1 }],
    });
    expect(saved.fills).toHaveLength(0);
    await page.locator("#paper-compose-check").click();
    await expect(page.locator("#paper-compose-notice")).toContainText(
      "is recorded",
    );
    expect((await f.a.snapshot()).orders).toHaveLength(1);
    await expect(page.locator("#paper-compose-submit")).toBeDisabled();
    await page.locator("#paper-compose-new").click();
    await page.locator("#paper-compose-symbol").fill("ETHUSDT");
    await expect(page.locator("#paper-compose-price")).toHaveValue("");
    offline = true;
    await page.locator("#paper-compose-load").click();
    await expect(page.locator("#paper-compose-chart-status")).toContainText(
      "Numeric entry remains available",
    );
    await page.locator("#paper-compose-quantity").fill("1");
    await page.locator("#paper-compose-price").fill("50");
    await page.locator("#paper-compose-review").click();
    await expect(page.locator("#paper-compose-review-body")).toContainText(
      "ETHUSDT",
    );
    await page.locator("#paper-compose-price").fill("51");
    await expect(page.locator("#paper-compose-submit")).toBeDisabled();
    await page.locator("#paper-compose-review").click();
    await page.locator("#paper-compose-submit").click();
    await expect(page.locator("#paper-compose-notice")).toContainText(
      "is recorded",
    );
    expect((await f.a.snapshot()).orders).toHaveLength(2);
    await page.locator("#paper-compose-new").click();
    await page.locator("#paper-compose-mode").selectOption("sell-stop");
    await page.locator("#paper-compose-price").fill("40");
    await page.locator("#paper-compose-review").click();
    await expect(page.locator("#paper-compose-error")).toContainText(
      "quantity",
    );
    expect((await monitor.snapshot()).active).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await monitor.close();
  }
});
