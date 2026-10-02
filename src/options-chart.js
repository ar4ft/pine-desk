import { Vela, registerNativeIndicator } from "@luxalgo/vela";
const type = "pine-desk-options-levels";
registerNativeIndicator({
  type,
  title: "Options levels · OI",
  overlay: true,
  paneHint: "price",
  legend: false,
  inputsSchema: () => [],
  defaultInputs: () => ({ levels: "[]" }),
  create() {
    let ctx,
      inputs = { levels: "[]" };
    const emit = () => {
      if (ctx)
        ctx.emit({
          priceLines: JSON.parse(inputs.levels).map((l, i) => ({
            id: `options-level-${i}`,
            paneId: "price",
            price: l.price,
            color: l.color,
            width: 1,
            lineStyle: "dashed",
            title: l.title,
          })),
        });
    };
    return {
      start(c, i) {
        ctx = c;
        inputs = i;
        emit();
      },
      onBars: emit,
      onViewport() {},
      setInputs(i) {
        inputs = i;
        emit();
      },
      suspend() {},
      resume: emit,
      stop() {
        ctx = null;
      },
    };
  },
});
export function levelLines(snapshot, symbol) {
  if (!snapshot?.levels || snapshot.ticker !== symbol) return [];
  const l = snapshot.levels;
  return [
    ["callWall", "Call wall · OI", "#63dfbd"],
    ["putWall", "Put wall · OI", "#f17789"],
    ["zeroGamma", "Gamma flip · cumulative · OI", "#f6cc70"],
  ]
    .filter(([key]) => Number.isFinite(l[key]) && l[key] > 0)
    .map(([key, title, color]) => ({ price: l[key], title, color }));
}
export function flowMarks(snapshot, symbol, bars, timeframe, minPremium = 0) {
  if (snapshot?.ticker !== symbol || !bars?.length) return [];
  const interval = {
    "1m": 60000,
    "5m": 300000,
    "15m": 900000,
    "1h": 3600000,
    "4h": 14400000,
  }[timeframe];
  if (!interval) return [];
  const first = bars[0].time,
    last = bars.at(-1).time + interval;
  return (snapshot.trades ?? [])
    .filter(
      (t) =>
        t.premium >= minPremium &&
        t.time >= first &&
        t.time < last &&
        bars.some((b) => t.time >= b.time && t.time < b.time + interval),
    )
    .slice(-500)
    .map((t) => ({
      id: `options-${t.id}`,
      time: t.time,
      group: "options-flow",
      title: `${t.contract} · ${t.side} side`,
      glyph: {
        color:
          t.side === "ask"
            ? "#63dfbd"
            : t.side === "bid"
              ? "#f17789"
              : "#9aa7bd",
        letter: t.type === "call" ? "C" : t.type === "put" ? "P" : "?",
      },
      tooltip: `${t.type} ${t.side} · $${t.premium.toLocaleString()} premium · ${t.contract}`,
      content: {
        panel: {
          items: [
            {
              type: "field",
              label: "Provider",
              value: "Unusual Whales · retained live print",
            },
            {
              type: "field",
              label: "UTC",
              value: new Date(t.time).toISOString(),
            },
            { type: "field", label: "Contract", value: t.contract },
            {
              type: "field",
              label: "Premium",
              value: `$${t.premium.toLocaleString()}`,
            },
            {
              type: "field",
              label: "Type / side",
              value: `${t.type} / ${t.side}`,
            },
            {
              type: "field",
              label: "Underlying at print",
              value:
                t.underlyingPrice === null
                  ? "Unavailable"
                  : String(t.underlyingPrice),
            },
            {
              type: "text",
              text: "NBBO side classification does not establish opening/closing intent. Multi-leg prints may belong to a spread.",
            },
          ],
        },
      },
    }));
}
export function attachOptionsChart(
  chart,
  getSnapshot,
  symbol,
  getBars,
  timeframe,
  getControls = () => ({ levels: true, markers: true, minPremium: 0 }),
) {
  const native = chart.addNativeIndicator(type);
  chart.marks.defineGroup({
    id: "options-flow",
    label: "Options flow",
    visible: true,
  });
  let priorLevels = null,
    priorMarks = null;
  const update = () => {
    const c = getControls(),
      snapshot = getSnapshot();
    const levels = JSON.stringify(c.levels ? levelLines(snapshot, symbol) : []);
    if (levels !== priorLevels) {
      native.setInputs({ levels });
      priorLevels = levels;
    }
    const marks = c.markers
      ? flowMarks(snapshot, symbol, getBars(), timeframe, c.minPremium)
      : [];
    const revision = marks.map((m) => m.id).join("|");
    if (revision !== priorMarks) {
      chart.marks.set(marks);
      priorMarks = revision;
    }
    return { lines: JSON.parse(levels).length, markers: marks.length };
  };
  return { update };
}

export function createOptionsPriceChart(
  element,
  bars,
  timeframe,
  appearance = { theme: "dark", upColor: "#63dfbd", downColor: "#f17789" },
) {
  return new Vela(element, {
    data: bars,
    timeframe,
    theme: appearance.theme,
    animations: { intro: false },
    upColor: appearance.upColor,
    downColor: appearance.downColor,
  });
}
