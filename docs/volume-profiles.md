# Session and anchored volume profiles

Available in v0.15.0 under **Order flow → Volume profiles**. Profiles use executed trades with explicit aggressor sides. Candle volume is not split into estimated buys and sells.

## Use the desktop

1. Import a `time,price,size,side` CSV under **Executed trades**, save a live trade snapshot there, or start the existing Binance trade stream from the workspace.
2. Open **Volume profiles** and choose saved trades or the live retained window. This page does not start, stop or change a feed.
3. Choose **UTC session**, its opening date, opening time and duration (1–1440 minutes). Previous/next day changes the draft date. A session opening at 22:00 for 480 minutes ends at 06:00 the next UTC day.
4. Or choose **Anchored range** and enter an inclusive start and exclusive end. Both date/time inputs are interpreted as **UTC**, regardless of the Mac's time zone. The desktop allows second precision; MCP accepts millisecond boundaries.
5. Set the price bucket and value-area percentage, then **Compute profile**. The applied window and calculation timestamp appear above the result. Live-source results are snapshots: press Compute again to refresh.

Changes remain drafts until Compute. Failed calculations show an inline error and preserve the previous result, explicitly labeled as such. Drafts/results survive switching tabs during this app session; they are not saved as workspace layouts or restored after quitting.

The table shows sell, buy, total volume and delta for each occupied price bucket. Red/green horizontal bars share a scale based on the largest total row volume. POC is labeled; value-area rows are shaded. Pages contain 100 rows, with higher/lower controls and explicit counts. **Export result JSON** exports all rows of the applied result, its settings, coverage and calculation timestamp, even when draft controls have changed. Export does not include the original trades; retain those separately to recalculate.

## Boundaries and calculation

Session date means the date the session **opens** in UTC. Sessions are fixed elapsed-minute windows. Exchange holidays, trading calendars, IANA time zones and automatic daylight-saving adjustments are not applied. Adjust the UTC opening time when your intended exchange session changes. Anchored ranges are continuous intervals and can span several days, including all observed trades within that interval; they do not select recurring daily sub-sessions.

Trades are selected by `from <= trade.time < to`, before aggregation, without rounding timestamps to a candle boundary. Empty windows return zero totals and no value area. Imported input supports up to 200,000 trades; each profile allows up to 50,000 occupied price rows. Larger results fail explicitly. Small price buckets with more than 10¹² steps from zero and nonfinite aggregate volumes also fail.

Price buckets and value-area rules match [footprints](footprints.md): floor price to the bucket with decimal-boundary correction; choose the highest-volume POC, resolving ties toward the higher price. Expand one nearest occupied row at a time toward the larger adjacent volume, with ties toward higher prices, until the requested percentage is reached. Unoccupied gaps require no dense allocation. VAL is the lowest included bucket's lower edge; VAH is the highest included bucket's **exclusive upper edge**. Achieved volume percentage may exceed the target.

Quantity uses the supplied trade units. Binance spot uses base-asset size, not dollar notional or futures contracts. Delta is buy minus sell volume.

## Coverage

The result distinguishes the requested interval, first/last retained source trades and first/last observed trades inside the interval. It flags a requested start before the retained data, an end after retained data, and known overlapping gaps. An open-ended gap remains visible if it can overlap the requested window. Gap endpoints are treated conservatively as potentially missing prints.

These are **coverage observations, not proof of a complete session**. The absence of a known gap does not establish completeness. Binance live keeps only the latest 50,000 prints and does not backfill missed trades. A session may be truncated by the buffer, reconnects, app sleep or a late start. Use a suitable historical trade import for longer research. No volume is interpolated into missing periods. Resting depth is separate from executed volume.

## MCP

`volume_profile` requires **read** access. Attached clients use the desktop's saved trades or its existing live buffer. Standalone clients use their own owning service. It does not open an additional connection.

Example session arguments:

```json
{
  "source": "imported",
  "mode": "session",
  "sessionDate": "2026-10-28",
  "sessionOpen": 1320,
  "sessionMinutes": 480,
  "tickSize": 10,
  "valueAreaPercent": 70
}
```

`sessionOpen` is minutes after UTC midnight (0–1439). `sessionDate` is required in session mode. Defaults: saved source, session mode, open 00:00, duration 1440 minutes, bucket 10, value area 70%.

For an anchored range use `mode: "anchored"` with `from` and `to` as UTC Unix **milliseconds**, and optionally `source: "live"`. Both boundaries are required, start must precede end, and dates must be from 1970 onward within JavaScript's date range. Session-only settings have no effect in anchored mode; anchor-only settings have no effect in session mode.

Returns `settings`, `symbol`, `origin`, `calculatedAt`, `totalTrades`, `buy`, `sell`, `delta`, all `profile` rows, `valueArea` (or null) and `coverage`. Raw trades and provider credentials are not included.

## Remaining order-flow work

[TPO/time occupancy](tpo.md) is available in v0.16.0 in its own tab and MCP tool. [Composite UTC volume profiles and trade-size filters](composite-profiles.md) are available in v0.17.0. Exchange calendars/DST rules, chart-anchored drawing interaction and persistent profile presets remain follow-up work. This release supplies explicit UTC session and time-range profiles in their own analysis tab.

See [v0.17.0 filters and composites](composite-profiles.md) for matching/observed counts, per-session coverage and the extended `volume_profile` schema.
