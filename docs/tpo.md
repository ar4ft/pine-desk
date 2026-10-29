# TPO analysis

Available in v0.16.0 under **Order flow → TPO analysis**, and through the read-only MCP tool `tpo_profile`.

TPO means *time-price opportunity*. Pine Desk computes **observed-trade occupancy**: one TPO for each price bucket with at least one recorded execution in a given time period. Ten prints, a large print, or both aggressor sides at that bucket during the same period still count as one TPO. Another period at that price adds another TPO.

This is different from the [volume profile](volume-profiles.md), which weights rows by executed size. It also differs from a candle high/low approximation that fills every price between the extremes: Pine Desk does **not** fill unobserved prices or empty periods. It does not estimate seconds spent at a price, queue depth, or liquidity. Agreement with other platforms depends on input data, bucketing and their TPO/POC/value-area definitions.

## Desktop workflow

1. Import or save trades under **Executed trades**, or start the existing Binance live trade feed in the workspace.
2. Open **TPO analysis**. Choose saved trades or the live retained window, then a UTC session or anchored start/end range. Dates, overnight sessions and inclusive start/exclusive end follow [volume-profile rules](volume-profiles.md).
3. Set the price bucket, TPO value-area percentage, **TPO period** (1–240 whole minutes, default 30) and **initial balance** (1–1440 minutes, default 60).
4. Press **Compute profile**. Results are snapshots; Compute refreshes the chosen source. Draft changes do not relabel an earlier result. An error preserves the last result with a clear message.

The table shows price, TPO count and observed period letters. Hover a letter for its UTC interval; expand **Period times and coverage** for a keyboard-accessible list. Letters run A–Z, then AA–AZ, BA… without wrapping. A always begins at the requested start, rather than the first retained trade or a wall-clock boundary. An anchored start at 09:17 and 30-minute periods therefore gives A 09:17–09:47, B 09:47–10:17, etc. The last period is clipped at the requested end and explicitly labeled partial.

Every requested period appears in the coverage list, including those without recorded trades. The profile table only contains occupied price rows, paged 100 at a time. Rows with one TPO have **ONE PERIOD** labels, including profile extremes; this is an occupancy count, not a filtered “single-print” trading signal.

**Export result JSON** saves the entire calculated profile, periods, method, settings, coverage, initial balance and timestamp. It exports the applied result even if controls now contain different drafts. Original trades are not included. Drafts and results survive tab navigation during the app session, independently of the volume-profile tab; they are not restored after quitting.

## POC and TPO value area

Price buckets use the same decimal-boundary-corrected flooring as footprints and volume profiles. POC is the occupied row with the **largest number of TPOs**, with ties choosing the higher price. It is not a volume POC.

Starting at POC, expand one nearest occupied row at a time toward the side with the larger count. Expansion ties also choose higher prices. Stop when the accumulated count meets or exceeds the target fraction of total TPOs. Empty price gaps are skipped when choosing occupied neighbors, but enclosed by the final range. VAL is the lowest included bucket's lower edge; VAH is the highest included bucket's **exclusive upper edge**. The achieved percentage may exceed the target. This uses one-row expansion, not a two-row comparison or midpoint-distance POC tie rule.

Example: row 102 appears in A, B and C; rows 100 and 101 each appear once. Total TPOs are 5, POC is 102, and the 70% target expands to 101. The area contains 4 TPOs (80%), with VAL 101 and VAH 103 for a bucket size of 1. Changing trade size does not change this result.

## Observed initial balance

The initial balance is the observed price-bucket range during the first configured number of minutes from the **requested start**, independently of TPO period boundaries. Its end is exclusive and clipped to the requested end if necessary. A range anchored in the middle of a trading day therefore has an initial balance for that anchored window, not automatically the exchange's official opening hour.

Only recorded trades inside that interval contribute. The reported low is a bucket lower edge; high is an exclusive bucket upper edge, not the exact highest execution price. Later trades cannot extend it. No opening trades means an unavailable range, not a substituted later range. Its own retention and known-gap warnings accompany the result. Incomplete opening coverage can understate its extent.

## Coverage and limits

TPO uses the same `time,price,size,side` input format as other executed-trade analytics. Size and aggressor side must remain valid for that shared format but do not weight TPO. The source supports up to 200,000 imported trades. Binance live retains only the latest 50,000 prints; it does not backfill trade gaps. Each calculation allows at most **288 periods** and **50,000 occupied price rows**. Exceeding a limit fails explicitly. Choose longer periods, larger buckets or a shorter range as appropriate.

Requested windows, retained timestamps, observed timestamps and known overlapping gaps remain separate. A zero-print period is “no observed trades,” not proof that the exchange was inactive. No known gap is not proof of completeness. Session calendars, automatic DST adjustment and historical trade retrieval are not supplied; sessions use fixed UTC boundaries. Neither desktop nor MCP calculations start a stream or mutate saved trades.

## MCP

`tpo_profile` requires **read** access. It uses the owning service's saved trades or shared live buffer. All session/anchor inputs match `volume_profile`, plus `periodMinutes` and `initialBalanceMinutes`.

```json
{
  "source": "imported",
  "mode": "session",
  "sessionDate": "2026-10-29",
  "sessionOpen": 0,
  "sessionMinutes": 1440,
  "tickSize": 10,
  "valueAreaPercent": 70,
  "periodMinutes": 30,
  "initialBalanceMinutes": 60
}
```

For anchored mode, supply `from` and `to` as UTC Unix **milliseconds**. `periodMinutes` defaults to 30 and `initialBalanceMinutes` to 60. Returns:

- `settings`, `symbol`, `origin`, `calculatedAt`, and explicit `method`.
- `totalTrades`, `totalTpos`, `occupiedPeriods`, `onePeriodRows`.
- `profile`: price/index, count and zero-based period indices for every occupied row.
- `periods`: labels, UTC boundaries, print/TPO counts, observed timestamps, partial-interval flag and coverage flags.
- `valueArea`: POC/VAL/VAH, target/achieved percentages and `tpoCount`/`totalTpos`, or null for an empty window.
- `initialBalance`: observed bucket range, interval, clipping, print count and coverage.
- `coverage`: retained/observed timestamps and overlapping known gaps.

Volume fields are deliberately absent from the TPO value area. Empty requested windows return zero counts and no inferred value area or initial-balance range.

## Further order-flow work

[Trade-size filtering and composite volume profiles](composite-profiles.md) are available in v0.17.0. Composite TPO, exchange calendars/DST rules, persistent profile presets and chart-integrated footprint/TPO rendering remain follow-up work. Candle-based approximations, split-column TPO charts and automated pattern classifications are not included in this release.

In v0.17.0, optional individual-print size bounds apply before TPO deduplication and initial-balance calculations. Applied statistics distinguish matching and observed prints; coverage continues to describe unfiltered observations. See [filter semantics](composite-profiles.md).
