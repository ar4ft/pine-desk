# Research reliability upgrade — v0.7

The priorities are reproducible data, honest validation, explicit execution assumptions, and reliable desktop builds. Open **Workspace** to collect data, **Backtests** to validate Pine strategies, **Crypto options** for archived option studies, and **Education** for interactive pricing. Workflow links connect data, strategy, validation and comparisons. Quality panels show source, observed times, missing fields and gaps.

## Data and history

Binance history now paginates up to 50,000 settled candles. Choose History bars before Load market. The forming candle remains outside research data. Historical requests are bounded to 60 seconds; provider restrictions or limits cause visible errors.

Option payloads are atomically gzip-compressed. Existing uncompressed archives remain readable and their content hashes are checked. Defaults allow 50,000 observations / 2 GB of compressed payloads; indexes and saved runs take additional space. Nothing is automatically deleted. Filter history by source, underlying and UTC range; pages show 500 records. Coverage reports date ranges, median cadence and unusually long gaps. A recorder collects fresh public chains only while explicitly running.

Deribit can additionally stream up to 100 near-index contracts in the chosen expiry through **Live expiry quotes**. Selected ticker and currency trades remain subscribed. Every subscription must be acknowledged. Each row keeps its own event timestamp and depth; untouched rows retain REST times. The REST snapshot time does not advance when a subset receives ticks. These are asynchronous quotes, not a simultaneous complete book. A genuine ETH stream with five additional contracts was checked on October 2, 2026. Bybit/OKX adapters remain fixture-tested because their live endpoints return 403 here.

## Pine validation and warmup

**Validate bias & warmup** compares full runs with sampled historical prefixes and different starting histories. It checks up to 20 numeric plots and sampled equity points, capped at 10,000 candles and five executions. A difference requires investigation; no difference is not proof that a strategy is free of lookahead, repainting or selection bias. Last-bar behavior and indicator initialization can legitimately differ.

Walk-forward studies accept 0–5,000 warmup bars (desktop default 100, API default 0). Only earlier candles are prepended. Indicators compute during warmup, while `strategy.entry` and `strategy.order` remain blocked; entries become eligible at the test boundary. Source is preserved without rewriting. Each fold resets positions and capital. Stitched equity compounds normalized mark-to-market fold returns as a **modeled composite**, without carrying positions or charging hypothetical boundary liquidations. Inspect the individual fold evidence as well.

Continuous markets require contiguous bars. For session data, supply an explicit calendar:

```json
{"timeZone":"America/New_York","startMinute":570,"endMinute":960,"weekdays":[1,2,3,4,5],"closedDates":["2026-01-01"],"earlyCloses":{"2026-11-27":780}}
```

Missing in-session bars still fail validation. Holidays and early closes are user-supplied, not an automatically maintained exchange calendar. Nested validation, state carry and multiple-testing correction are not implemented.

## Rule-driven option studies

Select 3–2,000 archived observations with matching exchange, underlying and settlement; total source input is capped at 100 MB. Open **Rule-driven options strategy**, choose a template and set DTE, absolute delta and quantity. Advanced settings are explicit JSON:

```json
{
  "template":"call-calendar", "targetDTE":30, "minDTE":7, "maxDTE":90,
  "targetDelta":0.5, "quantity":1, "entryEvery":1,
  "maxHoldDays":7, "exitDTE":2, "profitTarget":0.5, "stopLoss":1,
  "latencyMs":0, "sizePolicy":"reject", "liquidityFraction":0.5,
  "feeBps":10, "slippageBps":5, "maxAgeMs":60000,
  "marginModel":"stress", "stressDown":0.5, "stressUp":1.5,
  "hedgeDelta":false, "hedgeFeeBps":5
}
```

Templates: long call, long put, straddle, strangle, call/put debit spreads, iron condor and call calendar. Contract selection uses the signal observation only; entry fills require a later observation even at zero configured latency. Exit triggers use the current observation, with configured delay before execution. Re-entry selects fresh contracts after closing a position. Quotes/IV timestamps after their observation are excluded, with no future clock-skew allowance in historical execution. Missing, crossed or stale held quotes fail the study rather than silently filling a model price.

Quantities are signed **underlying units** across adapters, including shares for imported US options. A standard US contract is 100 shares, so use quantity 100 for one contract. Quote sizes are normalized to the same units. `ignore` assumes sufficient liquidity, `reject` requires quoted depth, and `partial` retains unfilled quantities. Independent partial fills can leave an unbalanced spread. Displayed top-of-book size is not proof of historical executable liquidity, queue position, or simultaneous leg fills.

Premium fees default to user-set basis points. Optional `feeModel:"underlying-capped"`, `underlyingRate` and `premiumCap` model a fee on underlying notional capped by premium; these are assumptions, not a verified exchange fee schedule. Static reserve and two-point stress margin are research gates, not venue margin or liquidation engines.

Optional delta hedges are synthetic index-price exposures with configurable fees. They do not use traded hedge quotes, funding, basis or order-book fills. Supply actual funding separately if applicable. Expiry requires a user-supplied fixing and source, keyed by exact expiry milliseconds:

```json
{"1793385600000":{"price":105,"source":"User supplied official fixing reference"}}
```

