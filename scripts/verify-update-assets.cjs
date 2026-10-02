const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const yaml = require("js-yaml");
function verifyAssets(
  dir = path.resolve(__dirname, "../release"),
  version = require("../package.json").version,
) {
  const manifest = yaml.load(
    fs.readFileSync(path.join(dir, "latest-mac.yml"), "utf8"),
  );
  if (manifest.version !== version)
    throw new Error("Update manifest version does not match package.json.");
  const entries = manifest.files ?? [];
  for (const arch of ["arm64", "x64"]) {
    for (const extension of ["zip", "dmg"]) {
      const name = `Pine-Desk-${version}-${arch}.${extension}`;
      if (!fs.existsSync(path.join(dir, name)))
        throw new Error(`Missing release asset: ${name}`);
    }
    const name = `Pine-Desk-${version}-${arch}.zip`;
    const entry = entries.find((file) => file.url === name);
    if (!entry) throw new Error(`Update manifest must include ${arch} ZIP.`);
    const data = fs.readFileSync(path.join(dir, name));
    if (
      entry.sha512 !== crypto.createHash("sha512").update(data).digest("base64")
    )
      throw new Error(`Invalid update checksum: ${name}`);
    if (entry.size !== data.length)
      throw new Error(`Invalid update size: ${name}`);
  }
  return manifest;
}
module.exports = { verifyAssets };
if (require.main === module) {
  try {
    verifyAssets();
    console.log("Both Mac architectures and update checksums verified.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
