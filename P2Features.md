# NutriScan Phase 2 Features

> Status: Product ideation and build brief  
> Goal: Evolve NutriScan from three scan utilities into a fully working, multi-screen BN Life application experience.

---

## 1. Product Direction

Phase 1 proves the clinical AI engine across three modes:

- Bill / Receipt Scan
- Menu Scan
- Plate Scan / Log Meal

Phase 2 should turn these into everyday user journeys inside BN Life. The scan should not stop at "analysis"; it should help the user decide what to cook, what to buy, what to order, how to log it, and how to improve their weekly pattern.

The core shift:

| Phase 1 | Phase 2 |
|---|---|
| Scan and score | Scan, decide, act, and learn |
| Single result screen | Multi-screen journeys |
| One-time analysis | Saved history, recall, reports, nudges |
| Nutrition-only output | Nutrition + budget + shopping + habits |
| User opens scanner manually | App can proactively suggest scan/log moments |

---

## 2. Product Principles

1. Every scan must create a next best action.
2. Personalization must use the user's profile, allergies, aversions, diet plan, goals, and remaining macros.
3. Bad choices should be converted into useful actions, not guilt.
4. Shopping and meal decisions should connect to budget, macros, taste, and convenience.
5. User corrections must improve future outputs. Active Feedback Loop.
6. The app should feel like BN Life, not a disconnected NutriScan tool.

---

## 3. Proposed BN Life App Structure

### 3.1 Primary Navigation

| Tab | Purpose |
|---|---|
| Home | Daily macro status, next meal suggestion, recent scans, smart nudges |
| Scan | Entry point for Bill Scan, Menu Scan, Plate Scan, voice log, text log, recipe link |
| Cart | Smart grocery cart, price comparison, ingredient substitutions, weekly grocery list |
| Reports | Shopping reports, food recall, food frequency, weekly eating patterns |
| Profile | Goals, allergies, aversions, diet plan, preferences, permissions |

### 3.2 Scan Hub

The Scan Hub should expose these actions:

- Scan Bill
- Scan Menu
- Scan Plate
- Log by Voice
- Log by Text
- Paste Recipe Link
- Import Recent Food Photos

Each scan mode remains independent, but all results flow into the same user timeline, macro dashboard, habit reports, and BN nutritionist review layer.

---

## 4. Bill Scan Phase 2

Bill Scan should become a standalone feature area, not just a receipt result page. It should help the user understand what they bought, what was risky, what they can cook with it, where they could buy it cheaper next time, and how the purchase affects weekly habits.

### 4.1 Feature: Turn Bad Purchases Into Healthy Meals

#### User Problem

After a bill is scanned, users may see products with low health scores but may not know what to do with them. Instead of only warning the user, NutriScan should help convert those purchases into a healthier meal.

#### Feature Concept

For every scanned product scoring below 5, show a small action button:

`Make Healthy Meal`

When tapped, the app creates a healthy recipe using the low-scoring product or its ingredients, while balancing the user's profile and remaining macros for the day.

#### Example

If the user bought processed noodles, sugary cereal, or high-fat paneer spread, the app can suggest:

- A higher-protein version
- A portion-controlled meal
- Ingredient swaps
- Add-ons that improve fiber, protein, and micronutrients
- How much of the purchased item can safely fit into today's macro budget

#### Inputs

- Scanned bill items
- Items with score below 5
- Ingredient list, if available
- User profile
- Allergies and aversions
- Active diet plan
- Today's consumed macros
- Today's remaining macro budget
- Meal time

#### Output

- Recipe name
- Why it works for the user
- Ingredients from the bill
- Additional ingredients needed
- Allergy-safe substitutions
- Serving size
- Calories, protein, carbs, fat, fiber
- Fit against today's remaining macros
- Prep time
- Difficulty
- CTA: Add missing ingredients to cart
- CTA: Log this meal

#### Result Screen Module

On the Bill Result screen, low-score items should display:

- Health score
- Reason for poor score
- "Make Healthy Meal" button
- "Find Better Alternative" button
- "Compare Price" button

---

### 4.2 Feature: Cheapest Price Finder and Smart Cart

#### User Problem

Users want to know whether they overpaid and where they can buy the same or healthier alternative at the lowest price.

#### Feature Concept

After scanning a bill, NutriScan extracts purchased products and compares prices across supported grocery partners or catalog sources. The app shows the cheapest available option and allows the user to add it directly to a shopping cart.

#### Scope

- Match scanned product to normalized product catalog
- Detect pack size, quantity, brand, and variant
- Compare price per unit, not only MRP
- Show cheaper alternatives with better health scores
- Add selected item to cart
- Preserve store preference and delivery availability

