const { db, FieldValue } = require('./firebaseAdmin');

/*
 * Real Firestore port of assets/mock-backend.js's state machine. Same statuses, same
 * money rules (escrow on create, commission on close, recording note deleted on
 * close) — ported 1:1 from the version that already passed TLMN._selfTest(). Anything
 * that checks a balance before moving money runs inside db.runTransaction so two
 * concurrent requests can't both pass the check against the same stale read.
 */

const CONFIRM_TIMEOUT_HOURS = 48; // DECISIONS.md §5 — still not a locked-in number, change here when it is.
const COMMISSION_RATE = 0.15; // DECISIONS.md §8 — placeholder, not a chosen number yet.

const STATUS = {
  PENDING_REVIEW: 'cho_duyet_kich_ban',
  REJECTED: 'kich_ban_bi_tu_choi',
  APPROVED: 'da_duyet_cho_goi',
  AWAITING_CONFIRM: 'cho_xac_nhan',
  CLOSED: 'da_dong',
  DISPUTED: 'tranh_chap',
  REFUNDED: 'da_hoan_tien',
};

const BANNED_CONTENT_CHECKLIST = [
  'Đe dọa, hăm dọa người nghe',
  'Đòi nợ / thu hồi công nợ trá hình',
  'Mạo danh cơ quan nhà nước, công an, ngân hàng',
  'Nội dung khiêu dâm, quấy rối tình dục',
  'Liên quan tới người dưới 18 tuổi không phù hợp',
  'Lừa đảo tài chính, yêu cầu chuyển tiền',
  'Nội dung chính trị nhạy cảm',
];

function roundTo500(n) {
  return Math.round(n / 500) * 500;
}

function calcPrice({ chars, duration, speed, emotion, timing }, multiplier = 1) {
  const base = Math.ceil(chars / 20) * 1000;
  return roundTo500(base * duration * speed * (1 + emotion + timing) * multiplier);
}

async function ensureUser(phone) {
  const ref = db.collection('users').doc(phone);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({ phone, walletBalance: 0, createdAt: FieldValue.serverTimestamp() });
    return { phone, walletBalance: 0 };
  }
  return snap.data();
}

async function getWallet(phone) {
  const u = await ensureUser(phone);
  return u.walletBalance || 0;
}

// ---- Topups: payOS webhook credits by orderCode, looked up in `topups/{orderCode}` ----
async function createTopupIntent(phone, amount, orderCode) {
  await db.collection('topups').doc(String(orderCode)).set({
    phone, amount, orderCode, status: 'pending', createdAt: FieldValue.serverTimestamp(),
  });
}

async function creditTopup(orderCode) {
  const ref = db.collection('topups').doc(String(orderCode));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Không tìm thấy giao dịch nạp tiền ' + orderCode);
    const topup = snap.data();
    if (topup.status === 'credited') return topup; // webhook can retry/duplicate — make it idempotent
    tx.update(ref, { status: 'credited', creditedAt: FieldValue.serverTimestamp() });
    tx.set(db.collection('users').doc(topup.phone), { walletBalance: FieldValue.increment(topup.amount) }, { merge: true });
    return topup;
  });
}

// ---- Freelancer profile ----
async function upsertFreelancerProfile(phone, data) {
  await ensureUser(phone);
  const ref = db.collection('freelancers').doc(phone);
  const snap = await ref.get();
  const base = snap.exists ? {} : { withdrawable: 0, blocked: false, ratingSum: 0, ratingCount: 0, createdAt: FieldValue.serverTimestamp() };
  await ref.set({ phone, ...base, ...data }, { merge: true });
  return (await ref.get()).data();
}

async function getFreelancer(phone) {
  const snap = await db.collection('freelancers').doc(phone).get();
  return snap.exists ? snap.data() : null;
}

async function listFreelancers() {
  const snap = await db.collection('freelancers').where('blocked', '==', false).get();
  return snap.docs.map((d) => d.data());
}

async function listAllFreelancers() {
  const snap = await db.collection('freelancers').get();
  return snap.docs.map((d) => d.data());
}

