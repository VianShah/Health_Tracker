# 📋 TODOS-Later: Deferred Architecture & Enhancements

This document tracks system integrations, enhancements, and tasks that have been deliberately deferred for future implementation rounds to maintain focus on current optimizations.

---
chnage the model thinking - max 1200 tokens ,
allow users to select the menu suggestions and sav their prefrences. we get to save the data. 
## 1. Contextual User Profile Hydration (Deep AI Context)

**Context:** The NutriScan API was rebuilt to allow highly sophisticated generative health scoring when fed dense user data. During the optimization verification, the AI flawlessly leveraged deep conditions (`allergies`, `goals`, `dietPreference`) to score food strictly according to clinical constraints.

**Current Live State:** Real production payloads from the Mobile App/Web Frontend currently transmit a "skinny" or mostly empty `userProfile` blob inside the `POST /api/analyze` request, resulting in generic health scores. 

**Deferred Implementation Tasks:**
- [ ] **Frontend Approach (Recommended):** Revise the mobile/web App to aggressively package and pass native user data (age, weight, lifestyle conditions, clinical intolerances, and goals) from the primary Balance Nutrition state into the `req.body.userProfile` JSON.
- [ ] **Backend Alternative:** If Frontend updates are too complex, expose a dedicated Balance Nutrition endpoint (e.g., `GET /api/v1/user/get-profile?userId=...`) on the main monolith so the NutriScan Node.js backend can perform an asynchronous, parallel `fetch()` for this context immediately before executing the standard AI prompt.

---

## 2. CI/CD Cloud Run Deployment Pipeline

**Context:** The API's architecture is now perfectly serverless, connecting flawlessly to Google Cloud Firestore via the zero-setup Firebase Admin SDK. It is ready for production.

**Deferred Implementation Tasks:**
- [ ] Outline the exact Docker containerization parameters utilizing the native `gcloud run deploy` command.
- [ ] Automate zero-downtime serverless container deploys via GitHub Actions `.yml` or `cloudbuild.yaml` so any `push` to `main` updates the live backend seamlessly.



let the system only show alternvatives for the catogry of packed goods & grocrices 
suggest alternvatives on the basis of user profile too - if in active program of gut or simlar cause suggest them a product from the list that matches the user profile - make sure you dont suggest products that the user might be allergic or might have an aversion from. 
secondly the alternvatives when suggested arent visible on the front end


in the pormpt not all products need suggestive alternvative only if the product scores 4 or below then show the alternvatives - 
and use cleavr prompt stragtegies so that the input prompt and output prompt tokens can be reduced by 15% without the system loosing accuracy and effiecny for the alternvative suggestions - i need it to be removed completly - and only show suggestive alternavtives for products that match the product type from the balance nutrition SHOP - https://shop.balancenutrition.in/products