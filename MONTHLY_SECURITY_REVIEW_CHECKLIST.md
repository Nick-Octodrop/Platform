# Monthly Security Review Checklist

Date: 2026-04-07

## Monthly Checklist

- Run `python3 scripts/security_check.py --strict`.
- Run `python3 scripts/runtime_security_verify.py` against staging and production.
- Review auth failure trends and top source IPs/user agents.
- Review 401/403/404 spikes for tenant probing patterns.
- Review rejected webhook events.
- Review `module_audit` for out-of-window changes.
- Review access profile and platform-role changes.
- Review new uses of `db_internal_service()`.
- Review dependency audit output from CI.
- Review stale secrets and upcoming rotations.
- Confirm `attachments` bucket remains private.
- Confirm backup jobs completed successfully.
- Confirm latest restore test status and next scheduled restore test date.

## Pre-Release Checklist

- Confirm new migrations include ownership fields and RLS policy coverage for tenant-owned tables.
- Confirm no generated module path can create unscoped physical tables.
- Run security-focused tests:

```bash
python3 scripts/security_check.py --strict
./.venv/Scripts/python.exe -m pytest tests/test_security_controls.py tests/test_runtime_security_verify.py
```

- For release candidates, run staging integration tests with two workspaces:

```bash
OCTO_RUN_STAGING_SECURITY_TESTS=1 ./.venv/Scripts/python.exe -m pytest tests/test_staging_security_integration.py
```

- Confirm no real tokens were added to docs, manifests, or seed scripts.
- Confirm dependency audit has no unresolved high/critical findings.

## Patch Cadence

- Critical security dependency: patch or mitigate within 24-72 hours.
- High security dependency: patch within 7 days.
- Medium security dependency: patch in next planned release unless exploitability is elevated.
- Low security dependency: track and patch during normal maintenance.

