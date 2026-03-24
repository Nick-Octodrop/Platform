# Octo AI Session-Based Sandbox Implementation Brief

This document converts the product direction into an implementation contract grounded in the current OCTO codebase.

It is intentionally pragmatic:

- keep what already exists and is directionally correct
- fix the architectural mismatches
- avoid a rewrite that forks Studio and Octo AI into separate draft systems

## Target Product Model

We are implementing:

- one Octo AI session = one workspace change effort
- one active sandbox per session
- sandbox-first customization
- preview/review inside the normal OCTO app shell
- release-based promotion to live
- release-based production rollback
- patchset/session-local revert for in-progress changes

We are not implementing:

- a separate sandbox product shell
- a second full workspace app living beside the main app
- direct AI writes to production
- chat-driven production rollback

## Current Codebase Reality

### What already exists

Relevant backend primitives already exist in [app/main.py](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/app/main.py):

- `entity.ai_session`
- `entity.ai_message`
- `entity.ai_plan`
- `entity.ai_patchset`
- `entity.ai_snapshot`
- `entity.ai_release`

Relevant current endpoints already exist:

- `GET /octo-ai/sessions`
- `POST /octo-ai/sessions`
- `GET /octo-ai/sessions/{session_id}`
- `PUT /octo-ai/sessions/{session_id}`
- `POST /octo-ai/sessions/{session_id}/sandbox`
- `POST /octo-ai/sessions/{session_id}/sandbox/discard`
- `POST /octo-ai/sessions/{session_id}/chat`
- `POST /octo-ai/sessions/{session_id}/chat/stream`
- `POST /octo-ai/sessions/{session_id}/questions/answer`
- `POST /octo-ai/sessions/{session_id}/patchsets/generate`
- `POST /octo-ai/patchsets/{patchset_id}/validate`
- `POST /octo-ai/patchsets/{patchset_id}/apply`
- `POST /octo-ai/patchsets/{patchset_id}/rollback`

Relevant frontend surfaces already exist:

- [OctoAiSessionsPage.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/OctoAiSessionsPage.jsx)
- [OctoAiWorkspacePage.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/OctoAiWorkspacePage.jsx)
- [OctoAiSandboxDock.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/components/OctoAiSandboxDock.jsx)
- sandbox-aware shell hooks in [ShellLayout.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/layout/ShellLayout.jsx)
- sandbox-aware API behavior in [api.js](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/api.js)

There is also already a Studio2 deterministic draft/patch/validate/apply/rollback path:

- [Studio2Page.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/Studio2Page.jsx)
- `studio2/patchset/*` and `studio2/modules/*` endpoints in [app/main.py](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/app/main.py)

### What is already directionally right

The current system already has:

- session records
- message history
- persisted plans
- persisted patchsets
- validation
- snapshots
- release records
- sandbox URLs
- a sandbox-aware app shell
- Octo AI as a dedicated builder surface

That means this is not a greenfield build.

### What is architecturally wrong today

These are the big mismatches that must be fixed.

#### 1. Patchset apply currently promotes too early

Current behavior in [app/main.py](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/app/main.py):

- `POST /octo-ai/patchsets/{patchset_id}/apply`
- applies validated changes
- creates a release record immediately
- marks session `release_status` as promoted/live

That is wrong for the target architecture.

Target behavior:

- patchset apply should update sandbox state only
- release creation should be explicit
- promotion should be explicit

#### 2. Sandbox is currently too much like a separate workspace clone

Current behavior:

- sandbox creation can create a real cloned workspace
- session launch opens a sandbox URL

Target behavior:

- sandbox remains infrastructure
- the normal app shell becomes sandbox-aware
- Live/Sandbox is a view mode, not a product split

#### 3. Release lifecycle is too thin

Current release behavior is mostly a record attached to applied patchsets.

Target release behavior needs:

- release candidate creation from sandbox state
- explicit promote action
- explicit release history
- release rollback as first-class production recovery

#### 4. Validation runs are not a first-class entity yet

Validation output exists, but not as a normalized lifecycle object.

We need:

- explicit validation run records
- warning/error storage
- a clean UI history for repeated validation

#### 5. Sandbox itself is not modeled as a first-class object yet

Current session records carry sandbox fields.

That works for bootstrap, but the target model needs either:

- a dedicated `ai_sandbox` entity
- or a normalized equivalent record structure

because sandbox lifecycle is now important enough to be first-class.

## Implementation Rule

Do not throw away the current AI entity infrastructure.

