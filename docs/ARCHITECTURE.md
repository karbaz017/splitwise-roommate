# Architecture

```
Browser (vanilla ES modules)  ──HTTP/JSON──▶  Express (src/app.js)  ──▶  data/ledger.json + data/receipts/
   │ OCR: tesseract.js / pdf.js (in-browser)           │
                                                       └─(optional, read-only)──▶ Splitwise API
```

| Module | Responsibility |
| --- | --- |
| `src/money.js` | Integer-cent maths: split engine (largest-remainder), net balances, debt simplification |
| `src/ledger.js` | Validation and normalisation of people and expenses/settlements |
| `src/store.js` | JSON store with serialized, atomic writes (temp file + rename), `.bak`, rollback on failure |
| `src/receipts.js` | Upload handling, file-signature sniffing, safe naming and storage |
| `src/splitwise.js` | Optional importer; maps Splitwise expenses into ledger entries |
| `src/app.js` | Routes, optional Basic auth, error handling, exports |
| `public/js/receipt-parser.js` | Pure text → {total, date, merchant, category} heuristics |
| `public/js/ocr.js` | Lazy-loads OCR / PDF engines and extracts text |

## Data model

- **Person**: `id, name, email, active, splitwiseId?`. Removing someone who appears in history *archives* them.
- **Entry** (expense or settlement): `id, type, description, amountCents, date, category, notes, paidBy[{personId,cents}], splits[{personId,cents}], receipts[], source, externalId?`.
- A settlement is an entry where one person "paid" and the other "owes" the same amount, so balances use one formula: `net = Σ paid − Σ owed`.

## Design decisions

- **Server computes splits.** Clients send a method and inputs; the server produces cents that always sum to the total. The UI preview is advisory.
- **No database.** A household's data is tiny; a JSON file is trivially backed up and inspected. Writes are serialized, so concurrent requests cannot interleave. Swap `Store` if you outgrow it.
- **Single currency per household** (set in Settings). Entries in other currencies are skipped on Splitwise import.
- **Receipts are validated by magic bytes**, served with the server-chosen type and `nosniff`, under random names. Uploaded HTML renamed to `.png` is rejected.
- **Everything user-supplied is HTML-escaped** in the UI; CSV export neutralises spreadsheet formulas.

## Security notes

No accounts: one optional shared password (`APP_PASSWORD`, constant-time comparison). Use HTTPS when exposed. The Splitwise key is stored in the browser's `localStorage` (or server env) and only ever sent to this server.
