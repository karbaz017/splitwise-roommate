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

import { normalizeOcrText, findItems, findCurrency } from '../public/js/receipt-parser.js';

test('normalizeOcrText repairs prices but not words', () => {
  const t = normalizeOcrText('TOTAL $9.O4\nB0LOGNA 3.9S\nSOLD 12 . 50\nHello World 2 pcs');
  assert.match(t, /TOTAL \$9\.04/);
  assert.match(t, /3\.95/);
  assert.match(t, /12\.50/);
  assert.match(t, /Hello World 2 pcs/);
});

const WALMART = `WALMART SUPERCENTER
Store #1234  Tel 555-010-9999
09/14/26 14:22
004011 BANANAS     F      1.49
068113 ORG MILK 2 @ 3.50   7.00 T
COUPON SAVINGS         1.00-
BREAD WHL WHEAT        2.99
SUBTOTAL              10.48
TAX 6.5%               0.53
TOTAL                 11.01
VISA TEND             11.01
CHANGE DUE             0.00`;

test('grocery receipt: items, discount, tax reconcile to total', () => {
  const r = parseReceiptText(WALMART, { categories: ['Groceries', 'Other'] });
  assert.equal(r.total, 11.01);
  assert.equal(r.subtotal, 10.48);
  assert.equal(r.tax, 0.53);
  assert.equal(r.discount, 1);
  assert.equal(r.date, '2026-09-14');
  assert.equal(r.reconciled, true);
  assert.deepEqual(r.items.map((i) => i.amount), [1.49, 7, 2.99]);
  assert.equal(r.items[0].name, 'Bananas');
  assert.equal(r.items[1].name, 'Org Milk');
  assert.equal(r.category, 'Groceries');
  assert.ok(r.confidence >= 0.8);
});

const RESTAURANT = `The Olive Garden
Table 12  Server: Sam
2 x Margherita Pizza    26.00
Caesar Salad            9.50
Sparkling Water         4.00
Subtotal               39.50
Sales Tax               3.16
Tip 18%                 7.11
Total                  49.77`;

test('restaurant: tip + tax reconcile, items listed', () => {
  const r = parseReceiptText(RESTAURANT);
  assert.equal(r.total, 49.77);
  assert.equal(r.tip, 7.11);
  assert.equal(r.items.length, 3);
  assert.equal(r.items[0].name, 'Margherita Pizza');
  assert.equal(r.items[0].amount, 26);
  assert.equal(r.reconciled, true);
  assert.equal(r.category, 'Dining out');
});

test('OCR-damaged total is repaired and chosen over subtotal', () => {
  const r = parseReceiptText(`CORNER CAFE\nLatte  4.5O\nMuffin  3.2S\nSUBT0TAL  7.75\nTAX  0.62\nT0TAL  8.37`);
  assert.equal(r.total, 8.37);
});

test('Indian GST bill with CGST/SGST and rupee symbol', () => {
  const t = `Sharma Kirana Store\nGSTIN 27ABCDE1234F1Z5\nBill Date: 14-09-2026\nRice 5kg   ₹ 320.00\nDal 1kg    ₹ 150.00\nSub Total  470.00\nCGST 2.5%  11.75\nSGST 2.5%  11.75\nGrand Total ₹493.50`;
  const r = parseReceiptText(t);
  assert.equal(r.total, 493.5);
  assert.equal(r.tax, 23.5);
  assert.equal(r.date, '2026-09-14');
  assert.equal(r.currency, 'INR');
  assert.equal(r.reconciled, true);
});

test('total keyword missing: computed from subtotal + tax, flagged low confidence', () => {
  const r = parseReceiptText('Corner Shop\nApples 3.00\nPears 2.00\nSubtotal 5.00\nTax 0.40\nThank you');
  assert.equal(r.total, 5.4);
  assert.ok(r.confidence < 0.6);
});

test('multiple total candidates are offered', () => {
  const r = parseReceiptText('Shop X\nTotal 20.00\nAmount Paid 25.00\nChange 5.00');
  assert.ok(r.totalCandidates.includes(20) && r.totalCandidates.includes(25));
});

test('findItems ignores payment, phone and tax lines', () => {
  const { items } = findItems(['Milk 2.00', 'VISA ****1234  5.00', 'Tel 555-1234', 'Tax 0.20', 'Total 2.20']);
  assert.deepEqual(items.map((i) => i.name), ['Milk']);
});

test('dates tolerate OCR spacing and currency detection is explicit only', () => {
  assert.equal(findDate('Date 14 / 09 / 2026'), '2026-09-14');
  assert.equal(findDate('14-Sep-26'), '2026-09-14');
  assert.equal(findCurrency('Total $5.00'), null);
  assert.equal(findCurrency('Total 5.00 EUR'), 'EUR');
  assert.equal(findCurrency('Total €5.00'), 'EUR');
});

import { findCharges } from '../public/js/receipt-parser.js';

test('charges are returned as individual labelled lines', () => {
  const r = parseReceiptText(WALMART);
  assert.deepEqual(r.charges.map((c) => [c.kind, c.amount]), [['tax', 0.53], ['discount', 1]]);
  assert.match(r.charges[1].label, /Coupon/i);

  const g = parseReceiptText(`Sharma Store\nRice 5kg 320.00\nDal 1kg 150.00\nSub Total 470.00\nCGST 2.5% 11.75\nSGST 2.5% 11.75\nGrand Total 493.50`);
  assert.deepEqual(g.charges.map((c) => [c.kind, c.label, c.amount]), [['tax', 'Cgst', 11.75], ['tax', 'Sgst', 11.75]]);

  const d = parseReceiptText(`Burger Bar\nBurger 12.00\nFries 4.00\nSubtotal 16.00\nService Charge 10% 1.60\nDelivery Fee 2.50\nTip 3.00\nVAT 20% 3.20\nTotal 26.30`);
  assert.deepEqual(d.charges.map((c) => c.kind), ['fee', 'fee', 'tip', 'tax']);
  assert.equal(d.charges[1].label, 'Delivery Fee');
  assert.equal(d.charges[2].mode, 'equal'); // tips default to an equal split
  assert.equal(d.reconciled, true);
});

test('suggested-tip tables and "total tax" aggregates do not double count', () => {
  const c = findCharges(['Subtotal 40.00', 'Tax 3.00', 'Suggested tip 15% 6.00', 'Tip guide 18% 7.20', 'Tip ______', 'Total 43.00']);
  assert.deepEqual(c.map((x) => x.kind), ['tax']);
  const t = findCharges(['CGST 11.75', 'SGST 11.75', 'Total Tax 23.50']);
  assert.equal(t.length, 2);
  assert.equal(findCharges(['Total Tax 23.50']).length, 1); // aggregate alone is kept
});

test('item quantities: "2 x", "3 Beer", "2 @ 3.50"', () => {
  const { items } = findItems(['2 x Margherita Pizza 26.00', '3 Beer 15.00', 'ORG MILK 2 @ 3.50 7.00 T', 'Salad 9.50', '7UP 1.50']);
  assert.deepEqual(items.map((i) => [i.name, i.quantity, i.amount]), [
    ['Margherita Pizza', 2, 26], ['Beer', 3, 15], ['Org Milk', 2, 7], ['Salad', 1, 9.5], ['7UP', 1, 1.5],
  ]);
});
