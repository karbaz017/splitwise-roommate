# Changelog

## [2.1.0]
### Added
- Item-by-item splitting (shared items, proportional tax/tip/discount) with live per-person preview
- Line-item extraction from receipts; one click loads them into the splitter
- OCR pipeline: deskew, adaptive threshold, denoise, alternate layout, rotation recovery, HEIC conversion, cross-pass merge
- Parser: OCR digit repair, quantities, SKU/tax-flag columns, discounts, tax/tip, total reconciliation, alternative totals, currency mismatch warning
- Optional AI receipt reading (`ANTHROPIC_API_KEY`)
- Recurring monthly bills; duplicate-receipt warning
### Changed
- Split rounding uses BigInt (exact at any amount)

## [2.0.0]
### Changed
- Now a local-first ledger; Splitwise is an optional, read-only importer. The old proxy/dashboard is replaced.
### Added
- Integer-cent split engine, balances and suggested settlements
- Receipt upload (image/PDF) via browse, drag & drop and paste, with signature validation
- Receipt detection (total, date, merchant, category) via in-browser OCR / PDF text
- CSV and JSON export, optional `APP_PASSWORD`, Docker volume, mobile layout, test suite and CI

## [1.0.0]
- Initial Splitwise dashboard proxy.
