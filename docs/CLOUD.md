# Cloud sync: use your ledger from any device

By default your data lives in the `data/` folder of the machine running the app. Cloud sync mirrors the **ledger and every receipt** to a place you control, so the same data shows up wherever you run the app, and you have an off-site backup.

You choose one of two storage types, and can add end-to-end encryption to either.

## Option 1: a cloud-drive folder (simplest, no accounts or keys)

Point `SYNC_DIR` at a folder that Dropbox, Google Drive, iCloud Drive or OneDrive already syncs:

```env
SYNC_DIR=~/Dropbox/RoommateLedger
```

Install the same drive client on your other machine, set the same variable, start the app. Done.

### Dropbox step by step

1. Install the Dropbox desktop app on **every computer that will run the ledger** and sign in to the same account. Wait until it shows "Up to date".
2. Create a folder for it inside Dropbox, e.g. `RoommateLedger`. Find its real path:
   - macOS: `~/Dropbox/RoommateLedger`, or on newer Macs `~/Library/CloudStorage/Dropbox/RoommateLedger` (right-click the folder in Finder, hold ⌥ Option, "Copy … as Pathname")
   - Windows: `C:\Users\<you>\Dropbox\RoommateLedger`
   - Linux: `~/Dropbox/RoommateLedger`
3. In Dropbox, right-click the folder → **Make available offline** (or "Local" in Smart Sync), so files are always on disk.
4. In the project's `.env` (same on every computer, adjust the path per computer):
   ```env
   SYNC_DIR=~/Dropbox/RoommateLedger
   SYNC_PASSPHRASE=your long secret phrase
   ```
   `~` is expanded for you.
5. Start the app (`npm start`). The log should say `Cloud sync: /…/Dropbox/RoommateLedger (end-to-end encrypted)`. Open Settings → Cloud sync and press **Sync now**.
6. On the second computer repeat steps 1, 3 and 4 (same passphrase), then start the app. Your data appears.

Notes: keep the app's own `data/` folder **outside** Dropbox (the default is fine); only the sync folder goes in Dropbox. Dropbox only moves the files, so each device that wants to use the app must run it (or use one hosted copy, see below). If Dropbox ever creates "conflicted copy" files, that means two devices wrote at the same instant while Dropbox was behind; the app ignores those files and reconciles on the next sync.

## Option 1b: Sign in with Dropbox (no desktop client; works on servers)

The app talks to Dropbox itself and shows a **Connect Dropbox** button in Settings → Cloud sync. It uses Dropbox's normal sign-in/consent screen (OAuth 2 with PKCE; no app secret is needed) and an **App folder** app, so it can only see `Dropbox/Apps/<your app name>`, never the rest of your Dropbox.

One-time setup (about 5 minutes):

1. Go to <https://www.dropbox.com/developers/apps> → **Create app** → **Scoped access** → **App folder** → pick a name.
2. **Permissions** tab: tick `files.content.read` and `files.content.write`, then **Submit**. (Do this before connecting; permissions are fixed at sign-in time.)
3. **Settings** tab → **Redirect URIs**: add `http://localhost:3000/api/dropbox/callback` (use your real address and port; if you host the app online use `https://your-domain/api/dropbox/callback`, and set `APP_URL=https://your-domain` so the app builds the same URI). Settings → Cloud sync shows the exact URI to paste.
4. Copy the **App key** into `.env`: `DROPBOX_APP_KEY=…`. Restart the app.
5. Settings → Cloud sync → (optionally enter an **encryption passphrase**) → **Connect Dropbox** → approve in Dropbox. You land back in the app, synced.
6. On another device: run the app with the same `DROPBOX_APP_KEY`, press **Connect Dropbox**, sign in to the same Dropbox and use the same passphrase.

Notes:
- The long-lived refresh token is stored in `data/dropbox-auth.json` (owner-only permissions) and is never uploaded. Keep `data/` private. **Disconnect Dropbox** revokes it and deletes the file; your data stays.
- If Dropbox already holds a ledger when you connect, it is loaded and your current local data is saved next to it as `ledger.conflict-<time>.json`. If Dropbox is empty, your local data is uploaded.
- A Dropbox "development" app can be used by up to 500 users with no review, which is plenty for a household. Nobody else can use your app key without being an authorised user of that app.
- The Dropbox API is not available on offline machines; the app keeps working locally and syncs when it is back online.

## Option 2: S3-compatible storage (works from servers too)

Any S3-compatible bucket works. Backblaze B2 and Cloudflare R2 both have a free tier (10 GB), which is far more than a household needs.

```env
S3_BUCKET=my-roommate-ledger
S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com   # omit for AWS S3
S3_REGION=us-west-004                                 # "auto" for Cloudflare R2
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PREFIX=family                                      # optional folder inside the bucket
```

Create the bucket as **private** and give the key read/write access to that bucket only.

## End-to-end encryption (recommended)

```env
SYNC_PASSPHRASE=a long secret phrase only you know
```

Everything is encrypted with AES-256-GCM on your machine before upload. The cloud provider (and anyone who gets into the bucket) sees only ciphertext. Use the **same passphrase on every device**. There is no recovery if you lose it, so keep it in your password manager. A device with the wrong passphrase is refused and never overwrites anything.

## How it behaves

- **Every write pulls first**, so two devices don't overwrite each other, then pushes. Other devices see the change on their next read (the server checks the cloud at most every 5 seconds, and open pages refresh every ~20 seconds).
- **Offline is fine.** If the cloud is unreachable, the app keeps working locally, shows "Waiting to sync", and uploads when it can.
- **Conflicts.** If two devices change things while apart, the **cloud version wins** and your other version is saved next to your data as `ledger.conflict-<time>.json`. Nothing is silently lost; re-enter or merge what you need.
- **Receipts** are uploaded before the ledger entry that points to them, and downloaded on first view on another device.
- **First time** on a machine that already has data and an empty cloud: your data is uploaded. On a new empty machine with an existing cloud: the cloud data is downloaded.
- **Not shared between devices:** browser-only preferences ("Viewing as", theme, form autosave).
- Designed for one household (a handful of writers). It is not a multi-user database: edits to the same entry from two devices at the same instant resolve as "last write wins".

## Running the app in the cloud

Because state is restored from the bucket at startup, you can also host the app on a platform with a temporary disk (Render, Railway, Fly.io…) using the S3 settings. Set `APP_PASSWORD` and use HTTPS.

## Check it works

Settings → **Cloud sync** shows the location, last sync time, pending changes and any error, with a **Sync now** button. The sidebar shows a small status pill.
