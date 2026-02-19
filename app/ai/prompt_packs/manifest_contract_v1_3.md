Manifest Contract v1.3 (Studio2)

- Manifests are authoritative. Only manifest v1.3 is allowed.
- Reject unknown keys at any level.
- module.id must be stable and match module_id.
- entities/views/pages/actions/relations must follow v1.3 contract.
- actions kinds allowlisted: navigate, open_form, refresh, create_record, update_record, bulk_update.
- actions/header actions may include `modal_id` to open top-level `modals[]`.
- top-level `modals[]` can render fields and run modal actions (`action_id` or inline).
- form sections may use `line_editor` (or `line_editors` fallback on form view) for inline child-table editing.
- UI composition rules for v1.3 apply (containers define surfaces; views are flat).
