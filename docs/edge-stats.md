# Edge Stats in Pine Desk

The **Edge Stats** page connects to the official [LuxAlgo edge-stats](https://github.com/LuxAlgo/edge-stats) engine through MCP. It adds session statistics to Pine Desk's script and strategy research workflow. Edge Stats is MIT-licensed; this integration does not copy or reimplement its formulas.

## Public hosted reports: no extra installation

1. Open **Edge Stats**, keep **Public hosted reports** selected, and click **Load public reports**.
2. Read the coverage table and last-bar cutoff. Choose a listed symbol and report.
3. Click **Run report**. Review eligible-session count N, successes, historical frequency, Wilson 95% confidence interval, minimum-sample guards, stability halves, recent-history comparison, per-year counts, distributions, and grouped results when available.
4. **Export JSON** saves the full upstream envelope, source configuration, coverage snapshot, and retrieval time.

Hosted reports come from LuxAlgo's nightly derived store, not the current Pine Desk chart. Coverage is discovered from the server rather than assumed. A live check on September 30, 2026 found BTCUSDT and ETHUSDT, two session calendars per symbol, and 42 presets. These counts and coverage may change. Public access does not include raw vendor bars, arbitrary DSL queries, custom report parameters, session drill-down, or your local CSVs.

The hosted endpoint is `https://mcp.luxalgo.com/mcp`. Pine Desk calls only the public `edge_symbols`, `edge_presets`, and `edge_report` tools, with a generic analytics context. No account, journal, broker, or trading-execution tools are called.

## Local engine: your markets and composed queries

The full engine runs as a separate local service. Its packages currently point to TypeScript source in a pnpm monorepo; `@luxalgo/edge-stats` was not published on npm when this integration was built. This avoids bundling DuckDB native binaries and the entire data pipeline into Electron. You need Node.js 24 and pnpm for the upstream checkout.

Clone and prepare the official project:

```sh
git clone https://github.com/LuxAlgo/edge-stats.git
cd edge-stats
npm install -g pnpm@11.0.8
pnpm install
pnpm edgestats --dir "$PWD/.pine-desk-edge" init --demo
```

The demo is deterministic synthetic data and must be interpreted as a demo. To use real data, configure adapters, calendars, and symbols according to the [upstream data-source guide](https://github.com/LuxAlgo/edge-stats/blob/main/docs/data-sources.md), then run `edgestats sync` on that store. Do not assume crypto UTC sessions are appropriate for equities or overnight futures; the upstream engine manages exchange sessions, holidays, DST, and roll-day handling.

Start the official Streamable HTTP MCP entry from the upstream checkout:

```sh
EDGESTATS_DIR="$PWD/.pine-desk-edge" HOST=127.0.0.1 PORT=3344 \
  pnpm exec tsx packages/mcp/src/http.ts
```

Keep this process running while you use local statistics. In Pine Desk, choose **My local Edge Stats server**, enter `http://127.0.0.1:3344/mcp`, and click **Connect local server**. The desktop connection accepts loopback HTTP URLs with `/mcp` only; it does not store credentials. The source choice and URL are saved locally and shared with Pine Desk's MCP server.

Local mode provides:

* Official preset reports with parameters, session key, date range, and grouping.
* Custom query DSL, for example `gapFill WHERE dayOfWeek = Tue` or `orbBreak(15m, up) WHERE gapUp`.
* **Discover fields**, which reads the engine's actual registry of fields, predicates, outcomes, argument specifications, and definitions. Use it before composing queries.
* Returned session receipts, with **View session bars** to show one session's actual OHLCV on Vela, plus derived prior levels, gap data, opening-range levels, and event times.

Pine Desk's chart dataset and Edge Stats's DuckDB/parquet store remain separate. Importing a chart CSV does not ingest it into Edge Stats. Import and sync real data with the upstream engine. Similarly, Pine Desk order-flow imports are not the engine's optional trade-history tags. This version does not manage adapters, ingest your data automatically, start/stop the service, or implement Edge Stats's Live Board and exports UI.

## Statistical display rules

The app preserves the official envelope and does not manufacture missing values:

* Estimates below the engine's refuse floor are shown as **Withheld**, never 0%.
* Low-sample warnings remain visible. The upstream defaults warn below 30 and refuse below 10 eligible sessions.
* Displayed percentages include N and a 95% CI. Per-year rows display counts because the engine's per-year envelope does not include intervals.
* A result keeps its normalized query, engine version, store fingerprint, calendar version, source mode, and retrieval time in the full response/export.
* A hosted result cannot be silently filtered by changing local parameters: hosted mode rejects unsupported parameter/date/grouping fields.
* The original disclaimer is shown with each result: historical conditional frequencies, not predictions.

## LLM / MCP tools

The existing Pine Desk stdio MCP server exposes seven additional read tools:

| Tool | Purpose |
| --- | --- |
| `edge_coverage` | Discover symbol coverage and data freshness |
| `edge_presets` | List the official preset catalog |
| `edge_report` | Run a preset; preserve N, confidence interval, guards, and cutoff |
| `edge_query` | Compose a DSL query in local mode |
| `edge_fields` | Discover the local registry |
| `edge_sessions` | Read derived local session rows using `ids` |
| `edge_session_bars` | Read one local session's bars, levels, and event times |

Suggested agent flow: `edge_coverage` → `edge_presets` → `edge_report`. With local mode selected, use `edge_fields` → `edge_query` → `edge_sessions` → `edge_session_bars`. The tools share the desktop source configuration and preserve the raw upstream result. They do not execute orders or sync market data.

You can also connect an MCP client directly to the official local server, using its HTTP configuration or upstream stdio entry. See [upstream MCP documentation](https://github.com/LuxAlgo/edge-stats#mcp).

## Licensing and upstream references

Edge Stats code is MIT. Its calendar/event data carries separate CC BY 4.0 terms with LuxAlgo attribution, and upstream fonts have their own license. Pine Desk consumes results via MCP and does not redistribute those files. The overall app's existing AGPL license remains in effect.

* [Architecture](https://github.com/LuxAlgo/edge-stats/blob/main/ARCHITECTURE.md)
* [Preset catalog](https://github.com/LuxAlgo/edge-stats/blob/main/docs/catalog.md)
* [Hosted-store scope](https://github.com/LuxAlgo/edge-stats/blob/main/docs/hosted-store.md)
* [Session calendars](https://github.com/LuxAlgo/edge-stats/blob/main/docs/session-calendars.md)
* [Upstream license](https://github.com/LuxAlgo/edge-stats/blob/main/LICENSE)
