# Custom scripts and LLM access

## Write and save Pine scripts

Open Workspace, replace the editor content, give it a name, and choose Save. The editor includes Pine syntax highlighting, line numbers, Ctrl-Space autocomplete, snippets, Tab indentation, search (Cmd/Ctrl-F) and undo. Completion covers common builtins and local variables; this is not a full Pine language server. Pine Desk supports native Pine v5/v6 through PineTS. Run chart executes through the official `@luxalgo/vela-pinets` worker addon, currently 0.2.14. Vela draws the resulting plots and exposes indicator settings. This integration was already included in the original edition; strategies now receive app sizing/cost properties on their initial chart execution.

A custom indicator:

```pine
//@version=6
indicator("My moving averages", overlay=true)
fast = input.int(12, "Fast length")
slow = input.int(26, "Slow length")
plot(ta.ema(close, fast), "Fast", color=color.teal)
plot(ta.ema(close, slow), "Slow", color=color.orange)
```

For backtests, use a strategy with explicit rules:

```pine
//@version=6
strategy("My EMA crossover", overlay=true)
fast = ta.ema(close, 12)
slow = ta.ema(close, 26)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("Long")
plot(fast)
plot(slow)
```

Choose Backtest to inspect trades and equity. App cost/sizing overrides are documented in the README. PineTS compatibility is not identical to TradingView; use supported features and inspect errors. Chart and backtest executions have an initial 30-second deadline. Compilation/execution errors stay in an editor panel; when the runtime identifies a Pine line, the gutter marks it and Go to line jumps there. JavaScript stack positions are not assumed to be Pine source locations. Errors from later live chart executions are also surfaced. Only run trusted scripts; backtest process isolation and Node permission restrictions are not an OS security sandbox. See [process boundaries](research-reliability.md#education-and-process-boundaries).

## Connect an LLM through MCP

An LLM client supporting MCP can read your data and saved scripts, save custom source, run backtests and inspect order flow. It can also browse the public library and query the configured Edge Stats / Whale Options services. No LLM or provider subscription is bundled into Pine Desk.

After `npm ci`, configure your client:

```json
{
  "mcpServers": {
    "pine-desk": {
      "command": "node",
      "args": ["/absolute/path/to/pine-desk/core/mcp.js"]
    }
  }
}
```

Use an absolute `node` path if your client cannot find Node. If you set `PINE_DESK_DATA_DIR` for the desktop app, set the same variable in this MCP server's `env` configuration. The packaged app alone does not install this separate Node server.

Example agent request: “Read my current dataset. Save a Pine v6 EMA crossover strategy, backtest it with $10,000 capital and 0.1% commission, then report closed-trade net P&L, equity drawdown and open positions.” MCP exposes tools to the client; the client controls tool approvals and orchestration. There is no autonomous broker execution.

For Edge Stats, ask the agent to check coverage first and preserve N, Wilson CI, minimum-sample guards, normalized query and data cutoff. For Whale Options, start with status, then inspect event reasons and score components; preserve cold-start and feed-label caveats and GEX positioning assumptions. Configure those local endpoints in the desktop app first. See [Edge Stats](edge-stats.md) and [Whale Options](whale-options.md).

Reference documentation: [PineTS](https://github.com/LuxAlgo/PineTS), [Vela PineTS addon](https://github.com/LuxAlgo/Vela-pinets), [Vela](https://velacharts.dev/), [LuxAlgo documentation index](https://www.luxalgo.com/llms.txt).

Continuous streams and parameter research are documented in [Live data](live-data.md) and [Strategy research](strategy-research.md). The MCP server exposes their process-local controls and saved results.

Options MCP tools: `options_refresh`, `options_start`, `options_snapshot`, `options_stop`. The standalone process uses `UNUSUAL_WHALES_API_KEY`; desktop encrypted credentials cannot be unlocked by the Node server. See [provider and options documentation](options.md#credential-storage-and-mcp).

Use the editor’s **Import .pine / .txt** button for native source files (UTF-8, up to 200 KB, Pine v5/v6). Imports save the source and provenance without executing it. [File import and workspace guide](workspaces.md#import-pine-and-txt-scripts).

## Crypto options and educational calculations

The six new crypto/education tools are listed in [Crypto options & Greeks Lab](crypto-options.md#mcp). Deribit public access needs no key. Desktop and stdio streams remain separate processes; tools preserve exchange units, timestamps and coverage. `options_greeks` produces hypothetical European/American-model values rather than pricing inverse crypto settlement.

Research reliability tools and licensed historical-data setup are listed in the [v0.7 guide](research-reliability.md). The standalone MCP process uses `MASSIVE_API_KEY` for Massive access.
