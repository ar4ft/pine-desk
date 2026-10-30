# Paper account, orders and fill ledger

Account foundation in v0.19.0; monitoring, linked exits and valuation added in v0.20.0, with persistent entry risk controls in v0.21.0 under **Research → Paper trading**. This is a local simulation for Binance **USDT-quoted spot holdings**. It uses public market data and never connects to an exchange account or submits real orders. No API key is required.

## Workflow

1. Create the single paper account with an initial USDT balance. The balance is fixed at creation; deposits, resets and multiple accounts are not available in this version.
2. Queue a buy or an exit from existing holdings. Pending buys reserve cash including assumed fees; pending sells reserve position quantity. Overspending, overselling and short selling fail.
3. Press **Process** beside an order for one fresh quote, or **Start monitoring** to evaluate pending orders repeatedly while the owning service is running. Queueing an order can lead to a fill on the next cycle if monitoring is active. A successful fill changes the order, cash, holdings and ledger together.
4. Inspect positions, fills and realized P&L. Cancel a pending order to release its reservation. Use **Refresh account** after another desktop/MCP client changes the account.
5. **Export account and ledger** reads the latest durable account and exports every event, order, fill and position to JSON. It is an audit/review export; importing or restoring exports is not supported yet.

Monitoring is **off by default and after every restart**. Enable it explicitly for each service session. It continues across app pages while enabled. It is public bid/ask **polling**, not exchange-hosted execution or a trade-by-trade trigger feed. Cycles wait five seconds after the previous cycle completes, with at most four requests at once across up to 50 distinct pending/held markets. A large set or slow requests makes the interval between observations longer than five seconds. Missed crossings during polling gaps, sleep, outages or shutdown are never replayed.

Stop monitoring invalidates pending quote work and waits for in-flight work to drain before returning. A write already underway can complete; the returned account includes it. No new monitor fill starts from a late fetch after stop. Pending orders remain saved, and manual Process is still available. A valid later quote can resume processing at its current price after an outage; no path or historical fill is inferred. Start/stop controls are shared by desktop and attached MCP clients. A stopped or disconnected monitor is not stop-loss protection.

Quote errors are shown by market, leave affected orders pending and invalidate that market's valuation. Errors are retried on later cycles. More than 50 markets pauses the monitor with an error rather than silently choosing a subset. Monitoring settings and quote marks are session-only; the account and orders remain durable.

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

## Persistent entry risk limits

Open **Edit entry risk limits** in Paper trading. All caps start disabled (blank); buys start enabled. **Save risk limits** applies the complete policy to this account, including existing pending orders. **Load saved limits** replaces unsaved fields with the latest shared policy. The status strip shows saved limits and current usage; fields remain drafts until saved. Polling does not overwrite draft edits. Conflicting policy edits require loading the saved policy again; any intervening account change during a save can also require retrying after refresh.

| Control | Definition |
| --- | --- |
| Pause all new buy entries | Prevents new buy submissions and executable pending buy fills. Sell exits and cancellation remain available. Persists after restart; separate from the session monitor toggle. |
| Maximum order cost | Buy reservation at submission (market notional cap or quantity × limit), including entry fees. Rechecked against actual fill cost. |
| Maximum cost per market | Remaining average-cost basis for that symbol, plus all its pending buy reservations, including fees. Pending sells do not reduce this commitment until filled. |
| Maximum total committed cost | Sum of held cost basis and pending buy reservations across all markets, including fees. |
| Maximum open / pending markets | Distinct symbols with positive holdings or pending buy entries. Multiple orders in the same symbol count once; zero holdings without pending buys do not count. |
| Daily losing-trade budget | Sum of `max(0, -realizedPnl)` for exits on the current **UTC calendar day**, after allocated entry fees and sell fees. Profitable exits do not replenish the budget. Reaching the budget blocks buys; usage resets at UTC midnight without deleting history. |

Cost caps allow equality; the daily loss budget blocks buys at equality. The market-count cap accepts 1–50; monetary caps must be positive and at most 10¹² USDT. Blank/null disables an individual cap. All limits apply equally to desktop orders, saved-plan entries and MCP, and are rechecked during manual and continuous processing. A pending buy is excluded from its own reservation sum during its fill check, then its actual entry cost is counted once.

