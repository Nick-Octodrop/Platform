# Table Policy Matrix

| Table | Ownership field | Policy model | Notes |
| --- | --- | --- | --- |
| `records_generic` | `tenant_id` | Tenant equality | Generated module records live here. |
| `modules_installed` | `org_id` | Tenant equality | Module registry per workspace. |
| `manifest_snapshots` | `org_id` | Tenant equality | Manifest history. |
| `manifest_audit` | `org_id` | Tenant equality | Legacy manifest audit. |
| `module_audit` | `org_id` | Tenant equality | Module audit. |
| `module_versions` | `org_id` | Tenant equality | Version history. |
| `module_drafts` | `org_id` | Tenant equality | `035` backfilled tenant ownership. |
| `module_draft_versions` | `org_id` | Tenant equality | `035` backfilled tenant ownership. |
| `contacts` | `org_id` | Tenant equality | Legacy contacts table. |
| `templates` | `org_id` | Tenant equality | Legacy templates table. |
| `jobs` | `org_id` | Tenant equality | Worker jobs must carry org id. |
| `job_events` | `org_id` | Tenant equality | Job event logs. |
| `workflow_instances` | `org_id` | Tenant equality | Workflow state. |
| `workflow_instance_events` | `org_id` | Tenant equality | Workflow audit events. |
| `records_chatter` | `org_id` | Tenant equality | Chatter entries. |
| `record_activity_events` | `org_id` | Tenant equality | Activity feed. |
| `saved_filters` | `org_id` | Tenant equality | User filters scoped by workspace. |
| `user_entity_prefs` | `org_id` | Tenant equality | User prefs scoped by workspace. |
| `workspace_ui_prefs` | `org_id` | Tenant equality | Workspace UI prefs. |
| `user_ui_prefs` | `org_id` | Tenant equality | User UI prefs. |
| `notifications` | `org_id` | Tenant equality | Recipient-specific filtering remains app-level. |
| `email_templates` | `org_id` | Tenant equality | Email templates. |
| `email_outbox` | `org_id` | Tenant equality | Worker must set org context. |
| `doc_templates` | `org_id` | Tenant equality | Document templates. |
| `attachments` | `org_id` | Tenant equality | Metadata only; storage policy covers object path. |
| `attachment_links` | `org_id` | Tenant equality | Route layer also validates record access. |
| `secrets` | `org_id` | Tenant equality | Secret metadata/encrypted payload. |
| `connections` | `org_id` | Tenant equality | Integration connections. |
| `integration_connection_secrets` | `org_id` | Tenant equality | Connection-secret links. |
| `integration_mappings` | `org_id` | Tenant equality | Integration mappings. |
| `integration_webhooks` | `org_id` | Tenant equality plus internal lookup | Inbound webhook id lookup uses internal-service context. |
| `webhook_events` | `org_id` | Tenant equality | Inbound webhook events. |
| `sync_checkpoints` | `org_id` | Tenant equality | Sync cursors. |
| `integration_request_logs` | `org_id` | Tenant equality | Integration request logs. |
| `external_webhook_subscriptions` | `org_id` | Tenant equality | Outbound webhook subscriptions. |
| `automations` | `org_id` | Tenant equality | Automation definitions. |
| `automation_runs` | `org_id` | Tenant equality | Automation runs. |
| `automation_step_runs` | `org_id` | Tenant equality | Automation run steps. |
| `api_credentials` | `org_id` | Tenant equality plus internal lookup | Key-hash lookup uses internal-service context. |
| `api_request_logs` | `org_id` | Tenant equality | API credential request logs. |
| `workspace_access_profiles` | `org_id` | Tenant equality | Access profiles. |
| `workspace_access_profile_assignments` | `org_id` | Tenant equality | Access assignments. |
| `workspace_access_policy_rules` | `org_id` | Tenant equality | Access rules. |
| `document_sequence_definitions` | `org_id` | Tenant equality | Numbering config. |
| `document_sequence_counters` | `org_id` | Tenant equality | Numbering counters. |
| `document_sequence_assignment_logs` | `org_id` | Tenant equality | Numbering audit. |
| `workspace_invites` | `workspace_id` | Tenant equality | Workspace-owned invite records. |
| `marketplace_apps` | `source_org_id` | Special shared catalog | Published apps are readable across workspaces; draft/archived apps remain source-org/internal only; global publish/status/delete paths use reviewed internal service context. |
| `workspaces` | `id` / `owner_user_id` | Special | Current workspace, owner, or internal service. |
| `workspace_members` | `workspace_id` / `user_id` | Special | Current workspace, current user membership discovery, or internal service. |
| `orgs` | `id` | Special legacy | Legacy org table. |
| `org_members` | `org_id` | Tenant equality | Legacy org membership table. |
| `user_platform_roles` | `user_id` | Special | User can read own role; writes internal only. |
| `integration_providers` | Shared catalog | Shared read, internal write | Not tenant-owned; intentionally shared. |
| `module_icons` | Shared catalog | Shared read, workspace/internal write | Not tenant-owned; stores icon lookup by module id. |

## Default Policy Shape

Tenant tables use:

- `SELECT`: owner field equals `octo_security.current_org_id()` or `octo_security.is_internal_service()`.
- `INSERT`: same owner check via `WITH CHECK`.
- `UPDATE`: same owner check via `USING` and `WITH CHECK`.
- `DELETE`: same owner check via `USING`.

## Review Rule For New Tables

Any new tenant-owned table must be added to this matrix and to the RLS migration/check coverage in the same PR.
