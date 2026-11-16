import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js';
import { getAuth, signInWithCustomToken, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';
import { API_BASE_URL } from './api-base.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

function toE164(localPhone) {
  // Input is Vietnamese local format (0xxxxxxxxx); the rest of the system (backend,
  // Firebase user records) expects E.164.
  return localPhone.replace(/^0/, '+84');
}

/*
 * TEMPORARY: real Firebase Phone Auth (signInWithPhoneNumber + RecaptchaVerifier) needs
 * the Blaze plan to send SMS — not enabled yet (see DECISIONS.md §12). Until that's
 * decided, login goes through the backend's simulated-OTP endpoints instead: the code
 * is handed back directly rather than texted, then exchanged for a real Firebase
 * session via a custom token. NOT real identity verification — swap back to
 * signInWithPhoneNumber here (only here) once ready; nothing downstream needs to change.
 */

/**
 * Renders a phone+OTP login box into `el`. Calls onLogin({ phone }) once signed in —
 * immediately if a session already exists (Firebase persists sign-in across reloads),
 * otherwise after the user completes the OTP step.
 */
export function mountAuthWidget(el, onLogin) {
  onAuthStateChanged(auth, (user) => {
    if (user && user.phoneNumber) onLogin({ phone: user.phoneNumber });
  });
  if (auth.currentUser) return; // onAuthStateChanged above will fire for it

  let phoneE164 = null;

  function render(step, otpCode) {
    if (step === 'phone') {
      el.innerHTML = `
        <div class="card p-5 max-w-sm">
          <h3 class="font-bold mb-3">Đăng nhập bằng số điện thoại</h3>
          <p class="faint text-xs mb-3">Tạm thời: OTP đang mô phỏng, chưa gửi SMS thật (xem DECISIONS.md §12).</p>
          <input id="aw-phone" type="tel" placeholder="09xxxxxxxx" class="w-full mb-3">
          <button id="aw-send" class="btn-primary rounded-full px-5 py-2 text-sm font-semibold w-full">Gửi mã OTP</button>
          <p id="aw-err" class="pill-red mt-3 text-xs" style="display:none;"></p>
        </div>`;
      el.querySelector('#aw-send').onclick = async () => {
        const phone = el.querySelector('#aw-phone').value.trim();
        if (!/^0\d{9,10}$/.test(phone)) return showErr('Nhập số điện thoại hợp lệ (vd 0901234567).');
        phoneE164 = toE164(phone);
        try {
          const res = await fetch(API_BASE_URL + '/api/auth/request-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phoneE164 }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          render('otp', data.code);
        } catch (e) {
          showErr(e.message);
        }
      };
    } else {
      el.innerHTML = `
        <div class="card p-5 max-w-sm">
          <h3 class="font-bold mb-1">Nhập mã OTP</h3>
          <p class="faint text-xs mb-3">Mô phỏng — mã của bạn là <strong class="accent">${otpCode}</strong> (đã điền sẵn).</p>
          <input id="aw-otp" type="text" value="${otpCode}" class="w-full mb-3">
          <button id="aw-verify" class="btn-primary rounded-full px-5 py-2 text-sm font-semibold w-full">Xác nhận</button>
          <p id="aw-err" class="pill-red mt-3 text-xs" style="display:none;"></p>
        </div>`;
      el.querySelector('#aw-verify').onclick = async () => {
        try {
          const res = await fetch(API_BASE_URL + '/api/auth/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phoneE164, code: el.querySelector('#aw-otp').value.trim() }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          await signInWithCustomToken(auth, data.customToken);
          // onAuthStateChanged above fires onLogin once the SDK picks up the new session.
        } catch (e) {
          showErr(e.message);
        }
      };
    }
  }
  function showErr(msg) {
    const e = el.querySelector('#aw-err');
    e.textContent = msg;
    e.style.display = 'block';
  }
  render('phone');
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
