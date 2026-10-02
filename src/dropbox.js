// "Sign in with Dropbox": OAuth 2 (authorization code + PKCE, offline access) and a
// storage backend that talks to the Dropbox HTTP API directly, so no Dropbox desktop
// client is needed (works on servers too). Uses an "App folder" app: the app can only
// see its own folder (Dropbox/Apps/<your app name>), never the rest of the account.
import crypto from 'node:crypto';

const AUTHORIZE = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN = 'https://api.dropboxapi.com/oauth2/token';
const API = 'https://api.dropboxapi.com';
const CONTENT = 'https://content.dropboxapi.com';
export const DROPBOX_SCOPES = 'files.content.read files.content.write';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function pkcePair() {
  const verifier = b64url(crypto.randomBytes(48)); // 64 chars, within Dropbox's 43-128 limit
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

export function authorizeUrl({ appKey, redirectUri, challenge, state }) {
  const u = new URL(AUTHORIZE);
  u.search = new URLSearchParams({
    client_id: appKey, response_type: 'code', redirect_uri: redirectUri, code_challenge: challenge,
    code_challenge_method: 'S256', token_access_type: 'offline', scope: DROPBOX_SCOPES, state,
  }).toString();
  return u.toString();
}

async function tokenRequest(params, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(20000) });
  } catch { throw new Error('Could not reach Dropbox. Check your internet connection.'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Dropbox sign-in failed: ${body.error_description || body.error || res.status}`);
  return body;
}

export async function exchangeCode({ appKey, code, verifier, redirectUri }, fetchImpl = fetch) {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: appKey, redirect_uri: redirectUri }, fetchImpl);
  if (!t.refresh_token) throw new Error('Dropbox did not return a refresh token. Check that the app allows offline access.');
  return { refreshToken: t.refresh_token, accessToken: t.access_token, expiresIn: t.expires_in };
}

export class DropboxRemote {
  /** @param {{appKey:string, refreshToken:string, prefix?:string}} cfg */
  constructor({ appKey, refreshToken, prefix = '' }, fetchImpl = fetch, { retryDelayMs = 600 } = {}) {
    this.kind = 'dropbox';
    this.label = 'Dropbox (app folder)';
    this.appKey = appKey;
    this.refreshToken = refreshToken;
    this.prefix = prefix ? `/${prefix.replace(/^\/+|\/+$/g, '')}` : '';
    this.fetch = fetchImpl;
    this.retryDelayMs = retryDelayMs;
    this.token = null;
    this.tokenExpiry = 0;
  }

  async accessToken(force = false) {
    if (!force && this.token && Date.now() < this.tokenExpiry - 60_000) return this.token;
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: this.refreshToken, client_id: this.appKey }, this.fetch);
    if (typeof t.access_token !== 'string' || t.access_token.length < 10) {
      throw new Error(`Dropbox did not return a usable access token (response had: ${Object.keys(t).join(', ') || 'nothing'}). Disconnect and connect Dropbox again.`);
    }
    this.token = t.access_token;
    this.tokenExpiry = Date.now() + (t.expires_in || 14_400) * 1000;
    return this.token;
  }

  path(key) {
    if (!/^[\w./-]+$/.test(key) || key.includes('..')) throw new Error(`Unsafe sync key: ${key}`);
    return `${this.prefix}/${key}`;
  }

  // One API call with: token refresh on 401, and a few retries on rate limits / server errors.
  async call(url, makeInit) {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const init = makeInit(await this.accessToken());
      let res;
      try { res = await this.fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }); } catch { throw new Error('Could not reach Dropbox. Check your internet connection.'); }
      if (res.status === 401 && !refreshed) { refreshed = true; await this.accessToken(true); continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        const wait = Number(res.headers.get?.('retry-after')) * 1000 || this.retryDelayMs * (attempt + 1);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      return res;
    }
  }

  // Turn a Dropbox error response into a readable message (never includes tokens).
  async fail(res, what) {
    const raw = await res.text().catch(() => '');
    let detail = raw.slice(0, 400);
    try { const j = JSON.parse(raw); detail = j.user_message?.text || j.error_summary || detail; } catch { /* not JSON */ }
    if (res.status === 401) throw new Error('Dropbox rejected the saved sign-in. Disconnect and connect Dropbox again.');
    if (res.status === 403) throw new Error('Dropbox denied access. Make sure the app has the files.content.read and files.content.write permissions, then disconnect and connect again.');
    if (res.status === 507) throw new Error('Your Dropbox is full.');
    const missing = detail.match(/required scope '([^']+)'/);
    if (missing) {
      throw new Error(`Dropbox sign-in is missing the permission "${missing[1]}". On your Dropbox app's Permissions tab tick files.content.read and files.content.write and press Submit, then in this app press Disconnect Dropbox and Connect Dropbox again (permissions only apply to new sign-ins).`);
    }
    if (/Invalid authorization value/i.test(detail)) throw new Error(`Dropbox did not accept the access token (${what}). Disconnect and connect Dropbox again. Details: ${detail}`);
    throw new Error(`Dropbox ${what} failed (${res.status}): ${detail}`);
  }

  async get(key) {
    const arg = JSON.stringify({ path: this.path(key) });
    const res = await this.call(`${CONTENT}/2/files/download`, (t) => ({ method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Dropbox-API-Arg': arg } }));
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status === 409) {
      const body = await res.text();
      if (/not_found/.test(body)) return null;
      throw new Error(`Dropbox download failed (409): ${body.slice(0, 300)}`);
    }
    return this.fail(res, 'download');
  }

  async put(key, buf) {
    const arg = JSON.stringify({ path: this.path(key), mode: 'overwrite', autorename: false, mute: true });
    const res = await this.call(`${CONTENT}/2/files/upload`, (t) => ({ method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Dropbox-API-Arg': arg, 'Content-Type': 'application/octet-stream' }, body: buf }));
    if (!res.ok) await this.fail(res, 'upload');
  }

  async del(key) {
    const body = JSON.stringify({ path: this.path(key) });
    const res = await this.call(`${API}/2/files/delete_v2`, (t) => ({ method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body }));
    if (res.ok) return;
    if (res.status === 409 && /not_found/.test(await res.text())) return;
    await this.fail(res, 'delete');
  }

  /** Best effort: invalidate the token on Dropbox's side when the user disconnects. */
  async revoke() {
    try { await this.call(`${API}/2/auth/token/revoke`, (t) => ({ method: 'POST', headers: { Authorization: `Bearer ${t}` } })); } catch { /* disconnecting locally is what matters */ }
  }
}
