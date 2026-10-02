// Draft expenses: half-finished entries (e.g. a scanned grocery receipt whose items
// are not assigned yet). Validation is deliberately relaxed, the form is stored as
// sanitized data, and drafts are excluded from balances, lists, exports and
// duplicate checks until they are finalized through the normal (strict) path.
import crypto from 'node:crypto';
import { ValidationError, toCents } from './money.js';
import { CHARGE_KINDS, validDate } from './ledger.js';

export const MAX_DRAFTS_PER_OWNER = 50;
const METHODS = ['equal', 'exact', 'percentage', 'shares', 'items'];

const s = (v, max) => (v === undefined || v === null ? '' : String(v).slice(0, max));
const numStr = (v) => s(v, 20); // numeric inputs are kept as typed

export function sanitizeForm(form, knownIds) {
  const f = form && typeof form === 'object' ? form : {};
  const known = (id) => typeof id === 'string' && knownIds.has(id);
  let date = '';
  try { date = f.date ? validDate(String(f.date)) : ''; } catch { date = ''; }
  return {
    description: s(f.description, 200),
    amount: numStr(f.amount),
    date,
    category: s(f.category, 50),
    notes: s(f.notes, 1000),
    splitMethod: METHODS.includes(f.splitMethod) ? f.splitMethod : 'equal',
    multiPayer: !!f.multiPayer,
    paidById: known(f.paidById) ? f.paidById : '',
    rows: (Array.isArray(f.rows) ? f.rows : []).slice(0, 50).filter((r) => known(r?.personId))
      .map((r) => ({ personId: r.personId, included: !!r.included, value: numStr(r.value), paid: numStr(r.paid) })),
    items: (Array.isArray(f.items) ? f.items : []).slice(0, 200).map((it) => ({
      name: s(it?.name, 100), quantity: numStr(it?.quantity ?? it?.qty ?? 1), unit: numStr(it?.unit), amount: numStr(it?.amount ?? it?.total),
      personIds: (Array.isArray(it?.personIds) ? it.personIds : []).filter(known).slice(0, 50),
    })),
    charges: (Array.isArray(f.charges) ? f.charges : []).slice(0, 30).map((c) => ({
      kind: CHARGE_KINDS.includes(c?.kind) ? c.kind : 'fee', label: s(c?.label, 60), amount: numStr(c?.amount), mode: c?.mode === 'equal' ? 'equal' : 'proportional',
    })),
  };
}

export function createDraft(ownerId, form, people, existing = null) {
  const knownIds = new Set(people.map((p) => p.id));
  if (!knownIds.has(ownerId)) throw new ValidationError('Choose who is saving this draft (the "Viewing as" person)');
  const clean = sanitizeForm(form, knownIds);
  let amountCents = 0;
  try { amountCents = Math.max(0, toCents(clean.amount)); } catch { /* unparsable amounts are fine in a draft */ }
  const now = new Date().toISOString();
  return {
    id: existing?.id || crypto.randomUUID(),
    draft: true,
    ownerId,
    type: 'expense',
    description: clean.description.trim() || 'Untitled draft',
    amountCents,
    date: clean.date || now.slice(0, 10),
    category: clean.category || 'Other',
    notes: clean.notes,
    paidBy: [],
    splits: [],
    receipts: existing?.receipts || [],
    source: 'local',
    draftForm: clean,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}
