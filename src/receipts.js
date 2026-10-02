import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { ValidationError } from './money.js';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_RECEIPTS_PER_EXPENSE = 10;

const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
};

// Decide the real file type from its leading bytes. The client-supplied
// mimetype/filename are never trusted.
export function sniffType(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'hevc', 'mif1', 'heim', 'heis'].includes(brand)) return 'heic';
  }
  return null;
}

export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_RECEIPTS_PER_EXPENSE },
}).array('receipts', MAX_RECEIPTS_PER_EXPENSE);

const cleanName = (name) =>
  path.basename(String(name || 'receipt')).replace(/[^\w .()\-]/g, '_').slice(0, 120) || 'receipt';

// Validate and write uploaded files; returns receipt metadata records.
export async function saveReceipts(dir, files) {
  const prepared = files.map((f) => {
    const ext = sniffType(f.buffer);
    if (!ext) {
      throw new ValidationError(`"${cleanName(f.originalname)}" is not a supported file. Upload JPG, PNG, WebP, GIF, HEIC or PDF.`);
    }
    return { f, ext };
  });
  const saved = [];
  try {
    for (const { f, ext } of prepared) {
      const id = crypto.randomUUID();
      const file = `${id}.${ext}`;
      await fs.writeFile(path.join(dir, file), f.buffer, { flag: 'wx' });
      saved.push({
        id,
        file,
        name: cleanName(f.originalname),
        mime: MIME_BY_EXT[ext],
        size: f.size,
        hash: crypto.createHash('sha256').update(f.buffer).digest('hex'),
        uploadedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    await removeReceiptFiles(dir, saved);
    throw err;
  }
  return saved;
}

export async function removeReceiptFiles(dir, receipts) {
  await Promise.all(receipts.map((r) => fs.rm(path.join(dir, r.file), { force: true })));
}

export const RECEIPT_FILE_RE = /^[0-9a-f-]{36}\.(jpg|png|gif|webp|heic|pdf)$/;
export const mimeForFile = (file) => MIME_BY_EXT[file.split('.').pop()];
