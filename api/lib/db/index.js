/**
 * Database Abstraction Layer — Driver Controller
 * 
 * This is the ONLY file that the rest of the application imports.
 * It dynamically loads the correct database driver based on the
 * DB_PROVIDER environment variable and wraps every method with:
 *   - Retry logic with exponential backoff
 *   - Structured logging
 *   - Input validation
 *   - Graceful error handling
 * 
 * Usage:
 *   import { initDB, db } from './lib/db/index.js';
 *   await initDB();
 *   await db.saveScan(id, data);   // Retries automatically
 *
 * Supported DB_PROVIDER values:
 *   - 'firestore' (default)  → api/lib/db/firestore.js
 *   - 'postgres'  (future)   → api/lib/db/postgres.js
 *   - 'mongo'     (future)   → api/lib/db/mongo.js
 */

// ── Driver Registry ──────────────────────────────────────────────────────────
const DRIVER_MAP = {
    firestore: () => import('./firestore.js'),
    postgres:  () => import('./postgres.js'),
    mongodb:   () => import('./mongo.js'),
};

const SUPPORTED_PROVIDERS = Object.keys(DRIVER_MAP);

// ── Internal state ───────────────────────────────────────────────────────────
/** @type {import('./interface.js').DatabaseDriver | null} */
let _driver = null;

// ── RETRY CONFIGURATION ─────────────────────────────────────────────────────
const RETRY_CONFIG = {
    maxRetries: 2,
    baseDelayMs: 500,
    // Methods that are safe/meaningful to retry on transient failure
    retryable: new Set([
        'saveScan', 'saveHabit', 'saveRefreshToken', 'deleteRefreshToken',
        'revokeAllTokens', 'recordSwapPreference', 'updateScanSwap', 'saveUser', 'saveHealthDay'
    ])
};

// ── RETRY WRAPPER ────────────────────────────────────────────────────────────

/**
 * Execute an operation with exponential backoff retry for transient failures.
 * @param {Function} operation — async function to execute
 * @param {string} label — operation name for logging
 * @param {number} maxRetries
 * @returns {Promise<*>} result of the operation
 */
