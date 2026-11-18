/*
 * What the marketplace talks about, shared by every page that shows a freelancer or an
 * order: the fixed lists people filter by, the order status wording, and the one card
 * and voice player used on the browse page, the profile page, the landing page and the
 * order form. src/db.js only length-checks these values — this file is the list.
 */
import { esc, initials, toast } from './ui.js';
import { api } from './api-client.js';

// Fixed lists, so filters match exactly — free text can't be filtered reliably.
export const VOICE_TAGS = ['Ấm áp', 'Ngọt ngào', 'Trầm ấm', 'Trong trẻo', 'Truyền cảm', 'Dịu dàng', 'Vui tươi', 'Hài hước', 'Nghiêm túc', 'Mạnh mẽ'];
export const GENDERS = { nu: 'Giọng nữ', nam: 'Giọng nam' };
export const REGIONS = { bac: 'Miền Bắc', trung: 'Miền Trung', nam: 'Miền Nam' };
export const CARRIERS = ['Viettel', 'Mobifone', 'Vinaphone', 'Vietnamobile'];
export const NUMBER_TYPES = ['Số thường', 'Số đẹp'];
export const OCCASIONS = ['Tỏ tình', 'Xin lỗi', 'Chúc mừng sinh nhật', 'Chúc Giáng sinh, năm mới', 'Cảm ơn', 'Động viên', 'Kỷ niệm', 'Khác'];

export const vnd = (n) => (Number(n) || 0).toLocaleString('vi-VN') + 'đ';
// Built by hand: toLocaleString('vi-VN') gives "14:12 18-11", which reads like a range.
// "14:12, 18/11" — the year only when it isn't this year.
const pad = (n) => String(n).padStart(2, '0');
const dayMonth = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}${d.getFullYear() === new Date().getFullYear() ? '' : `/${d.getFullYear()}`}`;
export const dateTime = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}, ${dayMonth(d)}`;
};
export const dateOnly = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};
export const monthYear = (ms) => (ms ? new Date(ms).toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' }) : '');
export const isNiceNumber = (f) => /đẹp/i.test(f.numberType || '');

// "Giọng nữ, miền Bắc" — the region reads lower-case mid-sentence.
export const voiceLine = (f) => [GENDERS[f.gender], REGIONS[f.region] && REGIONS[f.region].replace('Miền', 'miền')].filter(Boolean).join(', ');

// ---- Order statuses -------------------------------------------------------------
// Same status, worded for whoever is reading it.
export const STATUS = {
  cho_duyet_kich_ban: { buyer: 'Đang chờ duyệt lời nhắn', freelancer: 'Chờ CSKH duyệt', tone: '' },
  kich_ban_bi_tu_choi: { buyer: 'Lời nhắn bị từ chối, đã hoàn tiền', freelancer: 'Lời nhắn bị từ chối', tone: 'bad' },
  da_duyet_cho_goi: { buyer: 'Đã duyệt, chờ người nói hộ gọi', freelancer: 'Cần gọi', tone: 'go' },
  cho_xac_nhan: { buyer: 'Đã gọi, chờ bạn xác nhận', freelancer: 'Chờ người thuê xác nhận', tone: 'go' },
  da_dong: { buyer: 'Hoàn thành', freelancer: 'Hoàn thành', tone: 'ok' },
  tranh_chap: { buyer: 'Đang tranh chấp, chờ CSKH', freelancer: 'Đang tranh chấp', tone: 'bad' },
  da_hoan_tien: { buyer: 'Đã hoàn tiền', freelancer: 'Đã hoàn tiền cho người thuê', tone: '' },
  da_huy: { buyer: 'Đã huỷ, đã hoàn tiền', freelancer: 'Đã huỷ', tone: '' },
};
export const statusPill = (status, who) => {
  const s = STATUS[status] || { buyer: status, freelancer: status, tone: '' };
  return `<span class="status-pill ${s.tone}">${esc(s[who])}</span>`;
};

// Where an order is on the happy path; null for the ways an order can end early.
const STEP_OF = { cho_duyet_kich_ban: 1, da_duyet_cho_goi: 2, cho_xac_nhan: 3, tranh_chap: 3, da_dong: 4 };
export function orderSteps(status) {
  const at = STEP_OF[status];
  if (at == null) return '';
  const labels = ['Đặt đơn', 'Duyệt lời nhắn', 'Gọi điện', 'Xác nhận'];
  return `<ol class="steps" aria-label="Tiến độ đơn">${labels.map((label, i) => {
    const state = i < at ? 'done' : i === at ? (status === 'tranh_chap' ? 'stuck' : 'now') : '';
    return `<li class="${state}">${label}</li>`;
  }).join('')}</ol>`;
}

// ---- Voice demos ----------------------------------------------------------------
// One clip plays at a time across the page; clips are fetched on first play only, since
// each is ~100 KB and most visitors only listen to a few.
const clips = new Map();
let playing = null;

function setPlayState(btn, state) {
  btn.dataset.state = state;
  btn.setAttribute('aria-label', state === 'playing' ? 'Dừng giọng mẫu' : 'Nghe giọng mẫu');
  const label = btn.querySelector('.vp-label');
  if (label) label.textContent = state === 'playing' ? 'Dừng' : state === 'loading' ? 'Đang tải…' : 'Nghe giọng';
}

async function toggleVoice(id, btn) {
  if (playing && playing.btn === btn) { playing.audio.pause(); return; }
  if (playing) playing.audio.pause();
  setPlayState(btn, 'loading');
  if (!clips.has(id)) clips.set(id, (await api.freelancers.voice(id)).audio);
  const audio = new Audio(clips.get(id));
  playing = { audio, btn };
  audio.onplay = () => setPlayState(btn, 'playing');
  audio.onpause = audio.onended = () => {
    setPlayState(btn, 'idle');
    if (playing && playing.audio === audio) playing = null;
  };
  await audio.play();
}

export function wireVoiceButtons(root = document) {
  root.querySelectorAll('[data-voice]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleVoice(btn.dataset.voice, btn).catch((err) => { setPlayState(btn, 'idle'); toast(err.message, true); });
    };
  });
}

