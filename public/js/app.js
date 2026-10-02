import { API } from './api.js';
import { ReceiptPicker } from './receipts.js';
import { analyzeReceipt, mergeResults } from './ocr.js';
import { computeItemSplits, toCents } from '/shared/money.js';
import { esc, money, setCurrency, todayISO, formatDate, icons, toast, debounce } from './util.js';

const $ = (id) => document.getElementById(id);
const PAGE = 15;

const state = {
  settings: { householdName: '', currency: 'USD', categories: [] },
  people: [],
  me: localStorage.getItem('ledger_me') || '',
  ai: false, // server has an AI key
  tab: 'dashboard',
  page: 0,
  total: 0,
  expenses: [],
  filters: { search: '', person: '', category: '', month: '' },
  editing: null, // expense being edited (or null)
  settleEditing: null,
  rows: [], // split-editor rows for the expense modal
  items: [], // item-by-item rows: {name, amount, personIds}
};

const active = () => state.people.filter((p) => p.active);
const nameOf = (id) => state.people.find((p) => p.id === id)?.name || 'Former roommate';
const youOr = (id) => (id === state.me ? 'You' : nameOf(id));

// ---------------------------------------------------------------- bootstrap
async function load() {
  const [settings, people] = await Promise.all([API.settings(), API.people()]);
  state.settings = settings;
  state.people = people.people;
  setCurrency(settings.currency);
  if (!state.capsLoaded) {
    state.capsLoaded = true;
    API.capabilities().then((c) => { state.ai = !!c.ai; $('ai-card').classList.toggle('hidden', !c.ai); }).catch(() => {});
  }
  if (!active().some((p) => p.id === state.me)) state.me = active()[0]?.id || '';
  renderChrome();
}

function renderChrome() {
  const name = state.settings.householdName;
  $('household-name').textContent = name || 'Roommate Ledger';
  document.title = name ? `${name} · Roommate Ledger` : 'Roommate Ledger';
  $('me-select').innerHTML = active().map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('') || '<option value="">Add roommates first</option>';
  $('me-select').value = state.me;
  const opts = (first) => `<option value="">${first}</option>` + active().map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  const cur = $('f-person').value;
  $('f-person').innerHTML = opts('Everyone');
  $('f-person').value = cur;
  const cat = $('f-category').value;
  $('f-category').innerHTML = '<option value="">All categories</option>' + [...state.settings.categories, 'Settlement'].map((c) => `<option>${esc(c)}</option>`).join('');
  $('f-category').value = cat;
  $('e-category').innerHTML = state.settings.categories.map((c) => `<option>${esc(c)}</option>`).join('');
  $('s-name').value = state.settings.householdName;
  $('s-currency').value = state.settings.currency;
}

async function refresh() {
  await load();
  await renderTab();
}

// ---------------------------------------------------------------- tabs
function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `${tab}-panel`));
  renderTab();
}

async function renderTab() {
  try {
    if (state.tab === 'dashboard') await renderDashboard();
    else if (state.tab === 'expenses') await renderExpenses();
    else if (state.tab === 'people') renderPeople();
  } catch (err) { toast(err.message, 'error'); }
  icons();
}

