import 'dotenv/config';
import express from 'express';
import http2Express from 'http2-express-bridge';
import cors from 'cors';
import multer from 'multer';
import sharp from 'sharp';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import http2 from 'http2';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';
import { runAnalysis } from './services.js';
import { startGrpcServer } from './grpc-server.js';
import { db as dal, initDB, closeDB } from './lib/db/index.js';
import { verifySignInToken, getWebAuthConfig, getEnabledProviders } from './lib/firebase-auth.js';
import { createHealthRouter } from './health.js';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// FIX: Required for Google Cloud Run proxy headers handling (prevents express-rate-limit ValidationError)
app.set('trust proxy', 1);

const upload = multer();
const PORT = parseInt(process.env.PORT || 3002, 10);

// ── PERSISTENCE & RESILIENCE ─────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.REFRESH_SECRET || (JWT_SECRET + '_refresh');

const ACCESS_TOKEN_EXPIRY = '15h';
// Old login that issues a token for any userId without proof. Keep false in production.
const LEGACY_USERID_LOGIN = String(process.env.ALLOW_LEGACY_USERID_LOGIN || '').toLowerCase() === 'true';
// "Continue without signing in". Data is kept under an unguessable guest ID tied to a secret on the device.
const GUEST_MODE = String(process.env.ALLOW_GUEST_MODE ?? 'true').toLowerCase() !== 'false';
const GUEST_PREFIX = 'guest_';
const guestIdFor = (secret) => GUEST_PREFIX + crypto.createHash('sha256').update('nutriscan-guest:' + secret).digest('hex').slice(0, 32);
const validGuestSecret = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const BN_API_BASE = (process.env.BN_API_BASE || 'https://bn-new-api.balancenutritiononline.com/api/v1').replace(/\/$/, '');
const REFRESH_TOKEN_EXPIRY_DAYS = 30;

if (!JWT_SECRET) {
    console.error('⚠️ [WARNING] JWT_SECRET not set — auth endpoints will fail, but service continues.');
}

// Initialize the database abstraction layer
await initDB();

// ── DYNAMIC PRODUCT CATALOG CACHE ──────────────────────────────
global.shopProductsCache = null;
async function refreshShopProducts() {
    try {
        const res = await fetch('https://bn-new-api.balancenutritiononline.com/api/v1/shop-product/all-products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const d = await res.json();
        if (d && d.data && Array.isArray(d.data.products)) {
            global.shopProductsCache = d.data.products.map(p => {
                // Determine target types roughly from name and category
                const types = [];
                const nameLower = p.name.toLowerCase();
                const catsLower = (p.categories || []).map(c => c.name.toLowerCase());

                if (nameLower.includes('protein') || nameLower.includes('isolate') || nameLower.includes('whey')) types.push('protein');
                if (nameLower.includes('biscuit') || nameLower.includes('cookie')) types.push('cookies');
                if (nameLower.includes('snack') || nameLower.includes('chana') || nameLower.includes('makhana') || nameLower.includes('chip') || nameLower.includes('stix') || nameLower.includes('puff') || nameLower.includes('fry') || nameLower.includes('chivda') || nameLower.includes('khakhra') || nameLower.includes('kurkure') || nameLower.includes('farsan') || nameLower.includes('bhujia') || nameLower.includes('mixture') || catsLower.some(c => c.includes('snack'))) types.push('snack');
                if (nameLower.includes('breakfast') || nameLower.includes('cereal') || nameLower.includes('upma') || nameLower.includes('poha') || nameLower.includes('muesli') || nameLower.includes('oat') || nameLower.includes('millet')) types.push('breakfast');
                if (nameLower.includes('oil')) types.push('oil');
                if (catsLower.some(c => c.includes('combo'))) types.push('combo');

                return {
                    name: p.name,
                    slug: p.slug,
                    categories: [...(p.allergy_tags || []), ...((p.categories || []).map(c => c.name))],
                    types: types,
                    isBNProduct: true
                };
            });
            console.log(`✅ [CACHE] Refreshed BN Shop Products dynamically: ${global.shopProductsCache.length} items loaded into memory.`);
        }
    } catch (e) {
        console.error(`⚠️ [WARNING] Failed to fetch shop products for cache: ${e.message}. Will use hardcoded fallback.`);
    }
}
// Launch background fetch immediately on boot, update every 12 hours
refreshShopProducts();
setInterval(refreshShopProducts, 12 * 60 * 60 * 1000);


// FIX 6: Resilient write with retry is now inside the DAL (api/lib/db.js)

// ── FIX 4: Valid scan modes whitelist ─────────────────────────────────────
const VALID_SCAN_MODES = new Set(['RECEIPT', 'MENU', 'PLATE']);

// Rate Limiter: 50 scans per hour per IP (Cost control)
const scanLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 50,
    message: { error: 'Scan limit reached. Please try again in an hour.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ── FIX 9: Rate limiter for auth endpoints ────────────────────────────────
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 token requests per 15 min per IP
    message: { error: 'Too many auth requests. Try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Middleware to verify JWT (Header-based, with expired vs invalid distinction)
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: Bearer token required in Authorization header' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            // Distinguish between EXPIRED and INVALID tokens
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({
                    error: 'Access token expired',
                    code: 'TOKEN_EXPIRED' // Mobile apps use this to trigger auto-refresh
                });
            }
            return res.status(403).json({ error: 'Forbidden: Invalid token' });
        }
        req.user = user;
        next();
    });
};

// ── ENVIRONMENT VALIDATION ───────────────────────────────────────────────────
const REQUIRED_ENV = ['GEMINI_API_KEY', 'JWT_SECRET'];

const missingEnv = REQUIRED_ENV.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
    console.error(`\n❌ [CRITICAL] Missing required environment variables: ${missingEnv.join(', ')}`);
    process.exit(1);
}

// ⚡ Sharp Optimization for Windows
sharp.cache(false);

// ── MIDDLEWARE ───────────────────────────────────────────────────────────────

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*', // Production should set this
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// ── ROOT LANDING (Serve Frontend) ───────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── FIX 10: Adaptive compression presets by scan mode ─────────────────────
const COMPRESSION_PRESETS = {
    RECEIPT: { width: 800, height: 1200, quality: 65 },  // High-res for text/OCR
    MENU: { width: 800, height: 1200, quality: 65 },  // High-res for text/OCR
    PLATE: { width: 600, height: 600, quality: 50 },  // Visual ID only
};

/**
 * Offloads Sharp image compression to a Worker Thread.
 * Keeps the main event loop free to handle concurrent requests.
 * Falls back to in-process Sharp if worker fails.
 */
