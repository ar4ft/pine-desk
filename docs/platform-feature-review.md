# OpenMarket, Alertsify and GoCharting review

Reviewed October 27, 2026 against Pine Desk `0.8.1`, commit `0c5396d`. This is a product comparison and proposed implementation backlog, not a claim that the missing features have shipped. Public product descriptions were inspected; authenticated accounts, execution and paid feeds were not tested.

## Implementation update — v0.22.0

The [shared desktop/MCP service](desktop-mcp.md) now implements desktop attachment, local authentication, capability controls, single service ownership, workspace chart commands and frozen research inputs. The [linked chart foundation](linked-charts.md) adds 1/2/4-chart layouts, symbol/timeframe/range/crosshair linking, shared comparison subscriptions, Binance market search and streaming watchlist quotes. Named watchlist collections, screeners/sorting, multiple link groups, per-panel editors and the command palette remain milestone-2 extensions. The [local alert monitor](local-alerts.md) adds persisted Binance spot price crossings, cooldowns, expiry/UTC sessions, trigger evidence, OS notification requests and separate MCP alert permission. Indicator/options rules and external delivery remain follow-up work. The [live order-book foundation](live-depth.md) adds synchronized public Binance spot depth, bounded bid/ask ladders, cumulative displayed depth, spread/imbalance, explicit stale/gap recovery and shared MCP controls. [Sampled depth recording, liquidity heatmaps and playback](depth-recording.md) now add compressed local archives, integrity checks, explicit gaps and scoped MCP access. [Historical footprints, diagonal/stacked imbalances and bar/range volume value areas](footprints.md) now extend executed-trade analytics with pinning, paging and explicit methods. [UTC session and anchored profiles](volume-profiles.md) now add explicit time windows, volume at price, coverage and JSON export through the desktop and MCP. [Observed-trade TPO analysis](tpo.md) adds period letters, count-based value areas, observed initial balance and per-period coverage through the desktop and MCP. [Individual-print size filters and composite UTC volume profiles](composite-profiles.md) now add inclusive bounds across analytics, weekday-selected sessions and per-session coverage. Full diff capture, composite TPO, exchange-calendar/DST handling, persistent profile presets and chart-integrated footprint/TPO rendering remain milestone-4 extensions. [Trade plans and linear risk sizing](trade-plans.md) now add chart-reference drafts, multi-target scenarios, fee/slippage assumptions, quantity and notional caps, durable plans and revision-safe MCP editing. The [paper cash account and event ledger](paper-trading.md) now add reserved spot orders, explicit fresh-bid/ask processing, simulated fills, average-cost positions, partial exits and plan-to-entry handoff. Opt-in continuous quote polling, linked stop/target slices with OCO cancellation and fresh bid-marked equity/unrealized P&L now extend that paper account. Persistent entry pause, fee-inclusive order/market/total cost caps, a distinct-market cap and a UTC realized losing-trade budget now apply across desktop, MCP and monitored fills. [Fill annotations and recorded equity/drawdown](paper-journal-history.md) now add independent note revisions, source-plan/fill references, observed bid samples, explicit gaps and JSON/CSV exports. Round-trip grouping, richer performance metrics, archive rollover and chart-native order editing remain milestone-5 extensions. The comparison below retains the original 0.8.1 baseline.

## Recommendation

Build an independent local terminal on the existing Vela/PineTS foundation. Prioritize a shared market-data service, linked charts, persistent alerts, deeper order-flow analysis and chart-based paper trading. Extend the existing options tools instead of creating another disconnected options page.

Local storage, calculations, replay, chart rendering and rule evaluation are feasible. Current market data still comes from network providers. Exchange entitlements, news, dark-pool reports and broker permissions are separate from the software. A website subscription does not automatically grant an API or redistribution rights.

## What is useful from each product

### OpenMarket

