// Browser-safe sampled heatmap geometry. No interpolation, smoothing or forward fill.
export function depthHeatmap(record, { rows = 100 } = {}) {
  if (!Number.isInteger(rows) || rows < 10 || rows > 200)
    throw Error("Use 10–200 heatmap price rows.");
  const frames = record.frames ?? [],
    books = frames.filter((f) => f.book).map((f) => f.book);
  if (!frames.length)
    return {
      cells: [],
      gaps: [],
      from: 0,
      to: 1,
      low: 0,
      high: 1,
      peak: 0,
      rows,
    };
  const interval = record.meta.intervalSeconds * 1000;
  const from = frames[0].gapBefore?.from ?? frames[0].at,
    to = frames.at(-1).at + interval;
  if (!books.length)
    return {
      cells: [],
      gaps: frames.flatMap((f) => [
        ...(f.gapBefore ? [f.gapBefore] : []),
        { from: f.at, to: f.at + interval, reason: f.reason },
      ]),
      from,
      to,
      low: 0,
      high: 1,
      peak: 0,
      rows,
    };
  const low = Math.min(...books.map((b) => b.bids.at(-1).price)),
    high = Math.max(...books.map((b) => b.asks.at(-1).price)),
    step = (high - low) / rows;
  const cells = [],
    gaps = [];
  let peak = 0;
  frames.forEach((frame, index) => {
    const end = Math.min(
      frame.at + interval,
      frames[index + 1]?.gapBefore?.from ?? Infinity,
      frames[index + 1]?.at ?? Infinity,
    );
    if (frame.gapBefore) gaps.push(frame.gapBefore);
    if (!frame.book) {
      gaps.push({
        from: frame.at,
        to: Math.max(frame.at, end),
        reason: frame.reason,
      });
      return;
    }
    // Bid/ask totals stay separate even when a coarse bin contains both sides.
    for (const side of ["bids", "asks"]) {
      const bins = new Map();
      for (const level of frame.book[side]) {
        const row = Math.min(rows - 1, Math.floor((level.price - low) / step));
        bins.set(row, (bins.get(row) ?? 0) + level.size);
      }
      for (const [row, size] of bins) {
        peak = Math.max(peak, size);
        cells.push({
          index,
          from: frame.at,
          to: Math.max(frame.at, end),
          row,
          side,
          size,
          priceFrom: low + row * step,
          priceTo: low + (row + 1) * step,
        });
      }
    }
  });
  return { cells, gaps, from, to, low, high, peak, rows };
}
