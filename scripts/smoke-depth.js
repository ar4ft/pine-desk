import assert from "node:assert/strict";
import { BinanceDepth } from "../core/depth.js";
const depth = new BinanceDepth();
try {
  depth.start({ symbol: "BTCUSDT" });
  const deadline = Date.now() + 30000;
  let snapshot;
  do {
    await new Promise((resolve) => setTimeout(resolve, 250));
    snapshot = depth.snapshot();
    if (!snapshot.stale) break;
  } while (Date.now() < deadline);
  assert.equal(snapshot.stale, false, JSON.stringify(snapshot));
  assert.ok(snapshot.spread > 0 && snapshot.lastUpdateId > 0);
  assert.equal(snapshot.bids.length, 20);
  assert.equal(snapshot.asks.length, 20);
  console.log(
    JSON.stringify({
      symbol: snapshot.symbol,
      status: snapshot.status,
      sequence: snapshot.lastUpdateId,
      spread: snapshot.spread,
      coverage: snapshot.coverage,
    }),
  );
} finally {
  depth.stop();
}
