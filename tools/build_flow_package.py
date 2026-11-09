"""Builds power-automate/Mail-Merge-Send.zip — a Power Automate flow package you import via
My flows > Import > Import Package (Legacy).

v2 flow:  Manually trigger
          -> Start an empty attachment list
          -> Read the mail list            (OneDrive: /Mail Merge/mail-list.json -> list of parts)
          -> For each part                 (mail-list-part-NNN.json, keeps texts under PA's 131k limit)
               -> Send to each person      (one at a time)
                    -> Clear attachments
                    -> Get each file -> Get the file -> Add to attachments   (PDF + PNG + JPG / Word)
                    -> Send the email      (Outlook: To, Subject, Body, all attachments)
                    -> Wait 2 seconds

Paths are used instead of file IDs so the package works in anyone's OneDrive.
Run:  python3 tools/build_flow_package.py
"""
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "power-automate" / "Mail-Merge-Send.zip"

FLOW_ID = "8d2e4f6a-1b3c-4d5e-9f7a-2b4c6d8e0f1a"     # package resource id / folder
FLOW_NAME = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"   # flow name inside definition
API_OD = "2a4c6e8f-1b3d-4f5a-8c7e-9d0b2a4c6e8f"
API_O365 = "3b5d7f9a-2c4e-4a6b-9d8f-0e1c3b5d7f9a"
CONN_OD = "4c6e8a0b-3d5f-4b7c-8e9a-1f2d4c6e8a0b"
CONN_O365 = "5d7f9b1c-4e6a-4c8d-9f0b-2a3e5d7f9b1c"

AUTH = {"value": "@json(decodeBase64(triggerOutputs().headers['X-MS-APIM-Tokens']))['$ConnectionKey']", "type": "Raw"}


def op(api, operation, params, run_after):
    return {
        "runAfter": run_after,
        "type": "OpenApiConnection",
        "inputs": {
            "host": {
                "apiId": f"/providers/Microsoft.PowerApps/apis/{api}",
                "connectionName": api,
                "operationId": operation,
            },
            "parameters": params,
            "authentication": AUTH,
        },
    }


PERSON = "items('Send_to_each_person')"
FILE = "items('Get_each_file')"

def loop(foreach, actions, run_after, description):
    return {
        "runAfter": run_after,
        "type": "Foreach",
        "description": description,
        "foreach": foreach,
        "runtimeConfiguration": {"concurrency": {"repetitions": 1}},
        "actions": actions,
    }

# Mail list layout written by the app (keeps every text Power Automate has to decode
# well under its 131,072-character expression limit, so any number of people works):
#   /Mail Merge/mail-list.json          {"parts": ["mail-list-part-001.json", ...], ...}
#   /Mail Merge/mail-list-part-NNN.json [{"Email","Name","Subject","Body","Files":[{"Name","Path"}]}]
definition = {
    "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "$connections": {"defaultValue": {}, "type": "Object"},
        "$authentication": {"defaultValue": {}, "type": "SecureObject"},
    },
    "triggers": {
        "manual": {
            "type": "Request",
            "kind": "Button",
            "inputs": {"schema": {"type": "object", "properties": {}, "required": []}},
        }
    },
    "actions": {
        "Start_an_empty_attachment_list": {
            "runAfter": {},
            "type": "InitializeVariable",
            "inputs": {"variables": [{"name": "attachments", "type": "array", "value": []}]},
        },
        "Read_the_mail_list": dict(
            op("shared_onedriveforbusiness", "GetFileContentByPath",
               {"path": "/Mail Merge/mail-list.json", "inferContentType": False},
               {"Start_an_empty_attachment_list": ["Succeeded"]}),
            description="Mail Merge/mail-list.json lists the parts of the mailing",
        ),
        "For_each_part": loop(
            "@json(base64ToString(body('Read_the_mail_list')?['$content']))?['parts']",
            {
                "Read_this_part": op(
                    "shared_onedriveforbusiness", "GetFileContentByPath",
                    {"path": "@{concat('/Mail Merge/', items('For_each_part'))}", "inferContentType": False}, {}),
                "Send_to_each_person": loop(
                    "@json(base64ToString(body('Read_this_part')?['$content']))",
                    {
                        "Clear_attachments": {
                            "runAfter": {},
                            "type": "SetVariable",
                            "inputs": {"name": "attachments", "value": []},
                        },
                        "Get_each_file": loop(
                            f"@{PERSON}?['Files']",
                            {
                                "Get_the_file": op(
                                    "shared_onedriveforbusiness", "GetFileContentByPath",
                                    {"path": f"@{{concat('/Mail Merge/', {FILE}?['Path'])}}", "inferContentType": False}, {}),
                                "Add_to_attachments": {
                                    "runAfter": {"Get_the_file": ["Succeeded"]},
                                    "type": "AppendToArrayVariable",
                                    "inputs": {
                                        "name": "attachments",
                                        "value": {
                                            "Name": f"@{FILE}?['Name']",
                                            "ContentBytes": "@body('Get_the_file')?['$content']",
                                        },
                                    },
                                },
                            },
                            {"Clear_attachments": ["Succeeded"]},
                            "PDF / PNG / JPG / Word files for this person",
                        ),
                        "Send_the_email": op(
                            "shared_office365", "SendEmailV2",
                            {
                                "emailMessage/To": f"@{PERSON}?['Email']",
                                "emailMessage/Subject": f"@{PERSON}?['Subject']",
                                "emailMessage/Body": f"@{PERSON}?['Body']",
                                "emailMessage/Attachments": "@variables('attachments')",
                                "emailMessage/Importance": "Normal",
                            },
                            {"Get_each_file": ["Succeeded"]}),
                        "Wait_2_seconds": {
                            "runAfter": {"Send_the_email": ["Succeeded", "Failed", "Skipped"]},
                            "type": "Wait",
                            "description": "Stays under Outlook's sending limit",
                            "inputs": {"interval": {"count": 2, "unit": "Second"}},
                        },
                    },
                    {"Read_this_part": ["Succeeded"]},
                    "One email per person, one at a time",
                ),
            },
            {"Read_the_mail_list": ["Succeeded"]},
            "Big mailings are split into parts",
        ),
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
            "shared_onedriveforbusiness": {
                "connectionName": "shared-onedriveforbu-mailmerge",
                "source": "Embedded",
                "id": "/providers/Microsoft.PowerApps/apis/shared_onedriveforbusiness",
                "tier": "NotSpecified",
            },
            "shared_office365": {
                "connectionName": "shared-office365-mailmerge",
                "source": "Embedded",
                "id": "/providers/Microsoft.PowerApps/apis/shared_office365",
                "tier": "NotSpecified",
            },
        },
        "flowFailureAlertSubscribed": False,
        "isManaged": False,
    },
}

