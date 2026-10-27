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
    assert.equal(original.panels[0].id, "workspace");
    const denied = await readOnly.callTool({
      name: "desktop_navigate",
      arguments: { page: "workspace" },
    });
    assert.equal(denied.isError, true);
    for (const scope of ["charts", "streams", "research"])
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
    await first.close();
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
    "Desktop MCP passed: shared stream, observed chart edits, execution errors, snapshot research, client disconnect and revocation.",
  );
}
