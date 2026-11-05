# Paper fill journal and recorded equity

Added in v0.22.0, with period rollover in v0.23.0, under **Research → Paper trading**. These extend the [local paper account](paper-trading.md); they never submit exchange orders. The journal stores annotations on simulated fills. History records observed bid valuations while paper monitoring runs. Neither changes order revisions, risk limits or fill accounting.

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

Choose **Load / refresh history**. The **Recorded period** selector loads the current period or a checksummed older archive. **Archive current period** closes a nonempty period early; it preserves all samples and does not start monitoring. An intervening sample or rollover makes a stale request fail—refresh before retrying. The chart switches between bid equity and sampled drawdown, showing the latest 100, 500 or 2,000 saved samples on an actual time axis. Hover a point for its values and account revision. The table shows the latest 20 observations, including missing symbols. Metrics carry the initial baseline and all earlier recorded peaks forward through the end of the selected period, not just the selected chart window. They exclude observations in later periods when viewing an older archive.

Chart lines break at session changes, missing-price samples, after missing-price samples, and intervals longer than 90 seconds. Isolated valid samples remain dots. No interpolation across those gaps is presented. The last recorded value is historical; the existing live valuation panel remains separate. New samples require refreshing this history view; the recording status reports when more are available.

JSON and CSV export every sample and derived equity/drawdown value in the **selected period**. Export other periods separately. Filenames include the period number. Exports use the loaded period even if monitoring has since rolled into another one; refresh Current to select the new period. JSON also includes the carry-forward seed and archive catalog; it is not a single bundle of every archived sample. The catalog SHA-256 identifies the internal immutable archive file, not the enriched export file. CSV observation time is UTC text; quote request/retrieval times are epoch milliseconds. Missing values stay empty in CSV and null in JSON. The journal, history and existing account/ledger each have separate export buttons and files; these are review exports, not restore/import formats.

## Persistence, capacity and failure behavior

`paper-journal/current.json` stores version-1 annotations and independent entry/document revisions. Entries are limited by the account's 1,000-order bound. `paper-history/current.json` stores version-2 active observations, a carry-forward seed and the archive index, tied to the account ID and initial cash. Completed periods are immutable version-1 files under `paper-history/archives/`. Existing v0.22.0 history reads without rewriting; its next successful mutation migrates it to version 2. Older app versions cannot read version-2 history. Both use atomic replacement and their own serialized writes. Account archives use version 4 since v0.24.0; notes and samples do not consume the 5,000-event account ledger or invalidate pending order edits.

Each period retains up to **10,000 samples**. When the next eligible observation arrives, the monitor automatically archives the full period and starts another. You can close a nonempty period early with **Archive current period**. Rollover carries forward the recorded peak, maximum sampled drawdown, complete/missing counts and the prior observation. It does not reset the paper account, risk budget, journal, monitoring session or order revision, and does not invent a gap solely because a period boundary was crossed.

There are at most **100 archived periods plus one active period**, with a 32 MiB limit per archive file. Early rollover consumes an archive slot even when the period contains fewer than 10,000 samples. At capacity, the active period can finish filling; subsequent recording reports an error while retaining all history. Reads/exports and paper execution remain available. No archive deletion, automatic pruning, account reset or external-volume migration is implemented.

The writer creates an immutable file, reads it back for verification, then atomically replaces the active index. Its content hash gives retries the same file identity. Existing conflicting files are never overwritten. Failed archive/index writes retain the old active samples. If the index update succeeds but writing the first new sample fails, the prior period remains archived and the next successful cycle resumes recording. Interrupted writes can leave unreferenced archive files; they are not imported or deleted automatically. Checksums are verified when an archived period is loaded; current-period reads do not scan every archive file. A missing or altered archive fails explicitly.

A history write failure or exhausted archive capacity is reported in the recording status and does **not** stop paper execution. A failed journal write preserves the previous annotation. Invalid, mismatched or unsupported archives fail explicitly instead of being reset. Shutdown drains in-flight work. A sample already being written can finish during monitor stop; late work that has not reached its write is invalidated.

After restart, annotations and recorded samples remain available, but monitoring stays off and historical prices never become live quote marks. A new monitor session gets a new session ID, creating a visible break from prior observations.

## MCP

| Tool | Permission | Purpose |
| --- | --- | --- |
| `paper_journal` | Read | All fills joined to latest notes, fill evidence and source references |
| `paper_journal_save` | Research | Save the latest annotation for one existing fill |
| `paper_history` | Read | Current or selected period, archive catalog and carried sampled equity/drawdown |
| `paper_history_rollover` | Research | Close the current nonempty period without deleting samples |
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

`paper_history` accepts optional `{ "period": 1 }`; omit it for the current period. The response distinguishes `selectedPeriod`, current `period`, selected sample `count`, global `totalCount`, `archivedPeriods` and `archives`. The sampled metrics include the carry-forward seed through the selected period; the current archive catalog may include later periods.

`paper_history_rollover` takes `{ "expectedPeriod": 1, "expectedTotalCount": 10000 }` using the latest current-history response. Both guards must match. It returns updated recording status and requires research permission; reading an archive does not grant rollover permission.

[Pending price editing on charts](paper-order-editing.md) arrived in v0.24.0. [Flat-to-flat trade grouping and completed-trade performance](paper-performance.md) arrived in v0.25.0, with fill-level journal links. [Chart-based order creation](paper-chart-orders.md) arrived in v0.26.0. Next extensions include cycle-level annotations, portfolio return statistics and options paper accounting.