#### Output

| Field | Description |
|---|---|
| Current paid price | Price from scanned bill |
| Best available price | Lowest matched price |
| Savings | Difference between paid and available price |
| Health score | NutriScan score for current product |
| Better alternative | Similar product with better health score |
| Price per unit | Fair comparison across pack sizes |
| Store | Grocery partner or source |
| CTA | Add to Cart |

#### Important Logic

The cheapest product should not automatically be the recommended product if it is unhealthy or conflicts with the user's profile. Ranking should balance:

- Health score
- Price
- User allergies
- Taste aversions
- Diet plan compatibility
- Delivery availability
- Brand preference

---

### 4.3 Feature: Smart Shopping Report

#### User Problem

Users do not only need item-level feedback; they need to understand weekly shopping habits and spending patterns.

#### Feature Concept

Generate a weekly report that analyzes what the user bought, when they bought it, how much they spent, which categories dominate their basket, and how these purchases map to eating behavior and macro goals.

#### Report Sections

1. Weekly spend summary
2. Category split
3. Healthy vs risky purchase ratio
4. Processed food spend
5. Protein-supporting purchases
6. Fiber and produce coverage
7. Sugar and snack exposure
8. Shopping day and time pattern
9. Impulse purchase detection
10. Suggested optimizations for next week

#### Behavioral Analysis

The report should answer:

- What time of day does the user usually shop?
- Which day of the week has the highest spend?
- Does late-night shopping correlate with more low-score items?
- Are weekends causing higher snack/sugar purchases?
- Is the user buying enough protein for the week?
- Is the user spending too much on low-nutrition products?
- What would be a better weekly basket?

#### Output Formats

- In-app report card
- Shareable PDF for BN nutritionist review
- Smart grocery list for next week
- Budget recommendation

---

### 4.4 Feature: Smart Quick Prompts for Shopping Intelligence

#### User Problem

Users may not know what to ask, but they want quick answers around macros, budgeting, meal prep, and groceries.

#### Feature Concept

Add smart prompt chips after Bill Scan and inside Reports.

#### Prompt Examples

- "Create my weekly shopping report"
- "How much protein did this bill support?"
- "What should I avoid buying again?"
- "Build a budget grocery list for next week"
- "Convert this bill into a 3-day meal prep plan"
- "Which items are not matching my diet plan?"
- "What groceries do I still need for the week?"
- "Show healthier swaps under the same budget"
- "Which items should I add for breakfast?"
- "Can I make dinner from this bill?"

#### Output Types

- Shopping report
- Macro report
- Budget plan
- Meal prep plan
- Missing grocery list
- Product swap list
- Nutritionist-ready summary

---

### 4.5 Feature: Recipe Link to Smart Cart

#### User Problem

Users discover recipes on Instagram, YouTube, blogs, and external sites, but manually converting them into allergy-safe, goal-matched shopping lists is tedious.

#### Feature Concept

User pastes a recipe link. NutriScan extracts ingredients, understands the recipe, checks it against the user's allergies, aversions, diet plan, and macro goals, then creates a smart shopping cart.

#### Supported Sources

- Instagram recipe links
- YouTube recipe links
- Blog URLs
- Text recipe links
- Shared recipe captions

#### Flow

1. User taps `Paste Recipe Link`.
2. User enters Instagram, YouTube, or external URL.
3. System extracts title, ingredients, serving size, method, and nutrition estimate.
4. System flags unsafe or unsuitable ingredients.
5. System suggests alternatives.
6. User confirms the adjusted recipe.
7. System creates a shopping cart.
8. User can add all ingredients or only missing ingredients.

#### Personalization Rules

- Allergy conflicts must block the ingredient and force alternatives.
- Taste aversions should be substituted or hidden by default.
- Diet plan conflicts should be explained clearly.
- Macro fit should be calculated per serving.
- The app should suggest portion changes when the recipe can fit with small adjustments.

---

## 5. Menu Scan Phase 2

Menu Scan should become an intelligent restaurant decision layer. It should support multi-page menus, dish scoring, taste-aware ranking, location-triggered check-ins, and direct meal logging.

### 5.1 Feature: Multi-Image Menu Scan

#### User Problem

Restaurant menus are often multiple pages. A single photo may miss important dishes.

#### Feature Concept

Allow the user to capture or upload multiple menu images in one session. The system combines all menu pages, deduplicates dishes, and scores each dish for the user's profile.

#### Flow

