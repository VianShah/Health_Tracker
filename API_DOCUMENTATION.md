# NutriScan Production API Documentation (v4.0)

This documentation provides the technical specification for the NutriScan microservice. All endpoints leverage **Gemini 2.5 Flash** for high-precision clinical auditing.

---

## 🔐 Authentication (JWT & Refresh)
All analysis and history endpoints require a `Bearer Token`.

### 1. Initial Token Exchange
**`POST /api/v1/auth/token`**
*   **Payload**: `{ "userId": "user_123" }`
*   **Response**: 
    ```json
    { 
      "accessToken": "eyJ...", 
      "refreshToken": "eyJ...", 
      "expiresIn": "15h" 
    }
    ```

### 2. Token Refresh
**`POST /api/v1/auth/refresh`**
*   **Payload**: `{ "refreshToken": "..." }`
*   **Response**: `{ "accessToken": "...", "expiresIn": "15h" }`

---

## 🚀 Core Analysis Endpoints

### 1. Unified Scan Analysis
**`POST /api/v1/analyze`**
*   **Auth**: Required (Bearer)
*   **Content-Type**: `multipart/form-data`
*   **Payload**:
    *   `image`: (File) Compressed JPEG.
    *   `mode`: (String) `RECEIPT`, `MENU`, or `PLATE`.
    *   `profile`: (JSON String) `{ "allergies": [], "program": "Weight Loss", "weightGoal": 70 }`.
*   **Clinical Behavior**:
    *   **Lower-End Approximation**: Macros are automatically rounded down/reduced by ~10% for a safety buffer.
    *   **Diet Matching**: If a client profile is detected, the microservice automatically fetches their active diet plan from the **Internal CRM API** to perform a `Planned vs Unplanned` comparison.
        *   **Internal API**: `GET https://bn-new-api.balancenutritiononline.com/api/v1/diet/get-dietByUserId`
        *   **Internal Payload**: `{ "userId": "...", "Active_order ID" }
        *   **Optimization**: The backend extracts only the **relevant meal segment** (e.g., Breakfast vs. Dinner) to reduce input token usage.
    *   **Alternatives**: Returns 3 healthy substitutes for any item with a score < 4.

### 2. Menu Recommendation (Menu Mode)
**`POST /api/v1/analyze` (with `mode: "MENU"`)**
*   **Logic**: Uses **Device Local Time** for meal-type context (Breakfast/Lunch/Dinner).
*   **Response**: Returns 5 top recommendations with **Household Portioning** instructions.

---

## 📊 History & Behavioral Insights

### 1. Get Scan History
**`GET /api/v1/results?userId=...`**
*   **Response**: Array of scan objects including scores, macros, and timestamps.

### 2. Shopping Habits & Macro Trends
**`GET /api/v1/shopping-habits`**
*   **Auth**: Required (Bearer)
*   **Behavior**: Returns aggregated behavior data and trip-based slicing for graph hydration.
*   **Data Points**:
    *   `categoryDistribution`: Item counts by lifestyle category (Superfoods, Meat, etc.).
    *   `macroTrends`: Long-term running average of Protein, Carbs, and Fats.
    *   `tripSlices`: Multi-window comparative slicing (Last 3, 5, and 15 receipt scans).
        *   `productTotal`: Sum of all items scanned within that trip window.
        *   `avgBasketScore`: Mean health score (0-10) of the shopping baskets in that window.
    *   `receiptHistory`: Raw JSON for the last 30 receipts (dates, scores, item counts).

### 3. Behavioral Tracking (Swaps)
**`POST /api/v1/swaps/select`**
*   **Behavior**: Saves a "Life-Swap" preference when a user chooses a healthier alternative for a low-scoring item (Score ≤ 4).
*   **Persistence Strategy**:
    *   **Scan History**: All 3 AI-suggested alternatives are **always** saved in the raw scan document.
    *   **Behavioral Moat (Habits)**: Only the **specific chosen alternative** is incremented in the user's long-term profile.

---

## 🛠️ Infrastructure Requirements
The following environment variables are mandatory for deployment:

| Variable | Description | Value Example |
| :--- | :--- | :--- |
| `GOOGLE_API_KEY` | Gemini AI Platform Key | `AIza...` |
| `FIREBASE_PROJECT_ID` | Project ID for Firestore | `microservice-nutriscan` |
| `FIREBASE_CLIENT_EMAIL` | Service Account Email | `firebase-adminsdk@...` |
| `FIREBASE_PRIVATE_KEY` | RSA Private Key (PEM) | `-----BEGIN PRIVATE KEY-----...` |
| `FIRESTORE_DB` | Target Named Database | `microservice` |
| `JWT_SECRET` | Secret for token signing | (Random UUID) |

---
*Updated: March 2026 for NutriScan v4.0*
