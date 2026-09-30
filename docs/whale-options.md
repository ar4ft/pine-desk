# Whale Options in Pine Desk

Pine Desk connects to the official [Whale Options](https://github.com/LuxAlgo/whale-options) local HTTP MCP server. Its engine and SQLite recorder run separately; they are not bundled or automatically started by the app. This preserves the upstream engine, native SQLite dependencies and your personal feed entitlements.

## Start with synthetic data

Install Node 24 and the upstream pinned pnpm version (currently 10.33.0), then in a separate terminal:

```sh
git clone https://github.com/LuxAlgo/whale-options.git
cd whale-options
corepack pnpm install --frozen-lockfile
corepack pnpm build
node packages/cli/dist/index.js run --feed synthetic
```

Keep the engine running. In a second terminal, from the same checkout:

```sh
node packages/mcp/dist/index.js --db "$PWD/.whale/whale.db" --http 8788
```

In Pine Desk → **Whale Options**, keep `http://127.0.0.1:8788/mcp`, select **synthetic** as the engine source label and connect. Choose a ticker from available chains. Inspect recent events, top scores, event audits, gamma ladders, OI changes, max pain, IV history and net premium. Refresh explicitly; this edition does not poll or subscribe automatically.

The source selector records **your label**, not an authenticated feed identity. Changing it does not switch the upstream feed. A live heartbeat means an engine is writing, including when that engine is synthetic. Always check last tick time, chain snapshot age and baseline coverage. With a stopped engine, the recorder can still contain historical events.

If you use a different `store.path`, pass the same absolute database path to MCP. Its config loader reads JSON, whereas the CLI can also read TS/JS config. Pass matching JSON Greeks/scoring settings with `--config /absolute/path/whale.config.json` to keep GEX assumptions consistent. Native SQLite must build for the Node version used by the upstream server. With newer pnpm releases, approve the upstream `better-sqlite3` and `esbuild` build scripts if prompted; the pinned upstream pnpm version is recommended.

## Licensed data access

Synthetic data needs no keys. For market data, use upstream feed adapters and obtain your own provider entitlement:

* [Tradier](https://developer.tradier.com/): `TRADIER_ACCESS_TOKEN`; funded brokerage access is required for its real-time scope.
* [ThetaData](https://www.thetadata.net/): run ThetaTerminal with an appropriate options/OPRA subscription; configure its local HTTP/WebSocket addresses in the upstream engine.
* [Alpaca](https://docs.alpaca.markets/docs/options-market-data): `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY`; distinguish indicative data from paid OPRA. Open interest availability differs by feed.
* [Massive](https://massive.com/): `MASSIVE_API_KEY` (upstream also accepts the Polygon alias); verify delayed versus real-time OPRA plan access.

Consult the upstream README for current adapter setup and feed capabilities. Configure keys in the upstream process environment, outside this repository. Personal feed access does not grant redistribution rights. Pine Desk does not request or store these credentials.

## Interpretation and scope

Event side comes from the print's recorded NBBO; missing or stale quotes remain unknown. Scores are decompositions, not probabilities or proof of intent. Event audits preserve classification reasons, missing score components, cold-start flags, and per-leg NBBO. Net flow covers emitted events only, subject to the engine's emission policy.

GEX assumes dealer positioning; the UI preserves `convention` and `conventionNote`, snapshot age, zero-gamma method and skipped contracts. Max pain is a static OI calculation, not a forecast. OI deltas need at least two recorded sessions. IV rank uses the actual recorded history, which may be far shorter than a year. Empty history remains empty.

Nine read-only Pine Desk MCP tools forward to this engine: `whale_status`, `whale_recent`, `whale_top`, `whale_event`, `whale_gex`, `whale_oi_deltas`, `whale_max_pain`, `whale_iv_rank`, `whale_net_flow`. Desktop source settings are shared with the local stdio server. Alert CRUD, replay, audit-batch tools, FINRA context, flow series and GEX heatmaps remain available in upstream Whale Options and are not implemented in this desktop integration.

The upstream project is MIT licensed. Feed data retains its provider's terms.
