import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { BinanceDepth } from "../core/depth.js";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pine-desk-depth-smoke-"));
process.env.PINE_DESK_DATA_DIR = dir;
const { DepthHistory, DepthRecorder } = await import(
  "../core/depth-history.js"
);
const depth = new BinanceDepth(),
  history = new DepthHistory(),
  recorder = new DepthRecorder({ history, depth });
try {
  depth.start({ symbol: "BTCUSDT" });
  const deadline = Date.now() + 25000;
  while (depth.snapshot().stale && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 250));
  assert.equal(depth.snapshot().stale, false, JSON.stringify(depth.snapshot()));
  await recorder.start({
    name: "Public network smoke",
    levels: 20,
    intervalSeconds: 1,
  });
  await new Promise((r) => setTimeout(r, 3200));
  const stopped = await recorder.stop();
  assert.equal(stopped.error, null);
  const record = await history.get({ id: stopped.meta.id });
  assert.ok(record.frames.length >= 3);
  assert.ok(record.frames.every((f) => f.book?.symbol === "BTCUSDT"));
  const reopened = new DepthHistory();
  const restored = await reopened.get({ id: stopped.meta.id });
  assert.deepEqual(restored.frames, record.frames);
  console.log(
    JSON.stringify({
      symbol: record.meta.symbol,
      samples: record.total,
      status: record.meta.status,
      compressedBytes: record.meta.bytes,
      verifiedAfterReopen: true,
    }),
  );
} finally {
  await recorder.stop();
  depth.stop();
  await fs.rm(dir, { recursive: true, force: true });
}
