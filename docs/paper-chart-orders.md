# Create paper orders on a chart

Added in v0.26.0 under **Research → Paper trading → Create a paper order on the chart**. v0.28.0 adds up to three target allocations. This is a separate draft from the existing order form and pending-order editor.

1. Choose a Binance USDT spot market, order type, quantity, fees and slippage. Supported chart orders are **limit buy**, **limit exit** and **sell stop**. Exits require available held quantity.
2. Optionally enable linked exits for a limit buy and choose **Targets: 1, 2 or 3**. One target automatically uses the full entry quantity (shown read-only). With two or three targets, enter every allocation explicitly; positive quantities must sum to the entry quantity. Targets must progress upward above the entry price. Each allocation becomes its own stop/target OCO pair after the entry fills.
3. Press **Load chart · seed blank levels**. This fetches up to 300 settled candles for the draft's market and interval. Only blank price fields are seeded: entry at the last settled close, stop 2% below, selected targets 2%, 4% and 6% above. These are editable starting values, not a strategy signal or live execution price.
4. Drag the amber price, red stop or any green target, or type exact values. **Fit draft levels** includes their prices in the chart scale. Changing markets clears prices and the old chart; changing interval preserves prices but clears the old candles until reloaded. Deleting a drawing recreates its draft level and does not remove a linked exit.
5. Press **Review order**. The owning service checks the current account revision, active Binance market, available cash/holdings, fees, order capacity, bracket price/quantity rules and entry risk limits using the same submission validation. It returns reservation impact without writing an order or reserving funds.
6. Inspect the reviewed order, costs and account revision, then press **Queue reviewed order**. A changed draft invalidates the review. A changed account disables Queue until you review again. The backend checks all rules again when queueing.

Changing target count invalidates the review and updates visible chart levels. Hidden target drafts are preserved during the session but excluded from the submitted bracket; returning to one target assigns the full entry quantity. Returning to multiple targets restores their explicit drafts, which must be reviewed again. Changing entry quantity does not rebalance multiple allocations. Changing market clears all draft prices; changing interval preserves them.

When one target fills, only its paired stop is cancelled. Other target pairs remain active for their allocated quantities. For example, an entry of 1 unit with targets of 0.2, 0.3 and 0.5 units retains a 0.5-unit stop/target pair after the first two targets fill. The chart draws one common stop level before entry; the ledger records separate stop slices after activation. Filled prices follow the existing fresh-bid/ask paper model, not the candle history.

Loading, dragging and reviewing never submit orders, fetch execution quotes, start monitoring or change the workspace dataset. If candles cannot load, numeric entry and review remain available. The chart is a settled snapshot, not a continuous live trigger feed.

After queueing, an already-enabled monitor can process the order on a later fresh quote. Otherwise use Process in the order list. This remains local spot simulation; no exchange orders are sent. See [paper fill assumptions](paper-trading.md).

## Submission confirmation

The reviewed input, account revision and request UUID are frozen for submission. A confirmed order locks the draft; **New draft** is required to queue another order. If the response fails, the inputs remain locked and **Check submission** reads the ledger for that request UUID. Checking never sends another order.

If the request exists, the panel displays its order ID even if it has since filled or changed. If it is not found, the draft unlocks and must be reviewed again; the request UUID is retained until an explicit draft edit or New draft. Existing backend request-ID deduplication prevents an identical retry from creating another order. Closing the app discards the screen draft/confirmation state, while any submitted order remains in the durable ledger. Inspect the order list after reopening before creating a replacement.

Unsaved drafts and chart context survive page navigation during the session. They are not persisted across app restarts or exported as named layouts. The original manual order form, saved-plan handoff and [pending order editor](paper-order-editing.md) remain available.

## MCP

Two read-only tools support this workflow:

- `paper_draft_chart`: `{ "symbol": "BTCUSDT", "timeframe": "1h" }`. Validates an active USDT spot market and returns settled candles. Supported intervals: 1m, 5m, 15m, 1h, 4h, 1d; default 1h.
- `paper_preview`: `{ "expectedRevision": 12, "input": { ... } }`. Requires an existing account and current revision. Uses the same order schema as `paper_submit`, including existing market orders and multi-target brackets when provided through MCP. The chart UI exposes price-based orders and up to three linked target allocations.

Example preview (replace the revision and price assumptions):

```json
{
  "expectedRevision": 12,
  "input": {
    "symbol": "BTCUSDT",
    "side": "buy",
    "type": "limit",
    "quantity": 0.001,
    "price": 60000,
    "feePercent": 0.1,
    "slippage": 0,
    "bracket": {
      "stop": 58800,
      "targets": [
        { "price": 61200, "quantity": 0.0002 },
        { "price": 62400, "quantity": 0.0003 },
        { "price": 63600, "quantity": 0.0005 }
      ]
    }
  }
}
```

The response includes the parsed input, `accountRevision`, available cash before/after, additional cash/quantity reservation, and projected risk usage. These are hypothetical reservations only. Use the existing **research-scoped** `paper_submit` with the reviewed input, revision and a stable `requestId` to queue. Read-only clients can preview but cannot submit. Never use candle highs/lows as evidence of a live fill.

Chart creation introduced no new archive format. Account version 5 applies since v0.27.0; see [quantity editing](paper-order-quantity.md) for migration details. Existing order limits apply. Chart-based sizing by cash risk, trailing stops, retrospective linked exits on existing holdings, and options paper execution remain separate work.
