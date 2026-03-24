Octo AI Self-Heal Brief

Goal:
Make Octo AI reliably capable of helping business admins create and refine complete business systems in plain language.

Architecture source of truth:
- Follow `OCTO_AI_ARCHITECTURE.md`.
- If this brief conflicts with the architecture contract, the architecture contract wins.

Primary priorities:
1. Conversational quality
- Responses must make sense to non-technical business users.
- Avoid fake or misleading assumptions.
- Ask one good clarification only when confidence is genuinely low.
- Do not loop on the same question after the user already answered it.
- Keep plans truthful, specific, and easy to approve.

2. Planner correctness
- Prefer broad systemic fixes over one-off hacks.
- Preserve context across follow-up requests and scope changes.
- Explicit module mentions in the latest user message should beat stale selected-module state.
- New-module requests must stay in create-module mode.
- Remove/move/view/layout requests must map to the correct operation family.

3. Manifest and patch quality
- Generated patchsets should validate cleanly.
- No operations should target unknown ids.
- If something is already absent or no change is needed, return a clean no-op outcome instead of a confusing failure loop.
- Prefer safe upgrades and truthful limitations over vague fallback questions.
- Use `MANIFEST_CONTRACT.md` as the product truth for supported manifest capability.
- Cover real manifest surfaces, not just fields and tabs: actions, workflows, status buttons, conditions (`visible_when`, `enabled_when`, `required_when`), pages, view modes, triggers, interfaces, transformations, and attachments.
- Use `specs/octo_ai_real_world_prompt_bank.json` as a corpus of realistic admin/business requests when adding or expanding eval coverage.
- Use `specs/manifest_v1_example_index.md` plus the actual files under `manifests/` and `manifests/marketplace_v1/` as the canonical examples of how v1.3 manifests are structured in this repo.

4. Product behavior
- Optimize for plain-English admin usage, not keyword commands.
- Octo AI should understand the workspace kernel: modules, entities, pages, views, workflows, interfaces, triggers, relations, dependencies, and notable issues.
- Preview, validation, and decision flows should remain coherent.

When inspecting eval results:
- Read summary.json first.
- Then inspect failed scenario JSON files under iteration_001.
- Look for clusters, not just individual failures.
- Also check conversational quality in passed scenarios when wording is obviously poor.

When making changes:
- Focus on app/main.py, tests, and any directly relevant scripts/components.
- Use apply_patch for edits.
- Add or update regression tests when you fix a recurring class of failure.
- Do not revert unrelated user changes.
- Preserve generic architecture. Do not hardcode prompt-specific business fields, token lists, or one-off domain fixes directly into planner/compiler core logic when the change belongs in declarative data or generic translation rules.
- Prefer updating declarative family data under `specs/` and generic compiler/normalizer behavior over adding more `if token in lower` branches in `app/main.py`.
- If a fix introduces new domain presets, store them in data files or reusable config structures, not scattered inline conditionals.
- When planner behavior is unclear, inspect `MANIFEST_CONTRACT.md` before inventing new semantics.
- If coverage feels narrow, add or adapt prompts from `specs/octo_ai_real_world_prompt_bank.json` before inventing synthetic one-liners.
- Before inventing a new manifest pattern, inspect the closest real example from `specs/manifest_v1_example_index.md`.

Verification expectations:
- Run targeted verification after fixes.
- Prefer py_compile plus focused pytest coverage already present in the repo.

Good outcomes:
- Better pass rate.
- Better assistant wording.
- Fewer repeated clarifications.
- Better handling of create-module, field, layout, remove/move, scope-switch, workflow-action, and conditional-form flows.
