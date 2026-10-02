// Optional Splitwise connector. The ledger works fully without it; this only
// imports existing Splitwise history into the local ledger (read-only).
import crypto from 'node:crypto';

const BASE = 'https://secure.splitwise.com/api/v3.0';
const PAGE = 100;
const MAX_PAGES = 30;

export class SplitwiseError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'SplitwiseError';
    this.status = status;
  }
}

const cents = (v) => Math.round(parseFloat(v) * 100);
const fullName = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim() || `Splitwise user ${u?.id}`;

export function explainStatus(status) {
  if (status === 401) return 'Splitwise rejected the API key (401). Check that it is correct and not revoked.';
  if (status === 402 || status === 403) return `Splitwise refused access (${status}). Splitwise now requires the app developer to have an active Pro subscription for API use. You can keep using this ledger without Splitwise.`;
  if (status === 429) return 'Splitwise is rate limiting requests (429). Try again in a few minutes.';
  if (status >= 500) return `Splitwise is having problems (${status}). Try again later; the ledger keeps working.`;
  return `Splitwise returned an error (${status}).`;
}

export function makeClient(token, fetchImpl = fetch) {
  return async function sw(path, params = {}) {
    const url = new URL(`${BASE}/${path}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    let res;
    try {
      res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      throw new SplitwiseError(err.name === 'TimeoutError' ? 'Splitwise did not respond in time.' : 'Could not reach Splitwise. Check your internet connection.');
    }
    if (!res.ok) throw new SplitwiseError(explainStatus(res.status), res.status === 401 ? 401 : 502);
    try {
      return await res.json();
    } catch {
      throw new SplitwiseError('Splitwise returned an unreadable response.');
    }
  };
}

/**
 * Convert one Splitwise expense into a local entry, or return {skip: reason}.
 * `personFor(swUser)` maps a Splitwise user to a local person id.
 */
export function mapExpense(sw, currency, personFor) {
  if (sw.deleted_at) return { skip: 'deleted' };
  if (sw.currency_code && sw.currency_code !== currency) return { skip: `currency ${sw.currency_code}` };
  const amountCents = cents(sw.cost);
  if (!(amountCents > 0)) return { skip: 'zero amount' };
  const users = (sw.users || []).map((u) => ({ id: u.user_id ?? u.user?.id, user: u.user, paid: cents(u.paid_share), owed: cents(u.owed_share) }));
  const paidSum = users.reduce((a, u) => a + u.paid, 0);
  const owedSum = users.reduce((a, u) => a + u.owed, 0);
  if (paidSum !== amountCents || owedSum !== amountCents) return { skip: 'shares do not add up' };
  const paidBy = users.filter((u) => u.paid > 0).map((u) => ({ personId: personFor(u), cents: u.paid }));
  const splits = users.filter((u) => u.owed > 0).map((u) => ({ personId: personFor(u), cents: u.owed }));
  if (!paidBy.length || !splits.length) return { skip: 'no participants' };
  const date = String(sw.date || sw.created_at || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { skip: 'bad date' };
  const isPayment = !!sw.payment;
  return {
    entry: {
      type: isPayment ? 'settlement' : 'expense',
      description: String(sw.description || (isPayment ? 'Settlement' : 'Expense')).slice(0, 200),
      amountCents,
      date,
      category: isPayment ? 'Settlement' : 'Other',
      notes: String(sw.details || '').slice(0, 1000),
      splitMethod: 'exact',
      paidBy,
      splits,
      source: 'splitwise',
      externalId: `sw:${sw.id}`,
      externalUpdatedAt: sw.updated_at || null,
    },
  };
}

// Import everything into the store. Idempotent: re-running updates changed
// entries and skips unchanged ones.
export async function importFromSplitwise(store, token, fetchImpl) {
  const sw = makeClient(token, fetchImpl);
  const { user: me } = await sw('get_current_user');
  const currency = store.data.settings.currency;

  const all = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { expenses = [] } = await sw('get_expenses', { limit: PAGE, offset: page * PAGE });
    all.push(...expenses);
    if (expenses.length < PAGE) break;
  }

  const summary = { fetched: all.length, added: 0, updated: 0, unchanged: 0, removed: 0, skipped: {}, peopleAdded: 0, me: fullName(me) };
  const skip = (reason) => { summary.skipped[reason] = (summary.skipped[reason] || 0) + 1; };

  await store.mutate((d) => {
    const personFor = (u) => {
      const swId = String(u.id);
      let p = d.people.find((x) => x.splitwiseId === swId);
      if (!p) {
        const name = fullName(u.user || { id: u.id });
        p = d.people.find((x) => !x.splitwiseId && x.name.toLowerCase() === name.toLowerCase());
        if (p) p.splitwiseId = swId;
      }
      if (!p) {
        p = { id: crypto.randomUUID(), name: fullName(u.user || { id: u.id }), email: u.user?.email || '', active: true, splitwiseId: swId };
        d.people.push(p);
        summary.peopleAdded++;
      }
      return p.id;
    };

    for (const raw of all) {
      const externalId = `sw:${raw.id}`;
      const idx = d.expenses.findIndex((e) => e.externalId === externalId);
      const { entry, skip: why } = mapExpense(raw, currency, personFor);
      if (why === 'deleted') {
        if (idx >= 0) { d.expenses.splice(idx, 1); summary.removed++; }
        continue;
      }
      if (why) { skip(why); continue; }
      const now = new Date().toISOString();
      if (idx >= 0) {
        const old = d.expenses[idx];
        if (old.externalUpdatedAt === entry.externalUpdatedAt) { summary.unchanged++; continue; }
        d.expenses[idx] = { ...old, ...entry, id: old.id, receipts: old.receipts || [], createdAt: old.createdAt, updatedAt: now };
        summary.updated++;
      } else {
        d.expenses.push({ ...entry, id: crypto.randomUUID(), receipts: [], createdAt: now, updatedAt: now });
        summary.added++;
      }
    }
  });
  return summary;
}
