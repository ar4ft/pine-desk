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

Options Eye adds more complexity than a chart adapter: a Python/SciPy SABR calibration stack, candidate strategy classification, optional order execution/hedging, and notification integrations. Its fixed-beta/custom Hagan approximation and calibration need formula/reference checks, liquidity filters, quote-age alignment and out-of-sample validation before use. Cross-sectional IV residual scores and heuristic confidence labels are not calibrated profit probabilities. A future integration should begin with audited smile fitting and transparent diagnostics. Its private trading and messaging features are outside this implementation.

Greeks Lab’s slider/curve teaching concept is useful. With no license file found, its source is not copied or redistributed. Pine Desk’s formulas are independently written from standard Black–Scholes–Merton identities, with reference-price, parity and finite-difference verification.

## Suitable follow-up work

Historical option snapshot storage would enable quote-age-aware surface research and comparisons. Audited SABR fitting, 25-delta skew with explicit interpolation, and multi-leg payoff/risk modeling can build on that data. An options backtester additionally needs archived bid/ask chains, contract specifications, expiry/settlement, funding/margin and multi-leg execution assumptions; the current Pine candle engine cannot supply those.

Public market data access, open-source licenses and trading-account permissions are separate. MIT reuse is possible with the upstream copyright/license notices if code is adopted later. No upstream code was adopted in this revision.
