import { API } from './api.js';
import { ReceiptPicker } from './receipts.js';
import { analyzeReceipt, mergeResults } from './ocr.js';
import { computeItemSplits, toCents } from '/shared/money.js';
import { esc, money, setCurrency, currencySymbol, todayISO, formatDate, icons, ic, avatar, categoryEmoji, dayLabel, toast, debounce } from './util.js';

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
  items: [], // item rows: {name, qty, unit, total, personIds}
  charges: [], // tax / tip / fee / discount rows: {kind, label, amount, mode}
  totalAuto: true, // in item mode the total follows items + charges until the user types one
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
    else if (state.tab === 'settings') await renderRecurring();
  } catch (err) { toast(err.message, 'error'); }
  icons();
}

// ---------------------------------------------------------------- dashboard
async function renderDashboard() {
  const people = active();
  const me = state.people.find((p) => p.id === state.me);
  $('onboarding').classList.toggle('hidden', people.length >= 2);
  if (people.length < 2) {
    $('onboarding').innerHTML = `<h3 class="card-title">${ic('sparkles')} Let’s get you set up</h3>
      <ol><li>Add everyone who shares expenses (including you) on the <a href="#" data-goto="people">Roommates</a> tab.</li>
      <li>Pick who you are in the top-right “Viewing as” menu.</li>
      <li>Tap <strong>Scan receipt</strong> or <strong>Add expense</strong>. No account or Splitwise needed.</li></ol>`;
  }
  const [bal, recent, all] = await Promise.all([API.balances(), API.expenses({ limit: 6 }), API.expenses({ limit: 200 })]);
  const mine = bal.net[state.me] || 0;
  const owe = bal.transfers.filter((t) => t.from === state.me).reduce((a, t) => a + t.cents, 0);
  const owed = bal.transfers.filter((t) => t.to === state.me).reduce((a, t) => a + t.cents, 0);
  const hour = new Date().getHours();
  $('hello').textContent = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}${me ? `, ${me.name.split(' ')[0]}` : ''}`;
  $('m-net').textContent = mine === 0 ? 'All settled up' : money(Math.abs(mine));
  $('m-net-desc').textContent = mine > 0 ? 'in total, others owe you' : mine < 0 ? 'in total, you owe others' : 'Nobody owes anybody anything 🎉';
  $('m-owe').textContent = money(owe);
  $('m-owed').textContent = money(owed);

  $('transfers').innerHTML = bal.transfers.length
    ? bal.transfers.map((t) => `<div class="transfer ${t.from === state.me ? 'mine' : ''}">
        <div class="who">${avatar(nameOf(t.from), 'sm')}<span><strong>${esc(youOr(t.from))}</strong> ${t.from === state.me ? 'pay' : 'pays'} <strong>${esc(youOr(t.to))}</strong></span></div>
        <span class="amt">${money(t.cents)}</span>
        <button class="btn btn-soft btn-sm" data-settle-from="${esc(t.from)}" data-settle-to="${esc(t.to)}" data-settle-amount="${t.cents}">Record payment</button>
      </div>`).join('')
    : `<div class="empty"><strong>Everyone is settled up</strong>New expenses will show up here.</div>`;

  $('balances').innerHTML = people.map((p) => {
    const v = bal.net[p.id] || 0;
    return `<div class="line">${avatar(p.name)}<div class="grow"><strong>${esc(youOr(p.id))}</strong></div><span class="amt ${v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted'}">${v === 0 ? 'settled' : v > 0 ? `gets back ${money(v)}` : `owes ${money(-v)}`}</span></div>`;
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
  $('cat-range').textContent = `· ${new Date().toLocaleDateString(undefined, { month: 'long' })}`;
  $('categories').innerHTML = rows.map(([c, v]) => `<div class="bar-row"><span>${categoryEmoji(c)} ${esc(c)}</span><div class="bar"><i style="width:${(v / max) * 100}%"></i></div><span class="amt">${money(v)}</span></div>`).join('') || '<p class="muted">Nothing recorded this month yet.</p>';

  $('recent').innerHTML = recent.expenses.map((e) => {
    const inv = involvement(e);
    return `<div class="line"><span class="exp-icon">${categoryEmoji(e.category)}</span><div class="grow"><strong>${esc(e.description)}</strong><div class="sub">${formatDate(e.date)}</div></div><div style="text-align:right"><div class="amt">${money(e.amountCents)}</div><div class="sub ${inv.cls}">${esc(inv.text)}</div></div></div>`;
  }).join('') || `<div class="empty"><strong>No activity yet</strong><button class="btn btn-primary" data-action="scan">${ic('camera')} Scan your first receipt</button></div>`;
}

function involvement(e) {
  const paid = e.paidBy.find((p) => p.personId === state.me)?.cents || 0;
  const owed = e.splits.find((s) => s.personId === state.me)?.cents || 0;
  if (e.type === 'settlement') {
    if (paid) return { text: `you paid ${nameOf(e.splits[0].personId)}`, cls: 'pos' };
    if (owed) return { text: `${nameOf(e.paidBy[0].personId)} paid you`, cls: 'pos' };
    return { text: 'not involved', cls: '' };
  }
  const net = paid - owed;
  if (!paid && !owed) return { text: 'not involved', cls: '' };
  if (net > 0) return { text: `you lent ${money(net)}`, cls: 'pos' };
  if (net < 0) return { text: `you owe ${money(-net)}`, cls: 'neg' };
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
  $('page-info').textContent = data.total ? `Page ${state.page + 1} of ${pages} · ${data.total} entr${data.total === 1 ? 'y' : 'ies'}` : '';
  $('prev').disabled = state.page === 0;
  $('next').disabled = state.page + 1 >= pages;
  $('prev').parentElement.classList.toggle('hidden', pages <= 1);
  const filtered = Object.values(state.filters).some(Boolean);
  if (!data.expenses.length) {
    $('expense-list').innerHTML = filtered
      ? `<div class="card empty"><strong>No entries match</strong>Try clearing the filters.</div>`
      : `<div class="card empty"><strong>No expenses yet</strong>Snap a receipt and we’ll fill in the details for you.<br><button class="btn btn-primary" data-action="scan">${ic('camera')} Scan receipt</button></div>`;
    return undefined;
  }
  let html = '';
  let lastDay = '';
  for (const e of data.expenses) {
    if (e.date !== lastDay) { html += `<div class="day-head">${esc(dayLabel(e.date))}</div>`; lastDay = e.date; }
    html += expenseCard(e);
  }
  $('expense-list').innerHTML = html;
  return undefined;
}

function expenseCard(e) {
  const inv = involvement(e);
  const payers = e.paidBy.map((p) => youOr(p.personId)).join(' & ');
  const splits = e.splits.map((s) => `<div class="split-line"><span>${avatar(nameOf(s.personId), 'sm')} ${esc(youOr(s.personId))}</span><span>${e.type === 'settlement' ? 'received' : 'owes'} ${money(s.cents)}</span></div>`).join('');
  const receipts = (e.receipts || []).map((r) => `<a class="receipt-mini" href="${API.receiptUrl(r.file)}" target="_blank" rel="noopener" title="${esc(r.name)}">${r.mime.startsWith('image/') && r.mime !== 'image/heic' ? `<img src="${API.receiptUrl(r.file)}" alt="${esc(r.name)}" loading="lazy">` : `<span>${r.mime === 'application/pdf' ? 'PDF' : 'IMG'}</span>`}</a>`).join('');
  const chargeLine = (label, cents, note = '') => `<div class="split-line"><span>${esc(label)}${note ? ` <span class="muted">· ${esc(note)}</span>` : ''}</span><span>${cents < 0 ? '−' : ''}${money(Math.abs(cents))}</span></div>`;
  const itemsHtml = e.items?.length ? `<div class="items-detail">
      ${e.items.map((it) => `<div class="split-line"><span>${it.quantity > 1 ? `${esc(it.quantity)} × ` : ''}${esc(it.name || 'Item')} <span class="muted">· ${esc(it.personIds.length === e.splits.length && e.splits.every((x) => it.personIds.includes(x.personId)) ? 'everyone' : it.personIds.map(youOr).join(', '))}</span></span><span>${money(it.cents)}</span></div>`).join('')}
      ${(e.charges || []).map((c) => chargeLine(c.label, c.cents, c.mode === 'equal' ? 'split equally' : 'by items')).join('')}
      ${e.charges ? (e.otherCents ? chargeLine('Other / rounding', e.otherCents) : '') : (e.extraCents ? chargeLine('Tax, tip & fees', e.extraCents) : '')}
    </div>` : '';
  const repeat = e.source === 'recurring' ? ` <span class="clip" title="Recurring">${ic('repeat', 'sm')}</span>` : '';
  return `<div class="exp" data-id="${esc(e.id)}">
    <div class="exp-main" data-toggle>
      <span class="exp-icon">${categoryEmoji(e.category)}</span>
      <div class="exp-body">
        <div class="exp-title"><span class="t">${esc(e.description)}</span>${repeat}${(e.receipts || []).length ? `<span class="clip" title="${e.receipts.length} receipt(s)">${ic('clip', 'sm')}${e.receipts.length}</span>` : ''}</div>
        <div class="exp-meta">${esc(e.category)} · paid by ${esc(payers)}</div>
      </div>
      <div class="exp-right"><div class="amt">${money(e.amountCents)}</div><div class="exp-sub ${inv.cls}">${esc(inv.text)}</div></div>
      <div class="exp-actions">
        <button title="Edit" aria-label="Edit" data-edit="${esc(e.id)}">${ic('pencil', 'sm')}</button>
        <button class="del" title="Delete" aria-label="Delete" data-delete="${esc(e.id)}">${ic('trash', 'sm')}</button>
      </div>
    </div>
    <div class="exp-detail">
      ${itemsHtml}
      ${splits}
      ${e.notes ? `<p class="notes">${esc(e.notes)}</p>` : ''}
      ${receipts ? `<div class="receipt-strip">${receipts}</div>` : ''}
    </div>
  </div>`;
}

// ---------------------------------------------------------------- people
function renderPeople() {
  $('people-grid').innerHTML = state.people.map((p) => `<div class="person-card ${p.active ? '' : 'archived'}">
    ${avatar(p.name, 'lg')}
    <div class="info">
      <strong>${esc(p.name)} ${p.id === state.me ? '<span class="badge">you</span>' : ''} ${p.active ? '' : '<span class="badge">archived</span>'}</strong>
      <span class="muted">${esc(p.email || '')}</span>
      <div class="person-actions">
        <button class="btn btn-ghost btn-sm" data-rename="${esc(p.id)}">Rename</button>
        ${p.active ? `<button class="btn btn-ghost btn-sm" data-remove-person="${esc(p.id)}">Remove</button>` : `<button class="btn btn-ghost btn-sm" data-restore="${esc(p.id)}">Restore</button>`}
      </div>
    </div></div>`).join('') || `<div class="card empty" style="grid-column:1/-1"><strong>No roommates yet</strong>Add the first one above (don’t forget yourself).</div>`;
}

// ---------------------------------------------------------------- recurring bills
async function renderRecurring() {
  const { rules } = await API.recurring();
  $('rec-list').innerHTML = rules.map((r) => `<div class="line">
      <span class="exp-icon">${categoryEmoji(r.template.category)}</span>
      <div class="grow"><strong>${esc(r.template.description)}</strong> · ${money(Math.round(Number(r.template.amount) * 100))}
      <div class="sub">day ${r.day} · ${r.active ? `next: ${formatDate(r.nextDue)}` : 'paused'}${r.lastError ? ` · <span class="neg">${esc(r.lastError)}</span>` : ''}</div></div>
      <button class="btn btn-ghost btn-sm" data-rec-toggle="${esc(r.id)}" data-active="${r.active}">${r.active ? 'Pause' : 'Resume'}</button>
      <button class="btn btn-ghost btn-sm" data-rec-del="${esc(r.id)}">Delete</button>
    </div>`).join('') || '<p class="muted" style="margin:0">No recurring bills yet.</p>';
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
  $('e-cur').textContent = currencySymbol();
  $('e-error').classList.add('hidden');
  $('e-repeat').checked = false;
  $('e-repeat-row').classList.toggle('hidden', !!expense);
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
  state.pool = pool;
  state.totalAuto = !expense;
  state.items = [];
  state.charges = [];
  if (expense?.splitMethod === 'items' && expense.items) {
    state.items = expense.items.map((it) => newItem(it.name, it.cents / 100, it.quantity || 1, [...it.personIds]));
    state.charges = (expense.charges || []).map((c) => newCharge(c.kind, c.label, Math.abs(c.cents) / 100, c.mode));
    // Entries saved before charges were itemised carried one combined "extra" amount.
    if (!expense.charges && expense.extraCents) state.charges.push(newCharge(expense.extraCents > 0 ? 'fee' : 'discount', 'Tax, tip & fees', Math.abs(expense.extraCents) / 100));
  }
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
  document.querySelectorAll('#e-method-seg button').forEach((b) => b.classList.toggle('on', b.dataset.method === method));
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
      <label class="check"><input type="checkbox" data-f="included" ${r.included ? 'checked' : ''}> ${avatar(r.name, 'sm')} ${esc(r.name)}</label>
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
      items: state.items.map((it) => ({ name: it.name, quantity: Number(it.qty) || 1, amount: it.total, personIds: it.personIds })),
      charges: state.charges.map((c) => ({ kind: c.kind, label: c.label, amount: c.amount, mode: c.mode })),
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
    const payload = buildExpensePayload();
    const { expense } = await API.saveExpense(state.editing?.id, payload);
    if (!state.editing && $('e-repeat').checked) {
      try {
        const { date, ...template } = payload;
        const d = new Date(`${date}T00:00:00Z`);
        const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
        await API.addRecurring({ ...template, day: Math.min(d.getUTCDate(), 28), startMonth: next });
        toast('Will repeat monthly.');
      } catch (recErr) { toast(`Saved, but couldn't set up repeating: ${recErr.message}`, 'warning'); }
    }
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
// Row: quantity x unit price = line total. The line total is what gets split; editing
// quantity or unit price recalculates it, editing the total recalculates the unit price.
const everyone = () => (state.pool || active()).filter((p) => p.active).map((p) => p.id);
const newItem = (name = '', total = '', qty = 1, personIds = null) => {
  const t = total === '' ? '' : Number(total);
  return { name, qty: String(qty), unit: t === '' ? '' : fmtUnit(t / (Number(qty) || 1)), total: t === '' ? '' : t.toFixed(2), personIds: personIds || everyone() };
};
const fmtUnit = (n) => (Math.abs(n * 100 - Math.round(n * 100)) < 1e-6 ? n.toFixed(2) : n.toFixed(3));
const KINDS = { tax: 'Tax', tip: 'Tip / gratuity', fee: 'Service / delivery fee', discount: 'Discount / coupon' };
const DEFAULT_LABEL = { tax: 'Sales tax', tip: 'Tip', fee: 'Service charge', discount: 'Discount' };
const newCharge = (kind, label, amount = '', mode) => ({ kind, label: label || DEFAULT_LABEL[kind], amount: amount === '' ? '' : Number(amount).toFixed(2), mode: mode || (kind === 'tip' ? 'equal' : 'proportional') });

