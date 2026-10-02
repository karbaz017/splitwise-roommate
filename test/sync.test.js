import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { DirRemote, EncryptedRemote, S3Remote } from '../src/remote.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 5)]);
const tmp = (p) => fs.mkdtemp(path.join(os.tmpdir(), `${p}-`));

// A "device" = its own local data dir + server, sharing the same cloud location.
async function device(cloudDir, remoteWrap = (r) => r) {
  const dir = await tmp('dev');
  const remote = remoteWrap(new DirRemote(cloudDir));
  const app = await createApp({ dataDir: dir, remote, syncCheckMs: 0 });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, u, b) => {
    const r = await fetch(base + u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  return { dir, base, call, store: app.get('store'), close: async () => { server.close(); await fs.rm(dir, { recursive: true, force: true }); } };
}

test('a brand-new device sees everything another device saved, including receipts', async () => {
  const cloud = await tmp('cloud');
  const A = await device(cloud);
  const ann = (await A.call('POST', '/api/people', { name: 'Ann' })).body.person.id;
  const exp = (await A.call('POST', '/api/expenses', { description: 'Rent', amount: '900', date: '2026-09-01', paidBy: [{ personId: ann }], participants: [{ personId: ann }] })).body.expense;
  const fd = new FormData(); fd.append('receipts', new Blob([PNG]), 'r.png');
  const up = await (await fetch(`${A.base}/api/expenses/${exp.id}/receipts`, { method: 'POST', body: fd })).json();
  const file = up.added[0].file;
  assert.equal(A.store.status().pending, false);

  // Device B: empty local folder, same cloud
  const B = await device(cloud);
  assert.equal((await B.call('GET', '/api/people')).body.people.length, 1);
  const list = (await B.call('GET', '/api/expenses')).body;
  assert.equal(list.total, 1);
  assert.equal(list.expenses[0].receipts.length, 1);
  const img = await fetch(`${B.base}/api/receipts/${file}`); // not on B's disk yet: fetched on demand
  assert.equal(img.status, 200);
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);

  // B writes; A sees it on its next read; B's write did not clobber anything
  const bobId = (await B.call('POST', '/api/people', { name: 'Bob' })).body.person.id;
  await B.call('POST', '/api/expenses', { description: 'Internet', amount: '60', date: '2026-09-02', paidBy: [{ personId: bobId }], participants: [{ personId: bobId }] });
  assert.equal((await A.call('GET', '/api/expenses')).body.total, 2);
  assert.equal((await A.call('GET', '/api/people')).body.people.length, 2);

  // A writes right after B without reading first: pull-before-write keeps both
  await A.call('POST', '/api/expenses', { description: 'Gas', amount: '20', date: '2026-09-03', paidBy: [{ personId: ann }], participants: [{ personId: ann }] });
  assert.equal((await B.call('GET', '/api/expenses')).body.total, 3);

  // deleting a receipt/expense removes the cloud file too
  await A.call('DELETE', `/api/expenses/${exp.id}`);
  assert.equal(await new DirRemote(cloud).get(`receipts/${file}`), null);
  assert.equal((await B.call('GET', '/api/expenses')).body.total, 2);

  await A.close(); await B.close();
  await fs.rm(cloud, { recursive: true, force: true });
});

test('offline edits are kept and pushed later; true conflicts keep the cloud copy and save yours', async () => {
  const cloud = await tmp('cloud');
  const flaky = { down: false };
  const wrap = (r) => new Proxy(r, { get: (t, k) => (typeof t[k] === 'function' ? (...a) => (flaky.down ? Promise.reject(new Error('offline')) : t[k](...a)) : t[k]) });
  const A = await device(cloud, wrap);
  await A.call('POST', '/api/people', { name: 'Ann' });
  const B = await device(cloud);

  // A goes offline and keeps working
  flaky.down = true;
  const r = await A.call('POST', '/api/people', { name: 'Offline Olga' });
  assert.equal(r.status, 201); // the app still works
  assert.equal(A.store.status().pending, true);
  assert.match(A.store.status().lastError, /offline/);

  // coming back online with no one else having written: pushed, nothing lost
  flaky.down = false;
  await A.store.syncNow();
  assert.equal(A.store.status().pending, false);
  assert.equal((await B.call('GET', '/api/people')).body.people.length, 2);

  // conflict: A offline edit + B online edit
  flaky.down = true;
  await A.call('POST', '/api/people', { name: 'Only on A' });
  await B.call('POST', '/api/people', { name: 'Only on B' });
  flaky.down = false;
  const st = await A.store.syncNow();
  const names = (await A.call('GET', '/api/people')).body.people.map((p) => p.name);
  assert.ok(names.includes('Only on B') && !names.includes('Only on A')); // cloud wins
  assert.ok(st.conflictFile);
  const saved = JSON.parse(await fs.readFile(path.join(A.dir, st.conflictFile), 'utf8'));
  assert.ok(saved.people.some((p) => p.name === 'Only on A')); // nothing is silently lost

  await A.close(); await B.close();
  await fs.rm(cloud, { recursive: true, force: true });
});

