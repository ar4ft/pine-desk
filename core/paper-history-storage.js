import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as store from "./store.js";
const MAX_BYTES = 32 * 1024 * 1024;
export function paperHistoryStorage(
  root = path.join(store.dataDir, "paper-history"),
) {
  const target = (id) => {
    if (!/^period-[0-9]+-[a-f0-9]{64}$/.test(id))
      throw Error("Invalid history archive ID.");
    return path.join(root, "archives", `${id}.json`);
  };
  const readArchive = async (id) => {
    const file = target(id),
      info = await fs.stat(file);
    if (info.size > MAX_BYTES) throw Error("History archive exceeds 32 MiB.");
    return fs.readFile(file, "utf8");
  };
  return {
    read: () => store.read("paper-history"),
    write: (doc) => store.write("paper-history", doc),
    readArchive,
    writeArchive: async (id, text) => {
      const dest = target(id);
      if (Buffer.byteLength(text) > MAX_BYTES)
        throw Error(
          "History archive exceeds 32 MiB; current samples retained.",
        );
      await fs.mkdir(path.dirname(dest), { recursive: true });
      const temp = `${dest}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temp, text, { mode: 0o600, flag: "wx" });
        try {
          await fs.link(temp, dest);
        } catch (e) {
          if (e.code !== "EEXIST") throw e;
          if ((await readArchive(id)) !== text)
            throw Error(
              "Existing history archive conflicts; no file was overwritten.",
            );
        }
      } finally {
        await fs.rm(temp, { force: true });
      }
    },
  };
}
