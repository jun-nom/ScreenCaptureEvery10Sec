# Miro Capture

A cross-platform desktop app that captures a Miro board page as PNG screenshots at a configurable interval (default: every 10 seconds) for up to 8 hours.

---

## Architecture

**Electron only — no Playwright required.**

The app uses Electron's built-in `BrowserWindow` and `webContents.capturePage()` instead of a separate Playwright/Chromium process. This is deliberately simpler and more stable because:

| Concern | Approach |
|---|---|
| Screenshot reliability | `capturePage()` captures the GPU compositor output — includes WebGL/Canvas used by Miro |
| No Chromium to bundle | Electron ships its own Chromium; no 300 MB extra download |
| Login persistence | Dedicated `BrowserWindow`; session cookies persist in Electron's profile |
| Packaging | `electron-builder` bundles everything; zero dependencies for end users |
| Miro detection avoidance | `Electron/x.x.x` stripped from User-Agent; no Node APIs exposed to page |

---

## Setup

### Prerequisites

- [Node.js](https://nodejs.org) ≥ 18 (development only — end users do not need Node)
- npm ≥ 9

### Install

```bash
npm install
```

---

## Running in development

```bash
npm run dev
```

This opens the app with DevTools available. The control panel and the Miro browser window are separate windows.

---

## Building distributable packages

### macOS (`.dmg` — both Intel and Apple Silicon)

```bash
npm run build:mac
```

Output: `dist/Miro Capture-1.0.0.dmg`

### Windows (`.exe` installer via NSIS)

```bash
npm run build:win
```

Output: `dist/Miro Capture Setup 1.0.0.exe`

### Both platforms at once

```bash
npm run build:all
```

> **Cross-compilation note:** Building a Windows `.exe` from macOS requires Wine or a Windows runner (e.g. GitHub Actions). Building a macOS `.dmg` from Windows is not supported by electron-builder.

---

## How to use

1. **Enter the Miro board URL** in the *Miro URL* field.
2. **Select the output folder** where screenshots will be saved.
3. **Configure duration, interval, and viewport size** (optional — defaults are 8 hours, 10 s, 1440×900).
4. **Click Open Browser** — a separate Chromium window opens and loads the Miro URL.
5. **Log in to Miro** inside that window (SSO/Google OAuth popups are supported).
6. Navigate to the exact board view you want to capture.
7. **Click Start** in the control panel.

Screenshots are saved as:
```
miro-capture-YYYYMMDD-HHMMSS.png
```
A log file `capture-log.txt` is written to the same output folder.

### Controls

| Button | Action |
|---|---|
| Start | Begin capturing at the configured interval |
| Pause | Suspend the timer (no capture taken while paused) |
| Resume | Resume from where it was paused |
| Stop | End the session (files already saved are kept) |

The capture stops automatically when the configured duration elapses.

---

## Notes on screenshot quality

- `capturePage()` captures at the **device pixel ratio** of your display. On a Retina/HiDPI screen a 1440×900 viewport produces a 2880×1800 PNG — this is intentional (higher quality).
- If you need exactly 1440×900 output regardless of DPI, resize the captured image afterwards with ImageMagick: `mogrify -resize 1440x900! *.png`
- Keep the Miro browser window **visible (not minimised)** during capture. A minimised window may suspend GPU rendering, producing a black frame.

---

## Custom app icon

Place the following files in the `assets/` folder before building:

| File | Format | Used for |
|---|---|---|
| `assets/icon.icns` | Apple Icon Image | macOS `.app` |
| `assets/icon.ico` | Windows Icon | Windows installer |
| `assets/icon.png` | PNG 512×512 | Linux |

Without these files `electron-builder` will use the default Electron icon.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Black screenshots | Keep the Miro window visible; don't minimise it |
| Login screen on every launch | This is expected on first run — log in once; cookies are persisted |
| "Miro Capture is damaged" on macOS | Run in Terminal: `xattr -cr "/Applications/Miro Capture.app"` then relaunch |
| Installer blocked on Windows | Click "More info" → "Run anyway" in the Windows SmartScreen dialog |
| `ENOENT` errors in log | Ensure the output folder exists and is writable |
