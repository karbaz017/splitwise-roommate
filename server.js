import dotenv from 'dotenv';
import path from 'node:path';
import { createApp } from './src/app.js';

dotenv.config();

const PORT = process.env.PORT || 3000;
const dataDir = path.resolve(process.env.DATA_DIR || './data');

const app = await createApp({ dataDir, password: process.env.APP_PASSWORD || '' });

app.listen(PORT, () => {
  console.log(`Roommate ledger running at http://localhost:${PORT}`);
  console.log(`Data directory: ${dataDir}`);
  if (!process.env.APP_PASSWORD) {
    console.log('Tip: set APP_PASSWORD in .env if this server is reachable by other devices.');
  }
});