function compressImagesInWorker(buffers, options = {}) {
    return new Promise((resolve, reject) => {
        try {
            const worker = new Worker(path.join(__dirname, 'image-worker.js'), {
                workerData: { buffers, options }
            });

            const timeout = setTimeout(() => {
                worker.terminate();
                console.warn('[Worker] Timed out after 15s, falling back to in-process compression');
                fallbackCompress(buffers, options).then(resolve).catch(reject);
            }, 15000);

            worker.on('message', (results) => {
                clearTimeout(timeout);
                if (results.error) {
                    console.warn('[Worker] Error:', results.error, '— falling back');
                    fallbackCompress(buffers, options).then(resolve).catch(reject);
                } else {
                    resolve(results.map(r => r.data));
                }
            });

            worker.on('error', (err) => {
                clearTimeout(timeout);
                console.warn('[Worker] Thread error:', err.message, '— falling back');
                fallbackCompress(buffers, options).then(resolve).catch(reject);
            });
        } catch (err) {
            console.warn('[Worker] Init failed:', err.message, '— falling back');
            fallbackCompress(buffers, options).then(resolve).catch(reject);
        }
    });
}

async function fallbackCompress(buffers, options = {}) {
    const { width = 512, height = 512, quality = 50 } = options;
    return Promise.all(buffers.map(async (buf, idx) => {
        try {
            const buffer = Buffer.from(buf);
            const metadata = await sharp(buffer).metadata();
            const originalSizeKB = (buffer.length / 1024).toFixed(2);

            const optimized = await sharp(buffer)
                .resize(width, height, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality })
                .toBuffer();

            const optMetadata = await sharp(optimized).metadata();
            const optSizeKB = (optimized.length / 1024).toFixed(2);
            const reduction = ((1 - optimized.length / buffer.length) * 100).toFixed(1);

            console.log(`[Fallback Compression Stats - Img ${idx}]`);
            console.log(`  └─ Original  : ${metadata.width}x${metadata.height}px, ${originalSizeKB}KB`);
            console.log(`  └─ Optimized : ${optMetadata.width}x${optMetadata.height}px, ${optSizeKB}KB (-${reduction}%)`);

            return optimized;
        } catch (e) {
            console.error('[Fallback Compression Failed]:', e.message);
            return Buffer.from(buf);
        }
    }));
}

// ── API v1 ROUTER ────────────────────────────────────────────────────────────

const v1 = express.Router();

