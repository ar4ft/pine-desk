import { randomUUID, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import * as store from "./store.js";
import { depthLimit, depthSymbol } from "./depth.js";
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const idCheck = (id) => {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
    throw Error("Invalid depth recording ID.");
};

// Chunks are immutable. The atomically replaced manifest is the commit point.
export class DepthHistory {
  constructor({
    storage = store,
    now = Date.now,
    maxSessions = 30,
    maxBytes = 250_000_000,
  } = {}) {
    this.storage = storage;
    this.now = now;
    this.maxSessions = maxSessions;
    this.maxBytes = maxBytes;
    this.queue = Promise.resolve();
  }
  serial(fn) {
    const result = this.queue.catch(() => {}).then(fn);
    this.queue = result;
    return result;
  }
  initialize() {
    return (this.ready ??= this.serial(async () => {
      for (const meta of await this.storage.list("depth-recordings")) {
        this.validateMeta(meta);
        if (meta.status === "recording")
          await this.storage.write(
            "depth-recordings",
            {
              ...meta,
              status: "interrupted",
              reason:
                "Owner exited before recording was finalized. Only committed samples are available.",
            },
            meta.id,
          );
      }
    }));
  }
  validateMeta(meta) {
    idCheck(meta?.id);
    depthSymbol(meta.symbol);
    depthLimit(meta.levels);
    if (
      meta.version !== 1 ||
      meta.provider !== "binance" ||
      meta.assetType !== "spot" ||
      typeof meta.name !== "string" ||
      !meta.name.length ||
      meta.name.length > 100 ||
      ![1, 2, 5, 10].includes(meta.intervalSeconds) ||
      !Number.isSafeInteger(meta.startedAt) ||
      meta.startedAt <= 0 ||
      !["recording", "stopped", "complete", "error", "interrupted"].includes(
        meta.status,
      ) ||
      !Array.isArray(meta.chunks) ||
      meta.chunks.length > 361 ||
      !Number.isInteger(meta.count) ||
      meta.count < 0 ||
      meta.count > 3600 ||
      !Number.isInteger(meta.bytes) ||
      meta.bytes < 0
    )
      throw Error("Invalid depth recording manifest.");
    let count = 0,
      bytes = 0;
    for (const [index, c] of meta.chunks.entries()) {
      if (
        c.id !== `${meta.id}-${String(index).padStart(4, "0")}` ||
        c.offset !== count ||
        !Number.isInteger(c.count) ||
        c.count < 1 ||
        c.count > 10 ||
        !Number.isInteger(c.bytes) ||
        c.bytes < 1 ||
        !/^[a-f0-9]{64}$/.test(c.sha256)
      )
        throw Error("Invalid depth recording chunk manifest.");
      count += c.count;
      bytes += c.bytes;
    }
    if (
      count !== meta.count ||
      bytes !== meta.bytes ||
      (count > 0 &&
        (!Number.isSafeInteger(meta.lastSampleAt) ||
          meta.lastSampleAt < meta.startedAt))
    )
      throw Error("Inconsistent depth recording manifest.");
    return meta;
  }
  async list() {
    await this.initialize();
    await this.queue.catch(() => {});
    return this.listRaw();
  }
  async listRaw() {
    return (await this.storage.list("depth-recordings"))
      .map((m) => this.validateMeta(m))
      .sort((a, b) => b.startedAt - a.startedAt);
  }
  create({ name, symbol, levels, intervalSeconds }) {
    return this.serial(async () => {
      const entries = await this.listRaw();
      if (
        entries.length >= this.maxSessions ||
        entries.reduce((n, m) => n + m.bytes, 0) >= this.maxBytes
      )
        throw Error(
          "Depth archive is full. Delete selected recordings to free space; nothing was removed.",
        );
      const meta = {
        version: 1,
        id: randomUUID(),
        name,
        symbol,
        provider: "binance",
        assetType: "spot",
        levels,
        intervalSeconds,
        startedAt: this.now(),
        endedAt: null,
        lastSampleAt: null,
        status: "recording",
        reason: null,
        count: 0,
        gaps: 0,
        bytes: 0,
        chunks: [],
      };
      this.validateMeta(meta);
      await this.storage.write("depth-recordings", meta, meta.id);
      return meta;
    });
  }
  append(id, frames) {
    return this.serial(async () => {
      const meta = await this.meta(id);
      if (
        meta.status !== "recording" ||
        !frames.length ||
        frames.length > 10 ||
        meta.count + frames.length > 3600
      )
        throw Error("Invalid depth recording batch.");
      let previous = meta.lastSampleAt;
      for (const f of frames) {
        validateDepthFrame(f, meta);
        if (previous !== null && f.at <= previous)
          throw Error("Depth recording timestamps must increase.");
        previous = f.at;
      }
      const chunkId = `${id}-${String(meta.chunks.length).padStart(4, "0")}`;
      const chunk = { version: 1, recordingId: id, offset: meta.count, frames };
      const bytes = gzipSync(JSON.stringify(chunk)).length;
      if (
        (await this.listRaw()).reduce((n, m) => n + m.bytes, 0) + bytes >
        this.maxBytes
      )
        throw Error(
          "Depth archive storage limit reached. Recording stopped; nothing was removed.",
        );
      const next = {
        ...meta,
        count: meta.count + frames.length,
        lastSampleAt: frames.at(-1).at,
        gaps: meta.gaps + frames.filter((f) => !f.book || f.gapBefore).length,
        bytes: meta.bytes + bytes,
        chunks: [
          ...meta.chunks,
          {
            id: chunkId,
            offset: meta.count,
            count: frames.length,
            sha256: hash(chunk),
            bytes,
          },
        ],
      };
      try {
        await this.storage.writeCompressed("depth-frames", chunk, chunkId);
        await this.storage.write("depth-recordings", next, id);
      } catch (error) {
        // Never expose a chunk whose manifest commit failed.
        await this.storage
          .removeCompressed("depth-frames", chunkId)
          .catch(() => {});
        throw error;
      }
      return next;
    });
  }
  async meta(id) {
    idCheck(id);
    const meta = await this.storage.read("depth-recordings", id);
    if (!meta) throw Error("Depth recording not found.");
    return this.validateMeta(meta);
  }
  finish(id, status, reason) {
    return this.serial(async () => {
      const meta = await this.meta(id);
      const next = { ...meta, status, reason, endedAt: this.now() };
      await this.storage.write("depth-recordings", next, id);
      return next;
    });
  }
  async get({ id, offset, limit = 300 }) {
    await this.initialize();
    await this.queue.catch(() => {});
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 600 ||
      (offset !== undefined && (!Number.isInteger(offset) || offset < 0))
    )
      throw Error("Choose a nonnegative offset and 1–600 samples.");
    const meta = await this.meta(id);
    offset = offset ?? Math.max(0, meta.count - limit);
    if (offset > meta.count)
      throw Error("Recording offset exceeds saved sample count.");
    const frames = [];
    for (const c of meta.chunks.filter(
      (c) => c.offset < offset + limit && c.offset + c.count > offset,
    )) {
      const chunk = await this.storage.readCompressed("depth-frames", c.id);
      if (
        !chunk ||
        chunk.recordingId !== id ||
        chunk.offset !== c.offset ||
        chunk.frames?.length !== c.count ||
        hash(chunk) !== c.sha256
      )
        throw Error("Depth chunk is missing or its integrity check failed.");
      for (const f of chunk.frames) validateDepthFrame(f, meta);
      frames.push(
        ...chunk.frames.slice(
          Math.max(0, offset - c.offset),
          Math.min(c.count, offset + limit - c.offset),
        ),
      );
    }
    return { meta, offset, total: meta.count, frames };
  }
  async remove(id) {
    await this.initialize();
    return this.serial(async () => {
      const meta = await this.meta(id);
      if (meta.status === "recording")
        throw Error("Stop this recording before deleting it.");
      for (const c of meta.chunks)
        await this.storage.removeCompressed("depth-frames", c.id);
      await this.storage.remove("depth-recordings", id);
      return { removed: id };
    });
  }
}
export function validateDepthFrame(frame, meta) {
  if (
    !Number.isSafeInteger(frame?.at) ||
    frame.at <= 0 ||
    (frame.gapBefore !== null &&
      (!frame.gapBefore ||
        !Number.isFinite(frame.gapBefore.from) ||
        !Number.isFinite(frame.gapBefore.to) ||
        frame.gapBefore.from > frame.gapBefore.to ||
        frame.gapBefore.to !== frame.at ||
        typeof frame.gapBefore.reason !== "string"))
  )
    throw Error("Invalid depth sample timestamp or gap.");
  if (frame.book === null) {
    if (typeof frame.reason !== "string" || !frame.reason)
      throw Error("Missing depth gap reason.");
    return frame;
  }
  const b = frame.book;
  if (!b) throw Error("Invalid recorded book.");
  if (
    b.symbol !== meta.symbol ||
    b.provider !== "binance" ||
    b.stale ||
    !Number.isSafeInteger(b.lastUpdateId) ||
    !Number.isSafeInteger(b.connection) ||
    !Number.isFinite(b.eventAt) ||
    !Number.isFinite(b.receivedAt) ||
    frame.at - b.eventAt > 5000 ||
    frame.at - b.receivedAt > 5000 ||
    b.eventAt > frame.at + 5000 ||
    b.receivedAt > frame.at + 5000
  )
    throw Error("Invalid recorded depth provenance.");
  for (const side of ["bids", "asks"]) {
    const rows = b[side];
    if (!Array.isArray(rows) || !rows.length || rows.length > meta.levels)
      throw Error("Invalid recorded depth levels.");
    if (
      rows.some(
        (r, i) =>
          !Number.isFinite(r.price) ||
          r.price <= 0 ||
          !Number.isFinite(r.size) ||
          r.size <= 0 ||
          (i &&
            (side === "bids"
              ? r.price >= rows[i - 1].price
              : r.price <= rows[i - 1].price)),
      )
    )
      throw Error("Invalid recorded depth row.");
  }
  if (b.bids[0].price >= b.asks[0].price) throw Error("Crossed recorded book.");
  return frame;
}
export class DepthRecorder {
  constructor({ history, depth, now = Date.now, clock = globalThis } = {}) {
    this.history = history;
    this.depth = depth;
    this.now = now;
    this.clock = clock;
    this.state = { active: false, status: "stopped", error: null };
    this.queue = Promise.resolve();
    this.buffer = [];
    this.generation = 0;
  }
  serial(fn) {
    const result = this.queue.catch(() => {}).then(fn);
    this.queue = result;
    return result;
  }
  status() {
    return {
      ...structuredClone(this.state),
      pending: this.buffer.length,
      feed: {
        active: this.depth.active,
        symbol: this.depth.symbol ?? null,
        status: this.depth.status,
      },
    };
  }
  start({ name = "Depth recording", levels = 50, intervalSeconds = 1 } = {}) {
    return this.serial(async () => {
      depthLimit(levels);
      if (
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 100 ||
        ![1, 2, 5, 10].includes(intervalSeconds)
      )
        throw Error(
          "Use a name up to 100 characters and a 1, 2, 5 or 10 second interval.",
        );
      if (this.state.active)
        throw Error("Stop the active depth recording first.");
      if (!this.depth.active)
        throw Error("Start a Binance depth feed before recording.");
      await this.history.initialize();
      const meta = await this.history.create({
        name: name.trim(),
        symbol: this.depth.symbol,
        levels,
        intervalSeconds,
      });
      this.generation++;
      this.buffer = [];
      this.previous = null;
      this.state = { active: true, status: "recording", error: null, meta };
      await this.capture();
      this.schedule();
      return this.status();
    });
  }
  schedule() {
    if (this.state.active) {
      const generation = this.generation;
      this.timer = this.clock.setTimeout(() => {
        this.serial(async () => {
          if (generation !== this.generation || !this.state.active) return;
          await this.capture();
          this.schedule();
        }).catch(() => {});
      }, this.state.meta.intervalSeconds * 1000);
      this.timer?.unref?.();
    }
  }
  async flush() {
    if (!this.buffer.length) return;
    this.state.meta = await this.history.append(
      this.state.meta.id,
      this.buffer,
    );
    this.buffer = [];
  }
  async capture() {
    if (!this.state.active) return;
    try {
      const meta = this.state.meta;
      if (!this.depth.active || this.depth.symbol !== meta.symbol) {
        await this.finish("stopped", "Depth feed stopped or changed symbol.");
        return;
      }
      const at = this.now();
      if (at < meta.startedAt || (this.previous && at <= this.previous.at)) {
        await this.finish(
          "stopped",
          "System clock moved backwards; start a new recording.",
        );
        return;
      }
      const s = this.depth.snapshot({ limit: meta.levels });
      let gapBefore = null;
      if (this.previous && at - this.previous.at > meta.intervalSeconds * 1500)
        gapBefore = {
          from: this.previous.at + meta.intervalSeconds * 1000,
          to: at,
          reason:
            "Sampling interrupted (sleep, busy storage or paused process).",
        };
      if (
        this.previous?.book &&
        !s.stale &&
        this.previous.book.connection !== s.connection
      )
        gapBefore = {
          from: this.previous.at,
          to: at,
          reason: "Book resynchronized between samples.",
        };
      const frame = {
        at,
        gapBefore,
        book: s.stale ? null : s,
        reason: s.stale
          ? (s.error ?? `Depth ${s.status}; no fresh synchronized book.`)
          : null,
      };
      validateDepthFrame(frame, meta);
      this.buffer.push(frame);
      this.previous = frame;
      if (this.buffer.length >= 10 || !meta.count) await this.flush();
      if (this.state.meta.count + this.buffer.length >= 3600)
        await this.finish("complete", "3600-sample capacity reached.");
    } catch (error) {
      await this.fail(error);
    }
  }
  async fail(error) {
    this.generation++;
    this.clock.clearTimeout(this.timer);
    this.state.active = false;
    this.state.status = "error";
    this.state.error = error.message;
    this.buffer = [];
    if (this.state.meta)
      try {
        this.state.meta = await this.history.finish(
          this.state.meta.id,
          "error",
          error.message,
        );
      } catch {
        /* Preserve the original error; startup marks an unclosed manifest interrupted. */
      }
  }
  async finish(status, reason) {
    this.generation++;
    this.clock.clearTimeout(this.timer);
    this.state.active = false;
    await this.flush();
    this.state.meta = await this.history.finish(
      this.state.meta.id,
      status,
      reason,
    );
    this.state.status = status;
  }
  stop(reason = "Stopped by user.") {
    return this.serial(async () => {
      if (this.state.active)
        try {
          await this.finish("stopped", reason);
        } catch (e) {
          await this.fail(e);
        }
      return this.status();
    });
  }
}
