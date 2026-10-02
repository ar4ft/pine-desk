import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBars, durations } from "./data.js";
export function validateSource(source) {
  if (
    typeof source !== "string" ||
    source.length > 200000 ||
    !/^\s*\/\/@version=[56]\b/m.test(source)
  )
    throw new Error("Provide native Pine v5/v6 source (maximum 200 KB).");
  return source;
}
export function validateSettings(settings = {}) {
  const bounds = {
    initial_capital: [1, 1e9],
    default_qty_value: [0.01, 100],
    commission_value: [0, 10],
    slippage: [0, 10000],
    pyramiding: [0, 20],
  };
  for (const [key, value] of Object.entries(settings)) {
    if (
      !bounds[key] ||
      !Number.isFinite(value) ||
      value < bounds[key][0] ||
      value > bounds[key][1] ||
      (["slippage", "pyramiding"].includes(key) && !Number.isInteger(value))
    )
      throw new Error(`Invalid strategy setting: ${key}`);
  }
  return {
    ...settings,
    default_qty_type: "percent_of_equity",
    commission_type: "percent",
    process_orders_on_close: false,
  };
}
export function validateInputs(inputs = {}) {
  if (
    !inputs ||
    typeof inputs !== "object" ||
    Array.isArray(inputs) ||
    Object.keys(inputs).length > 50 ||
    Object.entries(inputs).some(
      ([key, value]) =>
        !key ||
        key.length > 100 ||
        !["string", "number", "boolean"].includes(typeof value) ||
        (typeof value === "number" && !Number.isFinite(value)) ||
        (typeof value === "string" && value.length > 1000),
    )
  )
    throw new Error(
      "Inputs must map Pine input titles/IDs to finite numbers, strings or booleans (maximum 50).",
    );
  return inputs;
}
export function runBacktest({
  bars,
  source,
  settings = {},
  inputs = {},
  timeframe = "1h",
  symbol = "CSV",
  timeoutMs = 30000,
  signal,
  warmupBars = 0,
  diagnostics = false,
}) {
  bars = validateBars(bars);
  source = validateSource(source);
  settings = validateSettings(settings);
  inputs = validateInputs(inputs);
  if (!durations[timeframe]) throw new Error("Unsupported timeframe.");
  return new Promise((resolve, reject) => {
    if (
      !Number.isInteger(warmupBars) ||
      warmupBars < 0 ||
      warmupBars > bars.length - 2
    )
      throw Error("Warmup must leave at least two trading bars.");
    const coreDir = fileURLToPath(new URL(".", import.meta.url));
    const root = path.dirname(coreDir.replace(/\/$/, ""));
    const safeEnv = {};
    for (const key of [
      "PATH",
      "SystemRoot",
      "WINDIR",
      "TEMP",
      "TMPDIR",
      "LANG",
    ])
      if (process.env[key]) safeEnv[key] = process.env[key];
    const worker = fork(new URL("./backtest-worker.js", import.meta.url), [], {
      execPath: process.execPath,
      execArgv: [
        "--permission",
        `--allow-fs-read=${coreDir}`,
        `--allow-fs-read=${path.join(root, "package.json")}`,
        `--allow-fs-read=${path.join(root, "node_modules/pinets/dist/pinets.min.browser.js")}`,
        "--max-old-space-size=512",
      ],
      env: { ...safeEnv, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      serialization: "json",
    });
    let stderr = "";
    worker.stderr.on("data", (data) => {
      stderr = (stderr + data).slice(-2000);
    });
    let timer,
      settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.kill("SIGKILL");
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(new Error("Research job cancelled."));
    timer = setTimeout(
      () =>
        finish(
          new Error(
            `Script exceeded the ${timeoutMs / 1000}-second execution limit.`,
          ),
        ),
      timeoutMs,
    );
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    worker.once("message", (msg) => {
      if (msg.ok) finish(null, msg.result);
      else {
        const error = new Error(msg.error);
        error.diagnostic = msg.diagnostic;
        finish(error);
      }
    });
    worker.once("error", (err) => finish(err));
    worker.send({
      bars,
      source,
      settings,
      inputs,
      timeframe,
      symbol,
      warmupBars,
      diagnostics,
    });
    worker.once("exit", (code) =>
      finish(
        new Error(
          `Script process stopped without a result (${code}): ${stderr}`,
        ),
      ),
    );
  });
}
export function simulate(
  trades,
  { initialCapital = 10000, paths = 200, seed = 42 } = {},
) {
  if (!trades.length) throw new Error("Simulation requires closed trades.");
  if (
    !Number.isInteger(paths) ||
    paths < 1 ||
    paths > 1000 ||
    !Number.isFinite(initialCapital) ||
    initialCapital <= 0 ||
    !Number.isInteger(seed)
  )
    throw new Error("Invalid simulation settings.");
  let state = seed >>> 0;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const outcomes = Array.from({ length: paths }, () => {
    let equity = initialCapital,
      peak = equity,
      maxDrawdown = 0;
    const curve = [equity];
    for (let i = 0; i < trades.length; i++) {
      equity += trades[Math.floor(random() * trades.length)].profit;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak - equity);
      curve.push(equity);
    }
    return { curve, profit: equity - initialCapital, maxDrawdown };
  });
  const sorted = outcomes.map((o) => o.profit).sort((a, b) => a - b),
    q = (p) => sorted[Math.floor((sorted.length - 1) * p)];
  return {
    seed,
    paths,
    p05: q(0.05),
    median: q(0.5),
    p95: q(0.95),
    lossProbability: outcomes.filter((o) => o.profit < 0).length / paths,
    ruinProbability:
      outcomes.filter((o) => Math.min(...o.curve) <= 0).length / paths,
    outcomes,
  };
}
