const express = require('express');
const { Timestamp } = require('firebase-admin/firestore');
const db = require('./db');
const { requireAuth, requireAdmin } = require('./authMiddleware');
const { createTopupLink, verifyWebhook } = require('./payos');

const router = express.Router();
const { STATUS } = db;

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

/*
 * What each audience may see. These run on every response that leaves the server, so
 * hiding something here is real — unlike hiding it in a page, where the data has already
 * reached the browser.
 */

// A stranger browsing: no phone number (public id instead), no balance, no raw sums.
// Fields from before the profile rework (voiceNote, freeform voiceType) are mapped onto
// the new ones so older profiles still read well.
function publicFreelancerView(f) {
  const rating = f.ratingCount ? Math.round((f.ratingSum / f.ratingCount) * 10) / 10 : null;
  const legacyTag = f.voiceType && f.voiceType !== 'Chưa tự chấm' ? [f.voiceType] : [];
  return {
    id: f.publicId,
    name: f.name,
    bio: f.bio || f.voiceNote || '',
    gender: f.gender || '',
    region: f.region || '',
    voiceTags: f.voiceTags && f.voiceTags.length ? f.voiceTags : legacyTag,
    numberType: f.numberType || 'Số thường',
    numberNote: f.numberNote || '',
    carrier: f.carrier || '',
    hours: f.hours || '',
    accepting: f.accepting !== false,
    hasVoiceDemo: !!f.hasVoiceDemo,
    priceMultiplier: f.priceMultiplier || 1,
    fromPrice: db.fromPrice(f.priceMultiplier),
    rating,
    ratingCount: f.ratingCount || 0,
    completedCount: f.completedCount || 0,
    joinedAt: f.createdAt || null,
  };
}

const preview = (s) => (s && s.length > 120 ? s.slice(0, 120) + '…' : s || '');

// The freelancer on their own orders. The script and the buyer's notes are only shown
// in full once moderation has passed them; the number to dial only while the call is
// actually due — before approval there's nothing to act on, and after the call there's
// no reason to keep holding a stranger's number. The buyer's own number is never shown.
const SCRIPT_REVEALED = new Set([STATUS.APPROVED, STATUS.AWAITING_CONFIRM, STATUS.DISPUTED, STATUS.CLOSED, STATUS.REFUNDED]);
function freelancerOrderView(o) {
  const { buyerPhone, freelancerPhone, calleePhone, calleeName, script, note, moderation, ...rest } = o;
  const revealed = SCRIPT_REVEALED.has(o.status);
  return {
    ...rest,
    script: revealed ? script : preview(script),
    scriptIsPreview: !revealed && (script || '').length > 120,
    note: revealed ? note || '' : '',
    calleeName: revealed ? calleeName || '' : '',
    calleePhone: o.status === STATUS.APPROVED ? calleePhone : null,
  };
}

// The buyer on their own orders: everything they entered, plus which rule rejected the
// script if one did, but not the freelancer's private phone number.
function buyerOrderView(o, byPhone) {
  const { freelancerPhone, buyerPhone, moderation, ...rest } = o;
  const f = byPhone.get(freelancerPhone);
  return {
    ...rest,
    freelancerName: o.freelancerName || (f && f.name) || 'Người nói hộ',
    freelancerId: o.freelancerId || (f && f.publicId) || null,
    bannedFlags: o.status === STATUS.REJECTED && moderation ? moderation.bannedFlags || [] : [],
  };
}

// ---- Public ----
router.get('/freelancers', (req, res) => send(db.listFreelancers().then((list) => list.map(publicFreelancerView)), res));
router.get('/freelancers/:id', (req, res) => send(
  db.getPublicProfile(req.params.id).then(({ freelancer, reviews }) => ({ ...publicFreelancerView(freelancer), reviews })),
  res,
));
router.get('/freelancers/:id/voice-demo', (req, res) => send(db.getVoiceDemoByPublicId(req.params.id), res));
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
    // payOS pings this URL with a made-up orderCode when it is registered, and only
    // accepts the URL if that ping gets a 2xx — so a payment we don't know is acked, not
    // rejected. code '00' is a successful payment; anything else credits nothing.
    if (data.code === '00') await db.creditTopup(data.orderCode, data.amount);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.use(requireAuth);

// ---- Account (everyone: buyers and freelancers alike) ----
router.get('/me', (req, res) => send(db.getAccount(req.phone), res));
router.post('/me', (req, res) => send(db.updateAccount(req.phone, req.body || {}), res));
// The live "is this name free?" check, asked as the person types. Signed-in only, so the
// name list can't be walked anonymously.
router.get('/names/check', (req, res) => send(db.checkName(req.phone, req.query.name), res));

