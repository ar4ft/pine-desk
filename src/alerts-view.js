const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const stamp = (v) => (v ? new Date(v).toLocaleString() : "—");
const number = (v) =>
  Number.isFinite(v)
    ? v.toLocaleString(undefined, { maximumFractionDigits: 8 })
    : "—";
const freshDraft = () => ({
  name: "",
  symbol: "BTCUSDT",
  direction: "above",
  price: "",
  cooldownSeconds: 300,
  once: true,
  enabled: true,
  expiry: "",
  sessionEnabled: false,
  start: "09:30",
  end: "16:00",
  days: [0, 1, 2, 3, 4, 5, 6],
});
export const newAlertsState = () => ({
  status: null,
  history: { events: [], total: 0 },
  editing: null,
  draft: freshDraft(),
});
export function retainAlertDraft(state) {
  if (state.resetDraft) {
    state.resetDraft = false;
    return;
  }
  if (!$("#alert-name")) return;
  state.draft = {
    name: $("#alert-name").value,
    symbol: $("#alert-symbol").value,
    direction: $("#alert-direction").value,
    price: $("#alert-price").value,
    cooldownSeconds: $("#alert-cooldown").value,
    once: $("#alert-once").checked,
    enabled: $("#alert-enabled").checked,
    expiry: $("#alert-expiry").value,
    sessionEnabled: $("#alert-session").checked,
    start: $("#alert-start").value,
    end: $("#alert-end").value,
    days: [...document.querySelectorAll("[data-alert-day]:checked")].map((el) =>
      Number(el.dataset.alertDay),
    ),
  };
}
export function primeAlert(state, dataset) {
  state.editing = null;
  state.draft = {
    ...freshDraft(),
    symbol: /Binance/.test(dataset.origin) ? dataset.symbol : "BTCUSDT",
    price: /Binance/.test(dataset.origin) ? dataset.bars.at(-1).close : "",
  };
  state.resetDraft = true;
}
function monitoringView(s) {
  if (!s) return '<p role="status">Loading saved alerts…</p>';
  return `<div class="alerts-monitor"><div><span class="eyebrow">LOCAL MONITOR</span><h2>${s.running ? "Monitoring enabled" : s.error ? "Monitoring needs attention" : "Monitoring paused"}</h2><p>${s.rules.filter((r) => r.enabled).length} enabled rules · ${esc(s.feed.status)} · ${s.feed.symbols.length} subscribed markets · ${s.unreadCount} unreviewed events</p></div><div><label><input type="checkbox" id="alerts-notifications" ${s.notifications ? "checked" : ""}>Request desktop notifications</label><button id="alerts-toggle" class="primary">${s.running ? "Pause monitoring" : "Start monitoring"}</button></div></div>${s.error ? `<p class="alerts-error" role="alert">${esc(s.error)}</p>` : ""}${s.feed.error ? `<p class="alerts-error" role="alert">${esc(s.feed.error)}</p>` : ""}<p class="footnote">Monitoring resumes when you reopen the app if left enabled. Keep Pine Desk running and your Mac awake. No monitoring while the app is quit or the Mac sleeps. Notifications also depend on macOS permissions and Focus.</p>`;
}
function rulesView(status) {
  const rules = status?.rules ?? [];
  return rules.length
    ? `<div class="alert-rules">${rules.map((r) => `<article class="alert-rule"><div><strong>${esc(r.name)}</strong><span class="tag">${esc(r.state)}</span></div><p>${esc(r.symbol)} crosses ${r.direction === "above" ? "up to" : "down to"} <strong>${number(r.price)}</strong> · Binance spot</p><p class="footnote">${r.once ? "One-shot" : `Repeating · ${r.cooldownSeconds}s cooldown`} · ${r.triggerCount} triggers${r.expiresAt ? " · expires " + esc(stamp(r.expiresAt)) : ""}${r.session ? " · UTC session" : ""}<br>Baseline ${number(r.baseline)} · last trigger ${esc(stamp(r.lastTriggeredAt))}</p><div class="editor-tools"><button data-alert-edit="${esc(r.id)}">Edit</button><button data-alert-enable="${esc(r.id)}">${r.enabled ? "Disable" : "Enable"}</button><button data-alert-delete="${esc(r.id)}">Delete</button></div></article>`).join("")}</div>`
    : '<div class="alerts-empty"><h3>No alert rules yet</h3><p>Create a price crossing to monitor without keeping its chart open.</p></div>';
}
function historyView(history) {
  if (!history.events.length)
    return '<p class="footnote">No recorded triggers. The first fresh quote establishes a baseline; a rule fires on a later observed crossing.</p>';
  return `<p class="footnote">Showing ${history.events.length} of ${history.total} retained events (latest 1,000 maximum). Times below use your local timezone. “Submitted” means sent to the OS, not confirmed displayed.</p><div class="alerts-table"><table><thead><tr><th>Observed crossing</th><th>Evidence</th><th>Delivery</th><th>Review</th></tr></thead><tbody>${history.events.map((e) => `<tr><td><strong>${esc(e.name)}</strong><br>${esc(e.symbol)} · ${esc(stamp(e.eventAt))}</td><td>${number(e.previousPrice)} → ${number(e.price)}<br><small>${esc(e.direction)} ${number(e.threshold)} · Binance ticker</small></td><td>${esc(e.notification === "pending" ? "Delivery unconfirmed" : e.notification)}<br><small>Recorded ${esc(stamp(e.triggeredAt))}</small></td><td>${e.acknowledgedAt ? "Reviewed" : `<button data-alert-ack="${esc(e.id)}">Mark reviewed</button>`}</td></tr>`).join("")}</tbody></table></div>`;
}
export function alertsView(state) {
  const d = state.draft;
  return `<section class="plot-card alerts-status" id="alerts-status">${monitoringView(state.status)}</section><div class="alerts-grid"><section class="plot-card alert-form"><div class="panel-heading"><span>${state.editing ? "Edit rule" : "New price alert"}</span><span>Binance spot</span></div><form id="alert-form"><label>Name<input id="alert-name" value="${esc(d.name)}" maxlength="100" placeholder="Bitcoin breakout" required></label><div class="alert-fields"><label>Symbol<input id="alert-symbol" value="${esc(d.symbol)}" maxlength="24" required></label><label>Direction<select id="alert-direction"><option value="above" ${d.direction === "above" ? "selected" : ""}>Crosses above</option><option value="below" ${d.direction === "below" ? "selected" : ""}>Crosses below</option></select></label></div><div class="alert-fields"><label>Price (quote asset)<input id="alert-price" type="number" step="any" min="0.00000001" value="${esc(d.price)}" required></label><label>Cooldown (seconds)<input id="alert-cooldown" type="number" min="1" max="604800" value="${esc(d.cooldownSeconds)}" required></label></div><div class="alert-checks"><label><input id="alert-once" type="checkbox" ${d.once ? "checked" : ""}>One-shot</label><label><input id="alert-enabled" type="checkbox" ${d.enabled ? "checked" : ""}>Enabled</label></div><label>Expiry (optional, local time)<input id="alert-expiry" type="datetime-local" value="${esc(d.expiry)}"></label><label class="alert-checks"><input id="alert-session" type="checkbox" ${d.sessionEnabled ? "checked" : ""}>Limit to a UTC session</label><fieldset id="alert-session-fields" ${d.sessionEnabled ? "" : "disabled"}><div class="alert-fields"><label>Start UTC<input id="alert-start" type="time" value="${esc(d.start)}"></label><label>End UTC<input id="alert-end" type="time" value="${esc(d.end)}"></label></div><div class="alert-days">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => `<label><input type="checkbox" data-alert-day="${i}" ${d.days.includes(i) ? "checked" : ""}>${day}</label>`).join("")}</div><small>Weekdays refer to the event’s UTC calendar day, including overnight windows.</small></fieldset><div class="editor-tools"><button type="submit" id="alert-save" class="primary">${state.editing ? "Save changes" : "Create alert"}</button>${state.editing ? '<button type="button" id="alert-cancel">Cancel edit</button>' : ""}</div><p class="footnote">A crossing compares two fresh ticker observations. Reconnects, stale gaps, rule edits and session starts establish a new baseline. Crossings during cooldown are skipped, not delayed.</p></form></section><section class="plot-card"><div class="panel-heading"><span>Saved rules</span><span>Up to 100 rules / 50 markets</span></div><div id="alert-rules">${rulesView(state.status)}</div></section></div><section class="plot-card alerts-history"><div class="panel-heading"><span>Trigger history</span><button id="alert-export">Export retained history</button></div><div id="alert-history">${historyView(state.history)}</div></section>`;
}
export async function refreshAlerts(state, call) {
  const [status, history] = await Promise.all([
    call("alertStatus"),
    call("alertHistory", { limit: 100 }),
  ]);
  state.status = status;
  state.history = history;
}
export function paintAlerts(state, bind) {
  if (!$("#alerts-status")) return;
  $("#alerts-status").innerHTML = monitoringView(state.status);
  $("#alert-rules").innerHTML = rulesView(state.status);
  $("#alert-history").innerHTML = historyView(state.history);
  bind();
}
const definition = (r) =>
  Object.fromEntries(
    [
      "name",
      "symbol",
      "direction",
      "price",
      "cooldownSeconds",
      "once",
      "enabled",
      "expiresAt",
      "session",
    ].map((k) => [k, r[k]]),
  );
