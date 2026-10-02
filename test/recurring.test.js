import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);

test('recurring bills: catch-up, idempotency, pause, error handling; duplicate receipt lookup', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rec-'));
  const app = await createApp({ dataDir: dir });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, u, b) => {
    const r = await fetch(base + u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const a = (await call('POST', '/api/people', { name: 'Ann' })).body.person.id;
  const b = (await call('POST', '/api/people', { name: 'Bo' })).body.person.id;

  const body = { description: 'Rent', amount: '1000', category: 'Rent', day: 1, startMonth: '2026-06', paidBy: [{ personId: a }], splitMethod: 'equal', participants: [{ personId: a }, { personId: b }] };
  assert.equal((await call('POST', '/api/recurring', { ...body, day: 31 })).status, 400);
  assert.equal((await call('POST', '/api/recurring', { ...body, amount: '0' })).status, 400);
  const rule = (await call('POST', '/api/recurring', body)).body.rule;
  assert.equal(rule.nextDue, '2026-06-01');

  // "now" = 2026-09-15 -> June, July, Aug, Sep generated
  const run = app.get('runRecurring');
  assert.equal(await run(new Date('2026-09-15T12:00:00Z')), 4);
  assert.equal(await run(new Date('2026-09-15T12:00:00Z')), 0); // idempotent
  let list = (await call('GET', '/api/expenses?category=Rent')).body;
  assert.equal(list.total, 4);
  assert.deepEqual(list.expenses.map((e) => e.date).sort(), ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']);
  assert.ok(list.expenses.every((e) => e.source === 'recurring' && e.amountCents === 100000));

  // next month only creates one more; paused rules create nothing
  assert.equal(await run(new Date('2026-10-02T00:00:00Z')), 1);
  await call('PATCH', `/api/recurring/${rule.id}`, { active: false });
  assert.equal(await run(new Date('2027-03-01T00:00:00Z')), 0);

  // if a participant is archived the rule reports an error instead of crashing
  await call('PATCH', `/api/recurring/${rule.id}`, { active: true });
  await call('DELETE', `/api/people/${b}`); // has history -> archived, still valid person id
  assert.ok((await run(new Date('2027-03-01T00:00:00Z'))) >= 1);

  assert.equal((await call('DELETE', `/api/recurring/${rule.id}`)).status, 200);
  assert.equal((await call('GET', '/api/recurring')).body.rules.length, 0);
  assert.ok((await call('GET', '/api/expenses?category=Rent')).body.total >= 5); // history kept

  // duplicate receipt detection
  const exp = (await call('POST', '/api/expenses', { description: 'Gas', amount: 10, date: '2026-09-01', paidBy: [{ personId: a }], participants: [{ personId: a }] })).body.expense;
  const fd = new FormData(); fd.append('receipts', new Blob([PNG]), 'a.png');
  assert.equal((await fetch(`${base}/api/expenses/${exp.id}/receipts`, { method: 'POST', body: fd })).status, 201);
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(PNG).digest('hex');
  assert.equal((await call('GET', `/api/receipts/lookup?hash=${hash}`)).body.duplicate.id, exp.id);
  assert.equal((await call('GET', `/api/receipts/lookup?hash=${'0'.repeat(64)}`)).body.duplicate, null);
  assert.equal((await call('GET', '/api/receipts/lookup?hash=zz')).status, 400);

  server.close();
  await fs.rm(dir, { recursive: true, force: true });
});
