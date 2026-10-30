# Shared desktop service and MCP

Available since v0.9.0; linked-chart tools were added in v0.10.0 and [persistent alert tools](local-alerts.md) in v0.11.0. [Live order-book tools](live-depth.md) were added in v0.12.0: `depth_snapshot` uses read access; `depth_start` and `depth_stop` require stream permission. [Depth recording/archive tools](depth-recording.md) arrived in v0.13.0: recording uses stream permission, archive reads use read access, and deletion requires research permission. [Footprint analytics](footprints.md) in v0.14.0 extend `order_flow` and `live_order_flow` with configurable diagonal/stacked imbalances and bar/range value areas under existing read access. [Session and anchored profiles](volume-profiles.md) in v0.15.0 add the read-only `volume_profile` tool for saved or live retained trades. [TPO analysis](tpo.md) in v0.16.0 adds the read-only `tpo_profile` tool, including period occupancy, count-based value area and observed initial balance. [Trade filters and composite volume profiles](composite-profiles.md) in v0.17.0 extend existing read tools with individual-print size bounds and composite UTC session selection. [Trade-plan tools](trade-plans.md) in v0.18.0 add read-only sizing/list/get and research-scoped save/delete, with revision checks. `desktop_navigate` also accepts `plans`. [Paper-account tools](paper-trading.md) in v0.19.0 add read-only `paper_account` and research-scoped creation, submission, explicit quote processing and cancellation; navigation also accepts `paper`. An attached MCP client uses the running Electron main process for data, streams, credentials and research. It does not start a second Binance/Unusual Whales/crypto connection. Chart commands go to the renderer and return observed state after completion.

## Setup

1. Install/update Pine Desk and keep its window open.
2. Open **MCP & setup** and enable **local agent access**. Read access includes the workspace dataset, editor draft, scripts, provider snapshots and saved research.
3. Select the additional capabilities you need and click **Apply access**:
   - **Chart and editor changes:** market loading/import, navigation, editing/running trusted Pine source and changing the visible range. Selecting a different market also stops the workspace's previous live stream.
   - **Provider streams:** refreshing/selecting provider markets, starting/stopping streams and the options recorder. These operations may update the corresponding desktop page. Provider calls use the desktop's configured credentials and quotas.
   - **Saved-data changes and research:** script/trade/archive writes and deletions, backtests, strategy audits, sweeps and other research jobs, saved trade plans and simulated paper-account/order changes.
   - **Alert rules and monitoring:** creating/editing/deleting price alerts, starting/pausing their local ticker subscriptions, notification preferences and history acknowledgements. This separate permission defaults off on upgrade. Read access can inspect definitions and trigger history.
4. Install Node.js 22.16+ and run `npm ci` in your source checkout. Export the MCP configuration from the app, replace the checkout path and connect your MCP client. The app does not bundle a Node MCP launcher.

```json
{
  "mcpServers": {
    "pine-desk": {
      "command": "node",
      "args": ["/absolute/path/to/pine-desk/core/mcp.js"],
      "env": {
        "PINE_DESK_MCP_MODE": "desktop"
      }
    }
  }
}
```

Use the same `PINE_DESK_DATA_DIR` as the desktop if you override it. The app's exported configuration includes its data directory. Use an absolute Node executable path if your MCP client cannot find `node`.

The desktop decrypts its saved provider keys when needed; attached clients do not need duplicate environment keys. Keys are never returned by the bridge, and credential writes, bridge configuration and engine launching are not agent tools. A remote LLM receives the data returned to its client; local execution does not imply an offline LLM.

## Chart tools

| Tool | Behavior |
| --- | --- |
| `desktop_state` | Read the active page and primary/comparison panels, instrument ID, source/observation times, settled-bar coverage, stream state/gaps, editor draft, drawings, indicators and viewport |
| `desktop_navigate` | Open a supported page and return desktop state |
| `desktop_chart_set_script` | Replace the `workspace` editor draft/name without executing the new source |
| `desktop_chart_run` | Execute the current trusted draft and return the resulting chart state; runtime failures are tool errors and appear in the editor |
| `desktop_chart_set_range` | Set a loaded primary/comparison viewport using `from`/`to` Unix milliseconds; return the observed range |

