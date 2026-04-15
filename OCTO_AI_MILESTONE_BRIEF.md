Octo AI Milestone Brief

Goal:
Make Octo AI excellent at understanding large business-admin requests, explaining the plan in plain English, and only then moving into patch generation and sandbox/apply.

Architecture source of truth:
- Follow `OCTO_AI_ARCHITECTURE.md`.
- If this brief conflicts with the architecture contract, the architecture contract wins.

Milestone focus:
1. Structured multi-request planner
- Break one user request into multiple concrete changes.
- Preserve module scope across follow-up requests and scope switches.
- Prefer the latest explicit module mention over stale context.
- Handle no-op outcomes truthfully instead of asking vague fallback questions.

2. Plain-English preview contract
- The first meaningful assistant reply must explain the assignment back to the user.
- It must list what will be added, changed, removed, or upgraded in plain language.
- If more than one module is affected, say that explicitly.
- Avoid internal jargon like manifest, artifact_id, candidate_operations, or patch internals.
- End in a clear approval/revision flow before patchset generation.

3. Sandbox/apply readiness
- Plans should compile into safe operations.
- Preview and validation should remain coherent.
- No-op outcomes should still be previewable and patchset-safe.
- Favor a draft/sandbox mindset over direct apply.
- Treat `MANIFEST_CONTRACT.md` as the source of truth for supported manifest features and wording.
- Expand planner coverage beyond fields/tabs into actions, workflows, status buttons, attachments, conditions, and richer form/view behavior.
- Use `specs/octo_ai_real_world_prompt_bank.json` to keep new scenarios grounded in realistic business-admin language.
- Use `specs/manifest_v1_example_index.md` and the reference manifests in `manifests/` / `manifests/marketplace/` to keep generated plans aligned with real OCTO v1.3 module structure.

4. Eval-driven improvement
- Optimize for preview quality before patch generation.
- Pay special attention to:
  - multi-intent prompts
  - cross-module prompts
  - scope switches
  - upgrades
  - no-op/remove flows
  - large “build me this system” briefs

When inspecting eval results:
- Read failure_digest.md first if present.
- Then read scoreboard.md and scoreboard.json.
- Inspect representative failed scenario JSON files only after the digest/scoreboard.
- Look for cluster fixes, not one-off hacks.

When making changes:
- Focus first on app/main.py, focused tests, and eval tooling.
- Keep responses user-facing and truthful.
- Prefer systemic planner/preview improvements over brittle string hacks.
- Preserve generic architecture. Do not add prompt-specific business token matching or one-off field bundles inline in `app/main.py` when the fix belongs in declarative data or generic planning/compilation rules.
- Prefer updating declarative specs under `specs/` and reusable config structures over growing core planner conditionals.
- When adding scenarios, prefer adapting real-world prompt-bank examples over synthetic filler prompts.
- When planner/compiler behavior is ambiguous, compare against the closest in-repo example manifest before inventing a new pattern.

Good outcomes:
- More scenarios reaching confirm_plan cleanly.
- Better plain-English previews.
- Better multi-request decomposition.
- Fewer clarification loops.
- Fewer jargon leaks.
- Higher pass rate in the planner/preview suite.
- Better coverage of workflow actions, conditional form logic, and named attachment/action requests.
