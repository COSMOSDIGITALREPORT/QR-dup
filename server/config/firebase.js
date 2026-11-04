const fs = require('fs');
const path = require('path');
const { initializeApp, getApps, deleteApp, cert } = require('firebase-admin/app');
const { getFirestore: getFirestoreFromApp } = require('firebase-admin/firestore');

/**
 * Validates the structure of a service account object.
 * Checks for required fields without logging any secret values.
 */
function validateServiceAccount(sa) {
  if (!sa || typeof sa !== 'object' || Array.isArray(sa)) {
    throw new Error('Service account must be a valid JSON object');
  }
  if (!sa.project_id || typeof sa.project_id !== 'string') {
    throw new Error('Service account is missing a valid "project_id"');
  }
  if (!sa.client_email || typeof sa.client_email !== 'string') {
    throw new Error('Service account is missing a valid "client_email"');
  }
  if (!sa.private_key || typeof sa.private_key !== 'string') {
    throw new Error('Service account is missing a valid "private_key"');
  }
}

/**
 * Resolves the service account JSON credentials safely from disk or environment.
 * Primary: FIREBASE_SERVICE_ACCOUNT_PATH (file path).
 * Fallback: FIREBASE_SERVICE_ACCOUNT_JSON (raw JSON string).
 * Never prints or leaks credentials to stdout/stderr.
 */
function resolveCredentials() {
  const accountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (accountPath && typeof accountPath === 'string' && accountPath.trim()) {
    const trimmedPath = accountPath.trim();
    let resolved = path.isAbsolute(trimmedPath)
      ? trimmedPath
      : path.resolve(process.cwd(), trimmedPath);

    if (!fs.existsSync(resolved) && !path.isAbsolute(trimmedPath)) {
      const serverRelative = path.resolve(__dirname, '..', trimmedPath);
      if (fs.existsSync(serverRelative)) {
        resolved = serverRelative;
      }
    }

    if (!fs.existsSync(resolved)) {
      throw new Error(`Firebase service account file not found at: ${resolved}`);
    }

    try {
      const raw = fs.readFileSync(resolved, 'utf8');
      const parsed = JSON.parse(raw);
      validateServiceAccount(parsed);
      return parsed;
    } catch (err) {
      throw new Error(`Failed to read/parse Firebase service account file: ${err.message}`);
    }
  }

  // Fallback: raw JSON string in environment variable
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson && typeof rawJson === 'string' && rawJson.trim()) {
    try {
      const parsed = JSON.parse(rawJson.trim());
      validateServiceAccount(parsed);
      return parsed;
    } catch (err) {
      throw new Error(`Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON: ${err.message}`);
    }
  }

  return null;
}

/**
 * Returns list of currently registered Firebase apps.
 */
function listApps() {
  return typeof getApps === 'function' ? getApps() : [];
}

/**
 * Returns true if valid Firebase credentials are configured and accessible.
 */
function isFirebaseConfigured() {
  try {
    return resolveCredentials() !== null;
  } catch (_) {
    return false;
  }
}

/**
 * Initializes and returns the Firebase Admin App instance.
 * Idempotent: reuses an existing initialized app if already present.
 */
function initFirebase(appName = '[DEFAULT]') {
  const apps = listApps();
  const existing = apps.find((a) => a && a.name === appName);
  if (existing) {
    return existing;
  }

  const creds = resolveCredentials();
  if (!creds) {
    throw new Error('Firebase credentials not configured. Please set FIREBASE_SERVICE_ACCOUNT_PATH.');
  }

  const app = initializeApp(
    {
      credential: cert(creds),
      projectId: creds.project_id,
    },
    appName
  );

  return app;
}

/**
 * Returns the Cloud Firestore database instance.
 */
function getFirestore(appName = '[DEFAULT]') {
  const app = initFirebase(appName);
  const db = getFirestoreFromApp(app);
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (_) {
    // Settings already applied on instance
  }
  return db;
}

/**
 * Returns the firebase-admin instance after ensuring initialization.
 */
function getFirebaseAdmin(appName = '[DEFAULT]') {
  const app = initFirebase(appName);
  return app;
}

/**
 * Closes all Firebase Admin apps cleanly (used for graceful shutdown and tests).
 */
async function closeFirebase() {
  const apps = listApps();
  await Promise.all(
    apps.map((a) => {
      if (!a) return Promise.resolve();
      return deleteApp(a).catch(() => {});
    })
  );
}

module.exports = {
  validateServiceAccount,
  resolveCredentials,
  isFirebaseConfigured,
  initFirebase,
  getFirestore,
  getFirebaseAdmin,
  closeFirebase,
};
