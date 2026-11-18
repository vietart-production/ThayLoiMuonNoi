/*
 * npm run selftest  (from the repo root)
 *
 * Boots the real server.js — real routes, real src/db.js money logic, real JSON body
 * limit — against an in-memory stand-in for Firestore/Auth/payOS, then drives it over
 * HTTP the way the pages do. Nothing touches the live database.
 *
 * It exists because the dangerous bugs here don't throw: a profile write that lets an
 * account set its own balance, a price computed from a number the client made up, a
 * public listing that leaks phone numbers. Each of those is asserted against below.
 */
const assert = require('assert');
const { Timestamp } = require('firebase-admin/firestore');

// ---------------------------------------------------------------- fake Firestore ----
const FV = Symbol('fieldValue');
const FieldValue = {
  serverTimestamp: () => ({ [FV]: 'ts' }),
  increment: (n) => ({ [FV]: 'inc', n }),
  delete: () => ({ [FV]: 'del' }),
};
const clone = (v) => {
  if (v instanceof Timestamp || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(clone);
  const o = {};
  for (const k in v) o[k] = clone(v[k]);
  return o;
};
function applyPatch(current, patch) {
  const next = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v && v[FV] === 'del') delete next[k];
    else if (v && v[FV] === 'inc') next[k] = (next[k] || 0) + v.n;
    else if (v && v[FV] === 'ts') next[k] = Timestamp.now();
    else next[k] = clone(v);
  }
  return next;
}

const store = new Map(); // "collection" -> Map(id -> data)
const table = (name) => store.get(name) || store.set(name, new Map()).get(name);
let autoId = 0;

