"""Builds power-automate/Mail-Merge-Send.zip — a Power Automate flow package you import via
My flows > Import > Import Package (Legacy).

v3 flow (Manually trigger):
  Set up variables (attachments, report, counters)
  Read the mail list -> Mail list (index: parts, event, reportTo, waitSeconds)
  For each part (mail-list-part-NNN.json — keeps every decoded text under PA's 131,072-char limit)
    Send to each person (one at a time)
      Check if already sent        OneDrive: /Mail Merge History/<CheckKey>.txt exists?
      Already sent  (if it exists) -> report "Skipped"
      Send now      (if it doesn't)
        Clear attachments, Get each file -> Add to attachments
        Send the email (Outlook)
        Email failed  -> report "Failed" + reason
        Email sent    -> Remember it (/Mail Merge History/<Key>.txt)
                       -> Teams ping (Flow bot chat) if TeamsTo is set
                       -> report "Sent" (+ Teams result)
      Wait (2 s, or 12 s when Teams is on — Flow bot allows 25 messages / 5 minutes)
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

FLOW_ID = "b7c8d9e0-f1a2-4b3c-8d4e-5f6a7b8c9d0e"     # package resource id / folder (v3)
FLOW_NAME = "c8d9e0f1-a2b3-4c4d-9e5f-6a7b8c9d0e1f"   # flow name inside definition (v3)
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
        "Remember_it_was_sent": op("shared_onedriveforbusiness", "CreateFile", {
            "folderPath": "/Mail Merge History",
            "name": f"@{{{P}?['Key']}}.txt",
            "body": f"@{{{P}?['Email']}} | @{{{P}?['Subject']}} | @{{utcNow()}}",
        }, description="So a later run never sends this person the same thing again"),
        "Teams_ping": {
            "runAfter": {"Remember_it_was_sent": ["Succeeded", "Failed"]},
            "type": "If",
            "expression": {"and": [{"not": {"equals": [f"@coalesce({P}?['TeamsTo'], '')", ""]}}]},
            "actions": {
                "Post_in_Teams": op("shared_teams", "PostMessageToConversation", {
                    "poster": "Flow bot",
                    "location": "Chat with Flow bot",
                    "body/recipient": f"@{P}?['TeamsTo']",
                    "body/messageBody": f"@{P}?['TeamsMessage']",
                }),
                "Teams_ok": setvar("teamsStatus", "Sent", {"Post_in_Teams": ["Succeeded"]}),
                "Teams_failed": setvar("teamsStatus",
                                       "@{concat('Failed: ', coalesce(actions('Post_in_Teams')?['outputs']?['body']?['error']?['message'], "
                                       "actions('Post_in_Teams')?['outputs']?['body']?['message'], 'Teams did not accept the message'))}",
                                       {"Post_in_Teams": ["Failed", "TimedOut"]}),
            },
            "else": {"actions": {"No_Teams": setvar("teamsStatus", "—")}},
        },
        "Note_the_send": append("report", report_row("Sent", "@variables('teamsStatus')", ""), {"Teams_ping": ANY_END}),
        "Count_sent": incr("sent", {"Note_the_send": ["Succeeded"]}),
    }, {"Send_the_email": ["Succeeded"]}),
}, {"Check_if_already_sent": ["Failed"]}, "Not sent before — send it")

already_sent = scope({
    "Note_the_skip": append("report", report_row(
        "Skipped", "—", "@{concat('Already received this on ', coalesce(body('Check_if_already_sent')?['LastModified'], 'an earlier run'))}")),
    "Count_skipped": incr("skipped", {"Note_the_skip": ["Succeeded"]}),
}, {"Check_if_already_sent": ["Succeeded"]}, "Already received it in an earlier run — don't send twice")

per_person = {
    "Check_if_already_sent": op("shared_onedriveforbusiness", "GetFileMetadataByPath",
                                {"path": f"@{{concat('/Mail Merge History/', {P}?['CheckKey'], '.txt')}}"},
                                description="A marker file exists for everyone who already received this"),
    "Already_sent": already_sent,
    "Send_now": send_now,
    "Wait": {
        "runAfter": {"Send_now": ["Succeeded", "Failed", "TimedOut"]},
        "type": "Wait",
        "description": "Stay under Outlook / Teams sending limits",
        "inputs": {"interval": {"count": f"@{LIST}?['waitSeconds']", "unit": "Second"}},
    },
}

report_email_body = (
    "<div style=\"font-family:Calibri,Arial,sans-serif;font-size:11pt\">"
    "<p><b>@{" + LIST + "?['event']}</b> — run finished @{utcNow()} (UTC)</p>"
    "<p>✅ Sent: <b>@{variables('sent')}</b> &nbsp; ❌ Failed: <b>@{variables('failed')}</b> &nbsp; ⏭️ Skipped (already received): <b>@{variables('skipped')}</b></p>"
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
        "Set_up_skipped": {"runAfter": {"Set_up_failed": ["Succeeded"]}, "type": "InitializeVariable",
                           "inputs": {"variables": [{"name": "skipped", "type": "integer", "value": 0}]}},
        "Set_up_teams": {"runAfter": {"Set_up_skipped": ["Succeeded"]}, "type": "InitializeVariable",
                         "inputs": {"variables": [{"name": "teamsStatus", "type": "string", "value": "—"}]}},
        "Read_the_mail_list": op("shared_onedriveforbusiness", "GetFileContentByPath",
                                 {"path": "/Mail Merge/mail-list.json", "inferContentType": False},
                                 {"Set_up_teams": ["Succeeded"]}, "Mail Merge/mail-list.json — made by Mavericks Studio"),
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
                                     "where": "@or(equals(item()?['Email status'], 'Failed'), startsWith(string(item()?['Teams']), 'Failed'))"}},
        "Problems_table": {"runAfter": {"Find_problems": ["Succeeded"]}, "type": "Table",
                           "inputs": {"from": "@body('Find_problems')", "format": "HTML"}},
        "Email_the_report": {
            "runAfter": {"Problems_table": ["Succeeded"]},
            "type": "If",
            "expression": {"and": [{"not": {"equals": [f"@coalesce({LIST}?['reportTo'], '')", ""]}}]},
            "actions": {
                "Send_the_report": op("shared_office365", "SendEmailV2", {
                    "emailMessage/To": f"@{LIST}?['reportTo']",
                    "emailMessage/Subject": "Delivery report – @{" + LIST + "?['event']}: @{variables('sent')} sent, @{variables('failed')} failed, @{variables('skipped')} skipped",
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
        "displayName": "Mail Merge - Send",
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
        "details": {"displayName": "Mail Merge - Send"},
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
        "displayName": "Mail Merge - Send",
        "description": "Mavericks Studio v3: one email (+ optional Teams ping) per person in OneDrive /Mail Merge, never twice, with a delivery report.",
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
