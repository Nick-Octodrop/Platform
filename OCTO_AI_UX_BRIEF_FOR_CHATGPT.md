# Octo AI UX Brief For ChatGPT

Use this brief to ask ChatGPT for product/UX recommendations for how AI should fit into OCTO.

The goal is not just "where do we put AI".
The goal is to design a safe, scalable customization model for workspaces, with and without AI.

## Product Context

OCTO is a workspace platform where customers build and run custom business apps/modules on top of a strict manifest/kernel system.

Important constraint:

- We do **not** want raw AI-generated arbitrary app logic.
- We want AI to help users design and change their workspace, but final changes still flow through OCTO's manifest contracts, deterministic compiler, validation, sandboxing, and promotion flow.

Current architecture direction:

`user request -> AI planner/designer -> deterministic OCTO compiler/validator -> sandbox -> promote to live`

## What Exists Today

### 1. Main app/workspace shell

Current frontend has:

- app navigation
- module pages
- records/forms/views
- top nav and side nav

Relevant frontend areas:

- [HomePage.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/HomePage.jsx)
- [SideNav.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/layout/SideNav.jsx)
- [TopNav.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/layout/TopNav.jsx)

### 2. Studio

There is already a manual module editing surface.

Current Studio2 supports:

- create module drafts
- edit installed manifests
- validate
- preview
- apply
- rollback
- history
- JSON/manual editing

Relevant files:

- [Studio2Page.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/Studio2Page.jsx)
- [README_PRODUCT.md](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/README_PRODUCT.md)

Important point:

- We still need a strong manual editing path, even if AI improves.
- "Studio" is effectively the manual escape hatch / expert editor.

### 3. Octo AI app

There is already an Octo AI product surface for workspace-wide editing in a sandbox.

Current flow direction:

- user creates an AI session
- sandbox is created per session
- AI plans changes
- patchset is generated/validated/applied in sandbox
- user can review and rollback

Relevant files:

- [OctoAiSessionsPage.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/OctoAiSessionsPage.jsx)
- [OctoAiWorkspacePage.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/OctoAiWorkspacePage.jsx)
- [OctoAiSandboxDock.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/components/OctoAiSandboxDock.jsx)
- [OCTO_AI_SANDBOX_PRODUCT_SPEC.md](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/OCTO_AI_SANDBOX_PRODUCT_SPEC.md)
- [OCTO_AI_ARCHITECTURE.md](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/OCTO_AI_ARCHITECTURE.md)

Current product direction:

- 1 active sandbox per AI session
- session list should feel like history/work records
- active work should happen in the sandbox workspace view
- promotion and rollback should be release-oriented, not chat-oriented

### 4. Templates

OCTO already has template systems for:

- email templates
- document/PDF templates
- Jinja-based rendering

Current template surfaces exist as separate template studios.

Relevant files:

- [EmailTemplatesPage.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/EmailTemplatesPage.jsx)
- [EmailTemplateStudioPage.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/email/EmailTemplateStudioPage.jsx)
- [DocumentTemplateStudioPage.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/documents/DocumentTemplateStudioPage.jsx)
- [TemplateStudioShell.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/templates/TemplateStudioShell.jsx)
- [TEMPLATE_EDITOR_GUIDE.md](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/TEMPLATE_EDITOR_GUIDE.md)

Important point:

- Templates are currently under settings-oriented flows.
- We are unsure whether they should stay there, move into their own app surface, or be pulled into Octo AI session work.

### 5. Automations

OCTO already has a separate Automations app.

Current automation surface supports:

- list
- editor
- runs
- publish/disable/delete

Relevant files:

- [AutomationsPage.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/AutomationsPage.jsx)
- [AutomationEditorPage.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/AutomationEditorPage.jsx)
- backend endpoints in [app/main.py](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/app/main.py)

Important point:

- Automations are a first-class product surface, not just a hidden config object.
- AI should probably help build automations, but the safe UX for that is still being decided.

### 6. Integrations

Integrations surface exists and will expand.

Relevant files:

- [IntegrationsPage.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/IntegrationsPage.jsx)
- backend endpoints in [app/main.py](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/app/main.py)

Important point:

- integrations are sensitive because they involve real external side effects and secrets
- we likely want them later, after internal module/automation/template flows are solid

### 7. Settings

Settings currently contains workspace/system-type surfaces including templates and secrets.

Relevant files:

