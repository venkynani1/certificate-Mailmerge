"""Builds power-automate/Mail-Merge-Send.zip — a Power Automate flow package you import via
My flows > Import > Import Package (Legacy).

The flow:  Manually trigger
           -> Read the mail list   (OneDrive: /Mail Merge/mail-list.json)
           -> Send to each person  (for each row, one at a time)
                -> Get their file  (OneDrive: /Mail Merge/<File>)
                -> Send the email  (Outlook: To, Subject, Body, attachment)
                -> Wait 2 seconds

Paths are used instead of file IDs so the package works in anyone's OneDrive.
Run:  python3 tools/build_flow_package.py
"""
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "power-automate" / "Mail-Merge-Send.zip"

FLOW_ID = "6f1c2b7e-3d4a-4e5f-9a8b-1c2d3e4f5a6b"     # package resource id / folder
FLOW_NAME = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"   # flow name inside definition
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


ITEM = "items('Send_to_each_person')"

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
        "Read_the_mail_list": dict(
            op("shared_onedriveforbusiness", "GetFileContentByPath",
               {"path": "/Mail Merge/mail-list.json", "inferContentType": False}, {}),
            description="Reads Mail Merge/mail-list.json that the app put in the ZIP",
        ),
        "Send_to_each_person": {
            "runAfter": {"Read_the_mail_list": ["Succeeded"]},
            "type": "Foreach",
            "description": "One email per row, one at a time",
            "foreach": "@json(base64ToString(body('Read_the_mail_list')?['$content']))",
            "runtimeConfiguration": {"concurrency": {"repetitions": 1}},
            "actions": {
                "Get_their_file": op(
                    "shared_onedriveforbusiness", "GetFileContentByPath",
                    {"path": f"@{{concat('/Mail Merge/', {ITEM}?['File'])}}", "inferContentType": False}, {}),
                "Send_the_email": op(
                    "shared_office365", "SendEmailV2",
                    {
                        "emailMessage/To": f"@{ITEM}?['Email']",
                        "emailMessage/Subject": f"@{ITEM}?['Subject']",
                        "emailMessage/Body": f"@{ITEM}?['Body']",
                        "emailMessage/Attachments": [
                            {"Name": f"@{ITEM}?['FileName']", "ContentBytes": "@body('Get_their_file')?['$content']"}
                        ],
                        "emailMessage/Importance": "Normal",
                    },
                    {"Get_their_file": ["Succeeded"]}),
                "Wait_2_seconds": {
                    "runAfter": {"Send_the_email": ["Succeeded", "Failed"]},
                    "type": "Wait",
                    "description": "Stays under Outlook's sending limit",
                    "inputs": {"interval": {"count": 2, "unit": "Second"}},
                },
            },
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
        "description": "Sends each person in OneDrive /Mail Merge/mail-list.json their own email and attachment (Mail Merge Studio).",
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
