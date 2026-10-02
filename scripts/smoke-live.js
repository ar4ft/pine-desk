import assert from "node:assert/strict";
import { libraryCall } from "../core/library.js";
import { fetchBinance } from "../core/data.js";
import { PineTS } from "pinets";
const catalog = await libraryCall("library_list_indicators", {
  page: 0,
  page_size: 2,
});
assert.ok(catalog.total > 0);
assert.equal(catalog.indicators.length, 2);
console.log(`LuxAlgo public catalog: ${catalog.total} indicators`);
const source = await libraryCall("library_get_source_code", {
  slug: "supertrend",
});
assert.ok(source.available && source.source.includes("indicator("));
console.log("LuxAlgo SuperTrend source: available");
const bars = await fetchBinance({
  symbol: "BTCUSDT",
  timeframe: "1h",
  limit: 20,
});
assert.ok(bars.length >= 19);
console.log(`Binance: ${bars.length} settled bars`);
const output = await new PineTS(
  bars.map((b) => ({
    ...b,
    openTime: b.time,
    closeTime: b.time + 3600000 - 1,
  })),
).run(source.source);
assert.ok(Object.keys(output.plots).length > 0);
console.log("Public SuperTrend source executed successfully in PineTS");
