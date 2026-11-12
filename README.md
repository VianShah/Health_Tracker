# NutriScan: Clinical AI Nutritional Auditor

NutriScan is a high-performance, AI-driven nutritional analysis engine designed for **Balance Nutrition**. It bridges the gap between static diet plans and real-world consumption by auditing **Receipts**, **Restaurant Menus**, and **Meal Plates** using advanced clinical intelligence.

---

## 🚀 Key Features

### 1. Unified Analysis Modes
-   **Receipt Scan**: Extracts every food/beverage item from a supermarket bill, identifying processed goods and suggesting 3 clinical alternatives for unhealthy items.
-   **Menu Recommendation**: Scans physical restaurant menus and recommends the 5 healthiest dishes based on user profile and current meal time (Breakfast, Lunch, Dinner).
-   **Log Meal (Plate Scan)**: Analyzes food photos for portion estimation and macro breakdown.

### 2. Clinical Intelligence (Senior Nutritionist Brain)
-   **Client vs. Lead Logic**: Automatically detects user status. **Clients** get direct comparison against their active diet plan (Planned vs. Unplanned tags).
-   **Lower-End Approximation**: Artificially adjusts macro estimates by ~10-15% downwards to provide a "dietary safety buffer."
-   **Non-Food Guard**: Prevents zeroing out scores in mixed scans and correctly identifies non-edible items (electronics, cosmetics).

### 3. Integrated Shopping Habits
-   **Category Distribution**: Tracks user purchases across lifestyle categories (Superfoods, Dairy, Processed, etc.).
-   **Macro Trends**: Aggregates historical intake into actionable hydration graphs for user dashboards.

---

## 🏗️ Technical Architecture

-   **Runtime**: Node.js / Express.js
-   **AI Core**: Google Gemini 2.5 Flash (Optimized for speed/reasoning ratio).
-   **Database**: Google Firestore (NoSQL) for high-scale document persistence.
-   **Auth**: Stateless JWT with Refresh Token rotation (30-day session persistence).
-   **Frontend**: React Native Optimized (handles heavy "Fast-Track" image compression locally).
-   **Image Engine**: `sharp` (server-side normalization) + Canvas API (client-side compression).

---

## 🛠️ Setup & Deployment

1.  **Environment Variables**:
    Create a `.env` file with the following:
    ```bash
    GOOGLE_API_KEY=...
    JWT_SECRET=...
    FIREBASE_PROJECT_ID=...
    FIREBASE_CLIENT_EMAIL=...
    FIREBASE_PRIVATE_KEY=...
    FIRESTORE_DB=(microservice)
    # Sign-in (Firebase Auth). Public web config from Firebase console > Project settings > Your apps
    FIREBASE_WEB_API_KEY=...
    FIREBASE_AUTH_DOMAIN=<project>.firebaseapp.com
    FIREBASE_WEB_APP_ID=...
    AUTH_PROVIDERS=google            # or google,apple
    ALLOW_LEGACY_USERID_LOGIN=false  # true ONLY for local testing (see Accounts below)
    # Optional product analytics — empty key disables PostHog entirely
    POSTHOG_KEY=phc_...
    POSTHOG_HOST=https://eu.i.posthog.com
    ```

    **Analytics events** (sent only when `POSTHOG_KEY` is set; users are identified by BN client ID only — no names, food items or diet details are sent, and session replays mask all text and inputs):
    `$pageview` (per screen) · `scan_started` · `scan_mode_switched` · `photos_selected` · `crop_cancelled` · `meal_time_verified` · `analysis_started` · `analysis_succeeded` · `analysis_failed` · `result_viewed` · `swap_toggled` · `client_loaded`

2.  **Local Development**:
    ```bash
    npm install
    npm run dev
    ```

    **Accounts**
    -   Clients sign in with Google (or Apple) through Firebase Auth. The browser sends the Firebase ID token to `POST /api/v1/auth/firebase`, the server verifies it and issues the app's own access + refresh tokens.
    -   A signed-in account can link a Balance Nutrition program with `POST /api/v1/auth/link-bn`. The link is accepted only when the email registered on that BN client equals the verified sign-in email. Linked accounts use the BN client ID as their user ID, so existing scans and habits carry over. Unlinked accounts are analysed as leads.
    -   `GET /api/v1/results` and `/results/latest` always return the caller's own scans.
    -   `POST /api/v1/auth/token` (a token for any client ID, no proof) is refused unless `ALLOW_LEGACY_USERID_LOGIN=true`. Keep it `false` in production.
    -   The site's domain must be listed under Firebase console > Authentication > Settings > Authorized domains (add `localhost` for local sign-in).
    -   Account storage is implemented for the Firestore driver only (collection `users`).
    -   **Guest mode** ("Continue without signing in", on unless `ALLOW_GUEST_MODE=false`): `POST /api/v1/auth/guest` issues tokens for a guest ID derived from a random secret kept on the device, so it cannot be guessed. When that guest later signs in, the browser sends the secret along and the server moves the guest's scans, health data and sync key into the account (never overwriting the account's own data).
    -   **Sign in with Apple** shows when `AUTH_PROVIDERS` includes `apple`. The server asks Firebase which providers are actually enabled; until Apple is enabled, the button explains that instead of failing. To enable it: an Apple Developer account, a Services ID with "Sign in with Apple" configured (return URL `https://<project>.firebaseapp.com/__/auth/handler`), a Sign in with Apple key, then Firebase console > Authentication > Sign-in method > Apple (Services ID, Team ID, Key ID, private key).

    **Apple Health sync**
    -   Websites cannot read Apple Health, so the phone pushes data. In the app, Today > Connect Apple Health creates a per-user sync key (shown once, stored only as a SHA-256 hash) and shows setup steps for the Health Auto Export app (REST automation) or a free iPhone Shortcut.
    -   `POST /api/v1/health/ingest` with `Authorization: Bearer nsh_...` accepts Health Auto Export JSON, or a simple body such as `{ "steps": 8421, "activeCalories": 412, "restingCalories": 1580, "exerciseMinutes": 32, "sleepHours": 7.2, "weightKg": 72.4, "workouts": [{ "type": "Running", "minutes": 30, "calories": 280 }] }`, or `{ "days": [{ "date": "2026-11-10", ... }] }`.
    -   `GET /api/v1/health/summary?days=7&tz=Asia/Kolkata` returns each day's health data, calories from logged meals, net energy, and up to 3 plain-language insights. Stored per day in the `healthDays` collection; keys in `healthKeys`.

3.  **Docker Build**:
    ```bash
    docker build -t nutriscan-service .
    ```

4.  **Cloud Run Deployment**:
    ```bash
    gcloud run deploy nutriscan-service --platform managed
    ```

---

## 📈 System Economics
-   **Token Optimization**: Backend performs localized diet parsing—sending only relevant meal segments to the AI to reduce input costs.
-   **Scale-to-Zero**: Designed for serverless deployment, ensuring zero costs during idle periods.

---
*Developed for Balance Nutrition | 2026*
