# 🏠 Roommate Ledger

[![Tests](https://github.com/karbaz017/splitwise-roommate/actions/workflows/test.yml/badge.svg)](https://github.com/karbaz017/splitwise-roommate/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A self-hosted, open-source **single place for all money matters with your roommates**: shared expenses, who owes whom, settle-ups, and receipts. It works completely on its own. **Splitwise is optional** (import only), so an outage, a revoked key or Splitwise's API paywall can never block you.

## Features

- **Expenses** split equally, by shares, by percentage, by exact amounts, or **item by item** (groceries, restaurant bills), with one or several payers. In item mode each line item is assigned to the people who shared it, and tax, tip, fees and discounts are shared in proportion to what each person's items cost. Money is stored as integer cents, so splits always add up exactly.
- **Balances & "who pays whom"**: net balance per person plus a minimal list of transfers to settle everyone.
- **Settle up** with an optional proof-of-payment attachment.
- **Receipts as image or PDF**, one gesture away from anywhere: a **Scan receipt** button on every screen (floating camera button on phones, plus **Take photo**), **drop a file anywhere** on the page, or **paste** (Ctrl/⌘+V) a screenshot anywhere. The expense form starts with the receipt so the details fill themselves in. JPG, PNG, WebP, GIF, HEIC and PDF up to 10 MB, validated by file signature.
- **Receipt detection**: reads the total, date, merchant, category, tax/tip and **line items** from photos, digital PDFs and scanned PDFs and pre-fills the form (you confirm). By default it runs entirely in your browser (Tesseract OCR + pdf.js). It tries several passes (straightening, contrast/adaptive thresholding, denoising, alternate layouts, 90°/180°/270° rotation, HEIC conversion), repairs common OCR digit mistakes, cross-checks the total against subtotal + tax + tip or the item list, offers alternative totals, and flags low confidence instead of guessing.
- **Optional AI reading**: set `ANTHROPIC_API_KEY` to have an AI model read messy receipts and other languages. Off unless configured; it sends the receipt to Anthropic (see Privacy), shows when it was used, and falls back to local OCR on any failure.
- **Charges as individual lines**: tax (CGST and SGST separately), tip, service/delivery fees and coupons are separate editable rows, each split either by what people ordered or equally, with tip-% shortcuts. Items have quantity × unit price = line total, and every item shows who shares it (everyone by default; tap a name to give it to one person).
- **Drafts**: "Save as draft" keeps a half-finished entry (e.g. a scanned grocery receipt whose items aren't assigned yet) with its receipts. Drafts are private to whoever saved them, never affect balances, suggested transfers, lists or exports, and are validated strictly only when you finish them. Closing the form also autosaves it in your browser and offers to restore it next time.
- **Recurring bills**: tick "Repeat every month" on an expense (rent, internet); entries are created automatically, catching up on months missed while the server was off.
- **Duplicate guard**: warns when the same receipt file is already attached to another entry.
- **Optional Splitwise import**: read-only, repeatable, failure-tolerant.
- **Cloud sync, so it works from any device**: mirror the ledger and receipts to a Dropbox/Drive/iCloud/OneDrive folder or an S3-compatible bucket (Backblaze B2, Cloudflare R2, AWS S3), optionally end-to-end encrypted. Devices pick up each other's changes, offline edits are kept and uploaded later, and conflicts never lose data. See [docs/CLOUD.md](docs/CLOUD.md).
- **Exports**: CSV and full JSON. Your data is plain files in `data/`.
- Search and filter by text, person, category and month; entries grouped by day; modern responsive UI with light/dark themes, mobile bottom navigation and avatars; optional password.

## Quick start

```bash
git clone https://github.com/karbaz017/splitwise-roommate.git
cd splitwise-roommate
npm install
cp .env.example .env     # optional
npm start                # http://localhost:3000
```

Open the app, add everyone on the **Roommates** tab, pick who you are in the sidebar, and add your first expense.

Requires Node.js 20+. Docker: `docker compose up -d` (data persists in a volume).

### Sharing with roommates

Run it on any always-on machine (a Raspberry Pi, home server, or small VPS) and open it from each roommate's phone or laptop. **Set `APP_PASSWORD`** and put it behind HTTPS (e.g. Caddy or a Cloudflare Tunnel) if it is reachable beyond your home network. There are no per-user accounts: everyone with the password can edit the shared ledger, and "Viewing as" only changes whose perspective the dashboard shows.

### Back up / use on other devices

Turn on [cloud sync](docs/CLOUD.md) to keep an off-site copy and use the same ledger from any device. Without it, copy the `data/` folder (`ledger.json` + `receipts/`). A `ledger.json.bak` of the previous save is kept automatically.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Ledger and receipt storage |
| `APP_PASSWORD` | _(none)_ | Require HTTP Basic auth (any username) |
| `SPLITWISE_API_KEY` | _(none)_ | Server-side key for the optional import |
| `SYNC_DIR` / `S3_*` | _(none)_ | Cloud sync location ([docs/CLOUD.md](docs/CLOUD.md)) |
| `SYNC_PASSPHRASE` | _(none)_ | End-to-end encrypt synced data |
| `ANTHROPIC_API_KEY` | _(none)_ | Enables optional AI receipt reading |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5-20251001` | Model used for AI reading |

## Privacy

Without `ANTHROPIC_API_KEY`, no receipt ever leaves your server and browser (the OCR engine and language files are downloaded from a CDN on first use). With it set, each receipt you attach is sent to Anthropic for reading unless that browser turns it off under Settings → AI receipt reading. Nothing else (balances, names, ledger) is sent.

## Docs

[Cloud sync](docs/CLOUD.md) · [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Features](docs/FEATURES.md) · [Setup](docs/SETUP.md) · [FAQ](docs/FAQ.md) · [Contributing](CONTRIBUTING.md)

## Development

```bash
npm test      # unit + API + parser + Splitwise-mock tests
npm run lint  # syntax check
npm run dev   # auto-restart
```

## Why not just Splitwise?

Splitwise's API now requires a Pro subscription on the registering developer's account and limits free usage. Open-source alternatives such as [Spliit](https://github.com/spliit-app/spliit), [SplitPro](https://github.com/oss-apps/split-pro) and [SplitDuo](https://github.com/c4mbr0nn3/splitduo) are worth a look; this project is a deliberately small, zero-database, roommate-focused option with receipt reading built in.

## License

MIT
