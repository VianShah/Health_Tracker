/**
 * FirestoreDriver — Firestore implementation of DatabaseDriver
 * 
 * This is the production-default driver for NutriScan.
 * Handles Firebase Admin initialization, named database targeting,
 * and all CRUD operations for scans, habits, and auth tokens.
 * 
 * Required env vars:
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 *   FIRESTORE_DB (optional, defaults to '(default)')
 */

import { DatabaseDriver } from './interface.js';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { Firestore, Timestamp, FieldValue } from '@google-cloud/firestore';
import crypto from 'crypto';

export class FirestoreDriver extends DatabaseDriver {
    constructor() {
        super('firestore');
        this._client = null;
        this._dbName = '(default)';
    }

    // ── LIFECYCLE ────────────────────────────────────────────────────────────

    async init() {
        const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

        // 1. Initialize Firebase Admin SDK (idempotent)
        if (!admin.apps.length) {
            if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
                process.env.GOOGLE_CLOUD_PROJECT = FIREBASE_PROJECT_ID;

                const cleanedKey = this._cleanPrivateKey(FIREBASE_PRIVATE_KEY);

                if (!cleanedKey.startsWith('-----BEGIN PRIVATE KEY-----')) {
                    console.error('❌ [CRITICAL] FIREBASE_PRIVATE_KEY does not appear to be a valid PEM key.');
                }

                admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId: FIREBASE_PROJECT_ID,
                        clientEmail: FIREBASE_CLIENT_EMAIL,
                        privateKey: cleanedKey
                    }),
                    projectId: FIREBASE_PROJECT_ID
                });
                console.log(`✅ [Firestore] Admin SDK initialized for project: ${FIREBASE_PROJECT_ID}`);
            } else {
                admin.initializeApp();
                console.log(`✅ [Firestore] Admin SDK initialized with Application Default Credentials`);
            }
        }

        // 2. Create Firestore client (named DB or default)
        this._dbName = process.env.FIRESTORE_DB || '(default)';

        if (this._dbName === '(default)') {
            try {
                this._client = getFirestore();
                console.log(`✅ [Firestore] Connected to (default) database`);
            } catch (e) {
                console.error('[Firestore] Failed to init (default):', e);
            }
        } else {
            const pk = FIREBASE_PRIVATE_KEY ? this._cleanPrivateKey(FIREBASE_PRIVATE_KEY) : undefined;

            if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && pk) {
                this._client = new Firestore({
                    projectId: FIREBASE_PROJECT_ID,
                    databaseId: this._dbName,
                    credentials: { client_email: FIREBASE_CLIENT_EMAIL, private_key: pk }
                });
                console.log(`✅ [Firestore] Bound to named DB: ${this._dbName}`);
            } else {
                console.log("⚠️ [Firestore] Missing credentials. Falling back to (default) DB.");
                this._client = getFirestore();
            }
        }

        // 3. Boot-time connectivity check — NON-FATAL
        try {
            await this._client.collection('_healthcheck').doc('ping').set({ ts: Date.now() });
            console.log(`✅ [Firestore] DB '${this._dbName}' verified writable.`);
        } catch (err) {
            console.error(`⚠️ [Firestore] Healthcheck failed: ${err.message}`);
            console.error(`   Service will continue — writes may fail at runtime.`);
            try {
                this._client = getFirestore();
                await this._client.collection('_healthcheck').doc('ping').set({ ts: Date.now() });
                console.log(`✅ [Firestore] Fell back to (default) DB — writable.`);
            } catch (e2) {
                console.error(`❌ [Firestore] (default) also failed: ${e2.message} — DB writes disabled.`);
            }
        }

        this._ready = true;
        return true;
    }

    async close() {
        if (this._client && typeof this._client.terminate === 'function') {
            await this._client.terminate();
            console.log('[Firestore] Connection terminated.');
        }
    }

    // ── HEALTH ───────────────────────────────────────────────────────────────

    async healthCheck() {
        const connection = this._client ? 'connected' : 'disconnected';
        let readWrite = 'unknown';
        const start = performance.now();

        if (this._client) {
            try {
                const healthRef = this._client.collection('_health_api').doc('write_test');
                await healthRef.set({
                    timestamp: FieldValue.serverTimestamp(),
                    status: 'active'
                });
                const snap = await healthRef.get();
                readWrite = snap.exists ? 'verified' : 'write_succeeded_read_failed';
            } catch (e) {
                readWrite = `failed: ${e.message}`;
            }
        }

        return {
            connection,
            readWrite,
            provider: 'firestore',
            dbName: this._dbName,
            latencyMs: Math.round(performance.now() - start)
        };
    }

    // ── SCANS ────────────────────────────────────────────────────────────────

    createScanId() {
        return this._client.collection('scans').doc().id;
    }

    async saveScan(scanId, scanData) {
        const scanRef = this._client.collection('scans').doc(scanId);
        await scanRef.set({
            ...scanData,
            createdAt: FieldValue.serverTimestamp(),
            createdAtIST: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        });
    }

    async getScans(userId, limit = 50) {
        let query = this._client.collection('scans');
        if (userId) query = query.where('userId', '==', userId);
        const snapshot = await query.orderBy('createdAt', 'desc').limit(limit).get();
        return snapshot.docs.map(doc => this._normalizeScanDoc(doc));
    }

    async getLatestScan(userId) {
        let query = this._client.collection('scans');
        if (userId) query = query.where('userId', '==', userId);
        const snapshot = await query.orderBy('createdAt', 'desc').limit(1).get();
        if (snapshot.empty) return null;
        return this._normalizeScanDoc(snapshot.docs[0]);
    }

    async updateScanSwap(scanId, originalItemName, chosenAlternative) {
        const scanRef = this._client.collection('scans').doc(scanId);
        await this._client.runTransaction(async (t) => {
            const doc = await t.get(scanRef);
            if (doc.exists) {
                const scanData = doc.data();
                const items = scanData.items || [];
                const idx = items.findIndex(i => i.name === originalItemName);
                if (idx !== -1) {
                    items[idx].selectedAlternative = chosenAlternative;
                    t.update(scanRef, { items });
                }
            }
        });
    }

    // ── HABITS ───────────────────────────────────────────────────────────────

    async getHabit(userId) {
        const docSnap = await this._client.collection('habits').doc(userId).get();
        return docSnap.exists ? docSnap.data() : null;
    }

    async saveHabit(userId, habitData) {
        const habitRef = this._client.collection('habits').doc(userId);
        habitData.lastScanAt = FieldValue.serverTimestamp();
        await habitRef.set(habitData, { merge: true });
    }

    async recordSwapPreference(userId, original, chosen) {
        const habitRef = this._client.collection('habits').doc(userId);
        await this._client.runTransaction(async (t) => {
            const doc = await t.get(habitRef);
            let habit = doc.exists ? doc.data() : { userId, preferredSwaps: [] };
            if (!habit.preferredSwaps) habit.preferredSwaps = [];

            const idx = habit.preferredSwaps.findIndex(s => s.original === original && s.chosen === chosen);
            if (idx === -1) {
                habit.preferredSwaps.push({ original, chosen, count: 1 });
            } else {
                habit.preferredSwaps[idx].count += 1;
            }

            habit.lastScanAt = FieldValue.serverTimestamp();
            t.set(habitRef, habit, { merge: true });
        });
    }

    // ── AUTH / REFRESH TOKENS ────────────────────────────────────────────────

    async saveRefreshToken(userId, tokenHash, deviceInfo, expiresAt) {
        const tokenId = this._tokenId(tokenHash);
        await this._client.collection('refreshTokens').doc(tokenId).set({
            userId,
            tokenHash,
            deviceInfo,
            expiresAt: Timestamp.fromDate(expiresAt),
            createdAt: FieldValue.serverTimestamp()
        });
    }

    async getRefreshToken(tokenHash) {
        const tokenId = this._tokenId(tokenHash);
        const tokenRef = this._client.collection('refreshTokens').doc(tokenId);
        const doc = await tokenRef.get();
        return {
            exists: doc.exists,
            data: doc.exists ? doc.data() : null,
            delete: () => tokenRef.delete()
        };
    }

    async deleteRefreshToken(tokenHash) {
        const tokenId = this._tokenId(tokenHash);
        await this._client.collection('refreshTokens').doc(tokenId).delete();
    }

    async revokeAllTokens(userId) {
        const snapshot = await this._client.collection('refreshTokens').where('userId', '==', userId).get();
        const batch = this._client.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        return snapshot.size;
    }

    // ── HEALTH ───────────────────────────────────────────────────────────────

    _healthDayId(userId, date) { return `${userId}_${date}`; }

    async saveHealthDay(userId, date, data) {
        await this._client.collection('healthDays').doc(this._healthDayId(userId, date)).set(
            { ...data, userId, date, updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
        );
    }

    async getHealthDays(userId, dates) {
        if (!dates.length) return [];
        // Direct document reads: no composite index needed.
        const refs = dates.map(d => this._client.collection('healthDays').doc(this._healthDayId(userId, d)));
        const snaps = await this._client.getAll(...refs);
        return snaps.filter(s => s.exists).map(s => {
            const { updatedAt, ...rest } = s.data();
            return { ...rest, updatedAt: updatedAt?.toDate ? updatedAt.toDate().toISOString() : null };
        });
    }

    async saveHealthKey(keyHash, userId) {
        await this.deleteHealthKeys(userId);
        await this._client.collection('healthKeys').doc(keyHash).set({
            userId, createdAt: FieldValue.serverTimestamp(), lastUsedAt: null
        });
    }

    async getHealthKey(keyHash) {
        const snap = await this._client.collection('healthKeys').doc(keyHash).get();
        return snap.exists ? { userId: snap.data().userId } : null;
    }

    async getHealthKeyInfo(userId) {
        const snap = await this._client.collection('healthKeys').where('userId', '==', userId).limit(1).get();
        if (snap.empty) return null;
        const d = snap.docs[0].data();
        const iso = (t) => t?.toDate ? t.toDate().toISOString() : null;
        return { createdAt: iso(d.createdAt), lastUsedAt: iso(d.lastUsedAt) };
    }

    async touchHealthKey(keyHash) {
        await this._client.collection('healthKeys').doc(keyHash).update({ lastUsedAt: FieldValue.serverTimestamp() });
    }

    async deleteHealthKeys(userId) {
        const snap = await this._client.collection('healthKeys').where('userId', '==', userId).get();
        if (snap.empty) return 0;
        const batch = this._client.batch();
        snap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        return snap.size;
    }

    // ── GUEST → ACCOUNT HAND-OVER ────────────────────────────────────────────

    async reassignUserData(fromUserId, toUserId) {
        const db = this._client;
        const counts = { scans: 0, healthDays: 0, healthKeys: 0, habits: 0 };

        // Run writes in chunks well under Firestore's 500-operation batch limit.
        const commitAll = async (ops) => {
            for (let i = 0; i < ops.length; i += 400) {
                const batch = db.batch();
                ops.slice(i, i + 400).forEach(op => op(batch));
                await batch.commit();
            }
        };

        // Scans: re-label
        const scans = await db.collection('scans').where('userId', '==', fromUserId).get();
        await commitAll(scans.docs.map(d => (b) => b.update(d.ref, { userId: toUserId })));
        counts.scans = scans.size;

        // Health days: document IDs contain the user ID, so copy then delete.
        const days = await db.collection('healthDays').where('userId', '==', fromUserId).get();
        const dayOps = [];
        for (const d of days.docs) {
            const data = d.data();
            const target = db.collection('healthDays').doc(this._healthDayId(toUserId, data.date));
            const exists = (await target.get()).exists;
            if (!exists) { dayOps.push((b) => b.set(target, { ...data, userId: toUserId })); counts.healthDays++; }
            dayOps.push((b) => b.delete(d.ref));
        }
        await commitAll(dayOps);

        // Sync key: keep the account's own key if it has one.
        const targetKey = await db.collection('healthKeys').where('userId', '==', toUserId).limit(1).get();
        const guestKeys = await db.collection('healthKeys').where('userId', '==', fromUserId).get();
        await commitAll(guestKeys.docs.map(d => (b) => targetKey.empty ? b.update(d.ref, { userId: toUserId }) : b.delete(d.ref)));
        counts.healthKeys = targetKey.empty ? guestKeys.size : 0;

        // Shopping habits: carry over only if the account has none yet.
        const fromHabit = await db.collection('habits').doc(fromUserId).get();
        if (fromHabit.exists) {
            const toRef = db.collection('habits').doc(toUserId);
            if (!(await toRef.get()).exists) { await toRef.set({ ...fromHabit.data(), userId: toUserId }); counts.habits = 1; }
            await fromHabit.ref.delete();
        }

        return counts;
    }

    // ── ACCOUNTS ─────────────────────────────────────────────────────────────

    async getUser(uid) {
        const snap = await this._client.collection('users').doc(uid).get();
        return snap.exists ? { uid, ...snap.data() } : null;
    }

    async saveUser(uid, data) {
        await this._client.collection('users').doc(uid).set(
            { ...data, updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
        );
    }

    async getUserByBnClientId(bnClientId) {
        const snap = await this._client.collection('users')
            .where('bnClientId', '==', String(bnClientId)).limit(1).get();
        if (snap.empty) return null;
        return { uid: snap.docs[0].id, ...snap.docs[0].data() };
    }

    // ── PRIVATE HELPERS ──────────────────────────────────────────────────────

    _cleanPrivateKey(raw) {
        return raw.replace(/\\n/g, '\n').replace(/^["']|["']$/g, '').trim();
    }

    _tokenId(tokenHash) {
        return Buffer.from(tokenHash).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
    }

    _normalizeScanDoc(doc) {
        const data = doc.data();
        return {
            id: doc.id,
            ...data,
            createdAt: data.createdAt ? data.createdAt.toDate() : new Date()
        };
    }
}

export default FirestoreDriver;
