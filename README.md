# Mail Merge Studio — certificates & vouchers

A browser app that removes the copy-paste work after every event:

1. **Certificates** — upload the PNG/JPG you designed, paste names or import Excel, click where the name goes, and download every certificate as `Name.png`, `Name.pdf` or both, in one ZIP.
2. **Vouchers** — paste the voucher codes (Reference ID, Pin, Expiry Date, Amount) and get one Word document with **one page per voucher**, using the Hexaware letter template with the logo and Krishna's signature.
3. **Bulk email from Outlook** — every ZIP includes `mail-list.csv` + the email text; the `outlook/BulkMailer.bas` macro sends one personalised email per person with their own attachment.

Everything runs in your browser — names, emails and voucher codes never leave your machine.

## Run it

- Open `index.html` in Chrome/Edge (double-click works), **or**
- Host the folder anywhere static (GitHub Pages, Vercel, an internal web server). No build step.

An internet connection is needed for the helper libraries (JSZip, jsPDF, SheetJS) and fonts, loaded from cdnjs / Google Fonts.

## Certificates

| Step | What to do |
|---|---|
| Event | Event name (used in the ZIP name and email) |
| Types | Winner / Runner-up / Participant… each with its own template and name position |
| Template | Drop the PNG/JPG, then click on the preview where the name goes — drag or use arrow keys to nudge |
| Style | Font, size, colour, case, max width (long names shrink automatically) |
| Names | Paste `Name, email` per line, or import Excel with **Name**, **Email**, **Category** columns. Category splits rows into types automatically |
| Generate | PNG / PDF / Both → one ZIP |

Position and style are remembered per type, so next event's "Winner" starts where you left it.

ZIP layout (Both, several types):

```
Winner/PNG/Priya Sharma.png
Winner/PDF/Priya Sharma.pdf
Participant/…
mail-list.csv        Name, Email, Category, File
email-subject.txt
email-body.html
```

## Vouchers

- Paste straight from the voucher portal/Excel/PDF — headers, tabs and blank lines are ignored. Each voucher is detected by its Reference ID (e.g. `H6V6-UX3PPG-DGEY`) followed by Pin, Expiry Date, Amount. See `samples/vouchers-paste-example.txt`.
- Edit the letter per event: `{event}` (bold), `{brand}`, `**bold text**`.
- **Download Word document** → `<Event> - Vouchers.docx`, one page per voucher, no names.
- **Outlook mail kit** (optional) → paste recipients in voucher order; you get `mail-list.csv` (Name, Email, RefID, Pin, Expiry, Amount, File) and, optionally, each person's own voucher page as a Word attachment.

The logo, signature and styles come from `assets/voucher-template.docx` (embedded in `js/voucher-template-data.js`). To change the logo or signature, replace that .docx and run `python3 tools/embed_template.py`.

## Sending from Outlook

See [`docs/OUTLOOK-GUIDE.md`](docs/OUTLOOK-GUIDE.md). Short version (classic Outlook for Windows):

1. One time: Outlook → `Alt+F11` → File ▸ Import File → `outlook/BulkMailer.bas`.
2. Extract the ZIP → Outlook → `Alt+F8` → **SendBulkMail** → pick the folder.
3. **No** = save as Drafts to review, **Yes** = send now. A `send-log.csv` is written to the folder.

## Files

```
index.html                 the app
css/styles.css
js/common.js               tabs, downloads, CSV, email text
js/certificates.js         certificate generator
js/vouchers.js             voucher UI
js/voucher-docx.js         Word builder + voucher paste parser
js/voucher-template-data.js  embedded Word template (logo + signature)
assets/voucher-template.docx
outlook/BulkMailer.bas     Outlook macro
docs/OUTLOOK-GUIDE.md
samples/                   original template, sample voucher PDF and paste example
```
