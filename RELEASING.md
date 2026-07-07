# Releasing zz-Record

This repository publishes the Windows installer with `electron-builder` + `electron-updater`.

The primary shipped desktop artifact right now is:

- `zz-Record-windows-x64.exe`

## What the release workflow does

When you publish a GitHub release tagged like `v1.3.4-custom`, `.github/workflows/release.yml` will:

- validate that `package.json` matches the tag version
- build the Windows NSIS installer
- generate `latest.yml` and release checksums
- upload the Windows installer assets to the GitHub release

The packaged app then checks GitHub Releases for:

- `latest.yml`

### Windows signing

Set these repository secrets:

- `WINDOWS_SIGNING_CERTIFICATE_P12_BASE64`
- `WINDOWS_SIGNING_CERTIFICATE_PASSWORD`

These should point to an Authenticode code-signing certificate exported as `.p12` and then base64-encoded.

## Release flow

1. Bump `package.json` to the version you want to ship.
2. Commit and push that version.
3. Create a Git tag in the form `vX.Y.Z-custom`.
4. Create and publish a GitHub release for that tag. Prefer the helper so custom notes are prepended while GitHub still generates the contributor section:

```bash
npm run release:create -- --tag v1.3.4-custom --title "zz-Record v1.3.4" --notes-file ./release-notes.md
```

For prereleases:

```bash
npm run release:create -- --tag v1.3.5-beta.1-custom --title "zz-Record v1.3.5 beta-1" --prerelease --notes-file ./release-notes.md
```

This uses `gh release create --generate-notes`, which keeps GitHub's generated change summary and contributor list instead of replacing it with a fully manual release body.

5. The `Publish Release` workflow builds, uploads, and publishes Windows update metadata.

That is the normal path if you want “click new release and let CI do the rest.”

## Rebuilding an existing release

If you need to rerun publishing for an existing tag, use the manual dispatch for `.github/workflows/release.yml` and provide the existing tag.

## Notes

- The expected uploaded Windows assets are:
  - `zz-Record-windows-x64.exe`
  - `zz-Record-windows-x64.exe.blockmap`
  - `latest.yml`
  - `RELEASE_CHECKSUMS.txt`
- The local Windows build command remains `npm run build:win`.
- If the local `release/win-unpacked` directory is locked by a running process, either stop the packaged app first or build to a fresh output directory.