/** Health check with system diagnostics */
v1.get('/health', async (req, res) => {
    try {
        const uptime = process.uptime();
        const memory = process.memoryUsage();
        // 1. Database Read/Write Check via DAL
        const { connection: dbStatus, readWrite: dbReadWrite } = await dal.healthCheck();

        // 2. Storage/Disk Check (Container root)
        let storage = { status: 'n/a' };
        try {
            const stats = fs.statfsSync('/');
            const total = stats.bsize * stats.blocks;
            const free = stats.bsize * stats.bfree;
            const used = total - free;
            storage = {
                status: 'operational',
                totalGB: +(total / (1024 ** 3)).toFixed(2),
                usedGB: +(used / (1024 ** 3)).toFixed(2),
                freeGB: +(free / (1024 ** 3)).toFixed(2),
                percentUsed: +((used / total) * 100).toFixed(1)
            };
        } catch (e) {
            storage = { status: 'error', error: e.message };
        }

        // 3. IST Time
        const istTime = new Date().toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'medium',
            timeStyle: 'long'
        });

        res.json({
            status: (dbReadWrite === 'verified') ? 'healthy' : 'degraded',
            uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
            timestamp: new Date().toISOString(),
            istTime,
            version: '4.0.0',
            apiVersion: 'v1',
            database: {
                connection: dbStatus,
                readWrite: dbReadWrite
            },
            storage,
            system: {
                memoryHeapUsed: `${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                processRss: `${(memory.rss / 1024 / 1024).toFixed(2)} MB`
            },
            server: {
                env: process.env.NODE_ENV || 'development',
                region: process.env.K_SERVICE ? 'GCP-CloudRun' : 'Local',
                node: process.version
            }
        });
    } catch (err) {
        res.status(500).json({ status: 'unhealthy', error: err.message });
    }
});

/**
 * POST /api/v1/analyze — Accepts File/Base64 + Persona
 */
v1.post('/analyze', authenticateToken, scanLimiter, upload.any(), async (req, res) => {
    const requestId = Math.random().toString(36).substring(7);
    console.time(`[Perf]-Total-Request-${requestId}`);
    console.log(`\n[Perf]-System-Start: Memory Heap Used: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`);
    try {
        let buffers = [];
        let profile = {};

        // 1. Gather Buffers from Multipart or JSON
        if (req.files && req.files.length > 0) {
            buffers = req.files.filter(f => ['image', 'file', 'File', 'images'].includes(f.fieldname)).map(f => f.buffer);
            try {
                const profileRaw = req.body.userProfile || req.body.persona || req.body.Text;
                profile = typeof profileRaw === 'string' ? JSON.parse(profileRaw) : (profileRaw || {});
            } catch { profile = {}; }
        } else if (req.body.image || req.body.images) {
            const raw = req.body.image || req.body.images;
            const images = Array.isArray(raw) ? raw : [raw];
            buffers = images.map(img => {
                const base64Data = img.includes('base64,') ? img.split('base64,')[1] : img;
                return Buffer.from(base64Data, 'base64');
            });
            profile = typeof req.body.userProfile === 'string' ? JSON.parse(req.body.userProfile) : (req.body.userProfile || {});
        }

        if (buffers.length === 0) return res.status(400).json({ error: 'No images provided.' });

        let localTime = req.body.localTime || new Date().toISOString();
        let deviceHour = req.body.deviceHour !== undefined ? parseInt(req.body.deviceHour, 10) : new Date(localTime).getHours();
        let deviceTimeStr = req.body.deviceTime || localTime;

        // Logging: Compare device time to IST for reference
        const istNow = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
        console.log(`[Time Audit] Device Time: ${deviceTimeStr} | Ref IST: ${istNow} | Hour for Logic: ${deviceHour}`);
        let scanMode = (req.body.scanMode || 'RECEIPT').toUpperCase();
        // FIX 3: Backward compat — normalize MEAL → PLATE
        if (scanMode === 'MEAL') scanMode = 'PLATE';
        // FIX 4: Validate scanMode against whitelist
        if (!VALID_SCAN_MODES.has(scanMode)) {
            return res.status(400).json({
                error: `Invalid scanMode '${scanMode}'. Must be one of: RECEIPT, MENU, PLATE`
            });
        }
        let askDiet = req.body.ask_diet === 'true' || req.body.ask_diet === 'yes';
        let mealType = req.body.mealType || null;
        let notes = req.body.notes || '';

        // 🚀 Image Compression (conditional bypass to save CPU)
        console.time(`[Perf]-ImageCompression`);
        const totalInputSize = buffers.reduce((sum, b) => sum + b.length, 0);
        const avgSizeKB = (totalInputSize / buffers.length) / 1024;

        let optimizedBuffers;
        // Bypassing heavy worker if frontend already optimized it (Threshold: 450KB per image)
        if (avgSizeKB < 450) {
            console.log(`[Perf] Forward-Passing optimized images (${avgSizeKB.toFixed(1)}KB avg) — Skipping backend heavy-compression.`);
            optimizedBuffers = buffers;
        } else {
            const compressionOpts = COMPRESSION_PRESETS[scanMode] || COMPRESSION_PRESETS.PLATE;
            optimizedBuffers = await compressImagesInWorker(buffers, compressionOpts);
        }
        console.timeEnd(`[Perf]-ImageCompression`);

        // 🧠 Diet Plan Resolution — Priority:
        // 1. Frontend already parsed the diet from get-dietByUserId and sent expectedDiet directly
        // 2. Server-side fallback: call get-dietByUserId if user is CLIENT but frontend didn't send diet
        let expectedDiet = req.body.expectedDiet || null;
        console.log(`[Diet Plan] expectedDiet received: ${expectedDiet ? expectedDiet.length + ' chars' : 'NONE'} | profile.classification=${profile.classification} | profile.userId=${profile.userId} | profile.activeOrderId=${profile.activeOrderId}`);

        if (expectedDiet) {
            console.log(`[Diet Plan] ✓ Received pre-parsed diet from frontend (${expectedDiet.length} chars)`);
        } else if (profile.classification === 'CLIENT' && profile.userId && profile.activeOrderId) {
            // Server-side fallback: fetch diet using get-dietByUserId
            console.log(`[Diet Plan] Frontend didn't send diet — server-side fallback for CLIENT ${profile.userId}`);
            console.time(`[Perf]-Diet-Fetch`);
            try {
                const dietRes = await fetch('https://bn-new-api.balancenutritiononline.com/api/v1/diet/get-dietByUserId', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: parseInt(profile.userId), active_order_id: profile.activeOrderId })
                });
                const rawJson = await dietRes.json();
                const dietJson = Array.isArray(rawJson) ? rawJson[0] : rawJson;

                if (dietJson && dietJson.status === 'success' && dietJson.data) {
                    let sessions = [];
                    if (dietJson.data.data && Array.isArray(dietJson.data.data)) {
                        sessions = dietJson.data.data;
                    } else if (dietJson.data.current_program_diet && Array.isArray(dietJson.data.current_program_diet)) {
                        sessions = dietJson.data.current_program_diet;
                    } else if (Array.isArray(dietJson.data)) {
                        sessions = dietJson.data;
                    } else if (dietJson.data) {
                        sessions = [dietJson.data];
                    }

                    const today = new Date();
                    today.setHours(0, 0, 0, 0);

                    // Find session with sixth_day closest to today (Must NOT be in the future)
                    let bestSession = null;
                    let bestDistance = Infinity;
                    let highestSequence = -1;

                    for (const s of sessions) {
                        // Track highest sequence as a fallback if dates are missing
                        const seq = parseInt(s.session || s.sequence || s.diet_id) || 0;
                        if (seq > highestSequence) {
                            highestSequence = seq;
                            if (bestDistance === Infinity) {
                                bestSession = s;
                            }
                        }

                        const sixthDayStr = s.sixth_day || s.sixthDay || s.diet_date;
                        if (sixthDayStr) {
                            // Date format handling logic
                            let parts = sixthDayStr.toString().split(/[-/]/);
                            let dateObj;
                            if (parts.length === 3) {
                                if (parts[0].length === 4) dateObj = new Date(parts[0], parts[1] - 1, parts[2]); // YYYY-MM-DD
                                else dateObj = new Date(parts[2], parts[1] - 1, parts[0]); // DD-MM-YYYY
                            } else {
                                dateObj = new Date(sixthDayStr);
                            }

                            if (!isNaN(dateObj.getTime())) {
                                dateObj.setHours(0, 0, 0, 0);
                                // RULE: Must be in the past or today (allow small buffer)
                                if (dateObj <= today) {
                                    const dist = Math.abs(today - dateObj);
                                    if (dist < bestDistance) {
                                        bestDistance = dist;
                                        bestSession = s; // Explicit date match overrides highest sequence
                                    }
                                }
                            }
                        }
                    }

                    if (bestSession) {
                        const hour = deviceHour;
                        let derivedMealType = 'dinner';
                        if (hour >= 5 && hour < 11) derivedMealType = 'breakfast';
                        else if (hour >= 11 && hour < 15) derivedMealType = 'lunch';
                        else if (hour >= 15 && hour < 18) derivedMealType = 'snack';

                        let targetMeal = (mealType || derivedMealType).toLowerCase();

                        // If frontend explicitly sends "auto", map it strictly to the time-derived meal hour rather than dumping the whole day's plan
                        if (targetMeal === 'auto' || targetMeal === 'general') {
                            targetMeal = derivedMealType;
                        }
                        if (targetMeal === 'snacks') targetMeal = 'snack';

                        // Map target meal strictly to the exact database keys in BN diet plan
                        const mealKeyMapping = {
                            breakfast: ['on_rising', 'pre_breakfast', 'breakfast'],
                            lunch: ['lunch'],
                            snack: ['mid_morning', 'pre_workout', 'during_workout', 'post_workout', 'pre_lunch', 'post_lunch', 'tea_eve', 'late_eve', 'pre_dinner'],
                            dinner: ['dinner', 'post_dinner', 'bed_time'],
                            general: ['on_rising', 'pre_breakfast', 'breakfast', 'mid_morning', 'pre_workout', 'during_workout', 'post_workout', 'pre_lunch', 'lunch', 'post_lunch', 'tea_eve', 'late_eve', 'pre_dinner', 'dinner', 'post_dinner', 'bed_time']
                        };

                        const keysToExtract = mealKeyMapping[targetMeal] || mealKeyMapping['general'];
                        const cleanDiet = {};

                        // Helper to strip HTML and junk strings
                        const cleanText = (html) => {
                            if (!html || typeof html !== 'string') return '';
                            return html
                                .replace(/<[^>]*>/g, ' ')               // Strip HTML tags
                                .replace(/\[View Recipe\]/gi, '')       // Strip [View Recipe]
                                .replace(/\(Order Now\)/gi, '')         // Strip (Order Now)
                                .replace(/\(Buy Here\)/gi, '')          // Strip (Buy Here)
                                .replace(/&nbsp;/g, ' ')                // Remove nbsp
                                .replace(/&amp;/g, '&')                 // Fix ampersand
                                .replace(/\s+/g, ' ')                   // Compress whitespace
                                .trim();
                        };

                        for (const key of keysToExtract) {
                            if (bestSession[key]) {
                                const cleaned = cleanText(bestSession[key]);
                                if (cleaned && cleaned.toLowerCase() !== 'null' && cleaned !== '') {
                                    cleanDiet[key] = cleaned;
                                }
                            }
                        }

                        // Fallback: Just in case we didn't match anything, dump all food-related keys for the day
                        if (Object.keys(cleanDiet).length === 0) {
                            for (const key of mealKeyMapping['general']) {
                                if (bestSession[key]) {
                                    const cleaned = cleanText(bestSession[key]);
                                    if (cleaned && cleaned.toLowerCase() !== 'null' && cleaned !== '') {
                                        cleanDiet[key] = cleaned;
                                    }
                                }
                            }
                        }

                        if (Object.keys(cleanDiet).length > 0) {
                            expectedDiet = JSON.stringify(cleanDiet, null, 2);
                            askDiet = true;
                            console.log(`[Diet Plan] ✓ Server-side diet resolved | Highest Sequence: ${highestSequence} | Meal: ${targetMeal} | Keys: [${Object.keys(cleanDiet).join(', ')}]`);
                        }
                    }
                } else {
                    console.log(`[Diet Plan] ⚠ get-dietByUserId returned non-success`);
                }
            } catch (dietErr) {
                console.error(`[Diet Plan] ✗ Server-side diet fetch failed: ${dietErr.message}`);
            }
            console.timeEnd(`[Perf]-Diet-Fetch`);
        }

        // 🤖 Execute AI Analysis
        console.log(`[Analyze] Processing ${buffers.length} images for user: ${req.user?.userId || 'guest'} | Classification: ${profile.classification || 'unknown'} | Has Diet: ${!!expectedDiet}`);
        const result = await runAnalysis({ imageInputs: optimizedBuffers, userProfile: profile, localTime, scanMode, askDiet, mealType, expectedDiet });

        // 💾 Save to Database Asynchronously via DAL
        const userId = req.user?.userId || profile.userId || 'guest';
        const scanId = dal.createScanId();

        result.scanId = scanId;
        result.userId = userId;

        // Return JSON immediately (frontend hydration)
        res.json(result);
        console.timeEnd(`[Perf]-Total-Request-${requestId}`);
        console.log(`[Perf]-Response-Sent: Memory Heap Used: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`);

        // Execute DB saves in background with retry (FIX 6)
        (async () => {
            console.time(`[Perf]-DB-Save`);
            try {
                const identifiedItems = (result.items || []).map(i => i.name);

                const newScan = {
                    userId,
                    scanMode,
                    healthScore: result.healthScore,
                    totalMacros: {
                        protein: result.totalMacros?.protein || 0,
                        carbs: result.totalMacros?.carbs || 0,
                        fat: result.totalMacros?.fat || 0
                    },
                    summary: result.summary,
                    items: result.items,
                    identifiedItems,
                    notes,
                    clientProfile: profile,
                    timestamp: localTime
                };
                await dal.saveScan(scanId, newScan);

                // 🏎️ Update Behavioral Moat (Habits)
                if (userId !== 'guest') {
                    const existingHabit = await dal.getHabit(userId);

                    let habit = existingHabit || {
                        userId,
                        frequentItems: [],
                        preferredSwaps: [],
                        categoryDistribution: {},
                        totalCategoryPurchased: {},
                        scanHistory: [],
                        macroTrends: { avgProtein: 0, avgCarbs: 0, avgFat: 0, totalScansForAvg: 0 },
                        featureUsage: { RECEIPT: 0, MENU: 0, MEAL: 0, PLATE: 0 }
                    };

                    if (!habit.featureUsage) habit.featureUsage = { RECEIPT: 0, MENU: 0, MEAL: 0, PLATE: 0 };

                    const modeKey = scanMode || 'RECEIPT';
                    habit.featureUsage[modeKey] = (habit.featureUsage[modeKey] || 0) + 1;

                    habit.lastScan = {
                        date: localTime,
                        items: result.items.map(i => ({ name: i.name, category: i.category, score: i.score }))
                    };

                    const tripCategorized = {};
                    result.items.forEach(item => {
                        if (item.isNonFood) return;
                        const cat = item.lifestyleCategory || 'Others';
                        tripCategorized[cat] = (tripCategorized[cat] || 0) + 1;
                    });

                    if (!habit.scanHistory) habit.scanHistory = [];
                    habit.scanHistory.push({
                        scanId,
                        date: localTime,
                        mode: scanMode,
                        healthScore: result.healthScore,
                        itemCount: result.items.length,
                        totalCalories: result.totalMacros?.calories || 0,
                        categoryDistribution: tripCategorized
                    });

                    if (habit.scanHistory.length > 50) habit.scanHistory.shift();

                    if (!habit.macroTrends) habit.macroTrends = { avgProtein: 0, avgCarbs: 0, avgFat: 0, totalScansForAvg: 0 };

                    // Only update macro averages if this scan actually contained food macros
                    const hasMacros = (result.totalMacros?.protein || 0) > 0 || (result.totalMacros?.carbs || 0) > 0 || (result.totalMacros?.fat || 0) > 0;
                    if (hasMacros) {
                        const total = habit.macroTrends.totalScansForAvg || 0;
                        habit.macroTrends.avgProtein = ((habit.macroTrends.avgProtein * total) + (result.totalMacros?.protein || 0)) / (total + 1);
                        habit.macroTrends.avgCarbs = ((habit.macroTrends.avgCarbs * total) + (result.totalMacros?.carbs || 0)) / (total + 1);
                        habit.macroTrends.avgFat = ((habit.macroTrends.avgFat * total) + (result.totalMacros?.fat || 0)) / (total + 1);
                        habit.macroTrends.totalScansForAvg = total + 1;
                    }

                    if (!habit.categoryDistribution) habit.categoryDistribution = {};
                    if (!habit.totalCategoryPurchased) habit.totalCategoryPurchased = {};
                    if (!habit.frequentItems) habit.frequentItems = [];

                    result.items.forEach(item => {
                        if (item.isNonFood) return;

                        const cat = item.lifestyleCategory || 'Others';
                        habit.categoryDistribution[cat] = (habit.categoryDistribution[cat] || 0) + 1;
                        habit.totalCategoryPurchased[cat] = (habit.totalCategoryPurchased[cat] || 0) + 1;

                        const existingItem = habit.frequentItems.find(f => f.name.toLowerCase() === item.name.toLowerCase());
                        if (existingItem) {
                            existingItem.count += 1;
                            existingItem.lastSeen = localTime;
                        } else {
                            habit.frequentItems.push({ name: item.name, count: 1, lastSeen: localTime });
                        }
                    });

                    // FIX 8: Cap frequentItems at 200 to prevent Firestore 1MB doc limit
                    if (habit.frequentItems.length > 200) {
                        habit.frequentItems.sort((a, b) => b.count - a.count);
                        habit.frequentItems = habit.frequentItems.slice(0, 200);
                    }

                    await dal.saveHabit(userId, habit);
                }

            } catch (dbErr) { console.error('[Database Save/Habit Update Failed]:', dbErr.message); }
            console.timeEnd(`[Perf]-DB-Save`);
        })();
    } catch (err) {
        console.error('[Analyze Error]:', err.message);
        res.status(500).json({ error: 'Failed to process request', details: err.message });
    }
});

