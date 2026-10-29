# Trade-size filters and composite volume profiles

Available in v0.17.0. Size filters work in **Executed trades**, **Volume profiles**, **TPO analysis**, and their MCP tools. Composite daily sessions are available in **Volume profiles** and `volume_profile`; TPO still supports a single session or anchored range.

## Filter individual trades

Set **Minimum print size** and optionally **Maximum print size**, then Recompute/Compute. Bounds are inclusive: `minTradeSize <= trade.size <= maxTradeSize`. Defaults are minimum 0 and no maximum. In MCP, omit `maxTradeSize` or pass null for no upper bound. Maximum must be positive and at least minimum. Empty maximum in the desktop means unlimited.

Units are the supplied trade quantity; Binance spot uses **base-asset size**, not dollar notional. A 1 BTC print is size 1, not its USDT value. No currency conversion or automatic contract multiplier is applied.

Filtering happens **before** price/time aggregation:

- Footprint buy/sell volume, counts, delta/CVD, imbalance ratios, stacked runs and value areas use matching prints. Two size-1 prints do not pass a minimum of 2 just because they later share a row. The existing *Minimum side size* control remains a separate threshold on aggregated imbalance numerator volume.
- Volume profiles aggregate matching prints only.
- TPO counts occupancy from matching prints only, then deduplicates price/period pairs as before. The initial balance is also the range of matching opening prints. Filtering can remove rows, periods or the entire initial balance; it does not reconstruct missing observations.

Applied bounds and matching/observed/excluded counts appear with results. Raw stored trades and live buffers are not changed. For profiles, observed counts are inside the requested time window or selected sessions, **before** size filtering. Off-session trades are excluded by the time selection and are not counted as size-filter exclusions. Footprint counts refer to the full retained input.

Coverage timestamps, retention boundaries and gap warnings continue to describe **unfiltered observations**. Filtered-out prints are not feed gaps. TPO periods and initial balance expose matching/observed counts separately. A result with no matching trades has empty rows, zero totals and no value area; it preserves input coverage. Saved/attached MCP and live calculations use identical size rules.

## Build a composite volume profile

1. Open **Order flow → Volume profiles** and select **Composite UTC sessions**.
2. Set the first opening date using **Session opening date**, then the **Last opening date (inclusive)**. The range may span up to 31 calendar dates, including both endpoints.
3. Select opening weekdays. Weekdays refer to the **UTC opening date**, including when the session ends the next day. At least one date must match the selected weekdays.
4. Set the common UTC open and duration (1–1440 minutes), price bucket, value-area percentage and optional print-size bounds.
5. Compute. Expand **Included sessions** to inspect the exact intervals, counts, volumes, deltas and coverage. Empty selected sessions remain listed.

Example: Thursday and Friday opening dates, 22:00 UTC open and 240-minute duration, include Thursday 22:00–Friday 02:00 and Friday 22:00–Saturday 02:00. Friday daytime trades between 02:00 and 22:00 do not contribute. Both starts are inclusive and both ends exclusive. Adjacent 24-hour sessions count a shared boundary once.

The composite **sums executed buy/sell size at price across selected intervals**. It does not average daily profiles or weight every day equally. POC and value area are recalculated from that summed distribution using the existing [volume-profile method](volume-profiles.md). Per-session rows provide totals and coverage, not separate per-session POCs. Only gaps overlapping a selected interval are reported in the composite's aggregate coverage; the session table attributes them individually. A gap may overlap multiple sessions but is not duplicated in the aggregate list solely for that reason.

The applied first/last timestamp is a **session span**, not a claim that its intervening off-session hours were included. `settings.windows` lists the contributing intervals. UTC sessions do not apply exchange calendars, holidays or automatic DST changes. Live Binance still holds only 50,000 prints, so a multi-day composite usually needs an appropriate historical executed-trade import. No historical trades are fetched automatically.

JSON export includes all composite rows, settings, windows, filter statistics and per-session coverage. Export remains tied to the last successful calculation, even if draft inputs have changed. These are session-local drafts/results; persistent profile presets remain future work.

## MCP

All existing scopes remain **read**. `order_flow`, `live_order_flow`, `volume_profile` and `tpo_profile` accept:

```json
{"minTradeSize": 0.25, "maxTradeSize": null}
```

Their usual required inputs still apply. Example composite arguments for `volume_profile`:

```json
{
  "source": "imported",
  "mode": "composite",
  "sessionDate": "2026-10-26",
  "sessionEndDate": "2026-10-30",
  "weekdays": [1, 2, 3, 4, 5],
  "sessionOpen": 1320,
  "sessionMinutes": 240,
  "tickSize": 10,
  "valueAreaPercent": 70,
  "minTradeSize": 0.25,
  "maxTradeSize": null
}
```

Weekdays use 0=Sunday through 6=Saturday, with all seven as default. Duplicates and empty lists fail validation. The 31-calendar-date limit applies before excluding weekdays. Session length is bounded to one day, so generated daily intervals cannot overlap. First date must not be after last; an impossible calendar date fails rather than rolling into another month.

New result fields:

- `filter`: applied bounds, `observedTrades`, `matchedTrades`, `excludedTrades`, and unit/method text.
- `settings.windows`: selected `[from,to)` intervals and UTC opening dates (anchored mode has one interval without an opening date).
- Volume `sessions`: each selected interval, observed/matching counts, matching buy/sell/delta, filter statistics and unfiltered coverage. Present for single-session and anchored mode as well.
- TPO `periods[].observedTrades` and `initialBalance.filter` retain prefilter counts alongside matching totals.

`totalTrades` now always means matching prints. Defaults preserve unfiltered behavior. Composite TPO is not enabled; `tpo_profile` rejects composite mode. No source data, stream, credential or order is changed by these reads.
