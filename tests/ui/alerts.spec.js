import { test, expect } from "@playwright/test";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AlertEngine } from "../../core/alerts.js";
import { MarketQuotes } from "../../core/market-quotes.js";
import { QuoteSubscriptions } from "../../core/quote-subscriptions.js";
let dir, dispatch;
test.beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pd-alert-ui-"));
  process.env.PINE_DESK_DATA_DIR = dir;
  ({ dispatch } = await import("../../core/service.js"));
});
test.afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

test("create, edit, monitor and acknowledge durable price alerts without chart navigation or draft loss", async ({
  page,
}) => {
  let saved = null,
    now = Date.now(),
    socket;
  const notifications = [],
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const repository = {
    read: async () => structuredClone(saved),
    write: async (doc) => {
      saved = structuredClone(doc);
    },
  };
  const feed = new MarketQuotes({
    now: () => now,
    maxSymbols: 100,
    createSocket: () => {
      socket = new EventEmitter();
      socket.terminate = () => socket.emit("close");
      queueMicrotask(() => socket.emit("open"));
      return socket;
    },
  });
  const hub = new QuoteSubscriptions(feed);
  let engine = new AlertEngine({
    repository,
    quotes: hub,
    now: () => now,
    notify: (event) => {
      notifications.push(event);
      return "submitted";
    },
  });
  await engine.initialize();
  try {
    await page.exposeFunction("backendCall", (action, args = {}) => {
      switch (action) {
        case "alertStatus":
          return engine.snapshot();
        case "alertHistory":
          return engine.history(args);
        case "alertConfigure":
          return engine.configure(args);
        case "alertCreate":
          return engine.save(args.rule);
        case "alertUpdate":
          return engine.save(args.rule, args.id);
        case "alertDelete":
          return engine.remove(args.id);
        case "alertAcknowledge":
          return engine.acknowledge(args.id);
        default:
          return dispatch(action, args);
      }
    });
    await page.addInitScript(() => {
      window.desk = { call: (a, b) => window.backendCall(a, b) };
    });
    await page.goto("/");
    await expect(page.locator("#chart")).toHaveAttribute("data-ready", "true");
    await page.locator("#create-price-alert").click();
    await expect(page.locator("#title")).toHaveText("Local alerts");
    await page.locator("#alert-name").fill("BTC crossing test");
    await page.locator("#alert-price").fill("100");
    await page.locator("#alert-save").click();
    await expect(page.locator("#alert-rules")).toContainText(
      "BTC crossing test",
    );
    await expect(page.locator("#alert-rules")).toContainText("paused");
    await page.locator("[data-alert-edit]").click();
    await expect(page.locator("#alert-name")).toHaveValue("BTC crossing test");
    await page.locator("#alert-name").fill("Bitcoin threshold");
    await page.locator("#alert-save").click();
    await expect(page.locator("#alert-rules")).toContainText(
      "Bitcoin threshold",
    );
    await page.locator("#alerts-toggle").click();
    await expect(page.locator("#alerts-status")).toContainText(
      "Monitoring enabled",
    );
    await page.locator("#alert-name").fill("Unsubmitted draft");
    const send = async (price) => {
      now += 1000;
      socket.emit(
        "message",
        JSON.stringify({
          e: "24hrTicker",
          s: "BTCUSDT",
          E: now,
          c: String(price),
          P: "0",
        }),
      );
      await engine.queue;
    };
    await send(99);
    await send(101);
    await expect(page.locator("#alert-history")).toContainText("99 → 101");
    await expect(page.locator("#alert-history")).toContainText("submitted");
    await expect(page.locator("#alert-name")).toHaveValue("Unsubmitted draft");
    expect(notifications).toHaveLength(1);
    await page.screenshot({
      path: "test-results/local-alerts.png",
      fullPage: true,
      style: "#toast { visibility: hidden; }",
    });
    await page.locator("[data-alert-ack]").click();
    await expect(page.locator("#alert-history")).toContainText("Reviewed");
    await expect(page.locator("#alerts-status")).toContainText(
      "0 unreviewed events",
    );
    // Simulate a service restart from persisted data: one-shot remains disarmed.
    await engine.close();
    engine = new AlertEngine({ repository, quotes: hub, now: () => now });
    await engine.initialize();
    await page.reload();
    await expect(page.locator("#alert-rules")).toContainText("disabled");
    await expect(page.locator("#alert-history")).toContainText("Reviewed");
    await page.locator("#alerts-toggle").click();
    await expect(page.locator("#alerts-status")).toContainText(
      "Monitoring paused",
    );
    await page.locator("[data-alert-delete]").click();
    await expect(page.locator("#alert-rules")).toContainText(
      "No alert rules yet",
    );
    await expect(page.locator("#alert-history")).toContainText(
      "Bitcoin threshold",
    );
    expect(errors).toEqual([]);
  } finally {
    await engine.close();
    hub.stop();
  }
});
