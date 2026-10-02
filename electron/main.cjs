const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  Menu,
  safeStorage,
  screen,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
let win, updates, shutdown;
let windowStore;
const { gracefulQuit } = require("./graceful-quit.cjs");
const isQuitting = gracefulQuit({
  app,
  persist: () =>
    win &&
    !win.isDestroyed() &&
    windowStore?.write("window-state", win.getNormalBounds()),
  stop: () => {
    updates?.stop();
    shutdown?.();
  },
});
app.setName("Pine Desk");
if (process.env.PINE_DESK_DATA_DIR) {
  require("node:fs").mkdirSync(process.env.PINE_DESK_DATA_DIR, {
    recursive: true,
  });
  app.setPath("userData", process.env.PINE_DESK_DATA_DIR);
}
async function createWindow() {
  const { installCredentialVault } = await import("../core/credentials.js");
  installCredentialVault({
    available: () =>
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== "linux" ||
        safeStorage.getSelectedStorageBackend() !== "basic_text"),
    encrypt: (text) => safeStorage.encryptString(text).toString("base64"),
    decrypt: (encoded) =>
      safeStorage.decryptString(Buffer.from(encoded, "base64")),
  });
  const service = await import("../core/service.js");
  const { dispatch } = service;
  shutdown = service.shutdown;
  const store = await import("../core/store.js");
  windowStore = store;
  const savedWindow = await store.read("window-state");
  const area = screen.getPrimaryDisplay().workArea;
  const geometry = {
    width: Math.min(area.width, Math.max(1100, savedWindow?.width || 1510)),
    height: Math.min(area.height, Math.max(740, savedWindow?.height || 980)),
  };
  if (
    savedWindow &&
    screen
      .getAllDisplays()
      .some(
        (d) =>
          savedWindow.x >= d.workArea.x &&
          savedWindow.y >= d.workArea.y &&
          savedWindow.x + 100 <= d.workArea.x + d.workArea.width &&
          savedWindow.y + 100 <= d.workArea.y + d.workArea.height,
      )
  ) {
    geometry.x = savedWindow.x;
    geometry.y = savedWindow.y;
  }
  win = new BrowserWindow({
    ...geometry,
    minWidth: 1100,
    minHeight: 740,
    title: "Pine Desk",
    backgroundColor: "#0b1018",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  let closing = false;
  win.on("close", (event) => {
    if (closing || isQuitting()) return;
    event.preventDefault();
    closing = true;
    store
      .write("window-state", win.getNormalBounds())
      .catch(() => {})
      .finally(() => win.close());
  });
  const trusted = (event) => {
    const url = event.senderFrame?.url ?? "";
    return (
      event.sender === win.webContents &&
      (app.isPackaged
        ? url.startsWith("file://")
        : url.startsWith("file://") || url.startsWith("http://127.0.0.1:5173/"))
    );
  };
  ipcMain.removeHandler("desk:call");
  ipcMain.handle("desk:call", async (event, action, args) => {
    if (!trusted(event)) throw new Error("Untrusted window.");
    try {
      return await dispatch(action, args);
    } catch (error) {
      if (error.diagnostic)
        throw new Error(
          JSON.stringify({ pineDeskError: true, diagnostic: error.diagnostic }),
        );
      throw error;
    }
  });
  ipcMain.removeHandler("desk:import");
  ipcMain.handle("desk:import", async (event) => {
    if (!trusted(event)) throw new Error("Untrusted window.");
    const selection = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (selection.canceled) return null;
    const stat = await fs.stat(selection.filePaths[0]);
    if (stat.size > 20_000_000)
      throw new Error("CSV must be smaller than 20 MB.");
    return fs.readFile(selection.filePaths[0], "utf8");
  });
  ipcMain.removeHandler("desk:option-archive-import");
  ipcMain.handle("desk:option-archive-import", async (event) => {
    if (!trusted(event)) throw new Error("Untrusted window.");
    const selection = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "Option snapshot archive", extensions: ["json"] }],
    });
    if (selection.canceled) return null;
    const file = selection.filePaths[0],
      stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 25000000)
      throw new Error("Archive must be a file up to 25 MB.");
    const bytes = await fs.readFile(file);
    if (bytes.length > 25000000) throw new Error("Archive exceeds 25 MB.");
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("Archive must be UTF-8 JSON.");
    }
  });
  ipcMain.removeHandler("desk:script-import");
  ipcMain.handle("desk:script-import", async (event) => {
    if (!trusted(event)) throw new Error("Untrusted window.");
    const selection = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "Pine Script source", extensions: ["pine", "txt"] }],
    });
    if (selection.canceled) return null;
    const file = selection.filePaths[0],
      stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 200000)
      throw new Error("Pine source must be a file smaller than 200 KB.");
    const bytes = await fs.readFile(file);
    if (bytes.length > 200000)
      throw new Error("Pine source must be smaller than 200 KB.");
    let source;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("Save the script as plain UTF-8 text.");
    }
    return { name: path.basename(file), source };
  });
  ipcMain.removeHandler("desk:export");
  ipcMain.handle("desk:export", async (event, name, text) => {
    if (
      !trusted(event) ||
      typeof text !== "string" ||
      text.length > 100_000_000
    )
      throw new Error("Invalid export.");
    const result = await dialog.showSaveDialog(win, {
      defaultPath: path.basename(name),
    });
    if (!result.canceled) await fs.writeFile(result.filePath, text);
    return !result.canceled;
  });
  ipcMain.removeHandler("desk:open");
  ipcMain.handle("desk:open", async (event, url) => {
    if (
      !trusted(event) ||
      !/^https:\/\/(www\.luxalgo\.com|docs\.luxalgo\.com|velacharts\.dev|github\.com|api\.unusualwhales\.com|unusualwhales\.com)\//.test(
        url,
      )
    )
      throw new Error("Unsupported external link.");
    return shell.openExternal(url);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  if (process.argv.includes("--dev"))
    await win.loadURL("http://127.0.0.1:5173");
  else await win.loadFile(path.join(__dirname, "../dist/index.html"));
}
app.whenReady().then(async () => {
  await createWindow();
  const { createUpdates } = require("./updates.cjs");
  updates = createUpdates({ app, dialog, getWindow: () => win });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin"
        ? [{ role: "appMenu" }]
        : [{ role: "fileMenu" }]),
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          { label: "Check for Updates…", click: () => updates.check() },
        ],
      },
    ]),
  );
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
