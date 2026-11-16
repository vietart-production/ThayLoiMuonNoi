import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js';
import { getAuth, signInWithCustomToken, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';
import { API_BASE_URL } from './api-base.js';
import { guard } from './ui.js';

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
  let phoneE164 = null;
  // Don't flash the login form at someone who is already signed in — wait for Firebase
  // to say which it is.
  el.innerHTML = '<p class="faint text-sm">Đang kiểm tra đăng nhập…</p>';
  onAuthStateChanged(auth, (user) => {
    if (user && user.phoneNumber) {
      el.innerHTML = '';
      showUser(user.phoneNumber);
      onLogin({ phone: user.phoneNumber });
    } else {
      render('phone');
    }
  });

  // Header slot (present on logged-in pages): who is signed in + sign out.
  function showUser(phone) {
    const box = document.getElementById('userBox');
    if (!box) return;
    box.innerHTML = `<span class="faint">${phone.replace(/^\+84/, '0')}</span>
      <button class="underline hover:text-[var(--gold-bright)]">Đăng xuất</button>`;
    box.querySelector('button').onclick = async () => { await signOut(auth); location.reload(); };
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

  function render(step, otpCode) {
    const isPhone = step === 'phone';
    el.innerHTML = `
      <form class="card p-5 max-w-sm" novalidate>
        <h2 class="font-bold text-lg mb-1">${isPhone ? 'Đăng nhập bằng số điện thoại' : 'Nhập mã OTP'}</h2>
        <p class="faint text-xs mb-4">${isPhone
          ? 'Chưa có tài khoản? Cứ nhập số điện thoại, tài khoản được tạo tự động.'
          : `Chế độ thử nghiệm: chưa gửi SMS thật, mã của bạn là <strong class="accent">${otpCode}</strong>.`}</p>
        <label for="aw-in">${isPhone ? 'Số điện thoại' : 'Mã OTP'}</label>
        ${isPhone
          ? '<input id="aw-in" type="tel" inputmode="numeric" autocomplete="tel" placeholder="0901234567" class="w-full mt-1 mb-4">'
          : `<input id="aw-in" type="text" inputmode="numeric" autocomplete="one-time-code" value="${otpCode}" class="w-full mt-1 mb-4">`}
        <button class="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold w-full">${isPhone ? 'Gửi mã OTP' : 'Xác nhận'}</button>
        ${isPhone ? '' : '<button type="button" id="aw-back" class="faint text-xs mt-3 underline w-full">Đổi số điện thoại</button>'}
      </form>`;
    const input = el.querySelector('#aw-in');
    input.focus();
    if (!isPhone) el.querySelector('#aw-back').onclick = () => render('phone');
    el.querySelector('form').addEventListener('submit', guard(async () => {
      if (isPhone) {
        const phone = input.value.replace(/[\s.-]/g, '');
        if (!/^0\d{9,10}$/.test(phone)) throw new Error('Nhập số điện thoại hợp lệ, ví dụ 0901234567.');
        phoneE164 = toE164(phone);
        const data = await post('/api/auth/request-otp', { phone: phoneE164 });
        render('otp', data.code);
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
