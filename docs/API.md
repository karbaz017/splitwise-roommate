# API reference

JSON over HTTP. Errors: `{ "error": "...", "message": "human readable" }` with 400 (validation), 404, 413 (file too large), 502 (Splitwise), 500. Money in requests is a decimal in major units (`"12.50"`); responses use integer cents (`amountCents`).

| Method | Route | Notes |
| --- | --- | --- |
| GET/PUT | `/api/settings` | `householdName`, `currency` (3 letters); GET also returns `categories` |
| GET/POST | `/api/people` | POST `{name, email?}` |
| PATCH/DELETE | `/api/people/:id` | DELETE archives if the person has history |
| GET | `/api/expenses` | `search, person, category, type, from, to, limit (≤200), offset` → `{expenses, total}` |
| POST/PUT | `/api/expenses[/:id]` | see below |
| DELETE | `/api/expenses/:id` | also deletes its receipt files |
| POST | `/api/expenses/:id/receipts` | multipart, field `receipts`, ≤10 files, ≤10 MB each |
| DELETE | `/api/expenses/:id/receipts/:receiptId` | |
| GET | `/api/receipts/:file` | the stored file |
| GET | `/api/drafts?owner=<personId>` | that person's drafts only (`owner` required) |
| POST/PUT/DELETE | `/api/drafts[/:id]` | body `{ownerId, form}` (lenient, sanitized); delete with `?owner=` |
| PUT | `/api/expenses/:id?owner=<personId>` | on a draft: finalizes it with full validation |
| GET/POST | `/api/recurring` | monthly rules: expense body (no `date`) + `day` (1–28), optional `startMonth` |
| PATCH/DELETE | `/api/recurring/:id` | pause (`{active:false}`) / stop; generated entries are kept |
| POST | `/api/recurring/run` | generate anything due now |
| GET | `/api/receipts/lookup?hash=` | find an entry already holding a receipt with this SHA-256 |
| GET | `/api/capabilities` | `{ai: bool}` |
| POST | `/api/receipts/analyze` | multipart `receipts` (one file); only when `ANTHROPIC_API_KEY` is set |
| GET | `/api/balances` | `{net: {personId: cents}, transfers: [{from,to,cents}]}` |
| GET | `/api/export/expenses.csv`, `/api/export/ledger.json` | downloads |
| GET | `/api/splitwise/status` | header `X-Splitwise-Token` (or server key); never throws |
| POST | `/api/splitwise/import` | read-only import; returns `summary` |
| GET | `/api/health` | |

## Expense body

```json
{
  "description": "Electricity", "amount": "90.00", "date": "2026-09-01", "category": "Utilities", "notes": "",
  "paidBy": [{ "personId": "…" }],
  "splitMethod": "equal | shares | percentage | exact",
  "participants": [{ "personId": "…", "value": 1 }]
}
```

`paidBy` with several payers needs an `amount` each that sums to the total. `value` is shares, a percentage (sum 100) or an amount (sum = total) depending on the method. Item-by-item: `"splitMethod": "items"`, `"items": [{"name": "Beer", "quantity": 3, "amount": "15.00", "personIds": ["…", "…"]}]` (`amount` is the line total; one payer) and `"charges": [{"kind": "tax|tip|fee|discount", "label": "Sales tax", "amount": "3.60", "mode": "proportional|equal"}]` (amounts positive; discounts subtract). Each item is split equally among its `personIds`; each charge is shared by item cost or equally; anything left between the total and items + charges is shared proportionally and stored as `otherCents`. Settlement body: `{ "type": "settlement", "from": id, "to": id, "amount": "20", "date": "…" }`.
