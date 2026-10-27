const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desk", {
  call: (action, args) => ipcRenderer.invoke("desk:call", action, args),
  importOptionsArchive: () => ipcRenderer.invoke("desk:option-archive-import"),
  importScript: () => ipcRenderer.invoke("desk:script-import"),
  importCSV: () => ipcRenderer.invoke("desk:import"),
  exportFile: (name, text) => ipcRenderer.invoke("desk:export", name, text),
  openURL: (url) => ipcRenderer.invoke("desk:open", url),
  agentReady: () => ipcRenderer.invoke("desk:agent-ready"),
  onAgentCommand: (handler) => {
    const listener = async (_event, request) => {
      try {
        const result = await handler(request.action, request.args);
        ipcRenderer.send("desk:agent-result", { id: request.id, result });
      } catch (error) {
        ipcRenderer.send("desk:agent-result", {
          id: request.id,
          error: {
            message: error.message,
            diagnostic: error.diagnostic ?? null,
          },
        });
      }
    };
    ipcRenderer.on("desk:agent-command", listener);
    return () => ipcRenderer.removeListener("desk:agent-command", listener);
  },
  onServiceChanged: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("desk:service-changed", listener);
    return () => ipcRenderer.removeListener("desk:service-changed", listener);
  },
});
