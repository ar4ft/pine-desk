# Depth recording, liquidity heatmaps and playback

Available in v0.13.0. This is a local archive of **sampled resting liquidity** from the [synchronized Binance spot order book](live-depth.md), not a capture of every exchange update or a historical-data download.

## Record and replay

1. Open **Order flow → Live order book / DOM**, choose a Binance spot pair and start depth.
2. Open **Recorded liquidity**. Set a name, 10/20/50/100 levels per side and a 1/2/5/10-second interval, then choose **Record current depth**.
3. Keep **Follow active recording** checked to see the newest committed samples. Pending samples appear in the recorder status but are not yet in the archive.
4. Choose **Stop recording** to flush pending samples. This leaves the live depth feed running.
5. Select an archive. Click the heatmap or move the sample slider to inspect a recorded book. **Play** advances through the selected window at 1×, 5× or 20× using actual sample timestamps. Longer missing intervals consume their actual elapsed playback time. Playback stops at the window's end or when you leave the page.

The viewer loads 300 samples per window; **Older window** and **Newer window** page through larger recordings. Selecting an archive, scrubbing or playing turns off following. **Export window JSON** exports only the selected window, with its offset, total sample count, metadata and gap evidence. The app does not currently import depth archives or offer a one-click full-recording export; MCP can retrieve consecutive windows.

Deleting a recording requires an in-app confirmation and is permanent. The active recording cannot be deleted. Reading, playing or exporting an archive never changes candles, alerts, the live book or the research dataset.

## How to read the heatmap

- Horizontal position is actual local observation time. Vertical position is price in the pair's quote asset. Each window uses 100 equal price bins between its lowest recorded bid and highest recorded ask.
- Each cell contains the sum of sampled **base-asset size** for one side in that price bin. Bids are green, asks red; if both sides share a coarse price bin, they occupy separate halves. This is aggregation across price, not a sum of observations across time.
- Color intensity is `log(1 + cell size) / log(1 + largest cell size in this window)` with a minimum visible opacity. The legend reports the largest cell. Color intensities are not directly comparable between separately scaled windows.
- A sample is displayed in a slot of up to one configured interval, clipped by the next sample or gap. Slots illustrate discrete observations; they do not assert that orders stayed unchanged throughout that time.
- Hatched areas mark unavailable books, missed sampling intervals and detected book resynchronizations. Blank areas mean no recorded quantity there; they do not prove that the exchange had zero liquidity.

The selected sample shows up to ten rows per side, exchange time, update ID, mid and spread. Clicks select the nearest actual sample. Inspect its time and any preceding-gap notice; there is no interpolated book at an arbitrary point between observations.

Only the chosen top levels are saved, within the live book's known snapshot boundaries. A bright band is resting displayed size at sampled times. It is not evidence of executions, iceberg orders, queue position, dealer gamma or guaranteed fills. Orders can appear and cancel between samples without appearing in this archive.

## Gaps and lifecycle

The recorder lives in the owning desktop/service process and keeps sampling while you navigate or close the Mac window without quitting. It shares the existing book connection; it does not open another market feed.

A stale or unsynchronized book becomes a sample with `book: null` and a reason. Valid samples keep exchange/receipt timestamps, update ID, connection identity, quantities, units and coverage. A changed connection between two valid samples adds a reset gap even if reconnection finished between timer ticks. An observation more than 1.5 configured intervals after the previous one records the missed interval as a gap. Sampling is scheduled after the previous capture finishes; storage latency can therefore affect cadence. A backwards clock stops the recorder.

Stopping depth or changing its symbol finalizes the current recording before changing the feed. Normal service shutdown flushes and stops it. Recording never resumes automatically. A manifest left open by a terminated process becomes **interrupted** when the archive is next initialized/read, with only its previously committed samples available.

## Storage and limits

One recorder may run at a time. A recording stops at 3,600 observations, including missing-book samples: roughly one hour at 1-second sampling or ten hours at 10 seconds, plus delays. The archive allows 30 recordings and 250 MB of committed compressed chunk data. It stops on limits or storage errors and never automatically deletes older recordings. Manifest files and temporary/unindexed files are additional filesystem overhead.

Data lives under the existing Pine Desk data directory:

- `depth-recordings/<id>.json`: versioned manifest, metadata, committed count, lifecycle status, chunk IDs, offsets, byte counts and SHA-256 hashes.
- `depth-frames/<id>-<chunk>.json.gz`: immutable compressed batches.

The first sample is committed immediately. Later batches contain up to ten samples; normal stop flushes a partial batch. A batch becomes visible only after its chunk is written and the manifest is atomically replaced. Reads verify each requested chunk's hash and schema. Missing or altered chunks cause an explicit error instead of rendering invented data.

An app crash can lose the pending batch of up to ten samples (up to about ten configured intervals). A disk failure stops sampling, discards uncommitted memory and preserves the previously committed manifest; it does not stop the underlying live feed. If final status cannot be saved, the next owner marks the manifest interrupted. Atomic replacement and hash verification are not a guarantee against power loss or filesystem damage. The app does not automatically repair a damaged archive.

## MCP tools

Use the existing [desktop MCP setup](desktop-mcp.md). Tools operate on the same recorder/archive as the desktop.

| Tool | Permission | Purpose |
| --- | --- | --- |
| `depth_record_start` | streams | Record the already-running book; accepts `name`, `levels` (1–100), `intervalSeconds` (1, 2, 5, 10) |
| `depth_record_stop` | streams | Flush and stop recording; keep the market feed running |
| `depth_record_status` | read | Active state, error, committed metadata, pending count and feed state |
| `depth_recordings` | read | List archives and lifecycle/coverage metadata |
| `depth_recording_get` | read | Read `id`, optional zero-based `offset`, and `limit` (1–600, default 300; omitted offset selects latest) |
| `depth_recording_delete` | research | Permanently remove one stopped recording |

Example calls:

```json
{"name":"depth_record_start","arguments":{"name":"BTC morning depth","levels":50,"intervalSeconds":1}}
{"name":"depth_record_status","arguments":{}}
{"name":"depth_record_stop","arguments":{}}
{"name":"depth_recording_get","arguments":{"id":"<id from status or list>","offset":0,"limit":300}}
```

Revoking MCP access prevents new client operations, but does not stop a recording already owned by the service. Stop it through the app. Remote LLM clients receive any archive content they request.

## Verification and next steps

Tests cover chunk commit/rollback, restart interruption, missing observations, sleep/reset gaps, timestamp and symbol validation, storage quotas, the 3,600-sample cap, checksum failures, pagination, heatmap aggregation and MCP capabilities. Browser tests cover recording controls, playback, gap selection, export, deletion, reload and both themes. Native desktop/installed macOS smoke tests verify a shared MCP recording, real compressed storage and replay after app restart using deterministic exchange transport.

An opt-in public Binance smoke check (`npm run smoke:depth-recording`) records into a temporary directory, stops, reopens and verifies exact persisted samples, then removes its test archive.

Full exchange-diff capture, archive import/full export, configurable price buckets, cross-window zoom, additional exchanges and order execution remain follow-up work. Advanced executed-trade footprints, value areas and TPO are separate analytics from resting depth.
