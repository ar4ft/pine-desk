import { dataDir as defaultDir } from "./store.js";
import { readBridgeDescriptor, callDesktop } from "./desktop-bridge.js";
import { acquireServiceOwner } from "./service-owner.js";
import { toolDefinitions } from "./mcp-tools.js";

export async function createMcpBackend({
  mode = process.env.PINE_DESK_MCP_MODE ?? "auto",
  dataDir = defaultDir,
} = {}) {
  if (!["auto", "desktop", "standalone"].includes(mode))
    throw Error("PINE_DESK_MCP_MODE must be auto, desktop or standalone.");
  const descriptor =
    mode === "standalone" ? null : await readBridgeDescriptor(dataDir);
  if (mode === "desktop" || descriptor) {
    if (!descriptor)
      throw Error(
        "Open Pine Desk and enable agent access in MCP & setup. Desktop mode never starts a standalone service.",
      );
    // Pin this desktop session. Do not silently regain access after revocation,
    // key rotation or restart; the client must reconnect to acquire a new token.
    return {
      mode: "desktop",
      call: (name, args) => callDesktop(descriptor, name, args),
      close: async () => {},
    };
  }
  if (dataDir !== defaultDir)
    throw Error(
      "Set PINE_DESK_DATA_DIR before starting a standalone server; its service directory cannot change after import.",
    );
  const release = await acquireServiceOwner(dataDir);
  let service;
  try {
    service = await import("./service.js");
    await service.initialize();
  } catch (error) {
    await release();
    throw error;
  }
  const tools = new Map(toolDefinitions().map((t) => [t.name, t]));
  let closed = false;
  return {
    mode: "standalone",
    call(name, args = {}) {
      if (closed) throw Error("Standalone service is closed.");
      const tool = tools.get(name);
      if (!tool) throw Error("Unknown tool.");
      if (tool.action.startsWith("desktop"))
        throw Error(
          "This tool requires PINE_DESK_MCP_MODE=desktop and a running desktop.",
        );
      return service.dispatch(tool.action, tool.schema.parse(args));
    },
    async close() {
      if (closed) return;
      closed = true;
      await service.shutdown();
      await release();
    },
  };
}
