# Sending certificates & vouchers with Power Automate

**Mail merge** = one template + a list of people → a personal copy for everyone.
Mail Merge Studio makes the copies; Power Automate (part of Microsoft 365) sends them from your own mailbox. Works with the new Outlook, no macros.

## What the app gives you

Every certificate ZIP and voucher mail kit contains:

```
Mail Merge/
  <Name>.pdf / .png / .docx   one file per person
  mail-list.json              what the imported flow reads
  mail-list.xlsx              same rows as an Excel table "MailList" (to check, or for a hand-built flow)
```

Subject and Body are already personalised per row, so one flow handles every event — certificates and vouchers.

## One-time setup (~3 minutes) — import the ready-made flow

1. Download [`power-automate/Mail-Merge-Send.zip`](../power-automate/Mail-Merge-Send.zip) (keep it zipped).
2. <https://make.powerautomate.com> ▸ **My flows ▸ Import ▸ Import Package (Legacy)** ▸ **Upload** the zip.
3. Under **Related resources**, for **OneDrive for Business** and **Office 365 Outlook** click **Select during import**, pick your account (or *+ Create new*), **Save**.
4. **Import**. Open the flow and **Turn on** if needed.
5. Test: in the app turn on **Test mode**, generate a couple of certificates, drag the `Mail Merge` folder into OneDrive ▸ My files, **Run** the flow → 3 `[TEST]` emails.

The imported flow: *Read the mail list* (`/Mail Merge/mail-list.json`) → *Send to each person* → *Get their file* → *Send the email* → *Wait 2 seconds*. It uses file paths, not file IDs, so it keeps working when you replace the folder.

Rebuild the package after changing it: `python3 tools/build_flow_package.py`.

### If import is blocked — build it by hand

1. **+ Create ▸ Instant cloud flow** → `Mail Merge - Send` → **Manually trigger a flow**.
2. **List rows present in a table** (Excel Online (Business)): OneDrive for Business / OneDrive / `/Mail Merge/mail-list.xlsx` / table `MailList`; Settings ▸ Pagination on, threshold 5000.
3. **Get file content using path** (OneDrive for Business): `/Mail Merge/` + **File** (a For each is added).
4. Inside For each: **Send an email (V2)** — To **Email**, Subject **Subject**, Body **Body**, Attachments Name **FileName** / Content **File Content**.
5. Inside For each: **Delay** 2 seconds. Save.

With the hand-built version, replace the folder's files each event (choose **Replace**) instead of deleting the folder — the Excel step is linked to that exact file.

## Every event (~2 minutes)

1. Turn **off** Test mode, generate, extract the ZIP.
2. In OneDrive ▸ My files delete the old `Mail Merge` folder, then drag in the new one.
3. Power Automate ▸ My flows ▸ `Mail Merge - Send` ▸ **Run**. Check the run history for failures.

## Troubleshooting

| Problem | Fix |
|---|---|
| Get file content: file not found | Files must sit directly in `Mail Merge`, not in a sub-folder |
| mail-list.json not found | Folder must be named exactly `Mail Merge`, directly in OneDrive ▸ My files |
| Old recipients emailed again | Delete the old `Mail Merge` folder before uploading the new one |
| Send from a team mailbox | Use *Send an email from a shared mailbox (V2)* in step 6 (needs Send-As rights) |
| Power Automate not available | Ask IT to enable it for your Microsoft 365 account |
