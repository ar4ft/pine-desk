# Reviewed options projects

Reviewed on October 1, 2026. Pine Desk implements standard financial concepts independently in JavaScript; none of these Python apps or their execution/notification services is bundled.

| Project | Inspected revision | License found | Assessment |
| --- | --- | --- | --- |
| [Icefire options workbench](https://github.com/wepoets1107/icefire-options-workbench) | `9abc620cd28da20fa44907118998df9bec193229` | MIT | Best immediate fit: public Deribit chains, smiles/skew, term and forward IV, recent trades, explicit snapshots |
| [Options Eye](https://github.com/wepoets1107/options-eye) | `6b78ea32927185317fd7af832171b25a84993554` | MIT | Useful future research: expiry-slice SABR fits, volatility deviations, strategy candidates and bounded WebSocket collection |
| [Greeks Lab](https://github.com/wepoets1107/greeks-lab) | `dbc03c35055395542619df6f3b735dc444e682b7` | No license file found | Strong education concept; implemented an independent BSM lesson without copying its source or UI |

## Included in v0.5

* Independent interactive Greeks Lab: call/put, six parameter controls, 13 price/sensitivity cards, spot/time/IV curves, explanations, presets, formulas, unit labels and a small exercise.
* Deribit public BTC/ETH inverse-option chain, expiry selection, call/put IV smile, nearest-strike ATM term and adjacent forward-IV observations.
* Exchange-reported selected-contract Greeks with public 100ms WebSocket updates and currency-wide option trade prints.
* Missing-value preservation, separate snapshot/live timestamps and coverage, bounded buffers, visible disconnect gaps and JSON export.
* Local MCP access for public crypto option data and the educational calculator.

Icefire’s call-positive/put-negative GammaMap is explicitly a sign convention. It does not reveal dealer positions. Its finite trade sample cannot establish complete daily flow. Pine Desk retains those distinctions and does not relabel modeled gamma as observed dealer exposure. The “AI brief” is rule-based; it is not a reason to embed a separate LLM service.

Options Eye adds more complexity than a chart adapter: a Python/SciPy SABR calibration stack, candidate strategy classification, optional order execution/hedging, and notification integrations. Its fixed-beta/custom Hagan approximation and calibration need formula/reference checks, liquidity filters, quote-age alignment and out-of-sample validation before use. Cross-sectional IV residual scores and heuristic confidence labels are not calibrated profit probabilities. v0.6 now includes an independent Hagan fit with QuantLib reference checks, held-out residual diagnostics, quote gates and domain checks. Its private trading and messaging features are outside this implementation.

Greeks Lab’s slider/curve teaching concept is useful. With no license file found, its source is not copied or redistributed. Pine Desk’s formulas are independently written from standard Black–Scholes–Merton identities, with reference-price, parity and finite-difference verification.

## Suitable follow-up work

v0.6 includes persisted/importable chain snapshots, independent recording, comparisons, fixed-beta SABR fitting, bracketed 25-delta skew, modeled gamma scenarios, six strategy templates, same-expiry multi-leg scenarios and a separate archived bid/ask replay engine. Replay includes settlement-currency accounting, explicit fee/slippage settings, supplied funding, static margin reserves and an explicit settlement fixing on expiry. Missing/stale quotes stop the run. This is separate from the Pine candle engine.

Follow-up work remains for historical provider backfill, executable-depth/simultaneous fills, portfolio hedge execution, exchange-specific dynamic margin/liquidation and automatic settlement-fixing verification. Private order execution, automated hedging and notification services from Options Eye are not bundled.

Public market data access, open-source licenses and trading-account permissions are separate. MIT reuse is possible with the upstream copyright/license notices if code is adopted later. No upstream code was adopted in this revision.

Bybit and OKX adapters are implemented with fixtures and explicit REST polling. Their production endpoints still return HTTP 403 from this environment, so live connectivity is not asserted. See [option research](option-research.md).

## v0.7 follow-up

Compressed archives, bounded expiry streams, rule selection/exit/calendar studies, explicit American lifecycle events, partial fills, modeled hedges and a licensed historical connector are now implemented independently. Venue margin/liquidation and historical execution verification remain open. See the [broader GitHub comparison and implementation limits](research-reliability.md#github-comparison-and-remaining-gaps).
