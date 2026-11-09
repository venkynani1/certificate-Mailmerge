# Sending certificates & vouchers with Power Automate

**Mail merge** = one template + a list of people → a personal copy for everyone.
Mail Merge Studio makes the copies; Power Automate (part of Microsoft 365) sends them from your own mailbox.

## What the app gives you

Every certificate ZIP and voucher mail kit contains:

```
Mail Merge/
  <Name>.pdf / .png / .jpg / .docx   every format you ticked — all attached to that person's email
  mail-list.json                     index: which parts to send
  mail-list-part-001.json …          the people (split so Power Automate never hits its 131,072-character limit)
  mail-list.xlsx                     the same list as an Excel table, to check
READ ME - how to send.txt
```

Subject and email body are fully written per person ("Dear <name>," + your message, plus the voucher table for vouchers), so one flow handles every event.

## One-time setup (~3 minutes)

1. Make sure **OneDrive - Hexaware** shows in File Explorer's sidebar (OneDrive app signed in).
2. Download [`power-automate/Mail-Merge-Send.zip`](../power-automate/Mail-Merge-Send.zip) (v4) — keep it zipped.
3. <https://make.powerautomate.com> ▸ **My flows** — delete any older `Mail Merge - Send`.
4. **Import ▸ Import Package (Legacy)** ▸ **Upload** the zip.
5. **Related resources**: *Select during import* for **OneDrive for Business**, **Office 365 Outlook** and **Microsoft Teams** → your account → **Save** → **Import**.
6. Open the flow → **Turn on**.
7. Test with the app's **Test mode** (3 emails, all to you).

What the flow does for each person:

1. **Sends the email** with every attachment for that person.
2. **Teams** (if turned on in the app): copies their certificate(s) to `OneDrive / Mail Merge Certificates / <event>`, makes a company-only view link, and sends a Teams chat (Workflows bot) with your message + the links. Teams goes to the company email, or EmpID@hexaware.com. Gmail/outside people get email only. Voucher codes never go to Teams.
3. Waits 2 s (12 s with Teams on — the Teams bot allows ~25 messages per 5 minutes).

After everyone: a **delivery report** CSV is saved to `OneDrive / Mail Merge`, and an email goes to the report address with sent / failed counts and a table of every failure with its reason.

It finds files by path, so replacing the folder each event never breaks it. Rebuild: `python3 tools/build_flow_package.py`.

## Every event (~1 minute)

1. Turn **off** Test mode and generate.
2. File Explorer ▸ **OneDrive - Hexaware** ▸ delete the old `Mail Merge` folder.
3. Right-click the ZIP ▸ **Extract All** ▸ **Browse** ▸ **OneDrive - Hexaware** ▸ **Extract**. Wait for the green ✓.
4. Power Automate ▸ My flows ▸ `Mail Merge - Send` ▸ **Run**.

About 2–3 seconds per email (300 people ≈ 15 minutes); the run continues even if you close the browser.

## Limits that matter

| Limit | What the app does |
|---|---|
| Power Automate decodes at most 131,072 characters at once | Mail list split into parts of ≤ 60,000 characters |
| Outlook ~30 emails/minute | 2-second wait between emails |
| Outlook ~25 MB per email | Images capped at 3508 px (A4 at 300 dpi); app warns if one email's files pass 20 MB |
| Exchange ~10,000 recipients/day | Far above event sizes |

## Troubleshooting

| Problem | Fix |
|---|---|
| Read the mail list: not found | `Mail Merge` must be directly inside **OneDrive - Hexaware**; wait for sync (green ✓) |
| No Teams message | Check the report's Teams column. In test mode the test email must be a company address. “Failed …” usually means the Workflows app is blocked in Teams |
| Teams message without the certificate link | Company-wide OneDrive sharing is off; the report says “no file link” |
| A few emails failed | Open the run → red step shows why (often a mistyped address); the rest still send |
| Send from a team mailbox | Replace *Send the email* with *Send an email from a shared mailbox (V2)* (needs Send-As) |
