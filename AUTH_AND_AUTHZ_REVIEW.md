# Auth and Authorization Review

## Authentication

`app/auth.py` validates Supabase JWTs using JWKS and issuer/audience configuration. External API clients can authenticate with `X-Api-Key` on `/ext/*`.

Immediate fix applied: invalid bearer-token response details are hidden in production.

## Authorization

Workspace resolution and role/capability checks are implemented in `app/main.py`. Admin routes use `_require_admin`, superadmin routes use `_require_superadmin`, and entity/field/action access policies are applied for generated modules.

## Key Risks

- `OCTO_DISABLE_AUTH=1` creates a privileged local actor and must never be allowed in production.
- API credential scopes are relatively broad (`records.read/write`) and should be reviewed for entity-level least privilege.
- Generated module field visibility can affect runtime rendering and object access; this now has better frontend/backend pruning, but security tests should continue to cover it.
- Admin-only features should have explicit tests for every route family, not only helper functions.

## Required Next Steps

- Add production startup guard that refuses `OCTO_DISABLE_AUTH`.
- Add admin-only endpoint tests for Studio, settings, access profiles, secrets, integrations, automations, and module apply/rollback.
- Add entity-level scopes to API credentials where needed.
- Audit all routes that accept `workspace_id`, `org_id`, `module_id`, `entity_id`, `record_id`, or `attachment_id`.