const centsOrNull = (v) => { try { return v === '' ? null : toCents(v); } catch { return null; } };
const itemsCents = () => state.items.reduce((a, it) => a + (centsOrNull(it.total) || 0), 0);
const signedCharges = () => state.charges.map((c) => ({ kind: c.kind, label: c.label, cents: (c.kind === 'discount' ? -1 : 1) * (centsOrNull(c.amount) || 0), mode: c.mode }));
const chargesCents = () => signedCharges().reduce((a, c) => a + c.cents, 0);

function sharedLabel(it) {
  const pool = (state.pool || active()).filter((p) => p.active);
  if (it.personIds.length === 0) return { text: 'Nobody. Tap a name to assign it', bad: true };
  if (it.personIds.length === pool.length && pool.every((p) => it.personIds.includes(p.id))) return { text: 'Everyone, split equally', bad: false };
  const names = it.personIds.map((id) => nameOf(id));
  return { text: `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}${names.length > 1 ? ', split equally' : ' only'}`, bad: false };
}

function renderItems() {
  const pool = state.pool || active();
  $('e-items').innerHTML = `
    <p class="hint">Every item starts <strong>shared by everyone</strong>. Tap a name to give an item to just that person, then tap more names to share it between them.</p>
    <div class="items-head"><span>Item</span><span>Qty</span><span>Unit price</span><span>Total</span><span></span></div>
    ${state.items.map((it, i) => {
      const sl = sharedLabel(it);
      return `<div class="item-row" data-i="${i}">
      <input type="text" data-f="name" value="${esc(it.name)}" maxlength="100" placeholder="Item name" aria-label="Item name">
      <input type="number" data-f="qty" value="${esc(it.qty)}" step="any" min="0" inputmode="decimal" aria-label="Quantity" title="Quantity">
      <input type="number" data-f="unit" value="${esc(it.unit)}" step="0.01" min="0" inputmode="decimal" placeholder="0.00" aria-label="Unit price" title="Price per unit">
      <input type="number" data-f="total" value="${esc(it.total)}" step="0.01" min="0" inputmode="decimal" placeholder="0.00" aria-label="Line total" title="Line total (qty × unit price)">
      <button type="button" class="receipt-remove" data-del-item aria-label="Remove item">&times;</button>
      <div class="item-share">
        <div class="chips">${pool.map((p) => `<button type="button" class="chip ${it.personIds.includes(p.id) ? 'on' : ''}" data-chip="${esc(p.id)}" aria-pressed="${it.personIds.includes(p.id)}">${it.personIds.includes(p.id) ? '✓ ' : ''}${esc(p.name)}</button>`).join('')}
          <button type="button" class="chip all" data-all>Everyone</button></div>
        <span class="share-text ${sl.bad ? 'bad' : ''}" data-share-text>Shared by: ${esc(sl.text)}</span>
      </div>
    </div>`;
    }).join('')}
    <div class="items-actions"><button type="button" class="btn btn-ghost btn-sm" id="e-add-item">+ Add item</button></div>

    <h4 class="sub-head">Tax, tip &amp; other charges</h4>
    <div id="e-charges">${state.charges.map((c, i) => `<div class="charge-row" data-c="${i}">
      <div class="select"><select data-f="kind" aria-label="Charge type">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${c.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <input type="text" data-f="label" value="${esc(c.label)}" maxlength="60" placeholder="Label" aria-label="Charge label">
      <input type="number" data-f="amount" value="${esc(c.amount)}" step="0.01" min="0" inputmode="decimal" placeholder="0.00" aria-label="Charge amount">
      <div class="select"><select data-f="mode" aria-label="How to split this charge"><option value="proportional" ${c.mode === 'proportional' ? 'selected' : ''}>By what each person ordered</option><option value="equal" ${c.mode === 'equal' ? 'selected' : ''}>Equally</option></select></div>
      <button type="button" class="receipt-remove" data-del-charge aria-label="Remove charge">&times;</button>
      ${c.kind === 'tip' ? `<div class="tip-pct">Tip as % of items: ${[10, 15, 18, 20].map((n) => `<button type="button" class="chip" data-tip-pct="${n}">${n}%</button>`).join('')}</div>` : ''}
    </div>`).join('') || '<p class="muted">No tax, tip or fees added.</p>'}</div>
    <div class="items-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-add-charge="tax">+ Tax</button>
      <button type="button" class="btn btn-ghost btn-sm" data-add-charge="tip">+ Tip</button>
      <button type="button" class="btn btn-ghost btn-sm" data-add-charge="fee">+ Service fee</button>
      <button type="button" class="btn btn-ghost btn-sm" data-add-charge="discount">+ Discount</button>
    </div>
    <div class="items-summary" id="e-items-summary"></div>`;
  updateItemsSummary();
}

function updateItemsSummary() {
  const box = $('e-items-summary');
  if (!box) return;
  const itemsTotal = itemsCents();
  const charges = signedCharges();
  const chargesTotal = chargesCents();
  if (state.totalAuto) $('e-amount').value = itemsTotal + chargesTotal > 0 ? ((itemsTotal + chargesTotal) / 100).toFixed(2) : '';
  const total = Math.round((parseFloat($('e-amount').value) || 0) * 100);
  const other = total - itemsTotal - chargesTotal;
  let bad = state.items.some((it) => !(centsOrNull(it.total) > 0) || it.personIds.length === 0 || !(Number(it.qty) > 0));
  bad = bad || state.charges.some((c) => !(centsOrNull(c.amount) > 0));

  let html = `<div class="sum-line"><span>Items subtotal</span><strong>${money(itemsTotal)}</strong></div>`;
  html += charges.map((c) => `<div class="sum-line"><span>${esc(c.label || KINDS[c.kind])} <small>(${c.mode === 'equal' ? 'equal' : 'by items'})</small></span><strong>${c.cents < 0 ? '−' : '+'}${money(Math.abs(c.cents))}</strong></div>`).join('');
  if (other !== 0 && total > 0) {
    html += `<div class="sum-line warn"><span>Not accounted for (rounding / unlisted charge)<br><small>Shared in proportion. Add it as a charge to be exact.</small></span><strong>${other < 0 ? '−' : '+'}${money(Math.abs(other))}</strong></div>
      <div class="sum-actions"><button type="button" class="btn btn-ghost btn-sm" data-other-to-charge>Add as ${other > 0 ? 'fee' : 'discount'}</button><button type="button" class="btn btn-ghost btn-sm" data-auto-total>Set total to ${money(itemsTotal + chargesTotal)}</button></div>`;
  }
  html += `<div class="sum-line total"><span>Total ${state.totalAuto ? '<small>(calculated)</small>' : ''}</span><strong>${money(total)}</strong></div>`;

  let ok = !bad && total > 0;
  if (ok) {
    try {
      const r = computeItemSplits(total, state.items.map((it) => ({ cents: centsOrNull(it.total), personIds: it.personIds, name: it.name })), charges);
      const order = (id) => state.people.findIndex((p) => p.id === id);
      html += `<div class="sum-people">` + [...r.splits].sort((x, y) => order(x.personId) - order(y.personId)).map((s) => {
        const b = r.breakdown[s.personId];
        const parts = [`items ${money(b.items)}`, ...charges.map((c, i) => (b.charges[i] ? `${c.label || KINDS[c.kind]} ${b.charges[i] < 0 ? '−' : ''}${money(Math.abs(b.charges[i]))}` : '')).filter(Boolean), b.other ? `other ${money(b.other, { sign: true })}` : ''].filter(Boolean);
        return `<div class="sum-person"><div class="sum-line person"><span>${avatar(nameOf(s.personId), 'sm')} ${esc(youOr(s.personId))}</span><strong>${money(s.cents)}</strong></div><div class="sum-detail">${esc(parts.join(' · '))}</div></div>`;
      }).join('') + `</div>`;
    } catch (err) { ok = false; html += `<div class="sum-line err">${esc(err.message)}</div>`; }
  } else if (bad) html += '<div class="sum-line err">Every item needs a quantity, a price and at least one person; every charge needs an amount.</div>';
  $('e-validation').innerHTML = `<span class="val-dot ${ok ? 'dot-success' : 'dot-error'}"></span> ${ok ? 'Looks good' : 'Check the items'}`;
  box.innerHTML = html;
}

function bindItems() {
  const root = $('e-items');
  const recalcRow = (row, it, field) => {
    const q = Number(it.qty) || 0;
    if (field === 'qty' || field === 'unit') {
      const u = Number(it.unit);
      if (it.unit !== '' && q > 0 && Number.isFinite(u)) { it.total = (Math.round(q * u * 100) / 100).toFixed(2); row.querySelector('[data-f=total]').value = it.total; }
    } else if (field === 'total' && q > 0 && it.total !== '') {
      it.unit = fmtUnit(Number(it.total) / q); row.querySelector('[data-f=unit]').value = it.unit;
    }
  };
  root.addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    const row = e.target.closest('.item-row');
    const crow = e.target.closest('.charge-row');
    if (row) {
      const it = state.items[Number(row.dataset.i)];
      it[f] = e.target.value;
      recalcRow(row, it, f);
    } else if (crow) {
      const c = state.charges[Number(crow.dataset.c)];
      c[f] = e.target.value;
      if (f === 'kind') { if (!c.label || Object.values(DEFAULT_LABEL).includes(c.label)) c.label = DEFAULT_LABEL[c.kind]; if (c.kind === 'tip') c.mode = 'equal'; renderItems(); return; }
    }
    updateItemsSummary();
  });
  root.addEventListener('click', (e) => {
    const row = e.target.closest('.item-row');
    const it = row && state.items[Number(row.dataset.i)];
    const crow = e.target.closest('.charge-row');
    const chip = e.target.closest('[data-chip]');
    if (chip && it) {
      const id = chip.dataset.chip;
      const all = everyone();
      const allOn = all.every((x) => it.personIds.includes(x)) && it.personIds.length === all.length;
      // From "everyone", tapping a name means "just this person"; otherwise toggle membership.
      it.personIds = allOn ? [id] : it.personIds.includes(id) ? it.personIds.filter((x) => x !== id) : [...it.personIds, id];
      renderItems();
    } else if (e.target.closest('[data-all]') && it) { it.personIds = everyone(); renderItems(); }
    else if (e.target.closest('[data-del-item]') && it) { state.items.splice(Number(row.dataset.i), 1); if (!state.items.length) state.items.push(newItem()); renderItems(); }
    else if (e.target.id === 'e-add-item') { state.items.push(newItem()); renderItems(); root.querySelector('.item-row:last-of-type [data-f=name]')?.focus(); }
    else if (e.target.closest('[data-del-charge]') && crow) { state.charges.splice(Number(crow.dataset.c), 1); renderItems(); }
    else if (e.target.closest('[data-add-charge]')) { state.charges.push(newCharge(e.target.closest('[data-add-charge]').dataset.addCharge)); renderItems(); root.querySelector('.charge-row:last-of-type [data-f=amount]')?.focus(); }
    else if (e.target.closest('[data-tip-pct]') && crow) {
      const c = state.charges[Number(crow.dataset.c)];
      c.amount = ((itemsCents() * Number(e.target.closest('[data-tip-pct]').dataset.tipPct)) / 100 / 100).toFixed(2);
      renderItems();
    } else if (e.target.closest('[data-other-to-charge]')) {
      const other = Math.round((parseFloat($('e-amount').value) || 0) * 100) - itemsCents() - chargesCents();
      state.charges.push(newCharge(other > 0 ? 'fee' : 'discount', other > 0 ? 'Other charges' : 'Adjustment', Math.abs(other) / 100));
      renderItems();
    } else if (e.target.closest('[data-auto-total]')) { state.totalAuto = true; updateItemsSummary(); }
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
    box.innerHTML = `${confident ? 'Detected' : 'Low confidence, please check'}: ${parts || 'partial details'} <button type="button" class="btn btn-ghost btn-sm" id="e-apply">Use these</button>`;
    $('e-apply').onclick = () => { applySuggestion(r); showApplied(); };
  }
  box.insertAdjacentHTML('beforeend', mismatch);
  if (alt.length) {
    box.insertAdjacentHTML('beforeend', `<div class="alts">Other amounts found: ${alt.map((v) => `<button type="button" class="chip" data-alt="${v}">${esc(money(Math.round(v * 100)))}</button>`).join('')}</div>`);
    box.querySelectorAll('[data-alt]').forEach((b) => { b.onclick = () => { $('e-amount').value = Number(b.dataset.alt).toFixed(2); updateValidation(); }; });
  }
  if (hasItems) {
    box.insertAdjacentHTML('beforeend', `<div class="alts">${r.items.length} line items found <button type="button" class="btn btn-ghost btn-sm" id="e-use-items">Split item by item</button></div>`);
    $('e-use-items').onclick = () => {
      applySuggestion(r);
      state.items = r.items.map((it) => newItem(it.name, it.amount, it.quantity || 1));
      state.charges = (r.charges || []).map((c) => newCharge(c.kind, c.label, c.amount, c.mode));
      state.totalAuto = !r.total;
      $('e-method').value = 'items';
      renderRows();
      const n = state.charges.length;
      showApplied(`Loaded ${state.items.length} items${n ? ` and ${n} charge${n > 1 ? 's' : ''}` : ''}. Everyone is selected on each item: tap names to change who shared it.`);
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
  expensePicker = new ReceiptPicker($('e-receipts'), { title: 'Start with a receipt', hint: 'Drop it here, paste (Ctrl/⌘+V) or browse. We’ll read it and fill in the details for you.' });
  expensePicker.onAdded = detectFromReceipt;
  expensePicker.onDuplicate = (file, d) => toast(`"${file.name}" is already attached to "${d.description}" (${formatDate(d.date)}, ${money(d.amountCents)}). Is this a duplicate?`, 'warning');
  settlePicker = new ReceiptPicker($('s-receipts'), { title: 'Attach proof of payment', hint: 'A screenshot of the transfer, or a photo of the note.' });
  settlePicker.onDuplicate = expensePicker.onDuplicate;

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a, [data-toggle]');
    if (!t) return;
    const d = t.dataset;
    if (d.goto) { e.preventDefault(); switchTab(d.goto); }
    else if (d.action === 'add-expense') openExpense();
    else if (d.action === 'scan') { openExpense(); expensePicker.browse(); }
    else if (t.classList.contains('nav-item')) switchTab(d.tab);
    else if (d.method) { $('e-method').value = d.method; renderRows(); }
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
    else if (d.recToggle) { try { await API.updateRecurring(d.recToggle, { active: d.active !== 'true' }); await renderRecurring(); } catch (err) { toast(err.message, 'error'); } }
    else if (d.recDel) { if (confirm('Stop this recurring bill? Entries already created are kept.')) { try { await API.deleteRecurring(d.recDel); await renderRecurring(); } catch (err) { toast(err.message, 'error'); } } }
    else if (t.closest('[data-toggle]') && !t.closest('.exp-actions')) t.closest('.exp').classList.toggle('expanded');
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });
  document.querySelectorAll('.modal-backdrop').forEach((m) => m.addEventListener('mousedown', (e) => { if (e.target === m) closeModals(); }));

  bindGlobalReceiptInput();
  bindTheme();

  $('me-select').onchange = (e) => { state.me = e.target.value; localStorage.setItem('ledger_me', state.me); renderTab(); };

  $('expense-form').onsubmit = submitExpense;
  $('settle-form').onsubmit = submitSettle;
  $('e-method').onchange = renderRows;
  bindItems();
  $('e-multi-payer').onchange = renderRows;
  $('e-amount').oninput = () => { state.totalAuto = false; updateValidation(); };
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

// Drop a file anywhere on the page, or paste a screenshot anywhere, to start a new expense from it.
function bindGlobalReceiptInput() {
  const overlay = $('drop-overlay');
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const route = (files) => {
    if (!files.length) return;
    if (!$('settle-modal').classList.contains('hidden')) { settlePicker.add(files); return; }
    if ($('expense-modal').classList.contains('hidden')) openExpense();
    if (!$('expense-modal').classList.contains('hidden')) expensePicker.add(files);
  };
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; overlay.classList.remove('hidden'); } });
  window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; overlay.classList.add('hidden'); } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; overlay.classList.add('hidden');
    route([...e.dataTransfer.files]);
  });
  document.addEventListener('paste', (e) => {
    if (document.body.classList.contains('modal-open')) return; // the open modal handles its own paste
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); route(files); }
  });
}

function bindTheme() {
  const btn = $('theme-toggle');
  const dark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  const paint = () => { btn.innerHTML = ic(dark() ? 'sun' : 'moon'); };
  btn.onclick = () => {
    const next = dark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('ledger_theme', next); } catch { /* ignore */ }
    paint();
  };
  paint();
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
