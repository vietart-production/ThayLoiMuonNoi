const express = require('express');
const { Timestamp } = require('firebase-admin/firestore');
const db = require('./db');
const { requireAuth, requireAdmin } = require('./authMiddleware');
const { createTopupLink, verifyWebhook } = require('./payos');

const router = express.Router();

// Firestore Timestamp doesn't have a toJSON(), so a bare JSON.stringify turns createdAt/
// calledAt/closedAt into {_seconds, _nanoseconds} — useless on the frontend. Convert to
// epoch millis everywhere, once, here, instead of in every route.
function serialize(value) {
  if (value instanceof Timestamp) return value.toMillis();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k in value) out[k] = serialize(value[k]);
    return out;
  }
  return value;
}

function send(promise, res) {
  promise.then((data) => res.json(serialize(data))).catch((e) => res.status(400).json({ error: e.message }));
}

// ---- Public ----
// Strip fields a stranger shouldn't see (withdrawable balance, raw rating sum) — only
// /admin/freelancers (admin-only) gets the full document.
function publicFreelancerView(f) {
  const rating = f.ratingCount ? Math.round((f.ratingSum / f.ratingCount) * 10) / 10 : null;
  return {
    phone: f.phone,
    name: f.name,
    voiceNote: f.voiceNote,
    voiceType: f.voiceType,
    numberType: f.numberType,
    carrier: f.carrier,
    priceMultiplier: f.priceMultiplier,
    rating,
    ratingCount: f.ratingCount || 0,
  };
}
router.get('/freelancers', (req, res) => send(db.listFreelancers().then((list) => list.map(publicFreelancerView)), res));
router.post('/reports', (req, res) => send(db.submitReport(req.body || {}), res));

// TEMPORARY simulated OTP (see src/db.js) — hands the code back instead of texting it.
// No real identity check happens here; remove once real Phone Auth (or a real SMS
// provider) is wired up.
router.post('/auth/request-otp', (req, res) => {
  const phone = req.body.phone;
  send(db.requestSimulatedOtp(phone).then((code) => ({ phone, code })), res);
});
router.post('/auth/verify-otp', (req, res) => {
  send(db.verifySimulatedOtp(req.body.phone, req.body.code).then((customToken) => ({ customToken })), res);
});

// payOS calls this directly — no user auth, the signature itself is the auth.
router.post('/payos/webhook', async (req, res) => {
  try {
    const data = await verifyWebhook(req.body);
    await db.creditTopup(data.orderCode);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.use(requireAuth);

// ---- Wallet ----
router.get('/wallet', (req, res) => send(db.getWallet(req.phone).then((balance) => ({ balance })), res));
router.post('/wallet/topup-link', async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (!(amount > 0)) throw new Error('Số tiền không hợp lệ.');
    const orderCode = Date.now(); // payOS orderCode must be a number unique per payment link
    await db.createTopupIntent(req.phone, amount, orderCode);
    const link = await createTopupLink({ orderCode, amount, phone: req.phone }); // real payOS call, link/QR is real

    // TEMPORARY: credit immediately instead of waiting for the real payOS webhook to
    // confirm an actual payment (see DECISIONS.md §13). creditTopup() is idempotent, so
    // if the real webhook also fires later for this orderCode it's a no-op, not a double
    // credit. Delete this one line (keep everything else) once ready to require real
    // money before crediting a wallet.
    await db.creditTopup(orderCode);

    res.json({ ...link, simulated: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Freelancer profile ----
router.post('/freelancer/profile', (req, res) => send(db.upsertFreelancerProfile(req.phone, req.body || {}), res));
router.get('/freelancer/me', (req, res) => send(db.getFreelancer(req.phone), res));
router.get('/orders/assigned', (req, res) => send(db.listOrdersByFreelancer(req.phone), res));
router.get('/withdrawals/mine', (req, res) => send(db.listWithdrawalsByFreelancer(req.phone), res));
router.post('/withdrawals', (req, res) => {
  const { amount, bankNumber, bankHolder } = req.body || {};
  send(db.requestWithdrawal(req.phone, Number(amount), bankNumber, bankHolder), res);
});

// ---- Buyer orders ----
router.get('/orders/mine', (req, res) => send(db.listOrdersByBuyer(req.phone), res));
router.post('/orders', (req, res) => {
  const { freelancerPhone, script, chars, duration, speed, emotion, timing, calleePhone } = req.body || {};
  send(db.createOrder({
    buyerPhone: req.phone,
    freelancerPhone,
    calleePhone,
    script,
    chars: Number(chars),
    duration: Number(duration),
    speed: Number(speed),
    emotion: Number(emotion),
    timing: Number(timing),
  }), res);
});

async function assertOrderParty(req, res, field) {
  const order = await db.getOrder(req.params.id);
  if (!order) { res.status(404).json({ error: 'Đơn không tồn tại.' }); return null; }
  if (order[field] !== req.phone) { res.status(403).json({ error: 'Đơn này không thuộc về bạn.' }); return null; }
  return order;
}

router.post('/orders/:id/called', async (req, res) => {
  if (!(await assertOrderParty(req, res, 'freelancerPhone'))) return;
  send(db.freelancerMarkCalled(req.params.id, { hasRecording: !!req.body.hasRecording }), res);
});
router.post('/orders/:id/confirm', async (req, res) => {
  if (!(await assertOrderParty(req, res, 'buyerPhone'))) return;
  send(db.buyerConfirm(req.params.id, { method: req.body.method }), res);
});
router.post('/orders/:id/dispute', async (req, res) => {
  if (!(await assertOrderParty(req, res, 'buyerPhone'))) return;
  send(db.buyerDispute(req.params.id, { reason: req.body.reason }), res);
});
router.post('/orders/:id/rate', async (req, res) => {
  if (!(await assertOrderParty(req, res, 'buyerPhone'))) return;
  send(db.rateOrder(req.params.id, Number(req.body.stars)), res);
});

// ---- Admin / CSKH ----
const admin = express.Router();
admin.use(requireAdmin);
admin.get('/orders/pending-review', (req, res) => send(db.listPendingReview(), res));
admin.post('/orders/:id/review', (req, res) => send(db.adminReviewScript(req.params.id, { approve: !!req.body.approve, bannedFlags: req.body.bannedFlags || [] }), res));
admin.get('/orders/disputed', (req, res) => send(db.listDisputed(), res));
admin.post('/orders/:id/resolve-dispute', (req, res) => send(db.adminResolveDispute(req.params.id, { decision: req.body.decision }), res));
admin.get('/withdrawals/pending', (req, res) => send(db.listPendingWithdrawals(), res));
admin.post('/withdrawals/:id/approve', (req, res) => send(db.adminApproveWithdrawal(req.params.id), res));
admin.post('/withdrawals/:id/reject', (req, res) => send(db.adminRejectWithdrawal(req.params.id), res));
admin.get('/reports/pending', (req, res) => send(db.listPendingReports(), res));
admin.post('/reports/:id/dismiss', (req, res) => send(db.adminDismissReport(req.params.id), res));
admin.post('/reports/:id/block', (req, res) => send(db.adminBlockFreelancerFromReport(req.params.id, req.body.freelancerPhone), res));
admin.get('/freelancers', (req, res) => send(db.listAllFreelancers(), res));
admin.post('/timeouts/run', (req, res) => send(db.checkTimeouts().then((count) => ({ count })), res));
router.use('/admin', admin);

module.exports = router;