1. User selects `Scan Menu`.
2. User captures page 1.
3. User can add more pages.
4. App shows captured page thumbnails.
5. User taps `Analyze Menu`.
6. AI extracts all dishes and groups them by section.
7. System scores every dish.
8. Top dishes appear first.

#### Output

- Dish name
- Menu section
- Estimated macros
- Health score
- Taste confidence
- Diet fit
- Allergy and aversion flags
- Portion guidance
- Best time to eat
- CTA: Add to Meal Log

---

### 5.2 Feature: Personalized Dish Ranking

#### User Problem

Users do not only want the healthiest dish. They want the best dish that fits their goals and still feels enjoyable.

#### Feature Concept

Rank dishes using a combined score:

`Final Dish Score = Health Fit + Goal Fit + Macro Fit + Allergy Safety + Taste Appeal + Portion Practicality`

#### Ranking Labels

- Best Fit
- High Protein Pick
- Light Option
- Treat Allowed
- Avoid Today
- Needs Portion Control
- Allergy Risk
- Diet Plan Match

#### Result Experience

The user should be able to:

- View top dishes
- Filter by vegetarian/non-vegetarian
- Filter by high protein, low calorie, low carb, or dessert
- Compare two dishes
- Select a dish
- Adjust portion
- Add directly to meal log

---

### 5.3 Feature: Restaurant Check-In Nudges

#### User Problem

Users may enter a restaurant and forget to use Menu Scan before ordering.

#### Feature Concept

With location permission, the app detects when the user enters or stays near a restaurant and sends a contextual check-in notification.

#### Example Notification

"Entering RamNivas? You have room for a dessert today. Try dessert after adding around 26g protein first."

#### Inputs

- User location
- Restaurant name
- Known popular dishes, if available
- Today's remaining macros
- Time of day
- Diet plan
- Scan history
- User preferences

#### Guardrails

- Requires explicit location permission.
- Should not send too many notifications.
- Should avoid sensitive or judgmental language.
- Should allow the user to turn restaurant nudges off.
- Should only fire when confidence is high that the user is at a food place.

#### Notification Types

- "Want to scan this menu?"
- "You have protein left for today."
- "This place is known for dessert; you can fit it if dinner stays light."
- "You are close to your calorie limit; choose a lighter option."
- "Your plan suggests a high-protein dinner today."

---

## 6. Plate Scan Phase 2

Plate Scan should become the user's food memory layer. It should support editable AI outputs, photo-backed logging, voice/text logging, food recall, food frequency, and optional photo-gallery detection.

### 6.1 Feature: Editable Plate Scan Results

#### User Problem

AI output may be close but not perfect. Users need to edit dish name, portion, serving size, and macros before saving.

#### Feature Concept

After Plate Scan, show an editable result screen.

#### Editable Fields

- Dish name
- Meal time
- Meal type
- Food components
- Portion size
- Household serving unit
- Calories
- Protein
- Carbs
- Fat
- Fiber
- Notes

#### Serving Unit Examples

- 1 spoon
- 3 spoons
- 1 bite
- 3 bites
- 1 bowl
- 1 katori
- Half plate
- Full plate
- 1 glass
- 1 slice

#### UX Requirement

The app should show the scanned picture beside the result so the user can visually confirm what was logged.

---

### 6.2 Feature: Voice and Text Meal Logging

#### User Problem

The user may not always have a food photo, but still needs to log a meal quickly.

#### Feature Concept

Add non-photo logging options:

- Voice: "I had a Veggie Delite Subway at 4 PM."
- Text: "I had poha and tea for breakfast."

#### Output

The system parses:

- Dish name
- Meal time
- Meal type
- Brand or restaurant, if mentioned
- Portion estimate
- Macro estimate
- Confidence
- Ask-back question if confidence is low

#### Result

The user reviews and saves the log just like a Plate Scan.

---

### 6.3 Feature: Photo-Backed Food Recall

#### User Problem

Users often forget what they ate, but photos can help them recall meals.

#### Feature Concept

Every Plate Scan result should save the original picture with the meal log. Over time, the app creates a visual food recall and food frequency report.

#### Data Saved

- Image URL or secure storage reference
- Dish name
- Meal time
- Meal type
- Macros
- Portion
- User corrections
- Confidence
- Location, if allowed
- Source: camera, gallery, auto-detected, voice, text

#### Reports Enabled

- Food recall by day
- Food recall by week
- Most repeated dishes
- Most repeated restaurants
- Meal skipped patterns
- Protein frequency
- Snack frequency
- Late-night eating pattern
- Photo timeline

---

### 6.4 Feature: Automatic Recent Food Photo Detection

