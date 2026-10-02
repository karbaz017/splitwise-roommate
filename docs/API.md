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

`paidBy` with several payers needs an `amount` each that sums to the total. `value` is shares, a percentage (sum 100) or an amount (sum = total) depending on the method. Settlement body: `{ "type": "settlement", "from": id, "to": id, "amount": "20", "date": "…" }`.
