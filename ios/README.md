# NutriScan for iPhone

A native SwiftUI app for the NutriScan API in this repo (`api/`). It runs on your
own iPhone using a **free Apple ID** — no paid Apple Developer Program account,
no Firebase SDK, no CocoaPods/SPM packages.

| | |
|---|---|
| **Scan** | Log a meal (plate photo), audit a grocery receipt, or get the 5 best dishes on a menu. Up to 4 photos, compressed on-device before upload. |
| **Results** | Health score, macros, per-item feedback, key nutrients, "in plan / unplanned" tags for Balance Nutrition clients, and tap-to-choose healthier swaps (`POST /swaps/select`). |
| **Today** | Calories eaten vs burned, steps, water, AI insights, Apple Health details, last scan. |
| **Apple Health** | Reads steps, active + resting energy, exercise minutes, distance, sleep, weight, resting HR and workouts **natively** and pushes them to `/health/ingest`. Replaces the "Health Auto Export / Shortcut" setup the website needs. |
| **History / Insights** | All scans grouped by day; Swift Charts for energy in/out, steps vs goal, scan scores, and shopping-basket categories from receipts. |
| **Accounts** | *Continue without an account* (free guest ID, no sign-up), optional Google sign-in that keeps the guest's data, Balance Nutrition program linking. |
| **Widgets** | Home Screen: **Today** (S/M/L), **Water** (interactive + / −), **Quick Scan**. Lock Screen: steps ring, energy line, water gauge. |
| **Control Center** (iOS 18) | **Scan Meal** and **Log Water** controls — also assignable to the Action button. |
| **Siri & Shortcuts** | "Scan a meal with NutriScan", "Log water in NutriScan", "NutriScan summary", "Sync NutriScan health". |
| **Reminders** | Local meal and water notifications with action buttons (no push server). |
| **Background refresh** | Syncs Health and refreshes widgets about hourly. |

