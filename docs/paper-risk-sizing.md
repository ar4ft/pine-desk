# Size chart orders by cash risk

Added in v0.29.0 under **Research → Paper trading → Create a paper order on the chart**. Enable linked exits on a limit buy, then select **Size by cash risk**. Independent exits remain quantity-based.

1. Enter the entry, stop and one to three target prices. Use numeric fields or drag their chart levels.
2. Enter a **Risk budget (USDT)**, **Entry notional cap** and **Quantity increment**. These are explicit assumptions; the app does not derive the budget from equity or fetch an exchange lot size.
3. For multiple targets, enter whole percentage allocations totaling 100. A single target uses 100%.
4. Press **Calculate quantity**. The entry and target quantity fields become read-only calculated outputs. The last target receives remaining increments after rounding earlier allocations down.
5. Inspect the modeled stop loss, entry cost including fees and target quantities. Press **Review order** to validate the actual account revision, available cash, market, capacity and risk policy. Then explicitly **Queue reviewed order**.

Calculation never submits an order, reserves funds, fetches quotes or starts monitoring. A calculation can succeed while account review fails, for example because available cash is insufficient or buy entries are paused. These are separate checks.

Changing a draft input or dragging a price invalidates the calculation and review. Displayed quantities remain visible but cannot be reviewed or queued until recalculated. Loading candles also invalidates the calculation. An account change requires another review; the sizing scenario itself does not depend on the account revision. Drafts and calculations survive page navigation during the session, but not app restart. Submitted orders remain durable. Switching back to manual sizing retains the displayed quantities for explicit editing and review.

## Model and limits

The calculator reuses the [trade-plan sizing model](trade-plans.md) with a cash budget:

- Scenario entry = entry price + adverse slippage.
- Scenario stop = stop price − adverse slippage.
- Per-unit risk = entry − stop + fee fraction × (entry + stop), using the scenario fills above.
- Quantity rounds down by the chosen increment under both the cash-risk budget and the entry-notional cap.
- The notional cap excludes fees; the display separately reports scenario entry cost including fees.

For example, entry 100, stop 90, slippage 1 and a 1% fee per fill produce scenario fills of 101 and 89, and risk of 13.9 USDT per unit. A 20-USDT risk budget with a 150-USDT notional cap and 0.1 increment produces 1.4 units. A 50/50 split allocates 0.7 units to each target.

This is a sizing scenario, **not a guaranteed loss cap**. Actual simulated limit buys cannot fill above their limit, while stop fills use the observed bid and can gap below the assumed stop fill. Future market moves, polling gaps and fill fees can change realized loss. The calculation does not infer exchange quantity increments, minimum notionals, live liquidity or options/margin behavior.

Quantity arithmetic follows the existing trade-plan model: finite JavaScript numbers, at most 10¹² quantity increments, conservative downward rounding and 15-significant-digit output. Floating-point boundaries may leave an additional increment unused. Empty entries or target allocations fail explicitly; increase the budget/cap, decrease the increment or reduce target count. The returned order must also satisfy existing paper quantity bounds and bracket rules. Negative net target rewards after fees/slippage are reported as warnings.

## MCP

`paper_size` requires **read** permission and takes these strict arguments:

```json
{
  "symbol": "BTCUSDT",
  "price": 100,
  "stop": 90,
  "riskBudget": 20,
  "maxNotional": 150,
  "quantityStep": 0.1,
  "feePercent": 1,
  "slippage": 1,
  "targets": [
    { "price": 120, "percent": 50 },
    { "price": 130, "percent": 50 }
  ]
}
```

`feePercent` defaults to 0.1 and `slippage` to 0. Other fields are required. Symbols use uppercase USDT spot notation; this tool validates syntax, not active exchange markets. Prices/budgets/caps are positive and at most 10¹², increments range from 10⁻⁸ to 10⁶, fees from 0–5%, and slippage from 0–10⁹. Targets must progress above entry and percentages must total 100.

The result contains normalized `request`, a schema-validated `order`, scenario fills, per-unit/total risk, quantity, entry notional/cost, target allocations and warnings. It needs no account or revision. To act on it, obtain the current revision from `paper_account`, pass the returned `order` as `input` to `paper_preview`, and then use research-scoped `paper_submit` with a stable request UUID. Sizing alone never authorizes or performs submission.

This feature adds no storage format. Account format v5 and existing plan archives are unchanged. The sizing assumptions are session drafts/MCP results; the submitted ledger stores the resulting order's quantities, prices, fees and slippage, not the risk budget or percentage allocation inputs. Save a trade plan separately if you need a durable sizing scenario.
