/**
 * Health data — steps, energy, workouts, sleep and weight synced from the user's phone.
 *
 * A website cannot read Apple Health directly, so the phone pushes data to us:
 *   - an iPhone Shortcut that posts a small JSON summary, or
 *   - the "Health Auto Export" app's REST automation.
 * Both authenticate with a per-user sync key (created from the app, shown once,
 * stored only as a SHA-256 hash).
 *
 * Routes (mounted under /api/v1/health):
 *   POST   /key       (JWT)       create or rotate the sync key
 *   DELETE /key       (JWT)       disconnect
 *   GET    /status    (JWT)       connected? last sync?
 *   POST   /ingest    (sync key)  phone → server
 *   GET    /summary   (JWT)       last N days: health + logged meals + insights
 */

import express from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';

const KEY_PREFIX = 'nsh_';
const MAX_DAYS_PER_INGEST = 62;
const hashKey = (key) => crypto.createHash('sha256').update(key).digest('hex');

// ── Normalisation ────────────────────────────────────────────────────────────

const num = (v) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return Number.isFinite(n) ? n : null;
};
const round = (v, dp = 0) => v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp;
const clamp = (v, min, max) => v == null ? null : Math.min(max, Math.max(min, v));

/** 'YYYY-MM-DD' from "2026-11-10", "2026-11-10 07:30:00 +0530", ISO strings or Date. */
export function toDateKey(value, timeZone = 'Asia/Kolkata') {
    if (!value) return null;
    if (typeof value === 'string') {
        // Wall-clock date as written by the phone: trust its local calendar day.
        const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    }
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d)) return null;
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const toKcal = (qty, units) => {
    const n = num(qty);
    if (n == null) return null;
    return /kj/i.test(units || '') ? n / 4.184 : n;
};
const toKm = (qty, units) => {
    const n = num(qty);
    if (n == null) return null;
    const u = (units || '').toLowerCase();
    if (u === 'mi' || u.startsWith('mile')) return n * 1.60934;
    if (u === 'm' || u.startsWith('meter') || u.startsWith('metre')) return n / 1000;
    return n;
};
const toKg = (qty, units) => {
    const n = num(qty);
    if (n == null) return null;
    return /lb/i.test(units || '') ? n * 0.453592 : n;
};

function cleanWorkout(w) {
    const minutes = num(w.minutes ?? w.durationMinutes) ?? (num(w.duration) != null ? num(w.duration) / 60 : null);
    return {
        type: String(w.type || w.name || 'Workout').slice(0, 40),
        start: typeof w.start === 'string' ? w.start.slice(0, 40) : null,
        minutes: round(clamp(minutes, 0, 1440)),
        kcal: round(clamp(num(w.kcal ?? w.calories ?? w.activeCalories), 0, 20000)),
        distanceKm: round(clamp(num(w.distanceKm), 0, 1000), 2),
    };
}

/** Our own simple format — one object per day. */
function fromSimpleDay(d, fallbackDate) {
    const date = toDateKey(d.date) || fallbackDate;
    if (!date) return null;
    const day = { date };
    const set = (key, value) => { if (value != null) day[key] = value; };

    set('steps', round(clamp(num(d.steps), 0, 200000)));
    set('activeKcal', round(clamp(num(d.activeCalories ?? d.activeKcal ?? d.active_energy), 0, 20000)));
    set('restingKcal', round(clamp(num(d.restingCalories ?? d.restingKcal ?? d.basal_energy), 0, 20000)));
    set('exerciseMinutes', round(clamp(num(d.exerciseMinutes ?? d.exercise_minutes), 0, 1440)));
    set('distanceKm', round(clamp(num(d.distanceKm ?? d.distance_km), 0, 1000), 2));
    set('sleepHours', round(clamp(num(d.sleepHours ?? d.sleep_hours), 0, 24), 1));
    set('weightKg', round(clamp(num(d.weightKg ?? d.weight_kg), 20, 400), 1));
    set('restingHr', round(clamp(num(d.restingHr ?? d.resting_heart_rate), 20, 250)));
    if (Array.isArray(d.workouts)) day.workouts = d.workouts.slice(0, 20).map(cleanWorkout);
    return day;
}