Requirements: an iPhone on **iOS 17** or newer (Control Center controls need iOS 18), and either
- a Mac with **Xcode 16** or newer — follow the steps below, or
- **no Mac**: Linux or Windows (WSL) with [xtool](https://github.com/xtool-org/xtool) — follow **[XTOOL.md](XTOOL.md)**.

---

## Install on your iPhone with a free Apple ID (≈5 minutes)

1. **Open the project**
   ```bash
   git checkout ios-app
   open ios/NutriScan.xcodeproj
   ```

2. **Edit `ios/Config/Signing.xcconfig`** — the only file you need to touch:
   - `BUNDLE_ID_PREFIX` → something unique to you, e.g. `com.priya.nutriscan`.
     Free accounts can't use a bundle ID someone else registered.
   - `API_BASE_URL` → where the API runs (see *Point the app at your server* below).
     Keep the `https:/$()/` spelling — `//` starts a comment in xcconfig files.

3. **Add your Apple ID to Xcode**: *Xcode › Settings › Accounts › + › Apple ID*.
   Any free Apple ID works.

4. **Pick your team for both targets**: select the project in the navigator →
   target **NutriScan** → *Signing & Capabilities* → *Team* = "Your Name (Personal Team)".
   Repeat for target **NutriScanWidgets**. Leave *Automatically manage signing* on.
   (Or paste your 10-character team ID into `DEVELOPMENT_TEAM` in the xcconfig once.)

5. **Prepare the iPhone**: plug it in (or same Wi-Fi after the first cable run),
   tap *Trust This Computer*, and turn on
   *Settings › Privacy & Security › Developer Mode* (the phone restarts).

6. **Run**: choose your iPhone as the run destination and press **⌘R**.

7. **First launch only**: iOS blocks apps from a free developer until you trust it —
   *Settings › General › VPN & Device Management › Apple Development: you@… › Trust*.
   Then open NutriScan again.

### What a free Apple ID means

| Limit | Effect on NutriScan |
|---|---|
| Apps expire after **7 days** | NutriScan stops opening. Plug in and press Run again — your data is on the server and in the Keychain, nothing is lost. |
| Max **3** sideloaded apps per device, **10 App IDs** per 7 days | NutriScan uses 2 App IDs (app + widget extension) and 1 App Group. |
| No Push Notifications | Reminders are local notifications — work fine. |
| No Sign in with Apple | Use guest mode or Google sign-in instead. |
| No TestFlight / App Store | Install from Xcode only. |

Capabilities this project uses — all available to a Personal Team:
**App Groups** (app ↔ widgets), **HealthKit** (read-only), **Background fetch**.
App Intents, WidgetKit, interactive widgets, Control Center controls and local
notifications need no special entitlement.

> If Xcode ever says *"Personal development teams … do not support the X capability"*,
> remove that one capability in *Signing & Capabilities*. The app degrades
> gracefully: without HealthKit the Health card says it's unavailable; without App
> Groups the widgets show "Open NutriScan to get started".

---

## Point the app at your server

The app calls `API_BASE_URL + /api/v1/...` — the same API the website uses.

* **Deployed** (Cloud Run / Firebase Hosting): `API_BASE_URL = https:/$()/your-project.web.app`
* **On your Mac** while developing:
  ```bash
  npm install
  npm run dev        # listens on :3002
  ```
  Find your Mac's LAN IP (*System Settings › Wi-Fi › Details*) and use
  `API_BASE_URL = http:/$()/192.168.1.20:3002`. Plain `http` on the local network
  is allowed by the app (`NSAllowsLocalNetworking`); iOS asks once for
  local-network permission.

You can also change the server inside the app without rebuilding:
*Settings › Server* (with a **Test connection** button). The onboarding screen
has the same link at the bottom.

Server requirements: guest mode must stay on (`ALLOW_GUEST_MODE` not `false`), which is
the default. Nothing else changes on the backend.

---

## Optional: Google sign-in

Guests can already use everything. Google sign-in lets people use the same data on
the website and survive deleting the app. The app does it without the Firebase SDK:
Google OAuth (PKCE, via the system sign-in sheet) → Firebase Auth REST →
`POST /api/v1/auth/firebase`, exactly what the website sends.

1. Firebase console › Authentication › Sign-in method › **Google** must be enabled
   (it already is if the website's Google button works). The server must have
   `FIREBASE_WEB_API_KEY` set — the app reads it from `GET /api/v1/client-config`.
2. Google Cloud console (same project as Firebase) › *APIs & Services › Credentials ›
   Create credentials › OAuth client ID* › **iOS**, bundle ID = your `BUNDLE_ID_PREFIX`.
3. Put its values in `Config/Signing.xcconfig`:
   ```
   GOOGLE_IOS_CLIENT_ID = 1234567890-abc123.apps.googleusercontent.com
   GOOGLE_REVERSED_CLIENT_ID = com.googleusercontent.apps.1234567890-abc123
   ```
4. Rebuild. A **Sign in with Google** button appears on the welcome screen and,
   for guests, in *Settings › Account*. Signing in carries the guest's scans,
   habits and health data into the account (the server does this with the guest secret).

If the OAuth client lives in a different Google Cloud project, allow-list its client ID
under *Firebase › Authentication › Google › Safelist client IDs from external projects*.

---

## Widgets, controls and Siri

* **Home Screen**: long-press › *Edit › Add Widget* › NutriScan → *Today*, *Water*, *Quick Scan*.
* **Lock Screen**: long-press › *Customize* › Lock Screen › widget area › NutriScan.
* **Control Center** (iOS 18): open Control Center › *+* › *Add a Control* › NutriScan.
* **Action button** (iPhone 15 Pro and later): *Settings › Action Button › Controls* › NutriScan.
* **Siri**: just say the phrases above — App Shortcuts need no setup.

How data reaches widgets: the app writes a small snapshot (today's calories, steps,
last scan, insight) into the shared App Group after each refresh and scan, and asks
WidgetKit to reload. Water is stored only in the App Group, so the widget buttons,
Siri, the Control Center control and the notification "+1 glass" action all update
the same counter without a network call.

---

## Project layout

```
ios/
├── Config/
│   ├── Signing.xcconfig          ← edit this (team, bundle ID, server URL, Google)
│   ├── App-Info.plist / Widget-Info.plist
│   └── *.entitlements            (App Groups, HealthKit)
├── Shared/                       compiled into the app AND the widget extension
│   ├── SharedStore.swift         App Group storage: widget snapshot, water, goals
│   ├── SharedIntents.swift       OpenScan / LogWater / TodaySummary App Intents
│   └── DeepLink.swift            nutriscan://scan?mode=… etc.
├── NutriScan/                    the app
│   ├── NutriScanApp.swift
│   ├── Core/                     APIClient, models, Keychain, session, Google sign-in, profile
│   ├── Health/                   HealthKit reader + sync to /health/ingest
│   ├── Services/                 AppModel, notifications, app delegate
│   ├── Intents/                  App Shortcuts (Siri phrases), Sync Health intent
│   └── Features/                 Onboarding, Today, Scan, Result, History, Insights, Settings
├── NutriScanWidgets/             WidgetKit extension: Today, Water, Quick Scan, controls
├── NutriScan.xcodeproj           Xcode 16 project (folder-synced: new files are picked up automatically)
├── project.yml                   XcodeGen fallback spec
├── Package.swift, xtool.yml      build without a Mac (xtool) — see XTOOL.md
└── Support/                      Info.plists + entitlements for xtool builds
```

### API endpoints used

| Screen | Endpoint |
|---|---|
| Welcome | `GET /client-config`, `POST /auth/guest`, `POST /auth/firebase` |
| Session | `POST /auth/refresh` (auto on 401), `GET /auth/me`, `POST /auth/revoke` |
| Settings | `POST /auth/link-bn`, `POST /auth/unlink-bn` |
| Scan | `POST /analyze` (multipart: `images`, `userProfile`, `scanMode`, `localTime`, `deviceHour`, `mealType`, `notes`) |
| Result | `POST /swaps/select` |
| History | `GET /results` |
| Today / Insights | `GET /health/summary?days=&tz=`, `GET /shopping-habits` |
| Apple Health | `POST /health/key`, `DELETE /health/key`, `POST /health/ingest` (sync key) |

For a linked Balance Nutrition client the scan profile is read from the BN client-details
API, exactly like the website, so diet-plan comparison works the same way.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| *Signing for "NutriScan" requires a development team* | Step 4 — pick your Personal Team for **both** targets. |
| *Failed to register bundle identifier* / *not available* | Change `BUNDLE_ID_PREFIX` to something more unique. |
| *Your maximum App ID limit has been reached* | Free accounts get 10 new App IDs per 7 days. Reuse the same prefix, or wait. |
| *Untrusted Developer* on the phone | Step 7. |
| *Could not launch … Developer Mode disabled* | Step 5. |
| App opens to "Can't reach the NutriScan server" | Check *Settings › Server › Test connection*; phone and Mac on the same Wi-Fi; firewall allows port 3002. |
| Widgets say "Open NutriScan to get started" | Open the app once after signing in; if it persists, check the App Groups capability is present on both targets. |
| Apple Health shows no data | *Health app › Sharing › Apps › NutriScan* → turn on the categories. iOS never tells apps when read access is denied, it just returns nothing. |
| App stopped opening after a week | Free-account apps expire after 7 days. Press Run in Xcode again. |
| Xcode won't open the project | `brew install xcodegen && cd ios && xcodegen` regenerates it from `project.yml`. |
