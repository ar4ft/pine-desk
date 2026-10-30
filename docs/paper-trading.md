# Paper account, orders and fill ledger

Available in v0.19.0 under **Research → Paper trading**. This is a local simulation for Binance **USDT-quoted spot holdings**. It uses public market data and never connects to an exchange account or submits real orders. No API key is required.

## Workflow

1. Create the single paper account with an initial USDT balance. The balance is fixed at creation; deposits, resets and multiple accounts are not available in this version.
2. Queue a buy or an exit from existing holdings. Pending buys reserve cash including assumed fees; pending sells reserve position quantity. Overspending, overselling and short selling fail.
3. Press **Process** beside an order to fetch a new public Binance bid/ask and evaluate that one order. Queueing alone does not fill it. A successful fill changes the order, cash, holdings and ledger together.
4. Inspect positions, fills and realized P&L. Cancel a pending order to release its reservation. Use **Refresh account** after another desktop/MCP client changes the account.
5. **Export account and ledger** reads the latest durable account and exports every event, order, fill and position to JSON. It is an audit/review export; importing or restoring exports is not supported yet.

Orders do **not** execute in the background. They remain pending across restart and while the app is closed. Missed limit/stop crossings are not backfilled. A stop is therefore not continuously monitored protection. Each press of Process evaluates current conditions, not a historical path.

## Orders and fills

| Order | Model |
| --- | --- |
| Market buy | Requires a maximum entry notional. Reserves that cap plus fees. Fills at current ask plus adverse slippage, or rejects if actual entry notional exceeds the cap. Unused reservation is released. |
| Limit buy | Reserves quantity × limit × (1 + fee fraction). Fills only if ask plus slippage is at or below the limit. |
| Market sell | Reserves held quantity. Fills at current bid minus slippage. |
| Limit sell | Reserves held quantity. Fills only if bid minus slippage is at or above the limit. |
| Sell stop | Reserves held quantity. Triggers when current bid is at or below the stop; fills at bid minus slippage, including gaps through the trigger. |

All fills are for the **entire submitted order quantity**. You can exit part of a position by submitting a smaller sell order, but the engine does not model partial order fills. Slippage is an absolute adverse price amount per fill, not a percentage. Fee percent applies to fill notional and must be 0–5%. Buy fees enter cost basis; sell fees reduce proceeds. A nonpositive fill price fails and leaves the order pending.

The model uses displayed top-of-book prices, not a liquidity sweep. It does not simulate queue priority, bid/ask size, market impact, latency between exchange and provider, exchange lot/tick sizes, minimum notional, balances at a broker, margin, leverage, borrow, funding, shorts, derivatives, options or currency conversion. Quantities and costs are manual assumptions. This is not evidence that an exchange would accept or fill the order.

The symbol is checked against active Binance USDT spot metadata when queued. Metadata is cached by the shared market-search service for up to an hour. Processing reads public `ticker/bookTicker`; no order endpoint is called. Each request has a five-second timeout. The quote must have positive, uncrossed bid/ask prices, match the order symbol, be requested after submission and be no more than five seconds old at processing. Invalid, stale, unavailable or rate-limited responses leave the order pending without changing the ledger. This REST endpoint has **no exchange event timestamp**: freshness measures local request/retrieval time, not proven exchange-event age.

## Saved trade plans

Select a saved plan and choose **Queue saved plan entry**. The exact selected revision must still exist and be a draft, long, Binance spot plan in USDT with a positive calculated quantity. The queued limit buy copies symbol, entry, quantity, fees and slippage, and retains the plan ID, revision and name. Account cash is checked independently of the plan's manually assumed equity.

**Plan stops and targets are not activated.** Submit sell exits after the entry fills. There are no linked brackets, OCO groups or automatic cancellation/replacement. Each sell reserves its own quantity, so a full-position stop and full-position target cannot both reserve the same holdings. Editing or deleting a plan does not alter already queued orders; cancel and submit a replacement if necessary.

## Accounting and persistence

The account uses average cost including buy fees. For a partial sell:

```text
allocatedCost = remainingPositionCost × soldQuantity / heldQuantity
realizedPnl = sellNotional − sellFee − allocatedCost
cash += sellNotional − sellFee
remainingPositionCost -= allocatedCost
```

