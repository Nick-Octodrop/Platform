# Octo AI Codex Handoff

Use this file to bring a fresh Codex session up to speed on the current Octo AI direction, architecture, runtime loops, and recent product decisions.

Start here on every Octo AI task:

1. Read [OCTO_AI_ARCHITECTURE.md](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/OCTO_AI_ARCHITECTURE.md) first.
2. Treat that file as the canonical architecture contract.
3. If implementation pressure conflicts with the contract, update the contract deliberately or call out the exception.

## Goal

Make Octo AI feel like a strong ChatGPT-style business builder while keeping OCTO's deterministic manifest compiler, validation, sandboxing, and release flow safe.

The target experience is:

1. User describes what they want in plain English.
2. Octo AI produces a truthful, detailed, plain-English plan.
3. User approves the plan.
4. OCTO compiles that plan into safe operations.
5. Changes are validated and applied in a sandbox first.
6. Live promotion happens later and deliberately.

## Current Architecture Direction

The important architectural shift is:

`user request -> semantic planner (PlanV1) -> deterministic compiler -> validator -> sandbox`

Do **not** try to make the raw model generate manifests or patchsets directly.

### Why

- The model is better at semantic understanding than our old heuristic planner.
- OCTO still needs a constrained compiler and validator for trust and safety.
- The right hybrid is:
  - model for intent and structured planning
  - code for compilation, validation, sandbox isolation, and apply

## Current Planner Shape

The semantic planner now returns a structured `plan_v1` object from `app/main.py`.

`PlanV1` currently carries:

- `version`
- `intent`
- `summary`
- `requested_scope`
- `modules`
- `changes`
- `sections`
- `clarifications`
- `assumptions`
- `risks`
- `noop_notes`

### Important implementation details

- `plan_v1` is now threaded through the live planner result.
- Persisted plan records now store both:
  - `plan_v1`
  - `structured_plan`
- Session/history pages now prefer `plan_v1` when rendering plan details.
- Weak semantic summaries are rejected and fall back to deterministic summaries.
- Semantic sections are merged with deterministic fallback sections instead of replacing useful detail.

## Key Product Decisions

### Sandbox/session model

The current preferred product model is:

- `1 active sandbox per AI session`
- session list = history
- session detail = history only
- creating a new session should open its sandbox immediately

Do **not** default to one shared sandbox per workspace with many chat sessions layered on top.

Reason:

- history becomes misleading
- changes bleed across sessions
- rollback/apply attribution gets muddy
- users stop trusting what each session actually changed

If a shared sandbox mode is ever added, it should be an explicit advanced option, not the default.

### Current Octo AI studio/session flow

Recent frontend changes moved the UX toward this model:

- New session modal launches a sandbox immediately.
- Session list is more history-oriented.
- The oversized goal/summary column was removed from the list.
- Session detail is history-only and should not be the main place where sandbox work is launched.
- Sandbox workspace view includes a separate `View History` path back to the record.

## Key Files

### Planner / backend

- `app/main.py`
  - core Octo AI planner
  - semantic planner
  - `PlanV1` merge and persistence
  - sandbox/apply/session behavior

### Frontend

- `web/src/pages/OctoAiSessionsPage.jsx`
  - session list
  - create/open sandbox flow
- `web/src/pages/OctoAiSessionDetailPage.jsx`
  - history-only detail page
- `web/src/pages/OctoAiWorkspacePage.jsx`
  - sandbox working view
- `web/src/components/OctoAiSandboxDock.jsx`
  - right-side AI/sandbox panel behavior

### Training / eval

- `scripts/build_octo_ai_planner_preview_suite.py`
- `scripts/build_octo_ai_business_suite.py`
- `scripts/octo_ai_curriculum.py`
- `scripts/octo_ai_eval.py`
- `scripts/octo_ai_eval_loop.py`
- `scripts/octo_ai_self_heal_loop.py`
- `scripts/run_octo_ai_milestone_local.ps1`
- `scripts/run_octo_ai_self_heal_local.ps1`

### Briefs / reference docs

- `OCTO_AI_SELF_HEAL_BRIEF.md`
- `OCTO_AI_MILESTONE_BRIEF.md`
- `OCTO_AI_SCALE_RUNBOOK.md`
- `OCTO_AI_SANDBOX_PRODUCT_SPEC.md`
- `MANIFEST_CONTRACT.md`
- `specs/octo_ai_real_world_prompt_bank.json`
- `specs/manifest_v1_example_index.md`

## Manifest Reference Policy

When planner/compiler behavior is ambiguous, do **not** invent a new manifest shape first.

Use, in order:

1. `MANIFEST_CONTRACT.md`
2. `specs/manifest_v1_example_index.md`
3. the closest real examples under:
   - `manifests/`
   - `manifests/marketplace_v1/`

This is important. The goal is OCTO-style v1.3 manifests, not plausible-looking new structures.

## Overnight / AFK Improvement Loop

The recommended loop is the milestone loop.

### Backend

```powershell
cd "C:\Users\nicwi\Documents\My Projects\OCTO"
.\scripts\run_octo_local_backend.ps1
```

### Frontend

```powershell
cd "C:\Users\nicwi\Documents\My Projects\OCTO"
.\scripts\run_octo_local_frontend.ps1
```

### Recommended continuous milestone loop

