/**
 * DatabaseDriver — Abstract Interface Contract
 * 
 * Every database driver MUST implement every method defined here.
 * This is the single source of truth for the DAL contract.
 * 
 * Drivers:
 *   - FirestoreDriver  (api/lib/db/firestore.js)   — Production default
 *   - PostgresDriver   (api/lib/db/postgres.js)    — Future
 *   - MongoDriver      (api/lib/db/mongo.js)       — Future
 * 
 * Rules:
 *   1. All methods MUST return plain JS objects/arrays — never SDK-specific types.
 *   2. Dates MUST be returned as ISO 8601 strings or native Date objects.
 *   3. IDs MUST be returned as strings.
 *   4. If a document is not found, return null (not undefined, not an error).
 *   5. Errors MUST be thrown as standard Error objects with descriptive messages.
 */

export class DatabaseDriver {
    constructor(providerName) {
        this._provider = providerName;
        this._ready = false;
    }

    /** Provider name for diagnostics (e.g. 'firestore', 'postgres') */
    get provider() { return this._provider; }

    /** Whether init() has been called and succeeded */
    get isReady() { return this._ready; }

    // ── LIFECYCLE ────────────────────────────────────────────────────────────

    /**
     * Initialize the database connection.
     * Must be called once at boot before any other method.
     * @returns {Promise<boolean>} true if initialization succeeded
     */
    async init() { throw new Error(`${this._provider}.init() not implemented`); }

    /**
     * Gracefully close the database connection.
     * Called during shutdown.
     */
    async close() { /* Default no-op — override if driver needs cleanup */ }

    // ── HEALTH ───────────────────────────────────────────────────────────────

    /**
     * Run a database health check (read + write test).
     * @returns {Promise<{ connection: string, readWrite: string, provider: string, latencyMs: number }>}
     */
    async healthCheck() { throw new Error(`${this._provider}.healthCheck() not implemented`); }

    // ── SCANS ────────────────────────────────────────────────────────────────

    /**
     * Generate a new unique scan ID.
     * @returns {string} A unique identifier string
     */
    createScanId() { throw new Error(`${this._provider}.createScanId() not implemented`); }

    /**
     * Persist a scan result.
     * The driver MUST add createdAt and createdAtIST timestamps.
     * @param {string} scanId
     * @param {object} scanData — plain object with scan fields
     * @returns {Promise<void>}
     */
    async saveScan(scanId, scanData) { throw new Error(`${this._provider}.saveScan() not implemented`); }

    /**
     * Query scan history, ordered by creation date descending.
     * @param {string|null} userId — filter by user, or null for all
     * @param {number} limit — max results (default 50)
     * @returns {Promise<Array<{ id: string, createdAt: Date, ...scanFields }>>}
     */
    async getScans(userId, limit = 50) { throw new Error(`${this._provider}.getScans() not implemented`); }

    /**
     * Get the most recent scan.
     * @param {string|null} userId — filter by user, or null for most recent global
     * @returns {Promise<{ id: string, createdAt: Date, ...scanFields } | null>}
     */
    async getLatestScan(userId) { throw new Error(`${this._provider}.getLatestScan() not implemented`); }

    /**
     * Atomically update a scan's items array to record a swap selection.
     * @param {string} scanId
     * @param {string} originalItemName — the item being replaced
     * @param {string} chosenAlternative — the chosen replacement
     * @returns {Promise<void>}
     */
    async updateScanSwap(scanId, originalItemName, chosenAlternative) {
        throw new Error(`${this._provider}.updateScanSwap() not implemented`);
    }

    // ── HABITS ───────────────────────────────────────────────────────────────

    /**
     * Get a user's habit document.
     * @param {string} userId
     * @returns {Promise<object|null>} habit data or null if not found
     */
    async getHabit(userId) { throw new Error(`${this._provider}.getHabit() not implemented`); }

    /**
     * Save/merge a user's habit document.
     * The driver MUST set lastScanAt to the current server timestamp.
     * @param {string} userId
     * @param {object} habitData — plain object (will be merged, not replaced)
     * @returns {Promise<void>}
     */
    async saveHabit(userId, habitData) { throw new Error(`${this._provider}.saveHabit() not implemented`); }

