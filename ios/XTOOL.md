# Build & install NutriScan without a Mac (xtool)

[xtool](https://github.com/xtool-org/xtool) is an open-source Xcode replacement that builds
iOS apps from a Swift Package on **Linux** or **Windows (WSL)**, signs them with your
**free Apple ID**, and installs them on your iPhone over USB. This folder contains everything
it needs: `Package.swift`, `xtool.yml` and `Support/`.

## What you need

- A Linux PC, or Windows 10/11 with WSL (Ubuntu)
- An iPhone on iOS 17+ and a USB cable
- A free Apple ID (consider a spare one — xtool's password login uses Apple's private APIs)
- ~40 GB free disk space (for the Xcode download and SDK extraction)

## 1. One-time setup

Full official guide: https://xtool.sh/documentation/xtooldocs/installation-linux

1. **Swift 6.4 toolchain** for your distro from https://swift.org/install/linux, then check:
   ```bash
   swift --version
   ```
2. **usbmuxd** (talks to the iPhone):
   ```bash
   sudo apt-get install usbmuxd libimobiledevice-utils
   ```
   *WSL users:* also set up USB passthrough with
   [usbipd](https://learn.microsoft.com/en-us/windows/wsl/connect-usb) and attach the iPhone to WSL.
3. **Download Xcode.xip** (the version the xtool guide names) in your browser from
   https://developer.apple.com/download/all/?q=Xcode — sign in with your Apple ID. You don't
   need a Mac; xtool only extracts the iOS SDK from it.
4. **Install xtool**:
   ```bash
   curl -fL "https://github.com/xtool-org/xtool/releases/latest/download/xtool-$(uname -m).AppImage" -o xtool
   chmod +x xtool && sudo mv xtool /usr/local/bin/
   ```
5. **Log in and install the SDK**:
   ```bash
   xtool setup
   ```
   Choose **1: Password** (works with a free Apple ID), enter your Apple ID + 2FA code,
   then give the path to `Xcode.xip`. Afterwards `swift sdk list` should show `darwin`.

## 2. Configure NutriScan (3 files)

```bash
git clone https://github.com/VianShah/Health_Tracker.git
cd Health_Tracker && git checkout ios-app && cd ios
```

1. **`xtool.yml`** — replace `yourname` in both bundle IDs with something unique:
   ```yaml
   bundleID: com.priya.nutriscan
   ...
       bundleID: com.priya.nutriscan.widgets
   ```
2. **`Support/NutriScan.entitlements`** and **`Support/NutriScanWidgets.entitlements`** —
   the App Group must be `group.` + that bundle ID:
   ```xml
   <string>group.com.priya.nutriscan</string>
   ```
3. **`Support/NutriScan-Info.plist`** — set your server (the `api/` in this repo):
   ```xml
   <key>NutriScanAPIBaseURL</key>
   <string>https://your-project.web.app</string>
   ```
   For a server on your PC use its LAN IP, e.g. `http://192.168.1.20:3002`, with the
   phone on the same Wi-Fi. You can also change it later in the app: *Settings › Server*.
   Optional Google sign-in: fill `NutriScanGoogleClientID` and replace
   `com.googleusercontent.apps.unset` (twice) with your reversed client ID — see README.md.

## 3. Build, install, run

1. Plug in the iPhone, unlock it, tap **Trust This Computer**.
2. On the iPhone: *Settings › Privacy & Security › Developer Mode* → On (it restarts).
3. In the `ios/` folder:
   ```bash
   xtool devices     # your iPhone should be listed
   xtool dev         # build → sign → install → launch
   ```
   The first build takes a while. `xtool dev build` only builds (output: `ios/xtool/NutriScan.app`).
4. First launch only: *Settings › General › VPN & Device Management* › your Apple ID › **Trust**.

**Every 7 days** a free-account app expires. Run `xtool dev` again — your data is safe.

## What works in an xtool build

xtool doesn't run Apple's App Intents metadata step (that tool only runs on macOS), so features
built on App Intents are swapped for deep-link equivalents. The code uses `#if XTOOL` for this
(set in `Package.swift`); the Xcode project still gets the full versions.

| Feature | xtool build | Xcode build |
|---|---|---|
| Scan meals / receipts / menus, results, swaps, history, insights | ✅ | ✅ |
| Guest account, Google sign-in, BN program link | ✅ | ✅ |
| Apple Health sync (HealthKit — free-account capability) | ✅ | ✅ |
| Home Screen widgets: Today, Water, Quick Scan; Lock Screen widgets | ✅ | ✅ |
| Water widget +1 | ✅ tap opens the app and adds a glass | ✅ in place, without opening the app |
| Small Quick Scan widget | ✅ tap opens the meal scanner | ✅ each row opens its own mode |
| Meal & water reminders, notification "+1 glass" action | ✅ | ✅ |
| Background refresh | ✅ | ✅ |
| Control Center controls (iOS 18) | ❌ left out | ✅ |
| Siri phrases / Shortcuts app actions | ❌ not registered | ✅ |

> These limits come from the missing metadata step and haven't been tested on a device with
> this project. If xtool adds App Intents support later, delete `.define("XTOOL")` from
> `Package.swift` to turn everything on.

## How it maps

| Xcode project | xtool |
|---|---|
| `Config/Signing.xcconfig` | `xtool.yml` (bundle IDs) |
| `Config/App-Info.plist` (with `$(VARS)`) | `Support/NutriScan-Info.plist` (literal values) |
| `Config/*.entitlements` | `Support/*.entitlements` |
| `Assets.xcassets` (AccentColor, AppIcon) | colors are in code; icon via `iconPath` |
| `Shared/` compiled into both targets | `NutriScanShared` module both depend on |

xtool prefixes IDs when signing (`com.priya.nutriscan` → `XTL-ABCD.com.priya.nutriscan`, and
the group → `group.XTL-ABCD.com.priya.nutriscan`). The app works out the group from its own
bundle ID at runtime, so you never need to know the prefix.

## Troubleshooting

| Problem | Fix |
|---|---|
| `xtool devices` shows nothing | Unlock the phone, re-plug, accept *Trust*. On WSL, re-attach with `usbipd attach`. |
| `AFCClient.Error.muxError` on WSL | See https://github.com/xtool-org/xtool/issues/19#issuecomment-2898986718 |
| App ID / bundle ID errors | Make `bundleID` more unique. Free accounts get 10 new App IDs per 7 days. |
| Widgets say "Open NutriScan to get started" | Open the app and sign in once. Check both entitlements use the same `group.` value as `bundleID`. |
| Compile errors | Run `xtool dev build` and share the first error — note the project was written without access to a Mac or xtool SDK to compile against. |
