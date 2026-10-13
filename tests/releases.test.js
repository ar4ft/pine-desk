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
const { crc32 } = require("node:zlib");
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
        ext === "dmg" ? fixtureDmg() : Buffer.from(`${arch}.${ext}`),
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
  assert.equal(
    workflow.jobs.mac.env.PINE_DESK_BUILD_ARCH,
    "${{ matrix.arch }}",
  );
  const download = workflow.jobs.prerelease.steps.find((step) =>
    step.uses?.startsWith("actions/download-artifact@"),
  );
  assert.equal(download.with["merge-multiple"], false);
  const checks = workflow.jobs.mac.steps.findIndex((step) =>
    step.run?.includes("verify-mac-package.cjs"),
  );
  const upload = workflow.jobs.mac.steps.findIndex(
    (step) => step.with?.name === "pine-desk-mac-unsigned-${{ matrix.arch }}",
  );
  assert.ok(
    checks >= 0 && checks < upload,
    "Native package validation must precede artifact publication.",
  );
  assert.equal(previewContext(previewEnv, "0.8.0").tag, "v0.8.0-unsigned.42");
  for (const env of [
    { ...previewEnv, GITHUB_EVENT_NAME: "pull_request" },
    { ...previewEnv, GITHUB_EVENT_NAME: "workflow_dispatch" },
    { ...previewEnv, GITHUB_REF: "refs/heads/feature" },
    { ...previewEnv, GITHUB_SHA: "main" },
  ])
    assert.throws(() => previewContext(env, "0.8.0"));
});

function fixtureDmg() {
  const data = Buffer.from("compressed disk image fixture");
  const xml = Buffer.from("<plist/>");
  const footer = Buffer.alloc(512);
  footer.write("koly");
  footer.writeUInt32BE(4, 4);
  footer.writeUInt32BE(512, 8);
  footer.writeBigUInt64BE(BigInt(data.length), 32);
  footer.writeUInt32BE(2, 80);
  footer.writeUInt32BE(32, 84);
  footer.writeUInt32BE(crc32(data), 88);
  footer.writeBigUInt64BE(BigInt(data.length), 216);
  footer.writeBigUInt64BE(BigInt(xml.length), 224);
  return Buffer.concat([data, xml, footer]);
}

test("DMG verification rejects the published missing-footer failure and damaged image data", async () => {
  const { verifyDmg } = require("../scripts/mac-packages.cjs");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pine-desk-dmg-"));
  const file = path.join(dir, "test.dmg");
  try {
    await fs.writeFile(file, fixtureDmg());
    assert.ok((await verifyDmg(file)).dataLength > 0);
    const missingFooter = fixtureDmg();
    missingFooter.fill(0, missingFooter.length - 512);
    await fs.writeFile(file, missingFooter);
    await assert.rejects(verifyDmg(file), /UDIF footer/);
    const corrupted = fixtureDmg();
    corrupted[0] ^= 1;
    await fs.writeFile(file, corrupted);
    await assert.rejects(verifyDmg(file), /checksum/);
    await fs.writeFile(file, Buffer.alloc(20));
    await assert.rejects(verifyDmg(file), /truncated/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("native Mac build targets and binaries distinguish arm64 from Intel x86_64", () => {
  const { execFileSync } = require("node:child_process");
  const { assertArchitectures } = require("../scripts/verify-mac-package.cjs");
  for (const arch of ["arm64", "x64"]) {
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "-e",
          "process.stdout.write(JSON.stringify(require('./electron-builder.dev.cjs').mac.target))",
        ],
        {
          cwd: path.resolve("."),
          env: { ...process.env, PINE_DESK_BUILD_ARCH: arch },
          encoding: "utf8",
        },
      ),
    );
    assert.equal(result.length, 2);
    for (const target of result) assert.deepEqual(target.arch, [arch]);
  }
  assertArchitectures("arm64", "arm64", true);
  assertArchitectures("x86_64", "x64", true);
  assert.throws(() => assertArchitectures("arm64", "x64", true), /x86_64/);
  assert.throws(
    () => assertArchitectures("arm64 x86_64", "arm64", true),
    /Expected/,
  );
});

test("release staging isolates each architecture and refuses duplicate artifact filenames", async () => {
  const {
    stagePackages,
    packageNames,
  } = require("../scripts/mac-packages.cjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pine-desk-artifacts-"));
  const input = path.join(root, "input"),
    output = path.join(root, "output");
  try {
    for (const arch of ["arm64", "x64"]) {
      const dir = path.join(input, `pine-desk-mac-unsigned-${arch}`);
      await fs.mkdir(dir, { recursive: true });
      const names = packageNames("0.8.0", arch);
      await fs.writeFile(path.join(dir, names[0]), fixtureDmg());
      await fs.writeFile(path.join(dir, names[1]), "zip fixture");
    }
    const duplicate = path.join(
      input,
      "pine-desk-mac-unsigned-arm64",
      packageNames("0.8.0", "x64")[0],
    );
    await fs.writeFile(duplicate, fixtureDmg());
    await assert.rejects(stagePackages(input, output, "0.8.0"), /only arm64/);
    await fs.unlink(duplicate);
    await stagePackages(input, output, "0.8.0");
    assert.equal((await fs.readdir(output)).length, 4);
    await assert.rejects(stagePackages(input, output, "0.8.0"), /empty/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
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
test("unsigned release finds drafts excluded by the tag API, retries failed uploads and preserves published previews", async () => {
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
      else if (args[1].endsWith("/releases")) {
        assert.ok(args.includes("--paginate"));
        return release ? JSON.stringify(release) : "";
      } else if (
        args[1].includes("/releases/tags/") &&
        release &&
        !release.draft
      )
        return JSON.stringify(release);
      throw Object.assign(Error("not found"), {
        stderr: "gh: Not Found (HTTP 404)",
      });
    }
    if (args[1] === "create") {
      assert.equal(
        release,
        null,
        "Existing drafts must be resumed, not recreated.",
      );
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
