import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import * as store from "./store.js";
import { credential } from "./credentials.js";
import { configureWhale } from "./whale-options.js";
import { tickerValue } from "./options-model.js";
export const defaultEngineConfig = {
  folder: "",
  nodePath: "",
  feed: "synthetic",
  tickers: "SPY,QQQ",
  alpacaStream: "indicative",
  massiveStream: "delayed",
};
export async function engineConfig() {
  return (await store.read("whale-engine-config")) ?? defaultEngineConfig;
}
export function validateEngineConfig(input) {
  if (
    !["synthetic", "tradier", "massive", "alpaca", "thetadata"].includes(
      input.feed,
    )
  )
    throw new Error("Unsupported Whale Options feed.");
  for (const key of ["folder", "nodePath"])
    if (
      typeof input[key] !== "string" ||
      input[key].length > 2000 ||
      (input[key] && !path.isAbsolute(input[key]))
    )
      throw new Error("Installation and Node paths must be absolute.");
  const tickers = String(input.tickers ?? "")
    .split(",")
    .filter((x) => x.trim())
    .map(tickerValue);
  if (!tickers.length || tickers.length > 20)
    throw new Error("Choose 1–20 underlying tickers.");
  if (
    !["indicative", "opra"].includes(input.alpacaStream) ||
    !["delayed", "realtime"].includes(input.massiveStream)
  )
    throw new Error("Choose a valid feed entitlement.");
  return {
    ...defaultEngineConfig,
    folder: input.folder,
    nodePath: input.nodePath,
    feed: input.feed,
    tickers: tickers.join(","),
    alpacaStream: input.alpacaStream,
    massiveStream: input.massiveStream,
  };
}
export async function configureEngine(input) {
  return store.write("whale-engine-config", validateEngineConfig(input));
}
export class WhaleRunner {
  constructor() {
    this.generation = 0;
    this.children = [];
    this.state = { running: false, status: "stopped", error: null };
  }
  status() {
    return { ...this.state };
  }
  async start() {
    if (this.children.length)
      throw new Error("Stop the managed engine before restarting.");
    const generation = ++this.generation;
    const config = validateEngineConfig(await engineConfig());
    if (!config.folder)
      throw new Error("Set the path to your built Whale Options installation.");
    const cli = path.join(config.folder, "packages/cli/dist/index.js"),
      mcp = path.join(config.folder, "packages/mcp/dist/index.js");
    await Promise.all([fs.access(cli), fs.access(mcp)]).catch(() => {
      throw new Error(
        "Build the upstream Whale Options repository first. CLI and MCP dist/index.js files are required.",
      );
    });
    const env = { ...process.env };
    for (const n of [
      "TRADIER_ACCESS_TOKEN",
      "MASSIVE_API_KEY",
      "POLYGON_API_KEY",
      "ALPACA_API_KEY_ID",
      "ALPACA_API_SECRET_KEY",
      "UNUSUAL_WHALES_API_KEY",
    ])
      delete env[n];
    const required =
      {
        tradier: { TRADIER_ACCESS_TOKEN: "tradierToken" },
        massive: { MASSIVE_API_KEY: "massiveKey" },
        alpaca: {
          ALPACA_API_KEY_ID: "alpacaKey",
          ALPACA_API_SECRET_KEY: "alpacaSecret",
        },
      }[config.feed] ?? {};
    for (const [name, key] of Object.entries(required)) {
      const secret = await credential(key);
      if (!secret)
        throw new Error(`Add ${config.feed} credentials in Settings.`);
      env[name] = secret;
    }
    const dir = path.join(store.dataDir, "whale-engine");
    await fs.mkdir(dir, { recursive: true });
    const db = path.join(dir, `${config.feed}.db`),
      configPath = path.join(dir, "managed.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        feed: {
          id: config.feed,
          alpaca: { stream: config.alpacaStream },
          massive: { stream: config.massiveStream },
        },
        store: { path: db },
        universe: { underlyings: config.tickers.split(",") },
        server: { enabled: false },
      }),
      { mode: 0o600 },
    );
    const executable = config.nodePath || process.execPath;
    if (!config.nodePath && process.versions.electron)
      env.ELECTRON_RUN_AS_NODE = "1";
    else delete env.ELECTRON_RUN_AS_NODE;
    if (generation !== this.generation) return this.status();
    this.state = {
      running: true,
      status: "starting",
      feed: config.feed,
      error: null,
    };
    const launch = (file, args) => {
      const child = spawn(executable, [file, ...args], {
        cwd: config.folder,
        env,
        stdio: "ignore",
        shell: false,
      });
      this.children.push(child);
      child.once("error", () =>
        this.failed("Could not launch Node. Check the executable path."),
      );
      child.once("exit", (code) => {
        if (this.children.includes(child))
          this.failed(
            `Whale Options process exited (${code ?? "signal"}). Verify native SQLite/Node compatibility, provider entitlement and that port 8788 is free.`,
          );
      });
      return child;
    };
    launch(cli, ["run", "--config", configPath, "--quiet", "--no-serve"]);
    launch(mcp, [
      "--db",
      db,
      "--config",
      configPath,
      "--http",
      "8788",
      "--host",
      "127.0.0.1",
    ]);
    await configureWhale({
      endpoint: "http://127.0.0.1:8788/mcp",
      source: config.feed === "synthetic" ? "synthetic" : "licensed",
    });
    if (this.state.running) this.state.status = "launched";
    return this.status();
  }
  failed(message) {
    this.stop();
    this.state.status = "error";
    this.state.error = message;
  }
  stop() {
    this.generation++;
    const children = this.children;
    this.children = [];
    for (const child of children) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      }, 3000);
      timer.unref();
    }
    this.state = { ...this.state, running: false, status: "stopped" };
    return this.status();
  }
}