// ---- Orders ----
async function createOrder({ buyerPhone, freelancerPhone, script, chars, duration, speed, emotion, timing }) {
  const freelancer = await getFreelancer(freelancerPhone);
  if (!freelancer) throw new Error('Người nói hộ không tồn tại.');
  if (freelancer.blocked) throw new Error('Người nói hộ này đã bị khóa, không thể đặt đơn.');
  const price = calcPrice({ chars, duration, speed, emotion, timing }, freelancer.priceMultiplier || 1);

  const orderRef = db.collection('orders').doc();
  const userRef = db.collection('users').doc(buyerPhone);
  await ensureUser(buyerPhone);

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const balance = userSnap.data().walletBalance || 0;
    if (balance < price) throw new Error('Số dư ví không đủ, vui lòng nạp thêm.');
    tx.update(userRef, { walletBalance: balance - price });
    tx.set(orderRef, {
      id: orderRef.id,
      buyerPhone,
      freelancerPhone,
      script,
      chars,
      duration,
      speed,
      emotion,
      timing,
      price,
      status: STATUS.PENDING_REVIEW,
      rating: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return (await orderRef.get()).data();
}

async function adminReviewScript(orderId, { approve, bannedFlags }) {
  const ref = db.collection('orders').doc(orderId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Đơn không tồn tại.');
    const order = snap.data();
    if (order.status !== STATUS.PENDING_REVIEW) throw new Error('Đơn không ở trạng thái chờ duyệt.');
    if (approve) {
      tx.update(ref, { status: STATUS.APPROVED, moderation: { bannedFlags: bannedFlags || [], reviewedAt: FieldValue.serverTimestamp() } });
    } else {
      tx.update(ref, { status: STATUS.REJECTED, moderation: { bannedFlags: bannedFlags || [], reviewedAt: FieldValue.serverTimestamp() } });
      tx.set(db.collection('users').doc(order.buyerPhone), { walletBalance: FieldValue.increment(order.price) }, { merge: true });
    }
    return { ...order, status: approve ? STATUS.APPROVED : STATUS.REJECTED };
  });
}

async function freelancerMarkCalled(orderId, { hasRecording }) {
  const ref = db.collection('orders').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Đơn không tồn tại.');
  if (snap.data().status !== STATUS.APPROVED) throw new Error('Đơn chưa được duyệt hoặc đã xử lý.');
  await ref.update({ status: STATUS.AWAITING_CONFIRM, hasRecording: !!hasRecording, calledAt: FieldValue.serverTimestamp() });
  return (await ref.get()).data();
}

async function buyerConfirm(orderId, { method }) {
  const ref = db.collection('orders').doc(orderId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Đơn không tồn tại.');
    const order = snap.data();
    if (order.status !== STATUS.AWAITING_CONFIRM) throw new Error('Đơn không ở trạng thái chờ xác nhận.');
    const payout = roundTo500(order.price * (1 - COMMISSION_RATE));
    tx.set(db.collection('freelancers').doc(order.freelancerPhone), { withdrawable: FieldValue.increment(payout) }, { merge: true });
    tx.update(ref, {
      status: STATUS.CLOSED,
      closedAt: FieldValue.serverTimestamp(),
      closedVia: method || 'buyer_confirm',
      payout,
      hasRecording: FieldValue.delete(), // recording note is gone the moment the order closes, per DECISIONS.md §5
    });
    return { ...order, status: STATUS.CLOSED, payout };
  });
}

async function buyerDispute(orderId, { reason }) {
  const ref = db.collection('orders').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Đơn không tồn tại.');
  if (snap.data().status !== STATUS.AWAITING_CONFIRM) throw new Error('Chỉ có thể báo tranh chấp khi đơn đang chờ xác nhận.');
  await ref.update({ status: STATUS.DISPUTED, disputeReason: reason });
  return (await ref.get()).data();
}

async function adminResolveDispute(orderId, { decision }) {
  const ref = db.collection('orders').doc(orderId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Đơn không tồn tại.');
    const order = snap.data();
    if (order.status !== STATUS.DISPUTED) throw new Error('Đơn không ở trạng thái tranh chấp.');
    if (decision === 'refund') {
      tx.set(db.collection('users').doc(order.buyerPhone), { walletBalance: FieldValue.increment(order.price) }, { merge: true });
      tx.update(ref, { status: STATUS.REFUNDED, closedAt: FieldValue.serverTimestamp(), hasRecording: FieldValue.delete() });
    } else {
      const payout = roundTo500(order.price * (1 - COMMISSION_RATE));
      tx.set(db.collection('freelancers').doc(order.freelancerPhone), { withdrawable: FieldValue.increment(payout) }, { merge: true });
      tx.update(ref, { status: STATUS.CLOSED, payout, closedAt: FieldValue.serverTimestamp(), hasRecording: FieldValue.delete() });
    }
    return { ...order, status: decision === 'refund' ? STATUS.REFUNDED : STATUS.CLOSED };
  });
}

async function rateOrder(orderId, stars) {
  const ref = db.collection('orders').doc(orderId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Đơn không tồn tại.');
    const order = snap.data();
    if (order.status !== STATUS.CLOSED) throw new Error('Chỉ đánh giá được đơn đã đóng.');
    if (order.rating != null) throw new Error('Đơn này đã được đánh giá.');
    tx.update(ref, { rating: stars });
    tx.set(db.collection('freelancers').doc(order.freelancerPhone), {
      ratingSum: FieldValue.increment(stars),
      ratingCount: FieldValue.increment(1),
    }, { merge: true });
    return { ...order, rating: stars };
  });
}

async function checkTimeouts() {
  const cutoff = Date.now() - CONFIRM_TIMEOUT_HOURS * 3600 * 1000;
  const snap = await db.collection('orders').where('status', '==', STATUS.AWAITING_CONFIRM).get();
  let count = 0;
  for (const doc of snap.docs) {
    const order = doc.data();
    const calledAtMs = order.calledAt ? order.calledAt.toMillis() : 0;
    if (calledAtMs && calledAtMs < cutoff) {
      await buyerConfirm(doc.id, { method: 'auto_timeout' });
      count++;
    }
  }
  return count;
}

