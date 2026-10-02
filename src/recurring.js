// Recurring monthly bills (rent, internet, subscriptions). A rule stores an expense
// template plus a day of month; due entries are generated automatically, including
// catching up on months missed while the server was off.
import crypto from 'node:crypto';
import { ValidationError } from './money.js';
import { normalizeExpense } from './ledger.js';

const MAX_CATCH_UP = 36;
const pad = (n) => String(n).padStart(2, '0');
export const ym = (iso) => iso.slice(0, 7);
export const nextMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1)}`;
};
const dateFor = (month, day) => `${month}-${pad(day)}`;

export function normalizeRule(body, people, existing = null) {
  const day = Number(body.day);
  if (!Number.isInteger(day) || day < 1 || day > 28) throw new ValidationError('Day of month must be between 1 and 28');
  const { day: _d, startMonth, active, ...template } = body;
  const first = /^\d{4}-\d{2}$/.test(startMonth || '') ? startMonth : ym(new Date().toISOString());
  // Validate the template by building a real entry from it.
  normalizeExpense({ ...template, date: dateFor(first, day) }, people);
  if (template.type === 'settlement') throw new ValidationError('Settlements cannot repeat');
  return {
    id: existing?.id || crypto.randomUUID(),
    template,
    day,
    // lastGenerated is the month *before* the first one to generate.
    lastGenerated: existing?.lastGenerated ?? previousMonth(first),
    active: active === undefined ? existing?.active !== false : !!active,
    createdAt: existing?.createdAt || new Date().toISOString(),
    lastError: null,
  };
}

const previousMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${pad(mo - 1)}`;
};

export const nextDue = (rule) => dateFor(nextMonth(rule.lastGenerated), rule.day);

/** Create every entry that is due as of `now`. Returns how many were created. */
export async function runRecurring(store, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  let created = 0;
  await store.mutate((d) => {
    for (const rule of d.recurring || []) {
      if (!rule.active) continue;
      for (let i = 0; i < MAX_CATCH_UP; i++) {
        const month = nextMonth(rule.lastGenerated);
        const date = dateFor(month, rule.day);
        if (date > today) break;
        const externalId = `rec:${rule.id}:${month}`;
        if (!d.expenses.some((e) => e.externalId === externalId)) {
          try {
            const e = normalizeExpense({ ...rule.template, date }, d.people);
            e.source = 'recurring';
            e.externalId = externalId;
            d.expenses.push(e);
            created++;
          } catch (err) {
            rule.lastError = `${month}: ${err.message}`; // e.g. a roommate was removed; user must edit the rule
            break;
          }
        }
        rule.lastGenerated = month;
        rule.lastError = null;
      }
    }
  });
  return created;
}
