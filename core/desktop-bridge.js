import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { toolDefinitions } from "./mcp-tools.js";

export const bridgeDefaults = {
  enabled: false,
  charts: false,
  streams: false,
  research: false,
};
export const bridgeDescriptor = (dir) => path.join(dir, "desktop-bridge.json");
const requestLimit = 26_000_000;
const responseLimit = 100_000_000;
function authenticated(actual, expected) {
  return (
    typeof actual === "string" &&
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}
export function validateBridgeConfig(input) {
  if (
    !input ||
    Object.keys(input).length !== 4 ||
    Object.keys(bridgeDefaults).some((key) => typeof input[key] !== "boolean")
  )
    throw Error("Choose enabled, charts, streams and research access.");
  return Object.fromEntries(
    Object.keys(bridgeDefaults).map((key) => [key, input[key]]),
  );
}

export class DesktopBridge {
  constructor({ dataDir, dispatch, now = Date.now }) {
    this.dataDir = dataDir;
    this.dispatch = dispatch;
    this.now = now;
    this.config = { ...bridgeDefaults };
    this.tools = new Map(toolDefinitions().map((tool) => [tool.name, tool]));
    this.sockets = new Set();
    this.events = [];
    this.generation = 0;
    this.queue = Promise.resolve();
    this.configurationQueue = Promise.resolve();
    this.pending = 0;
  }
  status() {
    return {
      ...this.config,
      running: !!this.server,
      transport: "local socket",
      events: this.events.slice(-20),
    };
  }
  configure(input) {
    const config = validateBridgeConfig(input);
    const operation = this.configurationQueue.then(async () => {
      await this.stop();
      this.config = config;
      if (config.enabled) await this.start();
      return this.status();
    });
    this.configurationQueue = operation.catch(() => {});
    return operation;
  }
  async start() {
    this.token = randomBytes(32).toString("hex");
    this.socketDir = await fs.mkdtemp(path.join(os.tmpdir(), "pd-"));
    await fs.chmod(this.socketDir, 0o700);
    const socketPath = path.join(this.socketDir, "rpc");
    this.server = net.createServer((socket) => this.accept(socket));
    try {
      await new Promise((resolve, reject) => {
        this.server.once("error", reject);
        this.server.listen(socketPath, resolve);
      });
      await fs.chmod(socketPath, 0o600);
      const descriptor = {
        protocol: 1,
        socketPath,
        token: this.token,
        pid: process.pid,
      };
      await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
      const file = bridgeDescriptor(this.dataDir),
        temp = file + ".tmp";
      await fs.writeFile(temp, JSON.stringify(descriptor), { mode: 0o600 });
      await fs.chmod(temp, 0o600);
      await fs.rename(temp, file);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  accept(socket) {
    if (this.sockets.size >= 32) {
      socket.destroy();
      return;
    }
    const generation = this.generation;
    this.sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => this.sockets.delete(socket));
    socket.setTimeout(125000, () => socket.destroy());
    let bytes = 0,
      chunks = [],
      received = false;
    socket.on("data", async (chunk) => {
      if (received) return socket.destroy();
      bytes += chunk.length;
      if (bytes > requestLimit) return socket.destroy();
      chunks.push(chunk);
      if (!chunk.includes(10)) return;
      received = true;
      try {
        const request = JSON.parse(
          Buffer.concat(chunks).toString("utf8").trim(),
        );
        chunks = [];
        if (
          generation !== this.generation ||
          !authenticated(request.token, this.token)
        )
          throw Error(
            "Desktop bridge authentication failed. Reconnect your MCP client.",
          );
        const tool = this.tools.get(request.tool);
        if (!tool) throw Error("Unknown desktop tool.");
        const args = tool.schema.parse(request.args ?? {});
        const execute = async () => {
          if (
            generation !== this.generation ||
            socket.destroyed ||
            !this.config.enabled
          )
            throw Error("Desktop access was revoked.");
          if (tool.capability !== "read" && !this.config[tool.capability])
            throw Error(
              `Desktop ${tool.capability} access is disabled. Change access in MCP & setup.`,
            );
          const event = {
            tool: tool.name,
            time: this.now(),
            status: "running",
          };
          this.events.push(event);
          this.events = this.events.slice(-20);
          try {
            const result = await this.dispatch(tool.action, args);
            event.status = "completed";
            return result;
          } catch (error) {
            event.status = "failed";
            throw error;
          }
        };
        if (this.pending >= 16)
          throw Error(
            "Desktop bridge is busy. Retry after current requests finish.",
          );
        this.pending++;
        let result;
        try {
          // Serialize mutations from different clients; allow health reads while
          // a research worker is running. Recheck authorization when dequeued.
          if (tool.readOnly) result = await execute();
          else {
            const operation = this.queue.then(execute);
            this.queue = operation.catch(() => {});
            result = await operation;
          }
        } finally {
          this.pending--;
        }
        socket.end(JSON.stringify({ result }) + "\n");
      } catch (error) {
        socket.end(
          JSON.stringify({
            error: {
              message: error.message,
              diagnostic: error.diagnostic ?? null,
            },
          }) + "\n",
        );
      }
    });
  }
  async stop() {
    this.generation++;
    this.token = "";
    const server = this.server;
    this.server = null;
    for (const socket of this.sockets) socket.destroy();
    if (server) await new Promise((resolve) => server.close(resolve));
    await fs.rm(bridgeDescriptor(this.dataDir), { force: true });
    if (this.socketDir)
      await fs.rm(this.socketDir, { recursive: true, force: true });
    this.socketDir = null;
  }
}

export async function readBridgeDescriptor(dataDir) {
  let stat;
  try {
    stat = await fs.lstat(bridgeDescriptor(dataDir));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.mode & 0o077 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw Error("Desktop bridge descriptor must be an owner-only local file.");
  const descriptor = JSON.parse(
    await fs.readFile(bridgeDescriptor(dataDir), "utf8"),
  );
  if (
    descriptor.protocol !== 1 ||
    typeof descriptor.socketPath !== "string" ||
    !path.isAbsolute(descriptor.socketPath) ||
    !/^[a-f0-9]{64}$/.test(descriptor.token)
  )
    throw Error(
      "Invalid desktop bridge descriptor. Restart the desktop bridge.",
    );
  return descriptor;
}

export function callDesktop(descriptor, tool, args = {}, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(descriptor.socketPath);
    let bytes = 0,
      chunks = [],
      complete = false;
    const finish = (error, result) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      socket.destroy();
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(
      () =>
        finish(
          Error(
            "Desktop request timed out. Check its state before retrying a mutation; it may still complete.",
          ),
        ),
      timeoutMs,
    );
    socket.on("connect", () =>
      socket.write(
        JSON.stringify({ token: descriptor.token, tool, args }) + "\n",
      ),
    );
    socket.on("error", () =>
      finish(
        Error(
          "Desktop bridge unavailable. Open Pine Desk, enable agent access and reconnect MCP. No standalone fallback was started.",
        ),
      ),
    );
    socket.on("end", () => {
      try {
        const response = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (response.error)
          finish(
            Object.assign(Error(response.error.message), {
              diagnostic: response.error.diagnostic,
            }),
          );
        else finish(null, response.result);
      } catch {
        finish(Error("Invalid desktop bridge response."));
      }
    });
    socket.on("close", () => {
      if (!complete)
        finish(
          Error(
            "Desktop bridge disconnected. Check the desktop before retrying.",
          ),
        );
    });
    socket.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > responseLimit)
        return finish(
          Error("Desktop response exceeds 100 MB. Request a smaller dataset."),
        );
      chunks.push(chunk);
    });
  });
}
