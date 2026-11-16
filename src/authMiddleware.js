const { auth } = require('./firebaseAdmin');

/** Requires `Authorization: Bearer <Firebase ID token>`. Sets req.phone from the verified token — never trust a phone number the client sends in the body. */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Thiếu token đăng nhập.' });
  try {
    const decoded = await auth.verifyIdToken(token);
    if (!decoded.phone_number) return res.status(401).json({ error: 'Token không có số điện thoại.' });
    req.phone = decoded.phone_number;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn.' });
  }
}

/** Mount after requireAuth. Checks req.phone against ADMIN_PHONE_NUMBERS (comma-separated env var). */
function requireAdmin(req, res, next) {
  const allow = (process.env.ADMIN_PHONE_NUMBERS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allow.includes(req.phone)) return res.status(403).json({ error: 'Số điện thoại này không có quyền CSKH.' });
  next();
}

module.exports = { requireAuth, requireAdmin };