Script tools require `panelId: "workspace"`. Since v0.10.0, viewport control also accepts `compare-1`, `compare-2` and `compare-3` when loaded. [Linked charts and live watchlists](linked-charts.md) add concurrent comparison markets, `chart_panels_snapshot`, `watchlist_snapshot` and `market_search`. Research still uses the primary chart. Options/crypto tools continue to expose their own provider snapshots and update their corresponding desktop views.

Existing tools now share the desktop when attached:

- `workspace` returns the **displayed settled dataset**, including a restored historical run/layout, rather than assuming the last disk file is what you see.
- `load_market` and `import_bars` update the visible workspace; `live_start`/`live_stop` control its owning stream. Live subscription status remains connecting/syncing until the actual provider is ready.
- `run_backtest`, `research_start`, `strategy_validate` and dataset-based `data_quality` capture the renderer dataset before dispatch. Subsequent chart/stream changes cannot replace that research input. Forming candles remain excluded.
- `options_*`, `crypto_options_*` and live order-flow reads use the same in-memory provider objects as the desktop. Closing an attached client leaves those streams running.
- Saved script/run changes are reflected in desktop state with an activity notification; they do not replace your current editor draft or selected run.

Example: “Read `desktop_state`, put a Pine v6 EMA indicator into panel `workspace`, run it and tell me the actual displayed symbol and last settled candle time.” Chart permission is required. For research: “Backtest this strategy against the dataset I am viewing and preserve its source and data timestamps.” Research permission is required.

Instrument IDs distinguish Binance spot, synthetic and imported datasets. Unknown asset type, contract and currency fields remain null/unknown; they are not inferred from a display symbol. Existing saved layouts remain compatible.

## Modes and ownership

`PINE_DESK_MCP_MODE` accepts:

- **`desktop`:** require the running enabled bridge. Recommended for interactive use. Failure never starts a standalone fallback.
- **`standalone`:** run an independent research service. It needs exclusive ownership of its data directory and its own provider environment keys. Desktop chart tools return an explicit error.
- **`auto` (default):** attach if a desktop descriptor exists; otherwise attempt standalone ownership. A stale/unreachable descriptor fails closed. An open desktop with access disabled still owns the directory, so auto cannot start a competing writer.

A filesystem ownership lock prevents a desktop and standalone server, or two standalone servers, from concurrently owning the same directory. Use a different `PINE_DESK_DATA_DIR` for intentionally independent research. Normal shutdown releases ownership; after a crash, lock recovery may take about 30 seconds. Older versions that do not implement the lock must not run against the same directory.

## Access lifecycle and limits

The Mac/Linux bridge uses a Unix-domain socket in a private temporary directory, not a network listener. The discovery file and socket are owner-only, and every request authenticates with a random session key. The allowlist and input schemas are shared with stdio MCP; arbitrary service actions cannot be invoked.

Access is disabled initially. **Apply access** rotates the socket/key; **Revoke access** removes it and blocks pending requests that have not started. Already-running work may finish. Existing clients remain bound to their original session and must reconnect after configuration changes or app restart. Do not copy the bridge discovery file into client configuration or exports.

This is a same-user local integration, not isolation from other software running as your OS account. Tool execution remains subject to PineTS's documented process boundaries.

Agent mutations are serialized. Read-only requests can inspect provider health while research runs. Busy/loading/disconnected renderer states fail visibly; a timeout is not proof that a mutation did not happen, so inspect state before retrying. Bridge activity lists tool names, times and completion status without arguments or secrets. The history is bounded and in memory.

The Mac app may keep its main service running after the last window closes. Provider reads can still work, but chart/workspace-snapshot commands require an open, hydrated window. Quitting the app stops the service; sleeping the Mac interrupts feeds. No automatic external messaging or broker orders are introduced.

## Verification

Core tests cover authentication, permissions, schema validation, token rotation/revocation, shared clients, ownership and immutable research input capture. The native Electron smoke connects real stdio MCP clients, verifies visible editor/indicator/range changes and execution errors, and checks that both clients see the same owning Binance stream through a deterministic network fixture. The same smoke runs against source and packaged DMG/ZIP apps on Apple Silicon and Intel in CI. These checks do not require paid provider credentials or assert authenticated feed entitlements.
