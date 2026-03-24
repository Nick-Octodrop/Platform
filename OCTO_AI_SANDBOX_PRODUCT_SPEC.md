# Octo AI Sandbox Product Spec

## Product goal

Make Octo AI feel like a build studio for safe workspace changes:

1. user starts an AI build session
2. AI works inside a sandbox-style workspace
3. user tests the real workspace UI with the AI docked beside it
4. user promotes the finished result to live
5. rollback is tied to the promoted release

## Core objects

### Session

The AI work record.

- stores goal, chat history, status, summary, affected areas
- historical after completion
- should be mostly read-only once no longer active

### Sandbox

The temporary editable environment attached to the active session.

- AI and manual edits both apply here
- should become the main testing surface
- should not send real external side effects

### Release

The promoted result of a completed session.

- rollback targets releases, not arbitrary chat history
- release should record promoted snapshot ids and apply logs

## UX model

### 1. Octo AI home

Use a session hub, not a raw chat inbox.

Show:

- session name
- goal summary
- status
- sandbox name
- release status
- last updated

Actions:

- `New AI Build`
- `Open`
- `Delete`

### 2. New session

Use a short modal aligned with existing settings forms.

Fields:

- session name
- what do you want to build or change
- sandbox name
- seed mode
- simulation mode

Defaults:

- seed mode: `structure_only`
- simulation mode: `simulate_side_effects`

### 3. Active session workspace

Desktop layout:

- left: sandbox workspace preview
- right: AI sidebar

Tabs inside the session:

- AI
- Changes
- Validation
- Activity

Tabs inside the sandbox area:

- Sandbox
- Studio JSON
- Release Diff
- Release History
- Rollback

## Tying into existing apps

Octo AI should orchestrate the existing apps, not replace them.

Sandbox sessions should eventually flow into:

- Studio
- Automations
- Integrations
- Email Templates
- Document Templates

That means the user can:

- let AI make the bulk of the changes
- manually fine-tune in existing tools
- keep those edits attached to the same sandbox session

## Side effect rules

In sandbox:

- automations run in simulation mode
- outbound email does not send
- integrations and webhooks do not hit real external systems
- Jinja email templates render against sample data
- PDF templates render against sample data

The user should see:

- what would have triggered
- what email would have rendered
- what PDF would have been generated
- what external integration would have been called

## Promotion flow

1. AI builds draft
2. validation runs
3. user reviews sandbox
4. user clicks `Promote to Live`
5. system records live snapshot
6. promoted release is stored
7. rollback stays available

## Rollback flow

Rollback should be release-based, not chat-based.

User action labels:

- `Promote to Live`
- `Roll Back Release`

## Recommended implementation order

### Phase 1

- session hub
- new session modal
- sandbox-first workspace shell
- AI sidebar on the right
- release-oriented labels instead of raw patchset language

### Phase 2

- true sandbox workspace cloning
- session-bound manual edits
- promotion snapshot and release records
- rollback by release

### Phase 3

- automation simulation
- integration mocking
- Jinja email preview
- PDF preview
- cross-app sandbox routing
