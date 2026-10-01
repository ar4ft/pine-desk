# Themes, layouts, watchlists and source files

## Appearance

Open **Settings → Appearance** to select dark, light, or system appearance. System follows macOS light/dark changes while the app is open. Choose up/down candle colors and a Pine editor font size from 10–22 pixels, then **Apply appearance**. Restore defaults resets these preferences. Preferences are stored in `ui-config/current.json` in the app data directory and apply to workspace, Options and Edge Stats charts. Editor and app surfaces follow the same theme. Options trade/GEX colors retain their separate classification meanings.

Changing appearance preserves editor drafts and chart calculations. Explicit Pine plot colors are part of the script and are not recolored as candle colors.

## Last workspace and named layouts

The last editor draft, name, editor visibility, page, research base inputs, cost settings, chart range, drawings and chart indicator settings are saved automatically in the desktop renderer's local storage. Window size and position are saved separately in the application data directory. Reload/reopen the same installed app to restore these settings. Development and packaged app renderer origins have separate automatic session storage.

Named layouts are saved from the workspace toolbar. Enter a name and click **Save layout**; choose one and click **Open** to restore it, or **Delete** to remove that saved layout. Names do not overwrite an existing layout automatically. Up to 20 named layouts and 12 chart indicators per named layout are supported. Each includes:

- The settled OHLCV dataset, symbol/timeframe and source label at save time (up to 50,000 candles).
- The editor draft and name, editor visibility, strategy costs and research base inputs.
- Chart range, drawings, native/Pine indicators with inputs and declaration properties, visibility, and pane grouping/order/collapse/maximize state.

Restoring a named layout uses its historical candle snapshot and stops Binance and Unusual Whales streams. It does not resume live connections. Start live explicitly to update it. Saving while streaming excludes the forming candle from the saved dataset. Dataset source labels preserve synthetic/imported/provider origin. Provider API keys and credential fields are excluded from layout/session snapshots.

Pine indicators that you previously ran are restored and re-executed against the restored candles; an editor draft alone is not executed. Restoration has a 30-second total deadline and displays failures; an overlong restore disables automatic chart indicator restoration for the current session while retaining the named layout on disk. Native volume-profile dependencies may be unavailable for a candle-only snapshot.

Changing market/timeframe preserves indicator configuration, recalculated over the new candles. Drawings and the old viewport are restored only for the same symbol/timeframe. Current options provider overlays are attached separately for an exact matching underlying; they are not saved as historical options exposure. Window/panel pixel sizes and a saved backtest result selection are not part of the named chart layout.

## Watchlists

The workspace watchlist stores up to 50 entries with explicit **provider, symbol and timeframe**. Add Binance spot markets (e.g. BTCUSDT, ETHUSDT) or Unusual Whales underlyings (e.g. SPY, AAPL). Different providers/timeframes are distinct entries; exact duplicates are rejected.

Click an entry to load its market snapshot. Binance entries load settled public candles into the workspace. Unusual Whales entries open its Options chart and require your API token. Clicking does not start streaming. Use the normal live buttons afterward.

**Refresh Binance quotes** fetches price and rolling 24-hour percentage change on request, with retrieval time and per-symbol errors. These watchlist quotes do not continuously stream. Unusual Whales context is retrieved when opening its options chart; there is no synthetic or Binance fallback for a stock symbol. Remove an entry with ×. Watchlists persist in `ui-config/current.json`.

## Import .pine and .txt scripts

Click **Import .pine / .txt** beside the editor's Save button. The native file picker accepts plain UTF-8 files up to 200 KB, with a `//@version=5` or `//@version=6` declaration. A UTF-8 BOM is accepted. Invalid encoding, embedded NUL bytes, oversized files and missing/unsupported version declarations are rejected without replacing your editor draft. Cancellation leaves the draft unchanged.

The file's source, comments and license notices are retained, its basename becomes the script name, and filename/import time are saved as provenance. Full local file paths are not recorded. Each import creates a separate saved script. Source loads into the editor **without running it**; use Run chart or Backtest explicitly. `indicator(...)` scripts can render charts; backtests still require a compatible native Pine `strategy(...)` with trade rules. Compatibility depends on PineTS. Scripts are trusted executable input, not a security sandbox.

CSV imports remain separate: OHLCV candles for market history and aggressor-side trades for order-flow research.
