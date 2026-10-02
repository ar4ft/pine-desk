import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const { gracefulQuit } = createRequire(import.meta.url)(
  "../electron/graceful-quit.cjs",
);
test("app quit persists bounds before retry and never intercepts the second quit", async () => {
  const app = new EventEmitter(),
    events = [];
  app.quit = () => {
    const event = { preventDefault: () => events.push("prevent") };
    app.emit("before-quit", event);
    events.push("quit");
  };
  const quitting = gracefulQuit({
    app,
    persist: async () => events.push("save"),
    stop: () => events.push("stop"),
  });
  app.quit();
  assert.equal(quitting(), true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(events, ["prevent", "stop", "quit", "save", "quit"]);
});
test("hung persistence cannot block app quit", async () => {
  const app = new EventEmitter();
  let quits = 0;
  app.quit = () => {
    quits++;
    app.emit("before-quit", { preventDefault() {} });
  };
  gracefulQuit({
    app,
    persist: () => new Promise(() => {}),
    stop() {},
    timeoutMs: 10,
  });
  app.quit();
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(quits, 2);
});