The first implementation pass should extend the current AI entity model, not replace it with an unrelated parallel system.

That means:

- add missing AI entities
- refactor endpoint behavior
- reuse Studio2 draft/patch/validate/apply logic where possible
- reuse current session pages and shell

## Normalized Domain Model

Use these as the target logical entities.

Implementation may use current AI entity storage patterns first, as long as the semantics match.

### Session

Logical entity:

- `octo_ai_session`

Maps initially to:

- `entity.ai_session`

Required fields:

- `id`
- `workspace_id`
- `title`
- `summary`
- `status`
- `created_by`
- `created_at`
- `updated_at`
- `active_sandbox_id`
- `latest_plan_id`
- `latest_patchset_id`
- `latest_validation_run_id`
- `latest_release_id`
- `archived_at`

Recommended statuses:

- `draft`
- `planning`
- `patch_ready`
- `validation_failed`
- `sandbox_ready`
- `awaiting_review`
- `ready_to_release`
- `released`
- `archived`

### Message

Logical entity:

- `octo_ai_message`

Maps initially to:

- `entity.ai_message`

Extend message typing beyond plain `chat`/`answer` where useful:

- `chat`
- `plan_card`
- `validation_card`
- `sandbox_card`
- `release_card`
- `system`

### Plan

Logical entity:

- `octo_ai_plan`

Maps initially to:

- `entity.ai_plan`

Keep plan structured and persisted.

### Patchset

Logical entity:

- `octo_ai_patchset`

Maps initially to:

- `entity.ai_patchset`

Target statuses:

- `draft`
- `compiled`
- `validation_failed`
- `validated`
- `applied_to_sandbox`
- `reverted`

### Validation run

Logical entity:

- `octo_ai_validation_run`

This does not currently exist as a dedicated AI entity and should be added.

Suggested first implementation:

- add `entity.ai_validation_run`

### Sandbox

Logical entity:

- `octo_ai_sandbox`

This should become a dedicated AI entity instead of only session-level fields.

Suggested first implementation:

- add `entity.ai_sandbox`

Target statuses:

- `not_created`
- `creating`
- `ready`
- `stale`
- `failed`
- `discarded`

### Release

Logical entity:

- `octo_ai_release`

Maps initially to:

- `entity.ai_release`

Target statuses:

- `draft`
- `approved`
- `promoted`
- `rolled_back`

### Event log

Logical entity:

- `octo_ai_event_log`

Suggested first implementation:

- add `entity.ai_event_log`

Use this for:

- sandbox lifecycle
- simulated side effects
- validation milestones
- release events

## Required Backend Refactor

### 1. Split sandbox apply from release promotion

Current endpoint to fix:

- `POST /octo-ai/patchsets/{patchset_id}/apply`

New required semantics:

- validate patchset
- apply to sandbox state
- record snapshot/history
- mark patchset `applied_to_sandbox`
- update session `sandbox_ready` / `awaiting_review`
- do **not** create a live release automatically
- do **not** mark release as promoted automatically

This is the most important backend correction.

### 2. Add explicit release endpoints

Add/refactor services around:

- create release from current sandbox state
- get release
- list releases for session/workspace
- promote release to live
- rollback promoted release

Promotion must be explicit.

### 3. Add explicit validation run records

Every validation pass should create a validation-run object, not only overwrite `validation_json` on patchsets.

### 4. Add explicit sandbox records

Even if sandbox still points to a cloned workspace or draft bundle behind the scenes, it needs a first-class record and lifecycle.

### 5. Keep deterministic authority in compiler/validator

Continue using:

- manifest contract
- Studio2 patchset logic
- validator
- deterministic apply path

AI must remain upstream of deterministic compilation, not replace it.

## Required Frontend Refactor

### 1. Sessions page

Current page:

- [OctoAiSessionsPage.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/OctoAiSessionsPage.jsx)

Keep it, but make it feel like work queue/history:

- title
- status
- sandbox status
- validation status
- unpromoted changes
- release count/status

Do not let it feel like chat inbox.

### 2. Session workspace

Current page:

- [OctoAiWorkspacePage.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/OctoAiWorkspacePage.jsx)

This is the right place to evolve, not replace.

Target shell:

- center = preview/review
- right = AI assistant panel
- left/compact rail = explorer
- bottom = logs/validation/simulation/events

Chat must not dominate the layout.

### 3. Add explicit Live / Sandbox toggle

This is a core product requirement.

Implement in session header:

