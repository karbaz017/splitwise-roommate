import fs from 'node:fs/promises';
import path from 'node:path';

const EMPTY = () => ({
  version: 1,
  settings: { householdName: 'My Household', currency: 'USD' },
  people: [],
  expenses: [],
  recurring: [],
});

/**
 * Tiny JSON-file store. Writes are serialized and atomic (temp file + rename),
 * so a crash mid-write cannot corrupt the ledger. A `.bak` copy of the previous
 * version is kept on every write.
 */
export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'ledger.json');
    this.receiptsDir = path.join(dataDir, 'receipts');
    this.data = EMPTY();
    this.queue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.receiptsDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      this.data = { ...EMPTY(), ...JSON.parse(raw) };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Unreadable ledger: refuse to start rather than silently overwrite it.
        throw new Error(`Could not read ${this.file}: ${err.message}`);
      }
      await this.save();
    }
    return this;
  }

  // Run a mutation against the data and persist it. Mutations are serialized.
  mutate(fn) {
    const run = async () => {
      const snapshot = structuredClone(this.data);
      try {
        const result = await fn(this.data);
        await this.save();
        return result;
      } catch (err) {
        this.data = snapshot; // roll back in-memory state on failure
        throw err;
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
    try {
      await fs.copyFile(this.file, `${this.file}.bak`);
    } catch {
      /* first write: nothing to back up */
    }
    await fs.rename(tmp, this.file);
  }
}
