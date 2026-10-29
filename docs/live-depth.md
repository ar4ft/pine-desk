# Live order book and depth of market

Available in v0.12.0. Open **Order flow → Live order book / DOM**, enter a Binance spot pair such as `BTCUSDT`, and select **Start depth**. No API key is needed. Binance availability and regional restrictions still apply.

Choose 10, 20, 50 or 100 levels per side. Both ladders put the best price first. Each row shows price, resting size and cumulative size from the best price outward. The step chart plots cumulative displayed size against distance from the mid price in basis points. Prices use the pair's quote asset and quantities use its base asset; BTCUSDT means USDT prices and BTC sizes.

The summary shows:

- **Mid:** `(best bid + best ask) / 2`.
- **Spread:** `best ask − best bid`, also expressed as `spread / mid × 10,000` basis points.
- **Displayed imbalance:** `(sum displayed bids − sum displayed asks) / (sum displayed bids + sum displayed asks)`. This is a signed percentage from −100% to +100%. Changing the displayed level count changes this measure.

Resting quantities are orders available at the observed time, not executed volume or guaranteed fills. Cancelled orders disappear. The existing **Executed trades** view continues to provide footprints, aggressor delta, CVD and trade-volume profiles.

## Ownership and lifecycle

One depth monitor belongs to the desktop's shared data service, or the exclusively owned standalone MCP service. Starting the same symbol again reuses it; applying another symbol replaces that book. It is independent of candle/trade streams, comparison charts, watchlists and alerts, and never changes the primary research dataset.

Navigation does not stop an explicitly started depth feed. **Stop depth** clears its prices and closes its connection. Quitting the owner stops it; there is no automatic restart, background daemon. Since v0.13.0, [explicit depth recording](depth-recording.md) saves sampled snapshots separately. Named chart layouts do not restore or switch this separate monitor.

## Synchronization and coverage

The implementation follows Binance's [local order-book procedure](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md#how-to-manage-a-local-order-book-correctly):

1. Open `wss://data-stream.binance.vision/ws/<symbol>@depth@100ms` and buffer diffs.
2. Fetch `https://data-api.binance.vision/api/v3/depth?symbol=<SYMBOL>&limit=1000` with a 15-second deadline.
3. Discard diffs already included in `lastUpdateId`. Require a diff covering the next update ID before displaying the book.
4. Apply absolute replacement quantities. Zero removes a level. Overlapping sequence ranges are accepted, duplicates ignored, and a missing sequence discards the book and starts synchronization again.

The REST snapshot covers at most 1,000 levels per side. The service retains updates only inside its known price boundaries: bids at or above the snapshot's lowest bid, asks at or below its highest ask. It excludes isolated updates beyond those boundaries because unchanged outer orders remain unknown. The UI and MCP report the boundaries and retained counts; fewer than the requested number of levels may be available. An exhausted side causes a fresh snapshot. **This is bounded depth, not the complete exchange book.**

Malformed data, crossed books, sequence gaps, disconnects and capacity limits clear all levels. Reconnects use 1–30 second exponential backoff. The buffer is capped at 2,000 events / 8 MB, and each maintained side at 10,000 levels. No more than 100 levels per side leave the service in a snapshot.

A book is stale after five seconds without an accepted fresh update, based on both exchange event and local receipt timestamps. Stale/unsynchronized snapshots contain empty ladders and null price metrics. The UI independently checks cached snapshot age. After 15 seconds without progress, the watchdog reconnects. Future events beyond five seconds are rejected; an inaccurate system clock can therefore prevent synchronization. A quiet pair can be marked stale even if the connection is open.

Exchange updates arrive at 100 ms when the book changes. The UI reads the shared service every 500 ms while this view is visible; this is a research display, not an execution latency guarantee. Gap counts and the last exchange timestamp remain visible. There is no reconstruction of liquidity during a disconnect.

## MCP

Use the existing [desktop MCP connection](desktop-mcp.md). Read access exposes:

```json
{"name":"depth_snapshot","arguments":{"limit":20}}
```

The result includes provider, spot symbol, status, `active`, `stale`, error, event/receipt times, resynchronization count, update ID, units, coverage, ladders and metrics. A read never starts a connection. Limits are 1–100.

Enable **stream permission** before requesting:

```json
{"name":"depth_start","arguments":{"symbol":"BTCUSDT"}}
{"name":"depth_stop","arguments":{}}
```

Clients share the same book as the desktop. Closing a client or revoking its access does not stop an already running monitor; stop it explicitly in the app. These tools do not place orders.

## Verification and remaining work

Fixtures cover absolute size replacement/deletion, cumulative calculations, sequence overlap/gaps, buffered synchronization, stale events, reconnects, symbol switches, late REST responses, buffer limits and MCP permissions. Browser tests cover both themes, ladder scrolling, preserved drafts and navigation. Native Electron/installed macOS smoke tests check that desktop IPC and attached MCP share the actual book while exchange transport is deterministic. An opt-in public-network smoke script is available as `npm run smoke:depth`.

[Sampled recording, heatmaps and replay](depth-recording.md) are available in v0.13.0. Price grouping, additional venues, futures depth, order entry, queue position, iceberg inference and historical depth backfills remain follow-up work. A current order book cannot reconstruct historical liquidity.
