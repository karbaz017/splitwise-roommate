// Optional AI receipt reading (Anthropic Messages API). Only active when the server
// operator sets ANTHROPIC_API_KEY. The receipt image/PDF is sent to Anthropic for
// the single request; nothing is stored there by this app. Local OCR remains the default.
import { sniffType } from './receipts.js';

const API = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MEDIA = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf' };

export class AiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'AiError';
    this.status = status;
  }
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function prompt(categories) {
  return `You are reading a receipt or bill (any language, any layout, possibly rotated or photographed at an angle).
Return ONLY a JSON object, no prose and no code fences, with exactly these keys:
{
 "merchant": string|null,
 "date": "YYYY-MM-DD"|null,
 "currency": "3-letter ISO code"|null,
 "category": one of ${JSON.stringify(categories)} or null,
 "items": [{"name": string, "quantity": number, "amount": number}],
 "subtotal": number|null,
 "charges": [{"kind": "tax"|"tip"|"fee"|"discount", "label": string, "amount": number}],
 "total": number|null
}
Rules: amounts are plain numbers in major units (12.50). "items" are purchased line items: "quantity" is how many (1 if not shown) and "amount" is the final line price (quantity x unit price already multiplied); do not include tax, tip, totals, payments or change as items. "charges" lists every tax line separately (e.g. CGST and SGST as two entries), tip/gratuity, service/delivery/packaging fees, and discounts/coupons (as positive amounts with kind "discount"), each with the label printed on the receipt. "total" is the final amount charged. Use null for anything you cannot read; never guess or invent values. If the date is ambiguous (e.g. 03/04/2026) prefer the format that matches the receipt's country.`;
}

export function parseModelJson(raw) {
  const s = String(raw || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new AiError('The AI reader did not return structured data.');
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch {
    throw new AiError('The AI reader returned malformed data.');
  }
}

export function normalizeAiResult(j, categories = []) {
  const items = (Array.isArray(j.items) ? j.items : [])
    .map((i) => ({ name: text(i?.name, 100) || 'Item', quantity: Math.min(Math.max(Number(i?.quantity) || 1, 1), 9999), amount: num(i?.amount) }))
    .filter((i) => i.amount && i.amount > 0)
    .slice(0, 200);
  const date = typeof j.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.date) && !Number.isNaN(Date.parse(j.date)) ? j.date : null;
  const total = num(j.total);
  const subtotal = num(j.subtotal);
  const LABEL = { tax: 'Tax', tip: 'Tip', fee: 'Service charge', discount: 'Discount' };
  let charges = (Array.isArray(j.charges) ? j.charges : [])
    .map((c) => ({ kind: LABEL[c?.kind] ? c.kind : null, label: text(c?.label, 60), amount: num(c?.amount) }))
    .filter((c) => c.kind && c.amount && c.amount > 0)
    .map((c) => ({ kind: c.kind, label: c.label || LABEL[c.kind], amount: c.amount, mode: c.kind === 'tip' ? 'equal' : 'proportional' }))
    .slice(0, 30);
  if (!charges.length) { // older / simpler model output: scalar fields
    for (const [kind, key] of [['tax', 'tax'], ['tip', 'tip'], ['discount', 'discount']]) {
      const v = num(j[key]);
      if (v && v > 0) charges.push({ kind, label: LABEL[kind], amount: v, mode: kind === 'tip' ? 'equal' : 'proportional' });
    }
  }
  const sum = (k) => { const v = charges.filter((c) => c.kind === k).reduce((a, c) => a + c.amount, 0); return v ? Math.round(v * 100) / 100 : null; };
  const [tax, tip, fee, discount] = ['tax', 'tip', 'fee', 'discount'].map(sum);
  const itemsSum = items.reduce((a, i) => a + i.amount, 0);
  const net = charges.reduce((a, c) => a + (c.kind === 'discount' ? -c.amount : c.amount), 0);
  const near = (a, b) => Math.abs(a - b) <= 0.02;
  const reconciled = !!total && ((items.length && near(itemsSum + net, total)) || (subtotal != null && near(subtotal + net, total)));
  const cat = categories.includes(j.category) ? j.category : null;
  const currency = typeof j.currency === 'string' && /^[A-Za-z]{3}$/.test(j.currency) ? j.currency.toUpperCase() : null;
  return {
    total, subtotal, tax, tip, fee, discount, charges, date, currency, category: cat,
    merchant: text(j.merchant, 60), items,
    totalCandidates: total ? [total] : [], reconciled,
    confidence: !total ? 0.3 : reconciled ? 0.95 : 0.75,
    source: 'ai',
  };
}

export async function analyzeWithAi({ apiKey, model = DEFAULT_MODEL, buffer, categories, fetchImpl = fetch }) {
  const ext = sniffType(buffer);
  const media = MEDIA[ext];
  if (!media) throw new AiError('The AI reader supports JPG, PNG, WebP, GIF and PDF files.', 415);
  const block = ext === 'pdf'
    ? { type: 'document', source: { type: 'base64', media_type: media, data: buffer.toString('base64') } }
    : { type: 'image', source: { type: 'base64', media_type: media, data: buffer.toString('base64') } };
  let res;
  try {
    res = await fetchImpl(API, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 2500, messages: [{ role: 'user', content: [block, { type: 'text', text: prompt(categories) }] }] }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    throw new AiError(err.name === 'TimeoutError' ? 'The AI reader timed out.' : 'Could not reach the AI reader.');
  }
  if (!res.ok) {
    const hint = res.status === 401 ? ' (check ANTHROPIC_API_KEY)' : res.status === 429 ? ' (rate limited)' : '';
    throw new AiError(`The AI reader returned an error (${res.status})${hint}.`);
  }
  const body = await res.json().catch(() => ({}));
  const out = (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return normalizeAiResult(parseModelJson(out), categories);
}