- `Live`
- `Sandbox`

This should switch the rendered workspace state, not navigate to a second product shell.

### 4. Center tabs

Target center tabs:

- `Preview`
- `Diff`
- `Validation`
- `Manifest / JSON`
- `History`
- `Release`

Current code already has tab structure. Evolve it instead of rebuilding from scratch.

### 5. Explorer rail

Current session page has explorer data but the artifact tree needs to be stronger.

Target categories:

- Modules
- Automations
- Templates
- Integrations
- Menus
- Actions
- Test Data

## Sandbox Behavior Contract

The sandbox is infrastructure, not a separate app product.

### Allowed in sandbox

- preview actual UI
- dry-run workflows
- simulate automation behavior
- render templates with sample data
- preview buttons/actions
- inspect diffs and manifests

### Blocked in sandbox

- outbound email send
- SMS send
- real webhooks
- third-party writes
- secret mutation
- auth/billing/system admin mutation

### Important product rule

Do not build nested sandboxes.

Exactly one active sandbox per session.

## Studio Interoperability Contract

We must not fork separate draft architectures.

Required interoperability:

From Octo AI:

- `Open in Studio`
- `Inspect Manifest`
- `Edit manually`

From Studio:

- `Send to Octo AI`
- `Ask AI to fix validation`
- `Explain this manifest/diff`

Studio remains the expert/manual path.
Octo AI remains the orchestrated intent-driven path.

## Templates and Automations

Templates and automations remain first-class product surfaces.

Octo AI should orchestrate them inside a session, not absorb and replace their editors.

Example target flow:

If user asks:

- `Add a Send Quote email with attached PDF`

Then Octo AI should be able to:

- update the relevant module action
- draft the email template
- draft the PDF/document template
- draft the automation if needed
- preview all of that in the same session sandbox
- include them in one release

But refinement can still hand off to:

- template editors
- automation editor

## Permissions

Target split:

### Normal users

- can use future top-nav assistant
- cannot access workspace-building AI

### Builders

- create/open AI sessions
- generate plans/patchsets
- apply to sandbox
- review preview/diff/validation

### Admins

- all builder abilities
- create releases
- promote to live
- roll back releases

Secrets stay manual/admin-only.

## Implementation Phases

### Phase 1: normalize backend lifecycle

Files:

- [app/main.py](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/app/main.py)

Tasks:

- add missing AI entities:
  - validation run
  - sandbox
  - event log
- stop patchset apply from auto-promoting to live
- add explicit release creation/promote/rollback endpoints
- normalize session/patchset/release statuses

### Phase 2: upgrade session workspace UI

Files:

- [OctoAiSessionsPage.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/OctoAiSessionsPage.jsx)
- [OctoAiWorkspacePage.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/OctoAiWorkspacePage.jsx)
- [OctoAiSandboxDock.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/components/OctoAiSandboxDock.jsx)
- [ShellLayout.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/layout/ShellLayout.jsx)

Tasks:

- strong session header
- live/sandbox toggle
- center tabs normalized
- explorer rail
- bottom dock
- de-emphasize chat dominance

### Phase 3: sandbox-aware rendering and diff

Tasks:

- render preview from sandbox state
- show live vs sandbox comparison cleanly
- implement grouped diff
- expose validation/event history

### Phase 4: release workflow

Tasks:

- create release candidate from sandbox
- release summary UI
- promote to live explicitly
- production rollback UI/history

### Phase 5: Studio interoperability

Tasks:

- `Open in Studio`
- `Send to Octo AI`
- `AI fix validation`
- shared draft/manifest infrastructure only

## Acceptance Criteria

This work is correct when:

- a builder/admin can create a session
- session holds plan, messages, patchsets, validations, sandbox, releases
- validated patchset can be applied to sandbox without promoting live
- user can toggle `Live / Sandbox`
- user can preview sandbox artifacts in the normal app shell
- user can inspect diff and validation cleanly
- admin can create release from sandbox
- admin can promote release to live
- admin can roll back release later
- session-local revert stays sandbox-only
- sandbox blocks real side effects
- Studio and Octo AI interoperate without duplicate draft systems

## Non-Negotiable Guardrails

- do not build a separate sandbox app shell
- do not keep auto-promoting releases on patchset apply
- do not allow direct AI writes to live manifests/config
- do not tie production rollback to chat history
- do not let chat become the dominant UI
- do not fork Studio and Octo AI draft models
- keep deterministic manifest/kernel compilation authoritative

