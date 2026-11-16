/*
 * Shared phone+OTP login box, used by dat-don.html and freelancer.html (both need the
 * same buyer/freelancer signup flow). Renders into `el`, calls onLogin(user) once
 * TLMN.Auth.verifyOtp succeeds. Session persists via TLMN.Auth (localStorage), so this
 * also auto-fires onLogin immediately if a session already exists.
 */
function mountAuthWidget(el, role, onLogin) {
  const existing = TLMN.Auth.session();
  if (existing && existing.role === role) {
    onLogin(TLMN.Auth.currentUser());
    return;
  }

  let step = 'phone';
  let phone = '';
  let demoCode = '';

  function render() {
    if (step === 'phone') {
      el.innerHTML = `
        <div class="card p-5 max-w-sm">
          <h3 class="font-bold mb-3">Đăng nhập bằng số điện thoại</h3>
          <input id="aw-phone" type="tel" placeholder="09xxxxxxxx" class="w-full mb-3">
          <button id="aw-send" class="btn-primary rounded-full px-5 py-2 text-sm font-semibold w-full">Gửi mã OTP</button>
          <p id="aw-err" class="pill-red mt-3 text-xs" style="display:none;"></p>
        </div>`;
      el.querySelector('#aw-send').onclick = () => {
        phone = el.querySelector('#aw-phone').value.trim();
        if (!/^0\d{9,10}$/.test(phone)) {
          showErr('Nhập số điện thoại hợp lệ (vd 0901234567).');
          return;
        }
        const res = TLMN.Auth.requestOtp(phone);
        demoCode = res.code;
        step = 'otp';
        render();
      };
    } else {
      el.innerHTML = `
        <div class="card p-5 max-w-sm">
          <h3 class="font-bold mb-1">Nhập mã OTP</h3>
          <p class="faint text-xs mb-3">Demo chưa nối SMS thật — mã OTP của bạn là <strong class="accent">${demoCode}</strong></p>
          <input id="aw-otp" type="text" placeholder="Mã 4 số" class="w-full mb-3">
          <button id="aw-verify" class="btn-primary rounded-full px-5 py-2 text-sm font-semibold w-full">Xác nhận</button>
          <p id="aw-err" class="pill-red mt-3 text-xs" style="display:none;"></p>
        </div>`;
      el.querySelector('#aw-verify').onclick = () => {
        const code = el.querySelector('#aw-otp').value.trim();
        try {
          const user = TLMN.Auth.verifyOtp(phone, code, role);
          onLogin(user);
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
  render();
}
