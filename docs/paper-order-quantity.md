# Resize pending paper orders

Added in v0.27.0 under **Research → Paper trading → Edit on chart**. Pending limit buys, limit sells and sell-stops support price and quantity edits. Market orders and completed orders cannot be edited.

## Review, then apply

1. Choose **Edit on chart** beside an order. Change **Draft quantity**, price, or both.
2. For a pending bracket entry, enter every target quantity explicitly. Their sum must equal the entry quantity. Target prices and the number of targets stay unchanged; allocations can change even if the total entry quantity stays the same.
3. Press **Review edit** to validate the proposed order and see affected orders, cash/held-quantity reservations, available cash and remaining unreserved holdings. Review does not write, fetch quotes or reserve anything.
4. Press **Apply reviewed edit** to save the amendment. Changing a field invalidates the review. Account changes require **Reload order · discard draft** and a new review; a filled or cancelled order locks the editor.

The saved order remains active while drafting and reviewing. Monitoring may fill it before Apply. Backend revision checks enforce the same rules even before the screen notices a change. After an uncertain Apply response, refresh and inspect the saved order before retrying. Drafts survive navigation during the session, but not app restarts.

## Reservations and linked exits

Buy edits replace the old fee-inclusive cash reservation and recheck current entry risk limits. Independent sell edits cannot reserve more holdings than remain after other pending exits.

For an active linked stop/target pair, editing either leg's quantity resizes **both legs atomically**, counting the held-quantity reservation once. The maximum is that pair's target allocation when the parent entry filled. Shrinking releases holdings; restoring quantity requires those holdings to remain free and cannot exceed the original allocation. Other target pairs retain their allocations. No automatic replacement exit is created for released holdings.

Price-only edits affect the selected leg. A stop must stay below its paired target; a pending bracket entry must stay between its stop and first target. Fees, slippage, identity, original submission and saved source-plan reference stay unchanged. Editing the paper order never rewrites the source plan.

Applying an edit does not itself fetch a quote or fill. Each affected order requires a quote requested **strictly after** its amendment timestamp, including both legs of a resized pair. Older in-flight quotes and same-millisecond requests cannot fill the resized order. This remains a full-fill spot simulation with polling limitations.

## MCP

`paper_amend_preview` uses **read** access; `paper_amend` requires **research** access. Both accept the same strict arguments:

```json
{
  "id": "11111111-1111-4111-a111-111111111111",
  "expectedRevision": 12,
  "price": 100,
  "quantity": 2,
  "targetQuantities": [0.8, 1.2]
}
```

Replace the ID/revision with values from `paper_account`. `price` remains required, even for quantity-only changes. `quantity` is optional for legacy price-only calls. `targetQuantities` applies only to a pending bracket entry, requires explicit `quantity`, and follows the existing target order with exactly the same target count. Omit it for independent orders and active linked exits.

Preview returns the account revision, previous order, proposed order(s), reservation totals before/after, free cash/holdings and risk usage. Apply validates again against the current account and returns the saved account snapshot. MCP clients may invoke Apply directly; the desktop requires its review step. No-op edits, unsupported fields, invalid target sums, insufficient reservations and stale revisions fail without a write.

## Storage and limits

Account archive **version 5** stores optional quantity and target allocations on immutable amendment events. Version 1–4 archives read and preview without rewriting; the next successful account mutation writes version 5. Older apps cannot read version-5 archives. Export before downgrading; account export restore/import is not implemented.

Existing quantity precision, event and order limits still apply. Trailing stops, adding targets while editing, attaching linked exits to existing holdings, options paper accounting and broker execution remain separate work. See [account assumptions](paper-trading.md) and [chart price editing](paper-order-editing.md).
