# Sending certificates & vouchers with Power Automate

**Mail merge** = one template + a list of people → a personal copy for everyone.
Mail Merge Studio makes the copies; Power Automate (part of Microsoft 365) sends them from your own mailbox. Works with the new Outlook, no macros.

## What the app gives you

Every certificate ZIP and voucher mail kit contains:

```
Mail Merge/
  <Name>.pdf / .png / .docx   one file per person
  mail-list.xlsx              Excel table "MailList": Email, Name, Subject, Body, FileName, File, Cc
```

Subject and Body are already personalised per row, so one flow handles every event — certificates and vouchers.

## One-time setup (~10 minutes)

1. **First ZIP:** in the app's *Send emails* tab turn on **Test mode** (enter your email), generate certificates for 2–3 names, extract the ZIP and drag the `Mail Merge` folder into **OneDrive ▸ My files**.
2. Go to <https://make.powerautomate.com> and sign in with your work account.
3. **+ Create ▸ Instant cloud flow** → name `Mail Merge - Send` → **Manually trigger a flow** → **Create**.
4. **+ ▸ List rows present in a table** (Excel Online (Business))
   - Location: OneDrive for Business · Document Library: OneDrive
   - File: `/Mail Merge/mail-list.xlsx` · Table: `MailList`
   - Settings ▸ Pagination **On**, Threshold `5000` (default stops at 256 rows)
5. **+ ▸ Get file content using path** (OneDrive for Business) → File Path: `/Mail Merge/` + dynamic content **File**. A **For each** is added automatically.
6. Inside For each: **+ ▸ Send an email (V2)** (Office 365 Outlook)
   - To = **Email**, Subject = **Subject**, Body = **Body**
   - Advanced parameters ▸ Attachments: Name = **FileName**, Content = **File Content**
   - Advanced parameters ▸ CC = **Cc**
7. Inside For each: **+ ▸ Delay** → 2 seconds (stays under Outlook's ~30 emails/minute limit).
8. **Save ▸ Test ▸ Manually ▸ Run flow**. Approve connections. You should get 3 `[TEST]` emails.

## Every event (~2 minutes)

1. Turn **off** Test mode, generate, extract the ZIP.
2. Drag the new `Mail Merge` folder into OneDrive ▸ My files → **Replace**. Don't delete the folder first — the flow is linked to `mail-list.xlsx`.
3. Power Automate ▸ My flows ▸ `Mail Merge - Send` ▸ **Run**. Check the run history for failures.

## Troubleshooting

| Problem | Fix |
|---|---|
| Get file content: file not found | Files must sit directly in `Mail Merge`, not in a sub-folder |
| Excel file not found | The folder was deleted and re-uploaded — reselect the file in step 4 and save |
| Old recipients emailed again | `mail-list.xlsx` wasn't replaced with the new one |
| Only 256 people received it | Turn on Pagination (step 4) |
| Send from a team mailbox | Use *Send an email from a shared mailbox (V2)* in step 6 (needs Send-As rights) |
| Power Automate not available | Ask IT to enable it for your Microsoft 365 account |
