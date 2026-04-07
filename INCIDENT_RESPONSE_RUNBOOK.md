# Incident Response Runbook

## Severity Triggers

- Tenant data exposed across workspaces.
- API token, Supabase service-role key, DB URL, or `APP_SECRET_KEY` exposed.
- Public attachment bucket or unauthorized file download.
- Webhook forgery causing record changes.
- Studio/generated module privilege escalation.

## First 30 Minutes

1. Preserve evidence: logs, request ids, affected workspace ids, user ids, and deployment version.
2. Disable the affected integration/token/path if containment is possible.
3. Rotate exposed secrets or revoke sessions.
4. Stop unsafe workers if they may continue processing bad jobs.
5. Snapshot database and storage metadata before destructive cleanup.

## Containment

- For leaked bearer tokens: revoke sessions or rotate JWT signing/session state through Supabase controls.
- For leaked service-role keys: rotate Supabase service-role key and redeploy.
- For attachment exposure: make bucket private, invalidate signed URLs, and audit attachment access logs.
- For webhook forgery: disable webhook endpoint, rotate signing secret, and replay only verified events.
- For Studio/module compromise: disable module/apply routes for non-superadmins, rollback manifests, and audit generated changes.

## Eradication and Recovery

- Patch the vulnerable route/policy.
- Add a regression test for the exploit path.
- Backfill audit logs if missing.
- Restore records only after tenant-scoped verification.
- Notify affected customers according to legal obligations and contractual terms.

## Post-Incident

- Produce timeline and root cause.
- Identify missing detection.
- Add checklist item to `PRODUCTION_SECURITY_CHECKLIST.md`.
- Run `make security` and full regression tests before redeploy.

