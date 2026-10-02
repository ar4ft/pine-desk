import { calculateGreeks } from "./greeks.js";
import { fillQuote } from "./execution-model.js";
const day = 86400000;
const templates = [
  "long-call",
  "long-put",
  "long-straddle",
  "long-strangle",
  "call-debit",
  "put-debit",
  "iron-condor",
  "call-calendar",
];
export function validateOptionRules(input = {}) {
  const r = {
    template: "long-call",
    targetDTE: 30,
    minDTE: 7,
    maxDTE: 60,
    targetDelta: 0.5,
    wingPercent: 0.05,
    quantity: 1,
    entryEvery: 1,
    maxHoldDays: 7,
    exitDTE: 2,
    profitTarget: 0.5,
    stopLoss: 1,
    latencyMs: 0,
    sizePolicy: "ignore",
    liquidityFraction: 1,
    feeBps: 10,
    slippageBps: 0,
    marginModel: "static",
    marginReserve: 0,
    stressDown: 0.5,
    stressUp: 1.5,
    hedgeDelta: false,
    hedgeFeeBps: 5,
    maxAgeMs: 60000,
    ...input,
  };
  if (
    !templates.includes(r.template) ||
    ![
      r.targetDTE,
      r.minDTE,
      r.maxDTE,
      r.targetDelta,
      r.wingPercent,
      r.quantity,
      r.maxHoldDays,
      r.exitDTE,
      r.profitTarget,
      r.stopLoss,
      r.latencyMs,
      r.marginReserve,
      r.maxAgeMs,
      r.stressDown,
      r.stressUp,
      r.hedgeFeeBps,
    ].every(Number.isFinite) ||
    r.minDTE <= 0 ||
    r.maxDTE > 3650 ||
    r.maxDTE < r.minDTE ||
    r.targetDTE < r.minDTE ||
    r.targetDTE > r.maxDTE ||
    r.targetDelta <= 0 ||
    r.targetDelta >= 1 ||
    r.wingPercent <= 0 ||
    r.wingPercent > 0.5 ||
    r.quantity <= 0 ||
    r.quantity > 100000 ||
    !Number.isInteger(r.entryEvery) ||
    r.entryEvery < 1 ||
    r.entryEvery > 1000 ||
    r.maxHoldDays <= 0 ||
    r.maxHoldDays > 3650 ||
    r.exitDTE < 0 ||
    r.exitDTE >= r.minDTE ||
    r.profitTarget <= 0 ||
    r.profitTarget > 10 ||
    r.stopLoss <= 0 ||
    r.stopLoss > 10 ||
    r.latencyMs < 0 ||
    r.latencyMs > 86400000 ||
    r.marginReserve < 0 ||
    r.maxAgeMs < 1000 ||
    r.maxAgeMs > 3600000 ||
    !["static", "stress"].includes(r.marginModel) ||
    r.stressDown <= 0 ||
    r.stressDown >= 1 ||
    r.stressUp <= 1 ||
    r.stressUp > 10 ||
    typeof r.hedgeDelta !== "boolean" ||
    r.hedgeFeeBps < 0 ||
    r.hedgeFeeBps > 1000
  )
    throw Error("Invalid option strategy rules.");
  fillQuote(
    { bid: 1, ask: 1, bidSize: 1e9, askSize: 1e9, payoffType: "inverse" },
    1,
    r,
  );
  return r;
}
function eligible(row, s, r) {
  return (
    row.expiry > s.fetchedAt &&
    row.quoteAt <= s.fetchedAt + 5000 &&
    s.fetchedAt - row.quoteAt <= r.maxAgeMs &&
    row.bid > 0 &&
    row.ask >= row.bid &&
    row.iv > 0 &&
    row.iv <= 300
  );
}
function delta(row, s) {
  return calculateGreeks({
    spot: s.spot,
    strike: row.strike,
    days: (row.expiry - s.fetchedAt) / day,
    volatility: row.iv,
    type: row.type,
    exerciseStyle: row.exerciseStyle ?? "european",
    rate: row.modelRate ?? 0,
    steps: 100,
  }).delta;
}
export function selectOptionLegs(snapshot, input = {}) {
  const r = validateOptionRules(input),
    s = snapshot,
    rows = s.rows.filter((q) => eligible(q, s, r)),
    expiries = [...new Set(rows.map((q) => q.expiry))]
      .filter(
        (t) =>
          (t - s.fetchedAt) / day >= r.minDTE &&
          (t - s.fetchedAt) / day <= r.maxDTE,
      )
      .sort(
        (a, b) =>
          Math.abs((a - s.fetchedAt) / day - r.targetDTE) -
            Math.abs((b - s.fetchedAt) / day - r.targetDTE) || a - b,
      );
  if (!expiries.length) return [];
  const expiry = expiries[0],
    chain = rows.filter((q) => q.expiry === expiry),
    calls = chain.filter((q) => q.type === "call"),
    puts = chain.filter((q) => q.type === "put");
  const cachedDelta = new Map();
  const getDelta = (q) => {
    if (!cachedDelta.has(q.instrument))
      cachedDelta.set(q.instrument, delta(q, s));
    return cachedDelta.get(q.instrument);
  };
  const nearestDelta = (list, target) =>
    list.reduce(
      (a, b) =>
        !a ||
        Math.abs(Math.abs(getDelta(b)) - target) <
          Math.abs(Math.abs(getDelta(a)) - target)
          ? b
          : a,
      null,
    );
  const call = nearestDelta(calls, r.targetDelta),
    put = nearestDelta(puts, r.targetDelta);
  const wing = (list, base, direction) =>
    base
      ? list
          .filter((q) => direction * (q.strike - base.strike) > 0)
          .sort(
            (a, b) =>
              Math.abs(
                a.strike - base.strike * (1 + direction * r.wingPercent),
              ) -
              Math.abs(
                b.strike - base.strike * (1 + direction * r.wingPercent),
              ),
          )[0]
      : null;
  let selected;
  switch (r.template) {
    case "long-call":
      selected = [[call, 1]];
      break;
    case "long-put":
      selected = [[put, 1]];
      break;
    case "long-straddle": {
      const c = calls
        .slice()
        .sort(
          (a, b) => Math.abs(a.strike - s.spot) - Math.abs(b.strike - s.spot),
        )[0];
      selected = [
        [c, 1],
        [puts.find((p) => p.strike === c?.strike), 1],
      ];
      break;
    }
    case "long-strangle":
      selected = [
        [call, 1],
        [put, 1],
      ];
      break;
    case "call-debit":
      selected = [
        [call, 1],
        [wing(calls, call, 1), -1],
      ];
      break;
    case "put-debit":
      selected = [
        [put, 1],
        [wing(puts, put, -1), -1],
      ];
      break;
    case "call-calendar": {
      const c = calls
          .slice()
          .sort(
            (a, b) => Math.abs(a.strike - s.spot) - Math.abs(b.strike - s.spot),
          )[0],
        later = rows
          .filter(
            (q) =>
              q.type === "call" && q.strike === c?.strike && q.expiry > expiry,
          )
          .sort((a, b) => a.expiry - b.expiry)[0];
      selected = [
        [c, -1],
        [later, 1],
      ];
      break;
    }
    case "iron-condor":
      selected = [
        [put, -1],
        [wing(puts, put, -1), 1],
        [call, -1],
        [wing(calls, call, 1), 1],
      ];
      if (put?.strike >= call?.strike) return [];
      break;
  }
  if (
    selected.some(([q]) => !q) ||
    new Set(selected.map(([q]) => q.instrument)).size !== selected.length
  )
    return [];
  if (
    Math.max(...selected.map(([q]) => q.quoteAt)) -
      Math.min(...selected.map(([q]) => q.quoteAt)) >
    5000
  )
    return [];
  return selected.map(([q, sign]) => ({ ...q, quantity: sign * r.quantity }));
}
// Observations are processed chronologically. Selection only sees the signal snapshot;
// positive latency executes at a later observation, without reselection using future prices.
export function runOptionStrategy(records, input = {}) {
  const r = validateOptionRules(input.rules),
    sorted = records
      .slice()
      .sort((a, b) => a.snapshot.fetchedAt - b.snapshot.fetchedAt);
  if (
    sorted.length < 3 ||
    sorted.length > 2000 ||
    new Set(sorted.map((x) => x.snapshot.fetchedAt)).size !== sorted.length
  )
    throw Error("Rule research needs 3–2000 distinct observations.");
  const first = sorted[0].snapshot,
    inverse = first.settlement === first.currency,
    initialCapital = input.initialCapital ?? (inverse ? 1 : 10000);
  if (!(initialCapital > 0) || !Number.isFinite(initialCapital))
    throw Error("Invalid strategy capital.");
  if (
    sorted.some(
      (x) =>
        x.snapshot.exchange !== first.exchange ||
        x.snapshot.currency !== first.currency ||
        x.snapshot.settlement !== first.settlement,
    )
  )
    throw Error("Use one exchange, base and settlement.");
  const funding = input.funding ?? [],
    settlements = input.settlements ?? {},
    exerciseEvents = input.exerciseEvents ?? [];
  if (
    !Array.isArray(exerciseEvents) ||
    exerciseEvents.length > 2000 ||
    exerciseEvents.some(
      (e) =>
        !Number.isFinite(e.time) ||
        typeof e.instrument !== "string" ||
        !Number.isFinite(e.quantity) ||
        e.quantity === 0 ||
        !["exercise", "assignment"].includes(e.kind) ||
        typeof e.source !== "string" ||
        !e.source.trim(),
    )
  )
    throw Error(
      "Exercise events need time, instrument, signed underlying quantity, kind and source.",
    );
  if (
    exerciseEvents.some(
      (e) => !sorted.some((r) => r.snapshot.fetchedAt === e.time),
    )
  )
    throw Error(
      "Exercise event times must match an archived observation; no interpolation.",
    );
  if (
    !Array.isArray(funding) ||
    funding.length > 2000 ||
    funding.some(
      (f) =>
        !Number.isFinite(f.time) ||
        !Number.isFinite(f.amount) ||
        f.time < first.fetchedAt,
    )
  )
    throw Error("Invalid supplied funding ledger.");
  let cash = initialCapital,
    active = null,
    pending = null,
    hedge = 0,
    hedgeIndex = null,
    realizedHedge = 0,
    fees = 0,
    peak = initialCapital,
    maxDrawdown = 0,
    lastFunding = -Infinity,
    stock = 0,
    dividendTotal = 0;
  const dividends = input.dividends ?? [];
  if (
    !Array.isArray(dividends) ||
    dividends.some(
      (d) =>
        !Number.isFinite(d.time) || !Number.isFinite(d.amount) || d.amount < 0,
    )
  )
    throw Error("Dividend ledger needs time and nonnegative amount per share.");
  const curve = [],
    fills = [],
    trades = [],
    decisions = [],
    evidence = [];
  let observationRows = [];
  const deliver = (q, quantity, at, source) => {
    const shares = (q.type === "call" ? 1 : -1) * quantity;
    cash -= shares * q.strike;
    stock += shares;
    fills.push({
      action: "physical-delivery",
      at,
      instrument: q.instrument,
      quantity,
      shares,
      strike: q.strike,
      source,
      verified: false,
    });
  };
  const rowsFor = (s, positions) =>
    positions.map((p) => {
      const q = s.rows.find((q) => q.instrument === p.instrument);
      if (!q || !eligible(q, s, r))
        throw Error(
          `Missing or stale quote for held contract ${p.instrument}.`,
        );
      if (
        q.expiry !== p.expiry ||
        q.strike !== p.strike ||
        q.type !== p.type ||
        q.contractSize !== p.contractSize ||
        q.payoffType !== p.payoffType
      )
        throw Error("Held contract specification changed.");
      return { ...q, quantity: p.quantity };
    });
  const execute = (s, positions, entry) =>
    positions
      .map((q) => {
        observationRows.push(q);
        const f = fillQuote(q, (entry ? 1 : -1) * q.quantity, {
          ...r,
          spot: s.spot,
        });
        cash += f.cashChange;
        fees += f.fee;
        fills.push({
          ...f,
          instrument: q.instrument,
          at: s.fetchedAt,
          action: entry ? "entry" : "exit",
        });
        return { ...q, quantity: entry ? f.quantity : q.quantity + f.quantity };
      })
      .filter((q) => Math.abs(q.quantity) > 1e-12);
  const margin = (s, positions) =>
    r.marginModel === "static"
      ? r.marginReserve
      : Math.max(
          r.marginReserve,
          ...[r.stressDown, r.stressUp].map((mult) => {
            const spot = s.spot * mult;
            const value = positions.reduce(
              (n, q) =>
                n +
                (q.quantity *
                  Math.max(
                    0,
                    q.type === "call" ? spot - q.strike : q.strike - spot,
                  )) /
                  (inverse ? spot : 1),
              0,
            );
            return Math.max(0, -value);
          }),
        );
  const hedgeTo = (s, target) => {
    if (hedgeIndex !== null) {
      const pnl = (hedge * (s.spot - hedgeIndex)) / (inverse ? s.spot : 1);
      cash += pnl;
      realizedHedge += pnl;
    }
    const fee =
      (Math.abs(target - hedge) * (inverse ? 1 : s.spot) * r.hedgeFeeBps) /
      10000;
    cash -= fee;
    fees += fee;
    hedge = target;
    hedgeIndex = s.spot;
    fills.push({
      action: "synthetic-hedge",
      at: s.fetchedAt,
      index: s.spot,
      quantity: target,
      fee,
    });
  };
  for (let i = 0; i < sorted.length; i++) {
    const record = sorted[i],
      s = record.snapshot;
    let value = 0;
    observationRows = [];
    const dividend = dividends
      .filter((d) => d.time > lastFunding && d.time <= s.fetchedAt)
      .reduce((n, d) => n + stock * d.amount, 0);
    cash += dividend;
    dividendTotal += dividend;
    cash += funding
      .filter((f) => f.time > lastFunding && f.time <= s.fetchedAt)
      .reduce((n, f) => n + f.amount, 0);
    lastFunding = s.fetchedAt;
    if (r.hedgeDelta && hedgeIndex !== null) hedgeTo(s, hedge);
    for (const event of exerciseEvents.filter((e) => e.time === s.fetchedAt)) {
      const held = active?.legs.find((q) => q.instrument === event.instrument);
      if (
        !held ||
        held.exerciseStyle !== "american" ||
        held.settlementType !== "physical" ||
        held.quantity * event.quantity <= 0 ||
        Math.abs(event.quantity) > Math.abs(held.quantity) ||
        (event.kind === "assignment" && event.quantity > 0) ||
        (event.kind === "exercise" && event.quantity < 0)
      )
        throw Error(
          "Exercise/assignment event is inconsistent with the held American physical position.",
        );
      deliver(held, event.quantity, event.time, event.source);
      held.quantity -= event.quantity;
      active.legs = active.legs.filter((q) => Math.abs(q.quantity) > 1e-12);
      if (!active.legs.length) {
        if (r.hedgeDelta) hedgeTo(s, 0);
        trades.push({
          entryAt: active.entryAt,
          exitAt: event.time,
          reason: event.kind,
          pnl: cash + stock * s.spot - active.cashBefore,
        });
        active = null;
        pending = null;
      } else active.expiry = Math.min(...active.legs.map((q) => q.expiry));
    }
    if (active && s.fetchedAt >= active.expiry) {
      for (const q of active.legs.filter((q) => q.expiry <= s.fetchedAt)) {
        const fixing = settlements[String(q.expiry)];
        if (
          !(fixing?.price > 0) ||
          !Number.isFinite(fixing.price) ||
          typeof fixing.source !== "string" ||
          !fixing.source.trim()
        )
          throw Error(
            `Expiry ${q.expiry} requires an explicit settlement price and source.`,
          );
        const payoff =
          (q.quantity *
            Math.max(
              0,
              q.type === "call"
                ? fixing.price - q.strike
                : q.strike - fixing.price,
            )) /
          (inverse ? fixing.price : 1);
        if (q.settlementType === "physical") {
          if (payoff !== 0) deliver(q, q.quantity, q.expiry, fixing.source);
        } else cash += payoff;
        fills.push({
          action: "settlement",
          at: q.expiry,
          instrument: q.instrument,
          payoff,
          source: fixing.source,
          verified: false,
        });
      }
      active.legs = active.legs.filter((q) => q.expiry > s.fetchedAt);
      pending = null;
      if (!active.legs.length) {
        if (r.hedgeDelta) hedgeTo(s, 0);
        trades.push({
          entryAt: active.entryAt,
          exitAt: active.expiry,
          reason: "settlement",
          pnl: cash + stock * s.spot - active.cashBefore,
        });
        active = null;
      } else active.expiry = Math.min(...active.legs.map((q) => q.expiry));
    }
    if (pending && s.fetchedAt >= pending.executeAfter) {
      if (pending.kind === "entry" && !active) {
        const positions = rowsFor(s, pending.legs),
          cashBefore = cash + stock * s.spot;
        const trial = positions.map((q) =>
            fillQuote(q, q.quantity, { ...r, spot: s.spot }),
          ),
          needed = margin(s, positions),
          after = cash + trial.reduce((n, f) => n + f.cashChange, 0);
        if (after < needed) {
          decisions.push({
            at: s.fetchedAt,
            reason: "entry skipped: insufficient capital or configured margin",
          });
        } else {
          const legs = execute(s, positions, true);
          if (legs.length)
            active = {
              legs,
              entryAt: s.fetchedAt,
              expiry: Math.min(...legs.map((q) => q.expiry)),
              cashBefore,
              riskBudget: Math.max(
                Math.abs(trial.reduce((n, f) => n + f.quantity * f.price, 0)),
                needed,
                1e-12,
              ),
            };
        }
      } else if (pending.kind === "exit" && active) {
        const remaining = execute(s, rowsFor(s, active.legs), false);
        if (remaining.length) {
          active.legs = remaining;
          pending.executeAfter = s.fetchedAt + 1;
          decisions.push({
            at: s.fetchedAt,
            reason: "partial exit: remaining position retained",
          });
        } else {
          if (r.hedgeDelta) hedgeTo(s, 0);
          trades.push({
            entryAt: active.entryAt,
            exitAt: s.fetchedAt,
            reason: pending.reason,
            legs: active.legs,
            pnl: cash + stock * s.spot - active.cashBefore,
          });
          active = null;
        }
      }
      if (!active || pending.kind === "entry" || !active.legs.length)
        pending = null;
    }
    if (active) {
      const positions = rowsFor(s, active.legs);
      value = positions.reduce(
        (n, q) => n + q.quantity * (q.quantity > 0 ? q.bid : q.ask),
        0,
      );
      const pnl = cash + value + stock * s.spot - active.cashBefore,
        dte = (active.expiry - s.fetchedAt) / day;
      if (r.hedgeDelta) {
        const optionDelta = positions.reduce(
          (n, q) => n + q.quantity * delta(q, s),
          0,
        );
        hedgeTo(s, -optionDelta);
      }
      const breach = cash + value + stock * s.spot < margin(s, positions),
        reason = breach
          ? "model margin breach"
          : i === sorted.length - 1
            ? "end of observations"
            : dte <= r.exitDTE
              ? "DTE exit"
              : (s.fetchedAt - active.entryAt) / day >= r.maxHoldDays
                ? "maximum hold"
                : pnl >= r.profitTarget * active.riskBudget
                  ? "profit target"
                  : pnl <= -r.stopLoss * active.riskBudget
                    ? "stop loss"
                    : null;
      if (reason && !pending)
        pending = {
          kind: "exit",
          reason,
          executeAfter: s.fetchedAt + r.latencyMs,
        };
      if (
        pending?.kind === "exit" &&
        r.latencyMs === 0 &&
        pending.executeAfter <= s.fetchedAt
      ) {
        const remaining = execute(s, positions, false);
        if (!remaining.length) {
          if (r.hedgeDelta) hedgeTo(s, 0);
          trades.push({
            entryAt: active.entryAt,
            exitAt: s.fetchedAt,
            reason,
            legs: active.legs,
            pnl: cash + stock * s.spot - active.cashBefore,
          });
          active = null;
          pending = null;
          value = 0;
        } else {
          active.legs = remaining;
          value = remaining.reduce(
            (n, q) => n + q.quantity * (q.quantity > 0 ? q.bid : q.ask),
            0,
          );
          pending.executeAfter = s.fetchedAt + 1;
        }
      }
    }
    if (
      !active &&
      !pending &&
      i < sorted.length - 1 &&
      i % r.entryEvery === 0
    ) {
      const legs = selectOptionLegs(s, r);
      if (legs.length) {
        pending = {
          kind: "entry",
          legs,
          signalAt: s.fetchedAt,
          executeAfter: s.fetchedAt + Math.max(1, r.latencyMs),
        };
        decisions.push({
          at: s.fetchedAt,
          reason: "entry signaled",
          contracts: legs.map((q) => q.instrument),
        });
      } else
        decisions.push({
          at: s.fetchedAt,
          reason: "no qualified contracts for rules",
        });
    }
    if (i === sorted.length - 1 && stock !== 0) {
      const quantity = -stock,
        price =
          s.spot * (1 + ((quantity > 0 ? 1 : -1) * r.slippageBps) / 10000),
        fee = (Math.abs(quantity * price) * r.hedgeFeeBps) / 10000;
      cash -= quantity * price + fee;
      fees += fee;
      fills.push({
        action: "underlying-exit",
        at: s.fetchedAt,
        quantity,
        price,
        fee,
        cashChange: -quantity * price - fee,
        basis: "Snapshot index proxy, not executed bid/ask",
      });
      stock = 0;
    }
    const equity = cash + value + stock * s.spot;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    curve.push({
      time: s.fetchedAt,
      spot: s.spot,
      equitySettlement: equity,
      pnlSettlement: equity - initialCapital,
      pnlUSD: (equity - initialCapital) * (inverse ? s.spot : 1),
      equityUSD: equity * (inverse ? s.spot : 1),
      hedge,
      underlyingShares: stock,
    });
    evidence.push({
      id: record.id,
      sha256: record.sha256,
      origin: record.origin,
      at: s.fetchedAt,
      spot: s.spot,
      rows: [
        ...new Map(
          [
            ...observationRows,
            ...s.rows.filter(
              (q) =>
                active?.legs.some((l) => l.instrument === q.instrument) ||
                pending?.legs?.some((l) => l.instrument === q.instrument),
            ),
          ].map((q) => [q.instrument, q]),
        ).values(),
      ],
    });
  }
  return {
    kind: "Rule-driven archived options paper research",
    basis: {
      exchange: first.exchange,
      currency: first.currency,
      settlement: first.settlement,
    },
    rules: r,
    config: { initialCapital, funding, settlements, exerciseEvents, dividends },
    fills,
    trades,
    decisions,
    curve,
    usedQuotes: evidence,
    openPositions: active?.legs ?? [],
    pending,
    metrics: {
      netPnLSettlement: curve.at(-1).pnlSettlement,
      netPnLUSD: curve.at(-1).pnlUSD,
      maxDrawdownSettlement: maxDrawdown,
      feesSettlement: fees,
      closedTrades: trades.length,
      realizedHedgeSettlement: realizedHedge,
      dividendsSettlement: dividendTotal,
    },
    warnings: [
      "Selection uses the signal snapshot; entry executes no earlier than the next observation.",
      "Archived sizes are not executable guarantees. Partial independent fills can leave unbalanced legs. No displayed-size replenishment is simulated.",
      "Static/stress margin is a research assumption, not venue portfolio margin. Model breaches trigger exit rules; actual liquidation is not reproduced.",
      "Supplied funding and settlement fixings are unverified. Fees follow the explicitly configured model.",
      "Synthetic delta hedges use snapshot index changes; inverse P&L settles in coin. Funding, basis, order books and exchange liquidation are not automatically reconstructed.",
      "American early exercise/assignment is processed only from supplied, unverified events. Physical delivery creates underlying shares; terminal shares exit at an index proxy. Cash dividends must be supplied. No assignment probability is inferred.",
      "Terminal latency or insufficient size can leave positions open. Coin collateral changes USD equity.",
    ],
  };
}
