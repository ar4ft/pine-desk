# Historical footprints, imbalances and volume value areas

Available in v0.14.0 under **Order flow → Executed trades**. Calculations use imported aggressor-tagged trades or the retained Binance raw-trade stream. Candles and resting order-book quantities cannot substitute for those trades.

## Navigate and configure

Choose the source, timeframe and price bucket. Set the imbalance ratio, minimum side size, stack length, zero-denominator rule and value-area percentage, then select **Recompute**. The applied-settings line identifies the parameters behind the displayed result. Editing controls does not change live calculations until applied. Changing the source applies the visible controls too.

Use **Oldest**, **Previous**, **Next**, or the **Occupied bar** number to inspect any retained footprint. Bars are fixed UTC intervals; only bars containing observed trades appear. Navigation pins the selected bar by timestamp. **Follow latest** returns to the newest occupied bar, which may still be forming. An evicted bar is explicitly unavailable rather than silently replaced by another historical bar.

Choose **Retained range** or **Selected bar** for the profile. The footprint and profile each page through 100 occupied price rows, so deeper rows remain accessible. Price buckets are labeled by their lower edge; each covers `[price, price + tickSize)`. Decimal-boundary rounding corrects small floating-point representation errors (within four machine epsilons of the integer price/tick ratio).

## Diagonal imbalances

For bucket index `i`, let `B[i]` be observed buy-aggressor volume and `S[i]` observed sell-aggressor base volume in that bar:

- Buy ratio: `B[i] / S[i − 1]`.
- Sell ratio: `S[i] / B[i + 1]`.

A positive numerator qualifies when it is at least **Minimum side size** and its ratio is at least **Imbalance ratio**. Thresholds are inclusive. Defaults are ratio **3×**, minimum side size **0**, and a stack of **3** buckets. These are volume comparisons, not trade-count comparisons or resting-liquidity ratios.

The adjacent bucket must lie within the bar's observed lowest-to-highest bucket range. Comparisons beyond that range are unavailable and never flag. An unoccupied interior bucket contributes zero observed opposite-side volume; missing exchange prints are not reconstructed.

**Zero denominator** defaults to **Exclude**. With **Flag positive size**, a positive numerator meeting the minimum size may flag against zero, but `0/0` never flags. Zero divisions display `÷0`, and the returned ratio is `null`, not JSON infinity. A null ratio without a zero marker is an unavailable edge comparison. Extremely large ratios that overflow numeric capacity cause an explicit calculation error.

A **stack** is a maximal run of qualifying imbalances of the same side at consecutive bucket indices within one bar. It must meet the configured length (2–20). Missing price buckets, nonqualifying rows and bar boundaries break the run. Buy and sell runs are evaluated independently. The UI marks qualifying rows with **IMB** and stacked rows with **STACK**; stack zones report an inclusive lower edge and exclusive upper edge.

## Volume value area

Both individual bars and the full retained range receive POC, VAL and VAH. Size is `buy + sell`, in the input's supplied size units (base asset for Binance spot). The default target is **70%**.

The deterministic calculation is:

1. Select the occupied bucket with the greatest total volume as POC. Equal volumes choose the **higher price**.
2. Begin with that bucket's volume.
3. Compare the nearest remaining **occupied** bucket below the current range with the nearest occupied bucket above it. Add the one with greater volume; equal volumes choose the **higher price**. If only one side remains, take that side.
4. Repeat until included volume reaches or exceeds the target, or all occupied buckets are included.
5. VAL is the lowest included bucket's lower edge. VAH is the highest included bucket's **exclusive upper edge**. POC remains the POC bucket's lower edge.

The achieved percentage is shown because whole buckets can overshoot the target. The algorithm skips empty price rows during expansion; the final bounds may span gaps with no observed trades. It does not use two-row expansion, distribution fitting, or a TPO/time-based value area. Other platforms can use different rules and may report different bounds from the same trades.

Example: volumes of `3, 4, 10, 4, 1` at prices `98, 99, 100, 101, 102`, with bucket size 1 and a 70% target, choose POC 100. The first tie adds 101, then 99. VAL is 99, VAH is 102, and included volume is 18/22 (81.82%).

## Coverage, limits and interpretation

Live analytics cover only the retained raw-trade window (currently up to 50,000 prints), with known stream gaps preserved. Saved live trade snapshots also retain their gap evidence when reopened as imported/saved trades. A selected bar overlapping a known gap gets an explicit warning. The first and latest bars may be partial, and imported data may have unreported omissions. No gap warning is not proof of complete coverage.

CVD starts at zero at the beginning of the retained input and accumulates occupied-bar delta. It is not automatically a full-session CVD. The compact CVD plot follows occupied-bar order; missing intervals are omitted rather than filled. Prices with no observed executions are omitted from footprint tables.

These marks describe executed volume. They do not establish a trade recommendation, hidden order size, liquidity persistence or future price direction. [Recorded liquidity heatmaps](depth-recording.md) analyze resting depth separately.

Input supports up to 200,000 trades. Calculation is capped at 10,000 occupied bars and 50,000 occupied footprint rows across all bars. A price/tick ratio above 10¹², invalid settings, unsupported dates or numeric overflow produces a clear error. Increase the timeframe/price bucket or shorten the input range when a capacity limit is reached. No rows are silently dropped by these limits.

## MCP

Both existing read-only tools, `order_flow` (saved/imported trades) and `live_order_flow` (owning service's live buffer), accept the same settings:

```json
{
  "timeframe": "1m",
  "tickSize": 1,
  "imbalanceRatio": 3,
  "minImbalanceVolume": 0,
  "stackLength": 3,
  "zeroDenominator": "exclude",
  "valueAreaPercent": 70
}
```

Responses retain existing totals, bars, profile, POC and CVD fields and add:

- `settings`: the applied configuration.
- `valueArea`: range POC, `low`, `high`, target/actual percentages, included/total volume, occupied-row count and method.
- Each bar's `valueArea` and `stacks` (`side`, `from`, exclusive `to`, `levels`).
- Each price row's integer `index`, buy/sell ratios, zero-denominator markers, imbalance flags and stack flags.

`gaps` and provenance remain part of the service response. Tools do not start feeds or change the displayed editor/research dataset.

## Verification and follow-up

Fixtures cover both diagonal directions, inclusive thresholds, zero/edge comparisons, interrupted runs, bar isolation, POC/expansion ties, achieved percentages, decimal boundaries, sparse price ranges, overflow and capacity limits. Browser checks cover history pinning, live draft preservation, eviction, profile scope, paging and both themes. Native desktop/installed macOS checks compare the MCP result with actual displayed stack/value-area output.

Exchange calendars and DST handling, composite TPO and chart-integrated footprint rendering remain follow-up work.

[Session and anchored volume profiles](volume-profiles.md) are available in v0.15.0 in the separate Volume profiles tab and via `volume_profile`.

[Observed-trade TPO analysis](tpo.md) is available in v0.16.0 as a separate count-based profile, with period letters and observed initial balance.

[Individual-print size filters and composite volume profiles](composite-profiles.md) are available in v0.17.0. Print filters are distinct from the aggregated minimum side-size threshold for imbalances.
