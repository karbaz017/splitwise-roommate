// Small shared helpers for the UI.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

let currency = 'USD';
export const setCurrency = (c) => { currency = c || 'USD'; };
export const getCurrency = () => currency;

export function money(cents, { sign = false } = {}) {
  let out;
  try {
    out = new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Math.abs(cents) / 100);
  } catch {
    out = `${currency} ${(Math.abs(cents) / 100).toFixed(2)}`;
  }
  if (sign && cents > 0) return `+${out}`;
  return cents < 0 ? `-${out}` : out;
}

export const todayISO = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const icons = () => { if (window.lucide) window.lucide.createIcons(); };

export function toast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<div class="toast-message">${esc(message)}</div><button class="toast-close" aria-label="Dismiss">&times;</button>`;
  el.querySelector('button').onclick = () => el.remove();
  container.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 7000 : 4000);
}

export const debounce = (fn, ms = 250) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};
