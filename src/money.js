// Money helpers. All amounts are handled as integer minor units (cents) to avoid
// floating point drift. Anything crossing the API boundary is converted here.

export const MAX_CENTS = 100_000_000_000; // 1 billion major units, far beyond any household

export function toCents(value) {
  if (value === null || value === undefined || value === '') {
    throw new ValidationError('Amount is required');
  }
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) throw new ValidationError(`Invalid amount: ${value}`);
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) {
    throw new ValidationError(`Amount "${value}" has more than 2 decimal places`);
  }
  if (Math.abs(cents) > MAX_CENTS) throw new ValidationError('Amount is too large');
  return cents;
}

export function fromCents(cents) {
  return Math.round(cents) / 100;
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

// Distribute `total` cents proportionally to integer `weights` using the
// largest-remainder method. The result always sums exactly to `total`.
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new ValidationError('Split weights must add up to more than zero');
  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map(Math.floor);
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) floors[order[k].i] += 1;
  return floors;
}

/**
 * Compute each participant's owed share.
 * @param {number} total   total cost in cents
 * @param {string} method  equal | exact | percentage | shares
 * @param {{personId:string,value?:number|string}[]} participants
 * @returns {{personId:string,cents:number}[]}
 */
export function computeSplits(total, method, participants) {
  if (!Array.isArray(participants) || participants.length === 0) {
    throw new ValidationError('At least one participant is required');
  }
  const ids = participants.map((p) => p.personId);
  if (new Set(ids).size !== ids.length) throw new ValidationError('Duplicate participant in split');

  let cents;
  switch (method) {
    case 'equal':
      cents = allocate(total, ids.map(() => 1));
      break;
    case 'shares': {
      const w = participants.map((p) => Math.round(Number(p.value ?? 1) * 100));
      if (w.some((x) => !Number.isFinite(x) || x < 0)) throw new ValidationError('Invalid share value');
      cents = allocate(total, w);
      break;
    }
    case 'percentage': {
      const w = participants.map((p) => Math.round(Number(p.value ?? 0) * 100));
      if (w.some((x) => !Number.isFinite(x) || x < 0)) throw new ValidationError('Invalid percentage');
      const sum = w.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 10000) > 1) throw new ValidationError('Percentages must add up to 100%');
      cents = allocate(total, w);
      break;
    }
    case 'exact': {
      cents = participants.map((p) => toCents(p.value ?? 0));
      if (cents.some((c) => c < 0)) throw new ValidationError('Exact amounts cannot be negative');
      const sum = cents.reduce((a, b) => a + b, 0);
      if (sum !== total) {
        throw new ValidationError(`Exact amounts add up to ${fromCents(sum).toFixed(2)} but the total is ${fromCents(total).toFixed(2)}`);
      }
      break;
    }
    default:
      throw new ValidationError(`Unknown split method: ${method}`);
  }
  return ids.map((personId, i) => ({ personId, cents: cents[i] }));
}

// Net balance per person: positive = is owed money, negative = owes money.
export function netBalances(expenses, personIds = []) {
  const net = Object.fromEntries(personIds.map((id) => [id, 0]));
  for (const e of expenses) {
    for (const p of e.paidBy) net[p.personId] = (net[p.personId] || 0) + p.cents;
    for (const s of e.splits) net[s.personId] = (net[s.personId] || 0) - s.cents;
  }
  return net;
}

// Minimal-ish list of transfers that settles everyone (greedy matching).
export function simplifyDebts(net) {
  const creditors = [];
  const debtors = [];
  for (const [id, v] of Object.entries(net)) {
    if (v > 0) creditors.push({ id, v });
    else if (v < 0) debtors.push({ id, v: -v });
  }
  creditors.sort((a, b) => b.v - a.v);
  debtors.sort((a, b) => b.v - a.v);
  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].v, creditors[j].v);
    transfers.push({ from: debtors[i].id, to: creditors[j].id, cents: amount });
    debtors[i].v -= amount;
    creditors[j].v -= amount;
    if (debtors[i].v === 0) i++;
    if (creditors[j].v === 0) j++;
  }
  return transfers;
}
