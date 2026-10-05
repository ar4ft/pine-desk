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
const {
  previewContext,
  prepareAssets,
  publishUnsigned,
} = require("../scripts/publish-unsigned.cjs");
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
  assert.equal(
    config.artifactName,
    "Pine-Desk-${version}-unsigned-${arch}.${ext}",
  );
  assert.deepEqual(config.extraResources, []);
  assert.match(
    require("../package.json").scripts["dist:mac"],
    /--config electron-builder.dev.cjs/,
  );
});

const previewEnv = {
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_NUMBER: "42",
  GITHUB_RUN_ID: "123456",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_REPOSITORY: "ar4ft/pine-desk",
};
async function previewFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pine-desk-unsigned-"));
  for (const arch of ["arm64", "x64"])
    for (const ext of ["zip", "dmg"])
      await fs.writeFile(
        path.join(dir, `Pine-Desk-0.8.0-unsigned-${arch}.${ext}`),
        `${arch}.${ext}`,
      );
  return dir;
}
test("unsigned previews publish automatically only after successful main builds", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(
    await fs.readFile(
      new URL("../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(workflow.on), ["push", "pull_request"]);
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.deepEqual(workflow.jobs.prerelease.needs, ["test", "mac"]);
  assert.equal(
    workflow.jobs.prerelease.if,
    "github.event_name == 'push' && github.ref == 'refs/heads/main'",
  );
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.jobs.prerelease.permissions.contents, "write");
  assert.equal(workflow.jobs.mac.env.CSC_IDENTITY_AUTO_DISCOVERY, "false");
  assert.equal(previewContext(previewEnv, "0.8.0").tag, "v0.8.0-unsigned.42");
  for (const env of [
    { ...previewEnv, GITHUB_EVENT_NAME: "pull_request" },
    { ...previewEnv, GITHUB_EVENT_NAME: "workflow_dispatch" },
    { ...previewEnv, GITHUB_REF: "refs/heads/feature" },
    { ...previewEnv, GITHUB_SHA: "main" },
  ])
    assert.throws(() => previewContext(env, "0.8.0"));
});
test("unsigned publication requires all four packages and excludes update metadata", async () => {
  const dir = await previewFixture();
  try {
    const names = await prepareAssets(dir, "0.8.0");
    assert.equal(names.length, 5);
    const sums = await fs.readFile(path.join(dir, "SHA256SUMS.txt"), "utf8");
    for (const name of names.slice(0, 4)) {
      const bytes = await fs.readFile(path.join(dir, name));
      assert.ok(
        sums.includes(
          `${crypto.createHash("sha256").update(bytes).digest("hex")}  ${name}`,
        ),
      );
    }
    await fs.writeFile(path.join(dir, "latest-mac.yml"), "must not ship");
    await assert.rejects(prepareAssets(dir, "0.8.0"), /update manifests/);
    await fs.unlink(path.join(dir, "latest-mac.yml"));
    await fs.unlink(path.join(dir, names[0]));
    await assert.rejects(prepareAssets(dir, "0.8.0"), /ENOENT/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("unsigned release stays a draft on failed uploads and retries without replacing published previews", async () => {
  const dir = await previewFixture();
  let tag = null,
    release = null,
    failUpload = true;
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (args[0] === "api") {
      if (args[1].endsWith("/git/refs")) {
        tag = previewEnv.GITHUB_SHA;
        return "{}";
      }
      if (args[1].includes("/git/ref/")) {
        if (tag) return JSON.stringify({ object: { sha: tag } });
      } else if (args[1].includes("/commits/"))
        return JSON.stringify({ sha: tag });
      else if (release) return JSON.stringify(release);
      throw Object.assign(Error("not found"), {
        stderr: "gh: Not Found (HTTP 404)",
      });
    }
    if (args[1] === "create") {
      assert.ok(args.includes("--draft"));
      assert.ok(args.includes("--prerelease"));
      assert.ok(args.includes("--latest=false"));
      assert.ok(args.includes(previewEnv.GITHUB_SHA));
      release = {
        draft: true,
        prerelease: true,
        assets: [],
        html_url:
          "https://github.com/ar4ft/pine-desk/releases/tag/v0.8.0-unsigned.42",
      };
    } else if (args[1] === "upload") {
      if (failUpload) throw Error("upload failed");
      release.assets = args
        .filter((arg) => arg.startsWith(dir + path.sep))
        .map((file) => ({ name: path.basename(file) }));
    } else if (args[1] === "edit") {
      assert.ok(args.includes("--prerelease"));
      assert.ok(args.includes("--latest=false"));
      release.draft = false;
    }
    return "";
  };
  try {
    const options = { env: previewEnv, version: "0.8.0", dir, run };
    await assert.rejects(publishUnsigned(options), /upload failed/);
    assert.equal(release.draft, true);
    assert.equal(
      calls.some((args) => args[0] === "release" && args[1] === "edit"),
      false,
    );
    failUpload = false;
    assert.equal(await publishUnsigned(options), release.html_url);
    assert.equal(release.draft, false);
    const count = calls.filter((args) => args[1] === "upload").length;
    await publishUnsigned(options);
    assert.equal(calls.filter((args) => args[1] === "upload").length, count);
    tag = "b".repeat(40);
    await assert.rejects(publishUnsigned(options), /another commit/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
