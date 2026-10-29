import { randomUUID } from "node:crypto";
const finite = (n, label, min = 0) => {
  if (!Number.isFinite(n) || n < min)
    throw Error(`${label} must be a finite number ≥ ${min}.`);
  return n;
};
const text = (v, label, max) => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    throw Error(`${label} is required (up to ${max} characters).`);
  return v.trim();
};
export function planInput(input = {}) {
  const name = text(input.name, "Plan name", 100),
    symbol = text(input.symbol, "Symbol", 40),
    venue = text(input.venue, "Venue/source label", 60),
    currency = text(input.currency, "Quote currency", 12).toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(currency))
    throw Error(
      "Use a quote-currency code; all cash amounts must use that currency.",
    );
  const {
    side = "long",
    assetType = "spot",
    status = "draft",
    equity,
    riskPercent,
    entry,
    stop,
    quantityStep,
    multiplier = 1,
    feePercent = 0,
    slippage = 0,
    maxNotional,
  } = input;
  if (
    !["long", "short"].includes(side) ||
    !["spot", "linear"].includes(assetType) ||
    !["draft", "archived"].includes(status)
  )
    throw Error("Choose long/short, spot/linear and draft/archived status.");
  for (const [k, v] of Object.entries({
    equity,
    entry,
    stop,
    quantityStep,
    multiplier,
    maxNotional,
  }))
    if (finite(v, k) <= 0) throw Error(`${k} must be positive.`);
  finite(riskPercent, "Risk percent", 0.01);
  if (riskPercent > 100) throw Error("Risk percent must be ≤ 100.");
  finite(feePercent, "Fee percent");
  if (feePercent > 100) throw Error("Fee percent must be ≤ 100.");
  finite(slippage, "Slippage");
  if (assetType === "spot" && multiplier !== 1)
    throw Error(
      "Spot plans use multiplier 1; choose linear for an explicit contract multiplier.",
    );
  if (quantityStep < 1e-8 || quantityStep > 1e6)
    throw Error("Quantity increment must be between 0.00000001 and 1,000,000.");
  const direction = side === "long" ? 1 : -1;
  if (direction * (entry - stop) <= 0)
    throw Error(
      "Long stops must be below entry; short stops must be above entry.",
    );
  if (
    !Array.isArray(input.targets) ||
    !input.targets.length ||
    input.targets.length > 3
  )
    throw Error("Provide 1–3 targets.");
  let last = entry;
  const targets = input.targets.map((t) => {
    const price = finite(t.price, "Target price");
    if (price <= 0 || direction * (price - last) <= 0)
      throw Error(
        "Targets must be positive and ordered progressively beyond entry in the profit direction.",
      );
    last = price;
    if (!Number.isInteger(t.percent) || t.percent < 1 || t.percent > 100)
      throw Error(
        "Target allocations must be whole percentages from 1 to 100.",
      );
    return { price, percent: t.percent };
  });
  if (targets.reduce((a, t) => a + t.percent, 0) !== 100)
    throw Error("Target allocations must sum to 100%.");
  const notes = input.notes ?? "";
  if (typeof notes !== "string" || notes.length > 4000)
    throw Error("Notes must be text up to 4,000 characters.");
  let reference = null;
  if (input.reference != null) {
    const r = input.reference;
    if (
      !Number.isSafeInteger(r.time) ||
      r.time <= 0 ||
      r.time > 8.64e15 ||
      !Number.isFinite(r.price) ||
      r.price <= 0
    )
      throw Error(
        "Chart reference requires a valid bar timestamp and positive price.",
      );
    reference = {
      symbol: text(r.symbol, "Reference symbol", 40),
      origin: text(r.origin, "Reference origin", 200),
      time: r.time,
      price: r.price,
    };
  }
  return {
    name,
    symbol,
    venue,
    currency,
    side,
    assetType,
    status,
    equity,
    riskPercent,
    entry,
    stop,
    quantityStep,
    multiplier,
    feePercent,
    slippage,
    maxNotional,
    targets,
    notes,
    reference,
  };
}
export function estimatePlan(raw) {
  const input = planInput(raw),
    p = input,
    d = p.side === "long" ? 1 : -1,
    fee = p.feePercent / 100;
  const entryFill = p.entry + d * p.slippage,
    stopFill = p.stop - d * p.slippage;
  if (entryFill <= 0 || stopFill <= 0)
    throw Error("Slippage would produce a nonpositive entry or stop fill.");
  const perUnitRisk =
    (d * (entryFill - stopFill) + fee * (entryFill + stopFill)) * p.multiplier;
  const riskBudget = p.equity * (p.riskPercent / 100),
    perUnitNotional = entryFill * p.multiplier;
  for (const n of [
    entryFill,
    stopFill,
    perUnitRisk,
    riskBudget,
    perUnitNotional,
  ])
    if (!Number.isFinite(n) || n <= 0)
      throw Error(
        "Sizing exceeds numeric capacity or has zero risk; revise the assumptions.",
      );
  const limit = Math.min(
      riskBudget / perUnitRisk,
      p.maxNotional / perUnitNotional,
    ),
    steps = limit / p.quantityStep;
  if (!Number.isFinite(steps) || steps > 1e12)
    throw Error(
      "Sizing exceeds 10¹² quantity increments; increase the increment or reduce the budget.",
    );
  let units = Math.floor(steps),
    quantity = Number((units * p.quantityStep).toPrecision(15));
  // Decimal serialization can round upward. Enforce both caps after rounding.
  while (
    units > 0 &&
    (quantity * perUnitRisk > riskBudget ||
      quantity * perUnitNotional > p.maxNotional)
  )
    quantity = Number((--units * p.quantityStep).toPrecision(15));
  const risk = quantity * perUnitRisk,
    entryNotional = quantity * perUnitNotional;
  let allocated = 0;
  const targets = p.targets.map((t, i) => {
    const targetUnits =
      i === p.targets.length - 1
        ? units - allocated
        : Math.floor((units * t.percent) / 100);
    allocated += targetUnits;
    const q = Number((targetUnits * p.quantityStep).toPrecision(15)),
      fill = t.price - d * p.slippage;
    if (fill <= 0)
      throw Error("Slippage would produce a nonpositive target fill.");
    const perUnitReward =
      (d * (fill - entryFill) - fee * (fill + entryFill)) * p.multiplier;
    const netReward = q * perUnitReward;
    if (![fill, perUnitReward, netReward].every(Number.isFinite))
      throw Error("Target calculation exceeds numeric capacity.");
    return {
      ...t,
      quantity: q,
      fill,
      netReward,
      rewardRisk: perUnitReward / perUnitRisk,
    };
  });
  const projectedReward = targets.reduce((a, t) => a + t.netReward, 0);
  if (
    ![
      risk,
      entryNotional,
      projectedReward,
      ...targets.map((t) => t.rewardRisk),
    ].every(Number.isFinite)
  )
    throw Error("Plan exceeds numeric capacity.");
  const warnings = [];
  if (quantity === 0)
    warnings.push("Budget or notional cap cannot fund one quantity increment.");
  if (targets.some((t) => t.quantity === 0))
    warnings.push(
      "At least one target receives no quantity after rounding; remaining increments go to the last target.",
    );
  if (targets.some((t) => t.netReward < 0))
    warnings.push(
      "At least one allocated target has negative net P&L after fees/slippage.",
    );
  if (p.side === "short")
    warnings.push("Borrow, margin and short availability are not checked.");
  if (p.reference && p.reference.symbol !== p.symbol)
    warnings.push("Chart reference symbol differs from the planned symbol.");
  return {
    modelVersion: 1,
    input,
    quantity,
    entryFill,
    stopFill,
    perUnitRisk,
    riskBudget,
    risk,
    entryNotional,
    projectedReward,
    rewardRisk: risk > 0 ? projectedReward / risk : null,
    targets,
    warnings,
    assumptions:
      "Linear quote-currency P&L; fee percent on entry and each exit notional; adverse slippage per fill in price units. Stop risk is a scenario, not a guaranteed loss cap. No fills, positions, leverage checks, funding, FX conversion or options/inverse payoff model.",
  };
}
export class TradePlans {
  constructor({ storage, now = Date.now }) {
    this.storage = storage;
    this.now = now;
    this.queue = Promise.resolve();
  }
  serial(fn) {
    const job = this.queue.then(fn);
    this.queue = job.catch(() => {});
    return job;
  }
  async read() {
    const doc = await this.storage.read();
    if (doc === null) return { version: 1, plans: [] };
    if (
      doc?.version !== 1 ||
      !Array.isArray(doc.plans) ||
      doc.plans.length > 200
    )
      throw Error("Saved plan archive is invalid or unsupported.");
    const ids = new Set();
    for (const p of doc.plans) {
      if (
        typeof p.id !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
          p.id,
        ) ||
        ids.has(p.id) ||
        !Number.isSafeInteger(p.revision) ||
        p.revision < 1 ||
        !Number.isSafeInteger(p.createdAt) ||
        !Number.isSafeInteger(p.updatedAt) ||
        p.createdAt <= 0 ||
        p.updatedAt > 8.64e15 ||
        p.updatedAt < p.createdAt
      )
        throw Error("Saved plan metadata is invalid.");
      ids.add(p.id);
      if (
        JSON.stringify(estimatePlan(p.estimate?.input)) !==
        JSON.stringify(p.estimate)
      )
        throw Error("Saved plan calculation does not match its assumptions.");
    }
    return doc;
  }
  list() {
    return this.serial(async () =>
      structuredClone((await this.read()).plans).sort(
        (a, b) => b.updatedAt - a.updatedAt,
      ),
    );
  }
  get(id) {
    return this.serial(async () => {
      const p = (await this.read()).plans.find((p) => p.id === id);
      if (!p) throw Error("Plan not found.");
      return structuredClone(p);
    });
  }
  save({ id, expectedRevision, input }) {
    return this.serial(async () => {
      const estimate = estimatePlan(input),
        doc = await this.read(),
        old = id ? doc.plans.find((p) => p.id === id) : null;
      if (id && !old) throw Error("Plan not found; refresh the saved list.");
      if (old && expectedRevision !== old.revision)
        throw Error(
          "Plan changed elsewhere; reopen the latest revision before saving.",
        );
      if (!old && expectedRevision !== undefined)
        throw Error("New plans must omit expectedRevision.");
      if (!old && doc.plans.length >= 200)
        throw Error(
          "Plan archive is full (200); delete a plan before creating another.",
        );
      const now = this.now(),
        record = {
          id: old?.id ?? randomUUID(),
          revision: (old?.revision ?? 0) + 1,
          createdAt: old?.createdAt ?? now,
          updatedAt: Math.max(now, old?.updatedAt ?? now),
          estimate,
        };
      const next = {
        version: 1,
        plans: old
          ? doc.plans.map((p) => (p.id === id ? record : p))
          : [...doc.plans, record],
      };
      await this.storage.write(next);
      return structuredClone(record);
    });
  }
  remove({ id, expectedRevision }) {
    return this.serial(async () => {
      const doc = await this.read(),
        old = doc.plans.find((p) => p.id === id);
      if (!old) throw Error("Plan not found.");
      if (old.revision !== expectedRevision)
        throw Error(
          "Plan changed elsewhere; reopen the latest revision before deleting.",
        );
      await this.storage.write({
        version: 1,
        plans: doc.plans.filter((p) => p.id !== id),
      });
      return { deleted: id };
    });
  }
  close() {
    return this.queue;
  }
}
