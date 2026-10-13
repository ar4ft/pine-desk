const fs = require("node:fs");
const path = require("node:path");
const { crc32 } = require("node:zlib");

function packageNames(version, arch) {
  if (
    !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version) ||
    !["arm64", "x64"].includes(arch)
  )
    throw Error(
      "Expected a stable package version and arm64 or x64 architecture.",
    );
  return ["dmg", "zip"].map(
    (ext) => `Pine-Desk-${version}-unsigned-${arch}.${ext}`,
  );
}

async function verifyDmg(file) {
  const handle = await fs.promises.open(file, "r");
  let offset, length, expected;
  try {
    const { size } = await handle.stat();
    if (size < 512) throw Error("Disk image is truncated.");
    const trailer = Buffer.alloc(512);
    await handle.read(trailer, 0, 512, size - 512);
    if (
      trailer.toString("ascii", 0, 4) !== "koly" ||
      trailer.readUInt32BE(4) !== 4 ||
      trailer.readUInt32BE(8) !== 512
    )
      throw Error("Disk image has a missing or invalid UDIF footer.");
    offset = Number(trailer.readBigUInt64BE(24));
    length = Number(trailer.readBigUInt64BE(32));
    const xmlOffset = Number(trailer.readBigUInt64BE(216));
    const xmlLength = Number(trailer.readBigUInt64BE(224));
    if (
      ![offset, length, xmlOffset, xmlLength].every(Number.isSafeInteger) ||
      length <= 0 ||
      offset + length > size - 512 ||
      xmlOffset < offset + length ||
      xmlLength <= 0 ||
      xmlOffset + xmlLength > size - 512
    )
      throw Error("Disk image data or metadata bounds are invalid.");
    if (trailer.readUInt32BE(80) !== 2 || trailer.readUInt32BE(84) !== 32)
      throw Error("Disk image must contain a CRC32 data checksum.");
    expected = trailer.readUInt32BE(88);
  } finally {
    await handle.close();
  }
  let actual = 0;
  for await (const chunk of fs.createReadStream(file, {
    start: offset,
    end: offset + length - 1,
  }))
    actual = crc32(chunk, actual);
  if (actual !== expected)
    throw Error("Disk image data checksum does not match.");
  return { dataLength: length, crc32: actual.toString(16).padStart(8, "0") };
}

async function stagePackages(root, output, version) {
  // Preserve artifact directories and select the matching native build. Never
  // extract two archives over the same paths or merge duplicate filenames.
  const files = [];
  for (const arch of ["arm64", "x64"]) {
    const dir = path.join(root, `pine-desk-mac-unsigned-${arch}`);
    const names = packageNames(version, arch);
    const entries = await fs.promises.readdir(dir);
    if (
      entries.length !== names.length ||
      entries.some((name) => !names.includes(name))
    )
      throw Error(`Expected only ${arch} DMG/ZIP files in ${dir}.`);
    for (const name of names) {
      const source = path.join(dir, name);
      const stat = await fs.promises.lstat(source);
      if (!stat.isFile() || stat.size === 0)
        throw Error(`Invalid package: ${name}`);
      if (name.endsWith(".dmg")) await verifyDmg(source);
      files.push({ source, name });
    }
  }
  await fs.promises.mkdir(output, { recursive: true });
  if ((await fs.promises.readdir(output)).length)
    throw Error("Package staging directory must be empty.");
  for (const { source, name } of files)
    await fs.promises.copyFile(source, path.join(output, name));
}

module.exports = { packageNames, verifyDmg, stagePackages };
