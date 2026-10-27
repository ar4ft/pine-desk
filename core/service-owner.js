import fs from "node:fs/promises";
import lockfile from "proper-lockfile";

// The lock's heartbeat spans desktop and standalone processes. Attached clients
// never acquire this lock or import the service that owns streams and writes.
export async function acquireServiceOwner(dataDir) {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  try {
    return await lockfile.lock(dataDir, {
      realpath: true,
      stale: 30000,
      update: 10000,
      retries: 0,
    });
  } catch (error) {
    if (error.code === "ELOCKED")
      throw Error(
        "This data directory already has a Pine Desk service owner. Attach MCP to the desktop, or stop the standalone server first. After an unclean exit, allow 30 seconds for lock recovery.",
      );
    throw error;
  }
}
