import { Worker } from "node:worker_threads";
const active = new Set();
export function stopOptionStudies() {
  for (const cancel of active) cancel();
}
export function runOptionStudy(
  records,
  input,
  { timeoutMs = 60000, mode = "rules", token } = {},
) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./option-study-worker.js", import.meta.url),
      {
        execArgv: [],
        workerData: { records, input, mode, token },
        resourceLimits: { maxOldGenerationSizeMb: 512 },
      },
    );
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      active.delete(cancel);
      worker.terminate();
      error ? reject(error) : resolve(result);
    };
    const cancel = () => finish(Error("Options study cancelled on shutdown."));
    const timer = setTimeout(
      () =>
        finish(
          Error("Options study exceeded 60 seconds; reduce observations."),
        ),
      timeoutMs,
    );
    active.add(cancel);
    worker.once("message", (message) =>
      finish(message.ok ? null : Error(message.error), message.result),
    );
    worker.once("error", (error) => finish(error));
    worker.once("exit", (code) =>
      finish(Error(`Options worker exited without a result (${code}).`)),
    );
  });
}
