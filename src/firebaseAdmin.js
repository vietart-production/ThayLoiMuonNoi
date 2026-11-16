const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

if (!getApps().length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not set — see .env.example.');
  }
  initializeApp({ credential: cert(JSON.parse(raw)) });
}

module.exports = { auth: getAuth(), db: getFirestore(), FieldValue, Timestamp };
