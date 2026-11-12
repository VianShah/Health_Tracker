/**
 * PostgresDriver — PostgreSQL implementation of DatabaseDriver
 * 
 * Uses a hybrid approach: fixed columns for core searchable fields 
 * and JSONB for the flexible payloads to match Firestore parity.
 * 
 * Required env vars:
 *   DATABASE_URL
 */

import { DatabaseDriver } from './interface.js';
import pg from 'pg';
const { Pool } = pg;

export class PostgresDriver extends DatabaseDriver {
    constructor() {
        super('postgres');
        this._pool = null;
        this._dbName = 'postgres';
    }

    // ── LIFECYCLE ────────────────────────────────────────────────────────────

    async init() {
        const url = process.env.DATABASE_URL;
        if (!url) {
            throw new Error('[Postgres] DATABASE_URL is required for PostgreSQL driver.');
        }

        this._pool = new Pool({ connectionString: url });
        this._dbName = new URL(url).pathname.slice(1) || 'postgres';

        try {
            // Test connection
            const client = await this._pool.connect();
            console.log(`✅ [Postgres] Connected to database: ${this._dbName}`);

            // ── BOOTSTRAP SCHEMA ──
            await client.query(`
                CREATE TABLE IF NOT EXISTS scans (
                    id TEXT PRIMARY KEY,
                    user_id TEXT,
                    created_at TIMESTAMP WITH TIME ZONE,
                    created_at_ist TEXT,
                    data JSONB
                );
                CREATE INDEX IF NOT EXISTS idx_scans_userId ON scans(user_id);
                CREATE INDEX IF NOT EXISTS idx_scans_createdAt ON scans(created_at DESC);

                CREATE TABLE IF NOT EXISTS habits (
                    user_id TEXT PRIMARY KEY,
                    last_scan_at TIMESTAMP WITH TIME ZONE,
                    data JSONB
                );

                CREATE TABLE IF NOT EXISTS refresh_tokens (
                    token_id TEXT PRIMARY KEY,
                    user_id TEXT,
                    token_hash TEXT,
                    device_info TEXT,
                    expires_at TIMESTAMP WITH TIME ZONE,
                    created_at TIMESTAMP WITH TIME ZONE
                );
                CREATE INDEX IF NOT EXISTS idx_tokens_userId ON refresh_tokens(user_id);
                CREATE INDEX IF NOT EXISTS idx_tokens_hash ON refresh_tokens(token_hash);
            `);
            client.release();

            console.log('✅ [Postgres] Schema verified/bootstrapped.');
            this._ready = true;
            return true;
        } catch (err) {
            console.error(`❌ [Postgres] Initialization failed: ${err.message}`);
            return false;
        }
    }

    async close() {
        if (this._pool) {
            await this._pool.end();
            console.log('[Postgres] Connection pool closed.');
        }
    }

    // ── HEALTH ───────────────────────────────────────────────────────────────

    async healthCheck() {
        if (!this._pool) return { connection: 'disconnected', readWrite: 'failed' };

        const start = performance.now();
        try {
            const res = await this._pool.query('SELECT NOW()');
            const latency = Math.round(performance.now() - start);
            return {
                connection: 'connected',
                readWrite: 'verified',
                provider: 'postgres',
                dbName: this._dbName,
                latencyMs: latency
            };
        } catch (err) {
            return {
                connection: 'connected',
                readWrite: `failed: ${err.message}`,
                provider: 'postgres'
            };
        }
    }

    // ── SCANS ────────────────────────────────────────────────────────────────

    createScanId() {
        // Simple random hex ID for Postgres parity with Firestore auto-ID length
        return Math.random().toString(36).substring(2, 10).toUpperCase() +
            Math.random().toString(36).substring(2, 10).toUpperCase();
    }

    async saveScan(scanId, scanData) {
        const query = `
            INSERT INTO scans (id, user_id, created_at, created_at_ist, data)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (id) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                created_at = EXCLUDED.created_at,
                created_at_ist = EXCLUDED.created_at_ist,
                data = EXCLUDED.data
        `;
        const createdAt = new Date();
        const createdAtIST = createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

        await this._pool.query(query, [
            scanId,
            scanData.userId || null,
            createdAt,
            createdAtIST,
            JSON.stringify(scanData)
        ]);
    }

    async getScans(userId, limit = 50) {
        let sql = 'SELECT * FROM scans';
        const params = [];
        if (userId) {
            sql += ' WHERE user_id = $1';
            params.push(userId);
        }
        sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
        params.push(limit);

        const { rows } = await this._pool.query(sql, params);
        return rows.map(r => ({
            id: r.id,
            ...r.data,
            createdAt: r.created_at
        }));
    }

