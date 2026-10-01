# Options charts and Unusual Whales

Pine Desk connects directly to the documented Unusual Whales REST and WebSocket APIs. Add your token in **Settings → API credentials → Unusual Whales API token → Save credentials**, then open **Options chart**. Choose a ticker and intraday timeframe, and load a snapshot or start live options. You can prepare this without credentials; missing keys and endpoint entitlements are shown as errors, not synthetic fallback data.

Create/manage tokens at https://unusualwhales.com/dashboard/api. API access is sold separately from some website plans: https://unusualwhales.com/pricing?product=api. Consult https://api.unusualwhales.com/docs for current endpoint availability and quotas. The current options-trade WebSocket documentation requires the appropriate Advanced or enterprise entitlement. No subscription purchase is made by Pine Desk.

## What is displayed

- **GEX by strike:** signed `call_gamma_oi`, `put_gamma_oi` and their sum from `/api/stock/{ticker}/spot-exposures/strike`. Values are dollars of assumed dealer gamma exposure per 1% underlying move. Calls and puts keep the provider's signs. REST pages are collected until an empty page; a 20-page/60-second bound fails visibly rather than displaying a truncated new total. The graph displays up to 200 strikes nearest the latest reported spot; JSON exports include all returned strikes.
- **Call wall:** the provider's strike **above spot with the largest positive net GEX**.
- **Put wall:** the provider's strike **below spot with the largest positive net GEX**. This definition is not “the strike with the most put OI” or “the most negative put gamma.”
- **Gamma flip / zero crossing:** `gamma_flip` from `/api/stock/{ticker}/gex-levels?source=oi`, preserving null and nearby crossings. This is the provider's **cumulative strike-ladder crossing**, not the root of a full option-chain gamma profile repriced over hypothetical underlying prices. Do not use this level alone to classify a gamma regime. The level method, basis and snapshot timestamp appear alongside the chart. Missing levels produce no line.
- **Live flow markers:** documented `option_trades:TICKER` WebSocket prints. Hover/click for contract, premium, execution time, side and underlying price when available. Ask/bid/mid/unknown tags describe execution side, not opening/closing intent or evidence of an outright bullish/bearish position. Multi-leg prints can be part of spreads. Missing underlying prices are not reconstructed from option strikes.

Dealer positioning is assumed, not observed. Each strike can have a different calculation time; the UI shows the oldest/newest strike times. An unchanged strike can be hours older than another. GEX values, zero-crossing estimates and walls do not establish a forecast.

## Live behavior and limits

The desktop main process opens one fixed-origin authenticated WebSocket (`wss://api.unusualwhales.com/socket?token=…`) with a real User-Agent and joins `option_trades:TICKER` and `gex_strike:TICKER`. Subscription acknowledgements must succeed before status becomes **streaming**. The token is required in the provider's WebSocket URL; it is not returned to the renderer, logged, or included in exports. REST uses an Authorization bearer header and rejects redirects.

The buffer holds the latest 2,000 unique prints. Markers show up to 500 qualifying prints within the actual chart candles; the table shows the latest 100 above the premium floor. Markers outside displayed candle spans are omitted, including closed-session gaps. Filters do not change the recorder's capture. This edition does not persist an unlimited options tape.

Strike updates arrive live. Underlying OHLC and provider levels refresh through REST every **30 seconds**, with a reconnect refresh. Underlying candles include the forming candle for display; this is not a tick-by-tick underlying price subscription. A typical cycle uses at least four REST requests, including the terminating empty GEX page. Quotas apply. Rate limits, 503 loading responses, auth failures and partial endpoint failures stay visible; refresh can retain the last successful snapshot with its original timestamps and a current error.

Connection health uses protocol pings/pongs, reconnects with bounded exponential delay, and flags disconnect gaps. Unusual Whales does not replay missed WebSocket prints or intraday GEX updates. A reconnect restores the latest REST snapshot, not the missing tape. Quiet periods are possible outside trading hours. Stop cancels timers, pending requests and the socket; streams do not resume automatically after app restart.

Options overlays are installed on the Options chart and on the main workspace **only when the underlying ticker matches exactly**. SPY levels never appear on BTCUSDT or QQQ. Toggles and premium filters apply to these overlays. Import matching stock OHLCV into the workspace to combine its Pine script with the options snapshot. Snapshot overlays describe their calculation time; they are not historical levels valid throughout an old chart.

Options display data does not replace your stored research candles. Options contracts, multi-leg positions, exercise and expiration are not supported by the Pine underlying-asset backtester.

## Credential storage and MCP

The Electron main process encrypts credentials with `safeStorage` (macOS Keychain-backed encryption); only ciphertext is written to the application data directory, with owner-only file permissions. The UI receives saved/not-saved status, never decrypted keys. Blank credential fields keep saved values; **Remove saved key** deletes the stored credential. Unencrypted Linux `basic_text` fallback is rejected. Secrets are not stored in localStorage, source scripts, backtest runs, engine JSON configuration or exported snapshots. Environment credentials override saved Unusual Whales keys when explicitly configured.

Local MCP exposes `options_refresh`, `options_start`, `options_snapshot` and `options_stop`. The standalone Node server cannot decrypt desktop credentials: give that process `UNUSUAL_WHALES_API_KEY` in its MCP environment. Its connections and buffers are separate from the desktop. Do not open simultaneous desktop/MCP connections with the same token; the provider documents one machine per token and connection restrictions. Credential writes and engine-launch controls are not MCP tools.

Unusual Whales also offers its own hosted MCP at https://unusualwhales.com/public-api/mcp, independently of Pine Desk's local tools. Authentication follows the provider's documentation.

## Whale Options credentials

LuxAlgo Whale Options uses the selected market-data vendor's credentials; there is no universal LuxAlgo “Whale API key.” Settings provides Tradier, Massive and Alpaca credentials and optional engine management. See [Whale Options setup](whale-options.md). This connection is separate from Unusual Whales and has separate licensing and timeliness.

## Validation

Automated fixtures exercise REST pagination, errors and token redaction, WebSocket joins, signed GEX updates, deduplication, bounded buffers, gaps, side classification and OS-vault refusal. Browser tests inspect actual Vela price-line output and timeline marks, including ticker mismatch and toggles. The managed upstream Whale Options engine has been checked with its genuine synthetic feed. Authenticated Unusual Whales/live licensed vendor acceptance checks must be performed with your credentials; no paid token was available during development.
