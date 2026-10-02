import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { DropboxRemote, authorizeUrl, pkcePair } from '../src/dropbox.js';
import { DirRemote } from '../src/remote.js';

// A tiny in-memory Dropbox: OAuth token endpoint (with PKCE verification) + files API.
function fakeDropbox() {
  const files = new Map();
  const log = [];
  const st = { challenge: null, accessToken: null, tokenSeq: 0, rate429: 0, revoked: 0, forbidden: false };
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const h = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    log.push(`${init.method || 'GET'} ${u.host}${u.pathname}`);
    if (u.pathname === '/oauth2/token') {
      const p = new URLSearchParams(init.body);
      if (p.get('grant_type') === 'authorization_code') {
        const ok = crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') === st.challenge && p.get('code') === 'GOOD-CODE';
        if (!ok) return json({ error: 'invalid_grant', error_description: 'bad code or verifier' }, 400);
        st.accessToken = `AT${++st.tokenSeq}`;
        return json({ access_token: st.accessToken, refresh_token: 'RT-1', expires_in: 14400 });
      }
      if (p.get('refresh_token') !== 'RT-1' || !p.get('client_id')) return json({ error: 'invalid_grant' }, 400);
      st.accessToken = `AT${++st.tokenSeq}`;
      return json({ access_token: st.accessToken, expires_in: 14400 });
    }
    if (h.authorization !== `Bearer ${st.accessToken}`) return json({ error_summary: 'expired_access_token/' }, 401);
    if (st.forbidden) return json({ error_summary: 'missing_scope/' }, 403);
    if (st.rate429 > 0) { st.rate429--; return new Response('{}', { status: 429, headers: { 'retry-after': '0' } }); }
    if (u.pathname === '/2/auth/token/revoke') { st.revoked++; return json({}); }
    const arg = h['dropbox-api-arg'] ? JSON.parse(h['dropbox-api-arg']) : init.body ? JSON.parse(init.body) : {};
    if (u.pathname === '/2/files/upload') { files.set(arg.path, { data: Buffer.from(init.body), arg, ctype: h['content-type'] }); return json({ name: 'x' }); }
    if (u.pathname === '/2/files/download') {
      if (!files.has(arg.path)) return json({ error_summary: 'path/not_found/..' }, 409);
      return new Response(files.get(arg.path).data, { status: 200 });
    }
    if (u.pathname === '/2/files/delete_v2') {
      if (!files.has(arg.path)) return json({ error_summary: 'path_lookup/not_found/..' }, 409);
      files.delete(arg.path); return json({});
    }
    return json({ error: 'unknown' }, 404);
  };
  return { fetchImpl, files, log, st };
}

const tmp = (p) => fs.mkdtemp(path.join(os.tmpdir(), `${p}-`));

test('PKCE helper and authorize URL follow Dropbox\'s rules', () => {
  const { verifier, challenge } = pkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(challenge, crypto.createHash('sha256').update(verifier).digest('base64url'));
  const u = new URL(authorizeUrl({ appKey: 'KEY', redirectUri: 'http://localhost:3000/api/dropbox/callback', challenge, state: 'S' }));
  assert.equal(u.origin + u.pathname, 'https://www.dropbox.com/oauth2/authorize');
  for (const [k, v] of Object.entries({ client_id: 'KEY', response_type: 'code', code_challenge_method: 'S256', token_access_type: 'offline', state: 'S', code_challenge: challenge })) assert.equal(u.searchParams.get(k), v);
  assert.equal(u.searchParams.get('redirect_uri'), 'http://localhost:3000/api/dropbox/callback');
  assert.match(u.searchParams.get('scope'), /files\.content\.write/);
});

test('DropboxRemote: round trip, not-found, token refresh, retries, errors', async () => {
  const d = fakeDropbox();
  d.st.accessToken = 'STALE-LATER'; // pre-existing token differs from what refresh will mint -> 401 -> refresh
  const r = new DropboxRemote({ appKey: 'KEY', refreshToken: 'RT-1', prefix: 'ledger' }, d.fetchImpl, { retryDelayMs: 0 });
  assert.equal(await r.get('ledger.json'), null); // 409 not_found -> null
  await r.put('ledger.json', Buffer.from('{"a":1}'));
  const up = d.files.get('/ledger/ledger.json');
  assert.deepEqual([up.arg.mode, up.arg.mute, up.ctype], ['overwrite', true, 'application/octet-stream']);
  assert.equal((await r.get('ledger.json')).toString(), '{"a":1}');
  await r.put('receipts/x.png', Buffer.from([1, 2, 3]));
  await r.del('receipts/x.png');
  await r.del('receipts/x.png'); // already gone: no error
  assert.ok(!d.files.has('/ledger/receipts/x.png'));
  assert.equal(d.log.filter((l) => l.endsWith('/oauth2/token')).length, 1); // token cached across calls

  d.st.rate429 = 2; // rate limited twice, then fine
  assert.equal((await r.get('ledger.json')).toString(), '{"a":1}');

  d.st.accessToken = 'REVOKED-ELSEWHERE'; // token invalidated: one transparent refresh
  assert.equal((await r.get('ledger.json')).toString(), '{"a":1}');

  d.st.forbidden = true;
  await assert.rejects(() => r.get('ledger.json'), /permissions/);
  await assert.rejects(() => r.put('../evil', Buffer.from('x')), /Unsafe/);
});

