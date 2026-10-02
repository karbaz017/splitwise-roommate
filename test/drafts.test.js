import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 9)]);

test('drafts are private, never counted, and finalize through strict validation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'drafts-'));
  const app = await createApp({ dataDir: dir });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, u, b) => {
    const r = await fetch(base + u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const mk = async (name) => (await call('POST', '/api/people', { name })).body.person.id;
  const [a, b] = [await mk('Ann'), await mk('Bob')];

  // a half-finished item split: unassigned item, total does not add up, unknown person filtered
  const form = {
    description: 'Costco run', amount: '120.00', date: '2026-09-20', splitMethod: 'items',
    paidById: a,
    items: [{ name: 'Oat milk', quantity: 2, amount: '9.00', personIds: [] }, { name: 'Rice', amount: '30', personIds: [a, 'ghost'] }],
    charges: [{ kind: 'tax', label: 'Tax', amount: '' }],
    rows: [{ personId: a, included: true }, { personId: 'ghost', included: true }],
  };
  assert.equal((await call('POST', '/api/drafts', { form })).status, 400); // owner required
  assert.equal((await call('POST', '/api/drafts', { ownerId: 'ghost', form })).status, 400);
  const draft = (await call('POST', '/api/drafts', { ownerId: a, form })).body.draft;
  assert.equal(draft.draft, true);
  assert.deepEqual(draft.draftForm.items[1].personIds, [a]); // unknown person dropped
  assert.equal(draft.draftForm.rows.length, 1);

  // invisible everywhere except the owner's drafts list
  assert.equal((await call('GET', '/api/expenses')).body.total, 0);
  assert.equal((await call('GET', `/api/expenses/${draft.id}`)).status, 404);
  assert.equal((await call('GET', '/api/balances')).body.transfers.length, 0);
  assert.deepEqual(Object.values((await call('GET', '/api/balances')).body.net), [0, 0]);
  const csv = await (await fetch(`${base}/api/export/expenses.csv`)).text();
  assert.ok(!csv.includes('Costco'));
  const json = await (await fetch(`${base}/api/export/ledger.json`)).json();
  assert.equal(json.expenses.length, 0);
  assert.equal((await call('GET', `/api/drafts?owner=${a}`)).body.drafts.length, 1);
  assert.equal((await call('GET', `/api/drafts?owner=${b}`)).body.drafts.length, 0);
  assert.equal((await call('GET', '/api/drafts')).status, 400);

  // other people cannot edit, delete, or attach files to it
  assert.equal((await call('PUT', `/api/drafts/${draft.id}`, { ownerId: b, form })).status, 404);
  assert.equal((await call('DELETE', `/api/drafts/${draft.id}?owner=${b}`)).status, 404);
  assert.equal((await call('DELETE', `/api/expenses/${draft.id}`)).status, 404);
  const fdB = new FormData(); fdB.append('receipts', new Blob([PNG]), 'x.png');
  assert.equal((await fetch(`${base}/api/expenses/${draft.id}/receipts?owner=${b}`, { method: 'POST', body: fdB })).status, 404);

  // the owner can attach a receipt; it never shows up in duplicate lookup
  const fd = new FormData(); fd.append('receipts', new Blob([PNG]), 'r.png');
  const up = await fetch(`${base}/api/expenses/${draft.id}/receipts?owner=${a}`, { method: 'POST', body: fd });
  assert.equal(up.status, 201);
  const rec = (await up.json()).added[0];
  const { createHash } = await import('node:crypto');
  assert.equal((await call('GET', `/api/receipts/lookup?hash=${createHash('sha256').update(PNG).digest('hex')}`)).body.duplicate, null);

  // update draft (still relaxed)
  const upd = await call('PUT', `/api/drafts/${draft.id}`, { ownerId: a, form: { ...form, description: 'Costco (edited)' } });
  assert.equal(upd.body.draft.description, 'Costco (edited)');
  assert.equal(upd.body.draft.receipts.length, 1);

  // finalizing needs the owner, and an invalid body fails and it stays a draft
  const valid = { description: 'Costco run', amount: '39', date: '2026-09-20', splitMethod: 'items', paidBy: [{ personId: a }], items: [{ name: 'Oat milk', quantity: 2, amount: '9', personIds: [a, b] }, { name: 'Rice', amount: '30', personIds: [a] }] };
  assert.equal((await call('PUT', `/api/expenses/${draft.id}`, valid)).status, 404); // no owner
  assert.equal((await call('PUT', `/api/expenses/${draft.id}?owner=${b}`, valid)).status, 404); // wrong owner
  const bad = await call('PUT', `/api/expenses/${draft.id}?owner=${a}`, { description: 'x', amount: '10', date: '2026-09-20', splitMethod: 'items', paidBy: [{ personId: a }], items: [{ name: 'Oat', amount: '5', personIds: [] }] });
  assert.equal(bad.status, 400);
  assert.equal((await call('GET', `/api/drafts?owner=${a}`)).body.drafts.length, 1);
  assert.equal((await call('GET', '/api/expenses')).body.total, 0);

  // finalize properly: becomes a normal entry, draft fields gone, receipt kept
  const ok = await call('PUT', `/api/expenses/${draft.id}?owner=${a}`, valid);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.expense.draft, undefined);
  assert.equal(ok.body.expense.receipts.length, 1);
  assert.equal((await call('GET', `/api/drafts?owner=${a}`)).body.drafts.length, 0);
  assert.equal((await call('GET', '/api/expenses')).body.total, 1);
  assert.equal((await call('GET', '/api/balances')).body.net[b], -450);
  assert.equal((await fetch(`${base}/api/receipts/${rec.file}`)).status, 200);

  // deleting a draft removes its receipt files; a person with a draft is archived, not deleted
  const d2 = (await call('POST', '/api/drafts', { ownerId: b, form: { description: 'Mine' } })).body.draft;
  const fd2 = new FormData(); fd2.append('receipts', new Blob([Buffer.concat([PNG, Buffer.from('2')])]), 'r2.png');
  const rec2 = (await (await fetch(`${base}/api/expenses/${d2.id}/receipts?owner=${b}`, { method: 'POST', body: fd2 })).json()).added[0];
  assert.deepEqual((await call('DELETE', `/api/people/${b}`)).body, { archived: true });
  assert.equal((await call('DELETE', `/api/drafts/${d2.id}?owner=${b}`)).status, 200);
  assert.equal((await fetch(`${base}/api/receipts/${rec2.file}`)).status, 404);

  // drafts cannot be created through the normal endpoint
  assert.equal((await call('POST', '/api/expenses', { draft: true, description: 'x', amount: '1', date: '2026-09-20', paidBy: [{ personId: a }], participants: [{ personId: a }] })).status, 400);

  server.close();
  await fs.rm(dir, { recursive: true, force: true });
});
