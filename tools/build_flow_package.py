"""Builds power-automate/Mail-Merge-Send.zip — a Power Automate flow package you import via
My flows > Import > Import Package (Legacy).

v5 flow (Manually trigger):
  Set up variables (attachments, report, counters, links)
  Read the mail list -> Mail list (index: parts, event, eventFolder, reportTo, waitSeconds)
  For each part (mail-list-part-NNN.json — keeps every decoded text under PA's 131,072-char limit)
    Send to each person (one at a time)
      Send now
        Clear attachments, Get each file -> Add to attachments
        Send the email (Outlook; To may hold a whole group "a;b;c", optional Cc)
        Email failed -> report "Failed" + reason
        Email sent   -> Teams messages: for each person in this email (record.Teams[]):
                          keep a copy of their certificate(s) in /Mail Merge Certificates/<event>/,
                          make company-only view links, post their message + links (Workflows bot),
                          wait teamsWaitSeconds (the Teams bot allows ~25 messages / 5 minutes)
                     -> report "Sent" (+ Teams result per person)
      Wait waitSeconds (stay under Outlook's sending limit)
  Build the report: CSV saved to /Mail Merge/delivery-report-<time>.csv
  Email the report to reportTo: counts + a table of every failure with its reason

Paths (not file IDs) are used so the package works in anyone's OneDrive.
Run:  python3 tools/build_flow_package.py
"""
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "power-automate" / "Mail-Merge-Send.zip"

FLOW_ID = "f3a4b5c6-d7e8-4f9a-8b0c-2d3e4f5a6b7c"     # package resource id / folder (v5)
FLOW_NAME = "a4b5c6d7-e8f9-4a0b-9c1d-3e4f5a6b7c8d"   # flow name inside definition (v5)
API = {
    "shared_onedriveforbusiness": ("2a4c6e8f-1b3d-4f5a-8c7e-9d0b2a4c6e8f", "4c6e8a0b-3d5f-4b7c-8e9a-1f2d4c6e8a0b", "OneDrive for Business",
                                   "https://connectoricons-prod.azureedge.net/onedriveforbusiness/icon_1.0.1018.1239.png"),
    "shared_office365": ("3b5d7f9a-2c4e-4a6b-9d8f-0e1c3b5d7f9a", "5d7f9b1c-4e6a-4c8d-9f0b-2a3e5d7f9b1c", "Office 365 Outlook",
                         "https://connectoricons-prod.azureedge.net/office365/icon_1.0.1008.1183.png"),
    "shared_teams": ("6e8a0c2d-5f7b-4d9e-8a1c-3b5d7f9a1c3e", "7f9b1d3e-6a8c-4e0f-9b2d-4c6e8a0b2d4f", "Microsoft Teams",
                     "https://connectoricons-prod.azureedge.net/teams/icon_1.0.1449.2522.png"),
}

AUTH = {"value": "@json(decodeBase64(triggerOutputs().headers['X-MS-APIM-Tokens']))['$ConnectionKey']", "type": "Raw"}
ANY_END = ["Succeeded", "Failed", "Skipped", "TimedOut"]


def op(api, operation, params, run_after=None, description=None):
    a = {
        "runAfter": run_after or {},
        "type": "OpenApiConnection",
        "inputs": {
            "host": {"apiId": f"/providers/Microsoft.PowerApps/apis/{api}", "connectionName": api, "operationId": operation},
            "parameters": params,
            "authentication": AUTH,
        },
    }
    if description:
        a["description"] = description
    return a


def loop(foreach, actions, run_after, description):
    return {"runAfter": run_after, "type": "Foreach", "description": description, "foreach": foreach,
            "runtimeConfiguration": {"concurrency": {"repetitions": 1}}, "actions": actions}


def scope(actions, run_after, description=None):
    a = {"runAfter": run_after, "type": "Scope", "actions": actions}
    if description:
        a["description"] = description
    return a