- [SettingsPage.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/SettingsPage.jsx)
- [SettingsSecretsPage.jsx](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/pages/SettingsSecretsPage.jsx)

Important point:

- some settings are safe to expose in AI flows
- some are high-risk and may need stronger restrictions

## Key Product Tension

We now have multiple "change the workspace" surfaces:

1. manual Studio editing
2. Octo AI sandbox editing
3. template studios
4. automation editor
5. future integrations builder
6. a future user-facing AI assistant in the top nav for help/data questions

The UX risk is fragmentation:

- users may not know where to go
- AI might appear in too many places without clear boundaries
- settings vs apps vs AI could become confusing
- rollback and trust could become unclear

## The AI Surfaces We Are Considering

### A. User-facing nav bar AI assistant

This is **not** the workspace builder.

Intended job:

- answer questions about workspace data
- help users find things
- explain how to use OCTO
- summarize records / operational info
- maybe help draft content

Important constraint:

- this assistant should **not** silently change workspace manifests/modules

This is closer to:

- data assistant
- help assistant
- operational copilot

### B. Main Octo AI app

This **is** the workspace builder.

Intended job:

- create modules/apps
- edit existing modules
- make cross-module changes
- generate safe plan/preview
- apply to sandbox
- allow test/review/promotion/rollback

This is closer to:

- workspace architect
- system builder
- sandboxed change orchestration

### C. AI inside editors

Potential embedded AI copilots inside:

- Studio
- Template Studio
- Automations editor
- later Integrations

This would be scoped AI, not workspace-wide AI.

Examples:

- "fix this manifest"
- "add a required_when rule here"
- "write this email template"
- "build this PDF template"
- "add a trigger to this automation"

### D. Manual non-AI editing

This still matters.

Users need:

- expert/manual editing path
- deterministic, inspectable path
- JSON/manifest editing path
- no-AI path for trust, support, debugging, and precision work

## Current Safety Model Direction

Current Octo AI product direction already assumes:

- sandbox-first for workspace-building AI
- one active sandbox per AI session
- rollback tied to releases/promotions, not random chat messages
- AI should orchestrate existing tools, not replace them

From sandbox spec:

- automations should simulate in sandbox
- outbound email should not send
- integrations/webhooks should not hit real systems
- email/pdf templates should render against sample data

## Questions We Need To Resolve

### 1. Information architecture

How should users understand the difference between:

- AI assistant in nav bar
- Octo AI builder
- Studio
- Automations
- Templates
- Integrations
- Settings

### 2. Boundaries of each AI surface

What should each of these be allowed to do?

- nav-bar AI assistant
- Octo AI builder
- AI inside Studio
- AI inside template editors
- AI inside automation editor
- future AI inside integrations

### 3. Sandbox boundaries

Should sandbox cover:

- modules only
- modules + automations
- modules + automations + templates
- integrations only as mocks
- settings only partially

Should some areas remain live-only / admin-only / proposal-only?

### 4. Settings vs apps

Should templates remain under Settings?
Should they become first-class apps?
Should they be reachable both directly and through Octo AI sessions?

Same question for:

- automations
- integrations
- workspace secrets

### 5. Manual editing model

How should Studio coexist with Octo AI?

Should Studio be:

- the expert/manual editor
- the JSON/manifest escape hatch
- the diff/release inspector
- the same underlying sandbox surface with a different mode

### 6. AI-generated side effects

How should AI-created automations/templates/integrations be handled safely?

Examples:

- AI adds a "Download PDF" button
- should it also make a template?
- if no template exists, should it ask?
- should it draft a template automatically?
- should that draft be sandbox-only until approved?

### 7. Permissions and trust

What should normal users be allowed to do vs admins?

Example split:

- nav-bar AI available more broadly
- workspace builder AI only for users who can manage modules
- integrations/secrets heavily restricted

### 8. UX for "customize without AI"

We do not want OCTO to become "AI only".

Need a coherent model for:

- direct editing
- AI-assisted editing
- manual review
- rollback
- promotion

## My Current Product Instinct

These are not final answers, but they are the current likely direction:

### 1. Keep two clearly different AI products

#### Assistant AI

Place:

- top nav / global assistant

Purpose:

- answer questions
- search/help/data assistance
- no workspace-structure changes

#### Builder AI

Place:

- dedicated `Octo AI` app

Purpose:

- workspace-wide changes
- sandbox-first
- promotion and rollback

