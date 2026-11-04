# Paper trades and performance

Added in v0.25.0 under **Research → Paper trading → Completed trades & performance**. Press **Load / apply filters** to analyze the saved paper-account ledger. This is a read-only calculation: it never fetches quotes, starts monitoring, changes orders or writes a second trade ledger.

## What counts as a trade

A trade begins when a market's holdings move from zero to positive and completes when they return to exactly zero. All buys and sells during that position cycle belong together. Scale-ins, partial exits, multiple linked targets and overlapping plans share one trade until the market is flat. Different symbols are independent. A later buy from flat starts a new trade, even in the same millisecond; the saved fill order breaks timestamp ties. The first fill's order ID is the stable trade ID.

This groups the account's average-cost position model; it is not FIFO lot accounting or separate attribution to each plan. Pending, rejected and cancelled orders do not create trades. Remaining dust stays open rather than being rounded away by the analysis. The order engine's existing quantity rules still apply.

**Open trades are separate.** Their realized P&L includes any partial exits, and remaining cost basis includes unallocated entry fees. They do not enter completed-trade win rate, profit factor, expectancy, holding time or the completed-trade curve. The view does not estimate their unrealized P&L. Use the existing monitored bid valuation and recorded equity history for that purpose.

## Metrics

| Metric | Definition |
| --- | --- |
| Completed net P&L | Sum of realized sell-fill P&L for completed cycles, including allocated buy fees and sell fees. Slippage is already embedded in execution prices. |
| Win rate | Winning completed cycles divided by all completed cycles, including breakeven. No completed trades gives `null` / “—”. |
| Profit factor | Sum of positive net P&L of winning cycles divided by absolute net losses of losing cycles. Zero for losses without wins; `null` when there are no losing cycles (displayed explicitly, never an infinite statistic). |
| Expectancy | Completed net P&L divided by completed trade count, in USDT per trade. No trades gives `null`. |
| Average win / loss | Mean net P&L within winning / losing cycles; losses are negative. A missing class gives `null`. |
| Completed fees | All entry and exit fees within the selected completed cycles. Open-cycle fees are excluded. |
| Holding time | Last closing fill time minus first opening fill time. The average uses completed cycles only, without quantity weighting. |
| Return on total buy cost | Completed net P&L divided by all entry outlays (notional plus fees) in that cycle, multiplied by 100. This is not a portfolio, margin, annualized or capital-at-risk return. Reinvested scale-ins count as additional entry outlays. |
| Best / worst | Largest / smallest completed net P&L, or `null` if none. |
| Win / loss streaks | Consecutive outcomes in closure order; a breakeven cycle breaks either streak. |
| Completed P&L drawdown | Largest peak-to-trough decline in the selected cumulative completed-trade P&L curve, starting at zero, in USDT. It is not equity drawdown and omits unrealized P&L and partial-exit P&L of still-open cycles. |

The curve's horizontal axis is **trade closure sequence**, not evenly sampled time. Hover a point for its closure timestamp and cumulative P&L. The baseline resets to zero for the selected filter; it is not the original account balance.

Floating-point residuals within `max(1e-8, 32 × Number.EPSILON × max(total buy cost, net sale proceeds))` USDT classify as breakeven. The tolerance is exported per completed trade. Raw net P&L is retained in totals, expectancy and the curve; breakeven residuals are excluded from win/loss aggregates and streaks.

## Filters, details and exports

Leave Market blank for all symbols or enter an exact Binance USDT symbol. **Close from** includes UTC midnight on the selected date; **Close before** excludes UTC midnight on its date. MCP accepts the same boundaries as epoch milliseconds. Filtering happens after grouping the entire ledger: a trade opened before the range still includes every entry and exit if its closing time falls inside the range. To include November 4, for example, set “Close before” to November 5.

Open trades honor the market filter and **ignore close-date bounds**, since they have no closing time. The UI labels this explicitly. Editing filters does not silently change the loaded results; press Load / apply filters. Invalid filters leave the previous report visible with its applied scope.

The trade list and fill inspector paginate at 100 rows. **Inspect fills** shows the saved fill sequence, quantities, prices, fees, realized P&L, source-plan revisions and linked-exit references. **Review fill** opens the existing journal editor for that fill; it explicitly replaces the current journal draft. No new round-trip note record is created.

**Export loaded JSON** includes the method, filters, account revision, totals, reconciliation, all selected trades and their fills. **Export trades CSV** contains one row per selected completed/open trade, including the account revision and raw epoch-millisecond timestamps. JSON preserves the full scope and fill references; CSV is the tabular trade summary. Both include all matching rows, not just the displayed page.

Results and exports remain tied to the loaded account revision. New orders/fills show a refresh notice but do not overwrite the report. Exports do not silently recalculate against a newer account. The screen snapshot survives page navigation during the session; after an app restart, load it again from the durable account. No archive migration or additional storage format is needed; the account remains version 4.

## Reconciliation and MCP

The analysis checks remaining quantities/cost basis, sell-fill cost allocations and completed-cycle cash flows. It also checks that **all completed realized P&L + all open realized P&L = account realized P&L**, within the exported numeric tolerance. This reconciliation always covers the entire account before filters. Inconsistent inputs fail explicitly; a partial report is not returned. The owning service supplies a single validated account snapshot.

The read-only MCP tool is `paper_performance`. Example:

```json
{
  "symbol": "BTCUSDT",
  "from": 1793491200000,
  "to": 1796083200000
}
```

These boundaries select cycles closed during November 2026 UTC. All arguments are optional; `{}` returns the entire retained history. `from` must be less than `to` when both are present. Unknown fields are rejected. Read-only clients can use this tool; research permission is not required.

This release does not add per-plan lot attribution, cycle-level journal notes, Sharpe/Sortino ratios, annualized returns, options paper accounting or broker execution. See [paper-account assumptions](paper-trading.md), [fill journal and recorded equity](paper-journal-history.md), and [pending order editing](paper-order-editing.md).
