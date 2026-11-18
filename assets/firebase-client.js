import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js';
import { getAuth, signInWithCustomToken, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';
import { API_BASE_URL } from './api-base.js';
import { guard } from './ui.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

/*
 * People write Vietnamese numbers several ways: 0912 345 678, +84912345678,
 * 84912345678, 00 84..., and sometimes +84 with the trunk 0 still in front. Everything
 * downstream — the backend, Firebase user records — wants one E.164 string, so settle it
 * here and return null for anything that is not recognisably a Vietnamese number.
 *
 * The optional country-code group backtracks, which is what makes an ambiguous input
 * like "849123456" resolve the only way that works: as local 0849123456 (084 is a real
 * mobile prefix) rather than as +84 followed by seven digits.
 */
export function toE164(input) {
  const digits = String(input).replace(/[\s.()-]/g, '').replace(/^00/, '+');
  const m = digits.match(/^(?:\+?84)?0?(\d{9,10})$/);
  return m ? '+84' + m[1] : null;
}

// Exported alongside toE164: both the order form (callee's number) and the freelancer's
// order list (showing it back) need the same two conversions login already does.
// Orders placed before calleePhone existed have no value here, so this must tolerate
// missing input rather than throw and take down the whole order list with it.
export const toLocalPhone = (e164) => e164 ? e164.replace(/^\+84/, '0') : 'không rõ';
const local = toLocalPhone;

/*
 * TEMPORARY: real Firebase Phone Auth (signInWithPhoneNumber + RecaptchaVerifier) needs
 * the Blaze plan to send SMS — not enabled yet (see DECISIONS.md §12). Until that's
 * decided, login goes through the backend's simulated-OTP endpoints instead: the code
 * is handed back directly rather than texted, then exchanged for a real Firebase
 * session via a custom token. NOT real identity verification — swap back to
 * signInWithPhoneNumber here (only here) once ready; nothing downstream needs to change.
 */

/*
 * One popup for the whole site. No page carries login markup of its own: this builds the
 * dialog on first use and appends it, so changing the login means changing this file and
 * assets/ui.css, and every page follows. Styling lives in ui.css under #loginDlg.
 */
let dialog = null;
function loginDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'loginDlg';
  dialog.setAttribute('aria-label', 'Đăng nhập');
  dialog.innerHTML = `
    <div class="login-panel">
      <svg height="14" viewBox="0 0 300 14" preserveAspectRatio="none" fill="#F3F6FA" aria-hidden="true"
           style="position:absolute; left:1.25rem; width:calc(100% - 3.5rem); bottom:calc(100% - 1px); filter:drop-shadow(0 1px 1px rgba(0,0,0,.25));">
        <path d="M0 14 Q 18 1 37 9 T 75 9 T 113 9 T 150 9 T 188 9 T 225 9 T 263 9 T 300 9 L300 14 Z"/>
      </svg>
      <div class="login-body"></div>
      <form method="dialog"><button class="login-dismiss">Để sau</button></form>
    </div>`;
  document.body.appendChild(dialog);
  // A click whose target is the dialog itself landed on the backdrop; the panel fills the
  // dialog exactly, so it catches every click meant for the form.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  return dialog;
}

function openLogin() {
  const dlg = loginDialog();
  if (!dlg.open) dlg.showModal();
}

/**
 * Wires the shared login popup into a page.
 *
 * onLogin({ phone })  runs once signed in — immediately if a session already exists,
 *                     since Firebase persists sign-in across reloads.
 * gate                an element on pages that require login. It holds a short "sign in
 *                     to continue" card while signed out, and the popup opens by itself.
 *                     Pages where browsing without an account is fine (the landing page)
 *                     leave it out and rely on the header button instead.
 */
