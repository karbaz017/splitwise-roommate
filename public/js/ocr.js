// In-browser receipt reading. Everything runs locally in the user's browser:
// photos/scans go through Tesseract OCR, PDFs use their text layer first and
// fall back to OCR of the rendered page for scanned PDFs. No receipt data is sent
// to any third-party service (only the OCR engine/language files are downloaded).
import { parseReceiptText } from './receipt-parser.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const MAX_PDF_PAGES = 4;
const MAX_DIM = 2200;

const loaded = {};
function loadScript(src) {
  loaded[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { delete loaded[src]; reject(new Error('Could not download the receipt reader (are you offline?). You can still type the details in.')); };
    document.head.appendChild(s);
  });
  return loaded[src];
}

let workerPromise;
async function ocrWorker(onProgress) {
  await loadScript(TESSERACT);
  workerPromise ||= window.Tesseract.createWorker('eng', 1, {
    logger: (m) => m.status === 'recognizing text' && onProgress?.(m.progress),
  });
  return workerPromise;
}

// Scale down large photos and convert to grayscale: faster and usually more accurate.
async function prepareCanvas(source) {
  const bmp = source instanceof HTMLCanvasElement ? source : await createImageBitmap(source, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

async function ocrImage(source, onProgress) {
  const canvas = await prepareCanvas(source);
  const worker = await ocrWorker(onProgress);
  const { data } = await worker.recognize(canvas);
  return data.text;
}

async function pdfText(file, onProgress) {
  await loadScript(PDFJS);
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
  let out = '';
  for (let n = 1; n <= pages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    // Rebuild lines from text positions.
    const rows = new Map();
    for (const it of content.items) {
      const y = Math.round(it.transform[5] / 3);
      rows.set(y, [...(rows.get(y) || []), it]);
    }
    let text = [...rows.entries()].sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(' ').trim())
      .filter(Boolean).join('\n');
    if (text.replace(/\s/g, '').length < 40) {
      // Scanned page without a text layer: render and OCR it.
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      text = await ocrImage(canvas, onProgress);
    }
    out += `${text}\n`;
  }
  return out;
}

/**
 * Read a receipt file and return suggested values.
 * @returns {Promise<{total,date,merchant,category,confidence,text}|null>} null when unsupported
 */
export async function analyzeReceipt(file, { categories = [], onProgress } = {}) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  let text;
  if (isPdf) text = await pdfText(file, onProgress);
  else {
    try { await createImageBitmap(file); } catch { return null; } // e.g. HEIC outside Safari
    text = await ocrImage(file, onProgress);
  }
  return { ...parseReceiptText(text, { categories }), text };
}
