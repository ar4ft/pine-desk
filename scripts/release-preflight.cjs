const fs = require("node:fs");
const path = require("node:path");
function validateRelease({
  env = process.env,
  version = require("../package.json").version,
  publishing = false,
} = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Signed releases require a stable X.Y.Z package version.");
  if (env.RELEASE_TAG && env.RELEASE_TAG !== `v${version}`)
    throw new Error("Release tag must equal v + package.json version.");
  const required = [
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "APPLE_API_KEY",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER",
    ...(publishing ? ["GH_TOKEN", "RELEASE_TAG"] : []),
  ];
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length)
    throw new Error(`Configure release credentials: ${missing.join(", ")}`);
  if (!path.isAbsolute(env.APPLE_API_KEY) || !fs.existsSync(env.APPLE_API_KEY))
    throw new Error(
      "APPLE_API_KEY must point to an existing absolute .p8 file.",
    );
  return `v${version}`;
}
module.exports = { validateRelease };
if (require.main === module) {
  try {
    console.log(
      `Release preflight passed: ${validateRelease({ publishing: process.argv.includes("--publishing") })}`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
