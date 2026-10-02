import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

let server, base, dir;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ledger-'));
  const app = await createApp({ dataDir: dir });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await fs.rm(dir, { recursive: true, force: true });
});

const call = async (method, url, body) => {
  const res = await fetch(base + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

test('full ledger flow: people, expenses, balances, settlement, delete', async () => {
  const ids = {};
  for (const name of ['Asha', 'Ben', 'Chen']) {
    const r = await call('POST', '/api/people', { name });
    assert.equal(r.status, 201);
    ids[name] = r.body.person.id;
  }
  assert.equal((await call('POST', '/api/people', { name: 'asha' })).status, 400);

  const all = Object.values(ids).map((personId) => ({ personId }));
  const created = await call('POST', '/api/expenses', {
    description: 'Electricity', amount: '90.01', date: '2026-09-01', category: 'Utilities',
    paidBy: [{ personId: ids.Asha }], splitMethod: 'equal', participants: all,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.expense.amountCents, 9001);
  assert.equal(created.body.expense.splits.reduce((a, s) => a + s.cents, 0), 9001);

  let bal = (await call('GET', '/api/balances')).body;
  assert.equal(Object.values(bal.net).reduce((a, b) => a + b, 0), 0);
  assert.ok(bal.net[ids.Asha] > 0 && bal.net[ids.Ben] < 0);

  // Ben pays Asha back what he owes -> Ben is settled
  const owed = -bal.net[ids.Ben];
  const s = await call('POST', '/api/expenses', {
    type: 'settlement', amount: owed / 100, date: '2026-09-02', from: ids.Ben, to: ids.Asha,
  });
  assert.equal(s.status, 201);
  bal = (await call('GET', '/api/balances')).body;
  assert.equal(bal.net[ids.Ben], 0);

  const upd = await call('PUT', `/api/expenses/${created.body.expense.id}`, {
    description: 'Electricity', amount: 60, date: '2026-09-01',
    paidBy: [{ personId: ids.Asha }], splitMethod: 'equal', participants: all,
  });
  assert.equal(upd.body.expense.amountCents, 6000);

  const list = await call('GET', '/api/expenses?search=elec');
  assert.equal(list.body.total, 1);

  // Person with history is archived, not deleted
  assert.deepEqual((await call('DELETE', `/api/people/${ids.Ben}`)).body, { archived: true });

  assert.equal((await call('DELETE', `/api/expenses/${s.body.expense.id}`)).status, 200);
  assert.equal((await call('DELETE', `/api/expenses/${s.body.expense.id}`)).status, 404);
});

test('validation errors are 400s with messages', async () => {
  const p = (await call('POST', '/api/people', { name: 'Dee' })).body.person;
  const bad = [
    { description: 'x', amount: '0', date: '2026-01-01', paidBy: [{ personId: p.id }], participants: [{ personId: p.id }] },
    { description: 'x', amount: '5', date: '2026-02-30', paidBy: [{ personId: p.id }], participants: [{ personId: p.id }] },
    { description: '', amount: '5', date: '2026-01-01', paidBy: [{ personId: p.id }], participants: [{ personId: p.id }] },
    { description: 'x', amount: '5', date: '2026-01-01', paidBy: [{ personId: 'nope' }], participants: [{ personId: p.id }] },
    { description: 'x', amount: '5', date: '2026-01-01', paidBy: [{ personId: p.id, amount: '2' }, { personId: p.id, amount: '3' }], participants: [{ personId: p.id }] },
    { description: 'x', amount: '5', date: '2026-01-01', paidBy: [], participants: [{ personId: p.id }] },
  ];
  for (const b of bad) {
    const r = await call('POST', '/api/expenses', b);
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.ok(r.body.message);
  }
  const r = await fetch(`${base}/api/expenses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(r.status, 400);
});

test('data persists across restarts', async () => {
  const app2 = await createApp({ dataDir: dir });
  assert.ok(app2.get('store').data.people.length >= 3);
});
