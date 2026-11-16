// Shared UI helpers for the app pages. No dependencies.

// Escape user-supplied text before putting it in innerHTML (scripts, names, report
// descriptions all come from other users — admin.html renders them).
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function toast(msg, bad = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.setAttribute('role', bad ? 'alert' : 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

// Wraps a click/submit handler: disables the button while it runs (no double-submits on
// money actions) and shows any thrown error as a toast instead of failing silently.
export function guard(fn) {
  return async function (e) {
    if (e && e.type === 'submit') e.preventDefault();
    const btn = (e && e.submitter) || this;
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      await fn.call(this, e);
    } catch (err) {
      toast(err.message || 'Có lỗi xảy ra, thử lại sau.', true);
    } finally {
      btn.disabled = false;
    }
  };
}

// Order status → status-pill modifier class.
export const STATUS_TONE = {
  da_dong: 'ok',
  kich_ban_bi_tu_choi: 'bad',
  tranh_chap: 'bad',
};

export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
