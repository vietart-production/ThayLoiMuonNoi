import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js';
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

function toE164(localPhone) {
  // Input is Vietnamese local format (0xxxxxxxxx); Firebase Phone Auth needs E.164.
  return localPhone.replace(/^0/, '+84');
}

/**
 * Renders a phone+OTP login box into `el` using real Firebase Phone Authentication.
 * Calls onLogin({ phone }) once signed in — immediately if a session already exists
 * (Firebase persists sign-in across reloads by default), otherwise after the user
 * completes the OTP step.
 */
export function mountAuthWidget(el, onLogin) {
  onAuthStateChanged(auth, (user) => {
    if (user && user.phoneNumber) {
      onLogin({ phone: user.phoneNumber });
    }
  });
  if (auth.currentUser) return; // onAuthStateChanged above will fire for it

  let confirmationResult = null;
  let recaptchaVerifier = null;

  function render(step) {
    if (step === 'phone') {
      el.innerHTML = `
        <div class="card p-5 max-w-sm">
          <h3 class="font-bold mb-3">Đăng nhập bằng số điện thoại</h3>
          <input id="aw-phone" type="tel" placeholder="09xxxxxxxx" class="w-full mb-3">
          <div id="recaptcha-container"></div>
          <button id="aw-send" class="btn-primary rounded-full px-5 py-2 text-sm font-semibold w-full">Gửi mã OTP</button>
          <p id="aw-err" class="pill-red mt-3 text-xs" style="display:none;"></p>
        </div>`;
      el.querySelector('#aw-send').onclick = async () => {
        const phone = el.querySelector('#aw-phone').value.trim();
        if (!/^0\d{9,10}$/.test(phone)) return showErr('Nhập số điện thoại hợp lệ (vd 0901234567).');
        try {
          if (!recaptchaVerifier) {
            recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
          }
          confirmationResult = await signInWithPhoneNumber(auth, toE164(phone), recaptchaVerifier);
          render('otp');
        } catch (e) {
          showErr(e.message);
        }
      };
    } else {
      el.innerHTML = `
        <div class="card p-5 max-w-sm">
          <h3 class="font-bold mb-1">Nhập mã OTP</h3>
          <p class="faint text-xs mb-3">Mã vừa được gửi qua SMS tới số bạn nhập.</p>
          <input id="aw-otp" type="text" placeholder="Mã OTP" class="w-full mb-3">
          <button id="aw-verify" class="btn-primary rounded-full px-5 py-2 text-sm font-semibold w-full">Xác nhận</button>
          <p id="aw-err" class="pill-red mt-3 text-xs" style="display:none;"></p>
        </div>`;
      el.querySelector('#aw-verify').onclick = async () => {
        try {
          await confirmationResult.confirm(el.querySelector('#aw-otp').value.trim());
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