// ---------------------------------------------------------------- dashboard
async function renderDashboard() {
  const people = active();
  $('onboarding').classList.toggle('hidden', people.length >= 2);
  if (people.length < 2) {
    $('onboarding').innerHTML = `<h3><i data-lucide="sparkles"></i> Welcome</h3>
      <p class="settings-desc">Add everyone who shares expenses with you (including yourself) on the <a href="#" data-goto="people">Roommates</a> tab, then start adding expenses. No account or Splitwise connection needed.</p>`;
  }
  const [bal, recent, all] = await Promise.all([API.balances(), API.expenses({ limit: 8 }), API.expenses({ limit: 200 })]);
  const mine = bal.net[state.me] || 0;
  const owe = bal.transfers.filter((t) => t.from === state.me).reduce((a, t) => a + t.cents, 0);
  const owed = bal.transfers.filter((t) => t.to === state.me).reduce((a, t) => a + t.cents, 0);
  $('m-net').textContent = money(mine, { sign: true });
  $('m-net').className = `metric-value ${mine > 0 ? 'text-success' : mine < 0 ? 'text-danger' : ''}`;
  $('m-net-desc').textContent = mine > 0 ? 'Overall you are owed' : mine < 0 ? 'Overall you owe' : 'You are settled up';
  $('m-owe').textContent = money(owe);
  $('m-owed').textContent = money(owed);

  $('transfers').innerHTML = bal.transfers.length
    ? bal.transfers.map((t) => `<div class="bal-row transfer ${t.from === state.me ? 'mine' : ''}">
        <span><strong>${esc(youOr(t.from))}</strong> ${t.from === state.me ? 'pay' : 'pays'} <strong>${esc(youOr(t.to))}</strong></span>
        <span class="amt">${money(t.cents)}</span>
        <button class="btn btn-outline btn-sm" data-settle-from="${esc(t.from)}" data-settle-to="${esc(t.to)}" data-settle-amount="${t.cents}">Record payment</button>
      </div>`).join('')
    : '<p class="muted">Everyone is settled up. 🎉</p>';

  $('balances').innerHTML = people.map((p) => {
    const v = bal.net[p.id] || 0;
    return `<div class="bal-row"><span>${esc(youOr(p.id))}</span><span class="amt ${v > 0 ? 'text-success' : v < 0 ? 'text-danger' : ''}">${v === 0 ? 'settled' : v > 0 ? `is owed ${money(v)}` : `owes ${money(-v)}`}</span></div>`;
  }).join('') || '<p class="muted">No roommates yet.</p>';

  // Category totals for the current month, based on the viewer's own share.
  const month = todayISO().slice(0, 7);
  const totals = {};
  all.expenses.filter((e) => e.type === 'expense' && e.date.startsWith(month)).forEach((e) => {
    const share = e.splits.find((s) => s.personId === state.me)?.cents || 0;
    if (share) totals[e.category] = (totals[e.category] || 0) + share;
  });
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] || 1;
  $('cat-range').textContent = `· your share, ${new Date().toLocaleDateString(undefined, { month: 'long' })}`;
  $('categories').innerHTML = rows.map(([c, v]) => `<div class="bar-row"><span>${esc(c)}</span><div class="bar"><i style="width:${(v / max) * 100}%"></i></div><span class="amt">${money(v)}</span></div>`).join('') || '<p class="muted">No spending recorded this month.</p>';

  $('recent').innerHTML = recent.expenses.map((e) => `<div class="activity-item"><div class="act-info"><span class="act-desc">${esc(e.description)}</span><span class="act-meta">${formatDate(e.date)} · ${esc(e.category)}</span></div><div style="text-align:right"><span class="act-amount">${money(e.amountCents)}</span><div class="act-meta ${involvement(e).cls}">${esc(involvement(e).text)}</div></div></div>`).join('') || '<p class="muted">Nothing yet.</p>';
}

function involvement(e) {
  const paid = e.paidBy.find((p) => p.personId === state.me)?.cents || 0;
  const owed = e.splits.find((s) => s.personId === state.me)?.cents || 0;
  if (e.type === 'settlement') {
    if (paid) return { text: `you paid ${nameOf(e.splits[0].personId)}`, cls: 'text-success' };
    if (owed) return { text: `${nameOf(e.paidBy[0].personId)} paid you`, cls: 'text-success' };
    return { text: 'not involved', cls: '' };
  }
  const net = paid - owed;
  if (!paid && !owed) return { text: 'not involved', cls: '' };
  if (net > 0) return { text: `you lent ${money(net)}`, cls: 'text-success' };
  if (net < 0) return { text: `you owe ${money(-net)}`, cls: 'text-danger' };
  return { text: 'even', cls: '' };
}

