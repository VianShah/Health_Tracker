/**
 * services.js — Unitary Business Logic for NutriScan AI
 * 
 * Consolidates AI Client, Prompt Engine, Schema, and Validators.
 * Optimized for Gemini 2.0 Flash Thinking with 1080 tokens.
 */

import { generateObject, streamObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import crypto from 'crypto';

// ── AI PROVIDER CONFIG ───────────────────────────────────────────────────────

const googleProvider = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.API_KEY || '',
});

const openaiProvider = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
});

const PROVIDER = process.env.AI_PROVIDER || 'google';
const MODEL_NAME = PROVIDER === 'openai' ? 'gpt-4o' : 'gemini-2.5-flash';

function getModel(thinkingTokens = 0) {
    if (PROVIDER === 'openai') return openaiProvider(MODEL_NAME);

    const options = {};
    if (thinkingTokens > 0) {
        options.maxThinkingTokens = thinkingTokens;
    }

    return googleProvider(MODEL_NAME, options);
}

// ── SCHEMA DEFINITIONS ───────────────────────────────────────────────────────

const MacrosSchema = z.object({
    calories: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
});

// Full schema for RECEIPT and PLATE scans
const AnalysisResultSchema = z.object({
    restaurantName: z.string().optional(),
    type: z.string().describe("One of: RECEIPT, MENU, PLATE"),
    items: z.array(z.object({
        name: z.string(),
        quantity: z.string().optional().describe("Realistic serving size using common household metrics (e.g., '2 katori/bowl', '3 chapatis', '1 tablespoon')"),
        macros: MacrosSchema,
        confidence: z.number().min(0).max(100).describe("Confidence [0-100]. If <50, macros are zeroed. Use integers."),
        possibleItems: z.array(z.string()).optional().describe("If confidence < 50, list 2-4 likely food names the item could be, for user disambiguation"),
        keyNutrients: z.array(z.object({
            label: z.string(),
            value: z.string(),
            isHigh: z.boolean().optional(),
        })).optional(),
        score: z.number().min(0).max(10).describe("Health score: 0 for allergies/conflicts. 1-10 otherwise."),
        isNonFood: z.boolean().optional().describe("Set to true if the item is not meant for ingestion (e.g., shampoo, wax). Omit if false."),
        isUnplanned: z.boolean().optional().describe("For PLATE scans, set to true if NOT in diet plan. For others, omit."),
        complianceReason: z.string().optional().describe("For PLATE scans, explain Plan/Unplanned status. For others, omit."),
        lifestyleCategory: z.enum(["Packaged Goods", "Sweets/Candies", "Superfoods", "Daily Groceries", "Proteins", "Others"]).describe("Mandatory classification: 'Packaged Goods' (snacks/processed), 'Sweets/Candies' (desserts), 'Superfoods' (seeds/immunity), 'Daily Groceries' (fresh veg/fruit/staples), 'Proteins' (meat/eggs/tofu/legumes), or 'Others'."),
        reason: z.string().optional().describe("Friendly expert feedback. For scores > 5, provide exactly ONE LINE (MAX 15 words). For scores <= 6, provide detailed clinical feedback."),
        alternatives: z.array(z.string()).optional().describe("Provide 1 to 3 alternatives ONLY if score is 4 or below. If <expected_diet_plan> is given, pick 1-2 role-matching dishes from the plan and inject 'Expected: [Dish]'. CRITICAL: Do NOT suggest the exact same alternatives for different items in the same scan. Provide unique, specific matches. Omit if score >= 5."),
    })),
    healthScore: z.number().min(0).max(10).describe("The average of all item scores (0-10)"),
    mentorsNote: z.string().optional().describe("If a diet plan was provided, summarize overall compliance (MAX 60 WORDS). Leave empty if no diet plan."),
    summary: z.string().describe("Clinical audit summary of entire scan (STRICTLY MAX 60 WORDS)."),
});

// Lean schema for MENU scans — drops totalMacros, keyNutrients, confidence, alternatives to save tokens
const MenuAnalysisResultSchema = z.object({
    restaurantName: z.string().optional(),
    type: z.string().describe("Must be: MENU"),
    items: z.array(z.object({
        name: z.string(),
        quantity: z.string().describe("Narrative household instruction, e.g. '4 spoons of dal (approx 100g) = 8g protein, good for Lunch'"),
        macros: MacrosSchema,
        score: z.number().min(0).max(10),
        reason: z.string().optional().describe("Friendly expert feedback. For scores > 5, provide exactly ONE LINE (MAX 15 words). For scores <= 6, provide detailed clinical feedback."),
        alternatives: z.array(z.string()).optional().describe("If the item is a conflict or score <= 4, suggest 2-3 specific healthier choices from the menu. Omit if score >= 5."),
    })),
    healthScore: z.number().min(0).max(10),
    summary: z.string().describe("Concise audit summary (STRICTLY MAX 60 WORDS)."),
});


// ── PROMPT ENGINE ────────────────────────────────────────────────────────────