manifest = {
    "schema": "1.0",
    "details": {
        "displayName": "Mail Merge - Send",
        "description": "Mail Merge Studio v2: sends each person in OneDrive /Mail Merge their own email with all their attachments. Any number of people.",
        "createdTime": "2026-11-09T13:30:00.0000000Z",
        "packageTelemetryId": "7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b",
        "creator": "N/A",
        "sourceEnvironment": "",
    },
    "resources": {
        FLOW_ID: {
            "type": "Microsoft.Flow/flows",
            "suggestedCreationType": "New",
            "creationType": "Existing, New, Update",
            "details": {"displayName": "Mail Merge - Send"},
            "configurableBy": "User",
            "hierarchy": "Root",
            "dependsOn": [API_OD, CONN_OD, API_O365, CONN_O365],
        },
        API_OD: {
            "id": "/providers/Microsoft.PowerApps/apis/shared_onedriveforbusiness",
            "name": "shared_onedriveforbusiness",
            "type": "Microsoft.PowerApps/apis",
            "suggestedCreationType": "Existing",
            "details": {"displayName": "OneDrive for Business", "iconUri": "https://connectoricons-prod.azureedge.net/onedriveforbusiness/icon_1.0.1018.1239.png"},
            "configurableBy": "System",
            "hierarchy": "Child",
            "dependsOn": [],
        },
        CONN_OD: {
            "type": "Microsoft.PowerApps/apis/connections",
            "suggestedCreationType": "Existing",
            "creationType": "Existing",
            "details": {"displayName": "OneDrive for Business", "iconUri": "https://connectoricons-prod.azureedge.net/onedriveforbusiness/icon_1.0.1018.1239.png"},
            "configurableBy": "User",
            "hierarchy": "Child",
            "dependsOn": [API_OD],
        },
        API_O365: {
            "id": "/providers/Microsoft.PowerApps/apis/shared_office365",
            "name": "shared_office365",
            "type": "Microsoft.PowerApps/apis",
            "suggestedCreationType": "Existing",
            "details": {"displayName": "Office 365 Outlook", "iconUri": "https://connectoricons-prod.azureedge.net/office365/icon_1.0.1008.1183.png"},
            "configurableBy": "System",
            "hierarchy": "Child",
            "dependsOn": [],
        },
        CONN_O365: {
            "type": "Microsoft.PowerApps/apis/connections",
            "suggestedCreationType": "Existing",
            "creationType": "Existing",
            "details": {"displayName": "Office 365 Outlook", "iconUri": "https://connectoricons-prod.azureedge.net/office365/icon_1.0.1008.1183.png"},
            "configurableBy": "User",
            "hierarchy": "Child",
            "dependsOn": [API_O365],
        },
    },
}

OUT.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("manifest.json", json.dumps(manifest))
    z.writestr("Microsoft.Flow/flows/manifest.json",
               json.dumps({"packageSchemaVersion": "1.0", "flowAssets": {"assetPaths": [FLOW_ID]}}))
    base = f"Microsoft.Flow/flows/{FLOW_ID}/"
    z.writestr(base + "definition.json", json.dumps(flow_def))
    z.writestr(base + "apisMap.json", json.dumps({"shared_onedriveforbusiness": API_OD, "shared_office365": API_O365}))
    z.writestr(base + "connectionsMap.json", json.dumps({"shared_onedriveforbusiness": CONN_OD, "shared_office365": CONN_O365}))
print("Wrote", OUT)
