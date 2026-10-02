import * as store from "./store.js";
const names = [
  "unusualWhales",
  "tradierToken",
  "massiveKey",
  "alpacaKey",
  "alpacaSecret",
];
let vault;
export function installCredentialVault(adapter) {
  vault = adapter;
}
export async function credential(name) {
  if (!names.includes(name)) throw new Error("Unknown credential.");
  if (name === "unusualWhales" && process.env.UNUSUAL_WHALES_API_KEY)
    return process.env.UNUSUAL_WHALES_API_KEY;
  if (name === "massiveKey" && process.env.MASSIVE_API_KEY)
    return process.env.MASSIVE_API_KEY;
  const saved = await store.read("credentials");
  if (saved?.[name]) {
    if (!vault?.available())
      throw new Error("Open the desktop app to unlock saved credentials.");
    return vault.decrypt(saved[name]);
  }
  return name === "unusualWhales"
    ? (process.env.UNUSUAL_WHALES_API_KEY ?? null)
    : null;
}
export async function credentialStatus() {
  const saved = (await store.read("credentials")) ?? {};
  return {
    available: !!vault?.available(),
    configured: Object.fromEntries(
      names.map((n) => [
        n,
        !!saved[n] ||
          (n === "unusualWhales" && !!process.env.UNUSUAL_WHALES_API_KEY) ||
          (n === "massiveKey" && !!process.env.MASSIVE_API_KEY),
      ]),
    ),
  };
}
export async function saveCredentials(input) {
  if (!vault?.available())
    throw new Error(
      "Operating-system encryption is unavailable. Credentials have not been saved.",
    );
  const next = { ...(await store.read("credentials")) };
  for (const [name, value] of Object.entries(input)) {
    if (!names.includes(name)) throw new Error("Unknown credential.");
    if (value === null) delete next[name];
    else {
      if (
        typeof value !== "string" ||
        !value.trim() ||
        value.length > 4096 ||
        /[\r\n]/.test(value)
      )
        throw new Error("Invalid credential.");
      next[name] = vault.encrypt(value.trim());
    }
  }
  await store.write("credentials", next);
  return credentialStatus();
}
