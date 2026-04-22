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

## Current Architecture Worklist

These items are in the active improvement lane and should stay aligned across Studio AI, scoped artifact AIs, and Octo AI:

- Shared capability registry for modules, automations, email templates, and document templates
- Shared prompt heuristics and focus modes across Octo + scoped AIs
- Deterministic manifest-contract validation for fields, workflows, actions, conditions, templates, and automations
- Shared module authoring contract with domain heuristics and quality scoring
- Line-item, cross-module, and handoff coverage in tests
- Structured decision-slot planning
  - planner should build the full safe draft first
  - unresolved recipient/template/target choices should be surfaced as structured slots
  - current implemented slot producers cover module/entity target selection for ambiguous workspace changes, shared field-target selection for ambiguous module edits, shared tab-target/section-target/page-target/view-target selection for ambiguous module placement and layout changes, notification recipients, plus email/document template selection for automation drafts, including create-new companion template drafts when selected
  - selected page/view targets now also narrow executable module-edit ops in Octo and module-op preflight for page/view surface changes instead of just gating ambiguity
  - existing-page dashboard requests with a resolved page target now have a deterministic starter `add_page_block` path using `stat_cards`
  - dashboard stat cards now infer `count`, `sum:<field>`, or `count_distinct:<field>` from real manifest-backed entity fields when possible, and only fall back to advisories when no safe richer measure can be inferred
  - Studio `ensure_ui_pattern` now reuses that same dashboard stat-card inference for existing dashboard-page requests, so Studio and Octo share one backend page-authoring contract
  - the same shared dashboard metric specs now also populate `interfaces.dashboardable.default_widgets` when a grouped widget is possible, so grouped widgets and page stat cards stay aligned on `group_by` and `measure`
  - when a matching graph view already exists, Studio now also reuses those same shared dashboard metric specs to seed the graph view `default` (`type`, `group_by`, `measure`)
  - when a dashboard page already has grouped `view_modes`, Studio now also reuses those same shared grouped defaults to seed `graph` / `pivot` mode `default_group_by`
  - Octo workspace planning now reuses that same shared dashboard surface bundle for existing dashboard-page requests, so it can emit aligned `add_page_block`, `update_view`, and `update_page` ops instead of only adding stat cards
  - broader Octo dashboard/reporting requests can now auto-target one clear existing dashboard page, ask for a dashboard-page choice when several candidates exist, offer a structured reuse-vs-create dashboard-page choice when a soft home/overview page is plausible, or create a starter dashboard page and then reuse that same shared dashboard surface bundle when no dashboard page exists yet
  - broader Octo dashboard/reporting requests now also narrow module targeting before page targeting: one clear analytics module can be auto-scoped, while several plausible modules produce a narrowed dashboard-module choice slot instead of a generic preview fallback
  - once the analytics module is chosen, broader Octo dashboard/reporting requests now also narrow entity targeting before page targeting: one clear reporting entity can be auto-scoped, while several plausible entities produce a narrowed dashboard-entity choice slot instead of defaulting to the first entity
  - once analytics module/entity/page targeting is resolved, broader Octo dashboard/reporting requests can now also return a narrowed dashboard-metric choice slot when multiple real numeric or grouping fields are plausible, and the selected metric/grouping is threaded back through the shared dashboard surface bundle
  - scoped template AI now uses the same slot pattern for missing entity selection and default email-connection selection
  - scoped Studio AI now uses the same slot pattern for ambiguous entity, field, form-tab, form-section, page, and view targets before builder execution
  - UI should prefer real system options plus free-text fallback where needed
  - apply should stay gated only on slots that materially affect correctness
- Shared stage-card feedback
  - scoped AIs should surface required input, advisories, and risks in the same plan-stage card shape
  - quality/risk feedback should not live only in Octo workspace plans

## Current Reality Snapshot

This handoff was updated after a long AI reliability pass. The highest-value current state is:

- plan quality gating is now materially stricter
- mixed module + automation + template plans read more coherently
- automation email/notify recipient realism is much better
- automation document/email attachment behavior is more truthful
- automation runtime trust is better covered end to end
- Octo UI stale confirm-state handling is better, but this remains a thing to watch closely

The center of gravity is no longer just planner wording. It is now:

`truthful plan -> correct gating -> realistic draft -> trustworthy runtime behavior`

## What Was Improved Recently

These are important recent gains and should not be regressed:

### 1. Thin-plan gating

- weak create-module and mixed rollout plans are now blocked before sandbox patch generation
- thin plans can be pushed back to `waiting_input` with a real `detail_required` question instead of looking confirmable
- thin-plan prompts now ask for concrete missing topics based on rollout shape, for example:
  - module fields
  - pages
  - workflow
  - layout
  - automation trigger
  - automation outcomes
  - template purpose
  - template content targets

### 2. Mixed-rollout coherence

Octo plan rendering is materially better for requests that span:

- module work
- automations
- email templates
- document templates

The same grouped rollout language is now aligned across:

- plan headline
- planned changes ordering
- structured plan sections
- ready-for-sandbox summary
- sandbox-applied summary
- live-published summary

Module work should lead. Supporting automations/templates/interfaces should follow.

### 3. Studio create-module quality

- Studio create-module requests no longer seed from the emptiest shell path by default
- richer deterministic scaffolds are used for new-module briefs
- scaffold-only plans are treated more honestly as low quality instead of “ready to apply”
- extra in-form scaffold activity tabs were removed from that seeded path

### 4. Document template realism