const minute = (s) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
const hhmm = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
function localDate(time) {
  const d = new Date(time);
  return new Date(time - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function bindAlerts({ state, call, task, render, toast, exportFile }) {
  const on = (id, fn) => {
    if ($("#" + id)) $("#" + id).onclick = () => task(fn);
  };
  const refresh = async () => {
    await refreshAlerts(state, call);
    render();
  };
  on("alerts-toggle", async () => {
    await call("alertConfigure", {
      monitoring: !state.status?.running,
      notifications: $("#alerts-notifications").checked,
    });
    await refresh();
  });
  if ($("#alerts-notifications"))
    $("#alerts-notifications").onchange = () =>
      task(async () => {
        await call("alertConfigure", {
          monitoring: !!state.status.monitoring,
          notifications: $("#alerts-notifications").checked,
        });
        await refresh();
      });
  if ($("#alert-session"))
    $("#alert-session").onchange = () => {
      $("#alert-session-fields").disabled = !$("#alert-session").checked;
    };
  if ($("#alert-form"))
    $("#alert-form").onsubmit = (event) => {
      event.preventDefault();
      task(async () => {
        retainAlertDraft(state);
        const d = state.draft;
        await call(state.editing ? "alertUpdate" : "alertCreate", {
          ...(state.editing ? { id: state.editing } : {}),
          rule: {
            name: d.name,
            symbol: d.symbol,
            direction: d.direction,
            price: Number(d.price),
            cooldownSeconds: Number(d.cooldownSeconds),
            once: d.once,
            enabled: d.enabled,
            expiresAt: d.expiry ? new Date(d.expiry).getTime() : null,
            session: d.sessionEnabled
              ? {
                  startMinuteUTC: minute(d.start),
                  endMinuteUTC: minute(d.end),
                  daysUTC: d.days,
                }
              : null,
          },
        });
        state.editing = null;
        state.draft = freshDraft();
        state.resetDraft = true;
        await refresh();
        toast("Alert saved. Monitoring uses fresh ticker crossings.");
      });
    };
  on("alert-cancel", () => {
    state.editing = null;
    state.draft = freshDraft();
    state.resetDraft = true;
    render();
  });
  document.querySelectorAll("[data-alert-edit]").forEach(
    (el) =>
      (el.onclick = () =>
        task(() => {
          const r = state.status.rules.find(
            (r) => r.id === el.dataset.alertEdit,
          );
          state.editing = r.id;
          state.draft = {
            ...freshDraft(),
            ...definition(r),
            expiry: r.expiresAt ? localDate(r.expiresAt) : "",
            sessionEnabled: !!r.session,
            start: r.session ? hhmm(r.session.startMinuteUTC) : "09:30",
            end: r.session ? hhmm(r.session.endMinuteUTC) : "16:00",
            days: r.session?.daysUTC ?? [0, 1, 2, 3, 4, 5, 6],
          };
          state.resetDraft = true;
          render();
          $("#alert-name").focus();
        })),
  );
  document.querySelectorAll("[data-alert-enable]").forEach(
    (el) =>
      (el.onclick = () =>
        task(async () => {
          const r = state.status.rules.find(
            (r) => r.id === el.dataset.alertEnable,
          );
          await call("alertUpdate", {
            id: r.id,
            rule: { ...definition(r), enabled: !r.enabled },
          });
          await refresh();
        })),
  );
  document.querySelectorAll("[data-alert-delete]").forEach(
    (el) =>
      (el.onclick = () =>
        task(async () => {
          await call("alertDelete", { id: el.dataset.alertDelete });
          if (state.editing === el.dataset.alertDelete) {
            state.editing = null;
            state.draft = freshDraft();
            state.resetDraft = true;
          }
          await refresh();
        })),
  );
  document.querySelectorAll("[data-alert-ack]").forEach(
    (el) =>
      (el.onclick = () =>
        task(async () => {
          await call("alertAcknowledge", { id: el.dataset.alertAck });
          await refresh();
        })),
  );
  on("alert-export", async () => {
    const data = await call("alertHistory", { limit: 1000 });
    await exportFile(
      "pine-desk-alert-history.json",
      JSON.stringify(data, null, 2),
    );
  });
}
