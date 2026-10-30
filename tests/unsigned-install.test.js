import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { checkUnsignedInstall } = createRequire(import.meta.url)(
  "../scripts/unsigned-mac-check.cjs",
);
test("unsigned installation checks report trust rejection and remove only test-app quarantine without signing", () => {
  const calls = [];
  const report = checkUnsignedInstall(
    "/tmp/verified/Pine Desk.app",
    (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd.endsWith("codesign") || cmd.endsWith("spctl"))
        return { status: 1, stderr: "rejected unsigned" };
      if (args[0] === "-p")
        return { status: 1, stderr: "No such xattr: com.apple.quarantine" };
      return { status: 0 };
    },
  );
  assert.equal(report.gatekeeper.accepted, false);
  assert.equal(report.signature.accepted, false);
  assert.equal(report.quarantineWorkflowChecked, true);
  assert.deepEqual(
    calls.find((c) => c[1] === "-dr"),
    [
      "/usr/bin/xattr",
      "-dr",
      "com.apple.quarantine",
      "/tmp/verified/Pine Desk.app",
    ],
  );
  assert.equal(
    calls.some((c) => c.includes("--sign") || c.includes("--master-disable")),
    false,
  );
  assert.throws(
    () => checkUnsignedInstall("/Applications", () => {}),
    /test-copy path/,
  );
});
test("quarantine test failures stop packaging instead of claiming an install was verified", () => {
  assert.throws(
    () =>
      checkUnsignedInstall("/tmp/Pine Desk.app", () => ({
        status: 1,
        stderr: "Operation not permitted",
      })),
    /simulate/,
  );
  assert.throws(
    () =>
      checkUnsignedInstall("/tmp/Pine Desk.app", (cmd, args) => ({
        status: args[0] === "-p" ? 0 : 0,
      })),
    /confirm removal/,
  );
});
