import { getIdToken } from './firebase-client.js';
import { API_BASE_URL } from './api-base.js';

async function call(path, { httpMethod = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await getIdToken();
    if (!token) throw new Error('Chưa đăng nhập.');
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(API_BASE_URL + '/api' + path, { method: httpMethod, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Lỗi không rõ.');
  return data;
}

const id = (v) => encodeURIComponent(v);

export const api = {
  freelancers: {
    list: () => call('/freelancers', { auth: false }),
    get: (publicId) => call(`/freelancers/${id(publicId)}`, { auth: false }),
    voice: (publicId) => call(`/freelancers/${id(publicId)}/voice-demo`, { auth: false }),
  },
  wallet: {
    get: () => call('/wallet'),
    topupLink: (amount) => call('/wallet/topup-link', { httpMethod: 'POST', body: { amount } }),
  },
  freelancer: {
    me: () => call('/freelancer/me'),
    saveProfile: (data) => call('/freelancer/profile', { httpMethod: 'POST', body: data }),
    setAccepting: (accepting) => call('/freelancer/accepting', { httpMethod: 'POST', body: { accepting } }),
    voice: () => call('/freelancer/voice-demo'),
    saveVoice: (audio) => call('/freelancer/voice-demo', { httpMethod: 'PUT', body: { audio } }),
    deleteVoice: () => call('/freelancer/voice-demo', { httpMethod: 'DELETE' }),
  },
  orders: {
    mine: () => call('/orders/mine'),
    assigned: () => call('/orders/assigned'),
    create: (data) => call('/orders', { httpMethod: 'POST', body: data }),
    cancel: (orderId, reason) => call(`/orders/${id(orderId)}/cancel`, { httpMethod: 'POST', body: { reason } }),
    decline: (orderId, reason) => call(`/orders/${id(orderId)}/decline`, { httpMethod: 'POST', body: { reason } }),
    markCalled: (orderId, hasRecording) => call(`/orders/${id(orderId)}/called`, { httpMethod: 'POST', body: { hasRecording } }),
    confirm: (orderId, confirmMethod) => call(`/orders/${id(orderId)}/confirm`, { httpMethod: 'POST', body: { method: confirmMethod } }),
    dispute: (orderId, reason) => call(`/orders/${id(orderId)}/dispute`, { httpMethod: 'POST', body: { reason } }),
    rate: (orderId, stars, comment) => call(`/orders/${id(orderId)}/rate`, { httpMethod: 'POST', body: { stars, comment } }),
  },
  withdrawals: {
    request: (amount, bankNumber, bankHolder) => call('/withdrawals', { httpMethod: 'POST', body: { amount, bankNumber, bankHolder } }),
    mine: () => call('/withdrawals/mine'),
  },
  reports: {
    submit: (data) => call('/reports', { httpMethod: 'POST', body: data, auth: false }),
  },
  admin: {
    pendingReview: () => call('/admin/orders/pending-review'),
    reviewScript: (orderId, approve, bannedFlags) => call(`/admin/orders/${id(orderId)}/review`, { httpMethod: 'POST', body: { approve, bannedFlags } }),
    disputed: () => call('/admin/orders/disputed'),
    resolveDispute: (orderId, decision) => call(`/admin/orders/${id(orderId)}/resolve-dispute`, { httpMethod: 'POST', body: { decision } }),
    pendingWithdrawals: () => call('/admin/withdrawals/pending'),
    approveWithdrawal: (wdId) => call(`/admin/withdrawals/${id(wdId)}/approve`, { httpMethod: 'POST' }),
    rejectWithdrawal: (wdId) => call(`/admin/withdrawals/${id(wdId)}/reject`, { httpMethod: 'POST' }),
    pendingReports: () => call('/admin/reports/pending'),
    dismissReport: (reportId) => call(`/admin/reports/${id(reportId)}/dismiss`, { httpMethod: 'POST' }),
    blockFreelancer: (reportId, freelancerPhone) => call(`/admin/reports/${id(reportId)}/block`, { httpMethod: 'POST', body: { freelancerPhone } }),
    allFreelancers: () => call('/admin/freelancers'),
    runTimeouts: () => call('/admin/timeouts/run', { httpMethod: 'POST' }),
  },
};