test('enabling sync on an existing ledger seeds the cloud', async () => {
  const cloud = await tmp('cloud');
  const dir = await tmp('seed');
  const plain = await createApp({ dataDir: dir });
  await plain.get('store').mutate((d) => { d.people.push({ id: 'p1', name: 'Existing', email: '', active: true }); });
  const synced = await createApp({ dataDir: dir, remote: new DirRemote(cloud) });
  assert.equal(synced.get('store').status().pending, false);
  const B = await device(cloud);
  assert.equal((await B.call('GET', '/api/people')).body.people[0].name, 'Existing');
  await B.close();
  await fs.rm(cloud, { recursive: true, force: true }); await fs.rm(dir, { recursive: true, force: true });
});

test('end-to-end encryption: cloud holds only ciphertext, wrong passphrase is refused', async () => {
  const cloud = await tmp('cloud');
  const enc = (r) => new EncryptedRemote(r, 'correct horse battery staple');
  const A = await device(cloud, enc);
  await A.call('POST', '/api/people', { name: 'SecretName' });
  const fd = new FormData(); fd.append('receipts', new Blob([PNG]), 'r.png');
  const e = (await A.call('POST', '/api/expenses', { description: 'Private dinner', amount: '10', date: '2026-09-01', paidBy: [{ personId: (await A.call('GET', '/api/people')).body.people[0].id }], participants: [{ personId: (await A.call('GET', '/api/people')).body.people[0].id }] })).body.expense;
  await fetch(`${A.base}/api/expenses/${e.id}/receipts`, { method: 'POST', body: fd });

  for (const f of await fs.readdir(cloud, { recursive: true })) {
    const full = path.join(cloud, f);
    if ((await fs.stat(full)).isFile()) {
      const raw = await fs.readFile(full);
      assert.ok(!raw.includes('SecretName') && !raw.includes('Private dinner') && !raw.includes(PNG.subarray(8, 40)), `${f} leaks plaintext`);
    }
  }
  const B = await device(cloud, enc); // same passphrase on a new device works
  assert.equal((await B.call('GET', '/api/people')).body.people[0].name, 'SecretName');

  const wrong = await device(cloud, (r) => new EncryptedRemote(r, 'nope'));
  assert.match(wrong.store.status().lastError, /wrong SYNC_PASSPHRASE/);
  assert.equal((await wrong.call('GET', '/api/people')).body.people.length, 0); // never shows or overwrites data it cannot read

  // ...and it must not have overwritten the cloud: the right device still reads the original data
  assert.equal((await A.call('GET', '/api/people')).body.people[0].name, 'SecretName');
  assert.equal((await B.call('GET', '/api/expenses')).body.total, 1);
  await wrong.call('POST', '/api/people', { name: 'Written with wrong key' });
  assert.equal((await A.call('GET', '/api/people')).body.people.length, 1); // still never pushed

  await A.close(); await B.close(); await wrong.close();
  await fs.rm(cloud, { recursive: true, force: true });
});

test('S3Remote speaks the S3 protocol through the SDK (mocked)', async () => {
  const objects = new Map();
  const sdk = Object.fromEntries(['GetObjectCommand', 'PutObjectCommand', 'DeleteObjectCommand'].map((n) => [n, class { constructor(i) { this.name = n; this.input = i; } }]));
  const client = {
    async send(cmd) {
      const k = `${cmd.input.Bucket}/${cmd.input.Key}`;
      if (cmd.name === 'PutObjectCommand') { objects.set(k, Buffer.from(cmd.input.Body)); return {}; }
      if (cmd.name === 'DeleteObjectCommand') { objects.delete(k); return {}; }
      if (!objects.has(k)) throw Object.assign(new Error('nope'), { name: 'NoSuchKey' });
      return { Body: { transformToByteArray: async () => new Uint8Array(objects.get(k)) } };
    },
  };
  const r = new S3Remote({ bucket: 'b', prefix: 'family', endpoint: 'https://s3.example.com', client }, sdk);
  assert.equal(await r.get('ledger.json'), null);
  await r.put('ledger.json', Buffer.from('{"a":1}'));
  assert.ok(objects.has('b/family/ledger.json'));
  assert.equal((await r.get('ledger.json')).toString(), '{"a":1}');
  await r.del('ledger.json');
  assert.equal(await r.get('ledger.json'), null);
  assert.match(r.label, /s3\.example\.com\/b\/family/);
  await assert.rejects(() => r.put('../evil', Buffer.from('x')), /Unsafe/);
});