def append(var, value, run_after=None):
    return {"runAfter": run_after or {}, "type": "AppendToArrayVariable", "inputs": {"name": var, "value": value}}


def setvar(var, value, run_after=None):
    return {"runAfter": run_after or {}, "type": "SetVariable", "inputs": {"name": var, "value": value}}


def incr(var, run_after=None):
    return {"runAfter": run_after or {}, "type": "IncrementVariable", "inputs": {"name": var, "value": 1}}


P = "items('Send_to_each_person')"
TF = "items('Share_each_certificate')"
TM = "items('Teams_messages')"
FILE = "items('Get_each_file')"
LIST = "outputs('Mail_list')"


def report_row(email_status, teams, details):
    return {
        "Name": f"@{P}?['Name']",
        "Email": f"@{P}?['Email']",
        "Email status": email_status,
        "Teams": teams,
        "Details": details,
    }


send_now = scope({
    "Clear_attachments": setvar("attachments", []),
    "Get_each_file": loop(
        f"@{P}?['Files']",
        {
            "Get_the_file": op("shared_onedriveforbusiness", "GetFileContentByPath",
                               {"path": f"@{{concat('/Mail Merge/', {FILE}?['Path'])}}", "inferContentType": False}),
            "Add_to_attachments": append("attachments", {"Name": f"@{FILE}?['Name']", "ContentBytes": "@body('Get_the_file')?['$content']"},
                                         {"Get_the_file": ["Succeeded"]}),
        },
        {"Clear_attachments": ["Succeeded"]},
        "PDF / PNG / JPG / Word files for this person",
    ),
    "Send_the_email": op("shared_office365", "SendEmailV2", {
        "emailMessage/To": f"@{P}?['Email']",
        "emailMessage/Cc": f"@{{coalesce({P}?['Cc'], '')}}",
        "emailMessage/Subject": f"@{P}?['Subject']",
        "emailMessage/Body": f"@{P}?['Body']",
        "emailMessage/Attachments": "@variables('attachments')",
        "emailMessage/Importance": "Normal",
    }, {"Get_each_file": ["Succeeded"]}),
    "Email_failed": scope({
        "Note_the_failure": append("report", report_row(
            "Failed", "—",
            "@{if(equals(actions('Get_each_file')?['status'], 'Failed'), "
            "'An attachment was not found in OneDrive /Mail Merge', "
            "coalesce(actions('Send_the_email')?['outputs']?['body']?['error']?['message'], "
            "actions('Send_the_email')?['outputs']?['body']?['message'], "
            "actions('Send_the_email')?['error']?['message'], 'Outlook rejected the email'))}")),
        "Count_failed": incr("failed", {"Note_the_failure": ["Succeeded"]}),
    }, {"Send_the_email": ["Failed", "Skipped", "TimedOut"]}, "Record why it failed"),
    "Email_sent": scope({
        "Reset_teams_notes": setvar("teamsNotes", []),
        "Teams_messages": loop(
            f"@coalesce({P}?['Teams'], json('[]'))",
            {
                "Clear_links": setvar("links", []),
                "Share_each_certificate": loop(
                    f"@coalesce({TM}?['Files'], json('[]'))",
                    {
                        "Keep_a_copy": op("shared_onedriveforbusiness", "CopyDriveFileByPath", {
                            "source": f"@{{concat('/Mail Merge/', {TF}?['Path'])}}",
                            "destination": f"@{{concat('/Mail Merge Certificates/', {LIST}?['eventFolder'], '/', {TF}?['Path'])}}",
                            "overwrite": True,
                        }, description="Permanent copy, so the Teams link keeps working after Mail Merge is replaced"),
                        "Get_a_link": op("shared_onedriveforbusiness", "CreateShareLinkByPathV2", {
                            "path": f"@{{concat('/Mail Merge Certificates/', {LIST}?['eventFolder'], '/', {TF}?['Path'])}}",
                            "type": "View",
                            "scope": "Organization",
                        }, {"Keep_a_copy": ["Succeeded"]}, "View-only link for people in the company"),
                        "Add_the_link": append("links",
                            f"@{{concat('<a href=\"', body('Get_a_link')?['WebUrl'], '\">📄 ', {TF}?['Name'], '</a>')}}",
                            {"Get_a_link": ["Succeeded"]}),
                    },
                    {"Clear_links": ["Succeeded"]},
                    "Their own certificate files, linked in Teams",
                ),
                "Post_in_Teams": op("shared_teams", "PostMessageToConversation", {
                    "poster": "Flow bot",
                    "location": "Chat with Flow bot",
                    "body/recipient": f"@{TM}?['To']",
                    "body/messageBody": f"@{{concat({TM}?['Message'], if(empty(variables('links')), '', concat('<p>', join(variables('links'), '<br>'), '</p>')))}}",
                }, {"Share_each_certificate": ["Succeeded", "Failed", "TimedOut"]}),
                "Teams_ok": append("teamsNotes",
                                   f"@{{concat(if(greater(length({P}?['Teams']), 1), concat({TM}?['To'], ': '), ''), 'Sent', "
                                   "if(equals(actions('Share_each_certificate')?['status'], 'Failed'), ' (no file link: OneDrive sharing failed)', ''))}",
                                   {"Post_in_Teams": ["Succeeded"]}),
                "Teams_failed": append("teamsNotes",
                                       f"@{{concat(if(greater(length({P}?['Teams']), 1), concat({TM}?['To'], ': '), ''), 'Failed: ', "
                                       "coalesce(actions('Post_in_Teams')?['outputs']?['body']?['error']?['message'], "
                                       "actions('Post_in_Teams')?['outputs']?['body']?['message'], 'Teams did not accept the message'))}",
                                       {"Post_in_Teams": ["Failed", "TimedOut"]}),
                "Teams_wait": {
                    "runAfter": {"Teams_ok": ANY_END, "Teams_failed": ANY_END},
                    "type": "Wait",
                    "description": "The Teams bot allows ~25 messages per 5 minutes",
                    "inputs": {"interval": {"count": f"@{LIST}?['teamsWaitSeconds']", "unit": "Second"}},
                },
            },
            {"Reset_teams_notes": ["Succeeded"]},
            "One Teams chat per person in this email",
        ),
        "Teams_summary": setvar("teamsStatus", "@{if(empty(variables('teamsNotes')), '—', join(variables('teamsNotes'), '; '))}",
                                {"Teams_messages": ANY_END}),
        "Note_the_send": append("report", report_row("Sent", "@variables('teamsStatus')", ""), {"Teams_summary": ANY_END}),
        "Count_sent": incr("sent", {"Note_the_send": ["Succeeded"]}),
    }, {"Send_the_email": ["Succeeded"]}),
}, {}, "Email (and Teams) for this person")

