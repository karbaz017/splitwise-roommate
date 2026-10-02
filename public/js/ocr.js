// In-browser receipt reading. Everything runs locally in the user's browser:
// photos/scans go through Tesseract OCR (several image-enhancement passes, rotation
// recovery), PDFs use their text layer first and fall back to OCR of the rendered
// page for scanned PDFs. No receipt data is sent to any third-party service
// (only the OCR engine / language data / helper libraries are downloaded).
import { parseReceiptText } from './receipt-parser.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const HEIC2ANY = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
const MAX_PDF_PAGES = 4;
const MAX_DIM = 2400;
const MIN_DIM = 1100; // upscale tiny screenshots / thumbnails

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
let progressHandler = null;
async function ocrWorker() {
  await loadScript(TESSERACT);
  workerPromise ||= window.Tesseract.createWorker('eng', 1, {
    logger: (m) => m.status === 'recognizing text' && progressHandler?.(m.progress),
  });
  return workerPromise;
}

// ------------------------------------------------------------ image preparation
const newCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

// Decode (honouring EXIF rotation), scale into a sensible size range, convert to grayscale.
async function prepareCanvas(source) {
  const bmp = source instanceof HTMLCanvasElement ? source : await createImageBitmap(source, { imageOrientation: 'from-image' });
  const longest = Math.max(bmp.width, bmp.height);
  const scale = longest > MAX_DIM ? MAX_DIM / longest : longest < MIN_DIM ? Math.min(3, MIN_DIM / longest) : 1;
  const c = newCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height); // transparent PNGs become white, not black
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  ctx.putImageData(img, 0, 0);
  return c;
}

// Stretch contrast (2nd-98th percentile) then adaptive-threshold (Bradley): copes with
// shadows, uneven lighting, faded thermal paper and low-contrast photos.
function enhance(src, { smooth = false, k = 0.88, rdiv = 24 } = {}) {
  const { width: w, height: h } = src;
  const out = newCanvas(w, h);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[d[i]]++;
  const px = w * h;
  let lo = 0; let hi = 255; let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= px * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= px * 0.02) { hi = v; break; } }
  const span = Math.max(hi - lo, 1);
  const gray = new Float32Array(px);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) gray[p] = Math.min(255, Math.max(0, ((d[i] - lo) * 255) / span));
  // Integral image for fast local means.
  if (smooth) boxBlur(gray, w, h); // knock down sensor noise before thresholding
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += gray[(y - 1) * w + (x - 1)];
      integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + row;
    }
  }
  const r = Math.max(8, Math.round(Math.min(w, h) / rdiv));
  for (let y = 0; y < h; y++) {
    const y1 = Math.max(0, y - r); const y2 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - r); const x2 = Math.min(w - 1, x + r);
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum = integral[(y2 + 1) * (w + 1) + x2 + 1] - integral[y1 * (w + 1) + x2 + 1] - integral[(y2 + 1) * (w + 1) + x1] + integral[y1 * (w + 1) + x1];
      const v = gray[y * w + x] * area < sum * k ? 0 : 255;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

// In-place 3x3 box blur on a grayscale float buffer.
function boxBlur(g, w, h) {
  const t = new Float32Array(g.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = g[y * w + Math.max(0, x - 1)]; const b = g[y * w + x]; const c = g[y * w + Math.min(w - 1, x + 1)];
    t[y * w + x] = (a + b + c) / 3;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    g[y * w + x] = (t[Math.max(0, y - 1) * w + x] + t[y * w + x] + t[Math.min(h - 1, y + 1) * w + x]) / 3;
  }
}

