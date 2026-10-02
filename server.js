import dotenv from 'dotenv';
import path from 'node:path';
import { createApp } from './src/app.js';
import { expandPath, remoteFromEnv } from './src/remote.js';

dotenv.config();

const PORT = process.env.PORT || 3000;
const dataDir = expandPath(process.env.DATA_DIR || './data');

const remote = remoteFromEnv();
const app = await createApp({ dataDir, remote, password: process.env.APP_PASSWORD || '', splitwiseKey: process.env.SPLITWISE_API_KEY || '',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '', anthropicModel: process.env.ANTHROPIC_MODEL || '' });

app.listen(PORT, () => {
  console.log(`Roommate ledger running at http://localhost:${PORT}`);
  console.log(`Data directory: ${dataDir}`);
  console.log(remote ? `Cloud sync: ${remote.label}${remote.encrypted ? ' (end-to-end encrypted)' : ''}` : 'Cloud sync: off (data stays on this machine; see docs/CLOUD.md)');
  if (!process.env.APP_PASSWORD) {
    console.log('Tip: set APP_PASSWORD in .env if this server is reachable by other devices.');
  }
});

// Generate due recurring bills every hour (also done once at startup).
setInterval(() => app.get('runRecurring')().catch((e) => console.error('Recurring bills failed:', e)), 60 * 60 * 1000).unref();
