const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (value, digits = 8) =>
  Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: digits })
    : "—";
export const newDepthState = () => ({
  symbol: "BTCUSDT",
  limit: 20,
  snapshot: null,
  polling: false,
  revision: 0,
});
export function retainDepthDraft(state) {
  const input = document.querySelector("#depth-symbol");
  if (input) state.symbol = input.value;
}
export function depthView(state) {
  return `<section class="depth-workspace" aria-label="Live depth of market">
    <div class="page-intro"><span class="eyebrow">RESTING LIQUIDITY · BINANCE SPOT</span><h1>Inside the order book.</h1><p>Live bids and asks, synchronized with the exchange. Quantities are displayed resting orders, which can change or cancel before a trade.</p></div>
    <div class="searchbar depth-controls"><label>Binance spot symbol<input id="depth-symbol" value="${esc(state.symbol)}" maxlength="24" spellcheck="false"></label>
    <label>Levels per side<select id="depth-limit">${[10, 20, 50, 100].map((n) => `<option ${n === state.limit ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <button id="depth-start" class="primary">Start depth</button><button id="depth-stop">Stop depth</button></div>
    <p id="depth-status" role="status">Depth is stopped. Start a public Binance spot feed; no API key is required.</p>
    <div id="depth-content">${depthContent(state)}</div>
    <p class="footnote">Prices use the pair’s quote asset; sizes and cumulative totals use its base asset. Imbalance compares only the displayed levels. This feed runs independently of candles and executed trades. It stays on while navigating, and stops when the owning app/service quits. Historical depth recording and order entry are not available here.</p>
  </section>`;
}
function depthContent(state) {
  const s = state.snapshot;
  if (
    !s ||
    s.stale ||
    Date.now() - s.receivedAt > 5000 ||
    Date.now() - s.eventAt > 5000 ||
    !s.bids.length ||
    !s.asks.length
  )
    return `<div class="empty-state depth-empty"><h2>${s?.active ? "Waiting for synchronized depth" : "A live view of resting liquidity"}</h2><p>${s?.active ? "Fresh levels will appear after the snapshot and stream agree. Stale prices are hidden." : "Start depth to see the bid/ask ladder, spread and cumulative quantities."}</p></div>`;
  const bidShare = (s.imbalance + 1) * 50;
  const ladder = (side, title) => {
    const rows = s[side],
      max = Math.max(
        ...s.bids.map((r) => r.size),
        ...s.asks.map((r) => r.size),
      );
    return `<section class="plot-card depth-ladder ${side}" aria-label="${title}"><div class="panel-heading"><span>${title}</span><span>${rows.length} levels · best first</span></div><div class="table-wrap"><table><thead><tr><th scope="col">Price</th><th scope="col">Size</th><th scope="col">Cumulative</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${fmt(r.price)}</td><td><span class="depth-size-bar" style="width:${(r.size / max) * 100}%"></span><span>${fmt(r.size)}</span></td><td>${fmt(r.cumulative)}</td></tr>`).join("")}</tbody></table></div></section>`;
  };
  return `<div class="depth-identity"><strong>${esc(s.symbol)}</strong><span class="tag">Binance spot · live</span><span>Sequence ${s.lastUpdateId}</span></div>
    <div class="metrics depth-metrics"><div><span>Mid price</span><strong>${fmt(s.mid)}</strong></div><div><span>Spread · quote asset</span><strong>${fmt(s.spread)}</strong><small>${fmt(s.spreadBps, 4)} bps</small></div><div><span>Displayed bid size</span><strong class="positive">${fmt(s.bidSize)}</strong></div><div><span>Displayed ask size</span><strong class="negative">${fmt(s.askSize)}</strong></div><div><span>Displayed imbalance</span><strong>${fmt(s.imbalance * 100, 2)}%</strong><small>(bid − ask) / (bid + ask)</small></div></div>
    <div class="depth-balance" aria-label="Displayed bid share ${fmt(bidShare, 1)} percent"><span style="width:${bidShare}%"></span></div>
    <section class="plot-card depth-curve"><div class="panel-heading"><span>CUMULATIVE DISPLAYED DEPTH</span><span>Base asset quantity · distance from mid (bps)</span></div>${depthCurve(s)}</section>
    <div class="depth-ladders">${ladder("bids", "Bids · buyers")}${ladder("asks", "Asks · sellers")}</div>
    <p class="footnote">Known snapshot range: ${fmt(s.coverage.bidFloor)} — ${fmt(s.coverage.askCeiling)}. Tracking ${s.coverage.bidLevels} bid and ${s.coverage.askLevels} ask levels inside that range; showing up to ${state.limit} on each side. Levels outside the snapshot range are excluded; this is not the full exchange book.</p>`;
}
function depthCurve(s) {
  const width = 900,
    left = 60,
    right = 880,
    top = 16,
    bottom = 150;
  const distance = Math.max(
    s.mid - s.bids.at(-1).price,
    s.asks.at(-1).price - s.mid,
  );
  const max = Math.max(s.bidSize, s.askSize);
  const x = (p) => left + (((p - s.mid) / distance + 1) / 2) * (right - left);
  const y = (q) => bottom - (q / max) * (bottom - top);
  const curve = (rows, side) => {
    let d = `M ${x(rows[0].price)} ${bottom}`;
    for (const row of rows) d += ` H ${x(row.price)} V ${y(row.cumulative)}`;
    return `<path class="${side}" d="${d}"/>`;
  };
  return `<svg viewBox="0 0 ${width} 185" role="img" aria-label="Cumulative displayed bid and ask depth, in base asset units"><line x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}"/><line x1="${x(s.mid)}" x2="${x(s.mid)}" y1="${top}" y2="${bottom}"/><text x="${left - 8}" y="${top + 5}" text-anchor="end">${fmt(max, 3)}</text><text x="${left - 8}" y="${bottom}" text-anchor="end">0</text>${curve(s.bids, "bids")}${curve(s.asks, "asks")}<text x="${left}" y="175">−${fmt((distance / s.mid) * 10000, 2)} bps</text><text x="${x(s.mid)}" y="175" text-anchor="middle">Mid</text><text x="${right}" y="175" text-anchor="end">+${fmt((distance / s.mid) * 10000, 2)} bps</text></svg>`;
}
export function paintDepth(state) {
  const status = document.querySelector("#depth-status"),
    s = state.snapshot;
  if (!status || !s) return;
  status.textContent = `${s.symbol ?? "Binance spot"} · ${s.status}${s.active && s.stale ? " · no fresh synchronized book" : ""} · ${s.resyncs} resynchronizations${s.eventAt ? " · last exchange event " + new Date(s.eventAt).toLocaleTimeString() : ""}${s.error ? " · " + s.error : ""}`;
  const scroll = [
    ...document.querySelectorAll(".depth-ladder .table-wrap"),
  ].map((el) => el.scrollTop);
  document.querySelector("#depth-content").innerHTML = depthContent(state);
  document.querySelectorAll(".depth-ladder .table-wrap").forEach((el, i) => {
    el.scrollTop = scroll[i] ?? 0;
  });
  document.querySelector("#depth-start").textContent = s.active
    ? "Apply symbol"
    : "Start depth";
  document.querySelector("#depth-stop").disabled = !s.active;
}
export async function pollDepth(state, call, canPaint = () => true) {
  if (state.polling) return;
  state.polling = true;
  const revision = ++state.revision;
  try {
    const snapshot = await call("depthSnapshot", { limit: state.limit });
    if (revision !== state.revision) return;
    state.snapshot = snapshot;
    if (canPaint()) paintDepth(state);
  } catch (e) {
    if (revision === state.revision && canPaint()) {
      // Hide the last rendered book even when IPC, rather than the feed, fails.
      state.snapshot = null;
      const status = document.querySelector("#depth-status");
      if (status) {
        status.textContent = e.message;
        document.querySelector("#depth-content").innerHTML =
          depthContent(state);
      }
    }
  } finally {
    state.polling = false;
  }
}
export function bindDepth({ state, call, task }) {
  const start = document.querySelector("#depth-start");
  if (!start) return;
  const mutate = async (action, args) => {
    state.revision++;
    await call(action, args);
    state.revision++;
    state.snapshot = await call("depthSnapshot", { limit: state.limit });
    paintDepth(state);
  };
  start.onclick = () =>
    task(async () => {
      retainDepthDraft(state);
      state.symbol = state.symbol.trim().toUpperCase();
      document.querySelector("#depth-symbol").value = state.symbol;
      await mutate("depthStart", { symbol: state.symbol });
    });
  document.querySelector("#depth-stop").onclick = () =>
    task(() => mutate("depthStop"));
  document.querySelector("#depth-limit").onchange = () =>
    task(async () => {
      state.limit = Number(document.querySelector("#depth-limit").value);
      state.revision++;
      state.snapshot = await call("depthSnapshot", { limit: state.limit });
      paintDepth(state);
    });
  paintDepth(state);
}