// ---------------------------------------------------------------- expenses list
function monthRange(m) {
  if (!m) return {};
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(y, mo, 0).getDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` };
}

async function renderExpenses() {
  const f = state.filters;
  const data = await API.expenses({ search: f.search, person: f.person, category: f.category === 'Settlement' ? '' : f.category, type: f.category === 'Settlement' ? 'settlement' : '', ...monthRange(f.month), limit: PAGE, offset: state.page * PAGE });
  state.expenses = data.expenses;
  state.total = data.total;
  const pages = Math.max(1, Math.ceil(data.total / PAGE));
  if (state.page >= pages) { state.page = pages - 1; return renderExpenses(); }
  $('page-info').textContent = `Page ${state.page + 1} of ${pages} · ${data.total} entr${data.total === 1 ? 'y' : 'ies'}`;
  $('prev').disabled = state.page === 0;
  $('next').disabled = state.page + 1 >= pages;
  $('expense-list').innerHTML = data.expenses.map(expenseCard).join('') || `<div class="dashboard-card empty"><p>No entries match.</p></div>`;
}

function expenseCard(e) {
  const inv = involvement(e);
  const payers = e.paidBy.map((p) => `${youOr(p.personId)} ${money(p.cents)}`).join(', ');
  const splits = e.splits.map((s) => `<div class="split-user-row"><span class="split-username">${esc(youOr(s.personId))}</span><span class="split-details">${e.type === 'settlement' ? 'received' : 'owes'} ${money(s.cents)}</span></div>`).join('');
  const receipts = (e.receipts || []).map((r) => `<a class="receipt-mini" href="${API.receiptUrl(r.file)}" target="_blank" rel="noopener" title="${esc(r.name)}">${r.mime.startsWith('image/') && r.mime !== 'image/heic' ? `<img src="${API.receiptUrl(r.file)}" alt="${esc(r.name)}" loading="lazy">` : `<span>${r.mime === 'application/pdf' ? 'PDF' : 'IMG'}</span>`}</a>`).join('');
  const itemsHtml = e.items?.length ? `<div class="items-detail">${e.items.map((it) => `<div class="split-user-row"><span class="split-username">${esc(it.name || 'Item')}</span><span class="split-details">${money(it.cents)} · ${esc(it.personIds.map(youOr).join(', '))}</span></div>`).join('')}${e.extraCents ? `<div class="split-user-row"><span class="split-username">Tax, tip &amp; fees</span><span class="split-details">${money(e.extraCents)}</span></div>` : ''}</div>` : '';
  return `<div class="expense-card-wrapper" data-id="${esc(e.id)}">
    <div class="expense-card" data-toggle>
      <div class="expense-details">
        <span class="expense-desc">${e.type === 'settlement' ? '💸 ' : ''}${esc(e.description)}${(e.receipts || []).length ? ` <span class="clip" title="${e.receipts.length} receipt(s)">📎${e.receipts.length}</span>` : ''}</span>
        <span class="expense-meta">${formatDate(e.date)} · ${esc(e.category)} · paid by ${esc(payers)}</span>
      </div>
      <div class="expense-financials">
        <div class="fin-block"><span class="fin-label">${esc(inv.text)}</span><span class="fin-value ${inv.cls}">${money(e.amountCents)}</span></div>
      </div>
      <div class="expense-actions">
        <button title="Edit" aria-label="Edit" data-edit="${esc(e.id)}">✎</button>
        <button class="btn-delete-expense" title="Delete" aria-label="Delete" data-delete="${esc(e.id)}">🗑</button>
      </div>
    </div>
    <div class="expense-expanded-details">
      ${itemsHtml}
      <div class="expanded-splits-grid">${splits}</div>
      ${e.notes ? `<p class="notes">${esc(e.notes)}</p>` : ''}
      ${receipts ? `<div class="receipt-strip">${receipts}</div>` : ''}
    </div>
  </div>`;
}

// ---------------------------------------------------------------- people
function renderPeople() {
  $('people-grid').innerHTML = state.people.map((p) => `<div class="entity-card ${p.active ? '' : 'archived'}">
    <div class="entity-body">
      <span class="entity-title">${esc(p.name)} ${p.id === state.me ? '<span class="badge">you</span>' : ''} ${p.active ? '' : '<span class="badge">archived</span>'}</span>
      <span class="entity-desc">${esc(p.email || '')}</span>
      <div class="person-actions">
        <button class="btn btn-outline btn-sm" data-rename="${esc(p.id)}">Rename</button>
        ${p.active ? `<button class="btn btn-outline btn-sm" data-remove-person="${esc(p.id)}">Remove</button>` : `<button class="btn btn-outline btn-sm" data-restore="${esc(p.id)}">Restore</button>`}
      </div>
    </div></div>`).join('') || '<p class="muted">No roommates yet. Add the first one above.</p>';
}

// ---------------------------------------------------------------- expense modal
let expensePicker;
let disposePaste = () => {};

function openModal(id) { $(id).classList.remove('hidden'); document.body.classList.add('modal-open'); }
function closeModals() {
  document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.add('hidden'));
  document.body.classList.remove('modal-open');
  disposePaste();
}

function personOptions(selected) {
  return active().map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}${p.id === state.me ? ' (you)' : ''}</option>`).join('');
}