// ---- Wallet ----
router.get('/wallet', (req, res) => send(db.getWallet(req.phone).then((balance) => ({ balance })), res));
router.post('/wallet/topup-link', async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (!(amount > 0)) throw new Error('Số tiền không hợp lệ.');
    const orderCode = Date.now(); // payOS orderCode must be a number unique per payment link
    await db.createTopupIntent(req.phone, amount, orderCode);
    // The wallet is credited only by /payos/webhook, once payOS reports the money arrived.
    const link = await createTopupLink({ orderCode, amount, phone: req.phone });
    res.json({ checkoutUrl: link.checkoutUrl, orderCode });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
router.get('/wallet/topups/:code', (req, res) => send(db.getTopupStatus(req.phone, req.params.code), res));

// ---- Freelancer: own profile, voice demo, orders, withdrawals ----
// /freelancer/me is the owner's own document, so it keeps the balance; fromPrice is
// added so the profile form can show what buyers will see without re-implementing it.
router.get('/freelancer/me', (req, res) => send(
  db.getFreelancer(req.phone).then((f) => (f ? { ...f, fromPrice: db.fromPrice(f.priceMultiplier) } : null)),
  res,
));
router.post('/freelancer/profile', (req, res) => send(db.upsertFreelancerProfile(req.phone, req.body || {}), res));
router.post('/freelancer/accepting', (req, res) => send(db.setAccepting(req.phone, !!(req.body || {}).accepting), res));
router.get('/freelancer/voice-demo', (req, res) => send(db.getOwnVoiceDemo(req.phone), res));
router.put('/freelancer/voice-demo', (req, res) => send(db.setVoiceDemo(req.phone, (req.body || {}).audio), res));
router.delete('/freelancer/voice-demo', (req, res) => send(db.deleteVoiceDemo(req.phone), res));
router.get('/orders/assigned', (req, res) => send(db.listOrdersByFreelancer(req.phone).then((list) => list.map(freelancerOrderView)), res));
router.get('/withdrawals/mine', (req, res) => send(db.listWithdrawalsByFreelancer(req.phone), res));
router.post('/withdrawals', (req, res) => {
  const { amount, bankNumber, bankHolder } = req.body || {};
  send(db.requestWithdrawal(req.phone, Number(amount), bankNumber, bankHolder), res);
});

// ---- Buyer orders ----
router.get('/orders/mine', (req, res) => send((async () => {
  const orders = await db.listOrdersByBuyer(req.phone);
  // Orders from before freelancerName/freelancerId were stored on the order need one
  // lookup per distinct freelancer to fill them in.
  const missing = [...new Set(orders.filter((o) => !o.freelancerName || !o.freelancerId).map((o) => o.freelancerPhone))];
  const found = await Promise.all(missing.map((p) => db.getFreelancer(p)));
  const byPhone = new Map(missing.map((p, i) => [p, found[i]]));
  return orders.map((o) => buyerOrderView(o, byPhone));
})(), res));
router.post('/orders', (req, res) => {
  const b = req.body || {};
  send(db.createOrder({
    buyerPhone: req.phone,
    freelancerId: b.freelancerId,
    freelancerPhone: b.freelancerPhone,
    calleePhone: b.calleePhone,
    calleeName: b.calleeName,
    occasion: b.occasion,
    scheduledAt: b.scheduledAt,
    note: b.note,
    script: b.script,
    duration: b.duration,
    speed: b.speed,
    emotion: b.emotion,
    timing: b.timing,
  }).then((o) => buyerOrderView(o, new Map())), res);
});

async function assertOrderParty(req, res, field) {
  const order = await db.getOrder(req.params.id);
  if (!order) { res.status(404).json({ error: 'Đơn không tồn tại.' }); return null; }
  if (order[field] !== req.phone) { res.status(403).json({ error: 'Đơn này không thuộc về bạn.' }); return null; }
  return order;
}

router.post('/orders/:id/called', async (req, res) => {
  if (!(await assertOrderParty(req, res, 'freelancerPhone'))) return;
  send(db.freelancerMarkCalled(req.params.id, { hasRecording: !!req.body.hasRecording }).then(freelancerOrderView), res);
});
router.post('/orders/:id/decline', async (req, res) => {
  if (!(await assertOrderParty(req, res, 'freelancerPhone'))) return;
  send(db.cancelOrder(req.params.id, { by: 'freelancer', reason: (req.body || {}).reason }).then(freelancerOrderView), res);
});
router.post('/orders/:id/cancel', async (req, res) => {
  if (!(await assertOrderParty(req, res, 'buyerPhone'))) return;
  send(db.cancelOrder(req.params.id, { by: 'buyer', reason: (req.body || {}).reason }).then((o) => buyerOrderView(o, new Map())), res);
});
router.post('/orders/:id/confirm', async (req, res) => {
  if (!(await assertOrderParty(req, res, 'buyerPhone'))) return;
  send(db.buyerConfirm(req.params.id, { method: req.body.method }).then((o) => buyerOrderView(o, new Map())), res);
});
router.post('/orders/:id/dispute', async (req, res) => {
  if (!(await assertOrderParty(req, res, 'buyerPhone'))) return;
  send(db.buyerDispute(req.params.id, { reason: req.body.reason }).then((o) => buyerOrderView(o, new Map())), res);
});
router.post('/orders/:id/rate', async (req, res) => {
  if (!(await assertOrderParty(req, res, 'buyerPhone'))) return;
  send(db.rateOrder(req.params.id, req.body.stars, req.body.comment).then((o) => buyerOrderView(o, new Map())), res);
});

// ---- Admin / CSKH ---- (full documents: moderation needs the script, callee and note)
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
