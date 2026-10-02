import test from 'node:test';
import assert from 'node:assert/strict';
import { toCents, allocate, computeSplits, netBalances, simplifyDebts } from '../src/money.js';

const sum = (a) => a.reduce((x, y) => x + y, 0);

test('toCents handles decimals without float drift', () => {
  assert.equal(toCents('19.99'), 1999);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents('100'), 10000);
  assert.throws(() => toCents('1.234'), /decimal/);
  assert.throws(() => toCents('abc'), /Invalid/);
  assert.throws(() => toCents(''), /required/);
});

test('allocate always sums to the total', () => {
  for (const total of [1, 99, 100, 1000, 3333, 10001]) {
    for (const n of [1, 2, 3, 7]) {
      assert.equal(sum(allocate(total, Array(n).fill(1))), total);
    }
  }
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
});

test('computeSplits: equal, shares, percentage, exact', () => {
  const ps = [{ personId: 'a' }, { personId: 'b' }, { personId: 'c' }];
  assert.deepEqual(computeSplits(1000, 'equal', ps).map((s) => s.cents), [334, 333, 333]);
  assert.deepEqual(
    computeSplits(1000, 'shares', [{ personId: 'a', value: 2 }, { personId: 'b', value: 1 }, { personId: 'c', value: 1 }]).map((s) => s.cents),
    [500, 250, 250],
  );
  assert.deepEqual(
    computeSplits(1000, 'percentage', [{ personId: 'a', value: 50 }, { personId: 'b', value: 30 }, { personId: 'c', value: 20 }]).map((s) => s.cents),
    [500, 300, 200],
  );
  assert.deepEqual(
    computeSplits(1000, 'exact', [{ personId: 'a', value: '4.00' }, { personId: 'b', value: '6.00' }]).map((s) => s.cents),
    [400, 600],
  );
});

test('computeSplits rejects bad input', () => {
  assert.throws(() => computeSplits(1000, 'percentage', [{ personId: 'a', value: 50 }, { personId: 'b', value: 40 }]), /100%/);
  assert.throws(() => computeSplits(1000, 'exact', [{ personId: 'a', value: 5 }]), /add up/);
  assert.throws(() => computeSplits(1000, 'equal', []), /participant/);
  assert.throws(() => computeSplits(1000, 'equal', [{ personId: 'a' }, { personId: 'a' }]), /Duplicate/);
  assert.throws(() => computeSplits(1000, 'shares', [{ personId: 'a', value: 0 }]), /zero/);
  assert.throws(() => computeSplits(1000, 'bogus', [{ personId: 'a' }]), /Unknown/);
});

test('netBalances and simplifyDebts settle everyone', () => {
  const expenses = [
    { paidBy: [{ personId: 'a', cents: 3000 }], splits: [{ personId: 'a', cents: 1000 }, { personId: 'b', cents: 1000 }, { personId: 'c', cents: 1000 }] },
    { paidBy: [{ personId: 'b', cents: 600 }], splits: [{ personId: 'a', cents: 300 }, { personId: 'b', cents: 300 }] },
  ];
  const net = netBalances(expenses, ['a', 'b', 'c']);
  assert.deepEqual(net, { a: 1700, b: -700, c: -1000 });
  assert.equal(sum(Object.values(net)), 0);
  const transfers = simplifyDebts(net);
  const after = { ...net };
  for (const t of transfers) { after[t.from] += t.cents; after[t.to] -= t.cents; }
  assert.deepEqual(Object.values(after), [0, 0, 0]);
});

import { computeItemSplits } from '../src/money.js';

test('computeItemSplits: shared items, tax and tip allocated proportionally', () => {
  // A: pizza 10 (shared with B) ; B: salad 6 ; C: soda 4 ; bill total 25 -> extra 5
  const r = computeItemSplits(2500, [
    { cents: 1000, personIds: ['a', 'b'] },
    { cents: 600, personIds: ['b'] },
    { cents: 400, personIds: ['c'] },
  ]);
  assert.equal(r.itemsCents, 2000);
  assert.equal(r.extraCents, 500);
  const by = Object.fromEntries(r.splits.map((s) => [s.personId, s.cents]));
  // subtotals a=500 b=1100 c=400 ; extra 500 split 500:1100:400 -> 125,275,100
  assert.deepEqual(by, { a: 625, b: 1375, c: 500 });
  assert.equal(sum(Object.values(by)), 2500);
});

test('computeItemSplits: discount, odd cents, and errors', () => {
  const r = computeItemSplits(1999, [
    { cents: 1000, personIds: ['a', 'b', 'c'] },
    { cents: 1000, personIds: ['a'] },
  ]);
  assert.equal(sum(r.splits.map((s) => s.cents)), 1999);
  assert.equal(r.extraCents, -1);
  assert.throws(() => computeItemSplits(1000, [{ cents: 500, personIds: [] }]), /not assigned/);
  assert.throws(() => computeItemSplits(1000, []), /at least one/);
  assert.throws(() => computeItemSplits(1000, [{ cents: 0, personIds: ['a'] }]), /greater than zero/);
});

test('allocate is exact for very large amounts', () => {
  const total = 99_999_999_999;
  assert.equal(sum(allocate(total, [333333, 333333, 333334])), total);
});
