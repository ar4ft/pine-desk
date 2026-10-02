import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
export const dataDir =
  process.env.PINE_DESK_DATA_DIR ||
  (process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support", "Pine Desk")
    : path.join(os.homedir(), ".pine-desk"));
const validId = (id) => {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error("Invalid storage id.");
  return id;
};
export async function write(kind, value, id = "current") {
  validId(kind);
  validId(id);
  const dir = path.join(dataDir, kind);
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${id}.json`),
    temp = dest + `.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await fs.rename(temp, dest);
  return value;
}
export async function read(kind, id = "current") {
  try {
    return JSON.parse(
      await fs.readFile(
        path.join(dataDir, validId(kind), `${validId(id)}.json`),
        "utf8",
      ),
    );
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
export async function list(kind) {
  let files;
  try {
    files = await fs.readdir(path.join(dataDir, validId(kind)));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  return Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map((f) => read(kind, f.slice(0, -5))),
  );
}

export async function remove(kind, id) {
  await fs.rm(path.join(dataDir, validId(kind), `${validId(id)}.json`), {
    force: true,
  });
}

export async function writeCompressed(kind, value, id) {
  const dir = path.join(dataDir, validId(kind));
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${validId(id)}.json.gz`),
    temp = dest + `.${randomUUID()}.tmp`;
  const bytes = gzipSync(JSON.stringify(value));
  try {
    await fs.writeFile(temp, bytes, { mode: 0o600 });
    await fs.rename(temp, dest);
  } finally {
    await fs.rm(temp, { force: true });
  }
  return bytes.length;
}
export async function readCompressed(kind, id) {
  try {
    const bytes = await fs.readFile(
      path.join(dataDir, validId(kind), `${validId(id)}.json.gz`),
    );
    return JSON.parse(
      gunzipSync(bytes, { maxOutputLength: 25000000 }).toString("utf8"),
    );
  } catch (e) {
    if (e.code === "ENOENT") return read(kind, id);
    throw e;
  }
}
export async function removeCompressed(kind, id) {
  await fs.rm(path.join(dataDir, validId(kind), `${validId(id)}.json.gz`), {
    force: true,
  });
  await remove(kind, id);
}
