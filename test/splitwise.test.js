import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { mapExpense } from '../src/splitwise.js';

const u = (id, first, paid, owed) => ({ user_id: id, user: { id, first_name: first, last_name: 'X' }, paid_share: paid, owed_share: owed });
const SW_EXPENSES = [
  { id: 1, description: 'Rent', cost: '1000.00', currency_code: 'USD', date: '2026-09-01T00:00:00Z', updated_at: 'v1', payment: false, deleted_at: null, users: [u(10, 'Me', '1000.00', '500.00'), u(11, 'Bob', '0.00', '500.00')] },
  { id: 2, description: 'Settle', cost: '200.00', currency_code: 'USD', date: '2026-09-05T00:00:00Z', updated_at: 'v1', payment: true, deleted_at: null, users: [u(11, 'Bob', '200.00', '0.00'), u(10, 'Me', '0.00', '200.00')] },
  { id: 3, description: 'Euro trip', cost: '50.00', currency_code: 'EUR', date: '2026-09-06T00:00:00Z', updated_at: 'v1', payment: false, deleted_at: null, users: [u(10, 'Me', '50.00', '50.00')] },
  { id: 4, description: 'Broken', cost: '10.00', currency_code: 'USD', date: '2026-09-07T00:00:00Z', updated_at: 'v1', payment: false, deleted_at: null, users: [u(10, 'Me', '10.00', '3.00')] },
  { id: 5, description: 'Gone', cost: '10.00', currency_code: 'USD', date: '2026-09-07T00:00:00Z', updated_at: 'v1', payment: false, deleted_at: '2026-09-08T00:00:00Z', users: [u(10, 'Me', '10.00', '10.00')] },
];

const mockFetch = (state) => async (url) => {
  const p = new URL(url).pathname;
  if (state.status) return new Response('{}', { status: state.status });
  if (state.offline) throw new TypeError('fetch failed');
  if (p.endsWith('get_current_user')) return Response.json({ user: { id: 10, first_name: 'Me', last_name: 'X' } });
  if (p.endsWith('get_expenses')) return Response.json({ expenses: state.expenses });
  return new Response('{}', { status: 404 });
};

test('mapExpense validates shares and currency', () => {
  const pf = (x) => `p${x.id}`;
  assert.equal(mapExpense(SW_EXPENSES[0], 'USD', pf).entry.amountCents, 100000);
  assert.equal(mapExpense(SW_EXPENSES[1], 'USD', pf).entry.type, 'settlement');
  assert.match(mapExpense(SW_EXPENSES[2], 'USD', pf).skip, /EUR/);
  assert.match(mapExpense(SW_EXPENSES[3], 'USD', pf).skip, /add up/);
  assert.equal(mapExpense(SW_EXPENSES[4], 'USD', pf).skip, 'deleted');
});

test('import is idempotent, updates changes, and failures never break the app', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-'));
  const state = { expenses: structuredClone(SW_EXPENSES) };
  const app = await createApp({ dataDir: dir, fetchImpl: mockFetch(state) });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const hdr = { 'X-Splitwise-Token': 'abc', 'Content-Type': 'application/json' };
  const post = () => fetch(`${base}/api/splitwise/import`, { method: 'POST', headers: hdr }).then(async (r) => ({ status: r.status, ...(await r.json()) }));

  // no key -> clear 400, status says not configured
  assert.equal((await fetch(`${base}/api/splitwise/import`, { method: 'POST' })).status, 400);
  assert.equal((await (await fetch(`${base}/api/splitwise/status`)).json()).configured, false);

  let r = await post();
  assert.equal(r.summary.added, 2);
  assert.equal(r.summary.peopleAdded, 2);
  assert.equal(r.summary.skipped['shares do not add up'], 1);

  r = await post();
  assert.equal(r.summary.added, 0);
  assert.equal(r.summary.unchanged, 2);

  state.expenses[0].updated_at = 'v2';
  state.expenses[0].description = 'Rent (edited)';
  state.expenses[1].deleted_at = '2026-09-09T00:00:00Z';
  r = await post();
  assert.equal(r.summary.updated, 1);
  assert.equal(r.summary.removed, 1);

  // balances computed locally from imported data
  const bal = await (await fetch(`${base}/api/balances`)).json();
  assert.equal(Object.values(bal.net).reduce((a, b) => a + b, 0), 0);

  // upstream failures are reported, not thrown
  state.status = 403;
  r = await post();
  assert.equal(r.status, 502);
  assert.match(r.message, /Pro/);
  const st = await (await fetch(`${base}/api/splitwise/status`, { headers: hdr })).json();
  assert.equal(st.connected, false);
  state.status = 0; state.offline = true;
  assert.match((await post()).message, /internet/);

  // local features still fine
  assert.equal((await fetch(`${base}/api/expenses`)).status, 200);
  server.close();
  await fs.rm(dir, { recursive: true, force: true });
});
