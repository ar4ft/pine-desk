import { depthHeatmap } from "../core/depth-heatmap.js";
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (n) =>
  Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: 8 })
    : "—";
const time = (at) => new Date(at).toLocaleString();
export const newDepthHistoryState = () => ({
  status: null,
  list: [],
  record: null,
  id: null,
  index: 0,
  follow: true,
  playing: false,
  speed: 1,
  revision: 0,
  polling: false,
  name: "Depth recording",
  levels: 50,
  intervalSeconds: 1,
});
export function retainDepthHistoryDraft(s) {
  for (const [id, key] of [
    ["depth-record-name", "name"],
    ["depth-record-levels", "levels"],
    ["depth-record-interval", "intervalSeconds"],
  ]) {
    const el = document.getElementById(id);
    if (el) s[key] = key === "name" ? el.value : Number(el.value);
  }
}
export function depthHistoryView(s) {
  return `<section class="depth-history" aria-label="Recorded liquidity">
  <div class="page-intro"><span class="eyebrow">LOCAL DEPTH ARCHIVE</span><h1>Watch liquidity through time.</h1><p>Record sampled resting bids and asks from the active Binance depth feed. Replay keeps missing observations and book resets visible.</p></div>
  <div class="searchbar"><label>Recording name<input id="depth-record-name" maxlength="100" value="${esc(s.name)}"></label><label>Levels per side<select id="depth-record-levels">${[10, 20, 50, 100].map((n) => `<option ${s.levels === n ? "selected" : ""}>${n}</option>`).join("")}</select></label><label>Sample interval<select id="depth-record-interval">${[1, 2, 5, 10].map((n) => `<option value="${n}" ${s.intervalSeconds === n ? "selected" : ""}>${n}s</option>`).join("")}</select></label><button id="depth-record-start" class="primary">Record current depth</button><button id="depth-record-stop">Stop recording</button></div>
  <p id="depth-record-status" role="status">Start a feed under Live order book / DOM, then record here.</p>
  <div class="searchbar"><label>Saved recording<select id="depth-history-select"><option value="">Choose a recording…</option></select></label><button id="depth-history-refresh">Refresh archive</button><label><input type="checkbox" id="depth-history-follow" ${s.follow ? "checked" : ""}> Follow active recording</label><button id="depth-history-export">Export window JSON</button><button id="depth-history-delete">Delete recording</button></div>
  <p id="depth-history-meta"></p>
  <section class="plot-card"><div class="panel-heading"><span>SAMPLED RESTING SIZE · BASE ASSET</span><span>Green: bids · red: asks · hatched: missing/reset</span></div><canvas id="depth-heatmap" height="350" role="img" aria-label="Recorded liquidity heatmap"></canvas><p id="depth-heatmap-hint" class="footnote">Select an archive or start recording. Color intensity uses log(1 + size), scaled to the largest cell in this window. Blank areas do not establish zero exchange liquidity.</p></section>
  <div class="searchbar depth-replay-controls"><button id="depth-history-older">← Older window</button><button id="depth-replay-play">Play</button><label>Speed<select id="depth-replay-speed">${[1, 5, 20].map((n) => `<option value="${n}" ${s.speed === n ? "selected" : ""}>${n}×</option>`).join("")}</select></label><label class="depth-scrub">Sample<input id="depth-replay-scrub" aria-label="Replay sample" type="range" min="0" max="0" value="0"></label><button id="depth-history-newer">Newer window →</button></div>
  <div id="depth-replay-detail"></div>
  <p class="footnote">One recording at a time; up to 3,600 samples, 30 recordings and 250 MB compressed storage. The first sample is saved immediately, then batches of 10; stopping flushes pending samples. App crashes can lose the uncommitted batch. Recording stops when the feed stops, changes symbol, or the app quits. Playback does not change live feeds, alerts or research data.</p>
</section>`;
}
export class DepthHistoryView {
  constructor({ state, call, task, exportFile, canPaint, busy = () => false }) {
    this.s = state;
    this.call = call;
    this.task = task;
    this.exportFile = exportFile;
    this.canPaint = canPaint;
    this.busy = busy;
  }
  async load(id, { offset, follow = false } = {}) {
    const s = this.s,
      rev = ++s.revision;
    s.playing = false;
    s.follow = follow;
    const record = await this.call("depthRecordingGet", {
      id,
      offset,
      limit: 300,
    });
    if (rev !== s.revision) return;
    s.id = id;
    s.record = record;
    s.follow = follow;
    s.index = follow ? Math.max(0, record.frames.length - 1) : 0;
    this.paint();
  }
  async poll() {
    const s = this.s;
    if (s.polling) return;
    s.polling = true;
    const rev = s.revision;
    try {
      const [status, list] = await Promise.all([
        this.call("depthRecordStatus"),
        this.call("depthRecordings"),
      ]);
      if (rev !== s.revision) return;
      s.status = status;
      s.list = list;
      if (
        s.follow &&
        status.meta?.count &&
        list.some((m) => m.id === status.meta.id) &&
        (s.id !== status.meta.id ||
          s.record?.total !== status.meta.count ||
          s.record?.meta.status !== status.meta.status)
      ) {
        await this.load(status.meta.id, { follow: true });
        return;
      }
      if (s.id && !list.some((m) => m.id === s.id)) {
        s.id = null;
        s.record = null;
        s.playing = false;
        s.follow = false;
      }
      if (s.record && !s.follow) {
        const meta = list.find((m) => m.id === s.id);
        if (meta) {
          s.record.meta = meta;
          s.record.total = meta.count;
        }
      }
      this.paint();
    } catch (e) {
      if (this.canPaint()) {
        document.querySelector("#depth-record-status").textContent = e.message;
      }
    } finally {
      s.polling = false;
    }
  }
  bind() {
    const s = this.s,
      on = (id, fn) => {
        document.getElementById(id).onclick = () => this.task(fn);
      };
    on("depth-record-start", async () => {
      retainDepthHistoryDraft(s);
      s.revision++;
      s.status = await this.call("depthRecordStart", {
        name: s.name,
        levels: s.levels,
        intervalSeconds: s.intervalSeconds,
      });
      s.follow = true;
      await this.poll();
    });
    on("depth-record-stop", async () => {
      s.revision++;
      s.status = await this.call("depthRecordStop");
      await this.poll();
    });
    on("depth-history-refresh", () => this.poll());
    document.getElementById("depth-history-select").onchange = () =>
      this.task(async () => {
        const id = document.getElementById("depth-history-select").value;
        if (id) await this.load(id);
      });
    document.getElementById("depth-history-follow").onchange = () => {
      s.revision++;
      s.follow = document.getElementById("depth-history-follow").checked;
      s.playing = false;
      this.poll();
    };
    on("depth-history-older", async () => {
      if (s.record)
        await this.load(s.id, { offset: Math.max(0, s.record.offset - 300) });
    });
    on("depth-history-newer", async () => {
      if (s.record)
        await this.load(s.id, {
          offset: Math.min(
            Math.max(0, s.record.total - 300),
            s.record.offset + 300,
          ),
        });
    });
    on("depth-history-export", () => {
      if (s.record)
        return this.exportFile(
          `depth-${s.id}-window-${s.record.offset}.json`,
          JSON.stringify(
            { format: "pine-desk-depth-window", version: 1, ...s.record },
            null,
            2,
          ),
        );
    });
    on("depth-history-delete", async () => {
      if (
        !s.id ||
        !window.confirm(
          "Permanently delete this depth recording and all its samples?",
        )
      )
        return;
      await this.call("depthRecordingDelete", { id: s.id });
      s.revision++;
      s.id = null;
      s.record = null;
      s.playing = false;
      s.follow = false;
      await this.poll();
    });
    document.getElementById("depth-replay-scrub").oninput = () => {
      s.revision++;
      s.index = Number(document.getElementById("depth-replay-scrub").value);
      s.follow = false;
      s.playing = false;
      this.paint();
    };
    document.getElementById("depth-replay-speed").onchange = () => {
      s.speed = Number(document.getElementById("depth-replay-speed").value);
      s.lastTick = Date.now();
    };
    document.getElementById("depth-replay-play").onclick = () => {
      if (!s.record?.frames.length) return;
      s.revision++;
      s.follow = false;
      if (s.index >= s.record.frames.length - 1) s.index = 0;
      s.playing = !s.playing;
      s.playbackAt = s.record.frames[s.index].at;
      s.lastTick = Date.now();
      this.paint();
    };
    const canvas = document.getElementById("depth-heatmap");
    canvas.onclick = (event) => {
      if (!s.record?.frames.length) return;
      s.revision++;
      const map = depthHeatmap(s.record),
        rect = canvas.getBoundingClientRect();
      const at =
        map.from +
        ((event.clientX - rect.left - 65) / (rect.width - 85)) *
          (map.to - map.from);
      s.index = s.record.frames.reduce(
        (best, f, i) =>
          Math.abs(f.at - at) < Math.abs(s.record.frames[best].at - at)
            ? i
            : best,
        0,
      );
      s.follow = false;
      s.playing = false;
      this.paint();
    };
    this.paint();
    this.poll();
  }
  tick() {
    const s = this.s;
    if (!this.canPaint()) {
      s.playing = false;
      return;
    }
    if (s.playing && s.record?.frames.length) {
      const now = Date.now();
      s.playbackAt += (now - s.lastTick) * s.speed;
      s.lastTick = now;
      while (
        s.index < s.record.frames.length - 1 &&
        s.record.frames[s.index + 1].at <= s.playbackAt
      )
        s.index++;
      if (s.index === s.record.frames.length - 1) s.playing = false;
      this.paint();
    }
  }
  controls() {
    if (!document.getElementById("depth-record-start")) return;
    const s = this.s,
      busy = this.busy(),
      r = s.record;
    document.getElementById("depth-record-start").disabled =
      busy || !!s.status?.active || !s.status?.feed.active;
    document.getElementById("depth-record-stop").disabled =
      busy || !s.status?.active;
    for (const id of [
      "depth-record-name",
      "depth-record-levels",
      "depth-record-interval",
    ])
      document.getElementById(id).disabled = busy || !!s.status?.active;
    for (const id of [
      "depth-history-select",
      "depth-history-refresh",
      "depth-history-follow",
    ])
      document.getElementById(id).disabled = busy;
    document.getElementById("depth-history-delete").disabled =
      busy || !r || (s.status?.active && s.status.meta.id === s.id);
    document.getElementById("depth-history-export").disabled =
      busy || !r?.frames.length;
    document.getElementById("depth-history-older").disabled =
      busy || !r || r.offset === 0;
    document.getElementById("depth-history-newer").disabled =
      busy || !r || r.offset + r.frames.length >= r.total;
  }
  paint() {
    if (!this.canPaint() || !document.getElementById("depth-heatmap")) return;
    const s = this.s,
      status = s.status,
      r = s.record;
    if (status)
      document.getElementById("depth-record-status").textContent =
        `${status.active ? "Recording" : "Recorder " + status.status} · ${status.feed.symbol ?? "no depth feed"} (${status.feed.status})${status.meta ? ` · ${status.meta.count} saved + ${status.pending} pending · ${status.meta.gaps} gap/reset samples` : ""}${status.error ? " · " + status.error : ""}`;
    const select = document.getElementById("depth-history-select");
    const signature = JSON.stringify(
      s.list.map((m) => [m.id, m.count, m.status]),
    );
    if (select.dataset.signature !== signature) {
      select.innerHTML =
        '<option value="">Choose a recording…</option>' +
        s.list
          .map(
            (m) =>
              `<option value="${m.id}">${esc(m.name)} · ${esc(m.symbol)} · ${m.count} samples · ${m.status}</option>`,
          )
          .join("");
      select.dataset.signature = signature;
    }
    select.value = s.id ?? "";
    document.getElementById("depth-history-follow").checked = s.follow;
    document.getElementById("depth-history-meta").textContent = r
      ? `${r.meta.name} · ${r.meta.symbol} · ${r.meta.levels} levels/side · every ${r.meta.intervalSeconds}s · ${r.meta.status} · samples ${r.frames.length ? r.offset + 1 : 0}–${r.offset + r.frames.length} of ${r.total}${r.meta.reason ? " · " + r.meta.reason : ""}`
      : "No archive selected.";
    document.getElementById("depth-replay-play").textContent = s.playing
      ? "Pause"
      : "Play";
    document.getElementById("depth-replay-play").disabled = !r?.frames.length;
    const scrub = document.getElementById("depth-replay-scrub");
    scrub.max = Math.max(0, (r?.frames.length ?? 1) - 1);
    scrub.value = s.index;
    this.controls();
    this.draw();
    const frame = r?.frames[s.index];
    document.getElementById("depth-replay-detail").innerHTML = frame
      ? `<h3>Recorded sample · ${esc(time(frame.at))}</h3>${frame.gapBefore ? `<p class="footnote">Gap before sample: ${esc(frame.gapBefore.reason)}</p>` : ""}${frame.book ? `<p>Sequence ${frame.book.lastUpdateId} · exchange ${esc(time(frame.book.eventAt))} · mid ${fmt(frame.book.mid)} · spread ${fmt(frame.book.spread)}</p><div class="table-wrap"><table><thead><tr><th>Bid price</th><th>Bid size</th><th>Ask price</th><th>Ask size</th></tr></thead><tbody>${Array.from({ length: Math.min(10, Math.max(frame.book.bids.length, frame.book.asks.length)) }, (_, i) => `<tr><td>${fmt(frame.book.bids[i]?.price)}</td><td>${fmt(frame.book.bids[i]?.size)}</td><td>${fmt(frame.book.asks[i]?.price)}</td><td>${fmt(frame.book.asks[i]?.size)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="negative">Missing depth: ${esc(frame.reason)}</p>`}`
      : '<p class="footnote">Select a time on the heatmap or move the sample slider to inspect recorded levels.</p>';
  }
  draw() {
    const canvas = document.getElementById("depth-heatmap"),
      s = this.s,
      rect = canvas.getBoundingClientRect(),
      dpr = window.devicePixelRatio || 1,
      w = Math.max(300, rect.width),
      h = 350;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#171c23";
    ctx.fillRect(0, 0, w, h);
    if (!s.record?.frames.length) return;
    const m = depthHeatmap(s.record),
      left = 65,
      right = w - 20,
      top = 22,
      bottom = h - 35,
      x = (at) => left + ((at - m.from) / (m.to - m.from)) * (right - left),
      y = (price) =>
        bottom - ((price - m.low) / (m.high - m.low)) * (bottom - top);
    document.getElementById("depth-heatmap-hint").textContent =
      `${m.rows} equal price bins · largest cell ${fmt(m.peak)} base units · log(1 + size) intensity within this window. Blank means no recorded size, not proven zero liquidity. Click to select the nearest recorded sample.`;
    const occupied = new Map();
    for (const cell of m.cells) {
      const key = cell.index + ":" + cell.row;
      occupied.set(key, (occupied.get(key) ?? 0) + 1);
    }
    for (const cell of m.cells) {
      const alpha = 0.18 + (0.82 * Math.log1p(cell.size)) / Math.log1p(m.peak);
      ctx.fillStyle =
        cell.side === "bids"
          ? `rgba(70,220,170,${alpha})`
          : `rgba(250,100,125,${alpha})`;
      const mixed = occupied.get(cell.index + ":" + cell.row) > 1;
      const half = (bottom - top) / m.rows / (mixed ? 2 : 1);
      ctx.fillRect(
        x(cell.from),
        y(cell.priceTo) + (mixed && cell.side === "asks" ? half : 0),
        Math.max(0, x(cell.to) - x(cell.from)),
        half,
      );
    }
    for (const gap of m.gaps) {
      const a = Math.max(left, x(gap.from)),
        b = Math.min(right, x(gap.to));
      ctx.fillStyle = "#65708055";
      ctx.fillRect(a, top, b - a, bottom - top);
      ctx.save();
      ctx.beginPath();
      ctx.rect(a, top, b - a, bottom - top);
      ctx.clip();
      ctx.strokeStyle = "#b8c1ce88";
      for (let k = a - (bottom - top); k < b; k += 9) {
        ctx.beginPath();
        ctx.moveTo(k, top);
        ctx.lineTo(k + bottom - top, bottom);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.fillStyle = "#d9e1ea";
    ctx.font = "11px system-ui";
    ctx.textAlign = "right";
    ctx.fillText(fmt(m.high), left - 6, top + 7);
    ctx.fillText(fmt(m.low), left - 6, bottom);
    ctx.textAlign = "left";
    ctx.fillText(new Date(m.from).toLocaleTimeString(), left, h - 12);
    ctx.textAlign = "right";
    ctx.fillText(new Date(m.to).toLocaleTimeString(), right, h - 12);
    const frame = s.record.frames[s.index];
    if (frame) {
      ctx.strokeStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(x(frame.at), top);
      ctx.lineTo(x(frame.at), bottom);
      ctx.stroke();
    }
  }
}