// Estimate small skew (±8°) from the projection profile of dark pixels: text lines
// are sharpest (highest row-sum variance) when the page is level. Rotate to fix it.
function deskew(src, inkSrc = src) {
  const scale = Math.min(1, 700 / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale)); const h = Math.max(1, Math.round(src.height * scale));
  const small = newCanvas(w, h);
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(inkSrc, 0, 0, w, h);
  const d = sctx.getImageData(0, 0, w, h).data;
  const ink = [];
  // inkSrc is the adaptive-thresholded image, so "dark" is real text regardless of shadows.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4] < 110) ink.push(x, y);
  if (ink.length < 400) return src;
  const variance = (deg) => {
    const rad = (deg * Math.PI) / 180; const sin = Math.sin(rad); const cos = Math.cos(rad);
    const bins = new Float32Array(h * 2 + 2);
    for (let i = 0; i < ink.length; i += 2) bins[Math.max(0, Math.round(ink[i + 1] * cos - ink[i] * sin + h / 2))]++;
    let m = 0; for (const v of bins) m += v; m /= bins.length;
    let v2 = 0; for (const v of bins) v2 += (v - m) * (v - m);
    return v2;
  };
  const base = variance(0);
  let best = 0; let bestV = base;
  for (let deg = -8; deg <= 8; deg += 0.5) { const v = variance(deg); if (v > bestV) { bestV = v; best = deg; } }
  if (Math.abs(best) < 0.8 || bestV < base * 1.08) return src;
  return rotateBy(src, -best);
}

function rotateBy(src, deg) {
  const rad = (deg * Math.PI) / 180;
  const w = Math.ceil(Math.abs(src.width * Math.cos(rad)) + Math.abs(src.height * Math.sin(rad)));
  const h = Math.ceil(Math.abs(src.width * Math.sin(rad)) + Math.abs(src.height * Math.cos(rad)));
  const out = newCanvas(w, h);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2); ctx.rotate(rad);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

