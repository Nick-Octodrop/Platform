# Phase 0 Status Report (Foundation)

Date: 2026-02-07

## 1) Inventory — Where we are at

Key files located:
- Manifest contract: `MANIFEST_CONTRACT.md`
- Manifest validation: `app/manifest_validate.py` (entry: `validate_manifest_raw`, `validate_manifest`)
- Manifest normalization: `app/manifest_normalize.py`
- Conditions engine: `app/conditions.py` (entry: `eval_condition`)
- Form renderer: `web/src/ui/FormViewRenderer.jsx`
- App shell: `web/src/apps/AppShell.jsx`
- Studio endpoints & module lifecycle: `app/main.py` (studio/studio2 endpoints, install/upgrade/rollback/delete)
- Module registry + persistence: `app/stores_db.py` (`DbModuleRegistry`, `DbManifestStore`, `DbDraftStore`)
- Delete module helper: `app/module_delete.py`
- Auth: `app/auth.py` (Supabase JWT middleware)
- Migrations: `app/migrations/*.sql` (orgs/org_members, modules_installed, manifest_snapshots, drafts)

## 2) Current State Summary

### 2.1 Module lifecycle (install/upgrade/rollback/drafts)
Exists:
- Lifecycle status + active_version + last_error + archived on `modules_installed` (migration `017_module_versions.sql`).
- Version history: `module_versions` table with immutable manifest snapshots + version numbers.
- Install/upgrade/rollback:
  - `DbModuleRegistry._apply` now writes `module_versions`, updates status/active_version, and records failures.
  - Rollback supports `to_version_id`/`to_version_num` (DB + in-memory).
  - Endpoints: `/modules/{module_id}/rollback`, `/studio/modules/{id}/upgrade`, `/studio/modules/{id}/rollback`.
- Delete behavior:
  - API: `DELETE /modules/{module_id}` and `/studio/modules/{id}/delete` (admin-only).
  - Soft delete via `archived=true` + `enabled=false`; blocked if module has records unless `force=true`.
- Drafts and draft versions:
  - Tables: `module_drafts`, `module_draft_versions` (migrations `006`, `012`, `013`).
  - APIs: `/studio/modules/{module_id}/draft`, `/studio2/modules/{module_id}/draft`, `/studio2/modules/{module_id}/rollback` (draft rollback).

Missing / incomplete for Phase 0:
- Full transactional coupling of manifest snapshot + module metadata is best-effort (single DB connection is used, but non-DB steps still exist).
- UI surface for `force` delete when records exist (backend supports it).

### 2.2 Manifest validation coverage
Exists:
- Allowlisted top-level keys and structure validation in `app/manifest_validate.py`.
- Validation for view headers, actions, conditions, workflows, fields, page blocks, etc.
- Condition syntax validation and evaluation (`app/conditions.py`).
- Trigger schema contract + validation (v1.3): `MANIFEST_CONTRACT.md` + `app/manifest_validate.py`.

Missing / incomplete:
- No explicit validation for “form validity” or workflow state references in conditions.

### 2.3 Studio parity (list/form/actions/conditions/triggers)
Exists:
- List/form rendering: `web/src/ui/ListViewRenderer.jsx`, `web/src/ui/FormViewRenderer.jsx`.
- Actions evaluated and executed via `AppShell.jsx` + API in `app/main.py`.
- Conditions engine used for visibility/required logic (`evalCondition` in UI; `eval_condition` in backend).
- Chatter block supported (v1.2+).
- Triggers: schema validated and emitted at runtime (record created/updated, workflow status change, action clicked).

Missing / incomplete:
- List and form containers are not fully guaranteed to share identical layout rules (some pages use custom containers).
- “New” from list is not guaranteed to open a consistent form container when called from all contexts.

### 2.4 Tenancy model (workspace/company/user)
Exists:
- Tables `workspaces`, `workspace_members` (migration `016_workspaces.sql`).
- Actor resolution + scoping via `app/main.py::_resolve_actor` and `actor_context_middleware`:
  - Establishes `workspace_id`, role, and enforces membership.
  - Sets `org_id` context for DB queries.
- Role enforcement for admin-only endpoints via `_require_admin`.
- Bootstrap flow: first login creates a workspace (`create_workspace_for_user`).

Missing / incomplete:
- Company model (if separate from workspace) is not implemented.

### 2.5 Known perf issues / instrumentation
Exists:
- DB query timing + slow query logging in `app/db.py`.
- request timing logging in `app/main.py` (middleware already present).

Missing / incomplete:
- No explicit perf regression tests.
- Some endpoints still issue multiple DB roundtrips (e.g., manifest fetch + compile + registry snapshot).

## 3) Phase 0 Gaps (Must Implement)

1) Studio parity fixes:
   - Consistent list/form containers and “New” flow.
   - Actions validation and consistent behavior across list/form.

2) Tests:
   - Manifest trigger validation errors.
   - Install → upgrade → rollback.
   - Workspace scoping and role enforcement.

## 4) Notes / Follow-ups

- Secrets encryption: keep `secrets.secret_enc` path enabled for prod; allow env fallback only for dev (remove `secret_ref` to use `POSTMARK_API_TOKEN`). Revisit to ensure prod is using encrypted secrets end-to-end.
