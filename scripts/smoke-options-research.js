// Opt-in genuine public Deribit research check. Isolated disk store; no orders.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pine-options-research-"));
process.env.PINE_DESK_DATA_DIR = dir;
const { DeribitOptions } = await import("../core/deribit.js");
const { OptionHistory } = await import("../core/option-history.js");
const { fitSABR, deltaSkew } = await import("../core/option-surface.js");
const { portfolioRisk, backtestOptions } = await import(
  "../core/option-portfolio.js"
);
const provider = new DeribitOptions(),
  history = new OptionHistory();
try {
  const first = await provider.refresh({ currency: "ETH" }),
    expiries = [...new Set(first.rows.map((r) => r.expiry))].sort(
      (a, b) =>
        Math.abs(a - first.fetchedAt - 30 * 86400000) -
        Math.abs(b - first.fetchedAt - 30 * 86400000),
    );
  let surface;
  for (const expiry of expiries) {
    try {
      surface = fitSABR(first, { expiry });
      break;
    } catch {}
  }
  assert.ok(surface, "No qualified expiry for surface research");
  const skew = deltaSkew(first, { expiry: surface.expiry }),
    [a] = await history.save(first),
    second = await provider.refresh({ currency: "ETH" }),
    [b] = await history.save(second);
  const row = first.rows
    .filter(
      (r) =>
        r.expiry === surface.expiry &&
        r.type === "call" &&
        r.bid > 0 &&
        r.ask >= r.bid &&
        second.rows.some(
          (q) => q.instrument === r.instrument && q.bid > 0 && q.ask >= q.bid,
        ),
    )
    .sort(
      (a, b) =>
        Math.abs(a.strike - first.spot) - Math.abs(b.strike - first.spot),
    )[0];
  assert.ok(row);
  const legs = [{ instrument: row.instrument, quantity: 0.1 }],
    risk = portfolioRisk(first, { legs }),
    run = backtestOptions([await history.get(a.id), await history.get(b.id)], {
      legs,
      initialCapital: 1,
      feeBps: 10,
    });
  assert.equal(run.usedQuotes.length, 2);
  assert.ok(Number.isFinite(risk.entryPremium));
  console.log(
    JSON.stringify({
      exchange: "deribit",
      currency: "ETH",
      expiry: surface.expiry,
      qualified: surface.qualified,
      trainRMSE: surface.trainRMSE,
      holdoutRMSE: surface.holdoutRMSE,
      warnings: surface.warnings,
      skew: skew.riskReversal,
      archived: 2,
      replayNetETH: run.metrics.netPnLSettlement,
      origin: "Real public API observations; not synthetic history",
    }),
  );
} finally {
  provider.stop();
  await fs.rm(dir, { recursive: true, force: true });
}
