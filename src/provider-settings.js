const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const keys = [
  ["unusualWhales", "Unusual Whales API token"],
  ["tradierToken", "Tradier access token"],
  ["massiveKey", "Massive API key"],
  ["alpacaKey", "Alpaca API key ID"],
  ["alpacaSecret", "Alpaca secret key"],
];
export function settingsView(settings) {
  const e = settings?.engine ?? {
      folder: "",
      nodePath: "",
      feed: "synthetic",
      tickers: "SPY,QQQ",
      alpacaStream: "indicative",
      massiveStream: "delayed",
    },
    c = settings?.credentials;
  return `<div id="provider-settings"><div class="page-intro"><span class="eyebrow">PROVIDER SETTINGS</span><h1>Connect your own data.</h1><p>Credentials are encrypted by the operating system. Saved keys are never returned to the editor, MCP tools or exports.</p></div><section class="plot-card"><div class="panel-heading"><span>API CREDENTIALS</span><span>${c?.available ? "OS encryption ready" : "Encrypted storage unavailable in this process"}</span></div>${keys.map(([key, label]) => `<div class="credential-row"><label>${label}<input id="credential-${key}" type="password" autocomplete="off" placeholder="${c?.configured[key] ? "Saved · enter a replacement" : "Enter credential"}"></label><button data-remove-credential="${key}">Remove saved key</button></div>`).join("")}<button id="credentials-save" class="primary">Save credentials</button><p class="footnote">Blank fields keep saved keys. An Unusual Whales website subscription may differ from its API plan. Options-trade WebSocket access requires the appropriate entitlement.</p><button data-link="https://unusualwhales.com/dashboard/api">Manage Unusual Whales tokens ↗</button><button data-link="https://api.unusualwhales.com/docs">API documentation ↗</button></section><section class="plot-card"><div class="panel-heading"><span>MANAGED WHALE OPTIONS ENGINE</span><span>${esc(settings?.engineStatus?.status ?? "stopped")}</span></div><p class="footnote">Install and build the official LuxAlgo Whale Options repository separately. Pine Desk launches that trusted installation and passes only the selected vendor's keys in its process environment. ThetaData authenticates in Theta Terminal.</p><div class="edge-form"><label class="edge-preset">Built repository folder<input id="engine-folder" value="${esc(e.folder)}" placeholder="/Users/you/whale-options"></label><label class="edge-preset">Node executable (optional)<input id="engine-nodePath" value="${esc(e.nodePath)}" placeholder="Blank uses the desktop's Node runtime"></label></div><div class="edge-form"><label>Provider<select id="engine-feed">${["synthetic", "tradier", "massive", "alpaca", "thetadata"].map((f) => `<option ${f === e.feed ? "selected" : ""}>${f}</option>`).join("")}</select></label><label>Tickers<input id="engine-tickers" value="${esc(e.tickers)}"></label><label>Alpaca feed<select id="engine-alpacaStream">${["indicative", "opra"].map((f) => `<option ${f === e.alpacaStream ? "selected" : ""}>${f}</option>`).join("")}</select></label><label>Massive feed<select id="engine-massiveStream">${["delayed", "realtime"].map((f) => `<option ${f === e.massiveStream ? "selected" : ""}>${f}</option>`).join("")}</select></label></div><button id="engine-save">Save engine settings</button><button id="engine-start" class="primary">Start engine + local MCP</button><button id="engine-stop">Stop managed engine</button><p id="engine-status" class="footnote">${esc(settings?.engineStatus?.error ?? "Local MCP: http://127.0.0.1:8788/mcp. Launched is a process status; verify recording coverage in Whale Options. Stops when the app quits.")}</p><p class="footnote">If native SQLite was built for a different Node version, enter the matching Node executable. Synthetic data is a demonstration; a licensed label does not establish feed timeliness.</p><button data-link="https://github.com/ar4ft/pine-desk/blob/main/docs/whale-options.md">Installation guide ↗</button></section></div>`;
}
export function bindProviderSettings({
  call,
  task,
  render,
  getSettings,
  setSettings,
}) {
  if (!$("#provider-settings")) return;
  const on = (id, fn) => ($("#" + id).onclick = () => task(fn)),
    reload = async () => {
      setSettings(await call("providerSettings"));
      render();
    };
  const saveEngine = async () => {
    const engine = Object.fromEntries(
      [
        "folder",
        "nodePath",
        "feed",
        "tickers",
        "alpacaStream",
        "massiveStream",
      ].map((k) => [k, $("#engine-" + k).value]),
    );
    await call("engineConfigure", engine);
  };
  on("credentials-save", async () => {
    const values = Object.fromEntries(
      keys
        .map(([key]) => [key, $("#credential-" + key).value])
        .filter(([, value]) => value.trim()),
    );
    if (!Object.keys(values).length)
      throw new Error("Enter a credential to save.");
    await call("saveCredentials", values);
    for (const [key] of keys) $("#credential-" + key).value = "";
    await reload();
  });
  document.querySelectorAll("[data-remove-credential]").forEach(
    (el) =>
      (el.onclick = () =>
        task(async () => {
          await call("saveCredentials", {
            [el.dataset.removeCredential]: null,
          });
          await reload();
        })),
  );
  on("engine-save", async () => {
    await saveEngine();
    await reload();
  });
  on("engine-start", async () => {
    await saveEngine();
    try {
      await call("engineStart");
    } finally {
      await reload();
    }
  });
  on("engine-stop", async () => {
    await call("engineStop");
    await reload();
  });
}
