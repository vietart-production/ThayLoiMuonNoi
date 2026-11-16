import { getIdToken } from './firebase-client.js';

async function call(path, { httpMethod = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await getIdToken();
    if (!token) throw new Error('Chưa đăng nhập.');
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch('/api' + path, { method: httpMethod, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Lỗi không rõ.');
  return data;
}

export const api = {
  freelancers: {
    list: () => call('/freelancers', { auth: false }),
  },
  wallet: {
    get: () => call('/wallet'),
    topupLink: (amount) => call('/wallet/topup-link', { httpMethod: 'POST', body: { amount } }),
  },
  freelancer: {
    saveProfile: (data) => call('/freelancer/profile', { httpMethod: 'POST', body: data }),
    me: () => call('/freelancer/me'),
  },
  orders: {
    mine: () => call('/orders/mine'),
    assigned: () => call('/orders/assigned'),
    create: (data) => call('/orders', { httpMethod: 'POST', body: data }),
    markCalled: (id, hasRecording) => call(`/orders/${id}/called`, { httpMethod: 'POST', body: { hasRecording } }),
    confirm: (id, confirmMethod) => call(`/orders/${id}/confirm`, { httpMethod: 'POST', body: { method: confirmMethod } }),
    dispute: (id, reason) => call(`/orders/${id}/dispute`, { httpMethod: 'POST', body: { reason } }),
    rate: (id, stars) => call(`/orders/${id}/rate`, { httpMethod: 'POST', body: { stars } }),
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
    reviewScript: (id, approve, bannedFlags) => call(`/admin/orders/${id}/review`, { httpMethod: 'POST', body: { approve, bannedFlags } }),
    disputed: () => call('/admin/orders/disputed'),
    resolveDispute: (id, decision) => call(`/admin/orders/${id}/resolve-dispute`, { httpMethod: 'POST', body: { decision } }),
    pendingWithdrawals: () => call('/admin/withdrawals/pending'),
    approveWithdrawal: (id) => call(`/admin/withdrawals/${id}/approve`, { httpMethod: 'POST' }),
    rejectWithdrawal: (id) => call(`/admin/withdrawals/${id}/reject`, { httpMethod: 'POST' }),
    pendingReports: () => call('/admin/reports/pending'),
    dismissReport: (id) => call(`/admin/reports/${id}/dismiss`, { httpMethod: 'POST' }),
    blockFreelancer: (id, freelancerPhone) => call(`/admin/reports/${id}/block`, { httpMethod: 'POST', body: { freelancerPhone } }),
    allFreelancers: () => call('/admin/freelancers'),
    runTimeouts: () => call('/admin/timeouts/run', { httpMethod: 'POST' }),
  },
};
