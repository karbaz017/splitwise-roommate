import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { normalizeAiResult, parseModelJson } from '../src/ai.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const modelReply = (obj) => new Response(JSON.stringify({ content: [{ type: 'text', text: `Here you go:\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\`` }] }), { status: 200, headers: { 'content-type': 'application/json' } });

test('parseModelJson tolerates fences and prose; normalize validates', () => {
  assert.equal(parseModelJson('blah {"a":1} blah').a, 1);
  assert.throws(() => parseModelJson('no json'), /structured/);
  const r = normalizeAiResult({ merchant: 'Shop', date: '2026-09-14', currency: 'usd', category: 'Groceries', total: '11.01', subtotal: 10.48, tax: 0.53, items: [{ name: 'A', amount: 5.24 }, { name: 'B', amount: '5.24' }, { name: 'junk', amount: -1 }] }, ['Groceries']);
  assert.equal(r.total, 11.01);
  assert.equal(r.items.length, 2);
  assert.equal(r.currency, 'USD');
  assert.equal(r.reconciled, true);
  assert.equal(normalizeAiResult({ total: 5, date: 'tomorrow', category: 'Bogus' }, ['Groceries']).date, null);
});

async function withServer(opts, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-'));
  const app = await createApp({ dataDir: dir, ...opts });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); await fs.rm(dir, { recursive: true, force: true }); }
}
const post = (base, buf, name = 'r.png') => {
  const fd = new FormData();
  fd.append('receipts', new Blob([buf]), name);
  return fetch(`${base}/api/receipts/analyze`, { method: 'POST', body: fd });
};

test('AI endpoint disabled without a key', async () => {
  await withServer({}, async (base) => {
    assert.equal((await (await fetch(`${base}/api/capabilities`)).json()).ai, false);
    assert.equal((await post(base, PNG)).status, 404);
  });
});

test('AI endpoint reads a receipt, sends key server-side, and reports upstream failure', async () => {
  let seen;
  const mode = { fail: 0 };
  const fetchImpl = async (url, init) => {
    seen = { url, headers: init.headers, body: JSON.parse(init.body) };
    return mode.fail ? new Response('{}', { status: mode.fail }) : modelReply({ merchant: 'Corner Cafe', date: '2026-09-14', total: 8.37, subtotal: 7.75, tax: 0.62, items: [{ name: 'Latte', amount: 4.5 }, { name: 'Muffin', amount: 3.25 }] });
  };
  await withServer({ anthropicKey: 'sk-test', fetchImpl }, async (base) => {
    assert.equal((await (await fetch(`${base}/api/capabilities`)).json()).ai, true);
    const ok = await post(base, PNG);
    assert.equal(ok.status, 200);
    const { result } = await ok.json();
    assert.equal(result.total, 8.37);
    assert.equal(result.reconciled, true);
    assert.equal(seen.headers['x-api-key'], 'sk-test');
    assert.equal(seen.body.messages[0].content[0].type, 'image');
    // not a supported file -> 400/415, never reaches upstream for HTML
    assert.notEqual((await post(base, Buffer.from('<html>not an image at all</html>'))).status, 200);
    mode.fail = 429;
    const bad = await post(base, PNG);
    assert.equal(bad.status, 502);
    assert.match((await bad.json()).message, /rate limited/);
  });
});
