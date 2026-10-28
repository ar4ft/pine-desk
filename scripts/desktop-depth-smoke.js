import assert from "node:assert/strict";

// Exercise the real main-process book, renderer IPC and two attached MCP clients.
// Only exchange transport is deterministic, including in installed DMG/ZIP apps.
export async function desktopDepthSmoke({ app, page, first, second, call }) {
  await app.evaluate(({ app }) => {
    const path = process.getBuiltinModule("node:path"),
      { EventEmitter } = process.getBuiltinModule("node:events");
    const require = process
      .getBuiltinModule("node:module")
      .createRequire(path.join(app.getAppPath(), "package.json"));
    const { depth } = require(path.join(app.getAppPath(), "core/service.js"));
    const fixture = (globalThis.pineDeskSmokeDepth = {
      depth,
      createSocket: depth.createSocket,
      fetcher: depth.fetcher,
      starts: 0,
    });
    depth.fetcher = async () => ({
      ok: true,
      json: async () => ({
        lastUpdateId: 100,
        bids: [
          ["99", "2"],
          ["98", "3"],
        ],
        asks: [
          ["101", "4"],
          ["102", "1"],
        ],
      }),
    });
    depth.createSocket = () => {
      fixture.starts++;
      const socket = new EventEmitter();
      fixture.socket = socket;
      socket.terminate = () => socket.emit("close");
      queueMicrotask(() => socket.emit("open"));
      return socket;
    };
  });
  try {
    const before = await call(second, "workspace");
    await call(second, "depth_start", { symbol: "BTCUSDT" });
    await call(first, "depth_start", { symbol: "BTCUSDT" });
    assert.equal(
      await app.evaluate(() => globalThis.pineDeskSmokeDepth.starts),
      1,
    );
    await app.evaluate(() => {
      const { socket } = globalThis.pineDeskSmokeDepth;
      socket.emit(
        "message",
        JSON.stringify({
          e: "depthUpdate",
          s: "BTCUSDT",
          E: Date.now(),
          U: 101,
          u: 101,
          b: [["99", "5"]],
          a: [],
        }),
      );
    });
    const book = await call(first, "depth_snapshot", { limit: 10 });
    assert.equal(book.stale, false);
    assert.equal(book.bids[0].size, 5);
    assert.equal(book.spread, 2);
    await call(second, "desktop_navigate", { page: "orderflow" });
    await page.locator('[data-flow-tab="depth"]').click();
    await page.waitForFunction(() =>
      document
        .querySelector(".depth-identity")
        ?.textContent.includes("Sequence 101"),
    );
    assert.equal(
      (await page.evaluate(() => window.desk.call("depthSnapshot")))
        .lastUpdateId,
      book.lastUpdateId,
    );
    assert.deepEqual((await call(second, "workspace")).dataset, before.dataset);
    await app.evaluate(() =>
      globalThis.pineDeskSmokeDepth.socket.emit(
        "message",
        JSON.stringify({
          e: "depthUpdate",
          s: "BTCUSDT",
          E: Date.now(),
          U: 103,
          u: 103,
          b: [],
          a: [],
        }),
      ),
    );
    const gap = await call(second, "depth_snapshot");
    assert.equal(gap.stale, true);
    assert.deepEqual(gap.bids, []);
    assert.match(gap.error, /sequence gap/);
    await page.locator("#depth-stop").click();
    await page.waitForFunction(() =>
      document.querySelector("#depth-status")?.textContent.includes("stopped"),
    );
    assert.equal((await call(second, "depth_snapshot")).active, false);
  } finally {
    await app.evaluate(() => {
      const fixture = globalThis.pineDeskSmokeDepth;
      fixture.depth.stop();
      fixture.depth.createSocket = fixture.createSocket;
      fixture.depth.fetcher = fixture.fetcher;
      delete globalThis.pineDeskSmokeDepth;
    });
  }
}
