import crypto from 'node:crypto';
import { ValidationError, toCents, computeSplits } from './money.js';

export const CATEGORIES = [
  'Rent', 'Utilities', 'Internet', 'Groceries', 'Household', 'Dining out',
  'Entertainment', 'Transport', 'Maintenance', 'Other',
];

const newId = () => crypto.randomUUID();

function str(value, field, { max, required = false } = {}) {
  const s = value === undefined || value === null ? '' : String(value).trim();
  if (required && !s) throw new ValidationError(`${field} is required`);
  if (s.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return s;
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError('Date must be in YYYY-MM-DD format');
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new ValidationError(`Invalid date: ${value}`);
  }
  return value;
}

export function normalizePerson(body, existing = {}) {
  const person = { ...existing };
  if (body.name !== undefined || !existing.id) person.name = str(body.name, 'Name', { max: 60, required: true });
  if (body.email !== undefined) person.email = str(body.email, 'Email', { max: 120 });
  if (body.active !== undefined) person.active = !!body.active;
  person.id = existing.id || newId();
  person.active = person.active !== false;
  person.email = person.email || '';
  return person;
}

/**
 * Validate an incoming expense/settlement payload and turn it into the stored
 * shape. Amounts become integer cents; owed shares are computed server-side.
 */
export function normalizeExpense(body, people, existing = null) {
  const type = body.type === 'settlement' ? 'settlement' : 'expense';
  const known = new Set(people.map((p) => p.id));
  const mustKnow = (id) => {
    if (!known.has(id)) throw new ValidationError(`Unknown person: ${id}`);
    return id;
  };

  const amountCents = toCents(body.amount);
  if (amountCents <= 0) throw new ValidationError('Amount must be greater than zero');

  const out = {
    id: existing?.id || newId(),
    type,
    description: str(body.description || (type === 'settlement' ? 'Settlement' : ''), 'Description', { max: 200, required: true }),
    amountCents,
    date: validDate(body.date),
    category: type === 'settlement' ? 'Settlement' : str(body.category || 'Other', 'Category', { max: 50 }),
    notes: str(body.notes, 'Notes', { max: 1000 }),
    receipts: existing?.receipts || [],
    source: existing?.source || 'local',
    externalId: existing?.externalId,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (type === 'settlement') {
    const from = mustKnow(body.from);
    const to = mustKnow(body.to);
    if (from === to) throw new ValidationError('A settlement needs two different people');
    out.splitMethod = 'exact';
    out.paidBy = [{ personId: from, cents: amountCents }];
    out.splits = [{ personId: to, cents: amountCents }];
    return out;
  }

  const method = body.splitMethod || 'equal';
  const participants = (body.participants || []).map((p) => ({ ...p, personId: mustKnow(p.personId) }));
  out.splitMethod = method;
  out.splits = computeSplits(amountCents, method, participants);

  const rawPayers = Array.isArray(body.paidBy) ? body.paidBy : [];
  if (rawPayers.length === 0) throw new ValidationError('Who paid? At least one payer is required');
  let payers;
  if (rawPayers.length === 1 && (rawPayers[0].amount === undefined || rawPayers[0].amount === '')) {
    payers = [{ personId: mustKnow(rawPayers[0].personId), cents: amountCents }];
  } else {
    payers = rawPayers.map((p) => ({ personId: mustKnow(p.personId), cents: toCents(p.amount) }));
  }
  if (new Set(payers.map((p) => p.personId)).size !== payers.length) {
    throw new ValidationError('Duplicate payer');
  }
  if (payers.some((p) => p.cents < 0)) throw new ValidationError('Paid amounts cannot be negative');
  payers = payers.filter((p) => p.cents > 0);
  const paidSum = payers.reduce((a, p) => a + p.cents, 0);
  if (paidSum !== amountCents) {
    throw new ValidationError(`Paid amounts add up to ${(paidSum / 100).toFixed(2)} but the total is ${(amountCents / 100).toFixed(2)}`);
  }
  out.paidBy = payers;
  return out;
}
