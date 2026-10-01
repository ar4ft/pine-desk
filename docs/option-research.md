# Option research and historical quote replay

Pine Desk v0.6 adds persistent chain history, an independent snapshot recorder, surface calibration, multi-leg models and a separate option quote-replay engine. Open **Crypto options** and scroll below the market explorer. This extends the useful public-data/research concepts from the [reviewed projects](options-project-review.md); no upstream Python app, trading executor or notification service is bundled.

## Exchanges and units

| Provider | Supported series | Premium/settlement | Amount and OI normalization | Updates |
| --- | --- | --- | --- | --- |
| Deribit | BTC/ETH inverse options | BTC/ETH | Already underlying units; do not multiply by contract size again | Selected ticker + currency option-trades WebSocket; full chain remains snapshot |
| Bybit | BTC/ETH options with selected USDC or USDT settlement | Selected stablecoin | Underlying units; IV decimal converted to percent | Full public REST chain/trades, optional 30-second polling |
| OKX | BTC-USD / ETH-USD inverse options | BTC/ETH | Contract counts × `ctVal` × `ctMult` once; retain original OI/count | Full public REST chain, optional 30-second polling; trades only for selected contract |

Bybit and OKX public endpoints returned HTTP 403 here. Their parsing, units, errors and polling lifecycle are fixture-tested; actual live connectivity is **not verified**. The app does not bypass geographic restrictions or try alternate private endpoints. All market adapters are read-only and require no API key. USDC/USDT values are treated at one USD parity for research, not through a live FX feed. OKX trade USD premium uses the selected snapshot index as an estimate; its trade endpoint does not supply a trade-time index in this adapter.

Switch exchange, base and (Bybit) settlement, then Refresh. No connection starts automatically. Explicit live mode uses the update method in the table. Errors retain previous timestamped data rather than manufacturing a replacement chain. Contract specifications, settlement and quantity units remain part of every normalized row.

## Save, record and import observations

**Save current snapshot** persists the currently loaded complete chain; refresh first if it is older than one minute. **Start recording** fetches fresh full chains at 60–3,600-second intervals (default five minutes), independently of the selected live ticker. Recorder status reports captures and errors. Stop or quit to end recording; it does not restart automatically. A stopped capture will not begin a later save, though a save already in progress can finish.

History is shared between desktop and local MCP through the same data directory. Atomic documents and an interprocess writer lock prevent concurrent recorder/index updates from losing records. Storage stops at **200 snapshots or 100 MB**; it does not automatically delete previous history. Export and delete selected rows to free space. Recording status and market connections belong to each process separately.

Choose history rows to export, compare, or replay. **Use** displays an archived chain and makes it the fit/model source; live connection controls remain disabled until Refresh. Imported data is marked **source not verified**. Saved quote replays freeze the used contract rows, source hashes, timestamps, configuration and fill ledger, so deleting source archives does not erase a replay's evidence.

Archives are UTF-8 JSON (native file picker, maximum 25 MB):

```json
{
  "schemaVersion": 1,
  "snapshots": [
    {
      "exchange": "deribit", "currency": "BTC", "settlement": "BTC",
      "spot": 100, "fetchedAt": 1790812800000,
      "rows": [
        {
          "instrument": "BTC-30OCT26-100-C", "type": "call", "strike": 100,
          "expiry": 1793347200000, "currency": "BTC", "settlement": "BTC",
          "premiumCurrency": "BTC", "payoffType": "inverse",
          "quantityUnit": "underlying", "contractSize": 1,
          "bid": 0.03, "ask": 0.032, "mark": 0.031, "iv": 40,
          "oi": 10, "underlying": 100,
          "quoteAt": 1790812800000,
          "quoteTimeKind": "Imported observation"
        }
      ]
    }
  ]
}
```

These illustrative prices are synthetic. Actual app exports include record IDs, hashes and source metadata; the importer accepts either exported record wrappers or bare snapshots. Each chain must have at least one active contract **at its observation time**, consistent base/settlement, distinct contract IDs and finite non-negative fields. Unknown fields are discarded. Missing bid/ask/IV/OI stays null, not zero. Crossed or otherwise unusable quotes can remain as evidence; research filters exclude them.

