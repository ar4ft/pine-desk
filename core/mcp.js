import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { toolDefinitions } from "./mcp-tools.js";
import { createMcpBackend } from "./mcp-backend.js";
const version = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
const backend = await createMcpBackend();
const server = new McpServer({ name: "pine-desk", version });
for (const tool of toolDefinitions()) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: {
        readOnlyHint: tool.readOnly,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(await backend.call(tool.name, args)),
            },
          ],
        };
      } catch (e) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: e.message,
                diagnostic: e.diagnostic ?? null,
              }),
            },
          ],
        };
      }
    },
  );
}
server.server.onclose = () => {
  void backend.close();
};
process.once("SIGTERM", async () => {
  await backend.close();
  process.exit(0);
});
process.once("SIGINT", async () => {
  await backend.close();
  process.exit(0);
});
await server.connect(new StdioServerTransport());
