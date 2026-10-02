import { randomUUID, createHash } from "node:crypto";
import * as store from "./store.js";
import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
const exchanges = ["deribit", "bybit", "okx", "import"];
export function validateOptionSnapshot(s) {
  if (
    !s ||
    !exchanges.includes(s.exchange ?? "deribit") ||
    !(s.exchange === "import"
      ? /^[A-Z][A-Z0-9.-]{0,14}$/.test(s.currency)
      : ["BTC", "ETH"].includes(s.currency)) ||
    !(s.spot > 0) ||
    !Number.isFinite(s.spot) ||
    !Number.isFinite(s.fetchedAt) ||
    s.fetchedAt <= 0 ||
    !Array.isArray(s.rows) ||
    !s.rows.length ||
    s.rows.length > 10000
  )
    throw Error("Invalid option snapshot header.");
  const exchange = s.exchange ?? "deribit",
    settlement = s.settlement ?? s.currency;
  if (!["BTC", "ETH", "USDC", "USDT", "USD"].includes(settlement))
    throw Error("Unsupported option settlement currency.");
  const seen = new Set(),
    rows = s.rows.map((r) => {
      if (
        typeof r.instrument !== "string" ||
        !/^[A-Za-z0-9._-]{1,100}$/.test(r.instrument) ||
        seen.has(r.instrument) ||
        !["call", "put"].includes(r.type) ||
        !(r.strike > 0) ||
        !Number.isFinite(r.strike) ||
        !Number.isFinite(r.expiry) ||
        r.expiry <= s.fetchedAt ||
        r.currency !== s.currency
      )
        throw Error("Invalid, duplicate or expired option row.");
      seen.add(r.instrument);
      const out = {
        instrument: r.instrument,
        type: r.type,
        strike: r.strike,
        expiry: r.expiry,
        currency: s.currency,
        exchange,
        settlement,
        premiumCurrency: r.premiumCurrency ?? settlement,
        payoffType:
          r.payoffType ?? (settlement === s.currency ? "inverse" : "linear"),
        quantityUnit: r.quantityUnit ?? "underlying",
        exerciseStyle: r.exerciseStyle ?? "european",
        settlementType: r.settlementType ?? "cash",
        contractSize: r.contractSize ?? 1,
        quoteTimeKind: String(
          r.quoteTimeKind ?? "Unspecified imported timestamp",
        ).slice(0, 200),
      };
      if (
        out.premiumCurrency !== settlement ||
        !["inverse", "linear"].includes(out.payoffType) ||
        (out.payoffType === "inverse" && settlement !== s.currency) ||
        (out.payoffType === "linear" &&
          !["USDC", "USDT", "USD"].includes(settlement)) ||
        !["european", "american"].includes(out.exerciseStyle) ||
        !["cash", "physical"].includes(out.settlementType) ||
        (out.settlementType === "physical" && settlement !== "USD") ||
        !["underlying", "contracts"].includes(out.quantityUnit) ||
        !Number.isFinite(out.contractSize) ||
        out.contractSize <= 0
      )
        throw Error("Inconsistent option units.");
      for (const key of [
        "bid",
        "ask",
        "mark",
        "iv",
        "bidIV",
        "askIV",
        "oi",
        "rawOI",
        "volume",
        "underlying",
        "index",
        "quoteAt",
        "ivAt",
        "modelRate",
        "bidSize",
        "askSize",
      ]) {
        const v = r[key];
        if (v !== null && v !== undefined && (!Number.isFinite(v) || v < 0))
          throw Error(`Invalid ${key} in ${r.instrument}.`);
        out[key] = v ?? null;
      }
      return out;
    });
  const result = {
    schemaVersion: 1,
    exchange,
    currency: s.currency,
    settlement,
    spot: s.spot,
    fetchedAt: s.fetchedAt,
    rows,
    coverage: String(s.coverage ?? "Imported chain").slice(0, 500),
  };
  if (JSON.stringify(result).length > 20000000)
    throw Error("Snapshot exceeds 20 MB.");
  return result;
}
export class OptionHistory {
  constructor({
    storage = store,
    now = Date.now,
    maxCount = 50000,
    maxBytes = 2000000000,
  } = {}) {
    this.storage = storage;
    this.now = now;
    this.maxCount = maxCount;
    this.maxBytes = maxBytes;
    this.queue = Promise.resolve();
  }
  serial(fn) {
    const result = this.queue.catch(() => {}).then(() => this.locked(fn));
    this.queue = result;
    return result;
  }
  async locked(fn) {
    if (this.storage !== store) return fn();
    await fs.mkdir(store.dataDir, { recursive: true });
    const dir = path.join(store.dataDir, "option-history.lock"),
      owner = `owner-${process.pid}-${randomUUID()}`,
      deadline = Date.now() + 5000;
    while (true) {
      try {
        await fs.mkdir(dir, { mode: 0o700 });
        try {
          await fs.writeFile(path.join(dir, owner), "", { mode: 0o600 });
        } catch (e) {
          await fs.rm(path.join(dir, owner), { force: true });
          await fs.rmdir(dir);
          throw e;
        }
        break;
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        try {
          const files = await fs.readdir(dir);
          if (files.length === 1) {
            const match = /^owner-([0-9]+)-/.exec(files[0]);
            if (match) {
              try {
                process.kill(Number(match[1]), 0);
              } catch (error) {
                if (error.code === "ESRCH") {
                  try {
                    await fs.unlink(path.join(dir, files[0]));
                    await fs.rmdir(dir);
                  } catch {}
                  continue;
                }
              }
            }
          }
        } catch (error) {
          if (error.code === "ENOENT") continue;
        }
        if (Date.now() > deadline)
          throw Error(
            "Option history is busy in another process; retry later.",
          );
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    try {
      return await fn();
    } finally {
      await fs.unlink(path.join(dir, owner));
      await fs.rmdir(dir);
    }
  }
  async index() {
    return (await this.storage.read("option-history-index")) ?? [];
  }
  async list({
    exchange,
    currency,
    settlement,
    from = 0,
    to = Number.MAX_SAFE_INTEGER,
    offset = 0,
    limit = 500,
  } = {}) {
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      to < from ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 5000
    )
      throw Error("Invalid history date range or page (1–5000 rows).");
    return (await this.index())
      .filter(
        (r) =>
          (!exchange || r.exchange === exchange) &&
          (!currency || r.currency === currency) &&
          (!settlement || r.settlement === settlement) &&
          r.fetchedAt >= from &&
          r.fetchedAt <= to,
      )
      .slice(offset, offset + limit);
  }
  async coverage(args = {}) {
    const index = await this.index(),
      selected = await this.list({ ...args, limit: 5000, offset: 0 });
    const groups = {};
    for (const row of index) {
      const key = `${row.exchange}/${row.currency}/${row.settlement}`;
      (groups[key] ??= []).push(row);
    }
    return {
      count: index.length,
      storedBytes: index.reduce((n, r) => n + (r.storedBytes ?? r.bytes), 0),
      maxCount: this.maxCount,
      maxBytes: this.maxBytes,
      pageCount: selected.length,
      groups: Object.entries(groups).map(([basis, rows]) => {
        const times = [...new Set(rows.map((r) => r.fetchedAt))].sort(
            (a, b) => a - b,
          ),
          gaps = times
            .slice(1)
            .map((time, i) => time - times[i])
            .sort((a, b) => a - b),
          medianIntervalMs = gaps[Math.floor(gaps.length / 2)] ?? null;
        return {
          basis,
          count: rows.length,
          from: times[0],
          to: times.at(-1),
          medianIntervalMs,
          longGaps: medianIntervalMs
            ? times
                .slice(1)
                .flatMap((time, i) =>
                  time - times[i] > medianIntervalMs * 2
                    ? [{ from: times[i], to: time }]
                    : [],
                )
            : [],
          imported: rows.filter((r) => r.origin.startsWith("Imported")).length,
        };
      }),
      retention:
        "No automatic deletion. Compressed payload quota; index and saved runs occupy additional disk space.",
    };
  }
  async get(id) {
    const saved = await (this.storage.readCompressed ?? this.storage.read).call(
      this.storage,
      "option-history",
      id,
    );
    if (!saved) throw Error("Option snapshot not found.");
    validateOptionSnapshot(saved.snapshot);
    if (
      saved.id !== id ||
      createHash("sha256")
        .update(JSON.stringify(saved.snapshot))
        .digest("hex") !== saved.sha256
    )
      throw Error(
        "Option snapshot hash mismatch; import edited data as a new unverified record.",
      );
    return saved;
  }
  save(snapshot, { imported = false } = {}) {
    return this.serial(async () => this.addMany([snapshot], imported));
  }
  saveMany(snapshots, { imported = true } = {}) {
    if (
      !Array.isArray(snapshots) ||
      !snapshots.length ||
      snapshots.length > 2000 ||
      Buffer.byteLength(JSON.stringify(snapshots)) > 100000000
    )
      throw Error("Save 1–2000 observations totaling at most 100 MB.");
    return this.serial(() => this.addMany(snapshots, imported));
  }
  async addMany(snapshots, imported) {
    const checked = snapshots.map(validateOptionSnapshot),
      index = await this.index(),
      added = checked.map((snapshot) => {
        const text = JSON.stringify(snapshot);
        return {
          id: randomUUID(),
          savedAt: this.now(),
          origin: imported
            ? "Imported; source not verified"
            : "Public API observation",
          sha256: createHash("sha256").update(text).digest("hex"),
          bytes: Buffer.byteLength(text),
          snapshot,
        };
      });
    for (const item of added)
      item.storedBytes = this.storage.writeCompressed
        ? gzipSync(JSON.stringify(item)).length
        : item.bytes;
    if (
      index.length + added.length > this.maxCount ||
      index.reduce((n, s) => n + (s.storedBytes ?? s.bytes), 0) +
        added.reduce((n, s) => n + s.storedBytes, 0) >
        this.maxBytes
    )
      throw Error(
        `History is full (${this.maxCount} snapshots / ${this.maxBytes} stored bytes). Export and delete selected records before saving more; nothing was removed.`,
      );
    const summaries = added.map(({ snapshot, ...meta }) => ({
      ...meta,
      exchange: snapshot.exchange,
      currency: snapshot.currency,
      settlement: snapshot.settlement,
      fetchedAt: snapshot.fetchedAt,
      spot: snapshot.spot,
      contracts: snapshot.rows.length,
    }));
    try {
      for (const item of added)
        await (this.storage.writeCompressed ?? this.storage.write).call(
          this.storage,
          "option-history",
          { ...item, storedBytes: undefined },
          item.id,
        );
      await this.storage.write(
        "option-history-index",
        [...index, ...summaries].sort((a, b) => b.fetchedAt - a.fetchedAt),
      );
    } catch (e) {
      await Promise.allSettled(
        added.map((item) =>
          (this.storage.removeCompressed ?? this.storage.remove).call(
            this.storage,
            "option-history",
            item.id,
          ),
        ),
      );
      throw e;
    }
    return summaries;
  }
  import(json) {
    if (typeof json !== "string" || Buffer.byteLength(json) > 25000000)
      throw Error("Import a JSON archive up to 25 MB.");
    const body = JSON.parse(json);
    if (
      body.schemaVersion !== 1 ||
      !Array.isArray(body.snapshots) ||
      !body.snapshots.length ||
      body.snapshots.length > 200
    )
      throw Error("Expected schemaVersion 1 and 1–200 snapshots.");
    return this.serial(() =>
      this.addMany(
        body.snapshots.map((s) => s.snapshot ?? s),
        true,
      ),
    );
  }
  async export(ids) {
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 200 ||
      new Set(ids).size !== ids.length
    )
      throw Error("Choose 1–200 distinct archive IDs.");
    return {
      schemaVersion: 1,
      snapshots: await Promise.all(ids.map((id) => this.get(id))),
    };
  }
  remove(id) {
    return this.serial(async () => {
      const index = await this.index();
      if (!index.some((s) => s.id === id)) throw Error("Snapshot not found.");
      await this.storage.write(
        "option-history-index",
        index.filter((s) => s.id !== id),
      );
      await (this.storage.removeCompressed ?? this.storage.remove).call(
        this.storage,
        "option-history",
        id,
      );
      return this.list();
    });
  }
  async compare(ids) {
    if (
      !Array.isArray(ids) ||
      ids.length < 2 ||
      ids.length > 6 ||
      new Set(ids).size !== ids.length
    )
      throw Error("Choose 2–6 distinct snapshots.");
    const records = (await Promise.all(ids.map((id) => this.get(id)))).sort(
        (a, b) => a.snapshot.fetchedAt - b.snapshot.fetchedAt,
      ),
      base = records[0].snapshot;
    if (
      records.some(
        (r) =>
          r.snapshot.exchange !== base.exchange ||
          r.snapshot.currency !== base.currency ||
          r.snapshot.settlement !== base.settlement,
      )
    )
      throw Error(
        "Compare the same exchange, underlying and settlement currency.",
      );
    const first = new Map(base.rows.map((r) => [r.instrument, r]));
    return {
      basis: {
        exchange: base.exchange,
        currency: base.currency,
        settlement: base.settlement,
      },
      records: records.map((r) => ({
        id: r.id,
        at: r.snapshot.fetchedAt,
        spot: r.snapshot.spot,
        contracts: r.snapshot.rows.length,
        source: r.origin,
        sha256: r.sha256,
      })),
      changes: records.slice(1).map((record) => {
        const s = record.snapshot,
          current = new Map(s.rows.map((r) => [r.instrument, r]));
        const rows = s.rows.flatMap((r) => {
          const old = first.get(r.instrument);
          return old
            ? [
                {
                  instrument: r.instrument,
                  ivChange:
                    r.iv !== null && old.iv !== null ? r.iv - old.iv : null,
                  oiChange:
                    r.oi !== null && old.oi !== null ? r.oi - old.oi : null,
                },
              ]
            : [];
        });
        return {
          id: record.id,
          at: s.fetchedAt,
          spotChangePercent: (s.spot / base.spot - 1) * 100,
          matched: rows.length,
          added: s.rows.length - rows.length,
          removed: base.rows.filter((r) => !current.has(r.instrument)).length,
          rows,
        };
      }),
    };
  }
}
export class OptionRecorder {
  constructor({
    history,
    fetchSnapshot,
    clock = globalThis,
    now = Date.now,
  } = {}) {
    this.history = history;
    this.fetchSnapshot = fetchSnapshot;
    this.clock = clock;
    this.now = now;
    this.generation = 0;
    this.state = { active: false, status: "stopped", saved: 0 };
  }
  status() {
    return structuredClone(this.state);
  }
  stop() {
    this.generation++;
    this.state.active = false;
    this.state.status = "stopped";
    this.clock.clearTimeout(this.timer);
    return this.status();
  }
  start({
    exchange = "deribit",
    currency = "BTC",
    settlement = "USDC",
    intervalSeconds = 300,
  } = {}) {
    if (
      !["deribit", "bybit", "okx"].includes(exchange) ||
      !["BTC", "ETH"].includes(currency) ||
      !Number.isInteger(intervalSeconds) ||
      intervalSeconds < 60 ||
      intervalSeconds > 3600 ||
      (exchange === "bybit" && !["USDC", "USDT"].includes(settlement))
    )
      throw Error(
        "Choose an exchange, currency and 60–3600 second recording interval.",
      );
    this.stop();
    this.state = {
      active: true,
      status: "capturing",
      exchange,
      currency,
      settlement,
      intervalSeconds,
      saved: 0,
      lastSavedAt: null,
      error: null,
    };
    this.capture(this.generation);
    return this.status();
  }
  async capture(generation) {
    try {
      const snapshot = await this.fetchSnapshot(this.state);
      if (!this.state.active || generation !== this.generation) return;
      const saved = await this.history.save(snapshot);
      if (generation !== this.generation) return;
      this.state.saved++;
      this.state.lastSavedAt = saved[0].savedAt;
      this.state.status = "waiting";
      this.state.error = null;
    } catch (e) {
      if (generation !== this.generation) return;
      this.state.error = e.message;
      this.state.status = "error";
      if (/History is full/.test(e.message)) {
        this.state.active = false;
        return;
      }
    }
    if (this.state.active && generation === this.generation) {
      this.timer = this.clock.setTimeout(
        () => this.capture(generation),
        this.state.intervalSeconds * 1000,
      );
      this.timer?.unref?.();
    }
  }
}
