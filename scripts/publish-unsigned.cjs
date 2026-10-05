const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

function previewContext(env, version) {
  if (env.GITHUB_EVENT_NAME !== "push" || env.GITHUB_REF !== "refs/heads/main")
    throw Error("Unsigned prereleases require a push to main.");
  if (
    !/^\d+\.\d+\.\d+$/.test(version) ||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_NUMBER ?? "") ||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? "") ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") ||
    !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? "")
  )
    throw Error("Invalid unsigned prerelease version or GitHub build context.");
  return {
    tag: `v${version}-unsigned.${env.GITHUB_RUN_NUMBER}`,
    repo: env.GITHUB_REPOSITORY,
    sha: env.GITHUB_SHA,
    title: `Pine Desk ${version} — unsigned preview ${env.GITHUB_RUN_NUMBER}`,
    runUrl: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
  };
}

async function prepareAssets(dir, version) {
  const names = ["arm64", "x64"].flatMap((arch) =>
    ["dmg", "zip"].map((ext) => `Pine-Desk-${version}-unsigned-${arch}.${ext}`),
  );
  const entries = await fs.promises.readdir(dir);
  if (entries.some((name) => ![...names, "SHA256SUMS.txt"].includes(name)))
    throw Error("Unexpected unsigned asset; update manifests are excluded.");
  const sums = [];
  for (const name of names) {
    const file = path.join(dir, name);
    const stat = await fs.promises.lstat(file);
    if (!stat.isFile() || stat.size === 0)
      throw Error(`Missing or empty unsigned asset: ${name}`);
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    sums.push(`${hash.digest("hex")}  ${name}`);
  }
  await fs.promises.writeFile(
    path.join(dir, "SHA256SUMS.txt"),
    `${sums.join("\n")}\n`,
  );
  return [...names, "SHA256SUMS.txt"];
}

const gh = (args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

async function publishUnsigned({
  env = process.env,
  version = require("../package.json").version,
  dir = path.resolve(__dirname, "../release"),
  run = gh,
} = {}) {
  const context = previewContext(env, version);
  const assets = await prepareAssets(dir, version);
  const read = (endpoint) => {
    try {
      return JSON.parse(run(["api", `repos/${context.repo}/${endpoint}`]));
    } catch (error) {
      if (!String(error.stderr ?? error.message).includes("(HTTP 404)"))
        throw error;
      return null;
    }
  };
  // The by-tag REST endpoint excludes drafts. List releases with push access
  // so new drafts and resumed uploads are both discoverable before publication.
  const readRelease = () => {
    const result = run([
      "api",
      `repos/${context.repo}/releases`,
      "--paginate",
      "--jq",
      `.[] | select(.tag_name == "${context.tag}")`,
    ]);
    return result.trim() ? JSON.parse(result) : null;
  };
  if (read(`git/ref/tags/${context.tag}`)) {
    if (read(`commits/${context.tag}`)?.sha !== context.sha)
      throw Error("Preview tag points to another commit.");
  } else {
    run([
      "api",
      `repos/${context.repo}/git/refs`,
      "--method",
      "POST",
      "-f",
      `ref=refs/tags/${context.tag}`,
      "-f",
      `sha=${context.sha}`,
    ]);
  }
  const existing = readRelease();
  if (existing) {
    const commit = JSON.parse(
      run(["api", `repos/${context.repo}/commits/${context.tag}`]),
    );
    if (commit.sha !== context.sha || !existing.prerelease)
      throw Error(
        "Existing preview tag or release type does not match this build.",
      );
    if (!existing.draft) {
      if (
        existing.assets.length !== assets.length ||
        !assets.every((name) =>
          existing.assets.some((asset) => asset.name === name),
        )
      )
        throw Error(
          "Published preview has incomplete assets; refusing to overwrite it.",
        );
      return existing.html_url;
    }
  } else {
    const temp = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "pine-desk-preview-"),
    );
    const notes = path.join(temp, "notes.md");
    await fs.promises.writeFile(
      notes,
      `Unsigned development preview built from commit ${context.sha}.\n\n` +
        `Apple Silicon (arm64) and Intel (x64) DMG/ZIP packages. Tests and both Mac desktop checks passed before publication. These packages are unsigned and unnotarized; automatic updates are disabled.\n\n` +
        `SHA256SUMS.txt contains the package checksums. Signed, notarized stable releases are published separately through the manual Signed Mac release workflow.\n\n` +
        `Build: ${context.runUrl}\n`,
    );
    try {
      run([
        "release",
        "create",
        context.tag,
        "--repo",
        context.repo,
        "--target",
        context.sha,
        "--draft",
        "--prerelease",
        "--latest=false",
        "--title",
        context.title,
        "--notes-file",
        notes,
      ]);
    } finally {
      await fs.promises.rm(temp, { recursive: true, force: true });
    }
  }
  run([
    "release",
    "upload",
    context.tag,
    "--repo",
    context.repo,
    ...assets.map((name) => path.join(dir, name)),
    "--clobber",
  ]);
  const uploaded = readRelease();
  if (
    !uploaded?.draft ||
    !uploaded.prerelease ||
    uploaded.assets.length !== assets.length ||
    !assets.every((name) =>
      uploaded.assets.some((asset) => asset.name === name),
    )
  )
    throw Error(
      "Preview upload is incomplete; leaving the release unpublished.",
    );
  run([
    "release",
    "edit",
    context.tag,
    "--repo",
    context.repo,
    "--draft=false",
    "--prerelease",
    "--latest=false",
  ]);
  return `https://github.com/${context.repo}/releases/tag/${context.tag}`;
}

module.exports = { previewContext, prepareAssets, publishUnsigned };
if (require.main === module) {
  publishUnsigned().then(
    (url) => console.log(`Unsigned prerelease published: ${url}`),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
