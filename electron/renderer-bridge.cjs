const { randomUUID } = require("node:crypto");
function rendererBridge({ ipcMain, getWindow, trusted }) {
  const pending = new Map();
  let ready = false;
  const rejectAll = () => {
    ready = false;
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(
        Error(
          "Desktop workspace disconnected. Check its state before retrying.",
        ),
      );
    }
    pending.clear();
  };
  ipcMain.removeHandler("desk:agent-ready");
  ipcMain.handle("desk:agent-ready", (event) => {
    if (!trusted(event)) throw Error("Untrusted window.");
    ready = true;
  });
  ipcMain.removeAllListeners("desk:agent-result");
  ipcMain.on("desk:agent-result", (event, response) => {
    if (!trusted(event) || !response || !pending.has(response.id)) return;
    const request = pending.get(response.id);
    pending.delete(response.id);
    clearTimeout(request.timer);
    response.error
      ? request.reject(
          Object.assign(Error(response.error.message), {
            diagnostic: response.error.diagnostic,
          }),
        )
      : request.resolve(response.result);
  });
  return {
    rejectAll,
    request(action, args) {
      const win = getWindow();
      if (!ready || !win || win.isDestroyed())
        return Promise.reject(
          Error(
            "Open the desktop window and wait for the workspace to finish loading.",
          ),
        );
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            Error(
              "Desktop chart command timed out. Check its state before retrying.",
            ),
          );
        }, 90000);
        pending.set(id, { resolve, reject, timer });
        win.webContents.send("desk:agent-command", { id, action, args });
      });
    },
  };
}
module.exports = { rendererBridge };
