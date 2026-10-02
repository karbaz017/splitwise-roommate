// Remote storage backends for cloud sync. Every backend exposes the same tiny interface:
//   get(key) -> Buffer | null     put(key, buffer)     del(key)
// Keys look like "ledger.json", "meta.json", "receipts/<file>".
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const safeKey = (key) => {
  if (!/^[\w./-]+$/.test(key) || key.includes('..')) throw new Error(`Unsafe sync key: ${key}`);
  return key;
};

/** A plain folder. Point it at a Dropbox / Google Drive / iCloud / OneDrive folder and the desktop client does the syncing. */
export class DirRemote {
  constructor(dir) { this.dir = dir; this.kind = 'folder'; this.label = dir; }

  async get(key) {
    try { return await fs.readFile(path.join(this.dir, safeKey(key))); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }

  async put(key, buf) {
    const file = path.join(this.dir, safeKey(key));
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, file);
  }

  async del(key) { await fs.rm(path.join(this.dir, safeKey(key)), { force: true }); }
}

/** Any S3-compatible bucket: AWS S3, Backblaze B2, Cloudflare R2, MinIO, Wasabi... */
export class S3Remote {
  constructor({ bucket, prefix = '', endpoint, region = 'auto', accessKeyId, secretAccessKey, client } = {}, sdk = null) {
    this.kind = 's3';
    this.bucket = bucket;
    this.prefix = prefix ? `${prefix.replace(/^\/+|\/+$/g, '')}/` : '';
    this.label = `${endpoint ? new URL(endpoint).host : 's3'}/${bucket}${this.prefix ? `/${this.prefix}` : ''}`;
    this.sdkPromise = sdk ? Promise.resolve(sdk) : import('@aws-sdk/client-s3');
    this.clientPromise = client ? Promise.resolve(client) : this.sdkPromise.then((m) => new m.S3Client({
      region, endpoint, forcePathStyle: !!endpoint, credentials: { accessKeyId, secretAccessKey },
    }));
  }

  async cmd(name, input) {
    const [sdk, client] = await Promise.all([this.sdkPromise, this.clientPromise]);
    return client.send(new sdk[name]({ Bucket: this.bucket, ...input }));
  }

  async get(key) {
    try {
      const r = await this.cmd('GetObjectCommand', { Key: this.prefix + safeKey(key) });
      return Buffer.from(await r.Body.transformToByteArray());
    } catch (e) {
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async put(key, buf) { await this.cmd('PutObjectCommand', { Key: this.prefix + safeKey(key), Body: buf }); }

  async del(key) { await this.cmd('DeleteObjectCommand', { Key: this.prefix + safeKey(key) }); }
}

/**
 * Client-side encryption wrapper (AES-256-GCM). The cloud provider only ever sees
 * ciphertext. The key comes from a passphrase via scrypt with a random salt that is
 * stored (unencrypted, it is not secret) next to the data so every device derives the same key.
 */
export class EncryptedRemote {
  constructor(inner, passphrase) {
    this.inner = inner;
    this.passphrase = passphrase;
    this.kind = inner.kind;
    this.label = inner.label;
    this.encrypted = true;
    this.keyPromise = null;
  }

  key() {
    this.keyPromise ||= (async () => {
      let salt = await this.inner.get('salt.bin');
      if (!salt) { salt = crypto.randomBytes(16); await this.inner.put('salt.bin', salt); }
      return new Promise((resolve, reject) => crypto.scrypt(this.passphrase, salt, 32, { N: 16384 }, (e, k) => (e ? reject(e) : resolve(k))));
    })();
    return this.keyPromise;
  }

  async get(key) {
    const blob = await this.inner.get(key);
    if (!blob) return null;
    if (blob.subarray(0, 4).toString('latin1') !== 'RLE1') throw new Error('Cloud data is not encrypted but a passphrase is set.');
    const iv = blob.subarray(4, 16);
    const tag = blob.subarray(16, 32);
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', await this.key(), iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(blob.subarray(32)), d.final()]);
    } catch {
      throw new Error('Could not decrypt cloud data: wrong SYNC_PASSPHRASE?');
    }
  }

  async put(key, buf) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', await this.key(), iv);
    const enc = Buffer.concat([c.update(buf), c.final()]);
    await this.inner.put(key, Buffer.concat([Buffer.from('RLE1'), iv, c.getAuthTag(), enc]));
  }

  del(key) { return this.inner.del(key); }
}

// dotenv does not expand "~", so do it here ("~/Dropbox/x" or "~" alone), and make the path absolute.
export function expandPath(p) {
  const home = os.homedir();
  const expanded = p === '~' ? home : /^~[/\\]/.test(p) ? path.join(home, p.slice(2)) : p;
  return path.resolve(expanded);
}

/** Build a remote from environment variables, or null when sync is not configured. */
export function remoteFromEnv(env = process.env) {
  let remote = null;
  if (env.S3_BUCKET) {
    remote = new S3Remote({
      bucket: env.S3_BUCKET, prefix: env.S3_PREFIX || '', endpoint: env.S3_ENDPOINT || undefined, region: env.S3_REGION || 'auto',
      accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
  } else if (env.SYNC_DIR) remote = new DirRemote(expandPath(env.SYNC_DIR.trim()));
  if (remote && env.SYNC_PASSPHRASE) remote = new EncryptedRemote(remote, env.SYNC_PASSPHRASE);
  return remote;
}
