// Shared UI helpers for every page. No dependencies.

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

export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();

/*
 * A small modal question — the one replacement for confirm()/prompt() across the site.
 * Resolves to null if dismissed, otherwise { value, stars }. Required fields use the
 * browser's own form validation, so the dialog can't be submitted empty.
 *
 *   ask({ title, message, confirm, danger,
 *         field: { label, placeholder, required, maxlength, multiline },
 *         stars: true })
 */
export function ask({ title, message = '', confirm = 'Xác nhận', danger = false, field = null, stars = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet';
    const input = field && (field.multiline
      ? `<textarea name="v" rows="3" maxlength="${field.maxlength || 500}" placeholder="${esc(field.placeholder || '')}" ${field.required ? 'required' : ''}></textarea>`
      : `<input name="v" type="text" maxlength="${field.maxlength || 200}" placeholder="${esc(field.placeholder || '')}" ${field.required ? 'required' : ''}>`);
    dlg.innerHTML = `
      <form method="dialog" class="sheet-panel">
        <h3>${esc(title)}</h3>
        ${message ? `<p class="sheet-msg">${esc(message)}</p>` : ''}
        ${stars ? `<fieldset class="star-input"><legend class="sr-only">Số sao</legend>
          ${[5, 4, 3, 2, 1].map((n) => `<input type="radio" name="s" id="s${n}" value="${n}" required><label for="s${n}" title="${n} sao">★</label>`).join('')}
        </fieldset>` : ''}
        ${field ? `<label class="sheet-label">${esc(field.label || '')}${input}</label>` : ''}
        <div class="sheet-actions">
          <button value="cancel" formnovalidate class="sheet-cancel">Huỷ</button>
          <button value="ok" class="${danger ? 'sheet-danger' : 'sheet-ok'}">${esc(confirm)}</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('cancel'); });
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'ok';
      const v = dlg.querySelector('[name="v"]');
      const s = dlg.querySelector('[name="s"]:checked');
      dlg.remove();
      resolve(ok ? { value: v ? v.value.trim() : '', stars: s ? Number(s.value) : 0 } : null);
    });
    dlg.showModal();
    const first = dlg.querySelector(stars ? '[name="s"]' : '[name="v"]');
    if (first) first.focus();
  });
}

// Copy text, with a toast either way — clipboard access can be refused.
export async function copyText(text, done = 'Đã sao chép.') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch (e) {
    toast('Không sao chép được, hãy chọn và copy thủ công.', true);
  }
}