/** Health Auto Export app: { data: { metrics: [{ name, units, data: [{ date, qty }] }], workouts: [...] } } */
function fromHealthAutoExport(data) {
    const days = new Map();
    const dayFor = (date) => { if (!days.has(date)) days.set(date, { date }); return days.get(date); };
    const sumInto = (day, key, v) => { if (v != null) day[key] = (day[key] || 0) + v; };

    for (const metric of data.metrics || []) {
        const name = String(metric.name || '').toLowerCase();
        const units = metric.units;
        const hrSamples = new Map();

        for (const point of metric.data || []) {
            const date = toDateKey(point.date);
            if (!date) continue;
            const day = dayFor(date);
            const qty = point.qty ?? point.Avg ?? point.avg;

            if (name === 'step_count') sumInto(day, 'steps', num(qty));
            else if (name === 'active_energy') sumInto(day, 'activeKcal', toKcal(qty, units));
            else if (name === 'basal_energy_burned') sumInto(day, 'restingKcal', toKcal(qty, units));
            else if (name === 'apple_exercise_time') sumInto(day, 'exerciseMinutes', num(qty));
            else if (name === 'walking_running_distance') sumInto(day, 'distanceKm', toKm(qty, units));
            else if (name === 'sleep_analysis') sumInto(day, 'sleepHours', num(point.totalSleep ?? point.asleep ?? qty));
            else if (name === 'weight_body_mass') { const kg = toKg(qty, units); if (kg != null) day.weightKg = kg; }
            else if (name === 'resting_heart_rate') {
                const v = num(qty);
                if (v != null) { if (!hrSamples.has(date)) hrSamples.set(date, []); hrSamples.get(date).push(v); }
            }
        }
        for (const [date, samples] of hrSamples) {
            dayFor(date).restingHr = samples.reduce((a, b) => a + b, 0) / samples.length;
        }
    }

    for (const w of data.workouts || []) {
        const date = toDateKey(w.start);
        if (!date) continue;
        const day = dayFor(date);
        const energy = w.activeEnergyBurned ?? w.activeEnergy ?? w.totalEnergy;
        (day.workouts ||= []).push(cleanWorkout({
            type: w.name,
            start: w.start,
            duration: w.duration, // seconds
            kcal: energy && typeof energy === 'object' ? toKcal(energy.qty, energy.units) : num(energy),
            distanceKm: w.distance && typeof w.distance === 'object' ? toKm(w.distance.qty, w.distance.units) : null,
        }));
    }

    // Re-run through the simple cleaner so the same clamps and rounding apply.
    return [...days.values()].map(d => fromSimpleDay({
        date: d.date, steps: d.steps, activeKcal: d.activeKcal, restingKcal: d.restingKcal,
        exerciseMinutes: d.exerciseMinutes, distanceKm: d.distanceKm, sleepHours: d.sleepHours,
        weightKg: d.weightKg, restingHr: d.restingHr, workouts: d.workouts,
    })).filter(Boolean);
}

/** Accepts either supported payload and returns clean per-day records. */
export function normalizeHealthPayload(body, today) {
    if (!body || typeof body !== 'object') return [];
    if (body.data && (Array.isArray(body.data.metrics) || Array.isArray(body.data.workouts))) return fromHealthAutoExport(body.data);
    if (Array.isArray(body.days)) return body.days.map(d => fromSimpleDay(d || {}, null)).filter(Boolean);
    return [fromSimpleDay(body, today)].filter(Boolean);
}

// ── Meals logged per day ─────────────────────────────────────────────────────

function mealTotals(scan) {
    const items = (scan.items || []).filter(i => !i.isNonFood);
    const sum = (key) => items.reduce((a, i) => a + (num(i.macros?.[key]) || 0), 0);
    const protein = num(scan.totalMacros?.protein) ?? sum('protein');
    const carbs = num(scan.totalMacros?.carbs) ?? sum('carbs');
    const fat = num(scan.totalMacros?.fat) ?? sum('fat');
    const kcal = sum('calories') || (protein * 4 + carbs * 4 + fat * 9);
    return { kcal, protein, carbs, fat };
}

