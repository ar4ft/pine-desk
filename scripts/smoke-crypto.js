// Opt-in genuine public market-data check. No credentials or order endpoints.
import assert from "node:assert/strict";
import { DeribitOptions } from "../core/deribit.js";
const d = new DeribitOptions();
try {
  for (const currency of ["BTC", "ETH"]) {
    const s = await d.refresh({ currency });
    assert.ok(s.rows.length > 0 && s.spot > 0 && s.term.length > 0);
    console.log(
      JSON.stringify({
        currency,
        contracts: s.rows.length,
        expiries: s.term.length,
        trades: s.trades.length,
        spot: s.spot,
        fetchedAt: s.fetchedAt,
      }),
    );
  }
  const s = d.snapshot(),
    contract = s.rows
      .filter((r) => r.type === "call")
      .sort(
        (a, b) => Math.abs(a.strike - s.spot) - Math.abs(b.strike - s.spot),
      )[0];
  await d.select({ instrument: contract.instrument });
  const previous = d.snapshot().ticker.timestamp;
  d.start();
  await new Promise((resolve, reject) => {
    const poll = setInterval(() => {
      const s = d.snapshot();
      if (s.status === "streaming" && s.ticker.timestamp > previous) {
        clearInterval(poll);
        clearTimeout(deadline);
        console.log(
          JSON.stringify({
            status: s.status,
            instrument: s.instrument,
            timestamp: s.ticker.timestamp,
            greeks: s.ticker.greeks,
            retainedTrades: s.trades.length,
          }),
        );
        resolve();
      }
    }, 250);
    const deadline = setTimeout(() => {
      clearInterval(poll);
      reject(
        new Error(
          `No acknowledged ticker update within 30s: ${d.state.status}; ${d.state.error ?? ""}`,
        ),
      );
    }, 30000);
  });
  console.log(
    "Deribit public REST and both acknowledged WebSocket channels passed.",
  );
} finally {
  d.stop();
}
