const fs = require('fs');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

// Render "Secret Files" land at /etc/secrets/<filename> — upload the service account
// JSON you download from Firebase as-is under that name instead of pasting it into an
// env var. FIREBASE_SERVICE_ACCOUNT_JSON (inline JSON string) still works too, e.g. for
// other hosts or local dev via .env.
const SECRET_FILE_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_FILE || '/etc/secrets/serviceAccountKey.json';

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  if (fs.existsSync(SECRET_FILE_PATH)) {
    return JSON.parse(fs.readFileSync(SECRET_FILE_PATH, 'utf8'));
  }
  throw new Error(
    `No Firebase credentials found — set FIREBASE_SERVICE_ACCOUNT_JSON or add a Secret File at ${SECRET_FILE_PATH} (see .env.example).`
  );
}

if (!getApps().length) {
  initializeApp({ credential: cert(loadServiceAccount()) });
}

module.exports = { auth: getAuth(), db: getFirestore(), FieldValue, Timestamp };