function getClientProfileContext(profile) {
    const allergiesStr = (profile.allergies && profile.allergies.length > 0) ? (Array.isArray(profile.allergies) ? profile.allergies.join(', ') : profile.allergies) : 'None';
    const aversionsStr = (profile.aversions && profile.aversions.length > 0) ? (Array.isArray(profile.aversions) ? profile.aversions.join(', ') : profile.aversions) : 'None';
    const dietPrefsStr = (profile.dietPreference && profile.dietPreference.length > 0) ? (Array.isArray(profile.dietPreference) ? profile.dietPreference.join(', ') : profile.dietPreference) : 'None specified';
    const weightDelta = profile.currentWeight && profile.weightGoal ? (parseFloat(profile.currentWeight) - parseFloat(profile.weightGoal)).toFixed(1) : '0';

    return `CLIENT CLINICAL PROFILE:
1. Name: ${profile.name || 'User'}
2. Gender: ${profile.gender || 'Unknown'}
3. Age: ${profile.age || 'Unknown'}
4. Height: ${profile.height || 'Unknown'}
5. Eating Habit: ${profile.eatingHabit || 'Standard'}
6. Active Program: ${profile.program || 'General Health'}
7. Health Goal: ${profile.healthGoal || 'No specific goal'}
8. Current State: ${profile.state || 'Maintenance'}
9. Current Weight: ${profile.currentWeight || '?'}kg → Goal: ${profile.weightGoal || '?'}kg (Delta: ${weightDelta}kg)
10. Clinical Allergies: ${allergiesStr}
11. Taste Aversions: ${aversionsStr}
12. Diet Preferences: ${dietPrefsStr}

EATING HABIT DEFINITIONS:
- Veg: Strictly no meat, no fish, or no eggs.
- Ovo-Veg: Allows Eggs, but strictly no Meat and no Fish
- Vegan: Strictly no meat, no fish, no eggs, no dairy, or any animal products.
- Pescatarian: Allows Fish and Veg dishes, but strictly no Meat (chicken, mutton, beef, etc).
- Non-Veg: All allowed.

SCORING RULES — MANDATORY:
1. Assign every item a 'score' between 1 and 10. NEVER assign 0.
   - [8-10]: BEST choices (Optimal nutritional fit).
   - [6-8]: GOOD choices (Standard healthy choice).
   - [4-6]: FAIR / OCCASIONAL choices (Acceptable but not ideal).
   - [1-3]: BAD choices (High sugar, processed, or health risk).
2. The 'reason' field MUST be concise expert feedback. Focus on identifying and physiological impact.
   - Use "you" and "your body". Focus on the 'Why' in STRICTLY MAX 20 WORDS.
   - DO NOT mention technical codes or parameter names.
   - Keep each reason extremely direct. Skip all floral language.
3. CONFLICT & CLINICAL RISK HANDLING:
   - You MUST strictly check for: core health goals (${profile.program}), allergies (${allergiesStr}), aversions (${aversionsStr}), eating habit (${profile.eatingHabit}), and medical profile details.
   - If an item scores 4 OR BELOW, you MUST address it with empathetic expert feedback.
   - For all items with a score of 4 OR BELOW, you MUST provide exactly 2-3 SUGGESTIVE ALTERNATIVES that solve a similar purpose (e.g., a savory snack should be replaced by a healthier savory snack).
   - DO NOT provide alternatives if the score is 5 or above. Omit the alternatives array entirely.
   - Output ONLY the names (e.g., "Roasted Makhana", "Greek Yogurt"). No descriptions or fillers.
   - RESPECT the client's medical profile (allergies, aversions, health goals). Do not suggest conflicts.
4. The 'healthScore' MUST be the mathematical average of all item scores, rounded to 1 decimal.
5. The 'summary' field MUST be a precise clinical audit summary (STRICTLY MAXIMUM 50 WORDS).
   - Address the user's focus program (${profile.program}) and overall health trends with thier goal weight (${profile.weightGoal}).
   - End with 1 clear, actionable 'Pro Tip'. Skip all filler text or generic praise.
6. CLINICAL PRECISION (CAUTIOUS ESTIMATION): For every item, decompose it into its likely ingredients. Estimate macros based on these ingredients and common portion weights. IMPORTANT: Always adopt a 'Lower-End Approximation' strategy. For example, if a dish could plausibly contain 15g of protein, estimate it at 12-13g instead. This ensures the user is not over-relying on a single meal's contribution to their daily goals.
7. REAL ZEROES: Items like water, spices, or diet sodas should correctly have 0 calories. Do not use placeholder defaults.
8. OPTIONAL REASON: Only provide a 'reason' if there's a specific insight or corrective feedback (especially for scores <= 7). If an item is a standard healthy choice (8+) and has no clinical drawbacks, omit the 'reason' entirely.
9. Maintain the specified JSON schema. Every item MUST have a score and macros. Use 0 ONLY if the item naturally lacks that macro. Always round final macro values DOWN to the nearest whole number.`;
}

// ── 1. RECEIPT PROMPT ──
function buildReceiptPrompt(profile) {
    return `
You are the "Balance Nutrition AI Auditor" — a senior clinical nutritionist reviewing a printed RECEIPT.

Your primary goal is to accurately identify all valid food and beverage items on the receipt and evaluate their nutritional quality against the client's profile.
Do not extract taxes, tips, or non-food items unless they look like accidental food identifications.
CRITICAL: If an item is NOT food (e.g. soap, electronics, cosmetics), set 'isNonFood' to true, 'score' to 0, and 'alternatives' to [].

CATEGORIZATION RULES:
- Packaged Goods: Boxed snacks, frozen meals, canned items, processed chips, sauces.
- Sweets/Candies: All sugar-heavy items, desserts, chocolates, ice creams, candies.
- Superfoods: Immunity boosters, walnuts, almonds, flax seeds, chia seeds, berries, sprouts, greens.
- Daily Groceries: Fresh vegetables, fruits, staples (rice/wheat), pulses, grains, dairy basics (milk/curd).
- Proteins: All lean and processed meats (chicken, fish, mutton), eggs, protein supplements/isolates, tofu.
- Others: Items that don't clearly fall into the above clinical categories.


${getClientProfileContext(profile)}
`.trim();
}

// ── 2. MENU PROMPT ──
function buildMenuPrompt(profile, localTime, askDiet, explicitMealType, deviceHour) {
    // Auto-derive meal type from server time — always accurate
    let mealType = explicitMealType;
    if (!mealType || mealType === 'Auto') {
        const hour = deviceHour !== undefined ? deviceHour : new Date(localTime || new Date().toISOString()).getHours();
        mealType = 'Dinner';
        if (hour >= 5 && hour < 11) mealType = 'Breakfast';
        else if (hour >= 11 && hour < 15) mealType = 'Lunch';
        else if (hour >= 15 && hour < 18) mealType = 'Snack';
    }

    const dateObj = localTime ? new Date(localTime) : new Date();
    const timeStr = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    const dietSection = askDiet ? `
<diet_plan_matching>
  <program>${profile.program || 'General Health'}</program>
  <instruction>You MUST prioritize recommending dishes that strictly match the user's active program. If no perfect match exists on the menu, choose the absolute healthiest available option. Do not be overly restrictive — foods that approximate the plan are acceptable.</instruction>
</diet_plan_matching>` : '';

    return `
  <task>You are auditing an ENTIRE restaurant MENU image. 
  1. SCAN: Read and comprehend every item on the menu from top to bottom.
  2. FILTER: Only after scanning everything, select the 5 most appropriate and healthiest dishes that fit the user's profile and the specific meal time (${mealType}). 
  3. RECOMMEND: For each selection, specify the exact portion and household serving instructions.</task>
</system>

<scan_context>
  <scan_time>${timeStr}</scan_time>
  <meal_type>${mealType}</meal_type>
  <instruction>Base your calorie budget and portion sizes entirely on the meal type (${mealType}). A ${mealType} has different caloric needs than other meals. Adjust strictly.</instruction>
</scan_context>
${dietSection}

<portion_rules>
  <rule id="1">SCAN ALL: Read the full menu first. Then, select and list exactly 5 of the most suitable dishes for this user's current meal type. Ensure these 5 choices provide a healthy variety (e.g., salads, light mains, soups) from the available offerings.</rule>
  <rule id="2">For each recommended dish, write the 'quantity' as a friendly, narrative household instruction. Example: "Use 5 spoons of rice (approx 150g) = 3g protein, 12g carbs, 20g fat. Good for your ${mealType}."</rule>
  <rule id="3">Do NOT write '1 serving', '100g', or generic amounts. Instructions must be simple, household-unit based (spoons, katori, chapati, piece, glass).</rule>
  <rule id="4">The 'macros' you estimate must exactly reflect the household quantity you described — not the full dish portion. Always use the LOWER-END of the estimated range (e.g., if a portion has 12-15g protein, state 12g).</rule>
  <rule id="5">Set the 'reason' field to provide friendly clinical feedback on how this choice affects the user's specific health goals. NO numeric parameter codes (P1-P10) in the output.</rule>
  <rule id="6">Do NOT output totalMacros — it is not needed for menu recommendations.</rule>
</portion_rules>

${getClientProfileContext(profile)}
`.trim();
}