No historical lookback is downloaded or fabricated. The recorder starts collecting now. Public recent trades do not reconstruct historical chains; import properly sourced archived bid/ask observations for longer backtests.

## Surface fits, skew and gamma

Select an expiry and configure fixed beta, minimum OI, maximum spread/mid and maximum observation age. Click **Fit SABR & analyze expiry**.

The independent model implements the Hagan 2002 **lognormal SABR** approximation with its full `(F*K)^((1−beta)/2)` factor and time correction. ATM/near-ATM continuity and wing outputs match QuantLib 1.43 reference values. Alpha/rho/nu are calibrated with a bounded three-start Nelder–Mead optimizer; beta is fixed rather than overfitted. Bounds constrain normalized alpha, rho and nu; iteration/bound warnings are visible.

Qualification requires positive bid, uncrossed ask, positive IV ≤300%, configured OI, spread and age limits. OKX quote/IV observations must align within five seconds. Forward observations in the expiry must agree within 0.2%. Fits use at least seven unique OTM strikes, at most 120. Missing/poor data causes an error, not an invented fit.

With at least 12 qualified strikes, every fourth strike is held out of calibration. Reported training and held-out RMSE use IV percentage points; holdout is a **cross-sectional diagnostic**, not future-period performance. Fewer than 12 strikes gives an explicit no-holdout warning. A sampled call-price monotonicity/convexity check covers the fitted strike domain; this is not a global arbitrage-free surface guarantee. Do not extrapolate the fitted range as proven market behavior.

Residuals include observed/model IV, premium under the undiscounted-forward model, training/holdout role and whether the model lies outside the observed spread. Those are research hypotheses, not executable arbitrage or calibrated profit probabilities. Timestamp quality is limited by the source: Deribit/Bybit provide response observations, not proof of last quote-change time. Missing bid/ask filtering and stale asynchronous observations must not be hidden.

**25-delta skew** uses unadjusted forward Black delta at zero rate, linearly interpolates available IV in absolute delta and returns the exact bracketing contracts. No extrapolation: either missing wing makes risk reversal unavailable. Risk reversal is **25Δ call IV minus 25Δ put IV**. This differs from premium-adjusted delta or smile-relative strike conventions.

**Gamma by strike** uses zero-rate/yield BSM spot gamma, normalized underlying OI and USD sensitivity per 1% spot move. Gross mode treats long calls and puts as positive. The optional **call-positive/put-negative** scenario is a positioning assumption, not dealer inventory. Its roots reprice the qualified expiry slice at constant IV over 50–150% of snapshot spot, with bisection of detected sign crossings. These model roots differ from cumulative strike-ladder crossings and from observed dealer zero gamma. Missing/excluded contracts and the selected expiry restrict coverage. No dealer walls are inferred from unsigned OI.

## Strategy templates and multi-leg scenarios

Qualified quotes can create six unranked templates where strikes exist: long straddle, long strangle, call debit vertical, put debit vertical, risk reversal and equally spaced call butterfly. Templates are structural examples, not trading recommendations. Choose one or add up to eight distinct **same-expiry** legs manually.

Quantities are signed **underlying units** on every exchange: positive buys, negative sells. For OKX, one contract means the normalized contract size in underlying units. Arbitrary model quantities are not a promise of an exchange-valid lot size.

Entry premium uses ask for buys and bid for sells. Scenarios use standard European BSM at zero rate/yield, per-leg fixed IV plus the requested shift and elapsed time. Premium ledger and P&L are in settlement units. For inverse contracts, modeled USD value is divided by scenario spot before applying coin-premium cash flows. Displayed Greeks are modeled USD option sensitivities for the selected IV/time scenario at snapshot spot; inverse premium-cash delta is separate. Terminal payoff kinks show unavailable sensitivities rather than inventing a derivative.