per_person = {
    "Send_now": send_now,
    "Wait": {
        "runAfter": {"Send_now": ANY_END},
        "type": "Wait",
        "description": "Stay under Outlook / Teams sending limits",
        "inputs": {"interval": {"count": f"@{LIST}?['waitSeconds']", "unit": "Second"}},
    },
}

report_email_body = (
    "<div style=\"font-family:Calibri,Arial,sans-serif;font-size:11pt\">"
    "<p><b>@{" + LIST + "?['event']}</b> — run finished @{utcNow()} (UTC)</p>"
    "<p>✅ Emails sent: <b>@{variables('sent')}</b> &nbsp; ❌ Failed: <b>@{variables('failed')}</b> &nbsp; 👥 People: <b>@{" + LIST + "?['people']}</b></p>"
    "@{if(equals(length(body('Find_problems')), 0), '<p>No problems 🎉</p>', concat('<p><b>Needs attention:</b></p>', body('Problems_table')))}"
    "<p style=\"color:#666\">Full list for everyone: OneDrive ▸ Mail Merge ▸ @{outputs('Report_file_name')}</p>"
    "</div>"
)

definition = {
    "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "$connections": {"defaultValue": {}, "type": "Object"},
        "$authentication": {"defaultValue": {}, "type": "SecureObject"},
    },
    "triggers": {
        "manual": {"type": "Request", "kind": "Button", "inputs": {"schema": {"type": "object", "properties": {}, "required": []}}}
    },
    "actions": {
        "Set_up": {
            "runAfter": {},
            "type": "InitializeVariable",
            "inputs": {"variables": [{"name": "attachments", "type": "array", "value": []}]},
        },
        "Set_up_report": {"runAfter": {"Set_up": ["Succeeded"]}, "type": "InitializeVariable",
                          "inputs": {"variables": [{"name": "report", "type": "array", "value": []}]}},
        "Set_up_sent": {"runAfter": {"Set_up_report": ["Succeeded"]}, "type": "InitializeVariable",
                        "inputs": {"variables": [{"name": "sent", "type": "integer", "value": 0}]}},
        "Set_up_failed": {"runAfter": {"Set_up_sent": ["Succeeded"]}, "type": "InitializeVariable",
                          "inputs": {"variables": [{"name": "failed", "type": "integer", "value": 0}]}},
        "Set_up_links": {"runAfter": {"Set_up_failed": ["Succeeded"]}, "type": "InitializeVariable",
                         "inputs": {"variables": [{"name": "links", "type": "array", "value": []}]}},
        "Set_up_teams": {"runAfter": {"Set_up_links": ["Succeeded"]}, "type": "InitializeVariable",
                         "inputs": {"variables": [{"name": "teamsStatus", "type": "string", "value": "—"}]}},
        "Set_up_teams_notes": {"runAfter": {"Set_up_teams": ["Succeeded"]}, "type": "InitializeVariable",
                               "inputs": {"variables": [{"name": "teamsNotes", "type": "array", "value": []}]}},
        "Read_the_mail_list": op("shared_onedriveforbusiness", "GetFileContentByPath",
                                 {"path": "/Mail Merge/mail-list.json", "inferContentType": False},
                                 {"Set_up_teams_notes": ["Succeeded"]}, "Mail Merge/mail-list.json — made by Mavericks Studio"),
        "Mail_list": {"runAfter": {"Read_the_mail_list": ["Succeeded"]}, "type": "Compose",
                      "inputs": "@json(base64ToString(body('Read_the_mail_list')?['$content']))"},
        "For_each_part": loop(
            f"@{LIST}?['parts']",
            {
                "Read_this_part": op("shared_onedriveforbusiness", "GetFileContentByPath",
                                     {"path": "@{concat('/Mail Merge/', items('For_each_part'))}", "inferContentType": False}),
                "Send_to_each_person": loop(
                    "@json(base64ToString(body('Read_this_part')?['$content']))",
                    per_person, {"Read_this_part": ["Succeeded"]}, "One person at a time"),
            },
            {"Mail_list": ["Succeeded"]},
            "Big mailings are split into parts",
        ),
        "Report_file_name": {"runAfter": {"For_each_part": ANY_END}, "type": "Compose",
                             "inputs": "@{concat('delivery-report-', formatDateTime(utcNow(), 'yyyy-MM-dd-HHmm'), '.csv')}"},
        "Report_CSV": {"runAfter": {"Report_file_name": ["Succeeded"]}, "type": "Table",
                       "inputs": {"from": "@variables('report')", "format": "CSV"}},
        "Save_the_report": op("shared_onedriveforbusiness", "CreateFile",
                              {"folderPath": "/Mail Merge", "name": "@{outputs('Report_file_name')}", "body": "@body('Report_CSV')"},
                              {"Report_CSV": ["Succeeded"]}),
        "Find_problems": {"runAfter": {"Save_the_report": ["Succeeded", "Failed"]}, "type": "Query",
                          "inputs": {"from": "@variables('report')",
                                     "where": "@or(equals(item()?['Email status'], 'Failed'), contains(string(item()?['Teams']), 'Failed'))"}},
        "Problems_table": {"runAfter": {"Find_problems": ["Succeeded"]}, "type": "Table",
                           "inputs": {"from": "@body('Find_problems')", "format": "HTML"}},
        "Email_the_report": {
            "runAfter": {"Problems_table": ["Succeeded"]},
            "type": "If",
            "expression": {"and": [{"not": {"equals": [f"@coalesce({LIST}?['reportTo'], '')", ""]}}]},
            "actions": {
                "Send_the_report": op("shared_office365", "SendEmailV2", {
                    "emailMessage/To": f"@{LIST}?['reportTo']",
                    "emailMessage/Subject": "Delivery report – @{" + LIST + "?['event']}: @{variables('sent')} sent, @{variables('failed')} failed",
                    "emailMessage/Body": report_email_body,
                    "emailMessage/Importance": "@{if(greater(variables('failed'), 0), 'High', 'Normal')}",
                }),
            },
            "else": {"actions": {}},
        },
    },
}

