/**
 * Firebase Auth helpers — verifies sign-in tokens issued to the web app.
 *
 * The browser signs in with Google/Apple through Firebase Auth and sends us the
 * resulting ID token. We verify it here (signature, audience, expiry) and never
 * trust identity fields sent by the client.
 *
 * Shares the firebase-admin app with the Firestore driver when that is the
 * active DB provider; otherwise initialises it from the same env credentials.
 */

import admin from 'firebase-admin';

function ensureAdminApp() {
    if (admin.apps.length) return;

    const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
    if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: FIREBASE_PROJECT_ID.trim(),
                clientEmail: FIREBASE_CLIENT_EMAIL,
                privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/^["']|["']$/g, '').trim(),
            }),
            projectId: FIREBASE_PROJECT_ID.trim(),
        });
    } else {
        admin.initializeApp();
    }
}

/**
 * Verify a Firebase ID token and return the identity we rely on.
 * @param {string} idToken
 * @returns {Promise<{uid: string, email: string|null, emailVerified: boolean, name: string|null, picture: string|null, provider: string}>}
 * @throws if the token is missing, malformed, expired or for another project
 */
export async function verifySignInToken(idToken) {
    if (!idToken || typeof idToken !== 'string') throw new Error('idToken is required');
    ensureAdminApp();

    const decoded = await admin.auth().verifyIdToken(idToken);
    return {
        uid: decoded.uid,
        email: decoded.email ? decoded.email.toLowerCase() : null,
        emailVerified: decoded.email_verified === true,
        name: decoded.name || null,
        picture: decoded.picture || null,
        provider: decoded.firebase?.sign_in_provider || 'unknown',
    };
}

// ── Which sign-in providers are actually switched on in Firebase ────────────
let providerCache = { at: 0, value: null };

/**
 * Ask Firebase which providers are enabled (cached 10 minutes).
 * Returns e.g. ['google'] — or null if the lookup isn't possible.
 */
export async function getEnabledProviders() {
    if (Date.now() - providerCache.at < 10 * 60 * 1000) return providerCache.value;
    let value = null;
    try {
        ensureAdminApp();
        const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
        const { access_token } = await admin.app().options.credential.getAccessToken();
        const r = await fetch(`https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/defaultSupportedIdpConfigs`, {
            headers: { Authorization: `Bearer ${access_token}` },
            signal: AbortSignal.timeout(5000),
        });
        if (r.ok) {
            const data = await r.json();
            value = (data.defaultSupportedIdpConfigs || [])
                .filter(c => c.enabled)
                .map(c => String(c.name).split('/').pop())
                .map(id => id === 'google.com' ? 'google' : id === 'apple.com' ? 'apple' : id);
        }
    } catch (e) {
        console.warn('[Auth] Could not read enabled sign-in providers:', e.message);
    }
    providerCache = { at: Date.now(), value };
    return value;
}

/** Public web config for the browser SDK, or null when sign-in isn't configured. */
export function getWebAuthConfig() {
    const apiKey = (process.env.FIREBASE_WEB_API_KEY || '').trim();
    const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
    if (!apiKey || !projectId) return null;

    const providers = (process.env.AUTH_PROVIDERS || 'google')
        .split(',').map(p => p.trim().toLowerCase()).filter(p => p === 'google' || p === 'apple');

    return {
        apiKey, // Firebase web API keys identify the project; they are not secrets
        authDomain: (process.env.FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`).trim(),
        projectId,
        appId: (process.env.FIREBASE_WEB_APP_ID || '').trim() || undefined,
        providers: providers.length ? providers : ['google'],
    };
}
