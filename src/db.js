const crypto = require('crypto');
const { db, FieldValue, auth } = require('./firebaseAdmin');

/*
 * Real Firestore port of assets/mock-backend.js's state machine. Same statuses, same
 * money rules (escrow on create, commission on close, recording note deleted on
 * close) — ported 1:1 from the version that already passed TLMN._selfTest(). Anything
 * that checks a balance before moving money runs inside db.runTransaction so two
 * concurrent requests can't both pass the check against the same stale read.
 *
 * Nothing in here trusts a number the client computed. Prices are recomputed from the
 * script itself and from option values checked against PRICE_OPTIONS; profile writes go
 * through a whitelist so a client can't set its own balance, rating or blocked flag.
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
  CANCELLED: 'da_huy',
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

// The only values the order form offers (dat-don.html's <select>s). Anything else is a
// hand-made request trying to shrink its own price, so it's refused rather than clamped.
const PRICE_OPTIONS = {
  duration: [1, 1.3, 1.6],
  speed: [1.1, 1, 1.15],
  emotion: [0, 0.1, 0.2],
  timing: [0, 0.15, 0.3],
};
const MAX_SCRIPT = 2000;

// "Từ X đ" on a freelancer's card: a ~100-character message, under two minutes, every
// option at its base value. Computed here so the frontend never re-implements pricing.
const FROM_PRICE_REF = { chars: 100, duration: 1, speed: 1, emotion: 0, timing: 0 };

function roundTo500(n) {
  return Math.round(n / 500) * 500;
}

function calcPrice({ chars, duration, speed, emotion, timing }, multiplier = 1) {
  const base = Math.ceil(chars / 20) * 1000;
  return roundTo500(base * duration * speed * (1 + emotion + timing) * multiplier);
}

const fromPrice = (multiplier) => calcPrice(FROM_PRICE_REF, multiplier || 1);

// Trimmed, length-capped free text. Profile and order fields are display-only, so a
// too-long value is cut rather than refused.
const text = (v, max) => String(v ?? '').trim().slice(0, max);

const newPublicId = () => crypto.randomBytes(5).toString('hex');

const millis = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : Number(t) || 0);

// 0901234567 -> 090•••567. Reviews are public; whoever wrote one shouldn't be.
function maskPhone(e164) {
  const local = String(e164 || '').replace(/^\+84/, '0');
  return local.length > 6 ? `${local.slice(0, 3)}•••${local.slice(-3)}` : 'Ẩn danh';
}

// ---- Simulated OTP (TEMPORARY — see DECISIONS.md §12) ----
// Real Firebase Phone Auth needs the Blaze plan to send SMS at all; until that's
// decided, this hands the OTP straight back to whoever asks instead of texting it —
// meaning anyone who knows a phone number can "log in" as it. Never treat this as real
// identity verification. Swap it out for real signInWithPhoneNumber client-side (and
// delete these two functions) without touching anything downstream — the custom token
// below produces a normal Firebase session with the same phone_number claim either way.
const OTP_TTL_MS = 10 * 60 * 1000;

async function requestSimulatedOtp(phone) {
  const code = String(Math.floor(1000 + Math.random() * 9000));
  await db.collection('otps').doc(phone).set({ code, expiresAt: Date.now() + OTP_TTL_MS });
  return code;
}

async function verifySimulatedOtp(phone, code) {
  const ref = db.collection('otps').doc(phone);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Chưa yêu cầu mã OTP cho số này.');
  const rec = snap.data();
  if (rec.code !== String(code) || Date.now() > rec.expiresAt) throw new Error('Mã OTP không đúng hoặc đã hết hạn.');
  await ref.delete();
  let user;
  try {
    user = await auth.getUserByPhoneNumber(phone);
  } catch (e) {
    user = await auth.createUser({ phoneNumber: phone });
  }
  return auth.createCustomToken(user.uid);
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

/*
 * The only fields a freelancer may set on their own profile. Everything else on the
 * document — withdrawable, blocked, ratingSum/Count, completedCount, publicId,
 * hasVoiceDemo — is written by the server alone. This used to spread the request body
 * straight into the document, which let any signed-in account set its own balance.
 *
 * Taxonomy values (voice tags, carriers) live in assets/catalog.js. They are only
 * length-checked here, not matched against that list: a bad value can only mislabel the
 * sender's own profile, and a second copy of the list here would just drift.
 */