function openExpense(expense = null) {
  if (active().length < 1) { toast('Add at least one roommate first.', 'warning'); switchTab('people'); return; }
  state.editing = expense;
  $('expense-modal-title').textContent = expense ? 'Edit Expense' : 'Add Expense';
  $('e-desc').value = expense?.description || '';
  $('e-amount').value = expense ? expense.amountCents / 100 : '';
  $('e-date').value = expense?.date || todayISO();
  $('e-category').value = expense?.category || 'Other';
  $('e-notes').value = expense?.notes || '';
  $('e-error').classList.add('hidden');
  const multi = !!expense && expense.paidBy.length > 1;
  $('e-multi-payer').checked = multi;
  // Archived people can only appear when editing an old entry.
  const involved = new Set(expense ? [...expense.paidBy, ...expense.splits].map((x) => x.personId) : []);
  const pool = state.people.filter((p) => p.active || involved.has(p.id));
  state.pool = pool;
  const payerSel = $('e-paid-by');
  payerSel.innerHTML = pool.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.id === state.me ? ' (you)' : ''}</option>`).join('');
  payerSel.value = expense?.paidBy[0]?.personId || state.me;
  // Stored per-person cents are the source of truth. Re-editing an evenly split entry keeps
  // "equally"; anything else is edited as exact amounts so nothing is silently changed.
  const first = expense?.splits[0]?.cents;
  const equalish = !expense || expense.splits.every((s) => Math.abs(s.cents - first) <= 1);
  $('e-method').value = expense?.splitMethod === 'items' && expense.items ? 'items' : equalish ? 'equal' : 'exact';
  state.items = expense?.splitMethod === 'items' && expense.items
    ? expense.items.map((it) => ({ name: it.name, amount: it.cents / 100, personIds: [...it.personIds] }))
    : [];
  state.rows = pool.map((p) => {
    const s = expense?.splits.find((x) => x.personId === p.id);
    const paid = expense?.paidBy.find((x) => x.personId === p.id);
    return {
      personId: p.id,
      name: p.name,
      included: expense ? !!s : p.active,
      value: !equalish && s ? s.cents / 100 : '',
      paid: paid ? paid.cents / 100 : '',
    };
  });
  renderRows();
  expensePicker.reset(expense?.receipts || [], expense?.id || null);
  detectRun++;
  $('e-detect').classList.add('hidden');
  $('e-detect').textContent = '';
  expensePicker.onRemoveExisting = () => { renderTab(); };
  disposePaste = expensePicker.listenForPaste($('expense-modal'));
  openModal('expense-modal');
  $('e-desc').focus();
}

function renderRows() {
  const method = $('e-method').value;
  const itemsMode = method === 'items';
  $('e-participants').classList.toggle('hidden', itemsMode);
  $('e-items').classList.toggle('hidden', !itemsMode);
  $('e-multi-payer').disabled = itemsMode;
  if (itemsMode) {
    $('e-multi-payer').checked = false;
    $('e-paid-by').disabled = false;
    if (state.items.length === 0) state.items.push(newItem());
    renderItems();
    return;
  }
  const multi = $('e-multi-payer').checked;
  $('e-paid-by').disabled = multi;
  const label = { equal: '', shares: 'shares', percentage: '%', exact: 'amount' }[method];
  $('e-participants').innerHTML = `<div class="rows-head"><span>Person</span>${multi ? '<span>Paid</span>' : ''}<span>${label ? `Owes (${label})` : 'Owes'}</span></div>` +
    state.rows.map((r, i) => `<div class="split-row ${r.included ? '' : 'off'}" data-i="${i}">
      <label class="check-inline"><input type="checkbox" data-f="included" ${r.included ? 'checked' : ''}> ${esc(r.name)}</label>
      ${multi ? `<input type="number" step="0.01" min="0" data-f="paid" value="${r.paid}" placeholder="0.00" aria-label="Paid by ${esc(r.name)}">` : ''}
      ${method === 'equal' ? `<span class="calc" data-calc="${i}"></span>` : `<input type="number" step="${method === 'shares' ? '0.5' : '0.01'}" min="0" data-f="value" value="${r.value === '' && method === 'shares' ? 1 : r.value}" ${r.included ? '' : 'disabled'} aria-label="${label} for ${esc(r.name)}">`}
    </div>`).join('');
  updateValidation();
}

function readRows() {
  document.querySelectorAll('#e-participants .split-row').forEach((row) => {
    const r = state.rows[Number(row.dataset.i)];
    r.included = row.querySelector('[data-f=included]').checked;
    const v = row.querySelector('[data-f=value]');
    if (v) r.value = v.value;
    const p = row.querySelector('[data-f=paid]');
    if (p) r.paid = p.value;
  });
}

// Client-side preview only; the server recomputes and validates everything.
function updateValidation() {
  if ($('e-method').value === 'items') return updateItemsSummary();
  readRows();
  const method = $('e-method').value;
  const total = Math.round((parseFloat($('e-amount').value) || 0) * 100);
  const inc = state.rows.filter((r) => r.included);
  let msg = '';
  let ok = true;
  const num = (v, d = 0) => (v === '' || Number.isNaN(Number(v)) ? d : Number(v));
  if (method === 'equal' && inc.length) {
    const base = Math.floor(total / inc.length);
    let extra = total - base * inc.length;
    state.rows.forEach((r, i) => {
      const el = document.querySelector(`[data-calc="${i}"]`);
      if (!el) return;
      if (!r.included) { el.textContent = '–'; return; }
      el.textContent = money(base + (extra-- > 0 ? 1 : 0));
    });
  } else if (method === 'exact') {
    const sum = Math.round(inc.reduce((a, r) => a + num(r.value) * 100, 0));
    ok = sum === total; msg = `Owed ${money(sum)} of ${money(total)}`;
  } else if (method === 'percentage') {
    const sum = inc.reduce((a, r) => a + num(r.value), 0);
    ok = Math.abs(sum - 100) < 0.011; msg = `${sum.toFixed(2)}% of 100%`;
  } else if (method === 'shares') {
    const sum = inc.reduce((a, r) => a + num(r.value, 1), 0);
    ok = sum > 0; msg = `${sum} shares total`;
  }
  if (inc.length === 0) { ok = false; msg = 'Choose at least one person'; }
  if ($('e-multi-payer').checked) {
    const paid = Math.round(state.rows.reduce((a, r) => a + num(r.paid) * 100, 0));
    const pok = paid === total;
    msg += `${msg ? ' · ' : ''}Paid ${money(paid)} of ${money(total)}`;
    ok = ok && pok;
  }
  $('e-validation').innerHTML = msg ? `<span class="val-dot ${ok ? 'dot-success' : 'dot-error'}"></span> ${esc(msg)}` : '';
}

function buildExpensePayload() {
  if ($('e-method').value === 'items') {
    return {
      description: $('e-desc').value, amount: $('e-amount').value, date: $('e-date').value,
      category: $('e-category').value, notes: $('e-notes').value, splitMethod: 'items',
      paidBy: [{ personId: $('e-paid-by').value }],
      items: state.items.map((it) => ({ name: it.name, amount: it.amount, personIds: it.personIds })),
    };
  }
  readRows();
  const method = $('e-method').value;
  const inc = state.rows.filter((r) => r.included);
  const multi = $('e-multi-payer').checked;
  return {
    description: $('e-desc').value,
    amount: $('e-amount').value,
    date: $('e-date').value,
    category: $('e-category').value,
    notes: $('e-notes').value,
    splitMethod: method,
    participants: inc.map((r) => ({ personId: r.personId, value: method === 'equal' ? undefined : (r.value === '' && method === 'shares' ? 1 : r.value) })),
    paidBy: multi
      ? state.rows.filter((r) => Number(r.paid) > 0).map((r) => ({ personId: r.personId, amount: r.paid }))
      : [{ personId: $('e-paid-by').value }],
  };
}

async function submitExpense(e) {
  e.preventDefault();
  const btn = $('e-submit');
  const err = $('e-error');
  err.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const { expense } = await API.saveExpense(state.editing?.id, buildExpensePayload());
    const files = expensePicker.files;
    if (files.length) {
      try { await API.uploadReceipts(expense.id, files); } catch (upErr) {
        toast(`Saved, but receipts failed to upload: ${upErr.message}. Edit the entry to retry.`, 'warning');
      }
    }
    closeModals();
    toast(state.editing ? 'Expense updated.' : 'Expense added.');
    await refresh();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Expense';
  }
}

// ---------------------------------------------------------------- item-by-item editor
const newItem = (name = '', amount = '', personIds = null) => ({
  name, amount, personIds: personIds || (state.pool || active()).filter((p) => p.active).map((p) => p.id),
});

function renderItems() {
  const pool = state.pool || active();
  $('e-items').innerHTML = `
    <div class="items-head"><span>Item</span><span>Price</span><span>Shared by (tap to toggle)</span><span></span></div>
    ${state.items.map((it, i) => `<div class="item-row" data-i="${i}">
      <input type="text" data-f="name" value="${esc(it.name)}" maxlength="100" placeholder="Item name" aria-label="Item name">
      <input type="number" data-f="amount" value="${esc(it.amount)}" step="0.01" min="0.01" inputmode="decimal" placeholder="0.00" aria-label="Item price">
      <div class="chips">${pool.map((p) => `<button type="button" class="chip ${it.personIds.includes(p.id) ? 'on' : ''}" data-chip="${esc(p.id)}" aria-pressed="${it.personIds.includes(p.id)}">${esc(p.name)}</button>`).join('')}
        <button type="button" class="chip all" data-all>Everyone</button></div>
      <button type="button" class="receipt-remove" data-del-item aria-label="Remove item">&times;</button>
    </div>`).join('')}
    <div class="items-actions">
      <button type="button" class="btn btn-outline btn-sm" id="e-add-item">+ Add item</button>
      <button type="button" class="btn btn-outline btn-sm hidden" id="e-use-items-total">Set total to items</button>
    </div>
    <div class="items-summary" id="e-items-summary"></div>`;
  updateItemsSummary();
}

function updateItemsSummary() {
  const box = $('e-items-summary');
  if (!box) return;
  const total = Math.round((parseFloat($('e-amount').value) || 0) * 100);
  let itemsCents = 0;
  let bad = false;
  const items = state.items.map((it) => {
    let cents = 0;
    try { cents = toCents(it.amount); } catch { bad = true; }
    if (cents <= 0 || it.personIds.length === 0) bad = true;
    itemsCents += Math.max(cents, 0);
    return { cents, personIds: it.personIds, name: it.name };
  });
  const extra = total - itemsCents;
  $('e-use-items-total')?.classList.toggle('hidden', extra === 0 || itemsCents <= 0);
  let html = `<div class="sum-line"><span>Items</span><strong>${money(itemsCents)}</strong></div>
    <div class="sum-line"><span>Tax, tip, fees ${extra < 0 ? '(discount)' : ''} — shared in proportion</span><strong>${money(extra)}</strong></div>`;
  let ok = !bad && total > 0;
  if (ok) {
    try {
      const r = computeItemSplits(total, items);
      html += r.splits.map((s) => `<div class="sum-line person"><span>${esc(youOr(s.personId))}</span><strong>${money(s.cents)}</strong></div>`).join('');
    } catch (err) { ok = false; html += `<div class="sum-line err">${esc(err.message)}</div>`; }
  } else if (bad) html += '<div class="sum-line err">Every item needs a price and at least one person.</div>';
  $('e-validation').innerHTML = `<span class="val-dot ${ok ? 'dot-success' : 'dot-error'}"></span> ${ok ? 'Looks good' : 'Check the items'}`;
  box.innerHTML = html;
}

function bindItems() {
  const root = $('e-items');
  root.addEventListener('input', (e) => {
    const row = e.target.closest('.item-row');
    if (!row || !e.target.dataset.f) return;
    state.items[Number(row.dataset.i)][e.target.dataset.f] = e.target.value;
    updateItemsSummary();
  });
  root.addEventListener('click', (e) => {
    const row = e.target.closest('.item-row');
    const it = row && state.items[Number(row.dataset.i)];
    if (e.target.closest('[data-chip]') && it) {
      const id = e.target.closest('[data-chip]').dataset.chip;
      it.personIds = it.personIds.includes(id) ? it.personIds.filter((x) => x !== id) : [...it.personIds, id];
      renderItems();
    } else if (e.target.closest('[data-all]') && it) { it.personIds = (state.pool || active()).filter((p) => p.active).map((p) => p.id); renderItems(); }
    else if (e.target.closest('[data-del-item]') && it) { state.items.splice(Number(row.dataset.i), 1); if (!state.items.length) state.items.push(newItem()); renderItems(); }
    else if (e.target.id === 'e-add-item') { state.items.push(newItem()); renderItems(); root.querySelector('.item-row:last-of-type [data-f=name]')?.focus(); }
    else if (e.target.id === 'e-use-items-total') {
      const sum = state.items.reduce((a, x) => { try { return a + toCents(x.amount); } catch { return a; } }, 0);
      $('e-amount').value = (sum / 100).toFixed(2); updateItemsSummary();
    }
  });
}

// ---------------------------------------------------------------- receipt detection
let detectRun = 0;
const untouched = () => !$('e-amount').value && !$('e-desc').value.trim();

function applySuggestion(r) {
  if (r.total) $('e-amount').value = r.total.toFixed(2);
  if (r.date) $('e-date').value = r.date;
  if (r.merchant) $('e-desc').value = r.merchant;
  if (r.category) $('e-category').value = r.category;
  updateValidation();
}

const useAi = () => state.ai && localStorage.getItem('ledger_ai') !== 'off';

async function detectFromReceipt(files) {
  const box = $('e-detect');
  const run = ++detectRun;
  box.classList.remove('hidden');
  const status = (html) => { if (run === detectRun) box.innerHTML = html; };
  status('<span class="spin"></span> Reading receipt…');
  try {
    const results = [];
    let unreadable = 0;
    for (const [i, file] of files.entries()) {
      const label = files.length > 1 ? ` ${i + 1}/${files.length}` : '';
      const stage = (s) => status(`<span class="spin"></span> ${esc(s)}${label}… <small>${esc(file.name)}</small>`);
      let ai = null;
      if (useAi() && !/heic|heif/i.test(`${file.type} ${file.name}`)) {
        stage('Reading with AI');
        try { ai = (await API.analyzeReceiptAi(file)).result; } catch (err) { console.warn('AI reading failed, using local OCR:', err.message); }
        if (run !== detectRun) return;
      }
      if (ai && ai.confidence >= 0.75) { results.push(ai); continue; }
      const r = await analyzeReceipt(file, { categories: state.settings.categories, onStage: stage });
      if (run !== detectRun) return;
      if (r) results.push(r);
      if (ai) results.push(ai);
      if (!r && !ai) unreadable++;
    }
    const r = mergeResults(results);
    if (!r) { status('This file type can’t be read in the browser. It will still be saved. Enter the details manually.'); return; }
    if (!r.total && !r.date && !r.merchant && !(r.items || []).length) { status(`Couldn’t find readable details${unreadable ? '' : ' (try a flatter, brighter photo)'}. It will still be saved. Enter the details manually.`); return; }
    showDetection(r);
  } catch (err) {
    if (run === detectRun) box.textContent = err.message;
  }
}

function showDetection(r) {
  const box = $('e-detect');
  const confident = r.confidence >= 0.6 && r.total;
  const parts = [r.merchant, r.total && money(Math.round(r.total * 100)), r.date && formatDate(r.date)].filter(Boolean).map(esc).join(' · ');
  const hasItems = (r.items || []).length >= 2;
  const mismatch = r.currency && r.currency !== state.settings.currency
    ? `<div class="warn">This receipt looks like <strong>${esc(r.currency)}</strong> but your ledger uses <strong>${esc(state.settings.currency)}</strong>. Convert the amount before saving.</div>` : '';
  const alt = (r.totalCandidates || []).filter((v) => v !== r.total);

  if (confident && untouched()) {
    applySuggestion(r);
    box.innerHTML = `✔ Filled from receipt${r.source === 'ai' ? ' (AI)' : ''}: ${parts}. Please double-check.${r.reconciled ? ' <small>(total matches items/subtotal + tax)</small>' : ''}`;
  } else {
    box.innerHTML = `${confident ? 'Detected' : 'Low confidence, please check'}: ${parts || 'partial details'} <button type="button" class="btn btn-outline btn-sm" id="e-apply">Use these</button>`;
    $('e-apply').onclick = () => { applySuggestion(r); showApplied(); };
  }
  box.insertAdjacentHTML('beforeend', mismatch);
  if (alt.length) {
    box.insertAdjacentHTML('beforeend', `<div class="alts">Other amounts found: ${alt.map((v) => `<button type="button" class="chip" data-alt="${v}">${esc(money(Math.round(v * 100)))}</button>`).join('')}</div>`);
    box.querySelectorAll('[data-alt]').forEach((b) => { b.onclick = () => { $('e-amount').value = Number(b.dataset.alt).toFixed(2); updateValidation(); }; });
  }
  if (hasItems) {
    box.insertAdjacentHTML('beforeend', `<div class="alts">${r.items.length} line items found <button type="button" class="btn btn-outline btn-sm" id="e-use-items">Split item by item</button></div>`);
    $('e-use-items').onclick = () => {
      applySuggestion(r);
      state.items = r.items.map((it) => newItem(it.name, it.amount.toFixed(2)));
      $('e-method').value = 'items';
      renderRows();
      showApplied('Items loaded. Tap names to assign who shared each one.');
    };
  }
}

function showApplied(msg = '✔ Applied. Please double-check.') { $('e-detect').innerHTML = msg; }

// ---------------------------------------------------------------- settle modal
let settlePicker;

function openSettle(prefill = {}, expense = null) {
  if (active().length < 2) { toast('You need at least two roommates to record a payment.', 'warning'); switchTab('people'); return; }
  state.settleEditing = expense;
  $('settle-title').textContent = expense ? 'Edit payment' : 'Record a payment';
  const involved = new Set(expense ? [expense.paidBy[0].personId, expense.splits[0].personId] : []);
  const pool = state.people.filter((p) => p.active || involved.has(p.id));
  const opts = (sel) => pool.map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}${p.id === state.me ? ' (you)' : ''}</option>`).join('');
  const from = expense?.paidBy[0].personId || prefill.from || state.me;
  const to = expense?.splits[0].personId || prefill.to || pool.find((p) => p.id !== from)?.id;
  $('s-from').innerHTML = opts(from);
  $('s-to').innerHTML = opts(to);
  $('s-amount').value = expense ? expense.amountCents / 100 : prefill.amount ? prefill.amount / 100 : '';
  $('s-date').value = expense?.date || todayISO();
  $('s-notes').value = expense?.notes || '';
  $('s-error').classList.add('hidden');
  settlePicker.reset(expense?.receipts || [], expense?.id || null);
  settlePicker.onRemoveExisting = () => { renderTab(); };
  disposePaste = settlePicker.listenForPaste($('settle-modal'));
  openModal('settle-modal');
}