Imported USD options can specify `exerciseStyle:"american"` and `settlementType:"physical"`. Exercise/assignment events are explicit, not inferred:

```json
[{"time":1793300000000,"instrument":"O-SPY…","quantity":100,"kind":"exercise","source":"User supplied event"}]
```

Use negative quantity and `kind:"assignment"` for held shorts. Exercise delivers signed shares and strike cash; dividends use a separate `[{"time":...,"amount":0.5}]` per-share ledger. Terminal share disposal uses the observation index as a proxy with fees/slippage. Corporate actions, adjusted deliverables and exercise probabilities are not modeled automatically.

Studies run in a bounded background worker with a 60-second deadline. Saved evidence includes rules, selected quote rows, source hashes, fills, hedges, lifecycle events and remaining exposure. Compare 2–6 saved runs on identical times/index prices. Weighted allocation normalizes their independent starting capital; it does not share buying power, fills or cross-margin.

## Licensed US history preparation

Get a key and the required historical options quote / underlying aggregate entitlements from [Massive](https://massive.com/docs/options). Configure **Massive API key** in Settings. The standalone MCP process uses `MASSIVE_API_KEY`; it cannot unlock the desktop encrypted vault. Confirm provider subscription, permitted use and historical coverage for your requested dates.

The backfill form accepts one underlying, 1–8 explicitly specified standard 100-share contracts and up to seven days, sampled every 60–3,600 seconds. Example specification:

```json
[{"ticker":"O:SPY261030C00500000","strike":500,"type":"call","expiry":1793385600000,"exerciseStyle":"american","settlementType":"physical","contractSize":100}]
```

Use the real contract metadata and exact AM/PM expiry timing; the example is only a format illustration. The adapter checks provider reference metadata and rejects adjusted deliverables. It combines prior SIP quote events with the last fully closed, unadjusted one-minute underlying bar, avoiding future bars. Quote sizes become shares. IV is fitted from midpoint using the supplied rate (desktop zero) and zero dividend yield, not provider-reported IV; OI is unavailable. It does not reconstruct historical full chains. Archives are marked imported/source-unverified, with quote times and coverage retained.

The official endpoints/authentication and normalization are fixture-tested. Paid entitlement and production response behavior remain unverified without a key. No paid request runs automatically.

## Education and process boundaries

Education now offers European BSM and an independent American CRR tree with optional cash dividends. American values use approximate tree pricing and finite differences; higher Greeks are deliberately unavailable. Cash dividends use an escrowed approximation, not a full discrete-dividend PDE.

Pine backtests run in a child process with a 512 MB heap bound, 30-second deadline, reduced environment, Node permission restrictions and a VM without host process/require. External backtest fetches are denied. This improves failure isolation and limits ordinary access; **only execute trusted scripts**. Node's permission model and VM are not an OS security sandbox. Chart execution remains in the browser worker with its own CSP and timeout.

Mac shutdown now permits the final quit after a bounded persistence flush. Desktop smoke has stage logs, a watchdog, bounded close and failure artifacts. CI runs unsigned Intel and Apple Silicon jobs independently. Signing/notarization remains exclusive to the manually dispatched release workflow after Apple secrets are configured.

## GitHub comparison and remaining gaps

Reviewed public repository descriptions and documentation on October 2, 2026. Concepts were implemented independently; no source was copied.

| Reference | Useful benchmark | Pine Desk result / remaining gap |
| --- | --- | --- |
| [Freqtrade](https://github.com/freqtrade/freqtrade) | Lookahead/recursive checks, separate optimization and evaluation | Sampled prefix/startup audits, historical warmup and walk-forward; fewer statistical tests and no live execution |
| [Optopsy](https://github.com/goldspanlabs/optopsy) and [Optopsy MCP](https://github.com/goldspanlabs/optopsy-mcp) | Options selection/lifecycle, archived data and agent tools | Eight rule templates, exits, calendars, explicit events, partial fills and MCP; fewer strategies, no wheel DSL or option-specific optimizer |
| [NautilusTrader](https://github.com/nautechsystems/nautilus_trader) | Event-driven execution, venue models and large data | Stronger quote evidence and bounded workers; no comparable order-book/venue liquidation simulator |
| [LEAN](https://github.com/QuantConnect/Lean) | Security models, exchange calendars, options lifecycle | Explicit session/calendar and lifecycle inputs; no automatic corporate actions or maintained venue models |
| [OpenBB](https://github.com/OpenBB-finance/OpenBB) | Provider normalization and entitlement-aware connectors | Capability/quality reports and prepared licensed connector; a much smaller provider range |
| [Original options projects](options-project-review.md) | Deribit exploration, surface research and interactive education | Independent implementations now extend to bounded expiry streams and American education |

The largest remaining gaps are licensed long-range data validation, real venue margin/fill verification, portfolio state carry, option-specific parameter optimization/statistical validation, and broker execution. Those require additional implementation or external data; the app does not claim parity with these projects.

MCP additions: `provider_capabilities`, `data_quality`, `strategy_validate`, `option_history_coverage`, `option_strategy_backtest`, `option_run_summary`, `option_compare_runs`, `option_history_backfill`. Existing tools remain available. Consult their schemas for exact input fields.