function profileFields(input) {
  const name = text(input.name, 40);
  if (!name) throw new Error('Nhập tên hiển thị.');
  const multiplier = Number(input.priceMultiplier);
  if (!(multiplier >= 1 && multiplier <= 5)) throw new Error('Hệ số giá phải từ 1 đến 5.');
  const tags = Array.isArray(input.voiceTags) ? input.voiceTags.map((t) => text(t, 20)).filter(Boolean) : [];
  return {
    name,
    bio: text(input.bio, 300),
    gender: ['nam', 'nu'].includes(input.gender) ? input.gender : '',
    region: ['bac', 'trung', 'nam'].includes(input.region) ? input.region : '',
    voiceTags: [...new Set(tags)].slice(0, 5),
    numberType: text(input.numberType, 20) || 'Số thường',
    numberNote: text(input.numberNote, 40),
    carrier: text(input.carrier, 20),
    hours: text(input.hours, 60),
    accepting: input.accepting !== false,
    priceMultiplier: Math.round(multiplier * 10) / 10,
  };
}

async function upsertFreelancerProfile(phone, input = {}) {
  const data = profileFields(input);
  await ensureUser(phone);
  const ref = db.collection('freelancers').doc(phone);
  const snap = await ref.get();
  const base = snap.exists
    ? {}
    : { phone, withdrawable: 0, blocked: false, ratingSum: 0, ratingCount: 0, completedCount: 0, hasVoiceDemo: false, createdAt: FieldValue.serverTimestamp() };
  await ref.set({ ...base, ...data }, { merge: true });
  return migrateFreelancer((await ref.get()).data());
}

async function setAccepting(phone, accepting) {
  const ref = db.collection('freelancers').doc(phone);
  if (!(await ref.get()).exists) throw new Error('Lưu hồ sơ trước đã.');
  await ref.set({ accepting: !!accepting }, { merge: true });
  return (await ref.get()).data();
}

/*
 * Freelancers created before public ids existed: give them one, and count the orders
 * they already closed so the listing doesn't present a veteran as brand new.
 * ponytail: two first-time readers racing could each assign a different id and the
 * second wins — harmless while nobody has shared the first one yet; wrap in a
 * transaction if that ever matters.
 */
async function migrateFreelancer(f) {
  if (!f || f.publicId) return f;
  const patch = { publicId: newPublicId() };
  if (f.completedCount == null) {
    const snap = await db.collection('orders').where('freelancerPhone', '==', f.phone).get();
    patch.completedCount = snap.docs.filter((d) => d.data().status === STATUS.CLOSED).length;
  }
  await db.collection('freelancers').doc(f.phone).set(patch, { merge: true });
  return { ...f, ...patch };
}

async function getFreelancer(phone) {
  const snap = await db.collection('freelancers').doc(phone).get();
  return snap.exists ? migrateFreelancer(snap.data()) : null;
}

async function getFreelancerByPublicId(id) {
  if (!id) return null;
  const snap = await db.collection('freelancers').where('publicId', '==', String(id)).limit(1).get();
  if (snap.empty) return null;
  const f = snap.docs[0].data();
  return f.blocked ? null : f;
}

async function listFreelancers() {
  const snap = await db.collection('freelancers').where('blocked', '==', false).get();
  return Promise.all(snap.docs.map((d) => migrateFreelancer(d.data())));
}

async function listAllFreelancers() {
  const snap = await db.collection('freelancers').get();
  return snap.docs.map((d) => d.data());
}

/*
 * Public reviews: the rated orders of one freelancer, newest first, with the buyer's
 * number masked and nothing from the script — what was said on a call stays private.
 * ponytail: reads every order of this freelancer to pick the rated ones, so no
 * composite index is needed; add (freelancerPhone, reviewedAt) and query directly once a
 * single freelancer has thousands of orders.
 */
async function listReviews(phone, limit = 20) {
  const snap = await db.collection('orders').where('freelancerPhone', '==', phone).get();
  return snap.docs
    .map((d) => d.data())
    .filter((o) => o.rating != null)
    .sort((a, b) => millis(b.reviewedAt || b.closedAt) - millis(a.reviewedAt || a.closedAt))
    .slice(0, limit)
    .map((o) => ({
      stars: o.rating,
      comment: o.reviewComment || '',
      occasion: o.occasion || '',
      buyer: maskPhone(o.buyerPhone),
      at: millis(o.reviewedAt || o.closedAt || o.createdAt),
    }));
}

async function getPublicProfile(id) {
  const f = await getFreelancerByPublicId(id);
  if (!f) throw new Error('Không tìm thấy người nói hộ này.');
  return { freelancer: f, reviews: await listReviews(f.phone) };
}

