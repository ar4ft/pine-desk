import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
const require = createRequire(import.meta.url);
const { createUpdates } = require("../electron/updates.cjs");
const { validateRelease } = require("../scripts/release-preflight.cjs");
const { verifyAssets } = require("../scripts/verify-update-assets.cjs");
const marker = JSON.stringify({
  channel: "stable",
  provider: "github",
  owner: "ar4ft",
  repo: "pine-desk",
});
function harness(overrides = {}) {
  const updater = new EventEmitter();
  let checks = 0,
    installs = 0;
  const messages = [],
    timers = [];
  updater.checkForUpdates = async () => {
    checks++;
    updater.emit("update-not-available");
  };
  updater.quitAndInstall = () => installs++;
  const clock = {
    setTimeout: (fn) => {
      timers.push(fn);
      return 1;
    },
    setInterval: (fn) => {
      timers.push(fn);
      return 2;
    },
    clearTimeout() {},
    clearInterval() {},
  };
  const controller = createUpdates({
    app: { isPackaged: true },
    platform: "darwin",
    resourcesPath: "/test",
    readFile: () => marker,
    updater,
    clock,
    dialog: {
      showMessageBox: async (options) => {
        messages.push(options);
        return { response: 1 };
      },
    },
    getWindow: () => null,
    logger: { warn() {}, info() {} },
    ...overrides,
  });
  return {
    controller,
    updater,
    messages,
    timers,
    get checks() {
      return checks;
    },
    get installs() {
      return installs;
    },
  };
}
test("updates are disabled outside marked packaged stable Mac releases", async () => {
  for (const overrides of [
    { app: { isPackaged: false } },
    { platform: "linux" },
    {
      readFile: () => {
        throw Error("absent");
      },
    },
    { readFile: () => JSON.stringify({ channel: "beta" }) },
  ]) {
    const h = harness(overrides);
    assert.equal(h.controller.enabled, false);
    await h.controller.check();
    assert.equal(h.checks, 0);
    assert.match(h.messages[0].message, /signed Mac releases/);
  }
});
test("background checks stay quiet, manual checks show status, and stop removes timers/listeners", async () => {
  const h = harness();
  assert.equal(h.updater.autoDownload, true);
  assert.equal(h.updater.autoInstallOnAppQuit, false);
  assert.equal(h.updater.allowPrerelease, false);
  assert.equal(h.updater.allowDowngrade, false);
  await h.controller.check(false);
  assert.equal(h.messages.length, 0);
  await h.controller.check();
  assert.match(h.messages[0].message, /latest published stable/);
  h.controller.stop();
  assert.equal(h.updater.listenerCount("update-downloaded"), 0);
  await h.timers[0]();
  assert.equal(h.checks, 2);
});
test("downloaded update waits for explicit restart and Later leaves the installed app running", async () => {
  const h = harness();
  h.updater.emit("update-downloaded", { version: "0.2.0" });
  await new Promise((r) => setImmediate(r));
  assert.equal(h.installs, 0);
  assert.equal(h.messages[0].defaultId, 1);
  let installs = 0;
  const updater = new EventEmitter();
  updater.quitAndInstall = () => installs++;
  const yes = harness({
    updater,
    dialog: { showMessageBox: async () => ({ response: 0 }) },
  });
  updater.emit("update-downloaded", { version: "0.2.0" });
  await new Promise((r) => setImmediate(r));
  assert.equal(installs, 1);
  yes.controller.stop();
  h.controller.stop();
});
test("credential/tag preflight fails closed and update manifest covers both architectures with correct hashes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pine-desk-release-"));
  try {
    assert.throws(
      () => validateRelease({ env: {}, version: "0.2.0" }),
      /Configure release credentials/,
    );
    assert.throws(
      () =>
        validateRelease({ env: { RELEASE_TAG: "v0.3.0" }, version: "0.2.0" }),
      /tag/,
    );
    const key = path.join(dir, "key.p8");
    await fs.writeFile(key, "fixture");
    assert.equal(
      validateRelease({
        version: "0.2.0",
        env: {
          CSC_LINK: "fixture",
          CSC_KEY_PASSWORD: "fixture",
          APPLE_API_KEY: key,
          APPLE_API_KEY_ID: "fixture",
          APPLE_API_ISSUER: "fixture",
        },
      }),
      "v0.2.0",
    );
    const files = [];
    for (const arch of ["arm64", "x64"])
      for (const ext of ["zip", "dmg"]) {
        const url = `Pine-Desk-0.2.0-${arch}.${ext}`,
          data = Buffer.from(url);
        await fs.writeFile(path.join(dir, url), data);
        if (ext === "zip")
          files.push({
            url,
            size: data.length,
            sha512: crypto.createHash("sha512").update(data).digest("base64"),
          });
      }
    await fs.writeFile(
      path.join(dir, "latest-mac.yml"),
      JSON.stringify({ version: "0.2.0", files }),
    );
    assert.equal(verifyAssets(dir, "0.2.0").files.length, 2);
    await fs.writeFile(path.join(dir, files[0].url), "corrupted");
    assert.throws(() => verifyAssets(dir, "0.2.0"), /checksum/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("offline manual checks show one error and allow a later retry; background errors stay quiet", async () => {
  const updater = new EventEmitter();
  let count = 0;
  updater.checkForUpdates = async () => {
    count++;
    const error = new Error("offline");
    updater.emit("error", error);
    throw error;
  };
  const h = harness({ updater });
  await h.controller.check();
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].type, "error");
  await h.controller.check(false);
  assert.equal(h.messages.length, 1);
  await h.controller.check();
  assert.equal(count, 3);
  assert.equal(h.messages.length, 2);
  h.controller.stop();
});

test("signed pipeline is manual only and development packaging explicitly disables signing", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(
    await fs.readFile(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(
    workflow.jobs.release.if,
    "github.event_name == 'workflow_dispatch'",
  );
  const config = require("../electron-builder.dev.cjs");
  assert.equal(config.mac.identity, null);
  assert.equal(config.mac.notarize, false);
  assert.equal(config.forceCodeSigning, false);
  assert.equal(config.publish, null);
  assert.deepEqual(config.extraResources, []);
  assert.match(
    require("../package.json").scripts["dist:mac"],
    /--config electron-builder.dev.cjs/,
  );
});
