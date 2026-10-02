import { calculateGreeks } from "./greeks.js";
import { quoteUsable } from "./option-surface.js";
import { fillQuote } from "./execution-model.js";
const day = 86400000;
export function resolveLegs(snapshot, legs, { sameExpiry = true } = {}) {
  if (!Array.isArray(legs) || !legs.length || legs.length > 8)
    throw Error("Build a portfolio of 1–8 legs.");
  const seen = new Set();
  const resolved = legs.map((l) => {
    const row = snapshot.rows.find((r) => r.instrument === l.instrument);
    if (
      !row ||
      seen.has(l.instrument) ||
      !Number.isFinite(l.quantity) ||
      l.quantity === 0 ||
      Math.abs(l.quantity) > 100000
    )
      throw Error(
        "Choose distinct available contracts and nonzero quantities, up to 100,000 underlying units.",
      );
    seen.add(l.instrument);
    return { ...row, quantity: l.quantity };
  });
  if (sameExpiry && new Set(resolved.map((r) => r.expiry)).size !== 1)
    throw Error("This portfolio model supports a single shared expiry.");
  return resolved;
}
const intrinsic = (type, S, K) => Math.max(0, type === "call" ? S - K : K - S);
const positive = (v, key, max = 1e12) => {
  if (!Number.isFinite(v) || v <= 0 || v > max) throw Error(`Invalid ${key}.`);
  return v;
};
export function portfolioRisk(
  snapshot,
  {
    legs,
    spotMin = snapshot.spot * 0.2,
    spotMax = snapshot.spot * 2,
    ivShift = 0,
    daysElapsed = 0,
  } = {},
) {
  const positions = resolveLegs(snapshot, legs, { sameExpiry: false });
  positive(spotMin, "scenario lower spot");
  positive(spotMax, "scenario upper spot");
  if (
    spotMax <= spotMin ||
    !Number.isFinite(ivShift) ||
    Math.abs(ivShift) > 100 ||
    !Number.isFinite(daysElapsed) ||
    daysElapsed < 0 ||
    daysElapsed > 3650
  )
    throw Error("Choose valid spot bounds, IV shift and elapsed days.");
  const inverse =
    positions[0].payoffType === "inverse" ||
    (!positions[0].payoffType && snapshot.settlement === snapshot.currency);
  const entry = positions.map((r) => {
    const price = r.quantity > 0 ? r.ask : r.bid;
    if (!(price > 0) || r.bid > r.ask)
      throw Error("Every leg needs an uncrossed executable-side entry quote.");
    if (!(r.iv > 0 && r.iv <= 300))
      throw Error("Every leg needs IV for model scenarios.");
    return { ...r, entryPrice: price };
  });
  const entryPremium = entry.reduce((s, r) => s + r.quantity * r.entryPrice, 0),
    greeks = { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
  for (const r of entry) {
    const days = (r.expiry - snapshot.fetchedAt) / day - daysElapsed,
      volatility = r.iv + ivShift;
    if (volatility <= 0 || volatility > 300)
      throw Error("Shifted IV must stay in (0, 300]%.");
    const g =
      days > 0
        ? calculateGreeks({
            spot: snapshot.spot,
            strike: r.strike,
            days,
            volatility,
            rate: 0,
            type: r.type,
            exerciseStyle: r.exerciseStyle ?? "european",
          })
        : Object.fromEntries(
            Object.keys(greeks).map((k) => [
              k,
              snapshot.spot === r.strike
                ? null
                : k === "delta"
                  ? r.type === "call"
                    ? snapshot.spot > r.strike
                      ? 1
                      : 0
                    : snapshot.spot < r.strike
                      ? -1
                      : 0
                  : 0,
            ]),
          );
    for (const k of Object.keys(greeks))
      greeks[k] =
        greeks[k] === null || g[k] === null
          ? null
          : greeks[k] + r.quantity * g[k];
  }
  const scenarios = Array.from({ length: 161 }, (_, i) => {
    const spot = spotMin + ((spotMax - spotMin) * i) / 160;
    let modelValue = 0,
      payoff = 0;
    for (const r of entry) {
      const days = (r.expiry - snapshot.fetchedAt) / day - daysElapsed,
        volatility = r.iv + ivShift;
      if (volatility <= 0 || volatility > 300)
        throw Error("Shifted IV must stay in (0, 300]%.");
      const value =
        days <= 0
          ? intrinsic(r.type, spot, r.strike)
          : calculateGreeks({
              spot,
              strike: r.strike,
              days,
              volatility,
              rate: 0,
              type: r.type,
              exerciseStyle: r.exerciseStyle ?? "european",
            }).price;
      modelValue += (r.quantity * value) / (inverse ? spot : 1);
      payoff +=
        (r.quantity * intrinsic(r.type, spot, r.strike)) / (inverse ? spot : 1);
    }
    return {
      spot,
      modelPnLSettlement: modelValue - entryPremium,
      expiryPnLSettlement: payoff - entryPremium,
      modelPnLUSD: (modelValue - entryPremium) * (inverse ? spot : 1),
      expiryPnLUSD: (payoff - entryPremium) * (inverse ? spot : 1),
    };
  });
  const vals = scenarios.map((s) => s.expiryPnLSettlement),
    cashDelta = inverse ? -entryPremium : 0;
  return {
    legs: entry,
    settlement: snapshot.settlement ?? snapshot.currency,
    entryPremium,
    entryPremiumUSD: entryPremium * (inverse ? snapshot.spot : 1),
    greeks,
    cashDelta,
    totalDelta: greeks.delta === null ? null : greeks.delta + cashDelta,
    scenarios,
    configuration: { ivShift, daysElapsed, spotMin, spotMax },
    greekBasis:
      "Selected IV/time scenario at snapshot spot; sensitivities at terminal payoff kinks are unavailable.",
    sampledWorst: Math.min(...vals),
    sampledBest: Math.max(...vals),
    riskScope:
      "Sampled spot range only; not global maximum loss, margin or liquidation risk.",
    assumptions:
      "European BSM or American tree per contract, zero rate/yield, fixed IV plus selected shift; no fees. Mixed-expiry payoff curves assume the same scenario spot at every expiry and are not a historical price path. Inverse cash delta is separate.",
  };
}
export function strategyCandidates(snapshot, expiry) {
  const rows = snapshot.rows.filter(
      (r) => r.expiry === expiry && quoteUsable(r, snapshot.fetchedAt),
    ),
    calls = rows
      .filter((r) => r.type === "call")
      .sort((a, b) => a.strike - b.strike),
    puts = rows
      .filter((r) => r.type === "put")
      .sort((a, b) => a.strike - b.strike),
    S = snapshot.spot;
  const nearest = (list, target) =>
      list.reduce(
        (a, b) =>
          !a || Math.abs(b.strike - target) < Math.abs(a.strike - target)
            ? b
            : a,
        null,
      ),
    atmC = nearest(calls, S),
    atmP = nearest(puts, S),
    up = nearest(
      calls.filter((r) => r.strike > S),
      S * 1.05,
    ),
    down = nearest(
      puts.filter((r) => r.strike < S),
      S * 0.95,
    ),
    higher = atmC ? calls.find((r) => r.strike > atmC.strike) : null,
    lowerPut = atmP
      ? [...puts].reverse().find((r) => r.strike < atmP.strike)
      : null;
  const candidates = [],
    add = (name, rows, quantities) => {
      if (
        rows.some((r) => !r) ||
        new Set(rows.map((r) => r.instrument)).size !== rows.length
      )
        return;
      const legs = rows.map((r, i) => ({
        instrument: r.instrument,
        quantity:
          quantities[i] * (r.quantityUnit === "contracts" ? r.contractSize : 1),
      }));
      const risk = portfolioRisk(snapshot, { legs });
      candidates.push({
        name,
        legs,
        entryPremium: risk.entryPremium,
        settlement: risk.settlement,
        delta: risk.greeks.delta,
        label: "Research template, not a recommendation or profit probability",
      });
    };
  if (atmC && atmP && atmC.strike === atmP.strike)
    add("Long straddle", [atmC, atmP], [1, 1]);
  add("Long strangle", [up, down], [1, 1]);
  add("Call debit vertical", [atmC, higher], [1, -1]);
  add("Put debit vertical", [atmP, lowerPut], [1, -1]);
  add("Risk reversal", [up, down], [1, -1]);
  if (atmC) {
    const lo = [...calls].reverse().find((r) => r.strike < atmC.strike),
      hi = lo
        ? calls.find(
            (r) => Math.abs(r.strike - (2 * atmC.strike - lo.strike)) < 1e-8,
          )
        : null;
    add("Call butterfly", [lo, atmC, hi], [1, -2, 1]);
  }
  return candidates;
}
export function backtestOptions(records, input = {}) {
  if (!Array.isArray(records) || records.length < 2 || records.length > 100)
    throw Error("Replay 2–100 snapshots.");
  const sorted = records
      .slice()
      .sort((a, b) => a.snapshot.fetchedAt - b.snapshot.fetchedAt),
    first = sorted[0].snapshot,
    positions = resolveLegs(first, input.legs),
    expiry = positions[0].expiry,
    inverse =
      positions[0].payoffType === "inverse" ||
      (!positions[0].payoffType && first.settlement === first.currency);
  if (
    sorted.some(
      (r, i) =>
        r.snapshot.exchange !== first.exchange ||
        r.snapshot.currency !== first.currency ||
        r.snapshot.settlement !== first.settlement ||
        (i && r.snapshot.fetchedAt === sorted[i - 1].snapshot.fetchedAt),
    )
  )
    throw Error(
      "Snapshots must have distinct observation times and the same exchange/base/settlement.",
    );
  const initialCapital = positive(
      input.initialCapital ?? (inverse ? 1 : 10000),
      "initial settlement capital",
    ),
    feeBps = input.feeBps ?? 10,
    slippageBps = input.slippageBps ?? 0,
    maxAgeMs = input.maxAgeMs ?? 60000,
    marginReserve = input.marginReserve ?? 0;
  if (
    ![feeBps, slippageBps, maxAgeMs, marginReserve].every(Number.isFinite) ||
    feeBps < 0 ||
    feeBps > 1000 ||
    slippageBps < 0 ||
    slippageBps > 2000 ||
    maxAgeMs < 1000 ||
    maxAgeMs > 3600000 ||
    marginReserve < 0 ||
    marginReserve > initialCapital
  )
    throw Error("Invalid backtest fee, slippage, freshness or margin reserve.");
  const funding = input.funding ?? [];
  if (
    !Array.isArray(funding) ||
    funding.length > 1000 ||
    funding.some(
      (f) =>
        !Number.isFinite(f.time) ||
        !Number.isFinite(f.amount) ||
        f.time < first.fetchedAt,
    )
  )
    throw Error(
      "Funding entries need timestamps at/after entry and signed settlement amounts.",
    );
  const afterExpiry = sorted.some((r) => r.snapshot.fetchedAt >= expiry),
    settlement = input.settlement;
  if (
    afterExpiry &&
    (!settlement ||
      !(settlement.price > 0) ||
      !Number.isFinite(settlement.price) ||
      typeof settlement.source !== "string" ||
      !settlement.source.trim())
  )
    throw Error(
      "Replay crosses expiry: supply an explicit official settlement price and source; snapshot spot is not a settlement price.",
    );
  let cash = 0,
    fees = 0,
    peak = 0,
    maxDrawdown = 0;
  const fills = [],
    curve = [],
    usedQuotes = [];
  const check = (snapshot) =>
    positions.map((p) => {
      const r = snapshot.rows.find((r) => r.instrument === p.instrument);
      if (
        !r ||
        !quoteUsable(
          { ...r, iv: 1, ivAt: null, oi: r.oi ?? 0 },
          snapshot.fetchedAt,
          { maxAgeMs, minOI: 0, maxSpread: 2 },
        )
      )
        throw Error(
          `Missing, stale or unusable quote for ${p.instrument} at ${new Date(snapshot.fetchedAt).toISOString()}.`,
        );
      if (
        r.expiry !== p.expiry ||
        r.strike !== p.strike ||
        r.type !== p.type ||
        r.payoffType !== p.payoffType ||
        r.contractSize !== p.contractSize
      )
        throw Error("Contract specification changed during replay.");
      return { ...r, quantity: p.quantity };
    });
  if (positions.some((p) => p.settlementType === "physical"))
    throw Error(
      "Use rule-driven research for physical delivery and explicit exercise/assignment events.",
    );
  const quoteRows = check(first);
  if (
    Math.max(...quoteRows.map((r) => r.quoteAt)) -
      Math.min(...quoteRows.map((r) => r.quoteAt)) >
    5000
  )
    throw Error(
      "Entry leg observation times differ by more than five seconds.",
    );
  const execution = input.execution ?? {};
  if (execution.sizePolicy === "partial")
    throw Error(
      "Use rule-driven studies for partial fills; fixed-leg replay supports ignore/reject size policy.",
    );
  const fill = (r, entry, at, spot) => {
    const model = fillQuote(r, (entry ? 1 : -1) * r.quantity, {
        feeBps,
        slippageBps,
        ...execution,
        spot,
      }),
      price = model.price,
      fee = model.fee,
      buy = model.side === "buy";
    cash += model.cashChange;
    fees += fee;
    fills.push({
      instrument: r.instrument,
      at,
      action: entry ? "entry" : "exit",
      side: buy ? "buy" : "sell",
      quantity: Math.abs(r.quantity),
      price,
      fee,
      quoteAt: r.quoteAt,
    });
  };
  for (const r of quoteRows) fill(r, true, first.fetchedAt, first.spot);
  if (initialCapital + cash < marginReserve)
    throw Error(
      "Entry leaves insufficient cash for the configured capital/margin reserve.",
    );
  const beforeExpiry = sorted.filter((r) => r.snapshot.fetchedAt < expiry);
  for (let i = 0; i < beforeExpiry.length; i++) {
    const record = beforeExpiry[i],
      s = record.snapshot,
      rows = check(s);
    usedQuotes.push({
      snapshotId: record.id,
      sha256: record.sha256,
      at: s.fetchedAt,
      spot: s.spot,
      origin: record.origin,
      rows,
    });
    let value = rows.reduce(
      (n, r) => n + r.quantity * (r.quantity > 0 ? r.bid : r.ask),
      0,
    );
    if (!afterExpiry && i === beforeExpiry.length - 1) {
      for (const r of rows) fill(r, false, s.fetchedAt, s.spot);
      value = 0;
    }
    const funded = funding
        .filter((f) => f.time <= s.fetchedAt)
        .reduce((sum, f) => sum + f.amount, 0),
      pnl = cash + value + funded,
      equity = initialCapital + pnl;
    peak = Math.max(peak, pnl);
    maxDrawdown = Math.max(maxDrawdown, peak - pnl);
    curve.push({
      time: s.fetchedAt,
      spot: s.spot,
      pnlSettlement: pnl,
      optionPnLSettlement: cash + value,
      funding: funded,
      equitySettlement: equity,
      equityUSD: equity * (inverse ? s.spot : 1),
      pnlUSD: pnl * (inverse ? s.spot : 1),
      marginBreach: equity < marginReserve,
    });
  }
  if (afterExpiry) {
    const S = settlement.price;
    for (const p of positions)
      cash += (p.quantity * intrinsic(p.type, S, p.strike)) / (inverse ? S : 1);
    const funded = funding
        .filter((f) => f.time <= expiry)
        .reduce((sum, f) => sum + f.amount, 0),
      pnl = cash + funded;
    maxDrawdown = Math.max(maxDrawdown, peak - pnl);
    curve.push({
      time: expiry,
      spot: S,
      pnlSettlement: pnl,
      optionPnLSettlement: cash,
      funding: funded,
      equitySettlement: initialCapital + pnl,
      equityUSD: (initialCapital + pnl) * (inverse ? S : 1),
      pnlUSD: pnl * (inverse ? S : 1),
      marginBreach: initialCapital + pnl < marginReserve,
      settlementSource: settlement.source,
      settlementVerified: false,
    });
  }
  return {
    kind: "Fixed-leg archived quote replay",
    basis: {
      exchange: first.exchange,
      currency: first.currency,
      settlement: first.settlement,
      payoffType: inverse ? "inverse" : "linear",
    },
    legs: positions.map((p) => ({
      instrument: p.instrument,
      quantity: p.quantity,
      expiry: p.expiry,
      strike: p.strike,
      type: p.type,
    })),
    config: {
      execution,
      initialCapital,
      feeBps,
      slippageBps,
      maxAgeMs,
      marginReserve,
      funding,
      settlement: afterExpiry ? settlement : null,
    },
    fills,
    curve,
    usedQuotes,
    metrics: {
      netPnLSettlement: curve.at(-1).pnlSettlement,
      netPnLUSD: curve.at(-1).pnlUSD,
      maxDrawdownSettlement: maxDrawdown,
      feesSettlement: fees,
      marginBreaches: curve.filter((p) => p.marginBreach).length,
      snapshotsUsed: beforeExpiry.length,
    },
    warnings: [
      "Independent leg fills at archived bid/ask; no executable-size or simultaneous-fill guarantee.",
      "Fees use the supplied premium or underlying-capped model; exchange delivery fees are not automatically fetched.",
      "Margin is a user-specified constant reserve; breaches are flagged without simulating liquidation.",
      ...(funding.length
        ? [
            "Funding cash flows are supplied by the user, not fetched or verified.",
          ]
        : ["No hedge funding or collateral interest modeled."]),
      ...(inverse
        ? [
            "Inverse settlement cash and collateral remain in the underlying coin; USD equity includes collateral price exposure.",
          ]
        : ["USDC/USDT treated at 1 USD parity."]),
      ...(afterExpiry
        ? ["Settlement price/source supplied by the user and not verified."]
        : []),
    ],
  };
}