// ---- Voice demos ----
// Stored as a data URL in its own document so the freelancer listing stays light.
// Firestore caps a document at 1 MiB; 600k characters of base64 is ~450 KB of audio,
// far more than 20 seconds of speech at the bitrate freelancer.html records at.
const MAX_VOICE_DATA_URL = 600000;
const VOICE_DATA_URL = /^data:audio\/[\w.+-]+(;[\w=.+-]+)*;base64,[A-Za-z0-9+/=]+$/;

async function setVoiceDemo(phone, audio) {
  const ref = db.collection('freelancers').doc(phone);
  if (!(await ref.get()).exists) throw new Error('Lưu hồ sơ trước khi thêm giọng mẫu.');
  if (typeof audio !== 'string' || !VOICE_DATA_URL.test(audio)) throw new Error('Tệp giọng mẫu không hợp lệ.');
  if (audio.length > MAX_VOICE_DATA_URL) throw new Error('Giọng mẫu quá dài — khoảng 20 giây là đủ.');
  await db.collection('voiceDemos').doc(phone).set({ audio, updatedAt: FieldValue.serverTimestamp() });
  await ref.set({ hasVoiceDemo: true }, { merge: true });
  return { hasVoiceDemo: true };
}

async function deleteVoiceDemo(phone) {
  await db.collection('voiceDemos').doc(phone).delete();
  await db.collection('freelancers').doc(phone).set({ hasVoiceDemo: false }, { merge: true });
  return { hasVoiceDemo: false };
}

async function getVoiceDemoByPublicId(id) {
  const f = await getFreelancerByPublicId(id);
  if (!f || !f.hasVoiceDemo) throw new Error('Người này chưa có giọng mẫu.');
  const snap = await db.collection('voiceDemos').doc(f.phone).get();
  if (!snap.exists) throw new Error('Người này chưa có giọng mẫu.');
  return { audio: snap.data().audio };
}

async function getOwnVoiceDemo(phone) {
  const snap = await db.collection('voiceDemos').doc(phone).get();
  return { audio: snap.exists ? snap.data().audio : null };
}