async function getOrder(orderId) {
  const snap = await db.collection('orders').doc(orderId).get();
  return snap.exists ? snap.data() : null;
}
async function listOrdersByBuyer(phone) {
  const snap = await db.collection('orders').where('buyerPhone', '==', phone).orderBy('createdAt', 'desc').get();
  return snap.docs.map((d) => d.data());
}
async function listOrdersByFreelancer(phone) {
  const snap = await db.collection('orders').where('freelancerPhone', '==', phone).orderBy('createdAt', 'desc').get();
  return snap.docs.map((d) => d.data());
}
async function listPendingReview() {
  const snap = await db.collection('orders').where('status', '==', STATUS.PENDING_REVIEW).get();
  return snap.docs.map((d) => d.data());
}
async function listDisputed() {
  const snap = await db.collection('orders').where('status', '==', STATUS.DISPUTED).get();
  return snap.docs.map((d) => d.data());
}

// ---- Withdrawals ----
async function requestWithdrawal(phone, amount, bankNumber, bankHolder) {
  if (!(amount > 0)) throw new Error('Số tiền rút không hợp lệ.');
  if (!bankNumber || !bankHolder) throw new Error('Cần nhập số tài khoản và tên chủ tài khoản.');
  const freelancerRef = db.collection('freelancers').doc(phone);
  const wdRef = db.collection('withdrawals').doc();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(freelancerRef);
    if (!snap.exists) throw new Error('Người nói hộ không tồn tại.');
    const withdrawable = snap.data().withdrawable || 0;
    if (amount > withdrawable) throw new Error('Số tiền rút vượt quá số dư có thể rút.');
    tx.update(freelancerRef, { withdrawable: withdrawable - amount });
    tx.set(wdRef, { id: wdRef.id, phone, amount, bankNumber, bankHolder, status: 'cho_duyet', createdAt: FieldValue.serverTimestamp() });
  });
  return (await wdRef.get()).data();
}

async function adminApproveWithdrawal(id) {
  const ref = db.collection('withdrawals').doc(id);
  await ref.update({ status: 'da_chuyen', decidedAt: FieldValue.serverTimestamp() });
  return (await ref.get()).data();
}

async function adminRejectWithdrawal(id) {
  const ref = db.collection('withdrawals').doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const wd = snap.data();
    tx.update(ref, { status: 'tu_choi', decidedAt: FieldValue.serverTimestamp() });
    tx.set(db.collection('freelancers').doc(wd.phone), { withdrawable: FieldValue.increment(wd.amount) }, { merge: true });
    return { ...wd, status: 'tu_choi' };
  });
}

async function listPendingWithdrawals() {
  const snap = await db.collection('withdrawals').where('status', '==', 'cho_duyet').get();
  return snap.docs.map((d) => d.data());
}
async function listWithdrawalsByFreelancer(phone) {
  const snap = await db.collection('withdrawals').where('phone', '==', phone).orderBy('createdAt', 'desc').get();
  return snap.docs.map((d) => d.data());
}

// ---- Callee reports ----
async function submitReport({ callerHint, description }) {
  const ref = db.collection('reports').doc();
  await ref.set({ id: ref.id, callerHint, description, status: 'moi', createdAt: FieldValue.serverTimestamp() });
  return (await ref.get()).data();
}
async function adminDismissReport(id) {
  const ref = db.collection('reports').doc(id);
  await ref.update({ status: 'da_xu_ly' });
  return (await ref.get()).data();
}
async function adminBlockFreelancerFromReport(id, freelancerPhone) {
  await db.collection('freelancers').doc(freelancerPhone).set({ blocked: true }, { merge: true });
  const ref = db.collection('reports').doc(id);
  await ref.update({ status: 'da_khoa_tai_khoan' });
  return (await ref.get()).data();
}
async function listPendingReports() {
  const snap = await db.collection('reports').where('status', '==', 'moi').get();
  return snap.docs.map((d) => d.data());
}

module.exports = {
  STATUS,
  BANNED_CONTENT_CHECKLIST,
  calcPrice,
  ensureUser,
  getWallet,
  createTopupIntent,
  creditTopup,
  upsertFreelancerProfile,
  getFreelancer,
  listFreelancers,
  listAllFreelancers,
  createOrder,
  adminReviewScript,
  freelancerMarkCalled,
  buyerConfirm,
  buyerDispute,
  adminResolveDispute,
  rateOrder,
  checkTimeouts,
  getOrder,
  listOrdersByBuyer,
  listOrdersByFreelancer,
  listPendingReview,
  listDisputed,
  requestWithdrawal,
  adminApproveWithdrawal,
  adminRejectWithdrawal,
  listPendingWithdrawals,
  listWithdrawalsByFreelancer,
  submitReport,
  adminDismissReport,
  adminBlockFreelancerFromReport,
  listPendingReports,
};