These should **not** feel like the same mode.

### 2. Do not make everything live inside one giant AI

Instead:

- use Octo AI as orchestrator
- keep Studio, Automations, Templates, Integrations as first-class surfaces
- allow AI to hand users into those scoped editors when needed

So:

- Octo AI = system builder/orchestrator
- Studio = manual manifest/editor surface
- Templates = template-specific craft surface
- Automations = behavior/runs surface
- Integrations = connections and external side effects

### 3. One sandbox, not sandbox-inside-sandbox

Best likely model:

- one workspace-change sandbox per Octo AI session
- inside that sandbox, template drafts and automation drafts can exist as part of the same session
- but they are not separate nested sandboxes

This keeps mental model simpler.

### 4. Restrict the riskiest settings

Likely split:

- workspace/module changes: sandboxable
- automations: sandboxable in simulation mode
- templates: sandboxable as draft + render preview
- integrations: maybe mockable in sandbox, but real connection changes probably need explicit admin flow
- secrets: probably not AI-editable in the same way as modules; keep them restricted and explicit

### 5. Preserve Studio as the expert path

Studio should remain the place for:

- manual manifest editing
- expert corrections
- deterministic diff/review
- debugging generated output

Even if Octo AI becomes excellent, this is still needed.

## What I Want ChatGPT To Help With

I want recommendations for the **best possible UX architecture** for this system.

Please give recommendations on:

1. top-level product architecture
2. navigation and IA
3. which AI surfaces should exist
4. what each AI surface is allowed to do
5. sandbox model
6. safety and permission model
7. where templates/automations/integrations should live
8. how manual editing and AI editing should coexist
9. best flows for:
   - asking questions about data
   - creating a new module/app
   - editing existing modules
   - building automations
   - building email/pdf templates
   - promoting to live
   - rolling back
10. recommended UX patterns for trust, diffs, previews, and approval

## Specific Constraints ChatGPT Must Respect

1. OCTO uses a strict manifest/kernel system.
2. We want deterministic compile/validate/apply, not direct raw AI writes to production.
3. Workspace editing must be safe and rollbackable.
4. We want one clean mental model for users.
5. The AI assistant for data/help should be separate from the AI builder for workspace changes.
6. Studio/manual editing must remain a first-class path.
7. Avoid over-fragmenting the product with too many AI entrypoints.
8. Avoid unsafe live side effects in sandbox.

## Prompt To Give ChatGPT

```text
I am designing the UX and product architecture for AI inside OCTO, a workspace platform where users create and customize business modules/apps on top of a strict manifest/kernel system.

Important constraints:
- AI should not directly write arbitrary production config.
- The flow should be: request -> AI planning/design -> deterministic compile/validate -> sandbox -> promote to live.
- We need strong rollback and trust.
- We must keep a manual editing path (Studio).
- We want one clean mental model for users.

Current product surfaces:
- a main workspace/app shell
- Studio for manual module/manifest editing, validate/preview/apply/rollback
- Octo AI app for sandboxed workspace-wide editing
- Email Template Studio
- Document/PDF Template Studio
- Automations app
- Integrations app
- Settings and secrets

We are considering two separate AI surfaces:
1. a nav-bar AI assistant for help, answering questions about data, and platform assistance (not for structural workspace changes)
2. a main Octo AI builder app for workspace-wide editing in a sandbox

We are also considering scoped AI inside editors like:
- Studio
- Template editors
- Automations editor
- later Integrations

I want your best possible recommendations for:
1. information architecture and navigation
2. which AI surfaces should exist and what each should do
3. how sandbox should work across modules, automations, templates, integrations, and settings
4. where templates and automations should live in the product
5. how manual editing and AI editing should coexist
6. permission/safety boundaries
7. the best UX flows for create/edit/review/promote/rollback
8. the cleanest mental model for users

Please be concrete. I want:
- a recommended product architecture
- recommended nav structure
- recommended screen/flow breakdown
- a safety model
- tradeoffs
- and what you would ship in phases

Here is the current internal brief:

[paste this whole document]
```

## Output I Want Back From ChatGPT

I want ChatGPT to return:

1. a recommended product architecture
2. a clear split of AI surfaces and permissions
3. a recommended nav / IA map
4. recommended user journeys
5. what should stay in Settings vs become first-class apps
6. a sandbox policy
7. phased rollout recommendations