// ---- Orders ----
async function createOrder({ buyerPhone, freelancerId, freelancerPhone, calleePhone, calleeName, occasion, scheduledAt, note, script, duration, speed, emotion, timing }) {
  // The whole product is "freelancer calls a third party" — without this the freelancer
  // has a script and a price but no one to dial. The frontend normalises it to E.164;
  // this is defense in depth against a client that skips that.
  calleePhone = text(calleePhone, 20);
  if (!/\d{8,}/.test(calleePhone)) throw new Error('Nhập số điện thoại của người sẽ nhận cuộc gọi.');

  script = String(script || '').trim();
  if (!script) throw new Error('Viết lời bạn muốn gửi.');
  if (script.length > MAX_SCRIPT) throw new Error(`Lời nhắn tối đa ${MAX_SCRIPT} ký tự.`);

  const options = { duration: Number(duration), speed: Number(speed), emotion: Number(emotion), timing: Number(timing) };
  for (const [key, value] of Object.entries(options)) {
    if (!PRICE_OPTIONS[key].includes(value)) throw new Error('Tuỳ chọn cuộc gọi không hợp lệ, tải lại trang rồi thử lại.');
  }

  let when = null;
  if (scheduledAt != null && scheduledAt !== '') {
    when = Number(scheduledAt);
    const now = Date.now();
    if (!Number.isFinite(when) || when < now - 5 * 60 * 1000 || when > now + 60 * 24 * 3600 * 1000) {
      throw new Error('Thời điểm gọi phải nằm trong 60 ngày tới.');
    }
  }

  // freelancerPhone is the pre-publicId path, kept so a page loaded before this deploy
  // can still place its order.
  const freelancer = freelancerId ? await getFreelancerByPublicId(freelancerId) : await getFreelancer(freelancerPhone);
  if (!freelancer) throw new Error('Người nói hộ không tồn tại.');
  if (freelancer.blocked) throw new Error('Người nói hộ này đã bị khóa, không thể đặt đơn.');
  if (freelancer.accepting === false) throw new Error('Người nói hộ này đang tạm nghỉ, chưa nhận đơn mới.');
  if (freelancer.phone === buyerPhone) throw new Error('Không thể tự đặt đơn cho chính mình.');

  const chars = script.length; // counted here — the client's own count is never used for price
  const price = calcPrice({ chars, ...options }, freelancer.priceMultiplier || 1);

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
      freelancerPhone: freelancer.phone,
      freelancerId: freelancer.publicId || null,
      freelancerName: freelancer.name || '',
      calleePhone,
      calleeName: text(calleeName, 60),
      occasion: text(occasion, 40),
      scheduledAt: when,
      note: text(note, 500),
      script,
      chars,
      ...options,
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

/*
 * Cancelling refunds the buyer in full, so it's only allowed before any work is done:
 * the buyer may cancel while the script is still waiting for moderation; the freelancer
 * may also decline after approval, up until they report the call as made.
 */
const CANCELLABLE_BY = {
  buyer: [STATUS.PENDING_REVIEW],
  freelancer: [STATUS.PENDING_REVIEW, STATUS.APPROVED],
};

async function cancelOrder(orderId, { by, reason }) {
  const allowed = CANCELLABLE_BY[by];
  if (!allowed) throw new Error('Không được phép huỷ đơn.');
  const ref = db.collection('orders').doc(orderId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Đơn không tồn tại.');
    const order = snap.data();
    if (!allowed.includes(order.status)) {
      throw new Error(by === 'buyer' ? 'Chỉ huỷ được đơn đang chờ duyệt.' : 'Đơn này không còn từ chối được.');
    }
    tx.update(ref, {
      status: STATUS.CANCELLED,
      cancelledBy: by,
      cancelReason: text(reason, 300),
      closedAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection('users').doc(order.buyerPhone), { walletBalance: FieldValue.increment(order.price) }, { merge: true });
    return { ...order, status: STATUS.CANCELLED, cancelledBy: by };
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

function payFreelancer(tx, order) {
  const payout = roundTo500(order.price * (1 - COMMISSION_RATE));
  tx.set(db.collection('freelancers').doc(order.freelancerPhone), {
    withdrawable: FieldValue.increment(payout),
    completedCount: FieldValue.increment(1),
  }, { merge: true });
  return payout;
}

async function buyerConfirm(orderId, { method }) {
  const ref = db.collection('orders').doc(orderId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Đơn không tồn tại.');
    const order = snap.data();
    if (order.status !== STATUS.AWAITING_CONFIRM) throw new Error('Đơn không ở trạng thái chờ xác nhận.');
    const payout = payFreelancer(tx, order);
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
  reason = text(reason, 500);
  if (!reason) throw new Error('Cho biết điều gì chưa đúng với cuộc gọi.');
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
      const payout = payFreelancer(tx, order);
      tx.update(ref, { status: STATUS.CLOSED, payout, closedAt: FieldValue.serverTimestamp(), hasRecording: FieldValue.delete() });
    }
    return { ...order, status: decision === 'refund' ? STATUS.REFUNDED : STATUS.CLOSED };
  });
}

async function rateOrder(orderId, stars, comment) {
  stars = Number(stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new Error('Chọn từ 1 đến 5 sao.');
  const ref = db.collection('orders').doc(orderId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Đơn không tồn tại.');
    const order = snap.data();
    if (order.status !== STATUS.CLOSED) throw new Error('Chỉ đánh giá được đơn đã hoàn thành.');
    if (order.rating != null) throw new Error('Đơn này đã được đánh giá.');
    tx.update(ref, { rating: stars, reviewComment: text(comment, 500), reviewedAt: FieldValue.serverTimestamp() });
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
    const calledAtMs = millis(order.calledAt);
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
  bankNumber = text(bankNumber, 30);
  bankHolder = text(bankHolder, 60);
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
  description = text(description, 1000);
  if (!description) throw new Error('Mô tả chuyện gì đã xảy ra.');
  const ref = db.collection('reports').doc();
  await ref.set({ id: ref.id, callerHint: text(callerHint, 20), description, status: 'moi', createdAt: FieldValue.serverTimestamp() });
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
  PRICE_OPTIONS,
  calcPrice,
  fromPrice,
  requestSimulatedOtp,
  verifySimulatedOtp,
  ensureUser,
  getWallet,
  createTopupIntent,
  creditTopup,
  upsertFreelancerProfile,
  setAccepting,
  getFreelancer,
  getFreelancerByPublicId,
  getPublicProfile,
  listFreelancers,
  listAllFreelancers,
  setVoiceDemo,
  deleteVoiceDemo,
  getVoiceDemoByPublicId,
  getOwnVoiceDemo,
  createOrder,
  adminReviewScript,
  cancelOrder,
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