    async getLatestScan(userId) {
        let sql = 'SELECT * FROM scans';
        const params = [];
        if (userId) {
            sql += ' WHERE user_id = $1';
            params.push(userId);
        }
        sql += ' ORDER BY created_at DESC LIMIT 1';

        const { rows } = await this._pool.query(sql, params);
        if (rows.length === 0) return null;
        const r = rows[0];
        return {
            id: r.id,
            ...r.data,
            createdAt: r.created_at
        };
    }

    async updateScanSwap(scanId, originalItemName, chosenAlternative) {
        // Atomically update the JSONB items array
        const query = `
            UPDATE scans 
            SET data = jsonb_set(
                data, 
                '{items}', 
                (
                    SELECT jsonb_agg(
                        CASE 
                            WHEN item->>'name' = $2 THEN item || jsonb_build_object('selectedAlternative', $3)
                            ELSE item
                        END
                    )
                    FROM jsonb_array_elements(data->'items') AS item
                )
            )
            WHERE id = $1
        `;
        await this._pool.query(query, [scanId, originalItemName, chosenAlternative]);
    }

    // ── HABITS ───────────────────────────────────────────────────────────────

    async getHabit(userId) {
        const { rows } = await this._pool.query('SELECT data FROM habits WHERE user_id = $1', [userId]);
        return rows.length > 0 ? rows[0].data : null;
    }

    async saveHabit(userId, habitData) {
        const now = new Date();
        const query = `
            INSERT INTO habits (user_id, last_scan_at, data)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id) DO UPDATE SET
                last_scan_at = EXCLUDED.last_scan_at,
                data = habits.data || EXCLUDED.data
        `;
        // Ensure lastScanAt is updated within the data JSONB too if needed
        habitData.lastScanAt = now;

        await this._pool.query(query, [userId, now, JSON.stringify(habitData)]);
    }

    async recordSwapPreference(userId, original, chosen) {
        // Postgres JSONB power: handle deep merging and counting in SQL
        const now = new Date();

        const query = `
            INSERT INTO habits (user_id, last_scan_at, data)
            VALUES ($1, $4, jsonb_build_object('userId', $1::text, 'preferredSwaps', jsonb_build_array(jsonb_build_object('original', $2::text, 'chosen', $3::text, 'count', 1))))
            ON CONFLICT (user_id) DO UPDATE SET
                last_scan_at = EXCLUDED.last_scan_at,
                data = jsonb_set(
                    habits.data,
                    '{preferredSwaps}',
                    COALESCE(
                        (
                            SELECT jsonb_agg(
                                CASE 
                                    WHEN s->>'original' = $2 AND s->>'chosen' = $3 
                                    THEN s || jsonb_build_object('count', (s->>'count')::int + 1)
                                    ELSE s
                                END
                            )
                            FROM jsonb_array_elements(habits.data->'preferredSwaps') s
                        ),
                        jsonb_build_array(jsonb_build_object('original', $2::text, 'chosen', $3::text, 'count', 1))
                    )
                );
        `;
        // The above query handles the "increment if exists else push" logic in pure SQL
        await this._pool.query(query, [userId, original, chosen, now]);
    }

    // ── AUTH / REFRESH TOKENS ────────────────────────────────────────────────

    async saveRefreshToken(userId, tokenHash, deviceInfo, expiresAt) {
        const tokenId = Buffer.from(tokenHash).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
        const query = `
            INSERT INTO refresh_tokens (token_id, user_id, token_hash, device_info, expires_at, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
        `;
        await this._pool.query(query, [tokenId, userId, tokenHash, deviceInfo, expiresAt, new Date()]);
    }

    async getRefreshToken(tokenHash) {
        const { rows } = await this._pool.query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
        if (rows.length === 0) return { exists: false, data: null };
        const r = rows[0];
        return {
            exists: true,
            data: {
                userId: r.user_id,
                tokenHash: r.token_hash,
                deviceInfo: r.device_info,
                expiresAt: r.expires_at,
                createdAt: r.created_at
            },
            delete: () => this.deleteRefreshToken(tokenHash)
        };
    }

    async deleteRefreshToken(tokenHash) {
        await this._pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
    }

    async revokeAllTokens(userId) {
        const { rowCount } = await this._pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
        return rowCount;
    }
}

export default PostgresDriver;
