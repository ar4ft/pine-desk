import { z } from "zod";
import { estimatePlan } from "./trade-plans.js";
import { paperOrderSchema } from "./paper-account.js";
const positive = z.number().finite().positive().max(1e12);
export const paperSizingSchema = z
  .object({
    symbol: z.string().regex(/^[A-Z0-9]{2,20}USDT$/),
    price: positive,
    stop: positive,
    riskBudget: positive,
    maxNotional: positive,
    quantityStep: z.number().finite().min(1e-8).max(1e6),
    feePercent: z.number().finite().min(0).max(5).default(0.1),
    slippage: z.number().finite().min(0).max(1e9).default(0),
    targets: z
      .array(
        z
          .object({
            price: positive,
            percent: z.number().int().min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();
export function sizePaperOrder(raw) {
  const request = paperSizingSchema.parse(raw);
  const estimate = estimatePlan({
    name: "Chart paper order sizing",
    symbol: request.symbol,
    venue: "Binance spot",
    currency: "USDT",
    side: "long",
    assetType: "spot",
    equity: request.riskBudget,
    riskPercent: 100,
    entry: request.price,
    stop: request.stop,
    quantityStep: request.quantityStep,
    maxNotional: request.maxNotional,
    feePercent: request.feePercent,
    slippage: request.slippage,
    targets: request.targets,
  });
  if (estimate.quantity === 0 || estimate.targets.some((t) => t.quantity === 0))
    throw Error(
      "Sizing leaves an empty entry or target allocation. Increase the budget/cap, reduce the increment, or use fewer targets.",
    );
  const order = paperOrderSchema.parse({
    symbol: request.symbol,
    side: "buy",
    type: "limit",
    price: request.price,
    quantity: estimate.quantity,
    feePercent: request.feePercent,
    slippage: request.slippage,
    bracket: {
      stop: request.stop,
      targets: estimate.targets.map((t) => ({
        price: t.price,
        quantity: t.quantity,
      })),
    },
  });
  return {
    modelVersion: 1,
    request,
    order,
    quantity: estimate.quantity,
    entryFill: estimate.entryFill,
    stopFill: estimate.stopFill,
    perUnitRisk: estimate.perUnitRisk,
    riskBudget: estimate.riskBudget,
    risk: estimate.risk,
    entryNotional: estimate.entryNotional,
    estimatedEntryCost: estimate.entryNotional * (1 + request.feePercent / 100),
    targets: estimate.targets,
    warnings: estimate.warnings,
    assumptions:
      "Scenario sizing: entry plus adverse slippage, stop minus adverse slippage, fees on both fills. Quantity rounds down by the chosen increment; the last target receives remaining increments. The notional cap excludes fees. Actual paper limit buys cannot fill above their limit; stop gaps can exceed this modeled loss. No account cash/risk checks, market validation, exchange lot-size lookup, quotes, reservations or orders; review the returned order before submitting.",
  };
}