// Stream endpoint removed (Fix 1) — was not saving data to Firestore and had contradictory config.

/** GET /api/v1/results — Scan History (Global or by UserId) */
v1.get('/results', authenticateToken, async (req, res) => {
    try {
        // Ownership: always the caller's own scans. A userId in the query is ignored.
        const userId = req.user.userId;
        if (!userId) return res.status(403).json({ error: 'Token has no user.' });
        const history = await dal.getScans(userId, 50);

        console.log(`[API] Returning ${history.length} scans for userId: ${userId}`);
        res.json({ total: history.length, history });
    } catch (err) {
        console.error('[API-ERROR] Failed to fetch history:', err.message);
        res.status(500).json({ error: 'Failed to fetch history from database.' });
    }
});

/** GET /api/v1/results/latest — Most recent scan (FIX 7: now requires auth) */
v1.get('/results/latest', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId; // ownership: caller's own scans only
        if (!userId) return res.status(403).json({ error: 'Token has no user.' });
        const latest = await dal.getLatestScan(userId);
        if (!latest) return res.status(404).json({ error: 'No scans found.' });
        res.json(latest);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch latest scan' });
    }
});

// ── SHOPPING HABITS: Read endpoint for receipt scan graph hydration ──────────
/**
 * GET /api/v1/shopping-habits — Returns shopping behavior data for graph rendering
 * 
 * Security: JWT required + ownership check (users can only access their own habits)
 * Context: Only receipt scan data is returned for graph hydration
 * 
 * Response shape:
 * {
 *   userId, totalReceiptScans, lastScanAt,
 *   frequentItems: [{name, count, lastSeen}],      // Top 50 by count
 *   categoryDistribution: {Packaged Goods: 12, ...}, // Lifestyle category counts
 *   macroTrends: {avgProtein, avgCarbs, avgFat},     // Running averages
 *   receiptHistory: [{date, healthScore, itemCount, totalCalories}],  // Last 30 receipt scans
 *   insights: {topCategory, avgHealthScore, totalItemsTracked}
 * }
 */
