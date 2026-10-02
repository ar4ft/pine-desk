import { sabrIV } from "../../core/option-surface.js";
import { calculateGreeks } from "../../core/greeks.js";
export function optionFixture({
  at = Date.UTC(2026, 0, 1),
  expiry = at + 365 * 86400000,
  spot = 100,
  exchange = "deribit",
  settlement = "BTC",
} = {}) {
  const inverse = settlement === "BTC",
    T = (expiry - at) / (365 * 86400000),
    params = { alpha: 2, beta: 0.5, rho: -0.3, nu: 0.4 },
    rows = [];
  for (let strike = 50; strike <= 160; strike += 5)
    for (const type of ["call", "put"]) {
      const iv = sabrIV(spot, strike, T, params) * 100,
        price =
          calculateGreeks({
            spot,
            strike,
            days: T * 365,
            volatility: iv,
            rate: 0,
            type,
          }).price / (inverse ? spot : 1);
      rows.push({
        exchange,
        instrument: `BTC-${expiry}-${strike}-${type === "call" ? "C" : "P"}`,
        type,
        strike,
        expiry,
        currency: "BTC",
        settlement,
        premiumCurrency: settlement,
        payoffType: inverse ? "inverse" : "linear",
        quantityUnit: "underlying",
        contractSize: 1,
        bid: Math.max(price * 0.98, 0.0000001),
        ask: Math.max(price * 1.02, 0.0000002),
        mark: price,
        iv,
        oi: 100,
        volume: 10,
        underlying: spot,
        index: spot,
        quoteAt: at,
        ivAt: at,
        quoteTimeKind: "Synthetic test observation",
      });
    }
  return {
    exchange,
    currency: "BTC",
    settlement,
    spot,
    fetchedAt: at,
    rows,
    status: "snapshot",
    term: [],
    trades: [],
    gaps: [],
    coverage: "Synthetic fixture only",
  };
}
