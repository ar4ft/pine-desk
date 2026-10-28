import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DesktopBridge,
  bridgeDefaults,
  callDesktop,
  readBridgeDescriptor,
} from "../core/desktop-bridge.js";
import { createMcpBackend } from "../core/mcp-backend.js";
import { desktopDispatcher } from "../core/desktop-session.js";
import { acquireServiceOwner } from "../core/service-owner.js";
import { toolDefinitions } from "../core/mcp-tools.js";
import { datasetInstrument } from "../core/instruments.js";

async function fixture(t, dispatch) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pd-test-"));
  const bridge = new DesktopBridge({ dataDir, dispatch });
  t.after(async () => {
    await bridge.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  await bridge.configure({ ...bridgeDefaults, enabled: true });
  return { bridge, dataDir, descriptor: await readBridgeDescriptor(dataDir) };
}
test("local bridge authenticates, validates schemas and enforces capabilities without leaking its key", async (t) => {
  const calls = [];
  const { bridge, descriptor, dataDir } = await fixture(t, async (action) => {
    calls.push(action);
    return { active: true, ownerPid: process.pid };
  });
  assert.equal(
    (await fs.stat(path.join(dataDir, "desktop-bridge.json"))).mode & 0o777,
    0o600,
  );
  assert.equal(
    (await fs.stat(path.dirname(descriptor.socketPath))).mode & 0o777,
    0o700,
  );
  await assert.rejects(
    callDesktop({ ...descriptor, token: "x".repeat(64) }, "live_status"),
    /authentication/,
  );
  await assert.rejects(callDesktop(descriptor, "saveCredentials"), /Unknown/);
  await assert.rejects(
    callDesktop(descriptor, "live_status", { injected: true }),
    /Unrecognized/,
  );
  await assert.rejects(
    callDesktop(descriptor, "live_start", {
      symbol: "BTCUSDT",
      timeframe: "1m",
    }),
    /streams access is disabled/,
  );
  await assert.rejects(
    callDesktop(descriptor, "desktop_chart_set_script", {
      panelId: "workspace",
      source: "test",
      name: "test",
    }),
    /charts access is disabled/,
  );
  await assert.rejects(
    callDesktop(descriptor, "save_script", { source: "test", name: "test" }),
    /research access is disabled/,
  );
  assert.deepEqual(calls, []);
  assert.equal((await callDesktop(descriptor, "live_status")).active, true);
  assert.deepEqual(calls, ["liveSnapshot"]);
  assert.ok(!JSON.stringify(bridge.status()).includes(descriptor.token));
  assert.equal(bridge.status().events[0].status, "completed");
});
test("two attached clients share one service; closing a client leaves streams running; revoked clients cannot reattach silently", async (t) => {
  let starts = 0,
    active = false;
  const { bridge, dataDir } = await fixture(t, async (action) => {
    if (action === "liveStart") {
      starts++;
      active = true;
    }
    return { starts, active };
  });
  await bridge.configure({ ...bridgeDefaults, enabled: true, streams: true });
  const first = await createMcpBackend({ mode: "desktop", dataDir });
  const second = await createMcpBackend({ mode: "auto", dataDir });
  assert.equal(first.mode, "desktop");
  assert.equal(second.mode, "desktop");
  await first.call("live_start", { symbol: "BTCUSDT", timeframe: "1m" });
  await first.close();
  assert.deepEqual(await second.call("live_status"), {
    starts: 1,
    active: true,
  });
  await bridge.configure({ ...bridgeDefaults, enabled: true });
  await assert.rejects(
    second.call("live_status"),
    /unavailable|authentication|disconnected/,
  );
  const reconnected = await createMcpBackend({ mode: "desktop", dataDir });
  assert.equal((await reconnected.call("live_status")).starts, 1);
  await bridge.configure(bridgeDefaults);
  await assert.rejects(
    reconnected.call("live_status"),
    /unavailable|disconnected/,
  );
  await assert.rejects(
    createMcpBackend({ mode: "desktop", dataDir }),
    /enable agent access/,
  );
});
test("queued mutations are checked again after access changes", async (t) => {
  let unblock, started;
  const running = new Promise((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const { bridge, dataDir } = await fixture(t, async () => {
    calls++;
    started();
    await new Promise((resolve) => {
      unblock = resolve;
    });
    return {};
  });
  await bridge.configure({ ...bridgeDefaults, enabled: true, research: true });
  const descriptor = await readBridgeDescriptor(dataDir);
  const first = callDesktop(descriptor, "save_script", {
    name: "First",
    source: "source",
  }).catch(() => null);
  await running;
  const second = callDesktop(descriptor, "save_script", {
    name: "Second",
    source: "source",
  }).catch(() => null);
  await bridge.configure(bridgeDefaults);
  unblock();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});
test("service ownership excludes a second process owner and releases on shutdown", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pd-owner-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const release = await acquireServiceOwner(dir);
  try {
    await assert.rejects(acquireServiceOwner(dir), /already has.*owner/);
  } finally {
    await release();
  }
  const next = await acquireServiceOwner(dir);
  await next();
});
test("desktop research uses a captured renderer dataset while streams and chart commands use the owning renderer", async () => {
  const dataset = { symbol: "DISPLAYED", bars: [{ time: 1, close: 10 }] };
  let captured;
  const rendererCalls = [];
  const route = desktopDispatcher({
    renderer: async (action, args) => {
      rendererCalls.push({ action, args });
      if (action === "researchSnapshot")
        return { dataset, desktop: { page: "workspace" } };
      return { visible: true };
    },
    dispatch: async (action, args) => {
      if (action === "workspace")
        return { dataset: { symbol: "OLD_DISK" }, scripts: [] };
      captured = args.dataset;
      dataset.bars[0].close = 99;
      return { dataset: captured };
    },
  });
  assert.equal((await route("workspace", {})).dataset.symbol, "DISPLAYED");
  const result = await route("backtest", { source: "strategy" });
  assert.equal(result.dataset.bars[0].close, 10);
  await route("loadMarket", { symbol: "BTCUSDT" });
  assert.equal(rendererCalls.at(-1).action, "serviceAction");
  assert.equal(rendererCalls.at(-1).args.action, "loadMarket");
});
test("all stream-changing tools require stream permission and mutation semantics", () => {
  const tools = toolDefinitions();
  for (const name of [
    "options_refresh",
    "crypto_options_refresh",
    "crypto_options_contract",
    "live_start",
    "options_start",
    "option_record_start",
  ]) {
    const tool = tools.find((t) => t.name === name);
    assert.equal(tool.capability, "streams", name);
    assert.equal(tool.readOnly, false, name);
  }
  assert.ok(
    !tools.some((t) =>
      /credential|configureEngine|agentConfigure/.test(t.action),
    ),
  );
});
test("instrument identity separates venue/type and preserves unknown import units", () => {
  const live = datasetInstrument({
    symbol: "BTCUSDT",
    origin: "Binance live • settled candles",
  });
  const imported = datasetInstrument({
    symbol: "BTCUSDT",
    origin: "Imported OHLCV",
  });
  assert.notEqual(live.id, imported.id);
  assert.equal(live.assetType, "spot");
  assert.equal(imported.assetType, "unknown");
  assert.equal(imported.settlementCurrency, null);
});

test("legacy bridge configs deny alert changes until the separate alert permission is enabled", async (t) => {
  const { bridge, dataDir } = await fixture(t, async (action) => ({ action }));
  await bridge.configure({
    enabled: true,
    charts: true,
    streams: true,
    research: true,
  });
  let descriptor = await readBridgeDescriptor(dataDir);
  assert.equal(bridge.status().alerts, false);
  assert.deepEqual(await callDesktop(descriptor, "alerts_status"), {
    action: "alertStatus",
  });
  await assert.rejects(
    callDesktop(descriptor, "alerts_configure", {
      monitoring: true,
      notifications: false,
    }),
    /alerts/,
  );
  await bridge.configure({ ...bridgeDefaults, enabled: true, alerts: true });
  descriptor = await readBridgeDescriptor(dataDir);
  assert.deepEqual(
    await callDesktop(descriptor, "alerts_configure", {
      monitoring: true,
      notifications: false,
    }),
    { action: "alertConfigure" },
  );
  for (const tool of toolDefinitions().filter((t) =>
    [
      "alertCreate",
      "alertUpdate",
      "alertConfigure",
      "alertDelete",
      "alertAcknowledge",
    ].includes(t.action),
  )) {
    assert.equal(tool.capability, "alerts");
    assert.equal(tool.readOnly, false);
  }
});