The graph's best/worst values cover only its sampled spot range. They are **not global maximum loss, margin or liquidation bounds**. No American exercise, dynamic hedge or calendar-spread model is claimed.

## Historical replay and accounting

Select 2–100 distinct chronological observations of one exchange/base/settlement and choose fixed legs that exist in the first snapshot. Configure settlement-currency capital, premium-based fees in basis points, adverse slippage, observation freshness and a static margin reserve. Click **Run & save replay**.

* Entry: buy at ask / sell at bid, adjusted adversely for slippage, subtract assumed premium-based fees.
* Intermediate observations: liquidation-side bid for longs / ask for shorts. Pending exit fees are not charged until exit.
* Final pre-expiry observation: exit on the opposite quoted side, with slippage and fees.
* Missing/stale/crossed required quotes or changed contract specifications stop the run. Entry leg observation times must be within five seconds. There is no interpolation over missing positions.
* An optional supplied funding ledger adds signed settlement-currency cash flows at their timestamps. No hedge funding or collateral interest is guessed.
* A replay crossing expiry requires an explicit official settlement price and source. It uses intrinsic payoff at the contract expiry, never the later snapshot index. User-supplied fixing/source is marked **unverified**; automatic fixing retrieval is not implemented.
* Initial capital plus premium cash and liquidation value determines settlement equity. The user-specified constant margin reserve flags breaches; the replay does not simulate venue SPAN/portfolio margin, forced liquidation or dynamic reserves.

Inverse cash/initial capital remains in BTC/ETH. For example, buying one call at 0.1 BTC with strike 100 and settling at 200 gives 0.5 BTC payoff, 0.4 BTC option P&L, and 80 USD equivalent at settlement. Starting with 1 BTC gives 1.4 BTC / 280 USD final equity: the USD equity includes coin collateral exposure. This is not the same as a fixed-dollar-funded equity option. Stablecoin equity assumes one USD parity.

Fills are independent quote assumptions; there is no executable-depth or simultaneous multi-leg fill guarantee. Premium-based fees do not reproduce exchange fee caps/delivery charges. Manually chosen fixed legs may reflect hindsight, so this replay is not a validated automatic strategy. Saved runs include the assumptions, quote/hash evidence, fill ledger, settlement-currency P&L/drawdown, fees, funding and margin flags. Load/export them separately from Pine candle backtests.

## MCP

The generic `crypto_options_*` tools accept an exchange selection; their sessions remain process-local. New tools:

* `option_history_list`, `option_history_read`, `option_history_save`, `option_history_import`, `option_history_export`, `option_history_delete`, `option_history_compare`.
* `option_record_start`, `option_record_status`, `option_record_stop`.
* `option_surface_fit`, `option_delta_skew`, `option_portfolio_model`.
* `option_quote_backtest`, `option_replays`, `option_replay_read`.

Fit/model calls accept `snapshotId` to use saved evidence, or `exchange` to use this process's loaded chain. Replay takes archive `ids`, signed-underlying-unit `legs` and accounting settings. Import/save/record/delete/replay creation are annotated as mutations. Large archives can exceed an MCP client's message limits; use the desktop file importer when appropriate.

## Verification

Tests cover independent QuantLib SABR references, known-parameter recovery, held-out separation, stale/missing filters, interpolation and missing wings, gamma sign conventions, storage validation/provenance/quota/concurrent writers, recorder lifecycle, Bybit/OKX units/polling/errors, known cash/fill/commission/funding accounting, explicit settlement and preserved quote evidence. Browser and native Electron checks exercise archive import, calibration, candidates, modeling, comparisons and saved replays.

`npm run smoke:options-research` optionally checks genuine Deribit quotes, qualified fitting/skew, fresh disk capture, modeling and two-observation replay in an isolated temporary directory. A live check on October 1, 2026 qualified 39 ETH OTM strikes with training RMSE ~0.695 and held-out RMSE ~0.704 IV points. No synthetic history was substituted. Bybit/OKX remain fixture-validated because production access was blocked here.
