# NutriScan API v4.0 — Endpoint Specification

This document summarizes the active API endpoints for the NutriScan microservice, including authentication, analysis, and behavioral tracking.

---

## 🔐 Authentication
**Base URL**: `/api/v1/auth`

### 1. Generate Token Pair
- **Endpoint**: `POST /token`
- **Auth**: Public (Rate-limited)
- **Headers**: `Content-Type: application/json`
- **Request Payload**:
  ```json
  {
    "userId": "string (Required)",
    "deviceInfo": "string (Optional)"
  }
  ```
- **Response**:
  ```json
  {
    "accessToken": "string",
    "refreshToken": "string",
    "expires": "15h",
    "refreshExpires": "30d"
  }
  ```

### 2. Refresh Access Token
- **Endpoint**: `POST /refresh`
- **Headers**: `Content-Type: application/json`
- **Request Payload**:
  ```json
  {
    "refreshToken": "string (Required)",
    "userId": "string (Required)"
  }
  ```

### 3. Revoke Session (Logout)
- **Endpoint**: `POST /revoke`
- **Request Payload**:
  ```json
  {
    "refreshToken": "string (Optional if revokeAll is true)",
    "userId": "string (Required if revokeAll is true)",
    "revokeAll": "boolean (Optional)"
  }
  ```

---

## 🤖 AI Analysis
All endpoints below require `Authorization: Bearer <token>`.

### 1. Analyze Food Scan
- **Endpoint**: `POST /api/v1/analyze`
- **Content-Type**: `multipart/form-data` OR `application/json`
- **Request Payload**:
  - `image` / `images`: (File or Base64 string) Primary scan asset.
  - `scanMode`: `"RECEIPT" | "MENU" | "PLATE"` (Default: `RECEIPT`)
  - `userProfile`: (JSON Object/String)
    ```json
    {
      "name": "string",
      "classification": "CLIENT | LEAD",
      "program": "string",
      "allergies": ["string"],
      "aversions": ["string"],
      "dietPreference": "string"
    }
    ```
  - `mealType`: `"Breakfast" | "Lunch" | "Snack" | "Dinner" | "Auto"`
  - `expectedDiet`: (String) Pre-parsed meal instructions for comparison.
  - `localTime`: (ISO Date String) User's local time for meal context.
- **Response**: `AnalysisResult` (Macros, Health Score, Item Breakdown).

---

## 📈 Habits & History
Requires `Authorization: Bearer <token>`.

### 1. Shopping Habits & Trends
- **Endpoint**: `GET /api/v1/shopping-habits`
- **Payload**: None (Derives `userId` from JWT)
- **Response**: Aggregated JSON containing `categoryDistribution`, `macroTrends`, and `receiptHistory`.

### 2. Full Scan History
- **Endpoint**: `GET /api/v1/results`
- **Query Params**: `userId` (Optional)
- **Response**: Array of last 50 scans.

### 3. Latest Scan
- **Endpoint**: `GET /api/v1/results/latest`
- **Query Params**: `userId` (Optional)

---

## 🛠️ Behavioral Tracking

### 1. Select Alternative (Swap)
- **Endpoint**: `POST /api/v1/swaps/select`
- **Request Payload**:
  ```json
  {
    "scanId": "string",
    "original": "string (Item Name)",
    "chosen": "string (Alternative Name)"
  }
  ```

---

## 📡 Diagnostics
- **GET /api/v1/health**: System uptime, memory usage, and database status.
- **GET /api/v1/debug**: Environment variable check (API Keys presence).