A blocked new submission reports a reason and changes nothing. A pending buy whose price condition qualifies under a blocking policy becomes **rejected**, with a durable reason and its cash reservation released. It creates no bracket children. Non-executable limit orders remain pending until they qualify or are cancelled. Lowering a cap below existing commitments is permitted: it restricts subsequent buys without rewriting fills, forcing sales or cancelling orders immediately. Sell stops/targets, including OCO pairs, continue to process under their existing rules. Raising/disabling limits or unpausing is an explicit saved policy change.

These are **cost-based entry constraints**, not market-value exposure, stop-distance risk, margin controls or a guaranteed maximum loss. Unrealized losses do not consume the daily budget, and buy fees enter it only when allocated to a losing realized exit. Losses on later exits can exceed the budget; exits are never blocked by it. UTC uses the local service clock. There is no broker enforcement, automatic liquidation or permission separate from MCP research access for changing limits.

## Saved trade plans

Select a saved plan and choose **Queue saved plan entry**. The exact selected revision must still exist and be a draft, long, Binance spot plan in USDT with a positive calculated quantity. The queued limit buy copies symbol, entry, quantity, fees and slippage, and retains the plan ID, revision and name. Account cash is checked independently of the plan's manually assumed equity.

The **Activate saved stop/target pairs after entry fills** checkbox is off by default. When selected, the exact saved stop and nonzero rounded target allocations are attached to the entry. For a manually entered limit buy, fill both optional linked stop/target fields to attach one full-quantity pair. MCP can supply 1–3 target slices explicitly as `input.bracket: {stop, targets: [{price, quantity}]}`. Brackets require a limit-buy entry, stop below entry, progressively higher target prices and quantities summing to the entry quantity.

When the entry fills, each target slice creates a linked sell-stop and sell-limit pair. The pair reserves its quantity **once**. Filling either leg cancels its sibling atomically (OCO). A partial-position target cancels only its matching stop; other slices retain their stops and targets. Cancelling either leg cancels that entire pair and releases its slice. Children do not exist before the entry fills, and cancelling the pending entry creates no children. Newly activated exits wait for a later monitor quote; they never consume the quote that filled the entry in that same cycle.

Independent sell orders still reserve quantity separately. Linked exits cannot be attached retrospectively to an existing holding in this version. There is no trailing stop, in-place price editing or auto-replacement. Pending/retained order limits reserve room for contingent children before accepting an entry. Editing/deleting the source plan does not change queued orders. A gap can place the entry fill beyond planned levels; exits are evaluated at later observed bid prices under the same polling/slippage rules.

## Accounting and persistence

The account uses average cost including buy fees. For a partial sell:

```text
allocatedCost = remainingPositionCost × soldQuantity / heldQuantity
realizedPnl = sellNotional − sellFee − allocatedCost
cash += sellNotional − sellFee
remainingPositionCost -= allocatedCost
```

A complete exit removes all remaining cost. Realized P&L includes the allocated buy fees and actual simulated sell fees. The monitor also fetches quotes for open holdings. Bid-marked value is `quantity × observed bid`; unrealized P&L subtracts remaining cost including entry fees. Equity is cash plus all open-position values. These marks exclude hypothetical exit fees/slippage and are not executable liquidation guarantees. The mark table shows quote retrieval times. A missing, future-dated or more-than-15-second-old quote makes that position stale and suppresses aggregate equity/unrealized P&L; it is never treated as a zero-valued holding. Marks are tied to the account revision and refresh without resetting order-form drafts. Empty portfolios can show cash equity without quotes. No equity history or drawdown series is persisted yet. Closed positions remain visible with their realized results.

For example, buy 2 units at ask 100 plus slippage 1 with a 1% fee: cost is 204.02 USDT. Sell 0.5 units at bid 120 minus slippage 1 with a 1% fee: proceeds are 58.905, allocated cost is 51.005, and realized P&L is 7.90. Remaining quantity is 1.5 and remaining cost is 153.015.

