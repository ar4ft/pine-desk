import { randomUUID } from "node:crypto";

const maxRules = 100,
  maxHistory = 1000,
  maxGap = 30000;
const emptyDocument = () => ({
  version: 1,
  monitoring: false,
  notifications: true,
  rules: [],
  history: [],
});
export function validateAlertRule(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Provide an alert rule.");
  const allowed = [
    "name",
    "symbol",
    "direction",
    "price",
    "cooldownSeconds",
    "once",
    "enabled",
    "expiresAt",
    "session",
  ];
  if (Object.keys(input).some((k) => !allowed.includes(k)))
    throw Error("Unknown alert rule field.");
  const {
    direction,
    price,
    cooldownSeconds = 300,
    once = true,
    enabled = true,
    expiresAt = null,
    session = null,
  } = input;
  const symbol =
    typeof input.symbol === "string" ? input.symbol.trim().toUpperCase() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (
    !name ||
    name.length > 100 ||
    !/^[A-Z0-9]{3,24}$/.test(symbol) ||
    !["above", "below"].includes(direction) ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isInteger(cooldownSeconds) ||
    cooldownSeconds < 1 ||
    cooldownSeconds > 604800 ||
    typeof once !== "boolean" ||
    typeof enabled !== "boolean" ||
    (expiresAt !== null &&
      (!Number.isSafeInteger(expiresAt) ||
        expiresAt <= 0 ||
        expiresAt > 8640000000000000))
  )
    throw Error(
      "Use a name, Binance spot symbol, positive price, crossing direction and cooldown of 1–604800 seconds.",
    );
  let normalizedSession = null;
  if (session !== null) {
    const { startMinuteUTC, endMinuteUTC, daysUTC } = session;
    if (
      Object.keys(session).some(
        (k) => !["startMinuteUTC", "endMinuteUTC", "daysUTC"].includes(k),
      ) ||
      ![startMinuteUTC, endMinuteUTC].every(
        (v) => Number.isInteger(v) && v >= 0 && v < 1440,
      ) ||
      startMinuteUTC === endMinuteUTC ||
      !Array.isArray(daysUTC) ||
      !daysUTC.length ||
      daysUTC.length > 7 ||
      daysUTC.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
      new Set(daysUTC).size !== daysUTC.length
    )
      throw Error(
        "Use distinct UTC start/end times and weekdays (0=Sunday to 6=Saturday).",
      );
    normalizedSession = {
      startMinuteUTC,
      endMinuteUTC,
      daysUTC: [...daysUTC].sort(),
    };
  }
  return {
    name,
    symbol,
    direction,
    price,
    cooldownSeconds,
    once,
    enabled,
    expiresAt,
    session: normalizedSession,
  };
}
export function inAlertSession(rule, time) {
  if (!rule.session) return true;
  const d = new Date(time),
    minute = d.getUTCHours() * 60 + d.getUTCMinutes();
  const { startMinuteUTC: start, endMinuteUTC: end, daysUTC } = rule.session;
  return (
    daysUTC.includes(d.getUTCDay()) &&
    (start < end
      ? minute >= start && minute < end
      : minute >= start || minute < end)
  );
}
const eligible = (rule, now) =>
  rule.enabled &&
  (!rule.expiresAt || rule.expiresAt > now) &&
  inAlertSession(rule, now);