v1.get('/shopping-habits', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const requestedTrips = req.query.trips ? parseInt(req.query.trips) : null;

        if (!userId || userId === 'guest') {
            return res.status(400).json({ error: 'Valid authenticated userId required.' });
        }

        const habit = await dal.getHabit(userId);

        if (!habit) {
            return res.json({
                userId,
                totalReceiptScans: 0,
                lastScanAt: null,
                frequentItems: [],
                categoryDistribution: {},
                macroTrends: { avgProtein: 0, avgCarbs: 0, avgFat: 0 },
                receiptHistory: [],
                insights: { topCategory: null, avgHealthScore: 0, totalItemsTracked: 0 }
            });
        }

        // Filter scan history to RECEIPT-only for graph context
        const receiptHistory = (habit.scanHistory || [])
            .filter(s => s.mode === 'RECEIPT')
            .slice(-30) // Buffer last 30 receipt scans
            .map(s => ({
                date: s.date,
                healthScore: s.healthScore,
                itemCount: s.itemCount,
                totalCalories: s.totalCalories || 0,
                categoryDistribution: s.categoryDistribution || {}
            }));

        // Compute insights
        const catDist = habit.categoryDistribution || {};
        const avgHealthScore = receiptHistory.length > 0
            ? +(receiptHistory.reduce((sum, s) => sum + (s.healthScore || 0), 0) / receiptHistory.length).toFixed(1)
            : 0;

        // 📊 Trip Slicing (Last 3, 5, 15) for Graph Hydration
        const getTripSlice = (count) => {
            const slice = receiptHistory.slice(-count);
            if (slice.length === 0) return { productTotal: 0, avgBasketScore: 0, tripCount: 0, categoryDistribution: { 'Packaged': 0, 'Sweets': 0, 'Superfoods': 0, 'Groceries': 0, 'Proteins': 0, 'Others': 0 } };

            const productTotal = slice.reduce((sum, s) => sum + (s.itemCount || 0), 0);
            const avgBasketScore = +(slice.reduce((sum, s) => sum + (s.healthScore || 0), 0) / slice.length).toFixed(1);

            const categoryDistribution = {
                'Packaged': 0, 'Sweets': 0, 'Superfoods': 0,
                'Groceries': 0, 'Proteins': 0, 'Others': 0
            };

            const catNorm = {
                'packaged': 'Packaged', 'packaged goods': 'Packaged',
                'sweets': 'Sweets', 'sweets/candies': 'Sweets', 'candy': 'Sweets', 'candies': 'Sweets',
                'superfoods': 'Superfoods', 'superfood': 'Superfoods',
                'daily': 'Groceries', 'daily groceries': 'Groceries', 'groceries': 'Groceries', 'grocery': 'Groceries',
                'proteins': 'Proteins', 'protein': 'Proteins',
                'others': 'Others', 'other': 'Others'
            };

            slice.forEach(scan => {
                const scanDist = scan.categoryDistribution || {};
                const itemsInDist = Object.values(scanDist).reduce((s, v) => s + v, 0);

                if (itemsInDist > 0) {
                    Object.entries(scanDist).forEach(([cat, val]) => {
                        const normCat = catNorm[cat.toLowerCase().trim()] || 'Others';
                        categoryDistribution[normCat] = (categoryDistribution[normCat] || 0) + val;
                    });

                    const missing = (scan.itemCount || 0) - itemsInDist;
                    if (missing > 0) categoryDistribution['Others'] += missing;
                } else {
                    categoryDistribution['Others'] += (scan.itemCount || 0);
                }
            });

            return { productTotal, avgBasketScore, tripCount: slice.length, categoryDistribution };
        };

        const tripSlices = {
            last3: getTripSlice(3),
            last5: getTripSlice(5),
            last15: getTripSlice(15)
        };

        // Final Logic for Root Response: if a specific trip count is requested, use it as the main data
        let finalCategoryDistribution = catDist;
        let finalAvgBasketScore = avgHealthScore;

        if (requestedTrips) {
            const specificSlice = getTripSlice(requestedTrips);
            finalCategoryDistribution = specificSlice.categoryDistribution;
            finalAvgBasketScore = specificSlice.avgBasketScore;
            console.log(`[Habits] Filtering root data for last ${requestedTrips} trips for user: ${userId}`);
        }

        const topCategory = Object.entries(finalCategoryDistribution).sort(([, a], [, b]) => b - a)[0]?.[0] || null;
        const frequentItems = (habit.frequentItems || []).sort((a, b) => b.count - a.count).slice(0, 50);

        res.json({
            userId,
            totalReceiptScans: receiptHistory.length,
            requestedTripsWindow: requestedTrips,
            lastScanAt: habit.lastScanAt || null,
            frequentItems,
            categoryDistribution: finalCategoryDistribution,
            macroTrends: {
                avgProtein: +(habit.macroTrends?.avgProtein || 0).toFixed(1),
                avgCarbs: +(habit.macroTrends?.avgCarbs || 0).toFixed(1),
                avgFat: +(habit.macroTrends?.avgFat || 0).toFixed(1),
            },
            receiptHistory,
            tripSlices,
            insights: {
                topCategory,
                avgHealthScore: finalAvgBasketScore,
                totalItemsTracked: (habit.frequentItems || []).length,
                ...tripSlices
            }
        });
    } catch (err) {
        console.error('[Shopping Habits Error]:', err.message);
        res.status(500).json({ error: 'Failed to fetch shopping habits.' });
    }
});


