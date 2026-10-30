const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { checkUnsignedInstall } = require("./unsigned-mac-check.cjs");
const { packageNames, verifyDmg } = require("./mac-packages.cjs");

function assertArchitectures(actual, arch, exact = false) {
  const expected = { arm64: "arm64", x64: "x86_64" }[arch];
  const list = actual.trim().split(/\s+/);
  if (!expected || !list.includes(expected) || (exact && list.length !== 1))
    throw Error(`Expected ${expected ?? arch} binary, found ${actual.trim()}.`);
}

const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    timeout: 120000,
    ...options,
  });

async function verifyApp(app, arch, version) {
  const plist = path.join(app, "Contents/Info.plist");
  const value = (key) =>
    run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist]).trim();
  if (value("CFBundleShortVersionString") !== version)
    throw Error("Packaged app version is incorrect.");
  const name = value("CFBundleExecutable");
  if (name !== path.basename(name))
    throw Error("Invalid bundle executable path.");
  const executable = path.join(app, "Contents/MacOS", name);
  assertArchitectures(run("/usr/bin/lipo", ["-archs", executable]), arch, true);
  const magics = new Set([
    "feedface",
    "cefaedfe",
    "feedfacf",
    "cffaedfe",
    "cafebabe",
    "bebafeca",
    "cafebabf",
    "bfbafeca",
  ]);
  let binaries = 0;
  async function walk(dir) {
    for (const entry of await fs.promises.readdir(dir, {
      withFileTypes: true,
    })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        const handle = await fs.promises.open(file, "r");
        const header = Buffer.alloc(4);
        let bytesRead;
        try {
          ({ bytesRead } = await handle.read(header, 0, 4, 0));
        } finally {
          await handle.close();
        }
        if (bytesRead === 4 && magics.has(header.toString("hex"))) {
          assertArchitectures(run("/usr/bin/lipo", ["-archs", file]), arch);
          binaries++;
        }
      }
    }
  }
  await walk(path.join(app, "Contents"));
  return { executable, binaries, unsignedInstall: checkUnsignedInstall(app) };
}

async function verifyMacPackage(arch = process.argv[2]) {
  if (process.platform !== "darwin" || process.arch !== arch)
    throw Error(
      "Verify packages on a native Mac runner matching arm64 or x64.",
    );
  const version = require("../package.json").version;
  const dir = path.resolve(__dirname, "../release");
  const names = packageNames(version, arch);
  const packages = (await fs.promises.readdir(dir)).filter((name) =>
    /\.(dmg|zip)$/.test(name),
  );
  if (packages.length !== 2 || packages.some((name) => !names.includes(name)))
    throw Error(`Build must contain only the ${arch} DMG and ZIP.`);
  const temp = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "pine-desk-package-"),
  );
  const mount = path.join(temp, "volume");
  await fs.promises.mkdir(mount);
  let mounted = false;
  const report = { version, arch, hostArch: process.arch, checks: [] };
  try {
    const dmg = path.join(dir, names[0]);
    const integrity = await verifyDmg(dmg);
    run("/usr/bin/hdiutil", ["verify", dmg]);
    run("/usr/bin/hdiutil", [
      "attach",
      "-readonly",
      "-nobrowse",
      "-noautoopen",
      "-mountpoint",
      mount,
      dmg,
    ]);
    mounted = true;
    const installed = path.join(temp, "installed", "Pine Desk.app");
    run("/usr/bin/ditto", [path.join(mount, "Pine Desk.app"), installed]);
    const fromDmg = await verifyApp(installed, arch, version);
    run(process.execPath, [path.resolve(__dirname, "desktop-smoke.js")], {
      env: { ...process.env, PINE_DESK_PACKAGED_PATH: fromDmg.executable },
      timeout: 210000,
      stdio: "inherit",
    });
    report.checks.push({
      format: "dmg",
      mounted: true,
      copiedAppSmokePassed: true,
      ...integrity,
      binaries: fromDmg.binaries,
      unsignedInstall: fromDmg.unsignedInstall,
    });
    run("/usr/bin/hdiutil", ["detach", mount]);
    mounted = false;
    const zip = path.join(dir, names[1]);
    run("/usr/bin/unzip", ["-tq", zip]);
    const extracted = path.join(temp, "archive");
    run("/usr/bin/ditto", ["-x", "-k", zip, extracted]);
    const fromZip = await verifyApp(
      path.join(extracted, "Pine Desk.app"),
      arch,
      version,
    );
    run(process.execPath, [path.resolve(__dirname, "desktop-smoke.js")], {
      env: { ...process.env, PINE_DESK_PACKAGED_PATH: fromZip.executable },
      timeout: 210000,
      stdio: "inherit",
    });
    report.checks.push({
      format: "zip",
      extractedAppSmokePassed: true,
      binaries: fromZip.binaries,
      unsignedInstall: fromZip.unsignedInstall,
    });
    await fs.promises.mkdir("test-results/desktop", { recursive: true });
    await fs.promises.writeFile(
      `test-results/desktop/package-${arch}.json`,
      JSON.stringify(report, null, 2),
    );
    console.log(
      `Verified ${arch}: DMG mounts, ZIP extracts, native binaries and both packaged app smoke tests pass after test-copy quarantine removal. This is not Gatekeeper/notarization approval.`,
    );
  } finally {
    try {
      if (mounted) run("/usr/bin/hdiutil", ["detach", mount, "-force"]);
    } finally {
      await fs.promises.rm(temp, { recursive: true, force: true });
    }
  }
  return report;
}

module.exports = { assertArchitectures, verifyApp, verifyMacPackage };
if (require.main === module)
  verifyMacPackage().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