#### User Problem

Users may photograph food but forget to open BN Life or NutriScan to log it.

#### Feature Concept

With gallery permission, the app can detect likely food photos from the last 24 hours and suggest importing them into the meal log.

#### Flow

1. User grants gallery access.
2. App scans recent photos from the last 24 hours.
3. System identifies likely food photos.
4. App uses photo metadata to estimate meal time.
5. User receives a prompt: "Log this meal?"
6. User reviews and confirms.

#### Important Constraints

- The app should not upload all gallery photos.
- Food detection should happen locally first where possible.
- User should approve before saving a detected photo as a meal log.
- The user must be able to disable this feature.
- Metadata should be used only for meal-time estimation and reporting.

---

## 7. Unified Smart Reports

Phase 2 should introduce reports that combine Bill Scan, Menu Scan, Plate Scan, voice logs, text logs, and recipe carts.

### 7.1 Weekly Health and Shopping Report

#### Sections

- Total grocery spend
- Spend by category
- Average health score of purchased products
- Low-score product count
- Healthy swaps accepted
- Restaurant meals logged
- Home-cooked meals logged
- Macro adherence
- Protein target consistency
- Sugar/snack pattern
- Late meal pattern
- Budget optimization tips
- Next week's grocery suggestions

### 7.2 Food Frequency Report

#### Sections

- Most consumed foods
- Most repeated cuisines
- Repeated low-score foods
- Protein sources frequency
- Fiber-rich foods frequency
- Restaurant frequency
- Packaged food frequency
- Photo-based recall timeline

### 7.3 Nutritionist Review Summary

For BN nutritionists, the app can produce a concise summary:

- What the user bought
- What the user ate
- Where the user deviated
- What macro gaps repeated
- Which foods caused allergy or aversion conflicts
- What coaching note should be sent

---

## 8. Data Model Extensions

### 8.1 Core Collections

| Collection | Purpose |
|---|---|
| users | Profile, goals, allergies, aversions, diet plan links |
| scans | Raw scan sessions across all modes |
| bill_items | Extracted bill products and scores |
| product_prices | Price comparison results |
| carts | Smart carts and grocery lists |
| recipes | Generated recipes and imported recipe links |
| menu_sessions | Multi-image restaurant menu scans |
| menu_dishes | Extracted and scored dishes |
| meal_logs | Saved plate, voice, text, and menu logs |
| media_assets | Meal photos and scan images |
| reports | Generated weekly reports |
| nudges | Notification candidates and delivery history |

### 8.2 Shared Fields

All scan-derived records should include:

- userId
- sourceMode
- createdAt
- localTime
- timezone
- confidence
- healthScore
- allergyFlags
- aversionFlags
- dietPlanMatch
- macros
- userCorrections
- savedToHistory

---

## 9. API and Service Additions

### 9.1 Suggested Endpoints

| Endpoint | Purpose |
|---|---|
| POST /api/v2/bills/analyze | Analyze bill and create product-level results |
| POST /api/v2/bills/healthy-recipe | Generate recipe from low-score bill items |
| POST /api/v2/products/compare-price | Compare scanned product prices |
| POST /api/v2/cart/add | Add product or ingredient to smart cart |
| POST /api/v2/reports/shopping | Generate weekly shopping report |
| POST /api/v2/recipe-link/analyze | Analyze Instagram, YouTube, or external recipe link |
| POST /api/v2/menus/analyze | Analyze multi-image menu session |
| POST /api/v2/menus/dish-log | Save selected dish to meal log |
| POST /api/v2/meals/plate/analyze | Analyze plate image |
| PATCH /api/v2/meals/:mealId | Edit meal log output |
| POST /api/v2/meals/voice | Parse voice meal log |
| POST /api/v2/meals/text | Parse text meal log |
| POST /api/v2/gallery/food-candidates | Detect recent food photo candidates |
| POST /api/v2/nudges/restaurant | Create location-based restaurant nudge |

### 9.2 AI Services

| Service | Responsibility |
|---|---|
| Bill Intelligence | OCR, product scoring, category classification |
| Recipe Builder | Healthy recipe generation from purchased items |
| Price Matcher | Product normalization and price comparison |
| Cart Builder | Grocery cart creation and substitutions |
| Menu Intelligence | Multi-image menu extraction and dish scoring |
| Meal Logger | Plate, voice, and text log parsing |
| Report Generator | Weekly behavior and shopping insights |
| Nudge Engine | Restaurant and meal-time notification decisions |

---

## 10. Permission and Privacy Requirements

