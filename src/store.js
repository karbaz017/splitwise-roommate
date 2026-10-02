import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const EMPTY = () => ({
  version: 1,
  rev: 0,
  settings: { householdName: 'My Household', currency: 'USD' },
  people: [],
  expenses: [],
  recurring: [],
});

/**
 * JSON-file store with optional cloud sync.
 *
 * Local: writes are serialized and atomic (temp file + rename); a `.bak` copy of the
 * previous version is kept.
 *
 * Cloud (when a `remote` is given): the ledger carries a revision number. Before every
 * write the store pulls the remote if it is newer, so two devices never overwrite each
 * other; after every write it pushes. If the remote is unreachable, writes are kept
 * locally, flagged as pending, and pushed on the next successful sync. If both sides
 * changed while apart, the remote wins and the local version is kept as a conflict copy.
 */
export class Store {
  constructor(dataDir, { remote = null, syncCheckMs = 10_000 } = {}) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'ledger.json');
    this.stateFile = path.join(dataDir, 'sync-state.json');
    this.receiptsDir = path.join(dataDir, 'receipts');
    this.data = EMPTY();
    this.queue = Promise.resolve();
    this.remote = remote;
    this.syncCheckMs = syncCheckMs;
    this.sync = { baseRev: 0, dirty: false, pendingUploads: [], pendingDeletes: [], deviceId: crypto.randomUUID().slice(0, 8), lastSyncedAt: null, lastError: null, conflict: null };
    this.lastCheck = 0;
    this.synced = false; // true once this session has successfully read the cloud; pushing before that could overwrite data we could not read
  }

  async init() {
    await fs.mkdir(this.receiptsDir, { recursive: true });
    try {
      this.data = { ...EMPTY(), ...JSON.parse(await fs.readFile(this.file, 'utf8')) };
    } catch (err) {
      if (err.code !== 'ENOENT') throw new Error(`Could not read ${this.file}: ${err.message}`); // never silently overwrite
      await this.saveLocal();
    }
    try { Object.assign(this.sync, JSON.parse(await fs.readFile(this.stateFile, 'utf8'))); } catch { /* first run */ }
    if (this.remote) await this.exclusive(() => this.pull()).catch((e) => this.fail(e)); // offline start is fine
    return this;
  }

  // ---- serialization -------------------------------------------------------
  exclusive(fn) {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  // Run a mutation against the data and persist (and sync) it.
  mutate(fn) {
    return this.exclusive(async () => {
      if (this.remote) await this.pull().catch((e) => this.fail(e)); // see other devices' changes first
      const snapshot = structuredClone(this.data);
      const before = JSON.stringify(this.data);
      try {
        const result = await fn(this.data);
        if (JSON.stringify(this.data) === before) return result; // nothing changed: no save, no revision, no upload
        this.data.rev = (this.data.rev || 0) + 1;
        await this.saveLocal();
        if (this.remote) {
          this.sync.dirty = true;
          await this.saveState();
          // Only upload after we have read the cloud in this session; otherwise keep the change locally.
          if (this.synced) await this.push().catch((e) => this.fail(e));
        }
        return result;
      } catch (err) {
        this.data = snapshot; // roll back in-memory state on failure
        throw err;
      }
    });
  }

  async saveLocal() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
    try { await fs.copyFile(this.file, `${this.file}.bak`); } catch { /* first write: nothing to back up */ }
    await fs.rename(tmp, this.file);
  }

  async saveState() {
    const { deviceId, baseRev, dirty, pendingUploads, pendingDeletes } = this.sync;
    await fs.writeFile(this.stateFile, JSON.stringify({ deviceId, baseRev, dirty, pendingUploads, pendingDeletes }));
  }

  // ---- cloud sync ----------------------------------------------------------
  fail(err) {
    this.sync.lastError = err.message || String(err);
    console.warn('Cloud sync problem:', this.sync.lastError);
  }

  hasContent() { return this.data.people.length > 0 || this.data.expenses.length > 0; }

  /** Bring this device in line with the cloud. Call inside exclusive(). */
  async pull() {
    if (!this.remote) return;
    const metaBuf = await this.remote.get('meta.json');
    const meta = metaBuf ? JSON.parse(metaBuf.toString()) : null;
    this.synced = true; // the cloud was readable (and decryptable): it is now safe to write
    if (!meta) {
      if (this.hasContent() || this.data.rev > 0) { this.data.rev = Math.max(this.data.rev || 0, 1); await this.saveLocal(); await this.push(); }
    } else if (meta.rev > this.sync.baseRev) {
      // The cloud has changes this device has not seen.
      const localHasWork = this.sync.dirty || (this.sync.baseRev === 0 && this.hasContent());
      if (localHasWork) await this.saveConflictCopy();
      const buf = await this.remote.get('ledger.json');
      if (!buf) throw new Error('Cloud ledger.json is missing');
      this.data = { ...EMPTY(), ...JSON.parse(buf.toString()) };
      this.data.rev = Math.max(this.data.rev || 0, meta.rev);
      this.sync.baseRev = this.data.rev;
      this.sync.dirty = false;
      await this.saveLocal();
      await this.saveState();
    } else if (this.sync.dirty) {
      await this.push();
    }
    await this.flushReceipts();
    this.sync.lastSyncedAt = new Date().toISOString();
    this.sync.lastError = null;
    this.lastCheck = Date.now();
  }

  async push() {
    if (!this.synced) throw new Error('Not connected to the cloud yet; changes are kept on this device');
    this.data.rev = Math.max(this.data.rev || 0, 1);
    await this.flushReceipts(); // files first, so the ledger never points at a file that is not there yet
    await this.remote.put('ledger.json', Buffer.from(JSON.stringify(this.data)));
    await this.remote.put('meta.json', Buffer.from(JSON.stringify({ rev: this.data.rev, updatedAt: new Date().toISOString(), writer: this.sync.deviceId })));
    this.sync.baseRev = this.data.rev;
    this.sync.dirty = false;
    this.sync.lastSyncedAt = new Date().toISOString();
    this.sync.lastError = null;
    await this.saveState();
  }

  async saveConflictCopy() {
    const name = `ledger.conflict-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    await fs.writeFile(path.join(this.dir, name), JSON.stringify(this.data, null, 2));
    this.sync.conflict = { file: name, at: new Date().toISOString() };
    console.warn(`Cloud sync: local changes conflicted with newer cloud data. The cloud version was kept; yours is saved as ${name}`);
  }

  /** Cheap, throttled "is there anything new in the cloud?" used before reads. Never throws. */
  async ensureFresh() {
    if (!this.remote || Date.now() - this.lastCheck < this.syncCheckMs) return;
    this.lastCheck = Date.now();
    await this.exclusive(() => this.pull()).catch((e) => this.fail(e));
  }

  async syncNow() {
    if (!this.remote) return this.status();
    await this.exclusive(() => this.pull()).catch((e) => this.fail(e));
    return this.status();
  }

  // Receipts are separate files. Uploads/deletes are queued (and persisted) so they survive being offline.
  async queueReceiptUpload(files) {
    if (!this.remote || !files.length) return;
    this.sync.pendingUploads.push(...files);
    await this.saveState();
    await this.exclusive(() => this.flushReceipts()).catch((e) => this.fail(e));
  }

  async queueReceiptDelete(files) {
    if (!this.remote || !files.length) return;
    this.sync.pendingUploads = this.sync.pendingUploads.filter((f) => !files.includes(f));
    this.sync.pendingDeletes.push(...files);
    await this.saveState();
    await this.exclusive(() => this.flushReceipts()).catch((e) => this.fail(e));
  }

  async flushReceipts() {
    if (!this.remote) return;
    for (const f of [...this.sync.pendingUploads]) {
      let buf = null;
      try { buf = await fs.readFile(path.join(this.receiptsDir, f)); } catch { /* deleted locally before upload */ }
      if (buf) await this.remote.put(`receipts/${f}`, buf);
      this.sync.pendingUploads = this.sync.pendingUploads.filter((x) => x !== f);
    }
    for (const f of [...this.sync.pendingDeletes]) {
      await this.remote.del(`receipts/${f}`);
      this.sync.pendingDeletes = this.sync.pendingDeletes.filter((x) => x !== f);
    }
    await this.saveState();
  }

  /** Download a receipt that another device uploaded. Returns true when it is now available locally. */
  async fetchReceipt(file) {
    if (!this.remote) return false;
    try {
      const buf = await this.remote.get(`receipts/${file}`);
      if (!buf) return false;
      await fs.writeFile(path.join(this.receiptsDir, file), buf, { flag: 'wx' }).catch((e) => { if (e.code !== 'EEXIST') throw e; });
      return true;
    } catch (e) { this.fail(e); return false; }
  }

  status() {
    const s = this.sync;
    return {
      enabled: !!this.remote,
      provider: this.remote?.kind || null,
      location: this.remote?.label || null,
      encrypted: !!this.remote?.encrypted,
      rev: this.data.rev || 0,
      pending: !!this.remote && (s.dirty || s.pendingUploads.length > 0 || s.pendingDeletes.length > 0),
      lastSyncedAt: s.lastSyncedAt,
      lastError: s.lastError,
      conflictFile: s.conflict?.file || null,
      device: s.deviceId,
    };
  }
}
