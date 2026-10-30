const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Runs only on CI's disposable, verified package copy, never a user's install.
// An unsigned launch smoke test is NOT a Gatekeeper/notarization acceptance test.
function checkUnsignedInstall(app, execute = spawnSync) {
  if (!path.isAbsolute(app) || path.basename(app) !== "Pine Desk.app")
    throw Error("Expected an absolute Pine Desk.app test-copy path.");
  const run = (command, args) =>
    execute(command, args, { encoding: "utf8", timeout: 15000 });
  const diagnostics = (r) => ({
    accepted: r.status === 0,
    exitCode: r.status,
    detail: [r.stdout, r.stderr, r.error?.message]
      .filter(Boolean)
      .join("\n")
      .slice(0, 4000),
  });
  const signature = diagnostics(
    run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]),
  );
  const attribute = "com.apple.quarantine";
  const marked = run("/usr/bin/xattr", [
    "-w",
    attribute,
    `0083;${Math.floor(Date.now() / 1000).toString(16)};PineDeskPackageTest;`,
    app,
  ]);
  if (marked.status !== 0)
    throw Error("Could not simulate a quarantined download on the test copy.");
  const gatekeeper = diagnostics(
    run("/usr/sbin/spctl", [
      "--assess",
      "--type",
      "execute",
      "--verbose=4",
      app,
    ]),
  );
  const cleared = run("/usr/bin/xattr", ["-dr", attribute, app]);
  if (cleared.status !== 0)
    throw Error("Could not clear quarantine from the verified test copy.");
  const remaining = run("/usr/bin/xattr", ["-p", attribute, app]);
  if (remaining.status !== 1 || !/No such xattr/i.test(remaining.stderr ?? ""))
    throw Error(
      "Could not confirm removal of the test-copy quarantine attribute.",
    );
  return {
    distribution: "unsigned, unnotarized development preview",
    signature,
    gatekeeper,
    quarantineWorkflowChecked: true,
    gatekeeperApprovalRequired:
      "Only the manual Developer ID signed/notarized release establishes distribution trust. CI assessment is diagnostic; runner policy may differ from a user's Mac.",
  };
}
module.exports = { checkUnsignedInstall };
