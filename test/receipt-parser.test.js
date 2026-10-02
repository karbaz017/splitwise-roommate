import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, findTotal, findDate, findMerchant, parseReceiptText } from '../public/js/receipt-parser.js';

test('parseAmount handles US, EU and Indian formats', () => {
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('12,50'), 12.5);
  assert.equal(parseAmount('1,23,456.00'), 123456);
  assert.equal(parseAmount('1,234'), 1234);
  assert.equal(parseAmount('$42.10'), 42.1);
  assert.equal(parseAmount('abc'), null);
});

const GROCERY = `WHOLE FOODS MARKET
123 Main St  Tel 555-123-4567
Date: 09/14/2026  14:22
Bananas        2.49
Milk           3.99
SUBTOTAL      6.48
TAX            0.52
TOTAL         $7.00
CASH          $10.00
CHANGE         3.00`;

test('grocery receipt', () => {
  const r = parseReceiptText(GROCERY, { categories: ['Groceries', 'Other'] });
  assert.equal(r.total, 7);
  assert.equal(r.date, '2026-09-14');
  assert.equal(r.merchant, 'WHOLE FOODS MARKET');
  assert.equal(r.category, 'Groceries');
});

test('restaurant with tip and amount on next line', () => {
  const t = `Luigi's Pizza\nInvoice No 88231\n12 Sep 2026\nSubtotal 40.00\nGST 4.00\nGrand Total\n₹ 1,244.00`;
  assert.equal(findTotal(t), 1244);
  assert.equal(findDate(t), '2026-09-12');
  assert.equal(findMerchant(t), "Luigi's Pizza");
});

test('utility bill with amount due and european format', () => {
  const t = `Stadtwerke Energie\nRechnung vom 03.09.2026\nAmount due 1.093,40 EUR\nTotal savings 12,00`;
  assert.equal(findTotal(t), 1093.4);
  assert.equal(findDate(t), '2026-09-03');
});

test('total ignores subtotal/tax and falls back to largest decimal amount', () => {
  assert.equal(findTotal('Subtotal 90.00\nTax 9.00\nPaid 99.00'), 99);
  assert.equal(findTotal('Item 3.00\nItem 12.50\nThanks'), 12.5);
  assert.equal(findTotal('hello'), null);
});

test('date formats and sanity', () => {
  assert.equal(findDate('2026-09-01'), '2026-09-01');
  assert.equal(findDate('Sep 5, 2026'), '2026-09-05');
  assert.equal(findDate('31/12/2025'), '2025-12-31');
  assert.equal(findDate('12/31/2025'), '2025-12-31');
  assert.equal(findDate('31.02.2026'), null);
  assert.equal(findDate('01/01/2099', { today: new Date('2026-10-01') }), null);
});

test('garbage text yields no suggestion', () => {
  assert.equal(parseReceiptText('   ').confidence, 0);
});