async function submitSettle(e) {
  e.preventDefault();
  const btn = $('s-submit');
  btn.disabled = true;
  $('s-error').classList.add('hidden');
  try {
    const { expense } = await API.saveExpense(state.settleEditing?.id, {
      type: 'settlement', from: $('s-from').value, to: $('s-to').value,
      amount: $('s-amount').value, date: $('s-date').value, notes: $('s-notes').value,
      description: state.settleEditing?.description || 'Settlement',
    });
    if (settlePicker.files.length) {
      try { await API.uploadReceipts(expense.id, settlePicker.files); } catch (upErr) { toast(`Saved, but proof failed to upload: ${upErr.message}`, 'warning'); }
    }
    closeModals();
    toast('Payment recorded.');
    await refresh();
  } catch (ex) {
    $('s-error').textContent = ex.message;
    $('s-error').classList.remove('hidden');
  } finally { btn.disabled = false; }
}

// ---------------------------------------------------------------- events
function bind() {
  expensePicker = new ReceiptPicker($('e-receipts'));
  expensePicker.onAdded = detectFromReceipt;
  settlePicker = new ReceiptPicker($('s-receipts'));

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a, [data-toggle]');
    if (!t) return;
    const d = t.dataset;
    if (d.goto) { e.preventDefault(); switchTab(d.goto); }
    else if (d.action === 'add-expense') openExpense();
    else if (d.action === 'settle') openSettle();
    else if (d.settleFrom) openSettle({ from: d.settleFrom, to: d.settleTo, amount: Number(d.settleAmount) });
    else if (d.close !== undefined) closeModals();
    else if (d.edit) {
      const ex = state.expenses.find((x) => x.id === d.edit);
      if (ex) ex.type === 'settlement' ? openSettle({}, ex) : openExpense(ex);
    } else if (d.delete) {
      if (!confirm('Delete this entry and its receipts? This cannot be undone.')) return;
      try { await API.deleteExpense(d.delete); toast('Deleted.'); await refresh(); } catch (err) { toast(err.message, 'error'); }
    } else if (d.rename) {
      const p = state.people.find((x) => x.id === d.rename);
      const name = prompt('Name', p.name);
      if (name && name.trim() !== p.name) await mutatePerson(() => API.updatePerson(p.id, { name }));
    } else if (d.removePerson) {
      const p = state.people.find((x) => x.id === d.removePerson);
      if (confirm(`Remove ${p.name}? If they have past expenses they are archived so history stays correct.`)) await mutatePerson(() => API.removePerson(p.id));
    } else if (d.restore) await mutatePerson(() => API.updatePerson(d.restore, { active: true }));
    else if (t.closest('[data-toggle]') && !t.closest('.expense-actions')) t.closest('.expense-card-wrapper').classList.toggle('expanded');
  });

  $('nav').addEventListener('click', (e) => { const b = e.target.closest('.nav-item'); if (b) switchTab(b.dataset.tab); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });
  document.querySelectorAll('.modal-backdrop').forEach((m) => m.addEventListener('mousedown', (e) => { if (e.target === m) closeModals(); }));

  $('me-select').onchange = (e) => { state.me = e.target.value; localStorage.setItem('ledger_me', state.me); renderTab(); };

  $('expense-form').onsubmit = submitExpense;
  $('settle-form').onsubmit = submitSettle;
  $('e-method').onchange = renderRows;
  bindItems();
  $('e-multi-payer').onchange = renderRows;
  $('e-amount').oninput = updateValidation;
  $('e-participants').addEventListener('input', updateValidation);
  $('e-participants').addEventListener('change', (e) => { if (e.target.dataset.f === 'included') renderRows(); else updateValidation(); });

  const reload = () => { state.page = 0; renderExpenses().then(icons).catch((err) => toast(err.message, 'error')); };
  $('f-search').oninput = debounce((e) => { state.filters.search = e.target.value; reload(); });
  $('f-person').onchange = (e) => { state.filters.person = e.target.value; reload(); };
  $('f-category').onchange = (e) => { state.filters.category = e.target.value; reload(); };
  $('f-month').onchange = (e) => { state.filters.month = e.target.value; reload(); };
  $('f-clear').onclick = () => {
    state.filters = { search: '', person: '', category: '', month: '' };
    ['f-search', 'f-person', 'f-category', 'f-month'].forEach((id) => { $(id).value = ''; });
    reload();
  };
  $('prev').onclick = () => { state.page--; renderTab(); };
  $('next').onclick = () => { state.page++; renderTab(); };

  $('person-form').onsubmit = async (e) => {
    e.preventDefault();
    await mutatePerson(() => API.addPerson({ name: $('p-name').value, email: $('p-email').value }));
    $('person-form').reset();
  };
  bindSplitwise();
  $('ai-toggle').checked = localStorage.getItem('ledger_ai') !== 'off';
  $('ai-toggle').onchange = (e) => localStorage.setItem('ledger_ai', e.target.checked ? 'on' : 'off');
  $('settings-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await API.saveSettings({ householdName: $('s-name').value, currency: $('s-currency').value });
      toast('Settings saved.');
      await refresh();
    } catch (err) { toast(err.message, 'error'); }
  };
}

