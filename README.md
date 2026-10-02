# 🏠 Roommate Ledger

[![Tests](https://github.com/karbaz017/splitwise-roommate/actions/workflows/test.yml/badge.svg)](https://github.com/karbaz017/splitwise-roommate/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A self-hosted, open-source **single place for all money matters with your roommates**: shared expenses, who owes whom, settle-ups, and receipts. It works completely on its own. **Splitwise is optional** (import only), so an outage, a revoked key or Splitwise's API paywall can never block you.

## Features

- **Expenses** split equally, by shares, by percentage or by exact amounts, with one or several payers. Money is stored as integer cents, so splits always add up exactly.
- **Balances & "who pays whom"**: net balance per person plus a minimal list of transfers to settle everyone.
- **Settle up** with an optional proof-of-payment attachment.
- **Receipts as image or PDF**: click to browse, **drag & drop**, or **paste** (Ctrl/⌘+V) a screenshot. JPG, PNG, WebP, GIF, HEIC and PDF up to 10 MB, validated by file signature.
- **Receipt detection**: reads the total, date, merchant and category from photos, digital PDFs and scanned PDFs and pre-fills the form (you confirm). Runs in your browser (Tesseract OCR + pdf.js); receipts are not sent to any third party.
- **Optional Splitwise import**: read-only, repeatable, failure-tolerant.
- **Exports**: CSV and full JSON. Your data is plain files in `data/`.
- Search and filter by text, person, category and month; works on mobile; optional password.

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

### Back up

Copy the `data/` folder (`ledger.json` + `receipts/`). A `ledger.json.bak` of the previous save is kept automatically.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Ledger and receipt storage |
| `APP_PASSWORD` | _(none)_ | Require HTTP Basic auth (any username) |
| `SPLITWISE_API_KEY` | _(none)_ | Server-side key for the optional import |

## Docs

[Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Features](docs/FEATURES.md) · [Setup](docs/SETUP.md) · [FAQ](docs/FAQ.md) · [Contributing](CONTRIBUTING.md)

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