Its [official developer app listing](https://play.google.com/store/apps/details?id=xyz.openmarket.app) describes multi-chart layouts, live watchlists, top movers, order-book/DOM views, universal search, price alerts, workspaces, themes and community features. These suggest improving Pine Desk's everyday monitoring workflow first.

The main site and `/docs` returned HTTP 403 from this environment. Details of its scripting, agent/MCP interface, heatmap methodology and API availability remain unverified here. Do not base an integration contract on third-party descriptions. Its advertised heatmaps also need closer examination before assigning a specific data model.

### Alertsify

[Charts](https://alertsify.com/charts) combine multiple charts with exposure levels, flow-related context, dark-pool prints, news and customizable side panels. [Trade](https://alertsify.com/trade) adds chart-defined entries, stops and targets. [Signal](https://alertsify.com/signal) turns selected Discord messages into tracked trade ideas or broker orders. [Risk rules](https://alertsify.com/risk-rules) describe exposure, sizing, loss, spread and contract filters. Its [homepage](https://alertsify.com/) also advertises copying, creator distribution and streaming features; some features are explicitly forthcoming.

For Pine Desk, the strongest additions are a signal inbox, editable trade plans, paper positions and an explanatory risk check. Copy networks, marketplaces and social streaming require substantial external infrastructure and are lower priority for a personal local app.

### GoCharting

[Order-flow features](https://gocharting.com/features/orderflow) include footprints, imbalances, session/fixed/composite profiles, TPO, DOM, trade tape and anchored VWAP. [Options tools](https://gocharting.com/features/options) combine chains, multi-leg scenarios, volatility views and strike-level analysis. This is the strongest reference for expanding Pine Desk's market microstructure workspace.

The [official SDK examples](https://github.com/GoChartingInc/gocharting-sdk-examples) distinguish their public integration templates from the proprietary compiled SDK. They require package access and a license key, and document HTTPS license validation even for native examples using mock data. The [library marketing page](https://gocharting.com/developers/libraries) advertises a free attribution tier, but that does not establish permission to redistribute the full platform or offline operation. Its linked terms PDF rendered the documentation index during this review, so contractual terms were not verified. Keep Vela/PineTS; consider the SDK only after reviewing an actual distribution agreement and testing packaged macOS support.

## Gaps against the code

| Capability | Pine Desk 0.8.1 evidence | Proposed addition / dependency |
| --- | --- | --- |
| Linked multi-chart workspace | Saved single-chart layouts in `core/workspace-ui.js`; separate chart pages | Per-panel market state; 2/4-chart layouts, linked symbol/time/crosshair groups; scale further after performance tests |
| Live watchlists, movers, screener | `core/watchlist.js` fetches Binance quotes on request; one list capped at 50 entries | Multiple lists, subscription sharing, sortable live metrics, saved filters and explicit scan coverage |
| Persistent alerts | No app alert scheduler, notification history or delivery service | Price crossings first; later indicator, volume/delta and options rules; cooldowns, expiry, sessions and visible trigger evidence |
| Depth and liquidity heatmap | `core/live.js` consumes Binance spot candles and trades, not book updates | Snapshot-plus-delta order book, sequence recovery, DOM and recorded depth history |
| Footprint/profile/TPO | `core/orderflow.js` calculates bar levels, delta, CVD and whole-input profile/POC; UI shows latest footprint | Historical footprint navigation, diagonal/stacked imbalances, value area, session/anchored/composite profiles and TPO |
| Chart-based paper trading | Pine strategy emulator and archived option replay exist; no interactive paper account | Trade-plan drawing, paper order state, positions, account ledger, risk controls and journal |
| Options context | UW GEX/walls/flow, Whale Options connector, crypto chains, Greeks, surfaces and replay already exist | Shared symbol selection, chain-to-plan interaction, strike comparisons, expiry dashboards and provider-supported news/dark-pool panels |
| Desktop agent control | `core/mcp.js` starts a separate service process; streams are process-local | Authenticated local bridge to the running desktop/service, panel IDs, chart operations and visible action results |
| Signals and broker execution | No live broker order routing | Import/review signals first; provider-specific order adapters and reconciliation are a later, separate milestone |

Existing drawings, indicators and script support are useful foundations, but they do not establish parity with every advertised chart type or scripting language. Lipi/OpenMarket scripts cannot be assumed to run as Pine. PineTS compatibility must remain explicit.

## Implementation order and completion criteria

### 1. Shared data service and desktop MCP bridge

At the 0.8.1 baseline, the service owned one Binance stream and a current research dataset; separate desktop and MCP instances could compete over shared files. Introduce explicit instrument IDs (venue, asset type, symbol, contract, currency), panel subscriptions and a single owner for live connections and writes. Keep reproducible research snapshots immutable when live panels change.

Use authenticated local IPC for desktop attachment, with separate capabilities for reading data, changing charts and managing alerts. Preserve standalone MCP research mode. Return the actual panel state after a chart command. An LLM provider remains user-selected; using a remote LLM sends requested context outside the Mac.

Completion: two panels on different markets cannot overwrite each other; desktop and attached MCP see the same stream; reconnects, stale data, unit differences and revoked access are tested. Existing layouts migrate without losing scripts or drawings.

### 2. Linked charts, search and monitoring

Add two/four-panel layouts, optional link groups, shared crosshairs, per-panel scripts, instrument search and a command palette. Extend watchlists to named collections with live sorting and saved filters. Expose provider health, source timestamp and live/delayed status beside results. Keep expensive indicators in bounded workers.

Completion: reload restores each panel independently; changing a linked symbol updates only its group; streams are released when unused; a busy panel cannot freeze the editor. Screeners report the scanned universe and unavailable instruments.

### 3. Local alert engine

Persist rules and trigger history in the service. Start with crossing-above/below rules, once/repeating modes, cooldown, expiration and macOS notifications. Add settled-bar indicator conditions and flow thresholds after their runtime semantics are verified. Distinguish intrabar signals from confirmed-close signals; do not treat a reconnect jump as an observed continuous crossing.

Completion: restart preserves rules and deduplication; stale or out-of-order data cannot trigger misleading alerts; each event includes its observed value, source time and rule version. Replay must be an explicit evaluation mode, not a source of live notifications.

An optional login/menu-bar helper can operate while the window is closed. Sleep, shutdown and network outages interrupt local monitoring. Always-on behavior needs an always-on user-owned machine or hosted service, with a single scheduler owner. Webhook delivery is optional configured outbound networking; nothing is sent during this review.

### 4. Order-flow workstation

Expand analytics from recorded or imported aggressor-tagged trades: historical footprints, explicitly defined diagonal ratios and stacked runs, trade-size filters, configurable sessions and volume value areas. Define tie-breaking, empty levels and zero-denominator behavior. Compute TPO separately as price/time occupancy, not volume. Label any bar-range approximation.

Add public crypto depth with a verified snapshot/update sequence before building DOM and liquidity heatmaps. Record depth over time; a current snapshot cannot reconstruct past liquidity. Display resynchronization gaps instead of connecting stale books. Session CVD/profile needs session coverage beyond the current 50,000-print memory window.

Completion: fixtures cover price buckets, session/DST boundaries, imbalance edges, missing sequences and book resets; recorded replay reproduces calculations. Depth liquidity, executed trades and estimated liquidation levels remain distinct concepts. Futures OI/funding/liquidation adapters require their own coverage and units.

### 5. Trade plans, paper account and signal journal

Add chart entry/stop/target editing, cash-risk sizing, multiple targets and a persisted paper ledger. Use fresh bid/ask where available, explicit fill assumptions, fees, partial fills and order lifecycle events. Track option contract multipliers and settlement currency. Reuse research math without presenting backtest fills as live executions.

Allow manual/structured signal import with original timestamp and provenance. Missing contract/expiry or ambiguous direction must remain unresolved until edited. Add risk checks for exposure, daily loss, spreads and stale quotes, with reasons shown on the plan.

Completion: restart does not duplicate fills; cancel/replace and partial exits reconcile; paper and historical-replay balances remain separate. A journal connects the original signal, plan, fills and outcome.

### 6. Options integration and broader feeds

Link existing option tools to the active underlying and selected contracts. Add multi-expiry comparisons and chain-to-paper-plan actions. Integrate news, calendar and dark-pool endpoints only with documented access and timestamps; preserve missing entitlements. Keep each provider's wall/gamma definition visible rather than claiming numerical agreement between products.

Completion: a stock overlay cannot appear on a different underlying; quote/exposure ages remain visible; records retain provider provenance; tests use fixtures plus opt-in credentialed checks. Equities, CME and other exchange coverage depend on the chosen licensed feeds.

### 7. Optional real execution and external integrations

Treat broker routing, copy trading and Discord integrations as separate projects after the paper ledger is reliable. Start with one supported broker's sandbox, then reconcile acknowledgements, rejected orders, fills, reconnects and account positions. Distinguish broker-held brackets from client-emulated stops that stop working when the process is down. The review does not connect accounts or place orders.

Community chat, paid script distribution, creator rankings and mobile/cloud sync can remain outside the first local release. Exportable scripts, journals and workspace bundles supply more immediate value without depending on those networks.

## Local operating modes

| Mode | Available | Required connection |
| --- | --- | --- |
| Offline research | Saved charts, imported trades/chains, supported local scripts, replay, Greeks and saved results | None for stored inputs; scripts needing remote series still require their provider |
| Live local terminal | Monitoring, streaming analytics, local alerts and paper positions once implemented | Market-data providers; API keys where required |
| Always-on monitoring | Same scheduler with continuous uptime once implemented | A running, awake host and working feeds |
| External execution/delivery | Broker orders or configured outbound notifications, future scope | Broker/service authorization and network connectivity |

No replacement SDK, dependency, broker connector or paid subscription was added by this review. The recommended first implementation milestone is the shared service plus linked charts, followed by alerts and richer order flow.
