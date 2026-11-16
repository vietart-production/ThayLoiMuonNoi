/*
 * Fake backend for "Thay Lời Muốn Nói", backed by localStorage in this browser only.
 * Every TLMN.* function here is meant to become a real HTTP call later — same name,
 * same shape in/out — so callers in the HTML pages don't need to change when the real
 * backend lands. No server, no network, no persistence across browsers/devices.
 */
(function (global) {
  const DB_KEY = 'tlmn_db_v1';
  const CONFIRM_TIMEOUT_HOURS = 48; // DECISIONS.md §5 — auto-confirm if buyer never responds; not finalized, change here when it is.
  const COMMISSION_RATE = 0.15; // not chosen anywhere in DECISIONS.md yet — placeholder, confirm the real % and update this.
  const ADMIN_PASSCODE = 'admin123'; // demo-only client-side gate. Replace with real admin auth before this is anything but a local demo.

  const BANNED_CONTENT_CHECKLIST = [
    'Đe dọa, hăm dọa người nghe',
    'Đòi nợ / thu hồi công nợ trá hình',
    'Mạo danh cơ quan nhà nước, công an, ngân hàng',
    'Nội dung khiêu dâm, quấy rối tình dục',
    'Liên quan tới người dưới 18 tuổi không phù hợp',
    'Lừa đảo tài chính, yêu cầu chuyển tiền',
    'Nội dung chính trị nhạy cảm',
  ];

  const STATUS = {
    PENDING_REVIEW: 'cho_duyet_kich_ban',
    REJECTED: 'kich_ban_bi_tu_choi',
    APPROVED: 'da_duyet_cho_goi',
    AWAITING_CONFIRM: 'cho_xac_nhan',
    CLOSED: 'da_dong',
    DISPUTED: 'tranh_chap',
    REFUNDED: 'da_hoan_tien',
  };

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function seedDb() {
    const db = { users: {}, freelancers: {}, orders: {}, withdrawals: {}, reports: {}, otp: {}, session: null };

    const demoFreelancers = [
      { phone: '0901111111', name: 'Minh Thư', voiceNote: 'Giọng ấm, truyền cảm', voiceType: 'Ấm, truyền cảm', numberType: 'Số đẹp · thần tài', carrier: 'Viettel', priceMultiplier: 1.6 },
      { phone: '0902222222', name: 'Anh Khoa', voiceNote: 'Giọng trầm, nghiêm túc', voiceType: 'Trầm, nghiêm túc', numberType: 'Số thường', carrier: 'Mobifone', priceMultiplier: 1.3 },
      { phone: '0903333333', name: 'Bảo Ngọc', voiceNote: 'Giọng trong, vui tươi', voiceType: 'Trong, vui tươi', numberType: 'Số đẹp · ngày sinh', carrier: 'Vinaphone', priceMultiplier: 1.8 },
      { phone: '0904444444', name: 'Gia Hân', voiceNote: 'Giọng nhẹ nhàng, dễ thương', voiceType: 'Nhẹ nhàng, dễ thương', numberType: 'Số thường', carrier: 'Viettel', priceMultiplier: 1.1 },
    ];
    demoFreelancers.forEach((f) => {
      db.users[f.phone] = { phone: f.phone, roles: ['freelancer'], walletBalance: 0, createdAt: Date.now() };
      db.freelancers[f.phone] = {
        phone: f.phone,
        name: f.name,
        voiceNote: f.voiceNote,
        voiceType: f.voiceType,
        numberType: f.numberType,
        carrier: f.carrier,
        priceMultiplier: f.priceMultiplier,
        withdrawable: 0,
        blocked: false,
        ratingSum: 25,
        ratingCount: 5,
        createdAt: Date.now(),
      };
    });

    save(db);
    return db;
  }

  function load() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (!raw) return seedDb();
      return JSON.parse(raw);
    } catch (e) {
      return seedDb();
    }
  }
  function save(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  let db = load();
  function persist() {
    save(db);
  }

  function getOrThrow(map, key, label) {
    const v = map[key];
    if (!v) throw new Error((label || 'Mục') + ' không tồn tại: ' + key);
    return v;
  }

  // ---- Pricing (shared formula; same math as the index.html demo calculator) ----
  const Pricing = {
    calc({ chars, duration, speed, emotion, timing }, multiplier = 1) {
      const base = Math.ceil(chars / 20) * 1000;
      let total = base * duration * speed * (1 + emotion + timing) * multiplier;
      return Math.round(total / 500) * 500;
    },
  };

  // ---- Auth: phone + OTP, no real SMS — OTP is handed back to the caller to display ----
  const Auth = {
    requestOtp(phone) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      db.otp[phone] = { code, expiresAt: Date.now() + 10 * 60 * 1000 };
      persist();
      return { phone, code }; // real backend would SMS this instead of returning it
    },
    verifyOtp(phone, code, role) {
      const rec = db.otp[phone];
      if (!rec || rec.code !== String(code) || Date.now() > rec.expiresAt) {
        throw new Error('Mã OTP không đúng hoặc đã hết hạn.');
      }
      if (!db.users[phone]) {
        db.users[phone] = { phone, roles: [], walletBalance: 0, createdAt: Date.now() };
      }
      if (role && !db.users[phone].roles.includes(role)) db.users[phone].roles.push(role);
      db.session = { phone, role: role || db.users[phone].roles[0] };
      delete db.otp[phone];
      persist();
      return db.users[phone];
    },
    session() {
      return db.session;
    },
    currentUser() {
      return db.session ? db.users[db.session.phone] : null;
    },
    logout() {
      db.session = null;
      persist();
    },
  };

  // ---- Wallet ----
  const Wallet = {
    topup(phone, amount) {
      const user = getOrThrow(db.users, phone, 'Người dùng');
      user.walletBalance += amount; // mock payOS: instant credit, no real payment rail
      persist();
      return user.walletBalance;
    },
    balance(phone) {
      const user = db.users[phone];
      return user ? user.walletBalance : 0;
    },
  };

  // ---- Freelancer ----
  const Freelancer = {
    upsertProfile(phone, data) {
      const existing = db.freelancers[phone] || {
        phone,
        withdrawable: 0,
        blocked: false,
        ratingSum: 0,
        ratingCount: 0,
        createdAt: Date.now(),
      };
      db.freelancers[phone] = Object.assign(existing, data);
      if (!db.users[phone]) db.users[phone] = { phone, roles: [], walletBalance: 0, createdAt: Date.now() };
      if (!db.users[phone].roles.includes('freelancer')) db.users[phone].roles.push('freelancer');
      persist();
      return db.freelancers[phone];
    },
    get(phone) {
      return db.freelancers[phone] || null;
    },
    list() {
      return Object.values(db.freelancers).filter((f) => !f.blocked);
    },
    listAll() {
      return Object.values(db.freelancers);
    },
    rating(phone) {
      const f = db.freelancers[phone];
      if (!f || !f.ratingCount) return null;
      return Math.round((f.ratingSum / f.ratingCount) * 10) / 10;
    },
  };

  // ---- Orders: the escrow + evidence state machine from DECISIONS.md §5 ----
  const Order = {
    create({ buyerPhone, freelancerPhone, script, chars, duration, speed, emotion, timing }) {
      const freelancer = getOrThrow(db.freelancers, freelancerPhone, 'Người nói hộ');
      if (freelancer.blocked) throw new Error('Người nói hộ này đã bị khóa, không thể đặt đơn.');
      const buyer = getOrThrow(db.users, buyerPhone, 'Người thuê');
      const price = Pricing.calc({ chars, duration, speed, emotion, timing }, freelancer.priceMultiplier);
      if (buyer.walletBalance < price) throw new Error('Số dư ví không đủ, vui lòng nạp thêm.');

      buyer.walletBalance -= price; // escrow: leaves buyer's balance immediately, held on the order itself
      const id = uid('order');
      db.orders[id] = {
        id,
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
        createdAt: Date.now(),
        rating: null,
      };
      persist();
      return db.orders[id];
    },

    adminReviewScript(orderId, { approve, bannedFlags }) {
      const order = getOrThrow(db.orders, orderId, 'Đơn');
      if (order.status !== STATUS.PENDING_REVIEW) throw new Error('Đơn không ở trạng thái chờ duyệt.');
      order.moderation = { bannedFlags: bannedFlags || [], reviewedAt: Date.now() };
      if (approve) {
        order.status = STATUS.APPROVED;
      } else {
        order.status = STATUS.REJECTED;
        db.users[order.buyerPhone].walletBalance += order.price; // full refund on rejection
      }
      persist();
      return order;
    },

    freelancerMarkCalled(orderId, { hasRecording }) {
      const order = getOrThrow(db.orders, orderId, 'Đơn');
      if (order.status !== STATUS.APPROVED) throw new Error('Đơn chưa được duyệt hoặc đã xử lý.');
      order.status = STATUS.AWAITING_CONFIRM;
      order.hasRecording = !!hasRecording;
      order.calledAt = Date.now();
      persist();
      return order;
    },

    buyerConfirm(orderId, { method }) {
      const order = getOrThrow(db.orders, orderId, 'Đơn');
      if (order.status !== STATUS.AWAITING_CONFIRM) throw new Error('Đơn không ở trạng thái chờ xác nhận.');
      const freelancer = getOrThrow(db.freelancers, order.freelancerPhone, 'Người nói hộ');
      const payout = Math.round((order.price * (1 - COMMISSION_RATE)) / 500) * 500;
      freelancer.withdrawable += payout;
      order.status = STATUS.CLOSED;
      order.closedAt = Date.now();
      order.closedVia = method || 'buyer_confirm';
      order.payout = payout;
      delete order.hasRecording; // recording is deleted the moment the order closes, per DECISIONS.md §5
      persist();
      return order;
    },

    buyerDispute(orderId, { reason }) {
      const order = getOrThrow(db.orders, orderId, 'Đơn');
      if (order.status !== STATUS.AWAITING_CONFIRM) throw new Error('Chỉ có thể báo tranh chấp khi đơn đang chờ xác nhận.');
      order.status = STATUS.DISPUTED;
      order.disputeReason = reason;
      persist();
      return order;
    },

    adminResolveDispute(orderId, { decision }) {
      const order = getOrThrow(db.orders, orderId, 'Đơn');
      if (order.status !== STATUS.DISPUTED) throw new Error('Đơn không ở trạng thái tranh chấp.');
      if (decision === 'refund') {
        db.users[order.buyerPhone].walletBalance += order.price;
        order.status = STATUS.REFUNDED;
      } else {
        const freelancer = getOrThrow(db.freelancers, order.freelancerPhone, 'Người nói hộ');
        const payout = Math.round((order.price * (1 - COMMISSION_RATE)) / 500) * 500;
        freelancer.withdrawable += payout;
        order.status = STATUS.CLOSED;
        order.payout = payout;
      }
      order.closedAt = Date.now();
      delete order.hasRecording;
      persist();
      return order;
    },

    rate(orderId, stars) {
      const order = getOrThrow(db.orders, orderId, 'Đơn');
      if (order.status !== STATUS.CLOSED) throw new Error('Chỉ đánh giá được đơn đã đóng.');
      if (order.rating != null) throw new Error('Đơn này đã được đánh giá.');
      const freelancer = getOrThrow(db.freelancers, order.freelancerPhone, 'Người nói hộ');
      freelancer.ratingSum += stars;
      freelancer.ratingCount += 1;
      order.rating = stars;
      persist();
      return order;
    },

    checkTimeouts() {
      const cutoff = Date.now() - CONFIRM_TIMEOUT_HOURS * 3600 * 1000;
      let count = 0;
      Object.values(db.orders).forEach((order) => {
        if (order.status === STATUS.AWAITING_CONFIRM && order.calledAt < cutoff) {
          Order.buyerConfirm(order.id, { method: 'auto_timeout' });
          count++;
        }
      });
      return count;
    },

    get(orderId) {
      return db.orders[orderId] || null;
    },
    listByBuyer(phone) {
      return Object.values(db.orders).filter((o) => o.buyerPhone === phone).sort((a, b) => b.createdAt - a.createdAt);
    },
    listByFreelancer(phone) {
      return Object.values(db.orders).filter((o) => o.freelancerPhone === phone).sort((a, b) => b.createdAt - a.createdAt);
    },
    listPendingReview() {
      return Object.values(db.orders).filter((o) => o.status === STATUS.PENDING_REVIEW);
    },
    listDisputed() {
      return Object.values(db.orders).filter((o) => o.status === STATUS.DISPUTED);
    },
  };

  // ---- Withdrawals: freelancer requests, admin approves/rejects by hand (DECISIONS.md §4) ----
  const Withdrawal = {
    request(phone, amount, bankNumber, bankHolder) {
      const freelancer = getOrThrow(db.freelancers, phone, 'Người nói hộ');
      if (amount <= 0 || amount > freelancer.withdrawable) throw new Error('Số tiền rút không hợp lệ.');
      freelancer.withdrawable -= amount; // locked immediately so it can't be double-spent while pending
      const id = uid('wd');
      db.withdrawals[id] = {
        id,
        phone,
        amount,
        bankNumber,
        bankHolder,
        status: 'cho_duyet',
        createdAt: Date.now(),
      };
      persist();
      return db.withdrawals[id];
    },
    adminApprove(id) {
      const wd = getOrThrow(db.withdrawals, id, 'Lệnh rút');
      wd.status = 'da_chuyen';
      wd.decidedAt = Date.now();
      persist();
      return wd;
    },
    adminReject(id) {
      const wd = getOrThrow(db.withdrawals, id, 'Lệnh rút');
      wd.status = 'tu_choi';
      wd.decidedAt = Date.now();
      db.freelancers[wd.phone].withdrawable += wd.amount; // unlock back to freelancer
      persist();
      return wd;
    },
    listPending() {
      return Object.values(db.withdrawals).filter((w) => w.status === 'cho_duyet');
    },
    listByFreelancer(phone) {
      return Object.values(db.withdrawals).filter((w) => w.phone === phone).sort((a, b) => b.createdAt - a.createdAt);
    },
  };

  // ---- Callee reports: the third party who received a call, not a platform user ----
  const Report = {
    submit({ callerHint, description }) {
      const id = uid('report');
      db.reports[id] = { id, callerHint, description, status: 'moi', createdAt: Date.now() };
      persist();
      return db.reports[id];
    },
    adminDismiss(id) {
      const r = getOrThrow(db.reports, id, 'Báo cáo');
      r.status = 'da_xu_ly';
      persist();
      return r;
    },
    adminBlockFreelancer(id, freelancerPhone) {
      const r = getOrThrow(db.reports, id, 'Báo cáo');
      const f = getOrThrow(db.freelancers, freelancerPhone, 'Người nói hộ');
      f.blocked = true;
      r.status = 'da_khoa_tai_khoan';
      persist();
      return r;
    },
    listPending() {
      return Object.values(db.reports).filter((r) => r.status === 'moi');
    },
  };

  const Admin = {
    checkPasscode(code) {
      return code === ADMIN_PASSCODE;
    },
  };

  global.TLMN = {
    STATUS,
    BANNED_CONTENT_CHECKLIST,
    Pricing,
    Auth,
    Wallet,
    Freelancer,
    Order,
    Withdrawal,
    Report,
    Admin,
    _selfTest, // console-callable: TLMN._selfTest() — not run automatically, would stomp on real demo data
  };

  function _selfTest() {
    const ok = (label, cond) => console.assert(cond, 'FAIL: ' + label);
    const buyerPhone = '0999999999';
    db.users[buyerPhone] = { phone: buyerPhone, roles: ['buyer'], walletBalance: 100000, createdAt: Date.now() };
    const flPhone = Object.keys(db.freelancers)[0];
    const startWithdrawable = db.freelancers[flPhone].withdrawable;

    const order = Order.create({ buyerPhone, freelancerPhone: flPhone, script: 'test', chars: 100, duration: 1, speed: 1, emotion: 0, timing: 0 });
    ok('escrow deducted from buyer', db.users[buyerPhone].walletBalance === 100000 - order.price);
    ok('order pending review', order.status === STATUS.PENDING_REVIEW);

    Order.adminReviewScript(order.id, { approve: true });
    ok('approved', Order.get(order.id).status === STATUS.APPROVED);

    Order.freelancerMarkCalled(order.id, { hasRecording: true });
    ok('awaiting confirm', Order.get(order.id).status === STATUS.AWAITING_CONFIRM);

    Order.buyerConfirm(order.id, { method: 'buyer_confirm' });
    const closed = Order.get(order.id);
    ok('closed', closed.status === STATUS.CLOSED);
    ok('recording deleted on close', closed.hasRecording === undefined);
    ok('freelancer paid commission-adjusted amount', db.freelancers[flPhone].withdrawable === startWithdrawable + closed.payout);

    const wd = Withdrawal.request(flPhone, closed.payout, '0123456789', 'Test Holder');
    ok('withdrawable locked on request', db.freelancers[flPhone].withdrawable === startWithdrawable);
    Withdrawal.adminApprove(wd.id);
    ok('withdrawal approved', Withdrawal.listByFreelancer(flPhone).find((w) => w.id === wd.id).status === 'da_chuyen');

    console.log('TLMN._selfTest() done — see above for any FAIL lines.');
  }
})(window);
