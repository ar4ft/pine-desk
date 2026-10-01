# Crypto options and interactive education

Pine Desk v0.5 adds **Greeks Lab** and **Crypto options**. These work independently of Unusual Whales and the optional Whale Options engine. Deribit public data requires no key or account credentials. The integration reads market data; it does not submit orders or access positions.

## Greeks Lab

Choose a call or put, then change spot, strike, days to expiry, IV, rate and dividend yield using numbers or sliders. Select any of the 13 price/sensitivity cards to plot it against spot, remaining time or volatility. Hover observations for values. ATM, near-expiry and put presets plus a short exercise help explain the changes. Model inputs stay in memory while navigating; they are not saved across restart.

The independent implementation uses Black–Scholes–Merton European pricing with continuous rates/dividend yield and 365 calendar days per year. Price is in quote units **per one underlying unit**. Inputs use percent for IV, rates and yield. Domains exclude zero time/volatility and reject non-finite values; an invalid field clears the results rather than retaining a previous calculation.

| Value | Display convention |
| --- | --- |
| Premium | Model quote units per underlying unit |
| Delta | Premium derivative per spot unit |
| Gamma | Delta derivative per spot unit |
| Vega | Premium derivative per IV percentage point |
| Theta | Premium derivative per elapsed calendar day |
| Rho | Premium derivative per rate percentage point |
| Vanna | Delta derivative per IV percentage point |
| Vomma | Displayed Vega derivative per IV percentage point |
| Charm | Delta derivative per elapsed calendar day |
| Speed | Gamma derivative per spot unit |
| Color | Gamma derivative per elapsed calendar day |
| Zomma | Gamma derivative per IV percentage point |
| Ultima | Displayed Vomma derivative per IV percentage point |

For decimal volatility, raw first/second/third derivatives are scaled by 100, 10,000 and 1,000,000 respectively. Time derivatives use elapsed time, reversing the sign of derivatives with respect to remaining maturity. Higher Greeks use analytic formulas. Standard-normal CDF uses a polynomial approximation; this is an educational calculator rather than an exchange pricing engine. Reference prices, put-call parity and **all displayed sensitivities** are tested against independent finite differences.

No American exercise, stochastic volatility/jumps, inverse settlement, fees, executable spread, portfolio hedge or multi-leg fill model is implied. Delta is local sensitivity, not a guarantee of exercise or an observed probability. Large input changes need full repricing.

## Deribit workflow

1. Open **Crypto options**, choose BTC or ETH, and click **Refresh chain**.
2. Choose an expiry. Inspect the call/put mark-IV smile, ATM term structure and chain. The table shows up to 200 contracts nearest the snapshot index; JSON export includes all returned active inverse contracts.
3. Click a contract to fetch its current ticker, including exchange-reported Delta/Gamma/Vega/Theta/Rho.
4. Click **Start live contract & trades**. A single connection subscribes to `ticker.{instrument}.100ms` and `trades.option.{currency}.100ms`. Streaming status requires acknowledgment of both channels. No raw/authenticated channel is used.
5. Stop, switch contract or refresh to end the previous connection. A currency-selector change takes effect on Refresh; the displayed snapshot keeps its original currency until that succeeds.
6. Export JSON to retain chain, source times, contract metadata, ticker, trades and gaps.

**Coverage:** full instruments/summary REST snapshot; only one selected contract has live Greeks/quotes. Chain, index and IV curves stay snapshots until Refresh. Selecting a contract stops the previous stream. Expiries and newly listed contracts are discovered on Refresh. No background connection starts on app launch. Navigating to another section keeps an explicitly started stream running; app shutdown stops it.

A refresh requests the latest 100 currency option trades, without claiming a full session or 24-hour window. Live prints are deduplicated by trade ID and retained up to 1,000; the UI displays the latest 100, all expiries. JSON includes the retained buffer. Heartbeats, acknowledgment timeout and bounded 1–30 second reconnect backoff maintain the connection. Disconnect gaps are visible and are **not replayed**. Last ticker timestamps remain visible through disconnects; they must not be interpreted as current quotes.

Failed refreshes retain prior timestamped core data with an error; no partial response becomes a new snapshot. Data is in memory unless explicitly exported. Public API access remains subject to exchange availability, regional restrictions and rate limits. This app does not bypass access restrictions.