export class AlertEngine {
  constructor({
    repository,
    quotes,
    now = Date.now,
    clock = globalThis,
    notify = () => "unavailable",
  }) {
    Object.assign(this, { repository, quotes, now, clock, notify });
    this.doc = emptyDocument();
    this.runtime = new Map();
    this.queue = Promise.resolve();
    this.pending = 0;
    this.error = null;
    this.closed = false;
  }
  initialize() {
    this.initialization ??= (async () => {
      try {
        const saved = await this.repository.read();
        if (saved) {
          if (
            saved.version !== 1 ||
            typeof saved.monitoring !== "boolean" ||
            typeof saved.notifications !== "boolean" ||
            !Array.isArray(saved.rules) ||
            saved.rules.length > maxRules ||
            !Array.isArray(saved.history) ||
            saved.history.length > maxHistory
          )
            throw Error("Invalid saved alert document.");
          const ids = new Set();
          for (const rule of saved.rules) {
            const {
              id,
              createdAt,
              updatedAt,
              lastTriggeredAt,
              triggerCount,
              ...definition
            } = rule;
            validateAlertRule(definition);
            if (
              typeof id !== "string" ||
              !/^[a-zA-Z0-9-]{1,100}$/.test(id) ||
              ids.has(id) ||
              ![createdAt, updatedAt].every(Number.isFinite) ||
              !(lastTriggeredAt === null || Number.isFinite(lastTriggeredAt)) ||
              !Number.isInteger(triggerCount) ||
              triggerCount < 0
            )
              throw Error("Invalid saved alert rule metadata.");
            ids.add(id);
          }
          if (
            new Set(saved.rules.filter((r) => r.enabled).map((r) => r.symbol))
              .size > 50
          )
            throw Error("Saved alerts exceed the 50-market limit.");
          const events = new Set();
          for (const event of saved.history) {
            if (
              !event ||
              typeof event.id !== "string" ||
              events.has(event.id) ||
              typeof event.ruleId !== "string" ||
              typeof event.name !== "string" ||
              event.name.length > 100 ||
              !/^[A-Z0-9]{3,24}$/.test(event.symbol) ||
              !["above", "below"].includes(event.direction) ||
              ![event.price, event.previousPrice, event.threshold].every(
                (v) => Number.isFinite(v) && v > 0,
              ) ||
              ![
                event.eventAt,
                event.previousEventAt,
                event.receivedAt,
                event.triggeredAt,
              ].every(Number.isFinite) ||
              ![
                "pending",
                "disabled",
                "submitted",
                "unavailable",
                "failed",
              ].includes(event.notification) ||
              !(
                event.acknowledgedAt === null ||
                Number.isFinite(event.acknowledgedAt)
              )
            )
              throw Error("Invalid saved alert history.");
            events.add(event.id);
          }
          this.doc = saved;
        }
        if (this.closed) return;
        this.unsubscribe = this.quotes.subscribe((symbol, quote) =>
          this.observe(symbol, quote),
        );
        this.reconcile();
        this.timer = this.clock.setInterval(() => {
          this.run(() => this.reconcile()).catch(() => {});
        }, 1000);
        this.timer?.unref?.();
      } catch (error) {
        this.loadFailed = true;
        this.error = "Alert storage could not be loaded: " + error.message;
      }
    })();
    return this.initialization;
  }
  run(action) {
    const pending = this.queue.then(async () => {
      if (this.closed) throw Error("Alert service is stopped.");
      return action();
    });
    this.queue = pending.catch(() => {});
    return pending;
  }
  assertWritable() {
    if (this.loadFailed) throw Error(this.error);
  }
  async commit(next) {
    this.assertWritable();
    try {
      await this.repository.write(next);
      this.doc = next;
    } catch (error) {
      this.error =
        "Alert storage failed; monitoring stopped. Resume after fixing storage: " +
        error.message;
      this.runtime.clear();
      this.quotes.set("alerts", []);
      throw Error(this.error);
    }
  }
  reconcile() {
    const now = this.now();
    const active = this.doc.monitoring && !this.error && !this.closed;
    const rules = active ? this.doc.rules.filter((r) => eligible(r, now)) : [];
    for (const id of this.runtime.keys())
      if (!rules.some((r) => r.id === id)) this.runtime.delete(id);
    this.quotes.set("alerts", [...new Set(rules.map((r) => r.symbol))]);
  }
  async save(input, id = null) {
    await this.initialize();
    const definition = validateAlertRule(input);
    return this.run(async () => {
      this.assertWritable();
      const previous = id ? this.doc.rules.find((r) => r.id === id) : null;
      if (id && !previous) throw Error("Alert not found.");
      if (!previous && this.doc.rules.length >= maxRules)
        throw Error("Keep up to 100 alert rules.");
      const now = this.now();
      if (
        definition.expiresAt !== null &&
        definition.expiresAt <= now &&
        definition.enabled
      )
        throw Error("Choose a future expiry or disable this expired rule.");
      const rule = {
        ...definition,
        id: previous?.id ?? randomUUID(),
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        lastTriggeredAt: previous?.lastTriggeredAt ?? null,
        triggerCount: previous?.triggerCount ?? 0,
      };
      const next = structuredClone(this.doc);
      next.rules = previous
        ? next.rules.map((r) => (r.id === id ? rule : r))
        : [...next.rules, rule];
      if (
        new Set(next.rules.filter((r) => r.enabled).map((r) => r.symbol)).size >
        50
      )
        throw Error("Enabled alerts support up to 50 distinct markets.");
      await this.commit(next);
      this.runtime.delete(rule.id);
      this.reconcile();
      return rule;
    });
  }
  async remove(id) {
    await this.initialize();
    return this.run(async () => {
      if (!this.doc.rules.some((r) => r.id === id))
        throw Error("Alert not found.");
      await this.commit({
        ...this.doc,
        rules: this.doc.rules.filter((r) => r.id !== id),
      });
      this.runtime.delete(id);
      this.reconcile();
      return this.snapshot();
    });
  }
  async configure({ monitoring, notifications }) {
    if (typeof monitoring !== "boolean" || typeof notifications !== "boolean")
      throw Error("Choose monitoring and notification settings.");
    await this.initialize();
    return this.run(async () => {
      const reset = this.error || this.doc.monitoring !== monitoring;
      await this.commit({ ...this.doc, monitoring, notifications });
      this.error = null;
      if (reset) this.runtime.clear();
      this.reconcile();
      return this.snapshot();
    });
  }
  observe(symbol, quote) {
    if (
      this.closed ||
      !this.doc.monitoring ||
      this.error ||
      !this.doc.rules.some((r) => r.symbol === symbol && r.enabled)
    )
      return;
    if (this.pending >= 1000) {
      this.error =
        "Alert quote queue exceeded capacity; monitoring stopped. Resume to establish fresh baselines.";
      this.runtime.clear();
      this.quotes.set("alerts", []);
      return;
    }
    this.pending++;
    this.run(() => this.evaluate(symbol, quote))
      .catch(() => {})
      .finally(() => {
        this.pending--;
      });
  }
  async evaluate(symbol, quote) {
    const now = this.now();
    if (!this.doc.monitoring || this.error) return;
    const fresh =
      Number.isFinite(quote.price) &&
      quote.price > 0 &&
      Number.isFinite(quote.eventAt) &&
      Number.isFinite(quote.receivedAt) &&
      quote.eventAt <= now + 5000 &&
      now - quote.eventAt <= maxGap &&
      now - quote.receivedAt <= maxGap &&
      quote.receivedAt <= now + 5000 &&
      !quote.stale;
    const fired = [];
    let next;
    for (const rule of this.doc.rules.filter((r) => r.symbol === symbol)) {
      if (
        !fresh ||
        quote.receivedAt < rule.updatedAt ||
        !eligible(rule, now) ||
        !eligible(rule, quote.eventAt)
      ) {
        this.runtime.delete(rule.id);
        continue;
      }
      const previous = this.runtime.get(rule.id);
      if (previous && quote.eventAt <= previous.eventAt) continue;
      this.runtime.set(rule.id, quote);
      if (
        !previous ||
        previous.connection !== quote.connection ||
        quote.eventAt - previous.eventAt > maxGap ||
        quote.receivedAt - previous.receivedAt > maxGap
      )
        continue;
      const crossed =
        rule.direction === "above"
          ? previous.price < rule.price && quote.price >= rule.price
          : previous.price > rule.price && quote.price <= rule.price;
      if (
        !crossed ||
        (rule.lastTriggeredAt !== null &&
          now - rule.lastTriggeredAt < rule.cooldownSeconds * 1000)
      )
        continue;
      next ??= structuredClone(this.doc);
      const record = {
        id: randomUUID(),
        ruleId: rule.id,
        name: rule.name,
        provider: "binance",
        marketType: "spot",
        symbol,
        direction: rule.direction,
        threshold: rule.price,
        previousPrice: previous.price,
        price: quote.price,
        previousEventAt: previous.eventAt,
        eventAt: quote.eventAt,
        receivedAt: quote.receivedAt,
        triggeredAt: now,
        notification: this.doc.notifications ? "pending" : "disabled",
        acknowledgedAt: null,
      };
      fired.push(record);
      const savedRule = next.rules.find((r) => r.id === rule.id);
      savedRule.lastTriggeredAt = now;
      savedRule.triggerCount++;
      if (savedRule.once) savedRule.enabled = false;
    }
    if (!next) return;
    next.history = [...next.history, ...fired].slice(-maxHistory);
    // Commit history and one-shot disarming atomically before external OS delivery.
    await this.commit(next);
    this.reconcile();
    if (!this.doc.notifications || this.closed) return;
    const updated = structuredClone(this.doc);
    for (const record of fired) {
      let result;
      try {
        result = await this.notify(structuredClone(record));
      } catch {
        result = "failed";
      }
      const event = updated.history.find((r) => r.id === record.id);
      if (event)
        event.notification = ["submitted", "unavailable", "failed"].includes(
          result,
        )
          ? result
          : "unavailable";
    }
    await this.commit(updated);
  }