The owning service writes `paper-account/current.json` using atomic replacement, with archive version 3, immutable account creation data and ordered submit/cancel/process/risk-policy events. It reconstructs balances, reservations and fills from validated events on every read. Existing version-1/2 accounts replay unchanged with all optional limits disabled and migrate to version 3 on their next successful mutation; opening an account does not rewrite history. Older apps cannot read version-3 archives. Risk policies replay in event order, so later limits never invalidate earlier accepted fills. Events are retained; invalid or unsupported archives fail explicitly rather than silently resetting. This is a local audit trail, not a cryptographically authenticated or tamper-proof financial record. Shutdown waits for pending operations. A failed write preserves the previous archive; no fill is reported as durable before the write succeeds.

User account mutations run through one service queue and require `expectedRevision`. Monitoring fetches outside that queue, then checks current pending orders inside it before committing the eligible events for one symbol atomically. A concurrent cancellation wins if it commits before that check. Other clients can observe intervening fills, so refresh and reapply a stale edit rather than assuming the screen revision remains current. Stale mutations fail instead of merging. Submit also requires a UUID `requestId`: retry the same request ID and normalized payload to retrieve the already accepted order without creating another. A reused ID with different assumptions fails. After an uncertain response to Process or Cancel, refresh first; terminal orders cannot be processed again. Submitted orders are immutable apart from their lifecycle status.

Bounds: one account, 50 pending orders, 1,000 retained orders, 5,000 events, initial cash up to 10¹² USDT, quantity 10⁻⁸–10⁹, and finite JavaScript arithmetic. Quantities accept at most 15 significant digits; quantity balances, cash balances, fill notionals and fees are normalized to 15 significant digits to avoid common binary-rounding dust. This is not exchange decimal accounting. Large/nonfinite calculations fail. The screen shows all pending orders and the latest 100 completed orders/fills/events; exports and MCP include the complete bounded ledger. There is no automatic pruning, archival rollover or reset.

## MCP

| Tool | Permission | Purpose |
| --- | --- | --- |
| `paper_account` | Read | Account, reservations, orders, positions, fills, risk policy/usage and full ledger |
| `paper_create` | Research | Create the one simulated account |
| `paper_set_risk` | Research | Replace the complete persistent entry policy with `expectedRevision` |
| `paper_submit` | Research | Queue a simulated order |
| `paper_submit_plan` | Research | Queue an entry from an exact saved plan revision; optional `linkedExits` |
| `paper_process` | Research | Fetch a fresh quote and evaluate one pending order |
| `paper_cancel` | Research | Cancel a pending order, or both legs of its linked pair |
| `paper_monitor_status` | Read | Session health, current account and ephemeral bid valuation |
| `paper_monitor_start` | Research | Enable session polling and simulated execution |
| `paper_monitor_stop` | Research | Stop polling and drain in-flight work |

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

For a limit/stop, omit `maxNotional` and supply `price`. Market sells omit both. `paper_process` and `paper_cancel` take order `id` and `expectedRevision`. Clients cannot inject quote prices through these tool schemas. `paper_submit_plan` takes `planId`, `planRevision`, `expectedRevision`, `requestId` and optional `linkedExits` (default false). `paper_account` remains the durable record; use `paper_monitor_status` for current quotes/valuation. Research permission includes enabling continuous simulated execution; it does not grant exchange trading.

Example `paper_set_risk` arguments (use the current account revision; all policy fields are required):

```json
{
  "expectedRevision": 1,
  "policy": {
    "pauseBuys": false,
    "maxOrderCost": 500,
    "maxSymbolCost": 2000,
    "maxTotalCost": 5000,
    "maxMarkets": 5,
    "dailyLossLimit": 100
  }
}
```

`paper_account.risk` contains the saved policy. `riskUsage` reports the UTC day, realized losing-exit total, held-plus-pending cost by symbol and in total, and distinct market count. Use `null` for an individual disabled cap. Policy changes and processing rejections are retained in the exported event/order ledger; refused new submissions do not create events.

## Verification

`npm run smoke:paper` validates an active Binance symbol and performs a simulated buy and full exit using real public bid/ask requests and an in-memory ledger. It never reads or changes the desktop account. This network check is separate from deterministic core, browser and native packaged-app tests.

## Next stage

Journal annotations, historical equity/drawdown, chart-native order editing, attaching exits to existing holdings, trailing stops, account archival/reset and options paper trading remain separate work. Existing options research/replay is unaffected by this spot-account model.