// ── 3. MEAL/PLATE PROMPT ──
function buildPlatePrompt(profile, localTime, explicitMealType, deviceHour) {
    let mealType = explicitMealType;
    if (!mealType || mealType === 'Auto') {
        const hour = deviceHour !== undefined ? deviceHour : new Date(localTime || new Date().toISOString()).getHours();
        mealType = 'Dinner';
        if (hour >= 5 && hour < 11) mealType = 'Breakfast';
        else if (hour >= 11 && hour < 15) mealType = 'Lunch';
        else if (hour >= 15 && hour < 18) mealType = 'Snack';
    }

    return `
<system>
  <role>Balance Nutrition AI Auditor — Senior Clinical Nutritionist</role>
  <portion_estimation>
    Photos are usually taken from about 45 degrees so the height of the food is visible, not only its area.
    Use anything of known size in the frame as a scale reference: a spoon or fork (about 17 to 20 cm), a standard dinner plate (about 25 to 27 cm), a steel katori (about 150 ml), a glass, or a hand.
    Judge volume from both spread and height. If no reference is visible, assume a standard dinner plate and say so in the item's quantity (for example "approx. 1 katori").
  </portion_estimation>
  <task>You are analyzing a PHOTOGRAPH of a physical plate of food for the user's ${mealType}. Your goals are: (1) accurately identify each food item, (2) estimate realistic macros from visual cues, and (3) flag uncertainty honestly. **Omit 'isUnplanned' since there is no diet plan to compare against.**</task>
</system>

<identification_rules>
  <rule id="1">Identify every distinct food item visible on the plate. Name each item as specifically as possible (e.g., 'White Basmati Rice' not just 'Rice', 'Paneer Butter Masala' not 'Curry').</rule>
  <rule id="2">Assign a 'confidence' score between 0 and 100 for each item:
    - 90–100: You are visually certain of the identity (clear shape, color, texture match).
    - 65–89: Reasonably confident but some ambiguity exists.
    - Below 65: Uncertain — the item could be one of several things. You MUST populate 'possibleItems' with 2–4 candidate food names the item could plausibly be.</rule>
  <rule id="3">If confidence is below 65, set 'name' to your best guess prefixed with '?' (e.g., '? Palak Paneer or Dal Fry') and populate 'possibleItems' with the candidate names for user disambiguation.</rule>
  <rule id="4">NON-FOOD DETECTION: If the object is clearly NOT food (e.g. a bottle of hair wax, a phone, a shoe), set 'isNonFood' to true, 'score' to 1, 'category' to 'Bad', and explain that it is not edible in 'reason'. Set 'alternatives' to [].</rule>
  <rule id="5">VISUAL FRAME INCLUSION & FOCUS: You MUST only consider food objects that are clearly captured in the frame.
    - Visibility: At least 75% of the object must be visible within the photo boundaries.
    - Main Focus: Only analyze items that are in the primary focus/foreground of the shot. 
    - Exclusions: Do NOT identify or analyze background items, items at a longer distance, or food that is only partially visible (less than 75%). If an item is blurry or in the distance, ignore it entirely.</rule>
</identification_rules>

<macro_grounding_rules>
  <rule id="1">Base ALL macro estimates on the VISIBLE PORTION in the image. Do NOT estimate for a full standard serving if only half is visible.</rule>
  <rule id="2">Use visual volume and density anchors (APPROXIMATE LOWER-END):
    - 1 medium Idli (~50g) ≈ 40 kcal.
    - 1 medium plain Dosa ≈ 100 kcal (Masala Dosa ≈ 240 kcal).
    - 1 medium stuffed Paratha ≈ 230-250 kcal (Aloo/Paneer).
    - 1 katori (~150ml) Poha/Upma ≈ 170 kcal.
    - 1 palm-sized piece of Roti/Chapati ≈ 75-80 kcal.
    - 1 fist-sized mound of Rice (~150g) ≈ 180 kcal.
    - 1 katori Dal (~150ml) ≈ 110-120 kcal.
    - 1 medium Samosa ≈ 190 kcal.
    - 1 Pav (for Pav Bhaji/Vada Pav) ≈ 110 kcal.
    - 1 katori Veg Biryani ≈ 240 kcal.
    - Visible oil film or ghee topping = add 50-70 kcal (5-7g fat).</rule>
  <rule id="3">Identify the 'Quantity' using these household metrics. Do not say '1 serving'. Say '2 medium Idlis', '1 large bowl Poha', etc.</rule>
  <rule id="4">Accuracy Threshold: Your final calorie estimate for the plate should ideally be conservative. If unsure, lean toward the LOWER-END of the plausible range.</rule>
  <rule id="5">Account for the User's Clinical Profile: If they have Diabetes or PCOS, strictly flag high-carb items and adjust the 'score' accordingly.</rule>
</macro_grounding_rules>

${getClientProfileContext(profile)}
`.trim();
}

// ── 3b. CLIENT PLATE PROMPT (with Expected Diet) ──
function buildClientPlatePrompt(profile, expectedDiet, localTime, explicitMealType, deviceHour) {
    let mealType = explicitMealType;
    if (!mealType || mealType === 'Auto') {
        const hour = deviceHour !== undefined ? deviceHour : new Date(localTime).getHours();
        mealType = 'Dinner';
        if (hour >= 5 && hour < 11) mealType = 'Breakfast';
        else if (hour >= 11 && hour < 15) mealType = 'Lunch';
        else if (hour >= 15 && hour < 18) mealType = 'Snack';
    }

    const dateObj = localTime ? new Date(localTime) : new Date();
    const timeStr = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    return `
<system>
  <role>Balance Nutrition AI Auditor — Senior Clinical Nutritionist & Diet Coach</role>
  <portion_estimation>
    Photos are usually taken from about 45 degrees so the height of the food is visible, not only its area.
    Use anything of known size in the frame as a scale reference: a spoon or fork (about 17 to 20 cm), a standard dinner plate (about 25 to 27 cm), a steel katori (about 150 ml), a glass, or a hand.
    Judge volume from both spread and height. If no reference is visible, assume a standard dinner plate and say so in the item's quantity (for example "approx. 1 katori").
  </portion_estimation>
  <task>You are analyzing a PHOTOGRAPH of a physical plate of food for a client's ${mealType}. 
  STRICT PROCESSING ORDER:
  1. IDENTIFY & NAME: Identify every food item with the HIGHEST ACCURACY and HIGH CONFIDENCE. Use texture, shape, and color to give precise names (e.g., 'Aloo Paratha' or 'Sourdough Toast').
  2. COMPARE: ONLY after identifying the item, compare it against the <expected_diet_plan>. 
  3. AUDIT: Categorize as Planned/Unplanned based on the whole-plan matching rule.</task>
</system>

<context>
  <scan_time>${timeStr}</scan_time>
  <meal_type>${mealType}</meal_type>
  <rule id="VISUAL_FOCUS">VISUAL FRAME INCLUSION & FOCUS: You MUST only consider food objects that are clearly captured in the frame.
    - Visibility: At least 75% of the object must be visible within the photo boundaries.
    - Main Focus: Only analyze items that are in the primary focus/foreground of the shot. 
    - Exclusions: Do NOT identify or analyze background items, items at a longer distance, or food that is only partially visible (less than 75%). If an item is blurry or in the distance, ignore it entirely.</rule>
</context>

<expected_diet_plan>
${expectedDiet}
</expected_diet_plan>

NOTE: The expected_diet_plan may contains HTML tags (like <p>, <strong>, etc.). Ignore the tags and focus only on the food names described in the text.


<compliance_rules>
  <rule id="1">STRICT MATCHING: Only mark a dish as 'Planned' (isUnplanned: false) if its name or ingredients are explicitly listed in the <expected_diet_plan>. Just being "healthy", "high-protein", or "vegetarian" is NOT enough to be marked as planned.</rule>
  <rule id="2">TIME AGNOSTIC: If the dish is in the 24-hour cycle of the plan, it's PLANNED (isUnplanned: false), regardless of when it is eaten.</rule>
  <rule id="3">If a dish is healthy but NOT in the plan, you MUST set 'isUnplanned' to true AND explain why in 'complianceReason'. This ensures healthy items aren't accidentally tagged as planned.</rule>
  <rule id="4">The 'mentorsNote' field MUST contain an overall 1-2 sentence summary of diet compliance.</rule>
  <rule id="5">EXPECTED DISH ALTERNATIVE: For ANY item that is 'isUnplanned: true' or scores 4 or below, populate the 'alternatives' array by picking 1 or 2 specific replacement dishes from the <expected_diet_plan> that STRICTLY MATCH THE FOOD TYPE AND CULINARY ROLE of the scanned item. For example, if they eat a flatbread or bread (like Naan), you MUST suggest the specific flatbread/grain from the plan (like Millet Roti or Rice). If they eat a sweet, suggest the plan's fruit/dessert. DO NOT suggest completely different food types (e.g., do not suggest sprouts or dosa to replace Naan). Since the plan separates options with ' / ', parse those out and pick exactly 1 or 2 distinct items. Prefix each with "Expected: " (e.g., ["Expected: 1 bowl dal tadka"]). CRITICAL: Do NOT repeat the same alternatives for every unplanned item; each item must get its own unique, role-matched replacement. NEVER invent generic alternatives not in the plan.</rule>
</compliance_rules>

<identification_rules>
  <rule id="1">HIGH-CONFIDENCE IDENTIFICATION: Use visual evidence (texture, seasonings, shape, serving style) to identify the dish with high precision (e.g. 'Oats Porridge with Blueberries'). Identify objectively BEFORE checking the diet list to avoid 'forcing' a match incorrectly.</rule>
  <rule id="2">Assign a 'confidence' score between 0 and 100 for each item:
    - 90–100: You are visually certain of the identity.
    - 65–89: Reasonably confident but some ambiguity exists.
    - Below 65: Uncertain — populate 'possibleItems' with 2–4 candidate names.</rule>
  <rule id="3">NON-FOOD DETECTION: If the object is clearly NOT food, set 'isNonFood' to true, 'score' to 1.</rule>
</identification_rules>

<macro_grounding_rules>
  <rule id="1">Base ALL macro estimates on the VISIBLE PORTION in the image.</rule>
  <rule id="2">Use visual volume and density anchors:
    - 1 medium Idli (~50g) ≈ 40-50 kcal.
    - 1 medium plain Dosa ≈ 100-120 kcal (Masala Dosa ≈ 250-300 kcal).
    - 1 palm-sized Roti/Chapati ≈ 80-100 kcal.
    - 1 fist-sized mound of Rice (~150g) ≈ 190-210 kcal.
    - 1 katori Dal (~150ml) ≈ 120-150 kcal.
    - Visible oil film or ghee topping = add 50-90 kcal.</rule>
  <rule id="3">Identify the 'Quantity' using household metrics. Say '2 medium Idlis', not '1 serving'.</rule>
  <rule id="4">Account for the User's Clinical Profile when scoring.</rule>
</macro_grounding_rules>

${getClientProfileContext(profile)}
`.trim();
}

