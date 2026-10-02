// Client for the local ledger API.
async function request(url, { method = 'GET', body, form, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new Error('Cannot reach the server. Is it still running?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

const qs = (params) => {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== '' && v != null) s.append(k, v); });
  const str = s.toString();
  return str ? `?${str}` : '';
};

const swHeaders = () => {
  try { const k = localStorage.getItem('splitwise_token'); return k ? { 'X-Splitwise-Token': k } : {}; } catch { return {}; }
};

export const API = {
  capabilities: () => request('/api/capabilities'),
  analyzeReceiptAi(file) {
    const form = new FormData();
    form.append('receipts', file, file.name);
    return request('/api/receipts/analyze', { method: 'POST', form });
  },
  splitwiseStatus: () => request('/api/splitwise/status', { headers: swHeaders() }),
  splitwiseImport: () => request('/api/splitwise/import', { method: 'POST', headers: swHeaders() }),
  settings: () => request('/api/settings'),
  saveSettings: (b) => request('/api/settings', { method: 'PUT', body: b }),
  people: () => request('/api/people'),
  addPerson: (b) => request('/api/people', { method: 'POST', body: b }),
  updatePerson: (id, b) => request(`/api/people/${id}`, { method: 'PATCH', body: b }),
  removePerson: (id) => request(`/api/people/${id}`, { method: 'DELETE' }),
  expenses: (params = {}) => request(`/api/expenses${qs(params)}`),
  saveExpense: (id, b) => (id ? request(`/api/expenses/${id}`, { method: 'PUT', body: b }) : request('/api/expenses', { method: 'POST', body: b })),
  deleteExpense: (id) => request(`/api/expenses/${id}`, { method: 'DELETE' }),
  balances: () => request('/api/balances'),
  uploadReceipts(expenseId, files) {
    const form = new FormData();
    files.forEach((f) => form.append('receipts', f, f.name));
    return request(`/api/expenses/${expenseId}/receipts`, { method: 'POST', form });
  },
  deleteReceipt: (expenseId, receiptId) => request(`/api/expenses/${expenseId}/receipts/${receiptId}`, { method: 'DELETE' }),
  receiptUrl: (file) => `/api/receipts/${file}`,
};
