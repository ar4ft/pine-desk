import { desktopPaperSmoke } from "./desktop-paper-smoke.js";
import { desktopPlanSmoke, planFixture } from "./desktop-plan-smoke.js";
import { desktopFootprintSmoke } from "./desktop-footprint-smoke.js";
import { desktopDepthSmoke } from "./desktop-depth-smoke.js";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function desktopMcpSmoke({ app, page, dataDir }) {
  const clients = [];
  const connect = async () => {
    const client = new Client({ name: "desktop-smoke", version: "1" });
    clients.push(client);
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["core/mcp.js"],
        env: {
          ...process.env,
          PINE_DESK_DATA_DIR: dataDir,
          PINE_DESK_MCP_MODE: "desktop",
        },
        stderr: "pipe",
      }),
    );
    return client;
  };
  const call = async (client, name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    assert.ok(!response.isError, JSON.stringify(response));
    return JSON.parse(response.content[0].text);
  };
  const waitIdle = () =>
    page.waitForFunction(
      () =>
        document.querySelector("#status")?.textContent === "Local workspace",
    );
  try {
    await waitIdle();
    await page.locator('[data-page="mcp"]').click();
    await page.locator("#agent-enabled").check();
    await page.locator("#agent-save").click();
    await waitIdle();
    const readOnly = await connect();
    const original = await call(readOnly, "desktop_state");
    assert.equal(
      (await call(readOnly, "plan_estimate", { input: planFixture })).quantity,
      10,
    );
    assert.equal(
      (
        await readOnly.callTool({
          name: "plan_save",
          arguments: { input: planFixture },
        })
      ).isError,
      true,
    );
    assert.equal(await call(readOnly, "paper_account"), null);
    assert.equal((await call(readOnly, "paper_journal")).entries.length, 0);
    assert.equal((await call(readOnly, "paper_history")).count, 0);
    assert.equal(
      (
        await readOnly.callTool({
          name: "paper_journal_save",
          arguments: {
            orderId: "11111111-1111-4111-a111-111111111111",
            expectedRevision: 0,
            input: {
              thesis: "Denied",
              review: "",
              tags: [],
              adherence: "unreviewed",
            },
          },
        })
      ).isError,
      true,
    );
    assert.equal(
      (await readOnly.callTool({ name: "paper_monitor_start", arguments: {} }))
        .isError,
      true,
    );
    assert.equal(
      (
        await readOnly.callTool({
          name: "paper_create",
          arguments: { initialCash: 1000 },
        })
      ).isError,
      true,
    );
    assert.equal(original.panels[0].id, "workspace");
    const denied = await readOnly.callTool({
      name: "desktop_navigate",
      arguments: { page: "workspace" },
    });
    assert.equal(denied.isError, true);
    const alertDenied = await readOnly.callTool({
      name: "alerts_configure",
      arguments: { monitoring: true, notifications: true },
    });
    assert.equal(alertDenied.isError, true);
    const depthDenied = await readOnly.callTool({
      name: "depth_start",
      arguments: { symbol: "BTCUSDT" },
    });
    assert.equal(depthDenied.isError, true);
    assert.equal(
      (await readOnly.callTool({ name: "depth_record_start", arguments: {} }))
        .isError,
      true,
    );
    assert.equal(
      (
        await readOnly.callTool({
          name: "depth_recording_delete",
          arguments: { id: "untrusted" },
        })
      ).isError,
      true,
    );
    assert.equal((await call(readOnly, "depth_snapshot")).active, false);
    for (const scope of ["charts", "streams", "research", "alerts"])
      await page.locator("#agent-" + scope).check();
    await page.locator("#agent-save").click();
    await waitIdle();
    const revoked = await readOnly.callTool({
      name: "desktop_state",
      arguments: {},
    });
    assert.equal(revoked.isError, true);
    await readOnly.close();
    const first = await connect(),
      second = await connect();
    const source =
      '//@version=6\nindicator("Agent smoke", overlay=true)\nplot(close)';
    const edited = await call(first, "desktop_chart_set_script", {
      panelId: "workspace",
      name: "Agent smoke",
      source,
    });
    assert.equal(edited.panels[0].editor.source, source);
    assert.equal(await page.locator("#source").inputValue(), source);
    const plotted = await call(first, "desktop_chart_run", {
      panelId: "workspace",
    });
    assert.ok(
      plotted.panels[0].chart.indicators.some((i) => i.source === source),
    );
    await call(first, "desktop_chart_set_script", {
      panelId: "workspace",
      name: "Broken",
      source: '//@version=6\nindicator("Broken")\nplot(',
    });
    const broken = await first.callTool({
      name: "desktop_chart_run",
      arguments: { panelId: "workspace" },
    });
    assert.equal(broken.isError, true);
    await call(first, "desktop_chart_set_script", {
      panelId: "workspace",
      name: "Agent smoke",
      source,
    });
    const before = await call(first, "workspace");
    const bars = before.dataset.bars;
    const range = await call(first, "desktop_chart_set_range", {
      panelId: "workspace",
      from: bars.at(-40).time,
      to: bars.at(-1).time,
    });
    assert.ok(
      range.panels[0].chart.range.to > range.panels[0].chart.range.from,
    );
    // Use deterministic REST history for comparison charts in source and packaged apps.
    await app.evaluate(({ app }, bars) => {
      const path = process.getBuiltinModule("node:path");
      const require = process
        .getBuiltinModule("node:module")
        .createRequire(path.join(app.getAppPath(), "package.json"));
      const { chartPanels } = require(
        path.join(app.getAppPath(), "core/service.js"),
      );
      globalThis.pineDeskSmokePanels = {
        chartPanels,
        fetchHistory: chartPanels.fetchHistory,
      };
      chartPanels.fetchHistory = async (request) => ({
        symbol: request.symbol,
        timeframe: request.timeframe,
        origin: "Binance fixture",
        bars,
      });
    }, bars);
    await page.locator("#chart-count").selectOption("4");
    await page.waitForSelector("#compare-3[data-ready=true]");
    await waitIdle();
    const grid = await call(second, "desktop_state");
    assert.equal(grid.panels.length, 4);
    assert.equal(grid.panels[1].instrument.symbol, "ETHUSDT");
    assert.equal((await call(second, "chart_panels_snapshot")).length, 3);
    const linked = await call(second, "desktop_chart_set_range", {
      panelId: "compare-1",
      from: bars.at(-60).time,
      to: bars.at(-1).time,
    });
    assert.ok(
      Math.abs(
        linked.panels[0].chart.range.from - linked.panels[1].range.from,
      ) < 3600000,
    );
    await page.locator('[data-panel-symbol="compare-1"]').fill("BTCUSDT");
    await page.locator('[data-panel-load="compare-1"]').click();
    await waitIdle();
    await page.locator("#chart-count").selectOption("1");
    await waitIdle();
    const strategy =
      '//@version=6\nstrategy("Attached test")\nif bar_index == 0\n    strategy.entry("Long", strategy.long, qty=1)';
    const run = await call(first, "run_backtest", { source: strategy });
    assert.deepEqual(run.dataset, before.dataset);
    assert.ok(
      (await page.evaluate(() => window.desk.call("workspace"))).runs.some(
        (r) => r.id === run.id,
      ),
    );

    // Exercise the real owning BinanceLive instance without depending on exchange
    // uptime: only its network transport/history are replaced for this smoke.
    await app.evaluate(async ({ app }, bars) => {
      const path = process.getBuiltinModule("node:path"),
        { EventEmitter } = process.getBuiltinModule("node:events");
      const require = process
        .getBuiltinModule("node:module")
        .createRequire(path.join(app.getAppPath(), "package.json"));
      const { live } = require(path.join(app.getAppPath(), "core/service.js"));
      globalThis.pineDeskSmokeLive = {
        live,
        fetchHistory: live.fetchHistory,
        createSocket: live.createSocket,
        starts: 0,
      };
      live.fetchHistory = async () => bars;
      live.createSocket = () => {
        globalThis.pineDeskSmokeLive.starts++;
        const socket = new EventEmitter();
        socket.terminate = () => socket.emit("close");
        queueMicrotask(() => socket.emit("open"));
        return socket;
      };
    }, bars);
    await call(first, "live_start", { symbol: "BTCUSDT", timeframe: "1h" });
    const live = await call(second, "live_status");
    assert.equal(live.active, true);
    assert.equal(live.dataset.symbol, "BTCUSDT");
    const owner = await page.evaluate(() => window.desk.call("liveSnapshot"));
    assert.equal(owner.startedAt, live.startedAt);
    assert.equal(
      await app.evaluate(() => globalThis.pineDeskSmokeLive.starts),
      1,
    );
    await page.locator("#chart-count").selectOption("2");
    await page.waitForSelector("#compare-1[data-ready=true]");
    await waitIdle();
    await page.locator('[data-panel-live="compare-1"]').check();
    await waitIdle();
    assert.equal(
      (await call(second, "chart_panels_snapshot"))[0].sharedWithPrimary,
      true,
    );
    assert.equal(
      await app.evaluate(() => globalThis.pineDeskSmokeLive.starts),
      1,
    );
    await first.close();
    assert.equal((await call(second, "live_status")).active, true);
    await page.locator("#chart-count").selectOption("1");
    await waitIdle();
    assert.equal((await call(second, "live_status")).active, true);
    await call(second, "live_stop");
    assert.equal(
      (await page.evaluate(() => window.desk.call("liveSnapshot"))).active,
      false,
    );
    await app.evaluate(() => {
      const saved = globalThis.pineDeskSmokeLive;
      saved.live.createSocket = saved.createSocket;
      saved.live.fetchHistory = saved.fetchHistory;
      delete globalThis.pineDeskSmokeLive;
      const panels = globalThis.pineDeskSmokePanels;
      panels.chartPanels.fetchHistory = panels.fetchHistory;
      delete globalThis.pineDeskSmokePanels;
    });
    const csv =
      "time,open,high,low,close,volume\n" +
      bars
        .map((b) =>
          [b.time, b.open, b.high, b.low, b.close, b.volume].join(","),
        )
        .join("\n");
    await call(second, "import_bars", {
      csv,
      symbol: before.dataset.symbol,
      timeframe: before.dataset.timeframe,
    });
    assert.equal(
      (await call(second, "desktop_state")).panels[0].instrument.symbol,
      before.dataset.symbol,
    );
    await call(second, "desktop_chart_set_script", {
      panelId: "workspace",
      ...original.panels[0].editor,
    });
    const depthClient = await connect();
    await desktopDepthSmoke({ app, page, first: depthClient, second, call });
    await depthClient.close();
    await desktopFootprintSmoke({ page, client: second, call });
    await desktopPlanSmoke({ page, client: second, call });
    await desktopPaperSmoke({ app, page, client: second, call });
    // Real alert engine, durable store and attached MCP; replace only transport
    // and OS notification submission so packaged CI never depends on permissions.
    await app.evaluate(({ app }) => {
      const path = process.getBuiltinModule("node:path"),
        { EventEmitter } = process.getBuiltinModule("node:events");
      const require = process
        .getBuiltinModule("node:module")
        .createRequire(path.join(app.getAppPath(), "package.json"));
      const { marketQuotes, alertEngine } = require(
        path.join(app.getAppPath(), "core/service.js"),
      );
      const fixture = (globalThis.pineDeskSmokeAlerts = {
        marketQuotes,
        alertEngine,
        createSocket: marketQuotes.createSocket,
        notify: alertEngine.notify,
        submissions: 0,
        starts: 0,
        eventAt: 0,
      });
      marketQuotes.createSocket = () => {
        fixture.starts++;
        fixture.socket = new EventEmitter();
        fixture.socket.terminate = () => fixture.socket.emit("close");
        queueMicrotask(() => fixture.socket.emit("open"));
        return fixture.socket;
      };
      alertEngine.notify = () => {
        fixture.submissions++;
        return "submitted";
      };
    });
    await page.evaluate(() =>
      window.desk.call("watchlistStart", { symbols: ["BTCUSDT"] }),
    );
    const alert = await call(second, "alerts_create", {
      rule: {
        name: "Native MCP alert",
        symbol: "BTCUSDT",
        direction: "above",
        price: 100,
      },
    });
    await call(second, "alerts_configure", {
      monitoring: true,
      notifications: true,
    });
    assert.equal(
      await app.evaluate(() => globalThis.pineDeskSmokeAlerts.starts),
      1,
    );
    await page.evaluate(() => window.desk.call("watchlistStop"));
    assert.equal((await call(second, "alerts_status")).feed.active, true);
    for (const price of [99, 101]) {
      await app.evaluate(async (_electron, price) => {
        const fixture = globalThis.pineDeskSmokeAlerts;
        fixture.eventAt = Math.max(Date.now(), fixture.eventAt + 1);
        fixture.socket.emit(
          "message",
          JSON.stringify({
            e: "24hrTicker",
            s: "BTCUSDT",
            E: fixture.eventAt,
            c: String(price),
            P: "0",
          }),
        );
        await fixture.alertEngine.queue;
      }, price);
    }
    const history = await call(second, "alerts_history");
    assert.equal(history.total, 1);
    assert.equal(history.events[0].ruleId, alert.id);
    assert.equal(history.events[0].notification, "submitted");
    assert.equal(
      await app.evaluate(() => globalThis.pineDeskSmokeAlerts.submissions),
      1,
    );
    await call(second, "desktop_navigate", { page: "alerts" });
    await page.waitForFunction(() =>
      document
        .querySelector("#alert-history")
        ?.textContent.includes("99 → 101"),
    );
    await call(second, "alerts_acknowledge", { id: history.events[0].id });
    await call(second, "alerts_configure", {
      monitoring: false,
      notifications: true,
    });
    await app.evaluate(() => {
      const fixture = globalThis.pineDeskSmokeAlerts;
      fixture.marketQuotes.createSocket = fixture.createSocket;
      fixture.alertEngine.notify = fixture.notify;
      delete globalThis.pineDeskSmokeAlerts;
    });
    await call(second, "desktop_navigate", { page: "mcp" });
    await page.locator("#agent-revoke").click();
    await waitIdle();
    assert.equal(
      (await second.callTool({ name: "live_status", arguments: {} })).isError,
      true,
    );
    assert.equal(
      (await page.evaluate(() => window.desk.call("agentStatus"))).running,
      false,
    );
    await assert.rejects(fs.stat(path.join(dataDir, "desktop-bridge.json")), {
      code: "ENOENT",
    });
    await page.locator('[data-page="workspace"]').click();
    await page.waitForSelector("#chart[data-ready=true]");
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
  }
  console.log(
    "Desktop MCP passed: synchronized depth, persistent alerts and scope enforcement, linked charts, shared primary/comparison stream, observed chart edits, execution errors, snapshot research, client disconnect and revocation.",
  );
}