/** GET /api/v1/debug — Diagnostic check */
/** Public browser config. Only non-secret, client-safe values belong here. */
v1.get('/client-config', async (req, res) => {
    const key = (process.env.POSTHOG_KEY || '').trim();
    const auth = getWebAuthConfig();
    if (auth) auth.enabledProviders = await getEnabledProviders(); // null = unknown
    res.json({
        auth,                                  // null → sign-in not configured
        guestMode: GUEST_MODE,
        legacyClientIdLogin: LEGACY_USERID_LOGIN,
        posthog: key ? {
            key, // phc_… project key — designed to be public
            host: (process.env.POSTHOG_HOST || 'https://eu.i.posthog.com').trim(),
        } : null,
    });
});

v1.get('/debug', (req, res) => {
    const geminiKey = process.env.GEMINI_API_KEY;
    res.json({ status: 'diagnostic', apiVersion: 'v1', env: { GEMINI_API_KEY: geminiKey ? 'Set ✓' : '❌' } });
});

// ── BEHAVIORAL MOAT: PREFERENCES ─────────────────────────────────────────────
/** 
 * POST /api/v1/swaps/select — Track when a user "likes" or chooses an alternative
 */
v1.post('/swaps/select', authenticateToken, async (req, res) => {
    try {
        const { scanId, original, chosen } = req.body;
        const selected = req.body.selected !== false; // false = the user un-picked this swap
        const userId = req.user.userId;

        if (!original || !chosen) {
            return res.status(400).json({ error: 'Original item and Chosen swap are required' });
        }

        // 1. UPDATE BEHAVIORAL MOAT (HABITS) via DAL
        if (userId !== 'guest' && selected) {
            try {
                await dal.recordSwapPreference(userId, original, chosen);
            } catch (err) {
                console.error('[Swap Habit Update Error]:', err.message);
            }
        }

        // 2. PERSIST TO SAVED HISTORY (SCANS) via DAL
        if (scanId) {
            try {
                await dal.updateScanSwap(scanId, original, selected ? chosen : null);
            } catch (err) {
                console.error('[Swap Scan Update Error]:', err.message);
            }
        }

        res.json({ status: 'success', message: 'Preference saved to history and moat' });
    } catch (err) {
        console.error('[Swap Select Error]:', err.message);
        res.status(500).json({ error: 'Failed to save preference' });
    }
});


// ── SERVER START ─────────────────────────────────────────────────────────────