// ── GENERIC FALLBACK ──
function buildGenericPrompt(profile, localTime, deviceHour) {
    const allergiesStr = (profile.allergies && profile.allergies.length > 0) ? profile.allergies.join(', ') : 'None';
    const aversionsStr = (profile.aversions && profile.aversions.length > 0) ? (Array.isArray(profile.aversions) ? profile.aversions.join(', ') : profile.aversions) : 'None';
    const weightDelta = profile.currentWeight && profile.weightGoal ? (parseFloat(profile.currentWeight) - parseFloat(profile.weightGoal)).toFixed(1) : '0';

    let timeContext = 'Time not provided, assume a generic meal.';
    let mealSuggest = '';
    if (localTime || deviceHour !== undefined) {
        const hour = deviceHour !== undefined ? deviceHour : new Date(localTime).getHours();
        if (hour >= 5 && hour < 11) mealSuggest = 'Breakfast';
        else if (hour >= 11 && hour < 15) mealSuggest = 'Lunch';
        else if (hour >= 15 && hour < 18) mealSuggest = 'Snack';
        else mealSuggest = 'Dinner';
        timeContext = `Current User Local Hour: ${hour} (Likely Meal: ${mealSuggest})`;
    }

    const dietPrefsStr = (profile.dietPreference && profile.dietPreference.length > 0) ? (Array.isArray(profile.dietPreference) ? profile.dietPreference.join(', ') : profile.dietPreference) : 'None specified';

    return `
You are the "Balance Nutrition AI Auditor" — a senior clinical nutritionist.

            CONTEXT:
${timeContext}

CLIENT CLINICAL PROFILE:
        1. Name: ${profile.name || 'User'}
        2. Gender: ${profile.gender || 'Unknown'}
        3. Age: ${profile.age || 'Unknown'}
        4. Eating Habit: ${profile.eatingHabit || 'Standard'}
        5. Active Program: ${profile.program || 'General Health'}
        6. Current State: ${profile.state || 'Maintenance'}
        7. Current Weight: ${profile.currentWeight || '?'} kg → Goal: ${profile.weightGoal || '?'} kg(Delta: ${weightDelta}kg)
        8. Clinical Allergies: ${allergiesStr}
        9. Taste Aversions: ${aversionsStr}
        10. Diet Preferences: ${dietPrefsStr}

        `.trim();
}

function getPromptForMode(mode, profile, localTime, deviceHour, askDiet, mealType, expectedDiet) {
    if (mode === 'RECEIPT') return buildReceiptPrompt(profile);
    if (mode === 'MENU') return buildMenuPrompt(profile, localTime, askDiet, mealType, deviceHour);
    if (mode === 'PLATE') {
        if (expectedDiet) return buildClientPlatePrompt(profile, expectedDiet, localTime, mealType, deviceHour);
        return buildPlatePrompt(profile, localTime, mealType, deviceHour);
    }
    return buildGenericPrompt(profile, localTime, deviceHour);
}

// ── BN SHOP PRODUCTS (ALTERNATIVES) ──────────────────────────────────────────

