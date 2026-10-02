// Diagnose the Dropbox connection step by step:  npm run dropbox:check
// Prints what Dropbox answers at every stage (tokens are never printed).
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { DropboxRemote } from '../src/dropbox.js';
import { expandPath } from '../src/remote.js';

dotenv.config();
const appKey = process.env.DROPBOX_APP_KEY;
const dataDir = expandPath(process.env.DATA_DIR || './data');
const say = (ok, msg) => console.log(`${ok ? '✔' : '✖'} ${msg}`);

if (!appKey) { say(false, 'DROPBOX_APP_KEY is not set in .env'); process.exit(1); }
say(true, `App key found (${appKey.length} characters)`);

let auth;
try { auth = JSON.parse(await fs.readFile(path.join(dataDir, 'dropbox-auth.json'), 'utf8')); } catch { /* handled below */ }
if (!auth?.refreshToken) { say(false, `No saved sign-in at ${dataDir}/dropbox-auth.json. Press Connect Dropbox in Settings first.`); process.exit(1); }
say(true, `Saved sign-in found (refresh token ${auth.refreshToken.length} characters, connected ${auth.connectedAt})`);

const remote = new DropboxRemote({ appKey, refreshToken: auth.refreshToken });
const step = async (name, fn) => {
  try { const r = await fn(); say(true, `${name}${r ? `: ${r}` : ''}`); return true; } catch (e) { say(false, `${name}: ${e.message}`); return false; }
};

let ok = await step('Get an access token', async () => { const t = await remote.accessToken(true); return `received a ${t.length}-character token`; });
if (ok) ok = await step('Upload a test file to your app folder', () => remote.put('diagnostic.txt', Buffer.from(`ok ${new Date().toISOString()}`)));
if (ok) ok = await step('Download it back', async () => { const b = await remote.get('diagnostic.txt'); if (!b) throw new Error('file not found after upload'); return b.toString(); });
if (ok) ok = await step('Read a file that does not exist (should be "not found", not an error)', async () => ((await remote.get('does-not-exist.bin')) === null ? 'correctly reported missing' : 'unexpectedly found'));
if (ok) await step('Delete the test file', () => remote.del('diagnostic.txt'));
if (!ok) console.log('\nIf the message above mentions a missing scope: enable files.content.read and files.content.write on the Permissions tab, press Submit, then Disconnect and Connect Dropbox again in Settings.');
console.log(ok ? '\nDropbox is working. If the app still shows an error, restart it and press Sync now.' : '\nCopy everything above and send it along; no secrets are included.');
process.exit(ok ? 0 : 1);
