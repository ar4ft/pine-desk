import fs from "node:fs";
import vm from "node:vm";
import { executionDiagnostic } from "./diagnostics.js";
const bundle = fs.readFileSync(
  new URL("../node_modules/pinets/dist/pinets.min.browser.js", import.meta.url),
  "utf8",
);
const driver = fs.readFileSync(
  new URL("./pine-runtime.js", import.meta.url),
  "utf8",
);
process.once("message", async (request) => {
  try {
    const context = vm.createContext(Object.create(null), {
      name: "pine-desk-script",
    });
    vm.runInContext(
      "globalThis.fetch = () => { throw Error('External requests are disabled in backtests; import all research data first.'); };",
      context,
    );
    vm.runInContext(bundle, context, { timeout: 5000 });
    context.requestJSON = JSON.stringify(request);
    const output = await vm.runInContext(driver, context, { timeout: 5000 });
    if (Buffer.byteLength(output) > 32000000)
      throw Error("Script result exceeds 32 MB. Reduce the dataset or plots.");
    const message = JSON.parse(output);
    if (!message.ok)
      message.diagnostic = executionDiagnostic(
        Error(message.error),
        message.diagnostic?.phase ?? "execution",
      );
    process.send(message);
  } catch (error) {
    process.send({
      ok: false,
      error: error.message,
      diagnostic: executionDiagnostic(error, "execution"),
    });
  }
});