flow_def = {
    "name": FLOW_NAME,
    "id": f"/providers/Microsoft.Flow/flows/{FLOW_NAME}",
    "type": "Microsoft.Flow/flows",
    "properties": {
        "apiId": "/providers/Microsoft.PowerApps/apis/shared_logicflows",
        "displayName": "Mail Merge - Send v5",
        "definition": definition,
        "connectionReferences": {
            api: {"connectionName": f"{api.replace('_', '-')}-mailmerge", "source": "Embedded",
                  "id": f"/providers/Microsoft.PowerApps/apis/{api}", "tier": "NotSpecified"}
            for api in API
        },
        "flowFailureAlertSubscribed": False,
        "isManaged": False,
    },
}

resources = {
    FLOW_ID: {
        "type": "Microsoft.Flow/flows",
        "suggestedCreationType": "New",
        "creationType": "Existing, New, Update",
        "details": {"displayName": "Mail Merge - Send v5"},
        "configurableBy": "User",
        "hierarchy": "Root",
        "dependsOn": [x for a in API.values() for x in (a[0], a[1])],
    }
}
for api, (api_id, conn_id, display, icon) in API.items():
    resources[api_id] = {
        "id": f"/providers/Microsoft.PowerApps/apis/{api}", "name": api, "type": "Microsoft.PowerApps/apis",
        "suggestedCreationType": "Existing", "details": {"displayName": display, "iconUri": icon},
        "configurableBy": "System", "hierarchy": "Child", "dependsOn": [],
    }
    resources[conn_id] = {
        "type": "Microsoft.PowerApps/apis/connections", "suggestedCreationType": "Existing", "creationType": "Existing",
        "details": {"displayName": display, "iconUri": icon},
        "configurableBy": "User", "hierarchy": "Child", "dependsOn": [api_id],
    }

manifest = {
    "schema": "1.0",
    "details": {
        "displayName": "Mail Merge - Send v5",
        "description": "Mavericks Studio v5: emails (one per person or per group, optional CC) + optional Teams chat with each person's certificate link, with a delivery report.",
        "createdTime": "2026-11-09T15:00:00.0000000Z",
        "packageTelemetryId": "8f9a0b1c-2d3e-4f5a-9b6c-7d8e9f0a1b2c",
        "creator": "N/A",
        "sourceEnvironment": "",
    },
    "resources": resources,
}

if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest))
        z.writestr("Microsoft.Flow/flows/manifest.json",
                   json.dumps({"packageSchemaVersion": "1.0", "flowAssets": {"assetPaths": [FLOW_ID]}}))
        base = f"Microsoft.Flow/flows/{FLOW_ID}/"
        z.writestr(base + "definition.json", json.dumps(flow_def))
        z.writestr(base + "apisMap.json", json.dumps({api: v[0] for api, v in API.items()}))
        z.writestr(base + "connectionsMap.json", json.dumps({api: v[1] for api, v in API.items()}))
    print("Wrote", OUT)