function docRef(col, id) {
  const ref = {
    id,
    _col: col,
    async get() {
      const data = table(col).get(id);
      return { id, exists: data !== undefined, data: () => clone(data) };
    },
    async set(data, opts = {}) { writeDoc(ref, data, opts.merge ? 'merge' : 'set'); },
    async update(data) { writeDoc(ref, data, 'update'); },
    async delete() { table(ref._col).delete(ref.id); },
  };
  return ref;
}
function writeDoc(ref, data, mode) {
  const t = table(ref._col);
  if (mode === 'update' && !t.has(ref.id)) throw new Error(`NOT_FOUND ${ref._col}/${ref.id}`);
  t.set(ref.id, applyPatch(mode === 'set' ? {} : t.get(ref.id) || {}, data));
}
const sortKey = (v) => (v instanceof Timestamp ? v.toMillis() : v);
function query(col, filters = [], order = null, max = Infinity) {
  return {
    where: (f, op, v) => { assert.equal(op, '==', 'fake only supports =='); return query(col, [...filters, [f, v]], order, max); },
    orderBy: (f, dir = 'asc') => query(col, filters, [f, dir], max),
    limit: (n) => query(col, filters, order, n),
    async get() {
      let rows = [...table(col).entries()].filter(([, d]) => filters.every(([f, v]) => d[f] === v));
      if (order) {
        const [f, dir] = order;
        rows.sort((a, b) => (sortKey(a[1][f]) > sortKey(b[1][f]) ? 1 : -1) * (dir === 'desc' ? -1 : 1));
      }
      const docs = rows.slice(0, max).map(([id, d]) => ({ id, exists: true, data: () => clone(d) }));
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  };
}
const db = {
  collection: (col) => ({
    doc: (id) => docRef(col, id || `auto${++autoId}`),
    ...query(col),
  }),
  // Writes are queued and applied only if the callback finishes, so a check that throws
  // mid-transaction leaves no money moved — the property the real code relies on.
  async runTransaction(fn) {
    const writes = [];
    const tx = {
      get: (ref) => ref.get(),
      set: (ref, data, opts = {}) => writes.push([ref, data, opts.merge ? 'merge' : 'set']),
      update: (ref, data) => writes.push([ref, data, 'update']),
    };
    const result = await fn(tx);
    writes.forEach(([ref, data, mode]) => writeDoc(ref, data, mode));
    return result;
  },
};
const authUsers = new Map();
const auth = {
  async verifyIdToken(token) {
    if (!token.startsWith('test:')) throw new Error('bad token');
    return { phone_number: token.slice(5) };
  },
  async getUserByPhoneNumber(p) { if (!authUsers.has(p)) throw new Error('no user'); return authUsers.get(p); },
  async createUser({ phoneNumber }) { const u = { uid: 'u' + phoneNumber }; authUsers.set(phoneNumber, u); return u; },
  async createCustomToken(uid) { return 'custom:' + uid; },
};

function stub(rel, exports) {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
stub('./src/firebaseAdmin', { db, auth, FieldValue, Timestamp });
stub('./src/payos', {
  createTopupLink: async () => ({ checkoutUrl: 'https://pay.example/test', amount: 1 }),
  verifyWebhook: async (b) => b,
});

const PORT = 38000 + Math.floor(Math.random() * 1000);
process.env.PORT = String(PORT);
process.env.ADMIN_PHONE_NUMBERS = '+84999000999';
process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.NO_TIMEOUT_SWEEP = '1'; // the scenario runs the sweep itself, at a known moment
console.log = () => {}; // server.js announces itself; results go straight to stdout below
const out = (s) => process.stdout.write(s + '\n');
require('./server.js');

// ------------------------------------------------------------------- helpers ----
const F1 = '+84911111111'; // freelancer
const F2 = '+84933333333'; // another freelancer
const B1 = '+84922222222'; // buyer
const ADMIN = '+84999000999';

async function api(method, path, { as, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = 'Bearer test:' + as;
  const res = await fetch(`http://127.0.0.1:${PORT}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const ok = async (...a) => { const r = await api(...a); assert.equal(r.status, 200, `${a[0]} ${a[1]} -> ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
const fails = async (status, ...a) => { const r = await api(...a); assert.equal(r.status, status, `${a[0]} ${a[1]} should be ${status}, got ${r.status} ${JSON.stringify(r.data)}`); return r.data.error; };
const balance = async (p) => (await ok('GET', '/wallet', { as: p })).balance;
// The stubbed verifyWebhook hands the body back as the verified data.
const webhook = (data) => ok('POST', '/payos/webhook', { body: { code: '00', ...data } });

const order = (over = {}) => ({
  freelancerId: f1Id, calleePhone: '+84955555555', calleeName: 'Lan', occasion: 'Tỏ tình',
  note: 'Xưng anh – em', script: 'Em ơi, anh thích em lâu rồi.', duration: 1, speed: 1, emotion: 0, timing: 0, ...over,
});
let f1Id;
const checks = [];
const check = (name) => checks.push(name);

// -------------------------------------------------------------------- scenario ----
(async () => {
  // 1. A profile write cannot touch money, rating, blocking or identity fields.
  await ok('POST', '/freelancer/profile', { as: F1, body: {
    name: 'Lan Anh', priceMultiplier: 1.5, gender: 'nu', region: 'bac', bio: 'Giọng ấm.',
    voiceTags: ['Ấm áp', 'Ấm áp', 'Truyền cảm'], carrier: 'Viettel', numberType: 'Số đẹp',
    withdrawable: 999999, blocked: true, ratingSum: 500, ratingCount: 1, completedCount: 99, publicId: 'mine', phone: '+84000',
  } });
  let me = await ok('GET', '/freelancer/me', { as: F1 });
  assert.equal(me.withdrawable, 0); assert.equal(me.blocked, false); assert.equal(me.ratingSum, 0);
  assert.equal(me.completedCount, 0); assert.equal(me.phone, F1); assert.notEqual(me.publicId, 'mine');
  assert.deepEqual(me.voiceTags, ['Ấm áp', 'Truyền cảm']);
  assert.equal(me.fromPrice, 7500); // 100 chars → 5 × 1000đ, × 1.5
  f1Id = me.publicId;
  await fails(400, 'POST', '/freelancer/profile', { as: F1, body: { name: '', priceMultiplier: 1 } });
  await fails(400, 'POST', '/freelancer/profile', { as: F1, body: { name: 'x', priceMultiplier: 50 } });
  check('profile write is whitelisted (balance/rating/blocked/publicId untouched)');

  // 2. The public listing never carries a phone number.
  const list = await ok('GET', '/freelancers');
  const lan = list.find((f) => f.id === f1Id);
  assert.ok(lan && !('phone' in lan) && !('withdrawable' in lan) && !('ratingSum' in lan));
  assert.ok(!JSON.stringify(list).includes('911111111'), 'listing leaks a phone number');
  assert.equal(lan.fromPrice, 7500);
  const profile = await ok('GET', `/freelancers/${f1Id}`);
  assert.deepEqual(profile.reviews, []);
  await fails(400, 'GET', '/freelancers/khongtontai');
  check('public listing/profile expose a public id, never the phone');

  // 3. Voice demo: validated, size-capped, served publicly by id.
  await fails(400, 'PUT', '/freelancer/voice-demo', { as: F1, body: { audio: 'javascript:alert(1)' } });
  await fails(400, 'PUT', '/freelancer/voice-demo', { as: F1, body: { audio: 'data:audio/webm;base64,' + 'A'.repeat(600001) } });
  const clip = 'data:audio/webm;codecs=opus;base64,' + 'QUJD'.repeat(50);
  await ok('PUT', '/freelancer/voice-demo', { as: F1, body: { audio: clip } });
  assert.equal((await ok('GET', `/freelancers/${f1Id}/voice-demo`)).audio, clip);
  assert.equal((await ok('GET', '/freelancers')).find((f) => f.id === f1Id).hasVoiceDemo, true);
  await ok('DELETE', '/freelancer/voice-demo', { as: F1 });
  await fails(400, 'GET', `/freelancers/${f1Id}/voice-demo`);
  await ok('PUT', '/freelancer/voice-demo', { as: F1, body: { audio: clip } });
  check('voice demo validated, capped, public by id, deletable');

  // 4. Price is computed from the script, with options checked against the form's values.
  // 4a. Only a matching, successful payOS webhook moves money into a wallet.
  const link = await ok('POST', '/wallet/topup-link', { as: B1, body: { amount: 100000 } });
  assert.equal(link.checkoutUrl, 'https://pay.example/test');
  assert.equal(await balance(B1), 0, 'creating a payment link must not credit anything');
  assert.equal((await ok('GET', `/wallet/topups/${link.orderCode}`, { as: B1 })).status, 'pending');
  await fails(400, 'GET', `/wallet/topups/${link.orderCode}`, { as: F1 }); // someone else's topup
  await webhook({ orderCode: 123, amount: 100000 });                      // payOS registration ping
  await webhook({ orderCode: link.orderCode, amount: 100000, code: '01' }); // not a success
  await webhook({ orderCode: link.orderCode, amount: 1000 });               // underpaid
  assert.equal(await balance(B1), 0);
  await webhook({ orderCode: link.orderCode, amount: 100000 });
  await webhook({ orderCode: link.orderCode, amount: 100000 });             // payOS retries
  assert.equal(await balance(B1), 100000);
  assert.equal((await ok('GET', `/wallet/topups/${link.orderCode}`, { as: B1 })).status, 'credited');
  check('wallet credited only by a successful, matching payOS webhook, once');
  const long = 'a'.repeat(400);
  const spoofed = await ok('POST', '/orders', { as: B1, body: order({ script: long, chars: 1 }) });
  assert.equal(spoofed.price, 30000); // 400 chars → 20 × 1000đ, × 1.5 — the client's "chars: 1" is ignored
  assert.equal(await balance(B1), 70000);
  await fails(400, 'POST', '/orders', { as: B1, body: order({ duration: 0.0001 }) });
  await fails(400, 'POST', '/orders', { as: B1, body: order({ emotion: -0.9 }) });
  await fails(400, 'POST', '/orders', { as: B1, body: order({ calleePhone: '' }) });
  await fails(400, 'POST', '/orders', { as: B1, body: order({ script: 'x'.repeat(2001) }) });
  await fails(400, 'POST', '/orders', { as: B1, body: order({ scheduledAt: Date.now() + 90 * 24 * 3600 * 1000 }) });
  await fails(400, 'POST', '/orders', { as: F1, body: order() }); // ordering from yourself
  await fails(400, 'POST', '/orders', { as: B1, body: order({ script: 'b'.repeat(2000), duration: 1.6, speed: 1.15, emotion: 0.2, timing: 0.3 }) }); // too expensive
  assert.equal(await balance(B1), 70000, 'a refused order must not move money');
  check('price recomputed server-side; spoofed chars/options and over-budget orders refused');

  // 5. Freelancer sees a preview and no number until moderation passes; never the buyer.
  let assigned = (await ok('GET', '/orders/assigned', { as: F1 })).find((o) => o.id === spoofed.id);
  assert.equal(assigned.calleePhone, null); assert.equal(assigned.calleeName, ''); assert.equal(assigned.note, '');
  assert.ok(assigned.script.length <= 121 && assigned.scriptIsPreview);
  assert.ok(!('buyerPhone' in assigned) && !('freelancerPhone' in assigned));
  check('pending order: freelancer gets a preview, no callee, no buyer number');

  // 6. Buyer cancels while pending → full refund; can't cancel once approved.
  await ok('POST', `/orders/${spoofed.id}/cancel`, { as: B1, body: { reason: 'Đổi ý' } });
  assert.equal(await balance(B1), 100000);
  const o2 = await ok('POST', '/orders', { as: B1, body: order() });
  await fails(403, 'POST', `/admin/orders/${o2.id}/review`, { as: B1, body: { approve: true } });
  await ok('POST', `/admin/orders/${o2.id}/review`, { as: ADMIN, body: { approve: true } });
  await fails(400, 'POST', `/orders/${o2.id}/cancel`, { as: B1 });
  check('buyer cancel refunds while pending, refused after approval');

  // 7. Approved: now the freelancer sees who to call and the full brief.
  assigned = (await ok('GET', '/orders/assigned', { as: F1 })).find((o) => o.id === o2.id);
  assert.equal(assigned.calleePhone, '+84955555555'); assert.equal(assigned.calleeName, 'Lan');
  assert.equal(assigned.note, 'Xưng anh – em'); assert.equal(assigned.script, 'Em ơi, anh thích em lâu rồi.');
  check('approved order: callee number, name, note and full script revealed');

  // 8. Freelancer declines an approved order → buyer refunded.
  const before = await balance(B1);
  await ok('POST', `/orders/${o2.id}/decline`, { as: F1, body: { reason: 'Ốm' } });
  assert.equal(await balance(B1), before + o2.price);
  check('freelancer decline refunds the buyer');

  // 9. Full happy path: pay out, count the call, hide the number again afterwards.
  const o3 = await ok('POST', '/orders', { as: B1, body: order() });
  await ok('POST', `/admin/orders/${o3.id}/review`, { as: ADMIN, body: { approve: true } });
  await fails(403, 'POST', `/orders/${o3.id}/called`, { as: F2, body: {} }); // not their order
  await ok('POST', `/orders/${o3.id}/called`, { as: F1, body: { hasRecording: true } });
  await fails(403, 'POST', `/orders/${o3.id}/confirm`, { as: F2, body: {} });
  const mine = (await ok('GET', '/orders/mine', { as: B1 })).find((o) => o.id === o3.id);
  assert.ok(!('freelancerPhone' in mine) && mine.freelancerName === 'Lan Anh' && mine.freelancerId === f1Id);
  await ok('POST', `/orders/${o3.id}/confirm`, { as: B1, body: { method: 'buyer_confirm' } });
  me = await ok('GET', '/freelancer/me', { as: F1 });
  assert.equal(me.withdrawable, Math.round((o3.price * 0.85) / 500) * 500);
  assert.equal(me.completedCount, 1);
  assigned = (await ok('GET', '/orders/assigned', { as: F1 })).find((o) => o.id === o3.id);
  assert.equal(assigned.calleePhone, null, 'number should be dropped once the call is done');
  check('confirm pays out, counts the call, re-hides the callee number');

  // 10. Ratings: bounded, once, public with comment, masked buyer, no script.
  await fails(400, 'POST', `/orders/${o3.id}/rate`, { as: B1, body: { stars: 1000 } });
  await fails(400, 'POST', `/orders/${o3.id}/rate`, { as: B1, body: { stars: 2.5 } });
  await ok('POST', `/orders/${o3.id}/rate`, { as: B1, body: { stars: 5, comment: 'Giọng rất ấm, người ấy cảm động.' } });
  await fails(400, 'POST', `/orders/${o3.id}/rate`, { as: B1, body: { stars: 4 } });
  const pub = await ok('GET', `/freelancers/${f1Id}`);
  assert.equal(pub.rating, 5); assert.equal(pub.ratingCount, 1); assert.equal(pub.completedCount, 1);
  assert.equal(pub.reviews[0].comment, 'Giọng rất ấm, người ấy cảm động.');
  assert.equal(pub.reviews[0].buyer, '092•••222');
  assert.ok(!JSON.stringify(pub).includes('thích em') && !JSON.stringify(pub).includes('955555555'));
  check('ratings bounded 1–5, once per order; public review masks buyer, hides script');

  // 11. Paused freelancers take no new orders; the old phone-based path still works.
  await ok('POST', '/freelancer/accepting', { as: F1, body: { accepting: false } });
  assert.equal((await ok('GET', '/freelancers')).find((f) => f.id === f1Id).accepting, false);
  assert.match(await fails(400, 'POST', '/orders', { as: B1, body: order() }), /tạm nghỉ/);
  await ok('POST', '/freelancer/accepting', { as: F1, body: { accepting: true } });
  const legacy = await ok('POST', '/orders', { as: B1, body: order({ freelancerId: undefined, freelancerPhone: F1 }) });
  assert.equal(legacy.freelancerId, f1Id);
  check('accepting=false blocks orders; legacy freelancerPhone order still accepted');

  // 12. Disputes: refund returns the money; payout counts the call.
  for (const decision of ['refund', 'payout']) {
    const o = await ok('POST', '/orders', { as: B1, body: order() });
    await ok('POST', `/admin/orders/${o.id}/review`, { as: ADMIN, body: { approve: true } });
    await ok('POST', `/orders/${o.id}/called`, { as: F1, body: {} });
    await fails(400, 'POST', `/orders/${o.id}/dispute`, { as: B1, body: { reason: '' } });
    await ok('POST', `/orders/${o.id}/dispute`, { as: B1, body: { reason: 'Không ai gọi.' } });
    const b = await balance(B1);
    const c = (await ok('GET', '/freelancer/me', { as: F1 })).completedCount;
    await ok('POST', `/admin/orders/${o.id}/resolve-dispute`, { as: ADMIN, body: { decision } });
    assert.equal(await balance(B1), decision === 'refund' ? b + o.price : b);
    assert.equal((await ok('GET', '/freelancer/me', { as: F1 })).completedCount, decision === 'refund' ? c : c + 1);
  }
  check('dispute refund returns money; dispute payout counts the call');

  // 13. Orders left unconfirmed past the timeout close themselves.
  const o4 = await ok('POST', '/orders', { as: B1, body: order() });
  await ok('POST', `/admin/orders/${o4.id}/review`, { as: ADMIN, body: { approve: true } });
  await ok('POST', `/orders/${o4.id}/called`, { as: F1, body: {} });
  table('orders').get(o4.id).calledAt = Timestamp.fromMillis(Date.now() - 49 * 3600 * 1000);
  assert.equal((await ok('POST', '/admin/timeouts/run', { as: ADMIN })).count, 1);
  assert.equal((await ok('GET', '/orders/mine', { as: B1 })).find((o) => o.id === o4.id).status, 'da_dong');
  check('48h timeout auto-confirms');

  // 14. A freelancer saved before this rework gets a public id and their real call count,
  //     and their old freeform fields still show up on the card.
  table('freelancers').set(F2, { phone: F2, name: 'Cũ', blocked: false, voiceNote: 'Giọng trầm', voiceType: 'Trầm ấm', priceMultiplier: 1, ratingSum: 0, ratingCount: 0 });
  table('orders').set('legacy1', { id: 'legacy1', freelancerPhone: F2, buyerPhone: B1, status: 'da_dong', price: 5000, createdAt: Timestamp.fromMillis(1) });
  const old = (await ok('GET', '/freelancers')).find((f) => f.name === 'Cũ');
  assert.ok(old.id && old.id.length === 10);
  assert.equal(old.completedCount, 1); assert.equal(old.bio, 'Giọng trầm'); assert.deepEqual(old.voiceTags, ['Trầm ấm']);
  const legacyMine = (await ok('GET', '/orders/mine', { as: B1 })).find((o) => o.id === 'legacy1');
  assert.equal(legacyMine.freelancerName, 'Cũ'); assert.equal(legacyMine.freelancerId, old.id);
  check('pre-rework freelancers and orders migrate on read');

  // 15. Reports need a description; unauthenticated calls are refused.
  await fails(400, 'POST', '/reports', { body: { description: '   ' } });
  await ok('POST', '/reports', { body: { description: 'Gọi lúc nửa đêm.' } });
  await fails(401, 'GET', '/wallet');
  check('reports need a description; auth required on private routes');

  checks.forEach((c) => out('  ok  ' + c));
  out(`\nALL ${checks.length} API CHECKS PASSED`);
  process.exit(0);
})().catch((e) => {
  checks.forEach((c) => out('  ok  ' + c));
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