```powershell
cd "C:\Users\nicwi\Documents\My Projects\OCTO"
$env:OCTO_AI_EVAL_EMAIL="nick@octodrop.com"
$env:OCTO_AI_EVAL_PASSWORD="<YOUR_PASSWORD>"
.\scripts\run_octo_ai_milestone_local.ps1
```

### 20-cycle bounded run

```powershell
cd "C:\Users\nicwi\Documents\My Projects\OCTO"
$env:OCTO_AI_EVAL_EMAIL="nick@octodrop.com"
$env:OCTO_AI_EVAL_PASSWORD="<YOUR_PASSWORD>"
.\scripts\run_octo_ai_milestone_local.ps1 -Cycles 20
```

### Secondary lane

The business self-heal lane exists, but the main recommendation is still the milestone loop because it already has levels, promotions, and streak tracking.

## Eval / Curriculum State

Last known strong milestone state:

- `current_level = 8`
- `level 8 streak = 26`
- `promoted scenario count = 16`

The overnight milestone loop previously completed 20 cycles and held the suite around `97-98 / 98` on the leveled preview set, with only narrow remaining failures at the time.

Treat that as a baseline, not a permanent truth, because the suite and planner keep changing.

### Where to inspect runs

Milestone outputs:

- `C:\temp\octo_ai_milestone_local\curriculum_state.json`
- latest run:
  - `summary.json`
  - `scoreboard.json`
  - `failure_digest.md`
  - `codex_last_message.txt`

Self-heal business outputs:

- `C:\temp\octo_ai_self_heal_local\...`

## What Has Already Been Improved

These are important; do not accidentally regress them:

- Better sandbox isolation logic so sandbox changes do not target live workspace by mistake.
- Better cache invalidation / sandbox refresh behavior.
- More dynamic plan rendering in the UI.
- Session list and history flow shifted toward sandbox-first work and history-only records.
- Real-world prompt bank integrated into the leveled milestone curriculum.
- `PlanV1` threaded through planner result, persistence, and session rendering.
- Low-signal semantic summaries now fall back to deterministic summaries.
- Semantic sections merge with fallback deterministic sections.
- Fallback summaries for field-add requests can now read real ops instead of depending only on brittle planner state.
- Naming improvements for create-module requests and follow-up rename/carry-over handling.

## User Expectations That Matter

The user cares a lot about these:

1. `Real understanding`
- Octo AI should understand natural language more like ChatGPT.
- It should infer clean names like `Cooking`, not `Me A Cooking`.

2. `Truthful detailed plans`
- Plans should say exactly what fields/actions/workflows/tabs are being changed.
- Only show relevant sections.
- Avoid vague or misleading summaries.

3. `Sandbox trust`
- Approving a plan should visibly affect the sandbox quickly.
- The system should be explicit about where to look.
- Sandbox should never silently hit production.

4. `OCTO-native manifests`
- Generated plans and patchsets should align with the real v1.3 style already present in the repo.

## Current Recommended Priorities

If you are continuing work, the next highest-value priorities are:

### 1. Improve semantic naming and follow-up scope

Focus on:

- infer clean module names from purpose phrases
- preserve current draft module scope across follow-ups
- let explicit renames override earlier inferred names cleanly

### 2. Make `PlanV1` richer and more central

Keep pushing more planner meaning into `PlanV1`, especially:

- field detail
- placement detail
- workflow/action detail
- conditions
- automations/templates/integrations
- sandbox verification steps

### 3. Add plan-quality evals

Do not only test rough correctness.

Also fail plans when they are:

- too vague
- missing placement
- missing field type
- missing workflow detail
- asking unnecessary clarifications

### 4. Keep using real prompt language

Prefer real-world business/admin prompts over synthetic toy prompts.

### 5. Keep the deterministic safety layer

Do not abandon:

- compiler
- validation
- sandbox
- apply/rollback discipline

## Working Rules for a New Codex Session

If you are the new Codex session:

1. Read this file first.
2. Then read:
   - `OCTO_AI_SELF_HEAL_BRIEF.md`
   - `OCTO_AI_MILESTONE_BRIEF.md`
   - `specs/manifest_v1_example_index.md`
3. Inspect the latest milestone run outputs before deciding what to fix.
4. Prefer broad planner improvements over one-off hacks.
5. Add or update regression tests for recurring failure classes.
6. Use `apply_patch` for edits.
7. Do not revert unrelated user changes.

## Suggested First Prompt For A Fresh Codex Chat

Use something like:

> Read `OCTO_AI_CODEX_HANDOFF.md`, `OCTO_AI_SELF_HEAL_BRIEF.md`, `OCTO_AI_MILESTONE_BRIEF.md`, and `specs/manifest_v1_example_index.md`. Then inspect the latest milestone run in `C:\temp\octo_ai_milestone_local`, summarize current health, identify the highest-value planner/systemic weakness, and patch it with tests.

## Verification Defaults

After planner/backend changes:

```powershell
cd "C:\Users\nicwi\Documents\My Projects\OCTO"
python3 -m py_compile app/main.py
```

Run targeted pytest for the directly touched Octo AI tests.

After frontend changes:

```powershell
cd "C:\Users\nicwi\Documents\My Projects\OCTO"
npm --prefix web run build
```

## Short Summary

The project is no longer at “toy prototype” stage.

The main remaining gap is not raw patch generation; it is:

`semantic request understanding -> detailed truthful plan -> safe deterministic execution`

That is the axis to keep improving.