// The round play button with the equaliser that moves while the clip plays.
export const voiceButton = (id, { big = false } = {}) => `
  <button type="button" class="vp${big ? ' vp-big' : ''}" data-voice="${esc(id)}" data-state="idle" aria-label="Nghe giọng mẫu">
    <span class="vp-icon" aria-hidden="true"></span>
    <span class="vp-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    ${big ? '<span class="vp-label">Nghe giọng</span>' : ''}
  </button>`;

// ---- The freelancer card --------------------------------------------------------
export function freelancerCard(f) {
  const tags = [
    ...f.voiceTags.map((t) => `<span class="tag">${esc(t)}</span>`),
    isNiceNumber(f) ? `<span class="tag tag-pine">${esc(f.numberNote ? `Số đẹp, ${f.numberNote}` : 'Số đẹp')}</span>` : '',
  ].join('');
  const rating = f.ratingCount
    ? `<span class="fc-rating"><span class="star">★</span> ${f.rating.toFixed(1)} <span class="faint">(${f.ratingCount})</span></span>`
    : '<span class="faint">Chưa có đánh giá</span>';
  const calls = f.completedCount ? `${f.completedCount} cuộc gọi` : 'Mới tham gia';
  return `
  <article class="fc${f.accepting ? '' : ' fc-off'}">
    <div class="fc-head">
      <div class="fc-avatar" aria-hidden="true">${esc(initials(f.name))}</div>
      <div class="fc-who">
        <h3 class="fc-name"><a href="ho-so.html?id=${encodeURIComponent(f.id)}">${esc(f.name)}</a></h3>
        <p class="fc-sub">${esc(voiceLine(f)) || '&nbsp;'}</p>
      </div>
      ${f.hasVoiceDemo ? voiceButton(f.id) : ''}
    </div>
    ${f.bio ? `<p class="fc-bio">${esc(f.bio)}</p>` : ''}
    ${tags ? `<div class="fc-tags">${tags}</div>` : ''}
    <div class="fc-stats">${rating}<span>${calls}</span>${f.carrier ? `<span>${esc(f.carrier)}</span>` : ''}${f.accepting ? '' : '<span class="fc-paused">Tạm nghỉ</span>'}</div>
    <div class="fc-foot">
      <span class="fc-price"><span class="faint">Từ</span> ${vnd(f.fromPrice)}</span>
      ${f.accepting
        ? `<a class="fc-cta" href="dat-don.html?f=${encodeURIComponent(f.id)}">Đặt cuộc gọi</a>`
        : `<a class="fc-cta fc-cta-quiet" href="ho-so.html?id=${encodeURIComponent(f.id)}">Xem hồ sơ</a>`}
    </div>
  </article>`;
}

/*
 * "Gợi ý" ordering: people taking orders first, then a rating pulled toward 4.5 until
 * there are enough reviews to trust it (one 5★ review shouldn't outrank fifty 4.9★
 * ones), then a nudge for a voice demo and for experience.
 */
export function recommendedScore(f) {
  const prior = 4.5, weight = 3;
  const rating = (prior * weight + (f.rating || 0) * f.ratingCount) / (weight + f.ratingCount);
  return (f.accepting ? 100 : 0) + rating + (f.hasVoiceDemo ? 0.3 : 0) + Math.log10(1 + f.completedCount) * 0.2;
}
