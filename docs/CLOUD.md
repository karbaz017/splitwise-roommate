# Cloud sync: use your ledger from any device

By default your data lives in the `data/` folder of the machine running the app. Cloud sync mirrors the **ledger and every receipt** to a place you control, so the same data shows up wherever you run the app, and you have an off-site backup.

You choose one of two storage types, and can add end-to-end encryption to either.

## Option 1: a cloud-drive folder (simplest, no accounts or keys)

Point `SYNC_DIR` at a folder that Dropbox, Google Drive, iCloud Drive or OneDrive already syncs:

```env
SYNC_DIR=~/Dropbox/RoommateLedger
```

Install the same drive client on your other machine, set the same variable, start the app. Done.

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
