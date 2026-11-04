# Edit pending paper orders on a chart

Added in v0.24.0 under **Research → Paper trading**. Choose **Edit on chart** beside a pending limit buy, limit sell or sell-stop order. Drag the amber draft line or type a price, then press **Apply price edit**. Dragging alone never changes an order. Market orders and completed orders cannot be edited.

The editor fetches up to 300 public, settled Binance candles for the selected order's market. Choose 1m, 5m, 15m, 1h, 4h or 1d and use **Refresh candles** for another snapshot. These candles are context only: they do not process orders, start monitoring, change the workspace dataset or provide historical fills. If fetching fails, numeric editing remains available. **Fit draft level** includes the current draft in the chart's price range.

Gray reference lines show the saved price; red/green references show attached or paired stop/target levels. Only the amber line edits the draft. Deleting the drawing does not cancel the order; use **Cancel** in the order table.

## Validation and concurrent changes

An edit changes only the price. Order identity, quantity, fee/slippage assumptions, source-plan reference and original submission remain intact. The ledger appends an `amend` event. A buy's cash reservation is recalculated including fees, excluding its previous reservation; current buy-risk limits are checked again. A pending bracket entry must remain above its attached stop and below its first target. A linked sell-stop must remain below its paired target; editing an exit preserves the OCO relationship and shared quantity reservation. Editing a queued order does not change its saved source plan.

The editor captures the account revision when opened. If monitoring, another window or MCP changes the account, the draft remains visible but Apply is disabled. **Reload order · discard draft** explicitly replaces it with the current saved price. Completed orders stay locked. The backend checks the revision again even if the UI has not yet observed a change. After an uncertain connection response, reload the account before retrying.

The saved order remains active while you edit. A successful price edit does not itself request a fill. Manual Process or the enabled monitor must use a quote requested **strictly after** the latest edit timestamp. Quotes fetched before the edit, including requests in the same millisecond, cannot fill the amended order. Polling can miss crossings; this remains a spot paper-account simulation, not exchange execution.

## MCP

`paper_order_chart` uses read access. Arguments are an order `id` and optional `timeframe` (default `1h`). Its candles belong to that order's market regardless of the workspace chart.

`paper_amend` requires research permission and exactly these arguments:

```json
{
  "id": "11111111-1111-4111-a111-111111111111",
  "expectedRevision": 12,
  "price": 105.5
}
```

Use the actual order ID and current account revision from `paper_account`. No-op edits and changes to quantity or any other field are rejected. The response is the saved account snapshot; the same validation applies through the desktop and MCP.

## Persistence and scope

Account archive version 4 retains ordered submit, cancel, process, risk and amend events. Version 1–3 accounts replay without a read-time rewrite and migrate on their next successful mutation. Older app versions cannot read version-4 archives. Export the account before downgrading; export restore/import is not implemented.

This release edits existing pending prices. Chart-based order creation, quantity editing, trailing stops, attaching linked exits to existing holdings, options paper trading and broker execution remain separate work. See [paper account model](paper-trading.md) and [journal/history](paper-journal-history.md).
