import { parentPort, workerData } from "node:worker_threads";
import { runOptionStrategy } from "./options-strategy.js";
import { LicensedOptionHistory } from "./licensed-option-history.js";
try {
  parentPort.postMessage({
    ok: true,
    result:
      workerData.mode === "licensed"
        ? await new LicensedOptionHistory({
            getToken: async () => workerData.token,
          }).load(workerData.input)
        : runOptionStrategy(workerData.records, workerData.input),
  });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error.message });
}
