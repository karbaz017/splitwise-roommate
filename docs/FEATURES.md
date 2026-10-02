# Features & roadmap

## Done
- Item-by-item splitting with proportional tax/tip/discount
- Multi-pass OCR with line-item extraction; optional AI reading
- Recurring monthly bills; duplicate-receipt warning
- Local-first ledger (people, expenses, settlements, balances, suggested transfers)
- Equal / shares / percentage / exact splits, multiple payers
- Receipts via browse, drag & drop, paste; images + PDF; thumbnails; delete
- Receipt detection (OCR) for photos, digital PDFs and scanned PDFs
- Optional Splitwise import; CSV/JSON export; optional password; Docker

## Receipt detection: what to expect
Works best on clear, flat, well-lit photos and digital PDFs. It suggests values and never saves without your confirmation. English text only for the local OCR (AI reading handles other languages); HEIC photos are saved but cannot be read outside Safari (convert to JPEG for detection). OCR engine files download from a CDN on first use, so detection needs internet once; everything else works offline.

## Ideas
- Multi-currency · reminders · optional per-person logins · pushing entries back to Splitwise.