  async acknowledge(id) {
    await this.initialize();
    return this.run(async () => {
      const next = structuredClone(this.doc),
        record = next.history.find((e) => e.id === id);
      if (!record) throw Error("Alert event not found.");
      record.acknowledgedAt ??= this.now();
      await this.commit(next);
      return record;
    });
  }
  snapshot() {
    const now = this.now(),
      feed = this.quotes.snapshot("alerts");
    return {
      monitoring: this.doc.monitoring,
      notifications: this.doc.notifications,
      error: this.error,
      running: this.doc.monitoring && !this.error && !this.closed,
      observedAt: now,
      feed,
      rules: this.doc.rules.map((r) => ({
        ...r,
        state: !r.enabled
          ? "disabled"
          : r.expiresAt && r.expiresAt <= now
            ? "expired"
            : !inAlertSession(r, now)
              ? "outside session"
              : !this.doc.monitoring
                ? "paused"
                : this.error
                  ? "error"
                  : !this.runtime.has(r.id) ||
                      feed.quotes[r.symbol]?.stale ||
                      !feed.quotes[r.symbol]
                    ? "waiting for fresh baseline"
                    : "armed",
        baseline: this.runtime.get(r.id)?.price ?? null,
      })),
      historyCount: this.doc.history.length,
      unreadCount: this.doc.history.filter((e) => !e.acknowledgedAt).length,
      historyLimit: maxHistory,
    };
  }
  history({ limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > maxHistory)
      throw Error("Choose 1–1000 alert events.");
    return {
      events: this.doc.history.slice(-limit).reverse(),
      total: this.doc.history.length,
      retainedLimit: maxHistory,
    };
  }
  async close() {
    this.closed = true;
    this.clock.clearInterval(this.timer);
    this.unsubscribe?.();
    this.quotes.set("alerts", []);
    await this.queue;
  }
}