export const BN_SHOP_PRODUCTS = [
    { name: "BN – Healthy Essentials Combo", slug: "bn-healthy-essentials-combo", categories: ["Gluten Free", "Soy Free"], types: ["combo"] },
    { name: "BN – Hot n Tangy Roasted Chana", slug: "bn-hot-n-tangy-roasted-chana", categories: ["Nut Free", "Gluten Free", "Soy Free"], types: ["snack"] },
    { name: "BN – Roasted Makhana (Hot'n'Tangy)", slug: "bn-roasted-makhana-hotntangy", categories: ["Nut Free", "Gluten Free"], types: ["snack"] },
    { name: "BN – Hot n Tangy Seeds", slug: "bn-hot-n-tangy-seeds", categories: ["Nut Free", "Gluten Free"], types: ["snack"] },
    { name: "BN Foxtail Millet", slug: "bn-foxtail-millet", categories: ["Nut Free", "Gluten Free", "Lactose Free", "Soy Free"], types: ["breakfast", "millet"] },
    { name: "BN Kodo Millet", slug: "bn-kodo-millet", categories: ["Nut Free", "Gluten Free", "Lactose Free", "Soy Free"], types: ["breakfast", "millet"] },
    { name: "BN Pearl Millet", slug: "bn-pearl-millet", categories: ["Nut Free", "Gluten Free", "Lactose Free", "Soy Free"], types: ["breakfast", "millet"] },
    { name: "BN Proso Millet", slug: "bn-proso-millet", categories: ["Nut Free", "Gluten Free", "Lactose Free", "Soy Free"], types: ["breakfast", "millet"] },
    { name: "BN Barnyard Millet", slug: "bn-barnyard-millet", categories: ["Nut Free", "Gluten Free", "Lactose Free", "Soy Free"], types: ["breakfast", "millet"] },
    { name: "BN-Mango Cereal", slug: "bn-mango-cereal", categories: ["Soy Free"], types: ["breakfast"] },
    { name: "BN Wood-Pressed Castor Oil", slug: "bn-wood-pressed-castor-oil", categories: ["Gluten Free", "Lactose Free", "Soy Free"], types: ["oil"] },
    { name: "BN-Mango Whey Protein Isolate", slug: "bn-mango-whey-protein-isolate", categories: ["Nut Free", "Soy Free"], types: ["protein"] },
    { name: "BN Wood-Pressed Groundnut Oil", slug: "bn-wood-pressed-groundnut-oil", categories: ["Gluten Free", "Lactose Free", "Soy Free"], types: ["oil"] },
    { name: "BN ProSeed Protein Atta", slug: "bn-proseed-protein-atta", categories: ["Nut Free", "Gluten Free", "Lactose Free", "Soy Free"], types: ["breakfast", "protein"] },
    { name: "BN Rava (Daliya)", slug: "bn-rava-daliya", categories: ["Nut Free", "Gluten Free", "Lactose Free", "Soy Free"], types: ["breakfast"] },
    { name: "BN Barley", slug: "bn-barley", categories: ["Nut Free", "Gluten Free", "Lactose Free", "Soy Free"], types: ["breakfast"] },
    { name: "BN Red Poha", slug: "bn-red-poha", categories: ["Nut Free", "Gluten Free", "Lactose Free", "Soy Free"], types: ["breakfast"] },
    { name: "BN Red Rice", slug: "bn-red-rice", categories: ["Nut Free", "Gluten Free", "Lactose Free", "Soy Free"], types: ["breakfast"] },
    { name: "BN-Millet Chivda", slug: "bn-millet-chivda", categories: ["Gluten Free", "Lactose Free", "Soy Free"], types: ["snack"] },
    { name: "BN-Apple Cinnamon Muesli", slug: "bn-apple-cinnamon-muesli", categories: ["Gluten Free", "Soy Free"], types: ["breakfast"] },
    { name: "BN-Nutty Choco Cereal", slug: "bn-nutty-choco-cereal", categories: ["Gluten Free", "Lactose Free", "Soy Free"], types: ["breakfast"] },
    { name: "BN-Chocolate Whey Protein Isolate", slug: "bn-chocolate-whey-protein-isolate", categories: ["Nut Free", "Gluten Free", "Soy Free"], types: ["protein"] },
    { name: "BN-Pure Whey Protein Isolate", slug: "bn-pure-whey-protein-isolate", categories: ["Nut Free", "Soy Free"], types: ["protein"] },
    { name: "BN-Almond Berry Dessert Cookies", slug: "bn-almond-berry-dessert-cookies", categories: ["Gluten Free", "Lactose Free", "Soy Free"], types: ["cookies"] },
    { name: "BN-Quicky (High Protein Upma)", slug: "bn-quicky-high-protein-upma", categories: ["Gluten Free", "Lactose Free", "Soy Free"], types: ["breakfast", "protein"] },
    { name: "BN-Quicky Upma (Khatta Meetha)", slug: "bn-quicky-upma-khatta-meetha", categories: ["Gluten Free", "Lactose Free", "Soy Free"], types: ["breakfast"] },
    { name: "BN-Dark Chocolate Cookies", slug: "bn-dark-chocolate-cookies", categories: ["Gluten Free", "Lactose Free", "Soy Free"], types: ["cookies"] },
    { name: "BN-Baked Nippat", slug: "bn-baked-nippat", categories: ["Gluten Free", "Lactose Free", "Soy Free"], types: ["snack"] },
    { name: "BN-Makhana Chips", slug: "bn-makhana-chips", categories: ["Gluten Free", "Lactose Free", "Soy Free"], types: ["snack"] },
    { name: "BN – Roasti Jowar Stix (Sour Cream)", slug: "bn-roasti-jowar-stix-sour-cream", categories: ["Gluten Free", "Soy Free"], types: ["snack"] },
    { name: "BN – Roasti Jowar Stix (Tangy Tomato)", slug: "bn-roasti-jowar-stix-tangy-tomato", categories: ["Gluten Free", "Soy Free"], types: ["snack"] },
    { name: "BN-Immunty+Metabolic Boost Combo", slug: "bn-immunty-metabolic-boost-combo", categories: ["Gluten Free", "Soy Free"], types: ["combo"] },
    { name: "BN-Immunty+Gut Rebalance Combo", slug: "bn-immunty-gut-rebalance-combo", categories: ["Gluten Free", "Soy Free"], types: ["combo"] },
    { name: "Gutsy Gut Rebalance", slug: "gutsy-gut-rebalance", categories: ["Gluten Free", "Soy Free"], types: ["combo"] },
    { name: "Gutsy Metabolic Boost", slug: "gutsy-metabolic-boost", categories: ["Gluten Free", "Soy Free"], types: ["combo"] },
    { name: "Gutsy Immunity Defense", slug: "gutsy-immunity-defense", categories: ["Gluten Free", "Soy Free"], types: ["combo"] },
    { name: "BN-Tea-time Munchies Combo", slug: "bn-tea-time-munchies-combo", categories: ["Gluten Free", "Soy Free"], types: ["combo"] },
    { name: "BN-Healthy Breakfast Combo", slug: "bn-healthy-breakfast-combo", categories: ["Gluten Free", "Soy Free"], types: ["combo"] },
    { name: "BN-Sugar Free Cookies Combo", slug: "bn-sugar-free-cookies-combo", categories: ["Gluten Free", "Soy Free"], types: ["combo"] },
    { name: "BN-Sampler Combo", slug: "bn-sampler-combo", categories: ["Gluten Free", "Soy Free"], types: ["combo"], isBNProduct: true },
    { name: "BN-Roasted Jowar Puffs", slug: "bn-roasted-makhana-sour-cream", categories: ["Nut Free", "Gluten Free", "Lactose Free", "Soy Free"], types: ["snack"], isBNProduct: true }
];

