# Continuous Binance market data

Open Workspace, choose a Binance **spot** symbol such as BTCUSDT and a timeframe, then click **Start live**. No account or API key is needed for this public market-data endpoint. The app uses Binance's public `data-stream.binance.vision` WebSocket combined stream for klines and **raw trades**, plus `data-api.binance.vision` REST candles for synchronization.

The status strip shows connecting, synchronizing, streaming, reconnecting or stopped, the last received event, retained trade count, errors and gap warnings. **Stop live** disconnects and keeps settled candles. Loading another market/CSV or restoring a saved backtest stops the current stream. A stream does not restart automatically after app restart. Network and regional restrictions can make public Binance endpoints unavailable; failures remain visible and never substitute synthetic data.

Comparison charts can follow other markets concurrently, and watchlists have a separate combined ticker stream. See [linked charts and live watchlists](linked-charts.md) for subscription sharing, buffer limits and saved-grid behavior.

## Candle handling

The stream connects before requesting the latest 1,000 REST candles and buffers events during synchronization. The forming REST candle is excluded. As live kline events arrive, forming candles update the chart but only `x=true` closed candles enter the persisted research dataset. Live candles and scripts share Vela's public MarketDataFeed streaming port; chart ticks do not replace your editor document.

The desktop samples the backend snapshot once per second for display. Binance trade events are recorded continuously in the main process, independently of renderer sampling or which page is open. The chart shows the forming candle separately; backtests and research freeze settled candles at invocation. Starting a stream does not turn a strategy into broker execution.

Connections retry with exponential backoff from 1 to 30 seconds. On reconnect, REST reconciles recent candles. A stream with no messages for 30 seconds is treated as stale and reconnected. Missed raw trades are **not** reconstructed from candles or fetched retroactively. Missing IDs/disconnects are flagged. Candle gaps remaining after REST reconciliation stay visible and parameter studies reject non-contiguous candle snapshots. A very long outage can exceed the REST lookback, so reload/import a complete dataset before research.

History begins with at most 999 settled bars from the initial 1,000-candle request and grows to a maximum 50,000 settled bars. This is not unlimited historical backfill. Saved runs and studies retain their own immutable snapshots; changing the stream cannot change an already running study.

## Live order flow

With a stream running, open **Order flow** and select **Live Binance retained window**. Choose aggregation and price bucket size. CVD, the latest footprint and the volume profile refresh about every two seconds while that page is open. **Save live trade snapshot** stores the retained trades for offline use in the imported/saved source.

Binance raw trade `m` means **buyer is maker**:

* `m=true`: seller is the aggressor → sell volume.
* `m=false`: buyer is the aggressor → buy volume.

The app requires that boolean, positive prices/quantities and valid trade IDs. It rejects malformed events, deduplicates trade IDs and flags skipped IDs. Sides are not inferred from price movement or candles. Quantities are base-asset units for spot markets.

Only the most recent **50,000 raw trade prints** are retained. CVD restarts at the beginning of that retained window as older prints leave it; the profile covers the same window. Neither is a whole-market or full-session total. Disconnects create incomplete coverage, and the UI/export preserves gap warnings. Trade recording remains in memory until you explicitly save a snapshot. Sparse/missing time intervals are omitted. Imported trade CSVs remain an independent source.

This implementation does not include futures, depth/order books, liquidation feeds, unlimited tick storage, trade-gap backfill or additional streaming providers. Existing Whale Options feed adapters remain available through its separate engine.

## Local price alerts

[Persistent local alerts](local-alerts.md) evaluate public Binance ticker observations in the owning service, with saved rules, cooldowns, session/expiry gates and trigger history. They share watchlist ticker subscriptions and do not consume every raw chart trade.

## MCP

The stdio server adds `live_start`, `live_status`, `live_stop`, `live_order_flow` and `live_save_trades`. **In desktop mode these tools control the desktop connection and read its existing buffer.** Client disconnect does not stop the stream. Standalone mode owns its own connection and must have exclusive ownership of the data directory. Use different `PINE_DESK_DATA_DIR` values for independent sessions. See [desktop MCP setup](desktop-mcp.md).

Check `live_status` and data timestamps before reporting results. Preserve gap and retained-window caveats in any agent summary. Stopping/closing the owning process disconnects its stream.

## Live order book

[Live depth / DOM](live-depth.md) uses a separate public Binance snapshot-plus-diff feed. Start it from Order flow. It shares service ownership with MCP, reports bounded coverage and hides stale or unsynchronized prices. It does not change the candle or executed-trade dataset.