async function withRetry(operation, label, maxRetries = RETRY_CONFIG.maxRetries) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (err) {
            const isLast = attempt === maxRetries;
            const delay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);

            if (isLast) {
                console.error(`[DAL-${label}] ❌ PERMANENT FAILURE after ${maxRetries + 1} attempts: ${err.message}`);
                throw err; // Re-throw so callers can handle it
            }

            console.warn(`[DAL-${label}] Attempt ${attempt + 1}/${maxRetries + 1} failed: ${err.message} — retrying in ${delay}ms`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

// ── INITIALIZATION ───────────────────────────────────────────────────────────

/**
 * Initialize the database abstraction layer.
 * Reads DB_PROVIDER from env, dynamically imports the driver, and calls init().
 * Must be called once at boot before any other db operation.
 * 
 * @returns {Promise<boolean>} true if initialization succeeded
 * @throws {Error} if provider is unsupported or init fails
 */
export async function initDB() {
    const provider = (process.env.DB_PROVIDER || 'firestore').toLowerCase().trim();

    if (!SUPPORTED_PROVIDERS.includes(provider)) {
        throw new Error(
            `❌ [DAL] Unsupported DB_PROVIDER: '${provider}'. ` +
            `Supported: ${SUPPORTED_PROVIDERS.join(', ')}`
        );
    }

    console.log(`\n🔧 [DAL] Initializing database driver: ${provider}`);

    try {
        const module = await DRIVER_MAP[provider]();
        const DriverClass = module.default || module[Object.keys(module).find(k => k.endsWith('Driver'))];

        if (!DriverClass) {
            throw new Error(`Driver module for '${provider}' does not export a valid driver class.`);
        }

        _driver = new DriverClass();
        const success = await _driver.init();

        if (!success) {
            throw new Error(`Driver.init() returned false`);
        }

        console.log(`✅ [DAL] Driver '${provider}' initialized successfully.\n`);
        return true;
    } catch (err) {
        console.error(`❌ [DAL] Failed to initialize driver '${provider}': ${err.message}`);
        throw err;
    }
}

/**
 * Gracefully shut down the database connection.
 * Should be called during process shutdown.
 */
export async function closeDB() {
    if (_driver) {
        await _driver.close();
        console.log(`[DAL] Driver '${_driver.provider}' closed.`);
    }
}

// ── GUARD ────────────────────────────────────────────────────────────────────

function ensureReady() {
    if (!_driver || !_driver.isReady) {
        throw new Error('[DAL] Database not initialized. Call initDB() first.');
    }
}

// ── EXPORTED OPERATIONS ──────────────────────────────────────────────────────
// Each method validates inputs, delegates to the driver, and applies retry for writes.

/** @returns {string} active provider name */
export function getProvider() { return _driver?.provider || 'none'; }

/** @returns {string} database name (Firestore-specific, or 'default' for others) */
export function getDBName() { return _driver?._dbName || 'unknown'; }

/** Get the raw underlying client (escape hatch — use sparingly) */
export function getRawClient() {
    ensureReady();
    return _driver._client || null;
}

// ── HEALTH ───────────────────────────────────────────────────────────────────

export async function healthCheck() {
    ensureReady();
    return await _driver.healthCheck();
}

// ── SCANS ────────────────────────────────────────────────────────────────────

export function createScanId() {
    ensureReady();
    return _driver.createScanId();
}

export async function saveScan(scanId, scanData) {
    ensureReady();
    if (!scanId) throw new Error('[DAL] saveScan: scanId is required');
    if (!scanData || typeof scanData !== 'object') throw new Error('[DAL] saveScan: scanData must be an object');

    await withRetry(() => _driver.saveScan(scanId, scanData), 'ScanSave');
}

export async function getScans(userId, limit = 50) {
    ensureReady();
    return await _driver.getScans(userId, limit);
}

export async function getLatestScan(userId) {
    ensureReady();
    return await _driver.getLatestScan(userId);
}

export async function updateScanSwap(scanId, originalItemName, chosenAlternative) {
    ensureReady();
    if (!scanId) throw new Error('[DAL] updateScanSwap: scanId is required');
    if (!originalItemName) throw new Error('[DAL] updateScanSwap: original is required');
    // chosenAlternative === null clears a previous selection

    await withRetry(() => _driver.updateScanSwap(scanId, originalItemName, chosenAlternative), 'SwapUpdate');
}

// ── HABITS ───────────────────────────────────────────────────────────────────

export async function getHabit(userId) {
    ensureReady();
    if (!userId) throw new Error('[DAL] getHabit: userId is required');
    return await _driver.getHabit(userId);
}

export async function saveHabit(userId, habitData) {
    ensureReady();
    if (!userId) throw new Error('[DAL] saveHabit: userId is required');
    if (!habitData || typeof habitData !== 'object') throw new Error('[DAL] saveHabit: habitData must be an object');

    await withRetry(() => _driver.saveHabit(userId, habitData), 'HabitSave');
}

export async function recordSwapPreference(userId, original, chosen) {
    ensureReady();
    if (!userId || !original || !chosen) throw new Error('[DAL] recordSwapPreference: userId, original, and chosen are required');

    await withRetry(() => _driver.recordSwapPreference(userId, original, chosen), 'SwapPref');
}

// ── AUTH / REFRESH TOKENS ────────────────────────────────────────────────────

export async function saveRefreshToken(userId, tokenHash, deviceInfo, expiresAt) {
    ensureReady();
    if (!userId || !tokenHash) throw new Error('[DAL] saveRefreshToken: userId and tokenHash are required');

    await withRetry(() => _driver.saveRefreshToken(userId, tokenHash, deviceInfo, expiresAt), 'TokenSave');
}

export async function getRefreshToken(tokenHash) {
    ensureReady();
    if (!tokenHash) throw new Error('[DAL] getRefreshToken: tokenHash is required');
    return await _driver.getRefreshToken(tokenHash);
}

export async function deleteRefreshToken(tokenHash) {
    ensureReady();
    if (!tokenHash) throw new Error('[DAL] deleteRefreshToken: tokenHash is required');

    await withRetry(() => _driver.deleteRefreshToken(tokenHash), 'TokenDelete');
}

export async function revokeAllTokens(userId) {
    ensureReady();
    if (!userId) throw new Error('[DAL] revokeAllTokens: userId is required');

    return await withRetry(() => _driver.revokeAllTokens(userId), 'TokenRevokeAll');
}

// ── HEALTH ───────────────────────────────────────────────────────────────────

export async function saveHealthDay(userId, date, data) {
    ensureReady();
    if (!userId) throw new Error('[DAL] saveHealthDay: userId is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('[DAL] saveHealthDay: date must be YYYY-MM-DD');
    await withRetry(() => _driver.saveHealthDay(userId, date, data), 'HealthDaySave');
}

export async function getHealthDays(userId, dates) {
    ensureReady();
    if (!userId) throw new Error('[DAL] getHealthDays: userId is required');
    return await _driver.getHealthDays(userId, dates || []);
}

export async function saveHealthKey(keyHash, userId) {
    ensureReady();
    if (!keyHash || !userId) throw new Error('[DAL] saveHealthKey: keyHash and userId are required');
    await _driver.saveHealthKey(keyHash, userId);
}

export async function getHealthKey(keyHash) {
    ensureReady();
    if (!keyHash) return null;
    return await _driver.getHealthKey(keyHash);
}

export async function getHealthKeyInfo(userId) {
    ensureReady();
    if (!userId) return null;
    return await _driver.getHealthKeyInfo(userId);
}

export async function touchHealthKey(keyHash) {
    ensureReady();
    await _driver.touchHealthKey(keyHash);
}

export async function deleteHealthKeys(userId) {
    ensureReady();
    if (!userId) throw new Error('[DAL] deleteHealthKeys: userId is required');
    return await _driver.deleteHealthKeys(userId);
}

export async function reassignUserData(fromUserId, toUserId) {
    ensureReady();
    if (!fromUserId || !toUserId) throw new Error('[DAL] reassignUserData: both user IDs are required');
    if (fromUserId === toUserId) return { scans: 0, healthDays: 0, healthKeys: 0, habits: 0 };
    return await _driver.reassignUserData(fromUserId, toUserId);
}

// ── ACCOUNTS ─────────────────────────────────────────────────────────────────

export async function getUser(uid) {
    ensureReady();
    if (!uid) throw new Error('[DAL] getUser: uid is required');
    return await _driver.getUser(uid);
}

export async function saveUser(uid, data) {
    ensureReady();
    if (!uid) throw new Error('[DAL] saveUser: uid is required');
    if (!data || typeof data !== 'object') throw new Error('[DAL] saveUser: data must be an object');

    await withRetry(() => _driver.saveUser(uid, data), 'UserSave');
}

export async function getUserByBnClientId(bnClientId) {
    ensureReady();
    if (!bnClientId) throw new Error('[DAL] getUserByBnClientId: bnClientId is required');
    return await _driver.getUserByBnClientId(bnClientId);
}

// ── UNIFIED EXPORT ───────────────────────────────────────────────────────────

export const db = {
    init: initDB,
    close: closeDB,
    getProvider,
    getDBName,
    getRawClient,
    healthCheck,
    // Scans
    createScanId,
    saveScan,
    getScans,
    getLatestScan,
    updateScanSwap,
    // Habits
    getHabit,
    saveHabit,
    recordSwapPreference,
    // Auth
    saveRefreshToken,
    getRefreshToken,
    deleteRefreshToken,
    revokeAllTokens,
    // Health
    saveHealthDay,
    getHealthDays,
    saveHealthKey,
    getHealthKey,
    getHealthKeyInfo,
    touchHealthKey,
    deleteHealthKeys,
    reassignUserData,
    // Accounts
    getUser,
    saveUser,
    getUserByBnClientId,
};

export default db;