export function getBNAlternatives(profile, itemName = '', lifestyleCategory = 'Others', count = 2) {
    // 1. Context & User Profile Extraction
    const nameLower = (itemName || '').toLowerCase();

    // Standardize allergies and aversions to Array of Strings
    const rawAllergies = profile.allergies || [];
    const allergies = (Array.isArray(rawAllergies) ? rawAllergies : [rawAllergies]).map(a => a.toLowerCase());

    const rawAversions = profile.aversions || [];
    const aversions = (Array.isArray(rawAversions) ? rawAversions : [rawAversions]).map(a => a.toLowerCase());

    const activeCatalog = global.shopProductsCache || BN_SHOP_PRODUCTS;
    const itemTokens = nameLower.split(/[\s-]+/);

    // 2. Score Every Product In the Catalog
    let candidates = activeCatalog.map(p => {
        const productTags = (p.categories || []).map(c => c.toLowerCase());
        const productNameLower = p.name.toLowerCase();

        // --- FATAL EXCLUSIONS (Allergies & Taste Aversions) ---
        if (allergies.some(a => a.includes('gluten') || a.includes('celiac')) && !productTags.includes('gluten free')) return null;
        if (allergies.some(a => a.includes('nut') || a.includes('peanut') || a.includes('almond')) && !productTags.includes('nut free')) return null;
        if (allergies.some(a => a.includes('dairy') || a.includes('lactose') || a.includes('milk')) && !productTags.includes('lactose free') && !productTags.includes('dairy free')) return null;
        if (allergies.some(a => a.includes('soy')) && !productTags.includes('soy free')) return null;
        if (aversions.some(av => productNameLower.includes(av))) return null;

        // Exclude functional items (Oils, Combos) unless explicitly referenced
        const isOilOrCombo = (p.types || []).includes('oil') || (p.types || []).includes('combo');
        if (isOilOrCombo && !nameLower.includes('oil') && !nameLower.includes('combo')) return null;

        // --- PREDICTIVE CONTEXT SCORING ---
        let score = 1; // Base score for passing safety checks

        // A. Direct Keyword and Feature Matches (Highest Priority)
        let exactWordMatches = 0;
        itemTokens.forEach(token => {
            if (token.length > 2 && productNameLower.includes(token)) {
                score += 25; // Increased from 15 to 25
                exactWordMatches++;
            }
            if (['sweet', 'biscuit', 'cookie', 'dessert', 'chocolate'].includes(token) && (p.types || []).includes('cookies')) score += 15;
            if (['snack', 'chips', 'fry', 'namkeen', 'puff', 'stix', 'chivda', 'wafer', 'kurkure', 'bhujia', 'farsan'].includes(token) && (p.types || []).includes('snack')) {
                score += 15;
                // Semantic sub-matching: Prefer chip-like BN products for chip/wafer queries
                if (['chips', 'wafer', 'fry', 'kurkure', 'kela', 'banana', 'potato', 'aloo'].includes(token) && 
                    ['chips', 'stix', 'puffs', 'nippat'].some(kw => productNameLower.includes(kw))) {
                    score += 30; // Massive boost for direct texture matches
                }
            }
        });

        // Exponential boost if multiple words match the BN product directly
        if (exactWordMatches > 0) {
            score += (exactWordMatches * 20);
        }

        // B. Target Type Mapping (Semantic Matching)
        let targetType = null;
        if (nameLower.includes('protein') || nameLower.includes('isolate')) targetType = 'protein';
        else if (['snack', 'chip', 'fry', 'namkeen', 'wafer', 'kurkure', 'bhujia', 'farsan'].some(kw => nameLower.includes(kw))) targetType = 'snack';
        else if (['biscuit', 'cookie', 'sweet', 'dessert'].some(kw => nameLower.includes(kw))) targetType = 'cookies';
        else if (['breakfast', 'cereal', 'upma', 'poha', 'oat'].some(kw => nameLower.includes(kw))) targetType = 'breakfast';
        // AI Category mapping backups
        else if (lifestyleCategory === 'Packaged Goods') targetType = 'snack';
        else if (lifestyleCategory === 'Sweets/Candies') targetType = 'cookies';
        else if (lifestyleCategory === 'Proteins') targetType = 'protein';
        else if (lifestyleCategory === 'Daily Groceries') targetType = 'breakfast';

        if (targetType && (p.types || []).includes(targetType)) score += 10;

        // C. Universal Popularity Boosts
        if (productNameLower.includes('makhana') || productNameLower.includes('jowar') || productNameLower.includes('nippat')) score += 2;

        return { ...p, score };
    }).filter(p => p !== null);

    // Fallback if everything was excluded (highly unlikely now)
    if (candidates.length === 0) {
        candidates = activeCatalog
            .filter(p => !((p.types || []).includes('oil') || (p.types || []).includes('combo')))
            .map(p => ({ ...p, score: 0 }));
    }

    // 3. SELECTION (Randomized Tie-Breaking)
    // A stable JS sort on array.sort(() => .5 - Math.random()) is flawed for array shuffling.
    // Instead, perform a perfect Fisher-Yates shuffle first...
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    // ...Then stably sort by score. Items with IDENTICAL scores are thus perfectly shuffled!
    candidates.sort((a, b) => b.score - a.score);

    return candidates.slice(0, count).map(p => ({
        name: p.name,
        slug: p.slug,
        isBNProduct: p.isBNProduct || true
    }));
}

// ── DETERMINISTIC VALIDATORS ─────────────────────────────────────────────────

const VEG_KEYWORDS = ['paneer', 'tofu', 'soya', 'dal', 'veg', 'mushroom', 'chana'];
const ALLERGEN_MAP = {
    'shellfish': ['shrimp', 'prawn', 'crab'],
    'dairy': ['milk', 'cheese', 'butter'],
    'gluten': ['wheat', 'maida', 'atta', 'bread'],
    'nuts': ['peanut', 'almond', 'cashew', 'walnut', 'pistachio', 'hazelnut', 'nut'],
};

