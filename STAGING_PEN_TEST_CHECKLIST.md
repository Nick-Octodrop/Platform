# Staging Pen Test Checklist

Date: 2026-04-07

## Scope

Use staging with two separate workspaces and two non-superadmin users. The goal is to prove controls in a real environment, not just via unit tests.

## Required Fixtures

- Workspace A user token.
- Workspace B user token.
- A record in Workspace A.
- A normal entity id used by both workspaces, where possible.
- Optional: an attachment in Workspace A.
- Optional: a signed inbound webhook in Workspace A.

## Automated Staging Tests

Run:

```bash
OCTO_RUN_STAGING_SECURITY_TESTS=1 \
OCTO_STAGING_BASE_URL="<staging-base-url>" \
OCTO_STAGING_TOKEN_A="<token-a>" \
OCTO_STAGING_TOKEN_B="<token-b>" \
OCTO_STAGING_WORKSPACE_A="<workspace-a>" \
OCTO_STAGING_WORKSPACE_B="<workspace-b>" \
OCTO_STAGING_ENTITY_ID="<entity-id>" \
OCTO_STAGING_RECORD_ID_A="<workspace-a-record-id>" \
./.venv/Scripts/python.exe -m pytest tests/test_staging_security_integration.py
```

Add optional tests:

```bash
OCTO_STAGING_ATTACHMENT_ID_A="<workspace-a-attachment-id>"
OCTO_STAGING_WEBHOOK_ID="<workspace-a-webhook-id>"
OCTO_STAGING_WEBHOOK_SECRET="<workspace-a-webhook-secret>"
```

## Manual Abuse Cases

- Use Workspace B token/header to fetch Workspace A record by direct id. Expected: `403` or `404`.
- Use Workspace B token/header to search/list for Workspace A record id. Expected: no record id in response.
- Use Workspace B token/header to update/delete Workspace A record. Expected: `403` or `404`.
- Use Workspace B token/header to download Workspace A attachment. Expected: `403` or `404`.
- Try changing `X-Workspace-Id` to another workspace while using a user not assigned to it. Expected: `403` or no membership.
- Try accessing admin/settings/access-profile routes with a standard user. Expected: `403`.
- Send forged webhook signatures. Expected: rejected.
- Replay an old timestamped webhook signature. Expected: rejected when a signing secret is configured.
- Try Studio/module-generation endpoints as a standard user. Expected: `403`.

## Evidence To Capture

- Command output from `scripts/runtime_security_verify.py`.
- Output from `tests/test_staging_security_integration.py`.
- Screenshots or logs for any manually verified storage policy setup.
- API logs showing blocked cross-tenant attempts without leaking sensitive detail.

