# Security Test Plan

## Automated Tests Added

- `tests/test_security_controls.py`:
  - secret scanner flags JWT-like tokens
  - placeholder token examples are allowed
  - memory generic records are tenant scoped
  - webhook signature verification accepts fresh timestamped signatures
  - webhook signature verification rejects missing or expired timestamps when strict mode is required

## CI Checks Added

- `.github/workflows/security.yml`:
  - local security check
  - Python dependency audit via `pip-audit`
  - frontend dependency audit via `npm audit --audit-level=high`
  - selected security and tenant tests

## Tests Still Needed

- Real Postgres/Supabase cross-tenant RLS tests.
- Storage bucket direct-access denial tests.
- Admin-only route tests across Studio, settings, access policies, integrations, and automations.
- API credential scope tests.
- Webhook route-level signature tests, not only helper tests.
- Generated manifest safety tests for unsafe actions, hidden fields, orphan pages, and cross-module access.
- Upload 413 route tests.
- Production CORS/trusted-host tests.

