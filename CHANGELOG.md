# Changelog

## [2.3.0]
### Added
- Tax, tip, service fee and discount lines are individual, editable charges (type, label, amount, split rule), with tip-% shortcuts and an explicit "not accounted for" line
- Item quantity (quantity × unit price = line total); each item shows who shares it
- Receipt parsing extracts every tax/tip/fee/discount line and quantities (local OCR and AI)
- Private drafts ("Save as draft", Finish, delete) excluded from balances, lists, exports and duplicate checks; form autosave with restore
### Changed
- Per-person breakdown in the item splitter shows items and each charge

## [2.2.0]
### Changed
- UI redesign: modern light/dark design system, hero summary, avatars, day-grouped expense list, segmented split control, sticky save bar, mobile bottom navigation and bottom-sheet dialogs
- The expense form now starts with the receipt area (upload / take photo / drop / paste); it was previously at the bottom and easy to miss
- Icons are an inline SVG sprite; no icon CDN is needed
### Added
- "Scan receipt" buttons on every screen and a mobile floating button; drop a file anywhere or paste anywhere to start an expense from it
- Manual dark/light toggle

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