async function dropboxApp(d, dataDir, extra = {}) {
  const app = await createApp({ dataDir, dropboxAppKey: 'KEY', appUrl: 'http://localhost:4321', fetchImpl: d.fetchImpl, dropboxRetryMs: 0, syncCheckMs: 0, ...extra });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined, redirect: 'manual' }); return { status: r.status, loc: r.headers.get('location'), body: await r.json().catch(() => ({})) }; };
  return { app, base, call, store: app.get('store'), close: () => server.close() };
}

async function connect(A, d, passphrase = '') {
  const prep = await A.call('POST', '/api/dropbox/prepare', { passphrase });
  assert.equal(prep.status, 200, JSON.stringify(prep.body));
  const url = new URL(prep.body.url);
  d.st.challenge = url.searchParams.get('code_challenge');
  const cb = await A.call('GET', `/api/dropbox/callback?code=GOOD-CODE&state=${url.searchParams.get('state')}`);
  return { url, cb };
}

test('Connect Dropbox: sign-in flow, first sync, second device, encryption, restart, disconnect', async () => {
  const d = fakeDropbox();
  const dirA = await tmp('dbxA');
  const A = await dropboxApp(d, dirA);

  assert.equal((await A.call('GET', '/api/sync/status')).body.dropbox.configured, true);
  assert.equal((await A.call('GET', '/api/sync/status')).body.enabled, false);
  assert.equal((await A.call('POST', '/api/dropbox/prepare', { passphrase: 'short' })).status, 400);

  // existing local data is uploaded on first connect
  const ann = (await A.call('POST', '/api/people', { name: 'Ann' })).body.person.id;
  await A.call('POST', '/api/expenses', { description: 'Groceries', amount: '12', date: '2026-09-01', paidBy: [{ personId: ann }], participants: [{ personId: ann }] });

  // bad state is rejected without touching Dropbox
  const bad = await A.call('GET', '/api/dropbox/callback?code=GOOD-CODE&state=nope');
  assert.match(bad.loc, /dropbox=error/);

  const { url, cb } = await connect(A, d, 'a long secret phrase');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:4321/api/dropbox/callback');
  assert.match(cb.loc, /dropbox=connected/);
  const st = (await A.call('GET', '/api/sync/status')).body;
  assert.deepEqual([st.enabled, st.provider, st.encrypted, st.pending, st.dropbox.connected], [true, 'dropbox', true, false, true]);
  assert.ok(d.files.has('/ledger.json') && d.files.has('/meta.json'));
  for (const [, f] of d.files) assert.ok(!f.data.includes('Groceries') && !f.data.includes('Ann'), 'Dropbox must only hold ciphertext');
  // single-use state: replaying the callback fails
  assert.match((await A.call('GET', `/api/dropbox/callback?code=GOOD-CODE&state=${url.searchParams.get('state')}`)).loc, /dropbox=error/);

  // tokens live in the data folder with restrictive permissions, never in the synced ledger
  const authPath = path.join(dirA, 'dropbox-auth.json');
  assert.equal(JSON.parse(await fs.readFile(authPath, 'utf8')).refreshToken, 'RT-1');
  assert.equal((await fs.stat(authPath)).mode & 0o077, 0);
  assert.ok(!(await fs.readFile(path.join(dirA, 'ledger.json'), 'utf8')).includes('RT-1'));

  // a second device signs in to the same Dropbox (same passphrase) and gets the data
  const B = await dropboxApp(d, await tmp('dbxB'));
  await connect(B, d, 'a long secret phrase');
  assert.equal((await B.call('GET', '/api/people')).body.people[0].name, 'Ann');
  assert.equal((await B.call('GET', '/api/expenses')).body.total, 1);

  // restart of device A: still connected without signing in again
  A.close();
  const A2 = await dropboxApp(d, dirA);
  assert.equal(A2.store.status().enabled, true);
  assert.equal((await A2.call('GET', '/api/expenses')).body.total, 1);

  // disconnect: stops syncing, revokes the token, keeps all local data
  const dis = await A2.call('POST', '/api/dropbox/disconnect');
  assert.equal(dis.body.enabled, false);
  assert.equal(d.st.revoked, 1);
  await assert.rejects(() => fs.access(authPath));
  assert.equal((await A2.call('GET', '/api/expenses')).body.total, 1);
  assert.equal((await A2.call('POST', '/api/dropbox/disconnect')).status, 400);

  A2.close(); B.close();
});

test('Connect Dropbox is refused when not configured or when env sync is already active', async () => {
  const d = fakeDropbox();
  const noKey = await dropboxApp(d, await tmp('nokey'), { dropboxAppKey: '' });
  assert.equal((await noKey.call('POST', '/api/dropbox/prepare', {})).status, 400);
  noKey.close();
  const cloud = await tmp('cloud');
  const envSync = await dropboxApp(d, await tmp('env'), { remote: new DirRemote(cloud) });
  const r = await envSync.call('POST', '/api/dropbox/prepare', {});
  assert.equal(r.status, 400);
  assert.match(r.body.message, /environment/);
  envSync.close();
});