- document template validation no longer crashes on numeric filters like `|round(2)` because placeholder data is typed instead of all-string
- explicit logo/branding requests now inject real workspace branding more reliably
- selected-record preview rendering was fixed so real field values show again when previewing against a chosen record

### 5. Email template realism

- workspace branding is applied more aggressively in branded email drafts
- common orange fallback palette is remapped toward workspace branding when the request is clearly branded
- fake quote CTA buttons are removed when there is no real URL behind them
- “quote attached” style copy is preferred when there is no real view link

### 6. Automation draft realism

- create/update-record steps now reconcile guessed field names to real entity field ids more reliably
- automation AI has bounded self-repair behavior for invalid drafts
- send-email recipient inference is much better for:
  - literal email addresses
  - multiple literal recipients
  - customer/billing/contact email phrases
  - owner/account-manager style lookup recipients
  - mixed direct + field recipients
  - mixed direct + lookup recipients
- explicit `email me` intent now maps to current-user/internal email behavior more reliably
- notify steps now support lookup-style recipients such as owner fields, not just literal workspace user ids

### 7. Automation attachment realism

- if an automation email promises an attached document/PDF and a real `generate_document` step exists, the attachment fields are auto-wired
- if the email promises an attachment and no source exists, validation fails deterministically instead of shipping a lie
- if the prompt clearly implies a document attachment flow and one matching document template exists, the AI can synthesize the missing `generate_document` step before the email on first pass

### 8. Automation runtime trust

Recent runtime fixes in `app/worker.py` matter a lot:

- `record` alias support was tightened so AI-authored bracket templates like `{{ record['biz_contact.email'] }}` resolve correctly
- `system.generate_document` now runs inline during automations when needed, so the following `system.send_email` step can attach the generated document in the same run
- owner/user lookup email recipients now resolve to workspace member emails at runtime
- related-record lookup recipients now inspect target entity/email-like fields more flexibly instead of only relying on a tiny hardcoded email-field set
- mixed recipient sources are now covered end to end:
  - direct email
  - internal member email
  - field-based recipient
  - lookup/user/owner recipient
- fallback record targeting now prefers the latest record-producing step before the trigger record
- when an event only has `entity_id` + `record_id`, runtime now hydrates:
  - `trigger.record`
  - `trigger.after`
  from the fetched record snapshot when missing

That means AI-authored downstream flows are now more trustworthy for patterns like:

- create record -> email created record -> notify owner
- generate document -> email customer with attachment -> notify owner
- create then update using `trigger.after` templates even when the event payload is sparse

### 9. Octo AI stale confirm-state fixes

- question supersession logic was added so older plan questions can be cleared by newer applied revisions
- both Octo workspace and sandbox dock now use shared “latest plan” selection instead of trusting raw plan array order
- this fixes a real branch where the red `Confirm this plan...` banner could still bind to an older plan after sandbox apply

This area is better, but still worth watching because stale session ordering/state bugs are high-friction trust killers.

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
   - `manifests/marketplace/`

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
- Thin plans no longer drift as easily into sandbox-ready/apply-ready states.
- Mixed module + automation + template plans now read more like one rollout.
- Document/email template AIs are more truthful about branding, attachments, and previews.
- Automation drafts now infer real recipients and attachments more often on first pass.
- Automation runtime now has stronger end-to-end trust for generated attachments and downstream record targeting.

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

### 1. Keep raising trust, not just generation volume

The best work now is the work that makes AI-authored changes behave the way the user thinks they will behave.

Focus on:

- stronger end-to-end runtime coverage for common business handoff flows
- fewer fake-success planner states
- fewer “valid but misleading” drafts
- clearer apply/publish/sandbox state truthfulness

### 2. Keep improving plan quality gating

Keep weak plans from appearing sandbox-ready.

Focus on:

- concrete fields
- placement/layout
- workflow/action detail
- module/artifact dependencies
- required follow-up detail only when it materially affects correctness

### 3. Keep mixed-rollout coherence aligned everywhere

When a request spans a module plus supporting automations/templates:

- the title should read as one rollout
- the planned changes should be ordered module-first
- the structured sections should stay grouped
- the post-apply/publish summaries should tell the same story

### 4. Keep improving artifact realism

Focus on:

- real branding behavior
- real attachment behavior
- real recipient behavior
- real preview behavior
- no fake links/buttons/claims

### 5. Keep improving automation realism and runtime parity

The best next lane after the recent fixes is more high-frequency end-to-end automation coverage for flows like:

- contact created -> create CRM lead -> notify owner/current user
- quote approved -> generate PDF -> email customer -> notify owner
- job created/updated -> email customer/contact -> notify owner
- follow-up record creation + downstream email/notify on the created record

### 6. Keep `PlanV1` rich and central

Keep pushing real planner meaning into `PlanV1`, especially:

- field detail
- placement detail
- workflow/action detail
- conditions
- automations/templates/integrations
- sandbox verification steps

### 7. Keep using real prompt language

Prefer real-world business/admin prompts over synthetic toy prompts.

### 8. Keep the deterministic safety layer

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

For current high-value runtime work, also prefer focused automation runtime coverage, especially:

- `tests/test_automation_runtime.py`
- `tests/test_artifact_ai_endpoints.py`

After frontend changes:

```powershell
cd "C:\Users\nicwi\Documents\My Projects\OCTO"
npm --prefix web run build
```

## Short Summary

The project is no longer at “toy prototype” stage.

The main remaining gap is not raw patch generation. It is:

`semantic request understanding -> truthful detailed plan -> realistic draft -> safe deterministic execution`

That is the axis to keep improving.