Phase 2 introduces sensitive user data, so permissions must be explicit and reversible.

| Permission | Used For | Requirement |
|---|---|---|
| Camera | Scan bill, menu, plate | Required only when scanning |
| Gallery | Import food photos | User opt-in |
| Location | Restaurant check-in nudges | User opt-in with clear explanation |
| Notifications | Meal and restaurant nudges | User opt-in |
| Microphone | Voice meal logging | User opt-in |

Privacy expectations:

- Do not upload unrelated gallery photos.
- Let users delete meal photos and scan history.
- Store allergy and health profile data securely.
- Show why a notification was triggered.
- Allow users to disable each smart feature independently.

---

## 11. Phase 2 Build Priority

### P2.1: Core Multi-Screen App Mock

Build the BN Life-style shell and connect existing NutriScan modes.

- Home
- Scan Hub
- Bill Scan result screen
- Menu Scan result screen
- Plate Scan editable result screen
- Meal log history
- Profile and permissions

### P2.2: Bill Scan Action Layer

- Low-score product actions
- Healthy recipe from bad purchase
- Add missing ingredients to cart
- Basic smart shopping report
- Quick prompt chips

### P2.3: Menu Scan Intelligence

- Multi-image capture
- Dish extraction and scoring
- Personalized ranking
- Add selected dish to meal log
- Restaurant nudge prototype

### P2.4: Plate Scan Memory Layer

- Editable output
- Voice logging
- Text logging
- Photo-backed meal history
- Food recall and frequency report

### P2.5: Commerce and Recipe Link Layer

- Price comparison
- Smart cart
- Recipe link parsing
- Ingredient substitutions
- Cheapest healthy alternatives

---

## 12. Acceptance Criteria

### Bill Scan

- User can scan a bill and view all products.
- Products below score 5 show action buttons.
- User can generate a healthy recipe from low-score products.
- Recipe respects allergies, aversions, profile, and remaining macros.
- User can add missing ingredients to cart.
- User can generate a weekly shopping report.

### Menu Scan

- User can upload multiple menu photos in one session.
- System returns scored dishes, not just raw OCR.
- User can view top recommended dishes.
- User can select a dish and save it to meal log.
- Location nudge can suggest Menu Scan when restaurant context is detected.

### Plate Scan

- User can edit AI output before saving.
- User can log by photo, voice, or text.
- Meal photo appears on result and history screens.
- Saved meals support food recall and frequency reports.
- Recent food photo import works only with user permission.

### Reports

- Weekly reports combine shopping, meals, macros, and behavior.
- Reports include actionable improvements, not only charts.
- Nutritionists can view or receive a summary.

---

## 13. Key Metrics

| Metric | Why It Matters |
|---|---|
| Scan-to-action rate | Measures whether users act after analysis |
| Low-score recipe generation rate | Measures usefulness of bad-purchase recovery |
| Cart add rate | Measures commerce value |
| Meal log completion rate | Measures logging friction |
| User correction rate | Measures AI output quality |
| Weekly report views | Measures habit insight value |
| Healthy swap acceptance | Measures behavior change |
| Notification opt-out rate | Measures nudge quality |
| Repeat weekly active users | Measures BN Life stickiness |

---

## 14. Open Product Questions

1. Which grocery partners or catalogs will support price comparison?
2. Should cart checkout happen inside BN Life or redirect to partner apps?
3. How much of Instagram/YouTube recipe extraction is technically allowed by source terms?
4. Should recipe link parsing support manual caption paste as fallback?
5. Should restaurant location nudges be built for the mock only or production-ready?
6. Should nutritionists approve weekly reports before users receive them?
7. What is the minimum profile data required before personalized recommendations can be shown?
8. Should photo-gallery detection run locally first, or server-side only after user approval?
9. How long should meal photos and bill images be retained?
10. Should user edits feed a personalization model or only update the saved log?

---

## 15. Suggested MVP Demo Narrative

The strongest Phase 2 demo can show one connected day:

1. User opens BN Life and sees remaining macros.
2. User scans a grocery bill.
3. A low-score product appears.
4. User taps `Make Healthy Meal`.
5. App creates a recipe that fits today's macros.
6. Missing ingredients are added to cart.
7. Later, user enters a restaurant and receives a menu scan nudge.
8. User scans multiple menu pages.
9. App ranks dishes and lets user log the selected dish.
10. At dinner, user logs a plate photo and edits serving size.
11. Weekly report shows spend, shopping habits, meal patterns, and improvements.

This demonstrates NutriScan as an intelligent BN Life companion: scan, shop, eat, log, learn.
