# Trade plans and risk sizing

Available in v0.18.0 under **Research → Trade plans**. This is the planning foundation for future paper trading: saved assumptions and sizing scenarios, with no orders, fills, positions, account balance or broker routing.

## Desktop

Open **Trade plans**, enter a name, market/source labels and quote currency, then define long/short direction, entry, stop and 1–3 targets. Long stops must be below entry and targets progressively above it; short plans reverse those relations. Target allocations are whole percentages totaling 100. Unused target fields stay blank with allocation 0.

Account equity, risk percentage, notional cap, quantity increment, multiplier, fees and slippage are **manual assumptions**. Use one quote currency for all cash amounts. These inputs are not synchronized with an account or validated against exchange instrument rules. Spot uses multiplier 1; linear contracts require their explicit multiplier. Options, inverse contracts, FX conversion, margin, leverage, funding and borrow costs are outside this model.

**Calculate** shows a scenario without saving it. **Save plan** recalculates and saves the assumptions and result atomically. Editing controls does not change the displayed calculation until Calculate or Save succeeds. Validation errors preserve the draft and previous calculation. The level diagram illustrates the submitted entry/stop/targets; it is not market data or a chart order overlay.

**Trade plan** in the chart workspace captures the primary chart's last settled close, symbol, source and bar timestamp into a new draft. The currency is left blank for you to confirm. It does not use the forming candle, infer currency from a display symbol or claim the historical close is a fresh quote. Stop and targets still require entry. The reference remains visible when planned prices change. A different planned symbol produces a mismatch warning.

Saved plans can be reopened, edited, marked **Archived** or restored to **Draft**, and deleted with confirmation. Status has no execution meaning. Refresh the list to see changes made by another MCP client. A stale edit or deletion fails with a revision conflict; refresh and reopen the latest plan before reapplying your draft changes. The app does not merge conflicting edits automatically.

**Export calculation** exports the last successful calculation, including its input assumptions and model version. Unsaved control edits are not exported; a saved-plan identifier/revision is not attached to a potentially unsaved calculation. Use `plan_get` to retrieve the exact saved record with its revision. Unsaved drafts survive page navigation during the app session; only saved records survive restart.

## Model version 1

Let direction `d` be +1 for long and −1 for short, slippage `s` in price units **per fill**, fee fraction `f = feePercent / 100`, and contract multiplier `m`:

```text
entryFill = entry + d × s
stopFill  = stop  − d × s
unitRisk  = m × [d × (entryFill − stopFill) + f × (entryFill + stopFill)]
riskBudget = equity × riskPercent / 100
unitNotional = entryFill × m
quantityLimit = min(riskBudget / unitRisk, maxNotional / unitNotional)
```

Quantity is rounded **down** to the configured quantity increment, then the serialized result is checked against both caps. Risk is `quantity × unitRisk`; entry notional is `quantity × unitNotional`. The notional cap limits entry exposure, not available cash after fees, required margin or portfolio risk. Calculations use finite JavaScript numbers, not exchange decimal arithmetic; unusually large values fail explicitly. At most 10¹² quantity increments are supported; increment range is 10⁻⁸ to 10⁶.

For a target, assumed fill is `target − d × s`. Its per-unit net P&L is `m × [d × (targetFill − entryFill) − f × (targetFill + entryFill)]`. Entry fees are apportioned to each allocated unit, not charged anew to the entire position for every target.

The first target allocations are floored in quantity increments; the final target receives the remaining increments. Actual allocated quantities appear in the table. Very small positions can leave earlier targets with zero quantity; the app flags this. Total projected target P&L uses those actual quantities. Level reward/risk uses the per-unit target outcome divided by unit risk; combined reward/risk uses total target P&L divided by full stop-scenario risk.

Example: equity 10,000 USD, risk 1%, long entry 100, stop 90, target 120, zero fees/slippage, increment 1 and notional cap 10,000 gives quantity 10, stop-scenario risk 100, notional 1,000 and target P&L 200 (2R). With a 1% fee per side and slippage 1, assumed entry/stop are 101/89; unit risk becomes 13.9, quantity 7, risk 97.3 and target P&L 110.6.

Zero affordable increments returns quantity 0 and an explanatory warning, not a fabricated minimum trade. Targets can have negative net P&L after costs despite being beyond the nominal entry; those scenarios are flagged. Short plans flag unverified borrow/margin availability. Stop risk is an assumed scenario, **not a guaranteed maximum loss**: gaps, market impact and worse fills can exceed it. This model estimates neither probabilities nor expected returns.

## Storage and consistency

The owning service stores up to 200 draft/archived plans in `trade-plans/current.json` inside the data directory. Each record has a UUID, revision, creation/update timestamps and a model-versioned calculation with normalized inputs. Updates and deletions require the current revision. Writes run through the service's serial queue and atomic store replacement. Shutdown waits for pending plan operations.

A failed write leaves the earlier archive available. Reads validate metadata and recalculate model-1 inputs against the saved result; corrupted, altered or unsupported archives fail rather than silently resetting. Archive revisions identify the current record; older revisions are not retained as an audit history. Export records if historical revisions are needed. Deleting a plan permanently removes its current record.

## MCP

Attached MCP uses the running desktop's same plan archive. Standalone MCP uses its owning service.

| Tool | Capability | Purpose |
| --- | --- | --- |
| `plan_estimate` | Read | Calculate without storing or executing |
| `plans_list` | Read | List all saved draft/archived records |
| `plan_get` | Read | Read a saved record by ID |
| `plan_save` | Research | Create or replace a plan |
| `plan_delete` | Research | Delete by ID and expected revision |

`desktop_navigate` accepts `page: "plans"` with charts permission. Example `plan_estimate` or new `plan_save` arguments:

```json
{
  "input": {
    "name": "Long price scenario",
    "symbol": "TEST",
    "venue": "Manual",
    "currency": "USD",
    "side": "long",
    "assetType": "spot",
    "equity": 10000,
    "riskPercent": 1,
    "entry": 100,
    "stop": 90,
    "quantityStep": 1,
    "multiplier": 1,
    "feePercent": 0,
    "slippage": 0,
    "maxNotional": 10000,
    "targets": [{"price": 120, "percent": 100}]
  }
}
```

To update, add `id` and `expectedRevision` from the loaded record. Creates omit both. `plan_delete` requires both. `status` defaults to `draft`; `notes` defaults to empty. Optional `reference` captures chart `symbol`, `origin`, millisecond `time` and `price`, and is provenance only. Tool schemas reject unknown fields such as execution flags.

## Next stage

The [paper account and fill ledger](paper-trading.md), added in v0.19.0, can queue an entry from an exact compatible saved plan. Plans themselves remain calculations; saving a plan does not create or process an order. Paper processing is explicit and does not activate plan stops/targets. Continuous execution, linked brackets, risk rules, journals, chart-native draggable levels and options contract planning remain separate work.
