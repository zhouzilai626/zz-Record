# ZZ Record

[简中](README.md)

ZZ Record is a Windows screen recorder and editor for tutorials, demos, and work documentation. Record a screen or window, edit it immediately, add cursor and zoom effects, and export MP4 or GIF. A phone can also be used as a local-network camera.

> The first public release supports Windows x64 only. Downloads are available from [Releases](https://github.com/zhouzilai626/zz-Record/releases); feedback belongs in [Issues](https://github.com/zhouzilai626/zz-Record/issues).

![Recording and editing](./docs/media/feature1.gif)

## Features

- Record an entire display or an application window
- Record microphone and system audio
- Trim, crop, adjust speed, annotate, and style recordings
- Use cursor smoothing, click effects, and auto-zoom suggestions
- Add a local webcam or a phone camera on the same LAN
- Export MP4 or GIF, or save a project for later editing

## Install on Windows

1. Download `zz-Record-windows-x64.exe` from [Releases](https://github.com/zhouzilai626/zz-Record/releases).
2. Run the installer.
3. Select a display or window. Enable Microphone and/or System Audio before starting when sound is needed.

The current installer is not code-signed. Windows SmartScreen may show a warning. Download only from this repository's Release page and verify the SHA-512 checksum published with the release.

## Phone Camera

Select **Phone Camera (Local)** from the camera menu, scan the desktop QR code, and allow camera access in the phone browser. The phone and desktop must be on the same LAN. On first use, the phone may ask you to trust the locally generated HTTPS certificate.

Frames are transferred only over the local HTTPS connection; no third-party service receives the camera feed.

## Requirements and limits

| Item | Current support |
| --- | --- |
| OS | Windows 10 20H1 (Build 19041) or newer, x64 |
| Recording | Screen, window, microphone, system audio |
| Camera | Local webcam and phone camera on the same LAN |
| Export | MP4 and GIF |

- macOS and Linux source remains in the repository, but no equally tested public installers are provided yet.
- Third-party extensions are temporarily disabled and installed extensions do not run.
- Some native Windows recordings keep audio as sidecar tracks; use the editor preview and exported file to verify final audio.

## Build from source

Building on Windows requires Node.js, Visual Studio 2022 (or Build Tools) with the C++ workload, and CMake.

```bash
git clone https://github.com/zhouzilai626/zz-Record.git
cd zz-Record
npm install
npm run dev
```

Build an installer with:

```bash
npm run build:win
```

Generated files go to `release/` and are intentionally excluded from Git.

## Contributing and security

Use [Issues](https://github.com/zhouzilai626/zz-Record/issues) for bugs and feature ideas. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a focused pull request. Do not disclose exploitable security details in a public issue; follow [SECURITY.md](./SECURITY.md).

## License and attribution

ZZ Record is a customized derivative of [Recordly](https://github.com/webadderallorg/Recordly), which was originally derived from [OpenScreen](https://github.com/siddharthvaddem/openscreen).

This project is released under the [GNU AGPL-3.0](./LICENSE.md). Keep its license, copyright notices, and attribution when using, modifying, or redistributing it.
