import { registerNativeIndicator } from "@luxalgo/vela";
export const paperLevelsType = "pine-desk-paper-order-levels";
registerNativeIndicator({
  type: paperLevelsType,
  title: "Paper order reference levels",
  overlay: true,
  paneHint: "price",
  legend: false,
  inputsSchema: () => [],
  defaultInputs: () => ({ levels: "[]" }),
  create() {
    let ctx, inputs;
    const emit = () =>
      ctx?.emit({
        priceLines: JSON.parse(inputs.levels).map((l, i) => ({
          id: `paper-ref-${i}`,
          paneId: "price",
          ...l,
          width: 1,
          lineStyle: "dashed",
        })),
      });
    return {
      start(c, i) {
        ctx = c;
        inputs = i;
        emit();
      },
      setInputs(i) {
        inputs = i;
        emit();
      },
      onBars: emit,
      onViewport() {},
      suspend() {},
      resume: emit,
      stop() {
        ctx = null;
      },
    };
  },
});
