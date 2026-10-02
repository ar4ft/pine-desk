const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desk", {
  call: (action, args) => ipcRenderer.invoke("desk:call", action, args),
  importOptionsArchive: () => ipcRenderer.invoke("desk:option-archive-import"),
  importScript: () => ipcRenderer.invoke("desk:script-import"),
  importCSV: () => ipcRenderer.invoke("desk:import"),
  exportFile: (name, text) => ipcRenderer.invoke("desk:export", name, text),
  openURL: (url) => ipcRenderer.invoke("desk:open", url),
});