export function mountAuthWidget({ onLogin = () => {}, gate = null } = {}) {
  let phoneE164 = null;

  // Don't flash a login prompt at someone who turns out to be signed in already.
  if (gate) gate.innerHTML = '<p class="faint text-sm">Đang kiểm tra đăng nhập…</p>';

  onAuthStateChanged(auth, (user) => {
    if (user && user.phoneNumber) {
      if (gate) gate.innerHTML = '';
      loginDialog().close();
      showUser(user.phoneNumber);
      onLogin({ phone: user.phoneNumber });
    } else {
      showSignedOut();
      renderForm('phone');
      if (gate) {
        renderGate(gate);
        openLogin();
      }
    }
  });

  // Header slot: who is signed in, and a way out.
  function showUser(phone) {
    const box = document.getElementById('userBox');
    if (!box) return;
    box.innerHTML = `<span class="faint">${local(phone)}</span>
      <button class="underline hover:text-[var(--gold-bright)]">Đăng xuất</button>`;
    box.querySelector('button').onclick = async () => { await signOut(auth); location.reload(); };
  }

  // The signed-out half of that slot, for pages where signing in is optional and so needs
  // its own entry point. Pages with a gate skip it — the gate already says it.
  function showSignedOut() {
    const box = document.getElementById('userBox');
    if (!box || !box.hasAttribute('data-login')) return;
    box.innerHTML = '<button class="btn-outline rounded-full px-4 py-1.5 text-sm font-semibold">Đăng nhập</button>';
    box.querySelector('button').onclick = openLogin;
  }

  function renderGate(el) {
    el.innerHTML = `
      <div class="card p-5 max-w-sm">
        <h2 class="font-bold text-lg mb-1">Đăng nhập để tiếp tục</h2>
        <p class="faint text-sm mb-4">Trang này cần số điện thoại của bạn để biết đơn nào là của ai.</p>
        <button class="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold">Đăng nhập</button>
      </div>`;
    el.querySelector('button').onclick = openLogin;
  }

  async function post(path, body) {
    const res = await fetch(API_BASE_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  }

  function renderForm(step, otpCode) {
    const isPhone = step === 'phone';
    const body = loginDialog().querySelector('.login-body');
    body.innerHTML = isPhone
      ? `<form novalidate>
          <h2>Đăng nhập</h2>
          <label for="aw-in">Số điện thoại</label>
          <input id="aw-in" type="tel" inputmode="numeric" autocomplete="tel" placeholder="Số điện thoại của bạn">
          <button class="btn-primary">Gửi mã OTP</button>
          <p class="login-note">Chưa có tài khoản? Cứ nhập số điện thoại — tài khoản được tạo tự động.</p>
        </form>`
      : `<form novalidate>
          <h2>Nhập mã OTP</h2>
          <p class="login-hint">Mã gửi tới <strong>${local(phoneE164)}</strong>. Đang ở chế độ thử nghiệm nên chưa gửi SMS thật, mã của bạn là <strong class="accent">${otpCode}</strong>.</p>
          <label for="aw-in">Mã OTP</label>
          <input id="aw-in" type="text" inputmode="numeric" autocomplete="one-time-code" value="${otpCode}">
          <button class="btn-primary">Xác nhận</button>
          <button type="button" id="aw-back" class="login-dismiss">Đổi số điện thoại</button>
        </form>`;

    const input = body.querySelector('#aw-in');
    if (loginDialog().open) input.focus();
    if (!isPhone) body.querySelector('#aw-back').onclick = () => renderForm('phone');

    body.querySelector('form').addEventListener('submit', guard(async () => {
      if (isPhone) {
        phoneE164 = toE164(input.value);
        if (!phoneE164) throw new Error('Số điện thoại chưa đúng. Nhập 0901234567 hoặc +84901234567.');
        const data = await post('/api/auth/request-otp', { phone: phoneE164 });
        renderForm('otp', data.code);
        body.querySelector('#aw-in').focus();
      } else {
        const data = await post('/api/auth/verify-otp', { phone: phoneE164, code: input.value.trim() });
        await signInWithCustomToken(auth, data.customToken);
        // onAuthStateChanged above fires onLogin once the SDK picks up the new session.
      }
    }));
  }
}

export async function getIdToken() {
  if (!auth.currentUser) return null;
  return auth.currentUser.getIdToken();
}

export function currentPhone() {
  return auth.currentUser ? auth.currentUser.phoneNumber : null;
}

export function signOutUser() {
  return signOut(auth);
}