function rotate(src, deg) {
  const swap = deg === 90 || deg === 270;
  const out = newCanvas(swap ? src.height : src.width, swap ? src.width : src.height);
  const ctx = out.getContext('2d');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

// ------------------------------------------------------------ recognition
async function recognize(canvas, psm) {
  const worker = await ocrWorker();
  await worker.setParameters({ tessedit_pageseg_mode: String(psm), preserve_interword_spaces: '1' });
  const { data } = await worker.recognize(canvas);
  return { text: data.text, conf: data.confidence || 0 };
}

const isGood = (a) => a.parsed.total && (a.parsed.reconciled || a.parsed.confidence >= 0.85);

/**
 * Try progressively stronger strategies until the receipt parses convincingly,
 * and keep the best attempt (scored by how well the parsed fields reconcile).
 */
async function recognizeBest(source, { categories, onStage, onProgress }) {
  progressHandler = onProgress;
  const base = await prepareCanvas(source);
  const level = deskew(base, enhance(base, { smooth: true })); // === base when no skew is detected
  let best = null;
  const attempts = [];
  const attempt = async (canvas, psm, label) => {
    onStage?.(label);
    const { text, conf } = await recognize(canvas, psm);
    const parsed = parseReceiptText(text, { categories });
    const a = { text, conf, parsed, score: parsed.confidence + conf / 400 + (parsed.items.length ? 0.05 : 0) };
    attempts.push({ label, psm, conf: Math.round(conf), text, parsed, score: parsed.confidence + conf / 400 + (parsed.items.length ? 0.05 : 0) });
    if (!best || a.score > best.score) best = a;
    return a;
  };
  await attempt(base, 4, 'Reading receipt');
  if (!isGood(best) && level !== base) await attempt(level, 4, 'Straightening');
  if (!isGood(best)) await attempt(enhance(level), 4, 'Enhancing contrast');
  if (!isGood(best)) await attempt(enhance(level, { smooth: true }), 4, 'Removing noise');
  if (!isGood(best)) await attempt(level, 6, 'Trying another layout');
  if (!isGood(best) && best.conf < 60) {
    for (const deg of [90, 270, 180]) {
      await attempt(rotate(base, deg), 4, `Checking rotation (${deg}°)`);
      if (isGood(best) || best.conf >= 75) break;
    }
  }
  if (!isGood(best)) await attempt(enhance(level, { smooth: true }), 6, 'Final attempt');
  if (!isGood(best)) await attempt(enhance(level, { smooth: true, k: 0.94, rdiv: 14 }), 6, 'Last resort');
  // Different passes often recover different fields (labels from one, prices from another).
  // Keep the best pass and fill whatever it is missing from the others.
  const merged = { ...best.parsed };
  const rest = attempts.filter((a) => a.parsed !== best.parsed).sort((a, b) => b.score - a.score);
  for (const a of rest) {
    for (const k of ['total', 'date', 'merchant', 'category', 'currency', 'tax', 'tip', 'fee', 'subtotal']) if (merged[k] == null && a.parsed[k] != null) merged[k] = a.parsed[k];
    if (!merged.items.length && a.parsed.items.length) merged.items = a.parsed.items;
    if (!merged.charges.length && a.parsed.charges.length) merged.charges = a.parsed.charges;
    merged.totalCandidates = [...new Set([...merged.totalCandidates, ...a.parsed.totalCandidates])].slice(0, 4);
  }
  if (!best.parsed.total && merged.total) merged.confidence = Math.min(merged.confidence + 0.35, 0.6);
  best.parsed = merged;
  best.debug = attempts;
  return best;
}

// ------------------------------------------------------------ PDF
async function pdfPages(file, { categories, onStage, onProgress }) {
  await loadScript(PDFJS);
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const texts = [];
  const ocrCandidates = [];
  for (let n = 1; n <= pages; n++) {
    onStage?.(`Reading PDF page ${n}/${pages}`);
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const rows = new Map();
    for (const it of content.items) {
      const y = Math.round(it.transform[5] / 3);
      rows.set(y, [...(rows.get(y) || []), it]);
    }
    const text = [...rows.entries()].sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(' ').trim())
      .filter(Boolean).join('\n');
    texts.push(text);
    if (text.replace(/\s/g, '').length < 40) ocrCandidates.push({ page, n });
  }
  // Scanned pages (no text layer): render and OCR them.
  for (const { page, n } of ocrCandidates) {
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = newCanvas(Math.round(viewport.width), Math.round(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const r = await recognizeBest(canvas, { categories, onStage: (s) => onStage?.(`Page ${n}: ${s}`), onProgress });
    texts[n - 1] = r.text;
  }
  return texts.join('\n');
}

// ------------------------------------------------------------ HEIC
async function decodable(file) {
  try { await createImageBitmap(file); return file; } catch { /* fall through to conversion */ }
  if (!/heic|heif/i.test(`${file.type} ${file.name}`)) return null;
  try {
    await loadScript(HEIC2ANY);
    const out = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    return Array.isArray(out) ? out[0] : out;
  } catch { return null; }
}

/**
 * Read a receipt file and return suggested values.
 * @returns {Promise<(ReturnType<typeof parseReceiptText> & {text:string})|null>} null when the file can't be decoded
 */
export async function analyzeReceipt(file, { categories = [], onProgress, onStage } = {}) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    const text = await pdfPages(file, { categories, onStage, onProgress });
    return { ...parseReceiptText(text, { categories }), text, source: 'pdf' };
  }
  onStage?.('Preparing image');
  const decoded = await decodable(file);
  if (!decoded) return null;
  const best = await recognizeBest(decoded, { categories, onStage, onProgress });
  return { ...best.parsed, text: best.text, source: 'ocr' };
}

// Combine results from several files (e.g. a long receipt photographed twice): keep the
// most confident result and fill any fields it lacks from the others.
export function mergeResults(results) {
  const ok = results.filter(Boolean).sort((a, b) => b.confidence - a.confidence);
  if (!ok.length) return null;
  const out = { ...ok[0] };
  for (const r of ok.slice(1)) {
    for (const k of ['total', 'date', 'merchant', 'category', 'currency', 'tax', 'tip', 'fee', 'subtotal']) if (out[k] == null && r[k] != null) out[k] = r[k];
    if (!out.items?.length && r.items?.length) out.items = r.items;
    if (!out.charges?.length && r.charges?.length) out.charges = r.charges;
    out.totalCandidates = [...new Set([...(out.totalCandidates || []), ...(r.totalCandidates || [])])].slice(0, 4);
  }
  return out;
}
