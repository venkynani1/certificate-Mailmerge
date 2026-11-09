# Sending certificates & vouchers in bulk from Outlook

Outlook's built-in mail merge (via Word) can't add a different attachment for each person. Three ways around it, best first:

## 1. BulkMailer macro — classic Outlook for Windows (recommended)

Sends one email per row of `mail-list.csv`, each with its own attachment and personalised text.

### One-time setup (2 minutes)

1. Download `outlook/BulkMailer.bas` from this repo.
2. In Outlook press **Alt+F11** (VBA editor) → **File ▸ Import File…** → choose `BulkMailer.bas`.
3. Close the editor (it saves automatically when Outlook closes; if asked to save the VBA project, say Yes).
4. If macros are blocked: **File ▸ Options ▸ Trust Center ▸ Trust Center Settings ▸ Macro Settings** → *Notifications for all macros*. Restart Outlook and click **Enable Macros** when asked.

> If your company disables macros via policy, use option 2 or 3.

### Every event

1. Generate in the app — the certificate ZIP, or the voucher **Outlook mail kit**.
2. Right-click the ZIP ▸ **Extract All**.
3. Outlook → **Alt+F8** → select **SendBulkMail** → **Run** → pick the extracted folder.
4. The macro shows how many emails are ready and warns about missing attachments.
   - **No** → saves everything to **Drafts**. Open two or three to check, then either send them from Drafts or run the macro again and choose Yes.
   - **Yes** → sends now (1.5 s gap between emails to stay under Exchange limits).
5. `send-log.csv` in the folder lists who got what, and any failures.

### What the macro reads

| File | Purpose |
|---|---|
| `mail-list.csv` | One row per person. Needs `Email`. `File` = attachment path inside the folder. Every column works as a `{placeholder}` |
| `email-subject.txt` | Subject, e.g. `Your certificate – {Event}` (event is filled in by the app) |
| `email-body.html` | Body with `{Name}`, `{RefID}`, `{Pin}`… |
| `email-from.txt` | Optional — send on behalf of a shared mailbox (you need *Send on Behalf* rights) |
| `email-cc.txt` | Optional — CC on every email |

Edit the subject/body in the app's **Send via Outlook** tab before generating, or edit the .txt/.html files after extracting.

## 2. Word mail merge — vouchers only, no macros needed

Voucher details can go in the email body, so no attachment is needed:

1. Open a new Word document, write the email using the voucher wording.
2. **Mailings ▸ Start Mail Merge ▸ E-mail Messages**.
3. **Select Recipients ▸ Use an Existing List** → the kit's `mail-list.csv`.
4. Place fields with **Insert Merge Field** (Name, RefID, Pin, Expiry, Amount).
5. **Finish & Merge ▸ Send Email Messages** → To: `Email`, add subject → OK. Outlook sends them all.

## 3. Power Automate — new Outlook / Mac / no macros, with attachments

1. Upload the extracted folder to OneDrive or SharePoint.
2. Open `mail-list.csv` in Excel, select the data, **Insert ▸ Table**, save as `.xlsx` in the same folder.
3. In Power Automate create an **Instant cloud flow**:
   - *List rows present in a table* (the .xlsx)
   - *Apply to each* row →
     - *Get file content using path* → folder path + `File` column (swap `\` for `/`)
     - *Send an email (V2)* → To: `Email`, Subject/Body with the dynamic `Name`; Attachments: name = file name, content = file content.
4. Run the flow.
