// Turns raw receipt text (from OCR or a PDF text layer) into suggested form values.
// Pure functions, no DOM, so they can be unit tested in Node.

// Parse one numeric token such as "1,234.56", "1.234,56", "1,23,456.00" or "12,50".
export function parseAmount(token) {
  let t = String(token).replace(/[^\d.,]/g, '');
  if (!/\d/.test(t)) return null;
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  let decimalSep = null;
  if (lastDot >= 0 && lastComma >= 0) decimalSep = lastDot > lastComma ? '.' : ',';
  else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = t.split(sep);
    const tail = parts[parts.length - 1];
    // "12,50" / "12.5" is a decimal; "1,234" / "1.234.567" is grouping.
    if (parts.length === 2 && tail.length !== 3) decimalSep = sep;
    else if (parts.length === 2 && tail.length === 3 && parts[0].length > 3) decimalSep = sep;
  }
  if (decimalSep) {
    const idx = t.lastIndexOf(decimalSep);
    t = t.slice(0, idx).replace(/[.,]/g, '') + '.' + t.slice(idx + 1);
  } else {
    t = t.replace(/[.,]/g, '');
  }
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const NUM = /(?<![\d.,])\d{1,3}(?:[.,\s]?\d{2,3})*(?:[.,]\d{1,2})?(?![\d])|(?<![\d.,])\d+(?:[.,]\d{1,2})?(?![\d])/g;

function numbersIn(line) {
  const out = [];
  for (const m of line.matchAll(NUM)) {
    const raw = m[0].replace(/\s+/g, '');
    const v = parseAmount(raw);
    if (v !== null && v > 0 && v < 10_000_000) out.push({ v, raw, hasDecimals: /[.,]\d{2}$/.test(raw) });
  }
  return out;
}

const TOTAL_STRONG = /\b(grand\s*total|total\s*(amount\s*)?(due|payable)|amount\s*(due|payable)|balance\s*due|net\s*(payable|amount|total)|total\s*due|to\s*pay|you\s*pay|invoice\s*total|bill\s*total|total\s*amount|amount\s*paid|total\s*paid)\b/i;
const TOTAL_WEAK = /\btotal\b/i;
const TOTAL_NEG = /\b(sub\s*-?\s*total|total\s*(savings|discount|tax|vat|gst|items?|qty|quantity|points)|tax\s*total|you\s*saved|change|tendered|cash|round(ing)?\s*off)\b/i;

export function findTotal(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const cands = [];
  lines.forEach((line, i) => {
    const strong = TOTAL_STRONG.test(line);
    const weak = TOTAL_WEAK.test(line);
    if (!strong && !weak) return;
    if (TOTAL_NEG.test(line) && !strong) return;
    let nums = numbersIn(line);
    // Amount may sit on the next line ("TOTAL" / "$42.10").
    if (nums.length === 0 && lines[i + 1]) nums = numbersIn(lines[i + 1]);
    if (nums.length === 0) return;
    const best = nums.filter((n) => n.hasDecimals).pop() || nums[nums.length - 1];
    cands.push({ v: best.v, score: (strong ? 3 : 1) + (i / lines.length) + (best.hasDecimals ? 0.5 : 0) });
  });
  if (cands.length) return cands.sort((a, b) => b.score - a.score || b.v - a.v)[0].v;

  // Fallback: the largest amount with decimals anywhere on the receipt.
  const all = lines.flatMap((l) => (/\b(tax|vat|gst|change|cash|tip|phone|tel|invoice\s*no)\b/i.test(l) ? [] : numbersIn(l))).filter((n) => n.hasDecimals);
  return all.length ? Math.max(...all.map((n) => n.v)) : null;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

const iso = (y, m, d) => {
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

export function findDate(text, { today = new Date() } = {}) {
  const found = [];
  let m;
  const ymd = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
  while ((m = ymd.exec(text))) found.push(iso(+m[1], +m[2], +m[3]));
  const named1 = /\b(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]*(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?[\s\-/.,]*(\d{2,4})\b/gi;
  while ((m = named1.exec(text))) found.push(iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]));
  const named2 = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})\b/gi;
  while ((m = named2.exec(text))) found.push(iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]));
  const num = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g;
  while ((m = num.exec(text))) {
    const a = +m[1]; const b = +m[2]; const y = +m[3];
    // Day-first unless it can only be month-first (e.g. 12/31/2025).
    if (a > 12) found.push(iso(y, b, a));
    else if (b > 12) found.push(iso(y, a, b));
    else found.push(iso(y, b, a));
  }
  const limit = new Date(today.getTime() + 2 * 86400000).toISOString().slice(0, 10);
  const valid = found.filter((d) => d && d <= limit);
  return valid[0] || null;
}

const SKIP_LINE = /(receipt|invoice|tax|gst|vat|tel|phone|www\.|http|@|date|time|order|cashier|table|bill\s*no|\d{5,})/i;

export function findMerchant(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 8);
  for (const l of lines) {
    const letters = (l.match(/[A-Za-z]/g) || []).length;
    if (letters >= 3 && letters / l.length > 0.5 && !SKIP_LINE.test(l) && l.length <= 40) {
      return l.replace(/[^\w &'.\-]/g, '').replace(/\s+/g, ' ').trim();
    }
  }
  return null;
}

const CATEGORY_HINTS = [
  ['Groceries', /(grocer|supermarket|mart\b|market|fresh|walmart|costco|aldi|lidl|tesco|kroger|safeway|trader joe|whole foods|bigbasket|dmart|instamart|blinkit|zepto)/i],
  ['Dining out', /(restaurant|cafe|coffee|pizza|burger|grill|kitchen|bistro|diner|bar\b|starbucks|mcdonald|kfc|subway|swiggy|zomato|doordash|ubereats)/i],
  ['Utilities', /(electric|energy|power|water|gas\b|utility|utilities)/i],
  ['Internet', /(internet|broadband|wifi|fiber|telecom|mobile|airtel|jio|comcast|verizon|at&t)/i],
  ['Household', /(ikea|home depot|lowe|bed bath|hardware|cleaning|detergent|pharmacy|chemist|target)/i],
  ['Transport', /(uber|lyft|ola\b|taxi|metro|fuel|petrol|gasoline|parking)/i],
  ['Rent', /\brent\b/i],
];

export function guessCategory(text, categories = []) {
  for (const [cat, re] of CATEGORY_HINTS) if (re.test(text) && (!categories.length || categories.includes(cat))) return cat;
  return null;
}

export function parseReceiptText(text, opts = {}) {
  const clean = String(text || '');
  if (clean.replace(/\s/g, '').length < 8) return { total: null, date: null, merchant: null, category: null, confidence: 0 };
  const total = findTotal(clean);
  const date = findDate(clean, opts);
  const merchant = findMerchant(clean);
  const category = guessCategory(clean, opts.categories);
  const confidence = (total ? 0.5 : 0) + (date ? 0.25 : 0) + (merchant ? 0.25 : 0);
  return { total, date, merchant, category, confidence };
}
