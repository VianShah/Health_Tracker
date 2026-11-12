# NutriScan AI: Features, Functionalities & Roadmap

> **Last Updated:** March 2026 | **Status:** Phase 1 — Live & Operational

---

## 1. Overview

NutriScan AI is an intelligent clinical nutrition analysis engine built for **Balance Nutrition** nutritionists and clients. It leverages multimodal Generative AI (Google Gemini 2.0 Flash / OpenAI GPT-4o) to evaluate food images and restaurant menus against a user's real-time clinical profile — delivering personalized health scores, portion guidance, allergen warnings, and dietary recommendations.

The system is built as an API-first service with a web dashboard (Phase 1) and is designed for migration into a native mobile application (Phase 2).

---

## 2. Phase 1 — Current Capabilities (Live)

### 🎯 2.1 Three Distinct Scan Modes

NutriScan operates in three independent, specialized modes. Each mode has its own dedicated AI prompt and a tailored response schema.

#### 📋 RECEIPT Scan
- Identifies all valid food and beverage items on a printed or digital receipt.
- Evaluates each item's nutritional quality against the user's clinical profile.
- Excludes non-food line items (taxes, tips, service charges).
- Returns per-item: health score, macro estimates, allergy/aversion flags, and a reason.

#### 📖 MENU Scan *(Intelligent Portion Planner)*
- Acts as a **directive clinical nutritionist** — not a menu reader.
- Selects the **3–5 best dishes** from the menu for the user. Does not list every item.
- Suggests household-metric portion sizes in friendly, narrative instructions:
  - e.g. *"Use 4 spoons of dal (approx 100g) = 8g protein, 4g fat. Good for your Lunch."*
- **Time-Aware:** Automatically detects the meal type (Breakfast, Lunch, Snack, Dinner) from the server time of scan. Adjusts calorie budget accordingly. No frontend input required.
- **Diet Plan Matching (`ask_diet`):** When enabled, the AI strictly cross-references recommendations against the user's active clinical program (e.g., "Weight Loss Cleanse") before suggesting dishes.
- Returns a lean JSON response — `totalMacros`, `keyNutrients`, `confidence`, and `alternatives` are intentionally excluded to keep the response concise and token-efficient.

#### 🍽️ MEAL / PLATE Scan
- Performs **visual volume estimation** on physical food shown in a photo.
- Evaluates visible fat, oil, cooking methods, and portion sizes from the image.
- Describes the portion using visual language ("Entire Plate", "Half Bowl").
- Judges the meal on real-world macro density visible in the photo.

---

### 🧠 2.2 AI Prompt Engine

The prompt engine is structured with XML-scoped sections for better AI grounding and efficiency:

```xml
<system> → Role & Task definition
<scan_context> → Meal type, scan time (auto-derived)
<diet_plan_matching> → Active diet plan rules (conditional)
<portion_rules> → Numbered household-metric instructions
CLIENT CLINICAL PROFILE → User biometrics, goals, allergies
SCORING RULES → 10-factor P1–P10 scoring methodology
```

- Prompts are distinct per mode — no shared "master prompt" guessing the image type.
- The AI is told exactly what it is looking at, enabling it to focus its reasoning.
- Reasons are capped at ~50 tokens per dish to reduce output token cost.

---

### 🛡️ 2.3 Deterministic Validators (Post-AI Safety Layer)

After the AI responds, a rule-based safety engine runs over every item:

| Check | Action |
|---|---|
| **Allergy Match** | Score forced to 0, category = Bad, reason prepended with ⚠️ ALLERGY ALERT |
| **Taste Aversion Match** | Score capped at 1, reason prefixed with ⚠️ AVERSION |
| **Veg/Non-Veg Conflict** | Score forced to 0, `hasHabitConflict = true`, reason prefixed with ⚠️ HABIT CONFLICT |
| **Non-Veg user over-penalized** | Score rescued to min 5, category lifted to Fair |
| **Zero Macros** | Replaced with safe fallback defaults |
| **Score out of range** | Clamped to [0–10] |
| **healthScore** | Recalculated as true mathematical average of non-zero scores |
| **totalMacros (MENU)** | Explicitly deleted from the response |

---

### ⚙️ 2.4 API Architecture

| Component | Details |
|---|---|
| **Runtime** | Node.js (ESM), Express.js |
| **AI SDK** | Vercel AI SDK (`ai`, `@ai-sdk/google`, `@ai-sdk/openai`) |
| **Schema Validation** | Zod (strict structured output enforcement) |
| **Image Compression** | `sharp` — auto-resizes to 768×768, JPEG 70% before AI call |
| **Port Resilience** | Auto-increments port on `EADDRINUSE` conflict |
| **Time** | `localTime` auto-fills on server if not sent by client |
| **Scan History** | In-memory session store (per-instance) |

