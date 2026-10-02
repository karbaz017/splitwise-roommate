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

const CUR = '[$€£₹¥]';
const NUM = /(?<![\d.,])\d{1,3}(?:[.,\s]?\d{2,3})*(?:[.,]\d{1,2})?(?![\d])|(?<![\d.,])\d+(?:[.,]\d{1,2})?(?![\d])/g;

// ---------------------------------------------------------------- OCR clean-up
// Fix the character confusions OCR makes inside numbers (O/0, l/1, S/5, B/8) and
// stray spaces around decimal separators, without touching ordinary words.
export function normalizeOcrText(text) {
  const MAP = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', '|': '1', i: '1', S: '5', s: '5', B: '8', Z: '2', z: '2' };
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[‘’´`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .split('\n')
    .map((line) => line
      .replace(/\t+/g, '  ')
      // "12 . 50" / "12 ,50" -> "12.50"
      .replace(/(\d)\s+([.,])\s*(\d{2})(?!\d)/g, '$1$2$3')
      .replace(/(\d)([.,])\s+(\d{2})(?!\d)/g, '$1$2$3')
      .split(/(\s+)/)
      .map((tok) => {
        // Only repair tokens that are clearly prices: digits plus confusable letters and a decimal part.
        if (!/\d/.test(tok) || !/[.,][\dOoDQIl|iSsBZz]{2}$/.test(tok)) return tok;
        if (!/^[-($€£₹¥]*[\dOoDQIl|iSsBZz.,]+\)?$/.test(tok)) return tok;
        const digits = (tok.match(/\d/g) || []).length;
        if (digits < 2) return tok;
        return tok.replace(/[OoDQIl|iSsBZz]/g, (c) => MAP[c]);
      })
      .join(''))
    .join('\n');
}

function numbersIn(line) {
  const out = [];
  for (const m of line.matchAll(NUM)) {
    const raw = m[0].replace(/\s+/g, '');
    const v = parseAmount(raw);
    if (v !== null && v > 0 && v < 10_000_000) out.push({ v, raw, hasDecimals: /[.,]\d{2}$/.test(raw) });
  }
  return out;
}

const splitLines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

// ---------------------------------------------------------------- totals
const TOTAL_STRONG = /\b(grand\s*total|total\s*(amount\s*)?(due|payable)|amount\s*(due|payable)|balance\s*due|net\s*(payable|amount|total)|total\s*due|to\s*pay|you\s*pay|invoice\s*total|bill\s*total|total\s*amount|amount\s*paid|total\s*paid|total\s*charge|order\s*total|total\s*sale|total\s*bill)\b/i;
const TOTAL_WEAK = /\btotal\b/i;
const TOTAL_NEG = /\b(sub\s*-?\s*total|total\s*(savings|discount|tax|vat|gst|items?|qty|quantity|points|tips?)|tax\s*total|you\s*saved|change|tendered|round(ing)?\s*off|items?\s*sold|number\s*of)\b/i;

export function totalCandidates(lines, { fallback = true } = {}) {
  const cands = [];
  lines.forEach((line, i) => {
    const strong = TOTAL_STRONG.test(line);
    const weak = TOTAL_WEAK.test(line);
    if (!strong && !weak) return;
    if (TOTAL_NEG.test(line) && !strong) return;
    let nums = numbersIn(line);
    if (nums.length === 0 && lines[i + 1]) nums = numbersIn(lines[i + 1]); // "TOTAL" / "$42.10"
    if (nums.length === 0) return;
    const best = nums.filter((n) => n.hasDecimals).pop() || nums[nums.length - 1];
    if (!best.hasDecimals && best.v > 99999) return; // OCR junk, not a plausible bill
    cands.push({ v: best.v, score: (strong ? 3 : 1) + (i / lines.length) + (best.hasDecimals ? 0.5 : -1.5) });
  });
  if (!cands.length && fallback) {
    const rest = lines.flatMap((l) => (/\b(tax|vat|gst|change|cash|tip|phone|tel|invoice\s*no|card|visa|auth|ref)\b/i.test(l) ? [] : numbersIn(l))).filter((n) => n.hasDecimals);
    const max = rest.length ? Math.max(...rest.map((n) => n.v)) : null;
    if (max) cands.push({ v: max, score: 0.2, fallback: true });
  }
  return cands;
}

export function findTotal(text) {
  const c = totalCandidates(splitLines(normalizeOcrText(text))).sort((a, b) => b.score - a.score || b.v - a.v);
  return c.length ? c[0].v : null;
}

// ---------------------------------------------------------------- labelled amounts + line items
function labelled(lines, re, { excludeRe, sum = false } = {}) {
  const vals = [];
  lines.forEach((line, i) => {
    if (!re.test(line) || (excludeRe && excludeRe.test(line))) return;
    let nums = numbersIn(line).filter((n) => n.hasDecimals);
    if (!nums.length && lines[i + 1] && !/[A-Za-z]{3,}/.test(lines[i + 1])) nums = numbersIn(lines[i + 1]).filter((n) => n.hasDecimals);
    if (nums.length) vals.push(nums[nums.length - 1].v);
  });
  if (!vals.length) return null;
  return sum ? Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100 : vals[vals.length - 1];
}

const NON_ITEM = /\b(sub\s*-?\s*total|total|tax|vat|gst|hst|pst|cgst|sgst|igst|tips?|gratuity|service\s*(charge|fee)|surcharge|delivery|change|cash|card|visa|master\s*card|mastercard|amex|debit|credit|tender(ed)?|balance|amount|due|paid|payment|you\s*saved|savings?|round(ing)?|points|rewards?|auth|approval|ref|invoice|order|table|guest|server|cashier|phone|tel|fax|item\s*count|items?\s*sold|thank|welcome)\b/i;
const DISCOUNT = /\b(coupon|discount|promo(tion)?|offer|markdown|member\s*savings|deal)\b/i;
const ITEM_RE = /^(.*?[A-Za-z].*?)[\s.:_-]*(-?\s*[$€£₹¥]?\s?(?:\d{1,3}(?:[.,]\d{3})+|\d+)[.,]\d{2})\s*(-|[A-Za-z]{1,2})?$/;

const titleCase = (n) => (n.length > 3 && n === n.toUpperCase() ? n.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : n);

// Returns the cleaned item name and the quantity printed on the line (default 1).
function parseItemName(raw) {
  let quantity = 1;
  let n = raw;
  const at = n.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*[@xX]\\s*${CUR}?\\s?\\d+[.,]\\d{2}\\b`)); // "2 @ 3.50"
  const lead = n.match(/^\s*(\d{1,2}(?:\.\d+)?)\s*[xX]\s+/); // "2 x Milk"
  const plain = n.match(/^\s*(\d{1,2})\s+(?=[A-Za-z]{2})/); // "3 Beer"
  if (at) { quantity = Number(at[1]); n = n.replace(at[0], ' '); }
  else if (lead) { quantity = Number(lead[1]); n = n.replace(lead[0], ''); }
  else if (plain) { quantity = Number(plain[1]); n = n.replace(plain[0], ''); }
  n = n
    .replace(/^\s*\d{4,}\s+/, '') // SKU / PLU
    .replace(/\s+\d{4,}\s*$/, '')
    .replace(/\s+[A-Z]$/, '') // tax-code flag column (F, T, A)
    .replace(/[^\w &'.,%/+()-]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { name: titleCase(n).slice(0, 100), quantity: quantity > 0 && quantity < 1000 ? quantity : 1 };
}

export function findItems(lines) {
  const items = [];
  const discounts = [];
  for (const line of lines) {
    const m = line.match(ITEM_RE);
    if (!m) continue;
    const letters = (m[1].match(/[A-Za-z]/g) || []).length;
    if (letters < 2) continue;
    const price = parseAmount(m[2].replace(/-/g, ''));
    if (!price || price <= 0) continue;
    const negative = /-\s*[$€£₹¥]?\s?\d/.test(m[2]) || m[3] === '-';
    if (DISCOUNT.test(m[1]) || negative) {
      if (!/\b(total|you\s*saved|tax|tender|change)\b/i.test(m[1])) {
        discounts.push({ name: titleCase(m[1].replace(/[^\w &'.,%/+()-]/g, ' ').replace(/\s{2,}/g, ' ').trim()).slice(0, 60) || 'Discount', amount: price });
      }
      continue;
    }
    if (NON_ITEM.test(m[1])) continue;
    const { name, quantity } = parseItemName(m[1]);
    if (name.replace(/[^A-Za-z]/g, '').length < 2) continue;
    items.push({ name, quantity, amount: price });
  }
  const discount = Math.round(discounts.reduce((a, d) => a + d.amount, 0) * 100) / 100;
  return { items, discounts, discount };
}

// ---------------------------------------------------------------- charges (tax, tip, fees, discounts)
const TAX_RE = /\b(sales\s*tax|tax|vat|gst|hst|pst|cgst|sgst|igst)\b/i;
const TAX_EXCL = /(sub\s*-?\s*total|total\s*(amount|due|payable|bill)|before\s*tax|tax\s*(id|no|number|invoice|exempt)|gstin|vat\s*(id|no|reg)|inclusive|incl\b|taxable)/i;
const TAX_AGG = /(total\s*tax|tax\s*total)/i;
const TIP_RE = /\b(tip|gratuity)\b/i;
const FEE_RE = /\b(service\s*(charge|fee)|surcharge|delivery(\s*(fee|charge))?|packaging|convenience\s*fee|booking\s*fee|platform\s*fee|cover\s*charge)\b/i;
const SUGGESTION = /(suggest|recommend|guide|if\s+you|option|calculator)/i;

const labelOf = (line, fallback) => {
  const l = line.replace(/[$€£₹¥]?\s?\d[\d.,]*\s*%?/g, ' ').replace(/[:*_=-]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return l.length >= 2 ? titleCase(l).slice(0, 60) : fallback;
};

/** Individual tax / tip / fee / discount lines in receipt order. */
export function findCharges(lines, discounts = []) {
  const out = [];
  lines.forEach((line, i) => {
    if (SUGGESTION.test(line)) return;
    let kind = null;
    if (TIP_RE.test(line)) kind = 'tip';
    else if (FEE_RE.test(line)) kind = 'fee';
    else if (TAX_RE.test(line) && !TAX_EXCL.test(line)) kind = 'tax';
    if (!kind) return;
    let nums = numbersIn(line).filter((n) => n.hasDecimals);
    if (!nums.length && lines[i + 1] && !/[A-Za-z]{3,}/.test(lines[i + 1])) nums = numbersIn(lines[i + 1]).filter((n) => n.hasDecimals);
    if (!nums.length) return;
    const fallback = { tax: 'Tax', tip: 'Tip', fee: 'Service charge' }[kind];
    out.push({ kind, label: labelOf(line, fallback), amount: nums[nums.length - 1].v, agg: kind === 'tax' && TAX_AGG.test(line), order: i, mode: kind === 'tip' ? 'equal' : 'proportional' });
  });
  // "Total tax" next to its components would double count: keep the components.
  const parts = out.filter((c) => c.kind === 'tax' && !c.agg);
  const charges = out.filter((c) => !(c.agg && parts.length >= 2));
  discounts.forEach((d) => charges.push({ kind: 'discount', label: d.name, amount: d.amount, order: 1e6, mode: 'proportional' }));
  return charges.sort((a, b) => a.order - b.order).map(({ order, agg, ...c }) => c);
}

// ---------------------------------------------------------------- dates
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
  const t = text.replace(/\s*([/.-])\s*/g, (m, sep, off, str) => (/\d/.test(str[off - 1] || '') && /\d/.test(str[off + m.length] || '') ? sep : m));
  let m;
  const ymd = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
  while ((m = ymd.exec(t))) found.push(iso(+m[1], +m[2], +m[3]));
  const named1 = /\b(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]*(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?[\s\-/.,]*(\d{2,4})\b/gi;
  while ((m = named1.exec(t))) found.push(iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]));
  const named2 = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})\b/gi;
  while ((m = named2.exec(t))) found.push(iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]));
  const num = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g;
  while ((m = num.exec(t))) {
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

// ---------------------------------------------------------------- merchant, category, currency
const SKIP_LINE = /(receipt|invoice|tax|gst|vat|tel|phone|www\.|http|@|date|time|order|cashier|table|bill\s*no|welcome|thank|\d{5,})/i;

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
  ['Groceries', /(grocer|supermarket|mart\b|market|fresh|walmart|costco|aldi|lidl|tesco|kroger|safeway|trader joe|whole foods|bigbasket|dmart|instamart|blinkit|zepto|produce|dairy|bakery|spar\b|carrefour|woolworths|coles)/i],
  ['Dining out', /(restaurant|cafe|coffee|pizza|burger|grill|kitchen|bistro|diner|bar\b|pub\b|starbucks|mcdonald|kfc|subway|swiggy|zomato|doordash|ubereats|server|table|gratuity|tip\b)/i],
  ['Utilities', /(electric|energy|power|water|gas\b|utility|utilities|kwh)/i],
  ['Internet', /(internet|broadband|wifi|fiber|telecom|mobile|airtel|jio|comcast|verizon|at&t)/i],
  ['Household', /(ikea|home depot|lowe|bed bath|hardware|cleaning|detergent|pharmacy|chemist|target)/i],
  ['Transport', /(uber|lyft|ola\b|taxi|metro|fuel|petrol|gasoline|parking)/i],
  ['Rent', /\brent\b/i],
];

export function guessCategory(text, categories = []) {
  for (const [cat, re] of CATEGORY_HINTS) if (re.test(text) && (!categories.length || categories.includes(cat))) return cat;
  return null;
}

// Only report a currency when the receipt is explicit; a bare "$" is ambiguous.
export function findCurrency(text) {
  const code = text.match(/\b(USD|EUR|GBP|INR|CAD|AUD|JPY|CHF|SGD|AED|MXN|NZD|SEK|NOK|DKK|ZAR|CNY)\b/);
  if (code) return code[1];
  if (/₹|\bRs\.?\s?\d|\bINR\b/i.test(text)) return 'INR';
  if (/€/.test(text)) return 'EUR';
  if (/£/.test(text)) return 'GBP';
  return null;
}

// ---------------------------------------------------------------- main entry
const near = (a, b) => a != null && b != null && Math.abs(a - b) <= 0.011;
const round2 = (n) => Math.round(n * 100) / 100;

export function parseReceiptText(text, opts = {}) {
  const clean = normalizeOcrText(text);
  const empty = { total: null, subtotal: null, tax: null, tip: null, fee: null, discount: null, charges: [], date: null, merchant: null, category: null, currency: null, items: [], totalCandidates: [], reconciled: false, confidence: 0 };
  if (clean.replace(/\s/g, '').length < 8) return empty;
  const lines = splitLines(clean);

  const subtotal = labelled(lines, /\bsub\s*-?\s*total\b|\bmerchandise\b|\bitems?\s*total\b/i);
  const { items, discounts, discount } = findItems(lines);
  const charges = findCharges(lines, discounts);
  const sumOf = (kind) => { const v = charges.filter((c) => c.kind === kind).reduce((a, c) => a + c.amount, 0); return v ? Math.round(v * 100) / 100 : null; };
  const tax = sumOf('tax');
  const tip = sumOf('tip');
  const fee = sumOf('fee');
  const itemsSum = round2(items.reduce((a, i) => a + i.amount * 1, 0));

  // Candidate totals, boosted when they reconcile with subtotal/tax/tip or the item list.
  const cands = totalCandidates(lines, { fallback: false });
  const base = [subtotal, items.length ? itemsSum : null].filter((x) => x != null);
  const expected = [];
  base.forEach((b) => {
    for (let mask = 0; mask < 8; mask++) {
      const add = (mask & 1 ? tax || 0 : 0) + (mask & 2 ? tip || 0 : 0) + (mask & 4 ? fee || 0 : 0);
      expected.push(round2(b + add - (discount || 0)));
      expected.push(round2(b + add));
    }
  });
  cands.forEach((c) => { if (expected.some((e) => near(e, c.v))) { c.score += 3; c.reconciled = true; } });
  // Nothing labelled as total but subtotal + tax is known: compute it (low confidence).
  if (!cands.length && subtotal != null && tax != null) cands.push({ v: round2(subtotal + tax + (tip || 0) + (fee || 0)), score: 0.1, computed: true });
  if (!cands.length) cands.push(...totalCandidates(lines));
  cands.sort((a, b) => b.score - a.score || b.v - a.v);
  const uniq = [];
  cands.forEach((c) => { if (!uniq.some((u) => near(u.v, c.v))) uniq.push(c); });
  const top = uniq[0];
  const total = top ? top.v : null;
  const reconciled = !!top?.reconciled;

  const date = findDate(clean, opts);
  const merchant = findMerchant(clean);
  const category = guessCategory(clean, opts.categories);
  const currency = findCurrency(clean);
  const confidence = Math.min(top?.fallback ? 0.35 : top?.computed ? 0.5 : 1, (total ? 0.4 : 0) + (reconciled ? 0.25 : 0) + (date ? 0.15 : 0) + (merchant ? 0.1 : 0) + (items.length ? 0.1 : 0));
  return {
    total, subtotal, tax, tip, fee, discount: discount || null, charges, date, merchant, category, currency, items,
    totalCandidates: uniq.slice(0, 4).map((c) => c.v), reconciled, confidence,
  };
}
