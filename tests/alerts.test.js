import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  AlertEngine,
  validateAlertRule,
  inAlertSession,
} from "../core/alerts.js";
import { MarketQuotes } from "../core/market-quotes.js";
import { QuoteSubscriptions } from "../core/quote-subscriptions.js";

const rule = (extra = {}) => ({
  name: "Bitcoin breakout",
  symbol: "BTCUSDT",
  direction: "above",
  price: 100,
  cooldownSeconds: 5,
  once: true,
  enabled: true,
  expiresAt: null,
  session: null,
  ...extra,
});
async function fixture(t, { repository, notify } = {}) {
  let now = Date.UTC(2026, 9, 28, 10),
    saved = null;
  const sockets = [],
    notifications = [],
    timers = new Set();
  const clock = {
    setInterval: (fn) => {
      timers.add(fn);
      return fn;
    },
    clearInterval: (fn) => timers.delete(fn),
    setTimeout: (fn) => {
      timers.add(fn);
      return fn;
    },
    clearTimeout: (fn) => timers.delete(fn),
  };
  repository ??= {
    read: async () => structuredClone(saved),
    write: async (doc) => {
      saved = structuredClone(doc);
    },
  };
  const feed = new MarketQuotes({
    maxSymbols: 100,
    now: () => now,
    clock,
    createSocket: (url) => {
      const socket = new EventEmitter();
      socket.url = url;
      socket.terminate = () => socket.emit("close");
      sockets.push(socket);
      queueMicrotask(() => socket.emit("open"));
      return socket;
    },
  });
  const hub = new QuoteSubscriptions(feed);
  const engine = new AlertEngine({
    repository,
    quotes: hub,
    now: () => now,
    clock,
    notify:
      notify ??
      ((event) => {
        assert.ok(
          saved.history.some((e) => e.id === event.id),
          "history must persist before OS delivery",
        );
        notifications.push(event);
        return "submitted";
      }),
  });
  t.after(async () => {
    await engine.close();
    hub.stop();
  });
  await engine.initialize();
  return {
    engine,
    feed,
    hub,
    sockets,
    notifications,
    repository,
    clock,
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
    saved: () => saved,
    send: async (price, { symbol = "BTCUSDT", step = 1000, eventAt } = {}) => {
      now += step;
      sockets.at(-1).emit(
        "message",
        JSON.stringify({
          e: "24hrTicker",
          s: symbol,
          E: eventAt ?? now,
          c: String(price),
          P: "0",
        }),
      );
      await engine.queue;
    },
  };
}
test("crossings require a baseline and persist one-shot evidence before notifications", async (t) => {
  const f = await fixture(t),
    r = await f.engine.save(rule());
  assert.equal(f.feed.active, false);
  await f.engine.configure({ monitoring: true, notifications: true });
  await f.send(101);
  assert.equal(f.engine.history().total, 0);
  await f.send(99);
  await f.send(100);
  const event = f.engine.history().events[0];
  assert.equal(event.previousPrice, 99);
  assert.equal(event.price, 100);
  assert.equal(event.threshold, 100);
  assert.equal(event.notification, "submitted");
  assert.equal(f.notifications.length, 1);
  assert.equal(f.saved().rules[0].enabled, false);
  assert.equal(f.saved().rules[0].id, r.id);
  assert.equal(f.hub.snapshot("alerts").active, false);
  await f.engine.acknowledge(event.id);
  assert.equal(f.engine.snapshot().unreadCount, 0);
  await f.engine.remove(r.id);
  assert.equal(f.engine.history().total, 1);
});
test("repeating rules consume cooldown crossings and require another genuine crossing", async (t) => {
  const f = await fixture(t);
  await f.engine.save(rule({ once: false }));
  await f.engine.configure({ monitoring: true, notifications: false });
  await f.send(99);
  await f.send(101);
  await f.send(99);
  await f.send(101); // in cooldown: consume, no delayed notification
  await f.send(102, { step: 5000 });
  assert.equal(f.engine.history().total, 1);
  await f.send(99);
  await f.send(100);
  assert.equal(f.engine.history().total, 2);
  assert.equal(f.engine.history().events[0].notification, "disabled");
  assert.equal(f.notifications.length, 0);
});
test("stale gaps, future events, reconnects and duplicate timestamps cannot create crossings", async (t) => {
  const f = await fixture(t);
  await f.engine.save(rule({ once: false, cooldownSeconds: 1 }));
  await f.engine.configure({ monitoring: true, notifications: false });
  await f.send(99);
  await f.send(101, { step: 31000 }); // missing interval
  assert.equal(f.engine.history().total, 0);
  await f.send(99);
  f.feed.connect(f.feed.generation); // real transport connection identity changes
  await f.send(101);
  assert.equal(f.engine.history().total, 0);
  await f.send(99);
  await f.send(101, { step: 0, eventAt: f.now() }); // duplicate E rejected by feed
  assert.equal(f.engine.history().total, 0);
  await f.send(101, { eventAt: f.now() + 60000 }); // future packet rejected by engine
  assert.equal(f.engine.history().total, 0);
  // A fresh connection clears the provider's invalid future timestamp watermark.
  f.hub.set("watchlist", ["ETHUSDT"]);
  await f.send(99);
  await f.send(101);
  assert.equal(f.engine.history().total, 1);
});
test("saved monitoring resumes with a new baseline and durable cooldown, never replaying notifications", async (t) => {
  const f = await fixture(t);
  await f.engine.save(rule({ once: false, cooldownSeconds: 60 }));
  await f.engine.configure({ monitoring: true, notifications: true });
  await f.send(99);
  await f.send(101);
  await f.engine.close();
  const restarted = new AlertEngine({
    repository: f.repository,
    quotes: f.hub,
    now: f.now,
    clock: f.clock,
    notify: () => {
      throw Error("Should not deliver again");
    },
  });
  t.after(() => restarted.close());
  await restarted.initialize();
  assert.equal(restarted.snapshot().monitoring, true);
  assert.equal(
    restarted.snapshot().rules[0].state,
    "waiting for fresh baseline",
  );
  const emit = async (price) => {
    f.advance(1000);
    f.sockets.at(-1).emit(
      "message",
      JSON.stringify({
        e: "24hrTicker",
        s: "BTCUSDT",
        E: f.now(),
        c: String(price),
        P: "0",
      }),
    );
    await restarted.queue;
  };
  await emit(99);
  await emit(101);
  assert.equal(restarted.history().total, 1);
  assert.equal(f.notifications.length, 1);
});
test("UTC sessions and expiry release subscriptions and establish new baselines", async (t) => {
  const f = await fixture(t);
  const session = { startMinuteUTC: 601, endMinuteUTC: 603, daysUTC: [3] }; // Wednesday
  await f.engine.save(
    rule({ session, expiresAt: f.now() + 150000, once: false }),
  );
  await f.engine.configure({ monitoring: true, notifications: false });
  assert.equal(f.engine.snapshot().rules[0].state, "outside session");
  f.advance(60000);
  f.engine.reconcile();
  await f.send(101); // entering session does not trigger on an already high price
  assert.equal(f.engine.history().total, 0);
  await f.send(99);
  await f.send(100);
  assert.equal(f.engine.history().total, 1);
  f.advance(100000);
  f.engine.reconcile();
  assert.equal(f.engine.snapshot().rules[0].state, "expired");
  assert.equal(f.hub.snapshot("alerts").active, false);
  assert.equal(
    inAlertSession(
      rule({
        session: { startMinuteUTC: 1320, endMinuteUTC: 120, daysUTC: [3] },
      }),
      Date.UTC(2026, 9, 28, 1),
    ),
    true,
  );
  assert.equal(
    inAlertSession(
      rule({
        session: { startMinuteUTC: 1320, endMinuteUTC: 120, daysUTC: [3] },
      }),
      Date.UTC(2026, 9, 29, 1),
    ),
    false,
  );
});
test("watchlist and alerts share symbols without stopping each other's subscriptions", async (t) => {
  const f = await fixture(t);
  f.hub.set("watchlist", ["BTCUSDT"]);
  await f.engine.save(rule({ once: false }));
  await f.engine.configure({ monitoring: true, notifications: false });
  assert.equal(f.sockets.length, 1);
  f.hub.set("watchlist", []);
  assert.equal(f.sockets.length, 1);
  assert.equal(f.hub.snapshot("watchlist").active, false);
  assert.equal(f.hub.snapshot("alerts").active, true);
  await f.send(99);
  await f.send(101);
  assert.equal(f.engine.history().total, 1);
  f.hub.set("watchlist", ["BTCUSDT"]);
  await f.engine.configure({ monitoring: false, notifications: false });
  assert.equal(f.hub.snapshot("watchlist").active, true);
});
test("storage failure stops alerts without sending undurable notifications or stopping watchlists", async (t) => {
  let saved = null,
    fail = false,
    sent = 0;
  const repository = {
    read: async () => saved,
    write: async (doc) => {
      if (fail) throw Error("disk full");
      saved = structuredClone(doc);
    },
  };
  const f = await fixture(t, {
    repository,
    notify: () => {
      sent++;
      return "submitted";
    },
  });
  f.hub.set("watchlist", ["BTCUSDT"]);
  await f.engine.save(rule());
  await f.engine.configure({ monitoring: true, notifications: true });
  await f.send(99);
  fail = true;
  await f.send(101);
  assert.equal(f.engine.snapshot().running, false);
  assert.match(f.engine.snapshot().error, /disk full/);
  assert.equal(sent, 0);
  assert.equal(saved.history.length, 0);
  assert.equal(f.hub.snapshot("watchlist").active, true);
  fail = false;
  await f.engine.configure({ monitoring: true, notifications: true });
  await f.send(101); // fresh baseline, not retrying undurable crossing
  assert.equal(sent, 0);
  await f.send(99);
  await f.send(101);
  assert.equal(sent, 1);
});
test("validation rejects ambiguous sessions, invalid prices, extra fields and corrupt persisted state", async (t) => {
  assert.throws(
    () => validateAlertRule(rule({ price: NaN })),
    /positive price/,
  );
  assert.throws(
    () => validateAlertRule(rule({ endpoint: "https://attacker" })),
    /Unknown/,
  );
  assert.throws(
    () =>
      validateAlertRule(
        rule({ session: { startMinuteUTC: 0, endMinuteUTC: 0, daysUTC: [0] } }),
      ),
    /UTC/,
  );
  let writes = 0;
  const f = await fixture(t, {
    repository: {
      read: async () => ({ version: 999 }),
      write: async () => {
        writes++;
      },
    },
  });
  assert.match(f.engine.snapshot().error, /could not be loaded/);
  await assert.rejects(f.engine.save(rule()), /could not be loaded/);
  assert.equal(writes, 0);
});
test("rule edits reset baselines; one-shot disabled state survives restart", async (t) => {
  const f = await fixture(t),
    r = await f.engine.save(rule());
  await f.engine.configure({ monitoring: true, notifications: false });
  await f.send(99);
  await f.engine.save(rule({ name: "Edited rule" }), r.id);
  await f.send(101);
  assert.equal(f.engine.history().total, 0);
  await f.send(99);
  await f.send(101);
  await f.engine.close();
  const restarted = new AlertEngine({
    repository: f.repository,
    quotes: f.hub,
    now: f.now,
    clock: f.clock,
  });
  t.after(() => restarted.close());
  await restarted.initialize();
  assert.equal(restarted.snapshot().rules[0].enabled, false);
  assert.equal(restarted.snapshot().rules[0].triggerCount, 1);
  assert.equal(restarted.history().total, 1);
});

test("rule count and retained history are bounded without losing per-rule trigger counts", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 100; i++)
    await f.engine.save(
      rule({ name: `Rule ${i}`, once: false, cooldownSeconds: 1 }),
    );
  await assert.rejects(f.engine.save(rule()), /100 alert rules/);
  await f.engine.configure({ monitoring: true, notifications: false });
  for (let i = 0; i < 11; i++) {
    await f.send(99);
    await f.send(101);
  }
  const history = f.engine.history({ limit: 1000 });
  assert.equal(history.total, 1000);
  assert.equal(new Set(history.events.map((e) => e.id)).size, 1000);
  assert.ok(f.engine.snapshot().rules.every((r) => r.triggerCount === 11));
  assert.equal(f.saved().history.length, 1000);
});