function eatenByDay(scans, timeZone) {
    const byDay = new Map();
    for (const scan of scans) {
        if (scan.scanMode !== 'PLATE') continue; // only logged meals count as eaten
        const date = toDateKey(new Date(scan.timestamp || scan.createdAt), timeZone);
        if (!date) continue;
        const t = mealTotals(scan);
        const d = byDay.get(date) || { kcal: 0, protein: 0, carbs: 0, fat: 0, meals: 0 };
        d.kcal += t.kcal; d.protein += t.protein; d.carbs += t.carbs; d.fat += t.fat; d.meals += 1;
        byDay.set(date, d);
    }
    for (const d of byDay.values()) for (const k of ['kcal', 'protein', 'carbs', 'fat']) d[k] = Math.round(d[k]);
    return byDay;
}

// ── Insights (plain rules — estimates, not medical advice) ───────────────────

function buildInsights(days) {
    const insights = [];
    const today = days[days.length - 1];
    const earlier = days.slice(0, -1);
    const avg = (key) => {
        const vals = earlier.map(d => d.health?.[key]).filter(v => v != null);
        return vals.length >= 3 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const h = today?.health;

    if (h?.steps != null) {
        const a = avg('steps');
        if (a != null && a > 0) {
            const pct = Math.round((h.steps / a - 1) * 100);
            if (pct >= 15) insights.push({ kind: 'good', text: `You're ${pct}% above your usual steps today.` });
            else if (pct <= -30) insights.push({ kind: 'nudge', text: `Steps are ${Math.abs(pct)}% below your usual. A 15-minute walk closes most of the gap.` });
        }
    }

    const burned = h ? (h.activeKcal || 0) + (h.restingKcal || 0) : 0;
    if (today?.eaten && h?.restingKcal != null && today.eaten.meals >= 2) {
        const net = today.eaten.kcal - burned;
        if (net > 150) insights.push({ kind: 'nudge', text: `Logged meals are about ${Math.round(net)} kcal above what you've burned so far.` });
        else if (net < -150) insights.push({ kind: 'good', text: `You've burned about ${Math.round(-net)} kcal more than your logged meals so far.` });
    }

    const weight = [...days].reverse().map(d => d.health?.weightKg).find(v => v != null);
    if (weight && today?.eaten?.meals >= 2) {
        const perKg = today.eaten.protein / weight;
        if (perKg < 0.6) insights.push({ kind: 'nudge', text: `Protein is at ${today.eaten.protein} g so far. Adding a protein-rich item to the next meal would help.` });
    }

    const workoutDays = days.filter(d => (d.health?.workouts || []).length > 0).length;
    if (workoutDays >= 3) insights.push({ kind: 'good', text: `${workoutDays} workout days in the last ${days.length}. Nice consistency.` });

    if (h?.sleepHours != null && h.sleepHours < 6) {
        insights.push({ kind: 'nudge', text: `Only ${h.sleepHours} h of sleep last night. Short sleep tends to raise appetite, so plan meals ahead today.` });
    }

    return insights.slice(0, 3);
}

// ── Router ───────────────────────────────────────────────────────────────────

export function createHealthRouter({ dal, authenticateToken }) {
    const router = express.Router();

    const ingestLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 60,
        message: { error: 'Too many sync requests. Try again later.' },
        standardHeaders: true,
        legacyHeaders: false,
    });

    const ownerOf = (req) => {
        const userId = req.user?.userId;
        return userId && userId !== 'guest' ? String(userId) : null;
    };

    /** Create or rotate the sync key. The key is returned once and never stored in plain text. */
    router.post('/key', authenticateToken, async (req, res) => {
        const userId = ownerOf(req);
        if (!userId) return res.status(403).json({ error: 'Sign in first.' });
        try {
            const key = KEY_PREFIX + crypto.randomBytes(24).toString('hex');
            await dal.saveHealthKey(hashKey(key), userId);
            console.log(`[Health] Sync key issued for user: ${userId}`);
            res.json({
                key,
                ingestUrl: `${(req.headers['x-forwarded-proto'] || req.protocol).toString().split(',')[0]}://${req.get('host')}/api/v1/health/ingest`,
                note: 'Shown once. Creating a new key disconnects the old one.',
            });
        } catch (err) {
            console.error('[Health] Key creation failed:', err.message);
            res.status(500).json({ error: 'Could not create a sync key.' });
        }
    });

    router.delete('/key', authenticateToken, async (req, res) => {
        const userId = ownerOf(req);
        if (!userId) return res.status(403).json({ error: 'Sign in first.' });
        try {
            const removed = await dal.deleteHealthKeys(userId);
            res.json({ status: 'success', removed });
        } catch (err) {
            console.error('[Health] Disconnect failed:', err.message);
            res.status(500).json({ error: 'Could not disconnect.' });
        }
    });

    router.get('/status', authenticateToken, async (req, res) => {
        const userId = ownerOf(req);
        if (!userId) return res.status(403).json({ error: 'Sign in first.' });
        try {
            const info = await dal.getHealthKeyInfo(userId);
            res.json({ connected: !!info, createdAt: info?.createdAt || null, lastSyncAt: info?.lastUsedAt || null });
        } catch (err) {
            console.error('[Health] Status failed:', err.message);
            res.status(500).json({ error: 'Could not load health status.' });
        }
    });

    /** Phone → server. Auth: `Authorization: Bearer nsh_…` or `X-Health-Key: nsh_…`. */
    router.post('/ingest', ingestLimiter, async (req, res) => {
        const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
        const key = (req.headers['x-health-key'] || bearer || '').toString().trim();
        if (!key.startsWith(KEY_PREFIX)) {
            return res.status(401).json({ error: 'Missing sync key. Send it as "Authorization: Bearer <key>".' });
        }

        try {
            const keyHash = hashKey(key);
            const owner = await dal.getHealthKey(keyHash);
            if (!owner) return res.status(401).json({ error: 'This sync key is not valid any more. Create a new one in NutriScan.' });

            const timeZone = String(req.query.tz || req.body?.timezone || 'Asia/Kolkata');
            let today;
            try { today = toDateKey(new Date(), timeZone); } catch { today = toDateKey(new Date()); }

            const days = normalizeHealthPayload(req.body, today)
                .filter(d => Object.keys(d).length > 1) // more than just the date
                .sort((a, b) => a.date.localeCompare(b.date))
                .slice(-MAX_DAYS_PER_INGEST);

            if (!days.length) {
                return res.status(400).json({ error: 'No health values found in the request.', code: 'EMPTY_PAYLOAD' });
            }

            for (const { date, ...data } of days) {
                await dal.saveHealthDay(owner.userId, date, { ...data, source: 'apple_health' });
            }
            await dal.touchHealthKey(keyHash);

            console.log(`[Health] Ingested ${days.length} day(s) for user: ${owner.userId}`);
            res.json({ status: 'success', daysSaved: days.length, from: days[0].date, to: days[days.length - 1].date });
        } catch (err) {
            console.error('[Health] Ingest failed:', err.message);
            res.status(500).json({ error: 'Could not save health data.' });
        }
    });

    /** Last N days (oldest first): health + logged meals + net energy, plus insights. */
    router.get('/summary', authenticateToken, async (req, res) => {
        const userId = ownerOf(req);
        if (!userId) return res.status(403).json({ error: 'Sign in first.' });

        try {
            const count = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));
            let timeZone = String(req.query.tz || 'Asia/Kolkata');
            try { toDateKey(new Date(), timeZone); } catch { timeZone = 'Asia/Kolkata'; }

            const dates = [];
            for (let i = count - 1; i >= 0; i--) dates.push(toDateKey(new Date(Date.now() - i * 86400000), timeZone));

            const [healthDays, scans, keyInfo] = await Promise.all([
                dal.getHealthDays(userId, dates),
                dal.getScans(userId, 50),
                dal.getHealthKeyInfo(userId),
            ]);

            const healthByDate = new Map(healthDays.map(d => [d.date, d]));
            const eaten = eatenByDay(scans, timeZone);

            const days = dates.map(date => {
                const raw = healthByDate.get(date);
                let health = null;
                if (raw) {
                    const { userId: _u, date: _d, updatedAt, source, ...rest } = raw;
                    health = rest;
                }
                const e = eaten.get(date) || null;
                const burned = health && (health.activeKcal != null || health.restingKcal != null)
                    ? (health.activeKcal || 0) + (health.restingKcal || 0) : null;
                return {
                    date,
                    health,
                    eaten: e,
                    burnedKcal: burned,
                    netKcal: e && burned != null ? e.kcal - burned : null,
                };
            });

            res.json({
                connected: !!keyInfo,
                lastSyncAt: keyInfo?.lastUsedAt || null,
                timeZone,
                days,
                insights: buildInsights(days),
            });
        } catch (err) {
            console.error('[Health] Summary failed:', err.message);
            res.status(500).json({ error: 'Could not load the health summary.' });
        }
    });

    return router;
}
