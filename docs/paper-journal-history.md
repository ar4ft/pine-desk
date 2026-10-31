# Paper fill journal and recorded equity

Added in v0.22.0 under **Research → Paper trading**. These extend the [local paper account](paper-trading.md); they never submit exchange orders. The journal stores annotations on simulated fills. History records observed bid valuations while paper monitoring runs. Neither changes order revisions, risk limits or fill accounting.

## Review fills

1. Choose **Load / refresh journal** to load all current fills and their latest annotations.
2. Filter by market, tag or source-plan name. The table shows 100 matches per page, newest first; **Older/Newer** reaches every matching fill, and exports include every fill.
3. Choose **Review fill**. Add a thesis/setup, review/lessons, comma-separated tags and a plan-adherence label, then **Save review**.
4. Use **Export journal JSON** for the latest saved annotations joined to fill evidence, source-plan ID/name/revision and linked-exit parent/leg.

One journal row represents **one fill**, not a reconstructed round-trip trade. Multiple entries, partial exits and linked target slices remain separate. Realized P&L on exits follows the account's average-cost method, including allocated entry fees and exit fees. Buy rows do not imply a closed-trade result. No win rate, trade-level attribution or MFE/MAE is inferred.

Notes are independent of immutable order/fill data and the source plan. Changing or deleting a saved plan does not rewrite the reference captured by the order. Journal entries reference existing filled order IDs; rejected, cancelled and pending orders cannot receive a fill review.

The thesis accepts up to 2,000 characters, the review up to 4,000, and tags up to 10 entries of 30 characters each. Tags are trimmed, lowercased and deduplicated. Adherence is `unreviewed`, `followed-plan`, `deviated` or `no-plan`. Empty fields can be saved to clear text. The latest note text is retained; there is no note-version archive, attachment upload or undo history.

Monitoring and refreshing the journal list preserve the active draft. **Reload this fill** or choosing another fill replaces it. Concurrent edits to the same entry fail with a revision error; reload the saved entry before reapplying changes. Exports exclude unsaved drafts. Edits made through another client appear after refreshing the list/reloading the fill.

## Record equity and drawdown

**Start monitoring** also enables history recording for that service session. A completed monitoring cycle records a sample:

- On the first cycle of a monitoring session.
- When the account revision changes (including fills, orders and risk-policy changes).
- When the set of holdings missing fresh quotes changes, including outage and recovery.
- Otherwise, at least 60 seconds after the previous saved sample.

This cadence is approximate: network requests, storage and the five-second interval between monitor cycles can delay observations. Recording is off when monitoring is stopped or the app/service is closed. Manual Process while monitoring is off does not create a historical valuation. Re-enabling monitoring observes current quotes; it does not backfill missed periods. Merely loading or exporting history does not start monitoring or create samples.

A sample stores account revision, session ID, observation time, cash, remaining position cost, aggregate marked position value, holding count, missing symbols and the oldest request/newest retrieval times among usable quotes. It records valuation summaries, not full historical order books or per-contract options quotes. It is a local research record, not a tamper-proof financial audit.

```text
positionValue = sum(quantity × fresh observed bid)
equity = cash + positionValue
unrealizedPnl = positionValue − remainingPositionCost
peak = max(initialCash, all complete recorded equity observations so far)
drawdown = peak − equity
drawdownPercent = drawdown / peak × 100
```

These are spot-account values in **USDT**, excluding hypothetical exit fees/slippage. They do not include an options portfolio or historical exchange balances. Actual simulated fill fees already affect account cash and cost basis. Drawdown is a nonnegative distance below the reference peak.

Every positive holding needs a valid quote requested no more than 15 seconds before the observation, with request ≤ retrieval ≤ observation. A missing, stale, invalid or future-dated mark makes aggregate value, equity, unrealized P&L and drawdown **null**, never zero. A cash-only account has complete equity without quotes. The sample names missing symbols; partial marks do not produce an aggregate equity estimate.

Drawdown uses the initial cash baseline and **recorded** peaks. Unobserved market highs and lows can make actual intraperiod drawdown larger. A gap does not reset the remembered peak. No continuous-time risk claim, historical return reconstruction, daily performance series or realized-only substitute is made.

## Explore and export history

Choose **Load / refresh history**. The chart switches between bid equity and sampled drawdown, showing the latest 100, 500 or 2,000 saved samples on an actual time axis. Hover a point for its values and account revision. The table shows the latest 20 observations, including missing symbols. Metrics cover the complete retained history, not just the selected chart window.

Chart lines break at session changes, missing-price samples, after missing-price samples, and intervals longer than 90 seconds. Isolated valid samples remain dots. No interpolation across those gaps is presented. The last recorded value is historical; the existing live valuation panel remains separate. New samples require refreshing this history view; the recording status reports when more are available.

JSON and CSV export every retained sample and derived equity/drawdown value. CSV observation time is UTC text; quote request/retrieval times are epoch milliseconds. Missing values stay empty in CSV and null in JSON. The journal, history and existing account/ledger each have separate export buttons and files; these are review exports, not restore/import formats.

## Persistence, capacity and failure behavior

`paper-journal/current.json` stores version-1 annotations and independent entry/document revisions. Entries are limited by the account's 1,000-order bound. `paper-history/current.json` stores version-1 observations tied to the account ID and initial cash. Both use atomic replacement and their own serialized writes. Account archives remain version 3; notes and samples do not consume the 5,000-event account ledger or invalidate pending order edits.

History retains at most **10,000 samples**, without automatic pruning. At one sample per minute, that is approximately seven days of continuous recording; account and coverage changes can fill it sooner. Once full, recording reports an error and retains every existing sample. Export remains available. Archive rollover/reset is not implemented in this release.

A history write failure or full archive is reported in the recording status and does **not** stop paper execution. A failed journal write preserves the previous annotation. Invalid, mismatched or unsupported archives fail explicitly instead of being reset. Shutdown drains in-flight work. A sample already being written can finish during monitor stop; late work that has not reached its write is invalidated.

After restart, annotations and recorded samples remain available, but monitoring stays off and historical prices never become live quote marks. A new monitor session gets a new session ID, creating a visible break from prior observations.

## MCP

| Tool | Permission | Purpose |
| --- | --- | --- |
| `paper_journal` | Read | All fills joined to latest notes, fill evidence and source references |
| `paper_journal_save` | Research | Save the latest annotation for one existing fill |
| `paper_history` | Read | Complete retained observations and sampled equity/drawdown |
| `paper_monitor_status` | Read | Existing monitor state plus recording count/capacity/error status |

The journal save revision is the **entry revision**, not the account revision. A fill without saved notes has revision 0. Use the `orderId` and `revision` returned by `paper_journal`:

```json
{
  "orderId": "87518bf1-649b-46ea-b2cb-7c77703d45b4",
  "expectedRevision": 0,
  "input": {
    "thesis": "Breakout after consolidation",
    "review": "Waited for confirmation; review entry size",
    "tags": ["breakout", "practice"],
    "adherence": "followed-plan"
  }
}
```

The save response includes the new entry revision and document `journalRevision`. MCP cannot inject equity samples or quote marks through these tools. Research permission already controls starting monitoring and editing simulated account data; journal writes use the same permission. Read-only clients can inspect history and notes but cannot edit them or start execution.

Next extensions include round-trip trade grouping, chart-native order editing, archive rollover, richer performance statistics and options paper accounting.
