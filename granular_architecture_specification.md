# NutriScan: Granular System Architecture & Technical Specification

This document provides a definitive technical breakdown of the NutriScan system for end-to-end integration.

---

## 1. Authentication & Session Management

### 1.1 Initial Login & Token Generation
*   **Trigger**: User enters their `User ID` in the React Native / Web Dashboard.
*   **Auth Flow**:
    1.  Frontend hits `POST /api/v1/auth/token` with payload `{ "userId": "..." }`.
    2.  Backend verifies user existence/status via external CRM API.
    3.  **JWT Handling**: 
        *   **Access Token**: Short-lived (15 hours) for active requests.
        *   **Refresh Token**: Long-lived (30 days) stored in secure storage (Keychain/AsyncStorage).
    4.  **Automatic Re-auth**: When the Access Token expires, the app hits `POST /api/v1/auth/refresh` with the Refresh Token to get a new Access Token. **The user is never asked to log in again** until 30 days of inactivity.

---

## 2. User Classification (Client vs. Lead)

The system behavior pivots based on the `user_status` fetched from the CRM.

| User Type | Status Criteria | System Behavior |
| :--- | :--- | :--- |
| **Lead** | `user_status === 'lead'` | General nutritional analysis. Macros + Score given. No diet plan comparison. |
| **Client** | `user_status === 'active' \|\| 'completed'` | Clinical auditing. Every meal is compared against their **Active Diet Plan**. |

### 2.1 Diet Plan Extraction (Clients Only)
*   **API Called**: `GET https://bn-new-api.balancenutritiononline.com/api/v1/diet/get-dietByUserId`
*   **Logic**: 
    1.  Find the diet with the largest session number (most recent).
    2.  Identify the `sixth_day` closest to current date.
    3.  **Token Reduction**: The backend parses ONLY the relevant meal section (e.g., if it's 2 PM, extract "Lunch" section) to send to Gemini, minimizing input token costs.

---

## 3. Feature-Specific Logic & Payloads

### 3.1 Receipt Scan (Groceries/Packaged)
*   **Frontend**: Image compression via Canvas API -> Resize to max 1200px width.
*   **Backend Payload**: `FormData` { `image`, `mode: "RECEIPT"`, `profile: { allergies, program, weightGoal }` }.
*   **Intelligence**: Gemini compares OCR data against the user profile to flag "Bad" items (Score < 4) and suggests 3 healthy alternatives of a similar food type.

### 3.2 Feature: Menu Recommendation (Menu Scan)
*   **Meal Timing**: If no meal type is selected, the system uses **Device Local Time** (e.g., 9 AM = Breakfast) to set the context.
*   **Logic**:
    *   **Leads**: Recommend 5 healthiest items from the menu.
    *   **Clients**: The backend fetches the `expected_diet_plan`. Gemini scans the menu for the **closest matches** to the client's prescribed diet for that specific meal time.
*   **Output**: 5 recommended dishes with precise **Household Portioning** (e.g., "3 spoons" not "100g").

### 3.3 Feature: Log Meal (Plate Scan)
*   **Flow**: Similar to Receipt, but adds **Compliance Tracking** for Clients.
*   **Planned vs. Unplanned**:
    *   **Leads**: Get standard Identification + Macros + Wellness Score.
    *   **Clients**: The AI identifies the plate components and cross-references the `expected_diet_plan`.
    *   **Tags**: Items are tagged as `Planned` (on diet) or `Unplanned` (deviation).
*   **Outcome**: User receives a "Mentor's Note" on whether they followed the plan, then redirects to Home with the scan saved to history.

---

## 4. Output & Hydration

### 4.1 Graph Hydration
*   **Shopping Habits**: On the results screen, the system fetches aggregated data from the `habits` collection.
*   **Visuals**:
    *   **Category Distribution**: (Pie/Donut Chart) % of Dairy, Veg, Processed, etc.
    *   **Macro Trends**: (Line/Bar Chart) Historical progress of Protein vs. Carbs vs. Fats.

### 4.2 Completion & Save
*   **Trigger**: "Save History" button.
*   **Action**: API finalizes the Firestore entry. 
*   **Redirection**: Client-side redirect to the Feature Home Screen, clearing the scan buffer.

---
*Definitive Architectural Specification - v1.1 (March 2026)*
