/**
 * MongoDriver — MongoDB Atlas implementation of DatabaseDriver
 * 
 * Native NoSQL implementation using the official MongoDB Node.js driver.
 * Maps 1:1 to the existing Firestore collection/document structure.
 * 
 * Required env vars:
 *   MONGODB_URI
 *   MONGODB_DB (optional, defaults to 'nutriscan')
 */

import { DatabaseDriver } from './interface.js';
import { MongoClient } from 'mongodb';

export class MongoDriver extends DatabaseDriver {
    constructor() {
        super('mongodb');
        this._client = null;
        this._db = null;
        this._dbName = 'nutriscan';
    }

    // ── LIFECYCLE ────────────────────────────────────────────────────────────

    async init() {
        const uri = process.env.MONGODB_URI;
        if (!uri) {
            throw new Error('[Mongo] MONGODB_URI is required for MongoDB driver.');
        }

        this._dbName = process.env.MONGODB_DB || 'nutriscan';
        this._client = new MongoClient(uri);

        try {
            await this._client.connect();
            this._db = this._client.db(this._dbName);
            console.log(`✅ [Mongo] Connected to database: ${this._dbName}`);
            
            // ── INDEXES ──
            await this._db.collection('scans').createIndex({ userId: 1 });
            await this._db.collection('scans').createIndex({ createdAt: -1 });
            await this._db.collection('refreshTokens').createIndex({ userId: 1 });
            await this._db.collection('refreshTokens').createIndex({ tokenHash: 1 });
            
            console.log('✅ [Mongo] MongoDB indexes verified.');
            this._ready = true;
            return true;
        } catch (err) {
            console.error(`❌ [Mongo] Initialization failed: ${err.message}`);
            return false;
        }
    }

    async close() {
        if (this._client) {
            await this._client.close();
            console.log('[Mongo] Connection closed.');
        }
    }

    // ── HEALTH ───────────────────────────────────────────────────────────────

    async healthCheck() {
        if (!this._db) return { connection: 'disconnected', readWrite: 'failed' };
        
        const start = performance.now();
        try {
            await this._db.command({ ping: 1 });
            const latency = Math.round(performance.now() - start);
            return {
                connection: 'connected',
                readWrite: 'verified',
                provider: 'mongodb',
                dbName: this._dbName,
                latencyMs: latency
            };
        } catch (err) {
            return {
                connection: 'connected',
                readWrite: `failed: ${err.message}`,
                provider: 'mongodb'
            };
        }
    }

    // ── SCANS ────────────────────────────────────────────────────────────────

    createScanId() {
        // Return a string ID. MongoDB handles _id automatically, but for parity, we can generate a string.
        return Math.random().toString(36).substring(2, 11) + Math.random().toString(36).substring(2, 11);
    }

    async saveScan(scanId, scanData) {
        const createdAt = new Date();
        const doc = {
            _id: scanId,
            ...scanData,
            createdAt,
            createdAtIST: createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        };
        await this._db.collection('scans').replaceOne({ _id: scanId }, doc, { upsert: true });
    }

    async getScans(userId, limit = 50) {
        let filter = {};
        if (userId) filter.userId = userId;
        
        const results = await this._db.collection('scans')
            .find(filter)
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();
            
        return results.map(r => this._normalize(r));
    }

    async getLatestScan(userId) {
        let filter = {};
        if (userId) filter.userId = userId;
        
        const r = await this._db.collection('scans')
            .find(filter)
            .sort({ createdAt: -1 })
            .limit(1)
            .next();
            
        return r ? this._normalize(r) : null;
    }

    async updateScanSwap(scanId, originalItemName, chosenAlternative) {
        // Use MongoDB $ positional operator or filter to update array
        await this._db.collection('scans').updateOne(
            { _id: scanId, "items.name": originalItemName },
            { $set: { "items.$.selectedAlternative": chosenAlternative } }
        );
    }

    // ── HABITS ───────────────────────────────────────────────────────────────

    async getHabit(userId) {
        const r = await this._db.collection('habits').findOne({ _id: userId });
        return r ? this._normalize(r) : null;
    }

    async saveHabit(userId, habitData) {
        const now = new Date();
        const doc = {
            ...habitData,
            lastScanAt: now
        };
        // Remove _id from payload if it exists to avoid IMMUTABLE_FIELD error
        delete doc._id;
        
        await this._db.collection('habits').updateOne(
            { _id: userId },
            { $set: doc },
            { upsert: true }
        );
    }

    async recordSwapPreference(userId, original, chosen) {
        const now = new Date();
        
        // 1. Try to increment existing swap
        const res = await this._db.collection('habits').updateOne(
            { _id: userId, "preferredSwaps.original": original, "preferredSwaps.chosen": chosen },
            { 
                $inc: { "preferredSwaps.$.count": 1 },
                $set: { lastScanAt: now }
            }
        );
        
        // 2. If no matching swap found, push new one (or create habit)
        if (res.matchedCount === 0) {
            await this._db.collection('habits').updateOne(
                { _id: userId },
                { 
                    $push: { preferredSwaps: { original, chosen, count: 1 } },
                    $set: { lastScanAt: now },
                    $setOnInsert: { userId }
                },
                { upsert: true }
            );
        }
    }

    // ── AUTH / REFRESH TOKENS ────────────────────────────────────────────────

    async saveRefreshToken(userId, tokenHash, deviceInfo, expiresAt) {
        const tokenId = Buffer.from(tokenHash).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
        await this._db.collection('refreshTokens').replaceOne(
            { _id: tokenId },
            {
                userId,
                tokenHash,
                deviceInfo,
                expiresAt,
                createdAt: new Date()
            },
            { upsert: true }
        );
    }

    async getRefreshToken(tokenHash) {
        const r = await this._db.collection('refreshTokens').findOne({ tokenHash });
        if (!r) return { exists: false, data: null };
        
        return {
            exists: true,
            data: {
                userId: r.userId,
                tokenHash: r.tokenHash,
                deviceInfo: r.deviceInfo,
                expiresAt: r.expiresAt,
                createdAt: r.createdAt
            },
            delete: () => this.deleteRefreshToken(tokenHash)
        };
    }

    async deleteRefreshToken(tokenHash) {
        await this._db.collection('refreshTokens').deleteOne({ tokenHash });
    }

    async revokeAllTokens(userId) {
        const res = await this._db.collection('refreshTokens').deleteMany({ userId });
        return res.deletedCount;
    }

    // ── PRIVATE HELPERS ──────────────────────────────────────────────────────

    _normalize(doc) {
        if (!doc) return null;
        const { _id, ...rest } = doc;
        return { id: _id, ...rest };
    }
}

export default MongoDriver;