    /**
     * Atomically record a swap preference in a user's habit document.
     * @param {string} userId
     * @param {string} original — original item name
     * @param {string} chosen — chosen alternative name
     * @returns {Promise<void>}
     */
    async recordSwapPreference(userId, original, chosen) {
        throw new Error(`${this._provider}.recordSwapPreference() not implemented`);
    }

    // ── AUTH / REFRESH TOKENS ────────────────────────────────────────────────

    /**
     * Store a refresh token.
     * @param {string} userId
     * @param {string} tokenHash — SHA-256 hash of the raw token
     * @param {string} deviceInfo
     * @param {Date} expiresAt
     * @returns {Promise<void>}
     */
    async saveRefreshToken(userId, tokenHash, deviceInfo, expiresAt) {
        throw new Error(`${this._provider}.saveRefreshToken() not implemented`);
    }

    /**
     * Retrieve a refresh token by its hash.
     * @param {string} tokenHash
     * @returns {Promise<{ exists: boolean, data: { userId, tokenHash, deviceInfo, expiresAt: Date, createdAt: Date } | null, delete: () => Promise<void> }>}
     */
    async getRefreshToken(tokenHash) { throw new Error(`${this._provider}.getRefreshToken() not implemented`); }

    /**
     * Delete a single refresh token by its hash.
     * @param {string} tokenHash
     * @returns {Promise<void>}
     */
    async deleteRefreshToken(tokenHash) { throw new Error(`${this._provider}.deleteRefreshToken() not implemented`); }

    /**
     * Revoke (delete) all refresh tokens for a user.
     * @param {string} userId
     * @returns {Promise<number>} number of tokens revoked
     */
    // ── HEALTH (steps, energy, workouts synced from the user's phone) ────────

    /** Merge one day of health data. @param {string} date — 'YYYY-MM-DD' */
    async saveHealthDay(userId, date, data) { throw new Error(`${this._provider}.saveHealthDay() not implemented`); }

    /** Get health days for the given dates (missing days are omitted). @param {string[]} dates */
    async getHealthDays(userId, dates) { throw new Error(`${this._provider}.getHealthDays() not implemented`); }

    /** Store a hashed ingest key for a user (replaces any previous key). */
    async saveHealthKey(keyHash, userId) { throw new Error(`${this._provider}.saveHealthKey() not implemented`); }

    /** Look up an ingest key by hash. @returns {Promise<{userId: string}|null>} */
    async getHealthKey(keyHash) { throw new Error(`${this._provider}.getHealthKey() not implemented`); }

    /** Key metadata for a user (never the key itself). @returns {Promise<{createdAt, lastUsedAt}|null>} */
    async getHealthKeyInfo(userId) { throw new Error(`${this._provider}.getHealthKeyInfo() not implemented`); }

    /** Record that a key was just used. */
    async touchHealthKey(keyHash) { throw new Error(`${this._provider}.touchHealthKey() not implemented`); }

    /** Remove all ingest keys for a user. */
    async deleteHealthKeys(userId) { throw new Error(`${this._provider}.deleteHealthKeys() not implemented`); }

    /**
     * Move everything stored under one user ID to another (guest → signed-in account).
     * Never overwrites data the target already has.
     * @returns {Promise<{scans: number, healthDays: number, healthKeys: number, habits: number}>}
     */
    async reassignUserData(fromUserId, toUserId) { throw new Error(`${this._provider}.reassignUserData() not implemented`); }

    // ── ACCOUNTS (sign-in users) ─────────────────────────────────────────────

    /**
     * Get an account by its auth UID (Firebase Auth uid).
     * @param {string} uid
     * @returns {Promise<Object|null>}
     */
    async getUser(uid) { throw new Error(`${this._provider}.getUser() not implemented`); }

    /**
     * Create or merge-update an account.
     * @param {string} uid
     * @param {Object} data — fields to merge (email, name, picture, bnClientId, ...)
     */
    async saveUser(uid, data) { throw new Error(`${this._provider}.saveUser() not implemented`); }

    /**
     * Find the account linked to a BN client ID (at most one).
     * @param {string} bnClientId
     * @returns {Promise<Object|null>}
     */
    async getUserByBnClientId(bnClientId) { throw new Error(`${this._provider}.getUserByBnClientId() not implemented`); }

    async revokeAllTokens(userId) { throw new Error(`${this._provider}.revokeAllTokens() not implemented`); }
}

export default DatabaseDriver;
