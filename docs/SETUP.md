# Setup

1. Install Node.js 20+.
2. `npm install && npm start`, then open http://localhost:3000.
3. (Optional) `cp .env.example .env` and set `APP_PASSWORD`, `PORT`, `DATA_DIR`.

**Docker:** `docker compose up -d` (set `APP_PASSWORD` in your shell or a `.env` file first).

**Splitwise import (optional):** register an app at https://secure.splitwise.com/apps, create a personal API key, paste it under Settings → Splitwise, then *Test connection* / *Import*. Splitwise currently requires a Pro subscription on the developer account for API access; if the test fails you can ignore it and use the ledger as-is.

**Upgrading from 1.x:** the old version was a thin Splitwise proxy and stored nothing locally. Use the Splitwise import to bring your history in.