function runValidators(aiResult, profile, scanMode) {
    const items = (aiResult.items || []).map(item => {
        let corrected = {
            hasAllergy: false,
            hasAversion: false,
            hasHabitConflict: false,
            isNonFood: item.isNonFood || false,
            isUnplanned: item.isUnplanned || false,
            ...item
        };
        const name = item.name.toLowerCase();

        // ENFORCE: Score must be between 0 and 10
        if (typeof corrected.score !== 'number') corrected.score = 5;
        if (corrected.score < 0) corrected.score = 0;
        if (corrected.score > 10) corrected.score = 10;

        // Non-Food Handling
        if (corrected.isNonFood) {
            corrected.score = 0;
            corrected.category = 'Bad';
            corrected.macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };
            corrected.alternatives = [];
        }

        // NO DEFAULT FAKES: Removed the 150cal fallback. 
        // We trust the AI's ingredient-based estimation or natural zeroes.

        // ENFORCE: Universal Category Mapping
        if (corrected.score >= 8) corrected.category = 'Best';
        else if (corrected.score >= 6) corrected.category = 'Good';
        else if (corrected.score >= 4) corrected.category = 'Fair/Occasional';
        else corrected.category = 'Bad';

        // Allergen Check
        (profile.allergies || []).forEach(allergy => {
            const keywords = ALLERGEN_MAP[allergy.toLowerCase().split(' ')[0]] || [allergy.toLowerCase()];
            if (keywords.some(kw => name.includes(kw))) {
                corrected.category = 'Bad';
                corrected.score = 0;
                corrected.hasAllergy = true;
                corrected.isUnplanned = true; // Hard fail: Allergies are never planned
                corrected.reason = `Since you are allergic to ${allergy}, having this could trigger a clinical reaction. Please see the suggested alternatives below for a safer choice. ${item.reason || ''}`;
            }
        });

        // Aversion Check
        (profile.aversions || []).forEach(aversion => {
            if (name.includes(aversion.toLowerCase())) {
                corrected.hasAversion = true;
                corrected.score = Math.min(corrected.score, 1);
                corrected.category = 'Bad';
                corrected.isUnplanned = true; // Hard fail: Aversions are never planned
                corrected.reason = `This contains ${aversion}, which you generally avoid. You might want to try one of the alternatives below instead. ${item.reason || ''}`;
            }
        });

        // Eating Habit Conflict Detection
        const eatingHabit = (profile.eatingHabit || '').toLowerCase();
        const meatKws = ['chicken', 'mutton', 'beef', 'buff', 'meat', 'pork', 'lamb', 'ham', 'bacon', 'salami', 'pepperoni', 'duck', 'turkey', 'prosciutto', 'veal'];
        const fishKws = ['fish', 'prawn', 'shrimp', 'crab', 'lobster', 'salmon', 'tuna', 'seafood', 'cod', 'tilapia', 'pomfret', 'squid', 'octopus'];
        const eggKws = ['egg', 'omelette', 'scrambled', 'anda', 'frittata', 'benedict'];
        const dairyKws = ['milk', 'cheese', 'butter', 'cream', 'lactose', 'curd', 'yogurt', 'ghee', 'dahi'];

        let habitConflict = false;
        let habitReason = '';

        if (eatingHabit.includes('ovo-veg') || eatingHabit === 'ovo veg') {
            // Ovo-Veg: Eggs OK, No Meat, No Fish
            if (meatKws.some(kw => name.includes(kw))) { habitConflict = true; habitReason = "meat"; }
            else if (fishKws.some(kw => name.includes(kw))) { habitConflict = true; habitReason = "fish"; }
        } else if (eatingHabit.includes('pescatarian')) {
            // Pescatarian: Fish OK, No Meat
            if (meatKws.some(kw => name.includes(kw))) { habitConflict = true; habitReason = "meat"; }
        } else if (eatingHabit === 'vegan') {
            // Vegan: No Meat, No Fish, No Eggs, No Dairy
            if (meatKws.some(kw => name.includes(kw))) { habitConflict = true; habitReason = "meat"; }
            else if (fishKws.some(kw => name.includes(kw))) { habitConflict = true; habitReason = "fish"; }
            else if (eggKws.some(kw => name.includes(kw))) { habitConflict = true; habitReason = "eggs"; }
            else if (dairyKws.some(kw => name.includes(kw))) { habitConflict = true; habitReason = "dairy/lactose"; }
        } else if (eatingHabit.includes('veg') && !eatingHabit.includes('non-veg')) {
            // Standard Veg: No Meat, No Fish, No Eggs
            if (meatKws.some(kw => name.includes(kw))) { habitConflict = true; habitReason = "meat"; }
            else if (fishKws.some(kw => name.includes(kw))) { habitConflict = true; habitReason = "fish"; }
            else if (eggKws.some(kw => name.includes(kw))) { habitConflict = true; habitReason = "eggs"; }
        }

        if (habitConflict) {
            corrected.hasHabitConflict = true;
            corrected.score = 0;
            corrected.category = 'Bad';
            corrected.isUnplanned = true; // Hard fail: Diet conflicts are never planned
            corrected.reason = `This contains ${habitReason} which conflicts with your ${eatingHabit} eating habit. I've suggested suitable alternatives for you below. ${item.reason || ''}`;
        }

        if (name.toUpperCase().startsWith('BN ') || name.toUpperCase().startsWith('BN-') || name.toUpperCase().includes('BALANCENUTRITION')) {
            corrected.isBNProduct = true;
        }

        // ── ENFORCE: Strict Lifestyle Category Normalization ────────────────────
        const catMap = {
            'packaged': 'Packaged Goods', 'packaged-goods': 'Packaged Goods', 'packaged_goods': 'Packaged Goods', 'packaged goods': 'Packaged Goods',
            'sweets': 'Sweets/Candies', 'sweets/candies': 'Sweets/Candies', 'sweets-candies': 'Sweets/Candies', 'sweets_candies': 'Sweets/Candies',
            'superfoods': 'Superfoods', 'superfood': 'Superfoods',
            'daily': 'Daily Groceries', 'daily-groceries': 'Daily Groceries', 'daily_groceries': 'Daily Groceries', 'daily groceries': 'Daily Groceries', 'groceries': 'Daily Groceries',
            'proteins': 'Proteins', 'protein': 'Proteins', 'other': 'Others', 'others': 'Others'
        };
        const rawCatRaw = (corrected.lifestyleCategory || 'Others').toString();
        const rawCat = rawCatRaw.toLowerCase().trim();
        const mappedCat = catMap[rawCat] || 'Others';

        if (mappedCat === 'Others' && rawCat !== 'others' && rawCat !== 'other') {
            console.log(`[SYS-AUDIT] ⚠ Category mapping fallback for '${corrected.name}': '${rawCatRaw}' -> '${mappedCat}'`);
        }
        corrected.lifestyleCategory = mappedCat;

        // BN ALTERNATIVES MIX LOGIC: Merge AI suggestions with BN products for groceries/proteins scoring <= 3
        const isGrocery = corrected.lifestyleCategory === 'Packaged Goods' || corrected.lifestyleCategory === 'Daily Groceries' || corrected.lifestyleCategory === 'Proteins' || name.toLowerCase().includes('protein');

        if (scanMode !== 'PLATE' && isGrocery && corrected.score <= 3) {
            const aiAlts = Array.isArray(corrected.alternatives) ? corrected.alternatives : [];
            const bnAlts = getBNAlternatives(profile, name, corrected.lifestyleCategory, 1); // Get exactly 1 BN alternative
            
            // Mix: 1 BN product + top AI suggestions
            const mixed = [];
            if (bnAlts.length > 0) mixed.push(bnAlts[0]);
            
            // Add AI suggestions that aren't already represented (if any)
            aiAlts.forEach(alt => {
                if (mixed.length < 3) {
                    const altName = typeof alt === 'string' ? alt : (alt.name || '');
                    if (altName && !mixed.some(m => (typeof m === 'string' ? m : m.name).toLowerCase() === altName.toLowerCase())) {
                        mixed.push(altName);
                    }
                }
            });
            
            corrected.alternatives = mixed;
            console.log(`[SYS-AUDIT] Mixed alternatives triggered for '${corrected.name}':`, JSON.stringify(mixed));
        }

        // Final safe check for Non-Veg users to prevent false flags on meat
        if (eatingHabit.includes('non-veg') && corrected.category === 'Bad' && (meatKws.some(kw => name.includes(kw)) || fishKws.some(kw => name.includes(kw))) && !corrected.hasAllergy) {
            corrected.category = 'Fair/Occasional';
            corrected.score = Math.max(corrected.score, 5);
        }

        // Combine clinical reason with compliance logic if needed (ONLY for Plate scans as per user request)
        if (scanMode === 'PLATE' && corrected.isUnplanned && corrected.complianceReason) {
            corrected.reason = `${corrected.complianceReason}. ${corrected.reason || ''}`.trim();
        }

        // ── Remove Fields used only for AI Debugging / Logic ──
        delete corrected.complianceReason;

        // ── Remove False Defaults to Save Final JSON Payload Size ──
        if (!corrected.hasAllergy) delete corrected.hasAllergy;
        if (!corrected.hasAversion) delete corrected.hasAversion;
        if (!corrected.hasHabitConflict) delete corrected.hasHabitConflict;
        if (!corrected.isNonFood) delete corrected.isNonFood;
        if (!corrected.isUnplanned) delete corrected.isUnplanned;
        if (!corrected.isBNProduct) delete corrected.isBNProduct;

        return corrected;
    });

    // RECALCULATE healthScore as a true average of corrected item scores
    // We only average items that are FOOD and aren't a hard 0 (conflicts)
    const foodItems = items.filter(i => !i.isNonFood);
    const scorableItems = foodItems.filter(i => typeof i.score === 'number' && i.score > 0);

    let avgScore = 8.5; // High default if no food items found to prevent "Red/Zero" alerts for non-food receipts
    if (foodItems.length > 0) {
        // If there are scorable food items, average them. 
        // If there are food items but none have scores (rare AI error), default to 5.0 (Neutral)
        avgScore = scorableItems.length > 0
            ? parseFloat((scorableItems.reduce((sum, i) => sum + i.score, 0) / scorableItems.length).toFixed(1))
            : (items.some(i => i.isNonFood) ? 8.5 : 5.0);
    }

    // RECALCULATE totalMacros if they are zero or missing
    let totalMacros = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    totalMacros = items.reduce((acc, i) => {
        if (i.isNonFood) return acc;
        return {
            calories: Math.round(acc.calories + (i.macros?.calories || 0)),
            protein: Math.round(acc.protein + (i.macros?.protein || 0)),
            carbs: Math.round(acc.carbs + (i.macros?.carbs || 0)),
            fat: Math.round(acc.fat + (i.macros?.fat || 0))
        };
    }, totalMacros);

    // Determine scan type for frontend routing & UI
    const finalType = scanMode === 'PLATE' ? 'PLATE' : (scanMode === 'MENU' ? 'MENU' : 'RECEIPT');
    const finalMacros = finalType === 'MENU' ? undefined : totalMacros;

    return { ...aiResult, type: finalType, items, healthScore: avgScore, totalMacros: finalMacros };
}

