import { randomUUID } from "node:crypto";
import * as store from "./store.js";
import { validateBars, durations } from "./data.js";
import {
  validateSource,
  validateInputs,
  validateSettings,
} from "./backtest.js";
export const defaultAppearance = {
  theme: "system",
  upColor: "#63dfbd",
  downColor: "#f17789",
  editorFontSize: 12,
};
export function validateAppearance(a) {
  if (
    !["system", "dark", "light"].includes(a?.theme) ||
    !/^#[a-fA-F0-9]{6}$/.test(a.upColor) ||
    !/^#[a-fA-F0-9]{6}$/.test(a.downColor) ||
    !Number.isInteger(a.editorFontSize) ||
    a.editorFontSize < 10 ||
    a.editorFontSize > 22
  )
    throw new Error(
      "Choose a theme, valid chart colors and an editor font size from 10 to 22.",
    );
  return {
    theme: a.theme,
    upColor: a.upColor,
    downColor: a.downColor,
    editorFontSize: a.editorFontSize,
  };
}
export function validateWatchlist(items) {
  if (!Array.isArray(items) || items.length > 50)
    throw new Error("Watchlists support up to 50 markets.");
  const seen = new Set();
  return items.map((i) => {
    const symbol = String(i.symbol ?? "")
        .trim()
        .toUpperCase(),
      provider = i.provider,
      timeframe = i.timeframe;
    if (
      !["binance", "unusualWhales"].includes(provider) ||
      !(
        provider === "binance" ? /^[A-Z0-9]{3,24}$/ : /^[A-Z][A-Z0-9.\-]{0,14}$/
      ).test(symbol) ||
      !(
        provider === "binance"
          ? Object.keys(durations)
          : ["1m", "5m", "15m", "1h", "4h"]
      ).includes(timeframe)
    )
      throw new Error("Invalid watchlist market or provider timeframe.");
    const key = `${provider}:${symbol}:${timeframe}`;
    if (seen.has(key)) throw new Error("Duplicate watchlist entry.");
    seen.add(key);
    return { symbol, provider, timeframe };
  });
}
export async function uiConfig() {
  return (
    (await store.read("ui-config")) ?? {
      appearance: defaultAppearance,
      watchlist: [],
    }
  );
}
export async function configureUI(args) {
  const old = await uiConfig();
  return store.write("ui-config", {
    appearance: args.appearance
      ? validateAppearance(args.appearance)
      : old.appearance,
    watchlist: args.watchlist
      ? validateWatchlist(args.watchlist)
      : old.watchlist,
  });
}
export function importScriptFile({ name, source }) {
  if (typeof name !== "string" || !/\.(pine|txt)$/i.test(name))
    throw new Error("Choose a .pine or .txt source file.");
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source, "utf8") > 200000 ||
    source.includes("\0")
  )
    throw new Error("Pine source must be plain UTF-8 text, up to 200 KB.");
  source = validateSource(source.replace(/^\uFEFF/, ""));
  return {
    id: randomUUID(),
    name:
      name
        .replace(/^.*[\\/]/, "")
        .replace(/\.(pine|txt)$/i, "")
        .slice(0, 100) || "Imported strategy",
    source,
    provenance: {
      filename: name.replace(/^.*[\\/]/, "").slice(0, 200),
      importedAt: Date.now(),
    },
    updatedAt: Date.now(),
  };
}
export function validateLayout(input) {
  if (!input || JSON.stringify(input).length > 25000000)
    throw new Error("Layout is too large.");
  const { snapshot: s } = input;
  if (
    !s ||
    typeof s.source !== "string" ||
    s.source.length > 200000 ||
    ![
      "workspace",
      "backtest",
      "library",
      "orderflow",
      "mcp",
      "edge",
      "whale",
      "options",
      "crypto",
      "education",
      "settings",
    ].includes(s.page) ||
    typeof s.editor !== "boolean"
  )
    throw new Error("Invalid layout.");
  const settings = Object.fromEntries(
    Object.entries(validateSettings(s.settings ?? {})).filter(([k]) =>
      [
        "initial_capital",
        "default_qty_value",
        "commission_value",
        "slippage",
        "pyramiding",
      ].includes(k),
    ),
  );
  let chart = null;
  if (s.chart) {
    const c = s.chart;
    if (
      typeof c.symbol !== "string" ||
      !durations[c.timeframe] ||
      !Array.isArray(c.indicators) ||
      c.indicators.length > 12
    )
      throw new Error("Invalid layout chart.");
    const range = c.range;
    if (
      range &&
      (!Number.isFinite(range.from) ||
        !Number.isFinite(range.to) ||
        range.to <= range.from)
    )
      throw new Error("Invalid chart range.");
    if (
      c.drawings &&
      (!Array.isArray(c.drawings.drawings) ||
        c.drawings.drawings.length > 500 ||
        JSON.stringify(c.drawings).length > 2000000)
    )
      throw new Error("Too many or invalid drawings.");
    if (
      c.panes &&
      (!Array.isArray(c.panes) ||
        c.panes.length > 13 ||
        c.panes.some(
          (p) =>
            !["price", "study"].includes(p.kind) ||
            !Number.isInteger(p.order) ||
            p.order < 0 ||
            p.order > 12 ||
            !Array.isArray(p.indices) ||
            p.indices.some(
              (i) => !Number.isInteger(i) || i < 0 || i >= c.indicators.length,
            ),
        ))
    )
      throw new Error("Invalid pane layout.");
    chart = {
      panes: (c.panes ?? []).map((p) => ({
        id: typeof p.id === "string" ? p.id.slice(0, 100) : null,
        kind: p.kind,
        order: p.order,
        indices: p.indices,
        collapsed: !!p.collapsed,
        maximized: !!p.maximized,
      })),
      symbol: c.symbol.slice(0, 40),
      timeframe: c.timeframe,
      range: range ?? null,
      drawings: c.drawings ?? null,
      indicators: c.indicators.map((i) => {
        if (i.source) validateSource(i.source);
        else if (
          typeof i.nativeType !== "string" ||
          i.nativeType.length > 80 ||
          i.nativeType === "pine-desk-options-levels"
        )
          throw new Error("Invalid native indicator.");
        return {
          source: i.source ?? null,
          nativeType: i.nativeType ?? null,
          inputs: validateInputs(i.inputs ?? {}),
          props: validateInputs(i.props ?? {}),
          visible: i.visible !== false,
        };
      }),
    };
  }
  let dataset = null;
  if (s.dataset) {
    if (!durations[s.dataset.timeframe])
      throw new Error("Invalid dataset timeframe.");
    dataset = {
      bars: validateBars(s.dataset.bars),
      symbol: String(s.dataset.symbol ?? "CSV").slice(0, 40),
      timeframe: s.dataset.timeframe,
      origin: String(s.dataset.origin ?? "Saved layout snapshot").slice(0, 200),
    };
  }
  return {
    name:
      String(input.name ?? "Untitled layout")
        .trim()
        .slice(0, 100) || "Untitled layout",
    snapshot: {
      page: s.page,
      editor: s.editor,
      source: s.source,
      name: String(s.name ?? "Untitled script").slice(0, 100),
      settings,
      inputs: typeof s.inputs === "string" ? s.inputs.slice(0, 20000) : "{}",
      tab: ["performance", "log", "analysis", "simulation"].includes(s.tab)
        ? s.tab
        : "performance",
      chart,
      dataset,
    },
  };
}
export async function saveLayout(input) {
  const validated = validateLayout(input),
    id = input.id ?? randomUUID();
  const existing = await store.list("layouts");
  if (existing.length >= 20 && !existing.some((x) => x.id === id))
    throw new Error("Keep up to 20 named layouts; delete an old layout first.");
  const saved = { id, ...validated, updatedAt: Date.now() };
  await store.write("layouts", saved, id);
  return saved;
}
export async function listLayouts() {
  return (await store.list("layouts"))
    .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function readLayout(id) {
  const saved = await store.read("layouts", id);
  if (!saved) throw new Error("Layout not found.");
  return { ...saved, ...validateLayout(saved) };
}
export async function deleteLayout(id) {
  await store.remove("layouts", id);
  return listLayouts();
}
