# Signed, notarized Mac releases and automatic updates

The release pipeline is prepared. **Apple credentials are not configured or included.** Until you add them, use `npm run dist:mac` and unsigned CI artifacts. Those builds do not check for updates. The signed pipeline requires credentials and fails rather than silently producing an unsigned release.

## Configure later

1. Join the [Apple Developer Program](https://developer.apple.com/programs/) and choose the team that will own Pine Desk. Keep the app ID `dev.pinedesk.app` stable after the first release.
2. Create a **Developer ID Application** certificate in Apple's Certificates, Identifiers & Profiles. In Keychain Access on your Mac, export the certificate **with its private key** as a password-protected `.p12`. This is for distribution outside the Mac App Store; Developer ID Installer is not needed for DMG/ZIP distribution. Future releases must use the same signing identity/team. Renew the certificate under that team before expiry.
3. Create a team [App Store Connect API key](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api) authorized for notarization. Download its `.p8` private key, and retain its Key ID and Issuer ID. Consult Apple's [notarization guidance](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) for current account permissions and agreements.
4. In [repository settings](https://github.com/ar4ft/pine-desk/settings/environments), create/configure the **release** environment. Add the following environment secrets (repository secrets also work):

| Secret | Value |
| --- | --- |
| `CSC_LINK` | Base64 contents of the exported Developer ID Application `.p12` |
| `CSC_KEY_PASSWORD` | Password protecting that `.p12` |
| `APPLE_API_KEY_BASE64` | Base64 contents of the notarization `.p8` |
| `APPLE_API_KEY_ID` | App Store Connect API Key ID |
| `APPLE_API_ISSUER` | App Store Connect API Issuer ID |

Generate base64 locally, without committing output:

```sh
base64 -i /absolute/path/DeveloperIDApplication.p12 | pbcopy
# Paste into CSC_LINK in GitHub; then clear your clipboard.
base64 -i /absolute/path/AuthKey_KEYID.p8 | pbcopy
# Paste into APPLE_API_KEY_BASE64; then clear your clipboard.
```

The workflow decodes the `.p8` into a temporary runner file, restricts permissions, sets `APPLE_API_KEY`, and removes that file on completion. electron-builder imports the signing certificate into its temporary keychain. Logs and preflight errors name missing settings without printing secret values. Do not put certificates, passwords or keys in this repository.

The workflow uses GitHub's automatic `GITHUB_TOKEN` with `contents: write` in the release job; **no personal GitHub token secret is required**. Environment approval rules are optional and can be configured later in GitHub. If you enable them, GitHub will pause releases at that environment.

## Publish a stable version

From a clean checkout, after committing your changes:

```sh
npm version 0.2.0
# Creates the version commit and v0.2.0 tag; choose your actual next version.
git push origin main
git push origin v0.2.0
```

A tag push runs `.github/workflows/release.yml`. Tags must be stable `vX.Y.Z` and match `package.json`. The workflow can also be rerun manually with an **existing tag**. Do not move a published tag or overwrite an installed version: bump the version instead. Rerunning a failed build can reuse its draft release; an already published release is rejected.

The workflow:

1. Runs backend and browser tests.
2. Checks required signing/notarization settings and version/tag correspondence, then runs the Electron smoke test on macOS.
3. Creates a draft GitHub release and builds **Apple Silicon and Intel DMG + ZIP** together on the same runner.
4. Enforces code signing and hardened runtime; notarizes with Apple and staples the app ticket through electron-builder.
5. Verifies both apps with `codesign`, Gatekeeper `spctl`, and `stapler`. Checks that `latest-mac.yml` contains both architectures' ZIPs, sizes and SHA-512 hashes.
6. Uploads artifacts and makes the draft release public/latest only after verification passes.

On failure, the draft stays unpublished; users keep the previous stable release. ZIPs are required for Mac updates even when users originally install from DMG. Preserve `latest-mac.yml`, both architecture ZIPs, DMGs and generated blockmaps as GitHub release assets. Building the architectures together lets electron-builder create a combined update manifest rather than overwriting one architecture's metadata.

Signing entitlements allow V8 JIT and executable memory used by Electron. They do not enable App Sandbox or debugging entitlements. The existing renderer remains isolated. Validate the real signed app's chart workers, backtest workers and MCP connections before announcing your first release; Apple signing and end-to-end installation cannot be verified until credentials and a Mac are available.

## User update behavior

Only signed release builds include `release-channel.json` and GitHub update configuration. The app checks the public `ar4ft/pine-desk` stable release feed about 20 seconds after launch and every six hours. **Help → Check for Updates…** checks immediately. Prereleases and downgrades are excluded. Update errors leave the installed app usable; manual checks show a status/error dialog.

Updates download automatically. Once ready, the user chooses **Restart and install** or **Later**; the default is Later. Save unsaved work before restarting. Closing the app does not silently install a downloaded update. Help → Check for Updates can reopen the installation prompt during that session. Saved scripts, editor storage, datasets and runs remain in the existing user data directory.

Install the signed app into `/Applications`, eject the DMG and launch that installed copy. Apple's update mechanism verifies the signed replacement; releases need a consistent signing team. Public GitHub releases need no user token. Private release feeds require a separate authenticated distribution design; never embed a repository token in a desktop app.

## Local signed build

On your Mac, set `CSC_LINK` to your certificate file or base64 contents, `CSC_KEY_PASSWORD`, and `APPLE_API_KEY` to the absolute `.p8` path, plus `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`. Keep them in your process environment, outside source control. Then:

```sh
npm ci
npm run dist:mac:release
```

This signs and notarizes using the release configuration but **does not publish**. To publish, use the tagged GitHub workflow. `npm run dist:mac` continues to create ordinary development packages.

## First-release acceptance checks

Download each architecture's signed DMG/ZIP from the release and validate signatures and stapled tickets on a Mac. Run chart execution and backtests from `/Applications`. Publish a second, higher test release using the same team and verify that the installed first version discovers it, downloads the matching architecture and prompts before installation. Verify the Later path, offline checks, and preservation of saved work. These live Apple/update checks remain pending until credentials and two signed versions exist.

Sources: [electron-builder signing](https://www.electron.build/code-signing-mac), [notarization](https://www.electron.build/mac), [electron-updater](https://www.electron.build/auto-update).