## Units and calculations

Only active **BTC/ETH inverse** instruments with matching base/settlement currencies are included. Linear/USDC options and other assets are not part of this adapter.

* Strikes, underlying forward and index: USD. Premium quote/settlement: BTC or ETH.
* Option trade amount and open interest: underlying asset units. `contract_size` is metadata; do not multiply underlying-denominated amounts by it again. There is no equity-style ×100 multiplier.
* Trade premium USD = premium in settlement currency × amount in underlying units × the **trade's** index price. Missing index means unavailable USD value, not zero.
* Trade buy/sell preserves the exchange-reported direction. It is not an inference of dealer inventory or customer strategy; block-trade interpretation can differ from ordinary on-book taker direction.
* Mark IV is percent. Contract Greeks are raw values from Deribit’s ticker, with timestamps; they are not derivatives of the displayed coin-denominated premium. Deribit Theta uses the smaller of its one-day and remaining-lifetime decay calculation near expiry, so it can differ from the educational instantaneous daily derivative. Individual ticker Delta is Black–Scholes Delta, whereas account DeltaTotal uses net transaction delta. Read [Deribit ticker definitions](https://docs.deribit.com/api-reference/market-data/public-ticker) before using them for hedging.
* ATM IV averages available call/put mark IV at the nearest strike to the snapshot index, within 10%. JSON records strike and observation count. No interpolation, SABR calibration or liquidity filter is claimed.
* Forward IV between adjacent available expiries is `sqrt((IV2²*T2 − IV1²*T1)/(T2 − T1))`, using decimal IV and years. Non-positive variance is withheld with a reason. It is a sampled term observation, not a tradable forward quote.

Existing Unusual Whales GEX/walls remain equity-provider features. This adapter does not infer signed dealer GEX, call/put walls, zero gamma or calibrated trading signals from Deribit OI. Both long calls and long puts have positive model gamma; an arbitrary negative sign for puts is a positioning assumption, not exchange inventory evidence.

## MCP

The existing local stdio MCP exposes:

* `crypto_options_refresh`: BTC/ETH public chain snapshot.
* `crypto_options_contract`: selected-contract ticker/Greeks.
* `crypto_options_start`, `crypto_options_stop`: this process's stream lifecycle.
* `crypto_options_snapshot`: timestamped coverage, ticker, trades, errors and gaps.
* `options_greeks`: educational BSM values with optional 2–201-point curve.

Example calculator arguments:

```json
{
  "model": {"spot": 100, "strike": 100, "days": 30, "volatility": 30, "rate": 4, "dividend": 0, "type": "call"},
  "curve": {"metric": "gamma", "axis": "spot", "points": 101}
}
```

Desktop and stdio run **separate in-memory Deribit sessions**, just like other live feeds. An LLM can fetch its own public session without credentials; it does not automatically read the desktop stream. Setup is in [custom scripts and MCP](custom-scripts-and-mcp.md).

## Other crypto options exchanges

| Exchange | Public API route | Current Pine Desk status |
| --- | --- | --- |
| Deribit | [REST / WebSocket docs](https://docs.deribit.com/) | Implemented; BTC/ETH inverse REST + selected live ticker and currency trades verified |
| Bybit | [V5 instruments](https://bybit-exchange.github.io/docs/v5/market/instrument), [tickers](https://bybit-exchange.github.io/docs/v5/market/tickers), `category=option` | Candidate USDC-options adapter; public request returned HTTP 403 from this environment, not implemented |
| OKX | [V5 public market docs](https://www.okx.com/docs-v5/en/#public-data-rest-api-get-instruments), `instType=OPTION` | Candidate adapter; public request returned HTTP 403 from this environment, not implemented |

Bybit/OKX need distinct adapters for instrument IDs, amount/contract multipliers, settlement units, expiry rules, channels and regional availability. A successful Deribit connection does not establish availability elsewhere. Public option history alone does not turn the Pine underlying-candle backtester into an options portfolio engine.

Optional genuine network check: `npm run smoke:crypto`. This contacts production public APIs, verifies both BTC/ETH snapshots and an acknowledged live ticker, then closes its connection. It submits no orders.

For the same check through native Electron IPC, run `npm run smoke:crypto:desktop` after building (requires a display on Linux). Screenshots are written to ignored `test-results/`.
