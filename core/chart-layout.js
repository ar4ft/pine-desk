export const comparisonIds = ["compare-1", "compare-2", "compare-3"];
export function chartLayout(input) {
  if (input === undefined || input === null)
    return {
      count: 1,
      linkSymbol: false,
      linkTimeframe: false,
      linkRange: true,
      linkCrosshair: true,
      panels: comparisonIds.map((id, i) => ({
        id,
        symbol: ["ETHUSDT", "SOLUSDT", "BTCUSDT"][i],
        timeframe: "1h",
        chart: null,
        dataset: null,
      })),
    };
  if (
    ![1, 2, 4].includes(input.count) ||
    !["linkSymbol", "linkTimeframe", "linkRange", "linkCrosshair"].every(
      (k) => typeof input[k] === "boolean",
    ) ||
    !Array.isArray(input.panels) ||
    input.panels.length !== 3
  )
    throw Error("Invalid linked chart layout.");
  return {
    count: input.count,
    ...Object.fromEntries(
      ["linkSymbol", "linkTimeframe", "linkRange", "linkCrosshair"].map((k) => [
        k,
        input[k],
      ]),
    ),
    panels: input.panels.map((p, i) => {
      if (
        p.id !== comparisonIds[i] ||
        !/^[A-Z0-9]{3,24}$/.test(p.symbol) ||
        !["1m", "5m", "15m", "1h", "4h", "1d"].includes(p.timeframe)
      )
        throw Error("Invalid comparison market.");
      return {
        id: p.id,
        symbol: p.symbol,
        timeframe: p.timeframe,
        chart: p.chart ?? null,
        dataset: p.dataset ?? null,
      };
    }),
  };
}
