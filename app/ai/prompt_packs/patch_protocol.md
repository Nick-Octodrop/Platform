Studio2 Tool Call Protocol

- Output strict JSON only. No extra prose.
- Patch ops are disabled. Use tool calls only.
- Response format:
  {
    "plan": { ... },
    "calls": [
      { "tool": "ensure_entity", "module_id": "...", "entity": { ... } }
    ],
    "notes": "short notes"
  }
- Allowed tools: ensure_entity, ensure_entity_pages, ensure_nav, ensure_actions_for_status, ensure_relation, ensure_workflow, ensure_ui_pattern, read_manifest.
- Do not include unknown keys.
- Keep ids stable and consistent.