// ── ORCHESTRATOR ─────────────────────────────────────────────────────────────

export async function runAnalysis({ imageInputs, userProfile, localTime, deviceHour, scanMode, askDiet, mealType, expectedDiet }) {
    if (PROVIDER === 'google' && !process.env.GEMINI_API_KEY && !process.env.API_KEY) {
        throw new Error('GEMINI_API_KEY is not set');
    }

    // Normalize legacy 'MEAL' mode to 'PLATE'
    if (scanMode === 'MEAL') scanMode = 'PLATE';

    const prompt = getPromptForMode(scanMode, userProfile, localTime, deviceHour, askDiet, mealType, expectedDiet);
    const schema = scanMode === 'MENU' ? MenuAnalysisResultSchema : AnalysisResultSchema;

    // STEP-BY-STEP CONSOLE LOGGING
    const classification = userProfile.classification || 'UNKNOWN';
    const rawUserStatus = userProfile.rawUserStatus || 'unknown';

    console.log(`[SYS-AUDIT] STEP 1: User Identity -> ${classification} (user_status: '${rawUserStatus}')`);

    if (classification === 'CLIENT') {
        console.log(`[SYS-AUDIT] STEP 2: Client Profile Active -> Program: ${userProfile.program || 'Active Diet Plan'} | EatingHabit: ${userProfile.eatingHabit || 'N/A'} | HealthGoal: ${userProfile.healthGoal || 'N/A'}`);
        console.log(`[SYS-AUDIT]   Allergies: ${JSON.stringify(userProfile.allergies || [])} | Aversions: ${JSON.stringify(userProfile.aversions || [])} | DietPreference: ${JSON.stringify(userProfile.dietPreference || [])}`);
    } else if (classification === 'LEAD') {
        console.log(`[SYS-AUDIT] STEP 2: Lead Profile Active -> No personalized diet, standard analysis.`);
    } else {
        console.log(`[SYS-AUDIT] STEP 2: Unknown Status '${rawUserStatus}' -> Treating as Lead.`);
    }

    const featureName = scanMode === 'PLATE' ? 'Log Meal (Food Plate)' : (scanMode === 'MENU' ? 'Menu Scan' : 'Receipt Scan');
    console.log(`[SYS-AUDIT] STEP 3: Feature Triggered -> ${featureName}`);
    console.log(`[SYS-AUDIT] ACTION: Initiating AI Visual Scan & Food Identification...`);
    if (expectedDiet) {
        console.log(`[SYS-AUDIT] ACTION: Diet Template Fetched & Sent to AI for Comparison.`);
    }

    const content = [{ type: 'text', text: prompt }];
    imageInputs.forEach(img => content.push({ type: 'image', image: img }));

    const maxRetries = 1;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout for multi-image

            // Explicitly set fastest parameters — thinking disabled via getModel(0)
            console.time('[Perf]-AI-Generation');
            console.log(`[AI-Request] Starting generation with model: ${MODEL_NAME}, thinking: disabled`);

            const aiResponse = await generateObject({
                model: googleProvider(MODEL_NAME), // Use centralized model config
                schema,
                messages: [{ role: 'user', content }],
                abortSignal: controller.signal,
                temperature: 0.0,
                topP: 0.3, // Controls diversity of generated text
                topK: 1, // Controls diversity of generated text
                seed: 140, // Ensures reproducibility
                providerOptions: {
                    google: {
                        thinkingConfig: {
                            includeThoughts: true,
                            thinkingBudget: 0, // Forces the model to verify ingredient presence per dish
                        },
                    },
                },
            });
            console.timeEnd('[Perf]-AI-Generation');

            if (aiResponse.usage) {
                console.log(`[AI-Metrics] Tokens -> Prompt: ${aiResponse.usage.promptTokens}, Completion: ${aiResponse.usage.completionTokens}, Total: ${aiResponse.usage.totalTokens}`);
            }
            console.log(`[Perf] Memory After Generation: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`);

            clearTimeout(timeoutId);
            const validated = runValidators(aiResponse.object, userProfile, scanMode);

            // LOG FINAL AUDIT VERDICT AS REQUESTED
            if (expectedDiet && validated.items) {
                console.log(`[SYS-AUDIT] STEP 4: Comparing Scanned Dish(es) with Diet Plan...`);
                const unplannedCount = validated.items.filter(i => i.isUnplanned).length;
                console.log(`[SYS-AUDIT] STEP 5: AUDIT VERDICT -> ${unplannedCount > 0 ? 'UNPLANNED DISH DETECTED' : 'PLANNED MEAL MATCH'}`);
                if (validated.mentorsNote) {
                    console.log(`[SYS-AUDIT] MENTOR'S NOTE: ${validated.mentorsNote}`);
                }
            } else {
                console.log(`[SYS-AUDIT] STEP 4 & 5: Skip diet comparison (${scanMode !== 'PLATE' ? scanMode + ' mode — no diet comparison' : 'No expectedDiet received'}). Final Health Score: ${validated.healthScore}/10`);
            }

            return {
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                timestampIST: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
                user: userProfile.name || 'Anonymous',
                ...validated,
                usage: aiResponse.usage
            };
        } catch (err) {
            lastError = err;
            if (err.name === 'AbortError') {
                console.error(`[CIRCUIT BREAKER] AI Request timed out (Attempt ${attempt + 1})`);
            } else {
                console.error(`[CIRCUIT BREAKER] AI Request failed (Attempt ${attempt + 1}):`, err.message);

                // 🕵️ DEBUG: Log the exact schema failure details
                if (err.details) {
                    console.error('[SCHEMA_ERROR_DETAILS]:', JSON.stringify(err.details, null, 2));
                }
                if (err.warnings) {
                    console.warn('[AI_WARNINGS]:', JSON.stringify(err.warnings, null, 2));
                }
            }
            if (attempt === maxRetries) throw new Error(`AI processing failed after ${attempt + 1} attempts: ${lastError.message}`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