function bindSplitwise() {
  const box = $('sw-status');
  const show = (html) => { box.classList.remove('hidden'); box.innerHTML = html; };
  const storeKey = () => {
    const v = $('sw-key').value.trim();
    try { v ? localStorage.setItem('splitwise_token', v) : null; } catch { /* storage blocked: key is just not remembered */ }
  };
  try { $('sw-key').value = localStorage.getItem('splitwise_token') || ''; } catch { /* ignore */ }
  const busy = (on) => ['sw-test', 'sw-import'].forEach((id) => { $(id).disabled = on; });

  $('sw-test').onclick = async () => {
    storeKey(); busy(true); show('<span class="spin"></span> Checking…');
    try {
      const s = await API.splitwiseStatus();
      if (!s.configured) show('No key entered yet.');
      else if (s.connected) show(`✔ Connected as ${esc(s.user.name)}${s.serverKey ? ' (server key)' : ''}.`);
      else show(`✖ ${esc(s.error)}`);
    } catch (err) { show(`✖ ${esc(err.message)}`); } finally { busy(false); }
  };
  $('sw-import').onclick = async () => {
    storeKey(); busy(true); show('<span class="spin"></span> Importing…');
    try {
      const { summary: s } = await API.splitwiseImport();
      const skipped = Object.entries(s.skipped).map(([k, v]) => `${v} skipped (${esc(k)})`).join(', ');
      show(`✔ Imported ${s.added} new, ${s.updated} updated, ${s.unchanged} unchanged, ${s.removed} removed${s.peopleAdded ? `; ${s.peopleAdded} people added` : ''}${skipped ? `. ${skipped}` : ''}.`);
      await refresh();
    } catch (err) { show(`✖ ${esc(err.message)} Your ledger is unaffected.`); } finally { busy(false); }
  };
  $('sw-forget').onclick = () => {
    try { localStorage.removeItem('splitwise_token'); } catch { /* ignore */ }
    $('sw-key').value = '';
    show('Key removed from this browser.');
  };
}

async function mutatePerson(fn) {
  try { await fn(); await refresh(); } catch (err) { toast(err.message, 'error'); }
}

bind();
load().then(renderTab).catch((err) => toast(err.message, 'error'));