A complete exit removes all remaining cost. Realized P&L includes the allocated buy fees and actual simulated sell fees. Unrealized P&L and marked equity are not calculated; the UI explicitly distinguishes cash from total equity. Open positions show quantity, reserved exits, remaining cost and average cost. Closed positions remain visible with their realized results.

For example, buy 2 units at ask 100 plus slippage 1 with a 1% fee: cost is 204.02 USDT. Sell 0.5 units at bid 120 minus slippage 1 with a 1% fee: proceeds are 58.905, allocated cost is 51.005, and realized P&L is 7.90. Remaining quantity is 1.5 and remaining cost is 153.015.

The owning service writes `paper-account/current.json` using atomic replacement, with model version 1, immutable account creation data and ordered submit/cancel/process events. It reconstructs balances, reservations and fills from validated events on every read. Events are retained; invalid or unsupported archives fail explicitly rather than silently resetting. This is a local audit trail, not a cryptographically authenticated or tamper-proof financial record. Shutdown waits for pending operations. A failed write preserves the previous archive; no fill is reported as durable before the write succeeds.

Mutations run through one service queue and require `expectedRevision`. Stale mutations fail instead of merging. Submit also requires a UUID `requestId`: retry the same request ID and normalized payload to retrieve the already accepted order without creating another. A reused ID with different assumptions fails. After an uncertain response to Process or Cancel, refresh first; terminal orders cannot be processed again. Submitted orders are immutable apart from their lifecycle status.

Bounds: one account, 50 pending orders, 1,000 retained orders, 5,000 events, initial cash up to 10¹² USDT, quantity 10⁻⁸–10⁹, and finite JavaScript arithmetic. Quantities accept at most 15 significant digits; quantity balances, cash balances, fill notionals and fees are normalized to 15 significant digits to avoid common binary-rounding dust. This is not exchange decimal accounting. Large/nonfinite calculations fail. The screen shows all pending orders and the latest 100 completed orders/fills/events; exports and MCP include the complete bounded ledger. There is no automatic pruning, archival rollover or reset.

## MCP

| Tool | Permission | Purpose |
| --- | --- | --- |
| `paper_account` | Read | Account, reservations, orders, positions, fills and full ledger |
| `paper_create` | Research | Create the one simulated account |
| `paper_submit` | Research | Queue a simulated order |
| `paper_submit_plan` | Research | Queue an entry from an exact saved plan revision |
| `paper_process` | Research | Fetch a fresh quote and evaluate one pending order |
| `paper_cancel` | Research | Cancel a pending order |

`desktop_navigate` accepts `page: "paper"` with charts permission. Attached clients share the desktop's account and durable service. Standalone MCP requires exclusive ownership of its data directory. Research permission includes simulated account changes; there is no live-trading permission or route.

Example `paper_submit` arguments (replace the revision with `paper_account.revision` and generate a new request UUID for each new order):

```json
{
  "expectedRevision": 1,
  "requestId": "87518bf1-649b-46ea-b2cb-7c77703d45b4",
  "input": {
    "symbol": "BTCUSDT",
    "side": "buy",
    "type": "market",
    "quantity": 0.001,
    "maxNotional": 200,
    "feePercent": 0.1,
    "slippage": 1
  }
}
```

For a limit/stop, omit `maxNotional` and supply `price`. Market sells omit both. `paper_process` and `paper_cancel` take order `id` and `expectedRevision`. Clients cannot inject quote prices through these tool schemas. `paper_submit_plan` takes `planId`, `planRevision`, `expectedRevision` and `requestId`.

## Verification

`npm run smoke:paper` validates an active Binance symbol and performs a simulated buy and full exit using real public bid/ask requests and an in-memory ledger. It never reads or changes the desktop account. This network check is separate from deterministic core, browser and native packaged-app tests.

## Next stage

Continuous execution monitoring, linked stop/target brackets and OCO behavior, marked equity/unrealized P&L, risk rules, journal annotations, chart-native order editing, account archival/reset and options paper trading remain separate work. Existing options research/replay is unaffected by this spot-account model.
