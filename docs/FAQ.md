# FAQ

**Do I need Splitwise?** No. It is only an optional importer.

**Where is my data?** `data/ledger.json` and `data/receipts/`. Copy the folder to back up.

**Can roommates use it from their phones?** Yes: host it somewhere always-on, set `APP_PASSWORD`, use HTTPS. There are no separate accounts.

**Receipt detection got it wrong.** It only pre-fills the form; correct the fields and save. Clearer, straighter photos help. Scanned PDFs are OCR'd at page 1–4.

**HEIC photos?** Stored fine, but detection can't read them outside Safari. Export as JPEG.

**Why are my cents off by one in an equal split?** Indivisible cents go to the first participants so totals always match exactly.

**Edited an imported Splitwise entry, then re-imported?** Local edits are kept until Splitwise changes that entry again.

**How does item-by-item splitting handle tax and tip?** The difference between the bill total and the item total is shared in proportion to what each person's items cost. A coupon makes the difference negative and is shared the same way.

**Is my receipt sent anywhere?** Not unless the server has `ANTHROPIC_API_KEY` and AI reading is on in your browser (Settings). Then that receipt goes to Anthropic for reading.

**OCR still fails on my photo.** Retake it flat, bright and filling the frame; or enable AI reading. Low-confidence results are shown as suggestions, never auto-filled.

**Who can see my drafts?** Drafts are kept out of every shared view: the expense list, balances, suggested transfers, CSV/JSON downloads and duplicate detection. The Drafts list only shows drafts belonging to the "Viewing as" person. There are no per-person logins, though, so this is privacy within the app, not a security boundary: someone who has the app password could switch "Viewing as" or read the server's `data/` folder. Use real accounts (not built yet) if you need hard separation.

**Does autosave keep my attached receipt?** No: autosave stores the form fields in your browser. Use "Save as draft" to keep attached files.

**Item split: who is selected by default?** Everyone. Each item says "Shared by: Everyone, split equally". Tap a name once to give the item to only that person, then tap more names to share it.
