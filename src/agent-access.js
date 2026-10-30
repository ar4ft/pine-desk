export function agentConfig(dataDir) {
  return {
    mcpServers: {
      "pine-desk": {
        command: "node",
        args: ["/absolute/path/to/pine-desk/core/mcp.js"],
        env: {
          PINE_DESK_MCP_MODE: "desktop",
          ...(dataDir ? { PINE_DESK_DATA_DIR: dataDir } : {}),
        },
      },
    },
  };
}
export function agentAccessView(status, esc) {
  const s = status ?? {};
  return `<section class="plot-card" id="agent-access"><div class="panel-heading"><span>DESKTOP AGENT ACCESS</span><span id="agent-connection">${s.running ? "Enabled on this Mac" : "Disabled"}</span></div><p>Attached clients use this app’s live connections and saved credentials. Read access includes datasets, scripts, saved research, alert rules and trigger history. Enable only the additional controls you want.</p><div class="edge-form">${[
    ["enabled", "Enable local agent access"],
    ["charts", "Allow chart and editor changes"],
    ["streams", "Allow starting and stopping provider streams"],
    ["research", "Allow saved-data changes, research jobs and paper orders"],
    ["alerts", "Allow alert rules, monitoring and acknowledgements"],
  ]
    .map(
      ([key, label]) =>
        `<label><input type="checkbox" id="agent-${key}" ${s[key] ? "checked" : ""}>${label}</label>`,
    )
    .join(
      "",
    )}</div><div class="editor-tools"><button id="agent-save" class="primary">Apply access</button><button id="agent-revoke">Revoke access</button><button id="agent-refresh">Refresh activity</button></div><p class="footnote">Applying access rotates the connection key; reconnect your MCP client. Revocation blocks further requests. Work already started may finish. A remote LLM receives the data returned to it.</p><div id="agent-activity">${
    (s.events ?? [])
      .slice()
      .reverse()
      .map(
        (event) =>
          `<div class="tool-row"><code>${esc(event.tool)}</code><small>${esc(event.status)} · ${esc(new Date(event.time).toLocaleTimeString())}</small></div>`,
      )
      .join("") || '<p class="footnote">No agent requests this session.</p>'
  }</div></section>`;
}