**Endpoints:**
- `POST /api/analyze` — Main scan endpoint. Accepts `multipart/form-data` (image, userProfile, scanMode, ask_diet, localTime)
- `GET /api/results` — Returns session scan history
- `GET /api/results/latest` — Returns the most recent scan result
- `GET /api/health` — Service health check
- `GET /api/debug` — Environment diagnostic (API key status)

---

### 👁️ 2.5 Web Dashboard (Phase 1 UI)

- Three mode selector buttons: **RECEIPT**, **MENU**, **LOG MEAL** (Plate)
- Image upload with immediate compression and transfer to the selected mode
- Real-time scan progress animation
- Per-item score cards with allergy/aversion/conflict badges
- Integrated with live client data from the Balance Nutrition backend (`client-details` API)
- User profile auto-populated from the BN system — no manual re-entry

---

## 3. Phase 2 Roadmap — Planned Improvements

### 📱 3.1 Native Mobile Application (iOS & Android)

| Feature | Description |
|---|---|
| **Point & Scan Camera** | Live camera integration — no gallery workflow |
| **AR Food Overlay** | Highlight detected dishes on the camera feed in real-time |
| **On-Device Cropping** | Focus the scan area before submission |
| **Multi-Profile Support** | Store and switch between family member profiles |
| **Offline Fallback** | Local food database for basic lookups without internet |

---

### 📊 3.2 Longitudinal Health Analytics

- **Meal Journal:** Persist scan results to user accounts with timestamps
- **Daily Macro Dashboard:** Aggregated calories scanned vs. user's daily budget
- **Trend Charts:** Weekly/monthly health score trends per meal type
- **Meal Type Breakdown:** Breakfast vs. Lunch vs. Dinner nutrition patterns
- **Streak & Compliance Score:** Daily consistency tracking against the active program

---

### 🍽️ 3.3 Menu Scan Enhancements

- **Cuisine Auto-Detection:** Identify cuisine type (Indian, Chinese, Continental) and apply culturally-aware portion logic (e.g., default katori size for Indian)
- **Multi-Image Menu:** Allow scanning multiple menu pages and combining recommendations
- **Live Restaurant Menu Integration:** Pull restaurant menus via APIs (Swiggy/Zomato) and analyze without scanning
- **Table-for-Group Mode:** Suggest a shared set of dishes for a group, balancing multiple profiles

---

### 🛒 3.4 New Scan Modes (Phase 2)

| Scan Mode | Description |
|---|---|
| **Barcode Scan** | Native camera barcode reader → OpenFoodFacts / FSSAI database lookup |
| **Grocery Label Scan** | Parse nutrition facts panels from packaged food labels |
| **Fridge Scan** | Photograph fridge contents → get a meal suggestion from available ingredients |
| **Diet Plan Scan** | Upload a printed/digital diet plan → AI validates it against the user's profile |

---

### 🤝 3.5 BN Platform Deep Integration

- **Automated Diet Plan Validation:** When `ask_diet = true`, actively fetch and parse the user's current diet plan PDF/schedule from the BN backend and compare the scan against it
- **Nutritionist Dashboard:** Nutritionists receive a feed of client scans for review and annotation
- **Push Feedback Loop:** Nutritionists can annotate scan results — feedback used to improve future recommendations
- **Weekly Report Generation:** Auto-generate a PDF nutrition summary of the week's scans for client review calls

---

### 🔔 3.6 Smart Reminders & Nudges

- Push notifications for meal logging (based on recurring meal times in user profile)
- Post-meal reminder: *"Did you log your lunch?"*
- Hydration nudges based on daily calorie surplus/deficit
- Program milestone alerts (e.g., *"You've hit 5 clean Dinners this week!"*)

---

### ⌚ 3.7 Wearables & Health Platform Integrations

- **Apple HealthKit** and **Google Fit** sync
- Pull "calories burned" from smartwatch to dynamically adjust the remaining meal budget for the day
- BMR-based adaptive calorie budgets per scan session

---

### 🔐 3.8 Infrastructure & Scalability

| Item | Plan |
|---|---|
| **Persistent Storage** | Migrate from in-memory scan history to PostgreSQL or Supabase |
| **User Auth** | JWT-based auth tied to BN client IDs |
| **Rate Limiting** | Per-user API rate limits to control Gemini spend |
| **Model Fallback** | Auto-fallback from Gemini → GPT-4o on quota/error |
| **Audit Logging** | Full request/response logging for scan audit trails |
| **Cost Monitoring** | Token usage tracking per scan mode to optimize prompt spend |

---

## 4. Known Limitations (Phase 1)

- Scan history is **in-memory only** — resets on server restart
- `ask_diet` currently uses the user's `program` field as a proxy, not an actual parsed diet plan document
- Menu recommendations depend entirely on image clarity — blurry or low-contrast menus reduce accuracy
- No user authentication — any client ID can be queried by any dashboard user
- Single-instance server — no horizontal scaling or queue management yet
