PINE DESK — UNSIGNED PREVIEW

1. Drag Pine Desk.app into Applications, then eject this disk image.
2. Open Pine Desk from Applications.

If macOS says the app is "damaged" or blocks it, an "Open Anyway"
button may not appear in System Settings. For this trusted preview:

First verify your downloaded DMG against SHA256SUMS.txt from the same
GitHub release. Do not continue if the checksum differs.

Open Terminal (Applications > Utilities) and paste:

xattr -dr com.apple.quarantine "/Applications/Pine Desk.app"
open "/Applications/Pine Desk.app"

This removes quarantine only from the installed Pine Desk app. It does
not sign/notarize the app or disable Gatekeeper for other applications.
Do not run the command against all of Applications or Downloads.

Automatic previews are unsigned. Signed, notarized releases are separate.

Checksums and downloads:
https://github.com/ar4ft/pine-desk/releases

More help:
https://github.com/ar4ft/pine-desk/blob/main/docs/releases.md#opening-an-unsigned-preview-on-macos
