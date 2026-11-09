# Mavericks Studio — certificates, vouchers & personal emails

A browser app that removes the copy-paste work after every event:

1. **Certificates** — upload the PNG/JPG you designed, paste names or import Excel, click where the name goes, and download every certificate as `Name.png`, `Name.pdf` or both, in one ZIP.
2. **Vouchers** — paste the voucher codes (Reference ID, Pin, Expiry Date, Amount) and get one Word document with **one page per voucher**, using the Hexaware letter template with the logo and Krishna's signature.
3. **Power Automate maker** — any one-off email (credentials, links, reminders): upload participants (Name, Emp ID, optional Email → otherwise EmpID@hexaware.com), an optional details sheet (any columns, matched by Emp ID / Email / Name or row order), common values, write the email with chips → a mail ZIP for the same flow.
4. **Bulk email with Power Automate** — every ZIP has a `Mail Merge` folder (files + `mail-list.xlsx`); one Power Automate flow sends each person their own email and attachment. Works with new Outlook, no macros.

Everything runs in your browser — names, emails and voucher codes never leave your machine.

## Run it

- **Live app:** https://certificate-mailmerge.vercel.app — open it and click **Install app** to add it to your Start menu / home screen.
- Open `index.html` in Chrome/Edge (double-click works), **or**
- Host the folder anywhere static (GitHub Pages, Vercel, an internal web server). No build step.

An internet connection is needed for the helper libraries (JSZip, jsPDF, SheetJS) and fonts, loaded from cdnjs / Google Fonts.

## Certificates

| Step | What to do |
|---|---|
| Event | Event name (used in the ZIP name and email) |
| Types | Winner / Runner-up / Participant… each with its own template and name position |
| Template | Drop the PNG/JPG certificate (with sample text already on it is fine) |
| Edit text (like Canva) | The app reads all the text on the design. Click a text to select it, double-click to type over it right on the certificate (B = bold, x² = superscript). The name under “awarded to” is detected automatically; otherwise click the name and press 👤 Name. Edited text is wiped and the background rebuilt; colour, size and letter spacing are copied from the original. Untouched text stays pixel-perfect |
| Names | Paste `Name, email` per line, or import Excel with **Name**, **Email**, **Category** columns. Category splits rows into types automatically |
| Generate | PNG / PDF / Both → one ZIP |

Position and style are remembered per type, so next event's "Winner" starts where you left it.

ZIP layout:

```
Mail Merge/Priya Sharma.pdf      (and .png when you pick Both)
Mail Merge/mail-list.xlsx        table MailList, ready for Power Automate
READ ME - how to send.txt
```

## Vouchers

- Paste straight from the voucher portal/Excel/PDF — headers, tabs and blank lines are ignored. Each voucher is detected by its Reference ID (e.g. `H6V6-UX3PPG-DGEY`) followed by Pin, Expiry Date, Amount. See `samples/vouchers-paste-example.txt`.
- Edit the letter per event: `{event}` (bold), `{brand}`, `**bold text**`.
- **Download Word document** → `<Event> - Vouchers.docx`, one page per voucher, no names.
- **Outlook mail kit** (optional) → paste recipients in voucher order; you get `a `Mail Merge` folder with each person's voucher page (Word) and `mail-list.xlsx` with their codes written into the email.

The logo, signature and styles come from `assets/voucher-template.docx` (embedded in `js/voucher-template-data.js`). To change the logo or signature, replace that .docx and run `python3 tools/embed_template.py`.

## Sending emails (Power Automate)

See [`docs/POWER-AUTOMATE-GUIDE.md`](docs/POWER-AUTOMATE-GUIDE.md) or the **Send emails** tab.

1. One time: import `power-automate/Mail-Merge-Send.zip` (My flows ▸ Import ▸ Import Package (Legacy)), connect OneDrive + Outlook, turn it on.
2. Every event: generate → extract the ZIP into **OneDrive - Hexaware** (after deleting the old `Mail Merge` folder) → Run the flow.

Any list size, every ticked format attached to one email, optional Teams message with a link to the certificate, and a delivery report emailed after every run. Test mode is in the Send emails tab.

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
docs/POWER-AUTOMATE-GUIDE.md
samples/                   original template, sample voucher PDF and paste example
```