const startServer = (port) => {
    // Start gRPC server
    const grpcServer = startGrpcServer();

    // Standardize universally on robust HTTP/1.1 for the Express API. Cloud Run LB natively translates 
    // multiplexed incoming HTTP/2 traffic into lightning fast HTTP/1.1 for the container.
    const protocolServer = http.createServer(app);

    const server = protocolServer.listen(port, () => {
        const protoLabel = 'HTTP/1.1 (Standard)';
        console.log(`\n✅ NutriScan API v4.0 (${protoLabel}) Running on http://localhost:${port}`);
        console.log(`   API (JSON/Dashboard): Port ${port} (Express)`);
        console.log(`   gRPC (Microservice): Port ${process.env.GRPC_PORT || 50051} (Node-gRPC)`);
        console.log(`   v1 Endpoints: /api/v1/analyze, /api/v1/results, /api/v1/health, /api/v1/debug`);
        console.log(`   Legacy Redirects: /api/* → /api/v1/* (backward compatible)\n`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`❌ Port ${port} is already in use.`);
            console.error(`   To Fix: Kill existing Node processes or specify a different PORT in .env`);
            // We exit here because moving to port 3003, 3004... breaks the frontend URL config.
            process.exit(1);
        } else {
            console.error('[CRITICAL] Server failed to start:', err);
        }
    });

    // Graceful Shutdown Handler
    const shutdown = async () => {
        console.log('\n[SHUTDOWN] Signal received. Closing connections...');
        await closeDB();
        server.close(() => {
            console.log('[SHUTDOWN] HTTP server closed. Process exiting.');
            process.exit(0);
        });

        // Force exit if server doesn't close in 10s
        setTimeout(() => {
            console.error('[SHUTDOWN] Could not close connections in time, forcefully shutting down');
            process.exit(1);
        }, 10000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
};

// ── AUTHENTICATION: Access + Refresh Token Flow ──────────────────────────

const hashToken = (rawToken) => crypto.createHash('sha256').update(rawToken).digest('hex');

/**
 * Helper: Generate an Access + Refresh token pair
 */
async function generateTokenPair(userId, deviceInfo = 'unknown') {
    const accessToken = jwt.sign({ userId }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
    const rawRefreshToken = crypto.randomBytes(64).toString('hex');
    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await dal.saveRefreshToken(userId, tokenHash, deviceInfo, expiresAt);

    return {
        accessToken,
        refreshToken: rawRefreshToken,
        accessExpires: ACCESS_TOKEN_EXPIRY,
        refreshExpires: `${REFRESH_TOKEN_EXPIRY_DAYS}d`
    };
}

/** POST /api/v1/auth/token — Login: Generate Access + Refresh tokens */
v1.post('/auth/token', authLimiter, async (req, res) => {
    // This endpoint trusts whatever userId the caller sends, so it is OFF unless
    // ALLOW_LEGACY_USERID_LOGIN=true. Use POST /auth/firebase for real sign-in.
    if (!LEGACY_USERID_LOGIN) {
        return res.status(403).json({
            error: 'Client-ID login is disabled. Sign in with Google or Apple.',
            code: 'LEGACY_LOGIN_DISABLED'
        });
    }
    const { userId, deviceInfo } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    try {
        const tokens = await generateTokenPair(userId, deviceInfo || req.headers['user-agent'] || 'unknown');
        console.log(`[AUTH] Token pair issued for user: ${userId}`);
        res.json({
            token: tokens.accessToken,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expires: tokens.accessExpires,
            refreshExpires: tokens.refreshExpires
        });
    } catch (err) {
        console.error('[AUTH ERROR] Token generation failed:', err.message);
        // Fallback for missing/incorrect database ID in production
        if (err.message.includes('NOT_FOUND') || err.message.includes('database')) {
            console.error('[CRITICAL] The specified database was not found. Please ensure Firestore is enabled and the DB name matches.');
        }
        res.status(500).json({
            error: 'Failed to generate tokens',
            details: err.message, // TEMPORARY DEBUG: Expose actual error instead of hiding it in prod
            stack: err.stack
        });
    }
});

/** POST /api/v1/auth/refresh — Use refresh token to get a new access token */
v1.post('/auth/refresh', authLimiter, async (req, res) => {
    const { refreshToken, userId } = req.body;
    if (!refreshToken || !userId) {
        return res.status(400).json({ error: 'refreshToken and userId are required' });
    }

    try {
        const tokenHash = hashToken(refreshToken);
        const tokenDoc = await dal.getRefreshToken(tokenHash);

        if (!tokenDoc.exists || tokenDoc.data.userId !== userId) {
            return res.status(403).json({ error: 'Invalid refresh token. Please log in again.', code: 'REFRESH_INVALID' });
        }

        const storedData = tokenDoc.data;
        if (storedData.expiresAt.toDate() < new Date()) {
            await tokenDoc.delete();
            return res.status(403).json({ error: 'Refresh token expired. Please log in again.', code: 'REFRESH_EXPIRED' });
        }

        await tokenDoc.delete();
        const tokens = await generateTokenPair(userId, storedData.deviceInfo);

        console.log(`[AUTH] Token refreshed for user: ${userId}`);
        res.json({
            token: tokens.accessToken,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expires: tokens.accessExpires,
            refreshExpires: tokens.refreshExpires
        });
    } catch (err) {
        console.error('[AUTH] Refresh failed:', err.message);
        res.status(500).json({ error: 'Token refresh failed' });
    }
});

// ── ACCOUNTS: Google / Apple sign-in + BN program linking ───────────────────
// Token subject (userId) is the linked BN client ID when there is one, so a
// client's existing scans and habits carry over; otherwise 'acct_<uid>'.

const ACCOUNT_PREFIX = 'acct_';
const subjectFor = (account) => account.bnClientId ? String(account.bnClientId) : ACCOUNT_PREFIX + account.uid;

const publicAccount = (account) => ({
    email: account.email || null,
    name: account.name || null,
    picture: account.picture || null,
    provider: account.provider || null,
    bnClientId: account.bnClientId || null,
});

/** Resolve the signed-in account behind a verified access token, or null. */
async function resolveAccount(tokenUser) {
    const subject = String(tokenUser?.userId || '');
    if (!subject) return null;
    if (subject.startsWith(ACCOUNT_PREFIX)) return await dal.getUser(subject.slice(ACCOUNT_PREFIX.length));
    return await dal.getUserByBnClientId(subject);
}

const tokenResponse = (tokens, account) => ({
    token: tokens.accessToken,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expires: tokens.accessExpires,
    refreshExpires: tokens.refreshExpires,
    userId: subjectFor(account),
    account: publicAccount(account),
});

/** POST /api/v1/auth/firebase — exchange a verified Google/Apple sign-in for app tokens */
v1.post('/auth/firebase', authLimiter, async (req, res) => {
    const { idToken, deviceInfo } = req.body || {};
    if (!idToken) return res.status(400).json({ error: 'idToken is required' });

    let identity;
    try {
        identity = await verifySignInToken(idToken);
    } catch (err) {
        console.warn('[AUTH] Sign-in token rejected:', err.code || err.message);
        return res.status(401).json({ error: 'Sign-in could not be verified. Please sign in again.', code: 'SIGNIN_INVALID' });
    }

    try {
        const existing = await dal.getUser(identity.uid);
        const profile = {
            email: identity.email,
            emailVerified: identity.emailVerified,
            name: identity.name,
            picture: identity.picture,
            provider: identity.provider,
            lastLoginAt: new Date().toISOString(),
            ...(existing ? {} : { createdAt: new Date().toISOString(), bnClientId: null }),
        };
        await dal.saveUser(identity.uid, profile);
        const account = { ...(existing || {}), ...profile, uid: identity.uid };

        // A guest who signs in keeps what they did as a guest.
        let carriedOver = null;
        const { guestSecret } = req.body || {};
        if (validGuestSecret(guestSecret)) {
            const guestId = guestIdFor(guestSecret);
            try {
                carriedOver = await dal.reassignUserData(guestId, subjectFor(account));
                console.log(`[AUTH] Guest data moved ${guestId} → ${subjectFor(account)}:`, carriedOver);
            } catch (e) {
                console.error('[AUTH] Guest hand-over failed (sign-in continues):', e.message);
            }
        }

        const tokens = await generateTokenPair(subjectFor(account), deviceInfo || req.headers['user-agent'] || 'unknown');
        console.log(`[AUTH] ${existing ? 'Sign-in' : 'New account'} via ${identity.provider}: ${identity.uid} → ${subjectFor(account)}`);
        res.json({ ...tokenResponse(tokens, account), isNewAccount: !existing, carriedOver });
    } catch (err) {
        console.error('[AUTH] Account sign-in failed:', err.message);
        res.status(500).json({ error: 'Could not complete sign-in. Please try again.' });
    }
});

/**
 * POST /api/v1/auth/guest — use the app without signing in.
 * Body { guestSecret? }: omit it to start a new guest, send it to come back as the same guest.
 * The guest ID is derived from the secret, so it can't be guessed or claimed by anyone else.
 */
v1.post('/auth/guest', authLimiter, async (req, res) => {
    if (!GUEST_MODE) return res.status(403).json({ error: 'Please sign in to continue.', code: 'GUEST_DISABLED' });

    let { guestSecret } = req.body || {};
    const isNew = !guestSecret;
    if (isNew) guestSecret = crypto.randomBytes(32).toString('hex');
    if (!validGuestSecret(guestSecret)) return res.status(400).json({ error: 'Invalid guest session.', code: 'BAD_GUEST' });

    try {
        const guestId = guestIdFor(guestSecret);
        const tokens = await generateTokenPair(guestId, req.headers['user-agent'] || 'unknown');
        console.log(`[AUTH] ${isNew ? 'New guest' : 'Guest resumed'}: ${guestId}`);
        res.json({
            token: tokens.accessToken,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expires: tokens.accessExpires,
            refreshExpires: tokens.refreshExpires,
            userId: guestId,
            account: null,
            guest: true,
            guestSecret,
            isNewGuest: isNew,
        });
    } catch (err) {
        console.error('[AUTH] Guest session failed:', err.message);
        res.status(500).json({ error: 'Could not start. Please try again.' });
    }
});

/** GET /api/v1/auth/me — the signed-in account (null for legacy client-ID tokens) */
v1.get('/auth/me', authenticateToken, async (req, res) => {
    try {
        const account = await resolveAccount(req.user);
        res.json({ userId: req.user.userId, account: account ? publicAccount(account) : null });
    } catch (err) {
        console.error('[AUTH] /me failed:', err.message);
        res.status(500).json({ error: 'Could not load account.' });
    }
});

/**
 * POST /api/v1/auth/link-bn — link a Balance Nutrition program to this account.
 * Proof of ownership: the email registered on the BN program must equal the
 * verified email of the sign-in. Returns fresh tokens for the BN client ID.
 */
v1.post('/auth/link-bn', authLimiter, authenticateToken, async (req, res) => {
    const clientId = String(req.body?.clientId || '').trim();
    if (!/^\d{3,12}$/.test(clientId)) {
        return res.status(400).json({ error: 'Enter your BN client ID (numbers only).', code: 'BAD_CLIENT_ID' });
    }

    try {
        const account = await resolveAccount(req.user);
        if (!account) return res.status(403).json({ error: 'Sign in with Google or Apple first.', code: 'NO_ACCOUNT' });
        if (!account.email || !account.emailVerified) {
            return res.status(403).json({ error: 'Your sign-in has no verified email, so a BN program cannot be linked.', code: 'EMAIL_UNVERIFIED' });
        }

        const owner = await dal.getUserByBnClientId(clientId);
        if (owner && owner.uid !== account.uid) {
            return res.status(409).json({ error: 'This BN program is already linked to another account.', code: 'ALREADY_LINKED' });
        }

        let bn;
        try {
            const r = await fetch(`${BN_API_BASE}/client-details/get-single-client-by-user_id?user_id=${encodeURIComponent(clientId)}`, { signal: AbortSignal.timeout(10000) });
            bn = await r.json();
        } catch (e) {
            console.error('[AUTH] BN lookup failed:', e.message);
            return res.status(502).json({ error: 'Could not reach Balance Nutrition right now. Try again shortly.', code: 'BN_UNAVAILABLE' });
        }

        const bnEmail = String(bn?.data?.client_details?.email_id || '').trim().toLowerCase();
        // Same response for "no such client" and "email differs" so IDs cannot be probed.
        if (bn?.status !== 'success' || !bnEmail || bnEmail !== account.email) {
            console.warn(`[AUTH] Link refused for account ${account.uid} → BN ${clientId}`);
            return res.status(403).json({
                error: 'We could not match that client ID to your sign-in email. Sign in with the email registered with Balance Nutrition, or ask your mentor to update it.',
                code: 'LINK_MISMATCH'
            });
        }

        await dal.saveUser(account.uid, { bnClientId: clientId, bnLinkedAt: new Date().toISOString() });
        const linked = { ...account, bnClientId: clientId };
        const tokens = await generateTokenPair(subjectFor(linked), req.headers['user-agent'] || 'unknown');
        console.log(`[AUTH] Account ${account.uid} linked to BN client ${clientId}`);
        res.json(tokenResponse(tokens, linked));
    } catch (err) {
        console.error('[AUTH] Link failed:', err.message);
        res.status(500).json({ error: 'Could not link the program. Please try again.' });
    }
});

/** POST /api/v1/auth/unlink-bn — detach the BN program; returns tokens for the bare account */
v1.post('/auth/unlink-bn', authLimiter, authenticateToken, async (req, res) => {
    try {
        const account = await resolveAccount(req.user);
        if (!account) return res.status(403).json({ error: 'Sign in with Google or Apple first.', code: 'NO_ACCOUNT' });

        await dal.saveUser(account.uid, { bnClientId: null, bnLinkedAt: null });
        const unlinked = { ...account, bnClientId: null };
        const tokens = await generateTokenPair(subjectFor(unlinked), req.headers['user-agent'] || 'unknown');
        console.log(`[AUTH] Account ${account.uid} unlinked from BN`);
        res.json(tokenResponse(tokens, unlinked));
    } catch (err) {
        console.error('[AUTH] Unlink failed:', err.message);
        res.status(500).json({ error: 'Could not unlink the program.' });
    }
});

/** POST /api/v1/auth/revoke — Logout: Invalidate a refresh token */
v1.post('/auth/revoke', async (req, res) => {
    const { refreshToken, userId, revokeAll } = req.body;

    try {
        if (revokeAll && userId) {
            const count = await dal.revokeAllTokens(userId);
            console.log(`[AUTH] Revoked all ${count} sessions for user: ${userId}`);
            return res.json({ status: 'success', message: `All ${count} sessions revoked` });
        }

        if (!refreshToken) {
            return res.status(400).json({ error: 'refreshToken is required (or set revokeAll: true)' });
        }

        const tokenHash = hashToken(refreshToken);
        await dal.deleteRefreshToken(tokenHash);

        console.log(`[AUTH] Single session revoked`);
        res.json({ status: 'success', message: 'Session revoked' });
    } catch (err) {
        console.error('[AUTH] Revoke failed:', err.message);
        res.status(500).json({ error: 'Failed to revoke token' });
    }
});

// ── HEALTH: phone-synced steps, energy, workouts + daily insights ───────────
v1.use('/health', createHealthRouter({ dal, authenticateToken }));

// ── MOUNT v1 ROUTER ──────────────────────────────────────────────────────────

app.use('/api/v1', v1);

// ── BACKWARD COMPATIBILITY: Legacy /api/* → /api/v1/* Redirects ──────────────
// This ensures existing mobile apps and the frontend dashboard continue working
// while we transition to versioned endpoints.

app.all('/api/analyze', (req, res) => { req.url = '/api/v1/analyze'; app.handle(req, res); });
// Legacy /api/stream redirect removed (Fix 1)
app.all('/api/results/latest', (req, res) => { req.url = '/api/v1/results/latest'; app.handle(req, res); });
app.all('/api/results', (req, res) => { req.url = '/api/v1/results'; app.handle(req, res); });
app.all('/api/health', (req, res) => { req.url = '/api/v1/health'; app.handle(req, res); });
app.all('/api/debug', (req, res) => { req.url = '/api/v1/debug'; app.handle(req, res); });
app.all('/api/swaps/select', (req, res) => { req.url = '/api/v1/swaps/select'; app.handle(req, res); });
app.all('/api/auth/token', (req, res) => { req.url = '/api/v1/auth/token'; app.handle(req, res); });
app.all('/api/auth/refresh', (req, res) => { req.url = '/api/v1/auth/refresh'; app.handle(req, res); });
app.all('/api/auth/revoke', (req, res) => { req.url = '/api/v1/auth/revoke'; app.handle(req, res); });

// ── GLOBAL ERROR HANDLER ─────────────────────────────────────────────────────
// Guarantees JSON responses for all errors (prevents mobile app HTML parse crashes)

app.use((err, req, res, next) => {
    console.error('[GLOBAL_ERROR]', err.message);
    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal Server Error',
        apiVersion: 'v1'
    });
});

startServer(PORT);

export default app;
