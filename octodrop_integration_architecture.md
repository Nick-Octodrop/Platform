# Octodrop Integration, Automation, and Worker Architecture

## Purpose

This document defines the target architecture for Octodrop's integration and automation layer so it can be implemented consistently. The goal is for Octodrop to function as both:

1. a configurable business application platform
2. a middleware and automation runtime

The architecture must support:

- reusable integrations
- secure secret handling
- automations and scheduled jobs
- inbound and outbound webhooks
- background workers
- future AI-generated integrations and automations
- client self-service configuration with guardrails

This document is written as the source of truth for implementation.

---

## Core design principles

### 1. Clear separation of concerns
Each subsystem must have a narrow responsibility.

- **Secrets** store only sensitive values
- **Integrations** define how Octodrop connects to external systems
- **Automations** define what should happen when something occurs
- **Workers** execute jobs in the background
- **AI** should generate structured configuration, not arbitrary runtime code

### 2. Declarative over ad hoc
All integrations and automations should be represented using structured records and manifests. Avoid hardcoded one-off logic wherever possible.

### 3. Shared runtime, not per-workspace infrastructure
Octodrop should use shared queues and shared worker pools. Do not spin up dedicated workers per workspace by default.

### 4. Safe execution
All background work must support:

- idempotency
- retry with backoff
- failure logging
- locking
- auditability

### 5. AI must target a strict architecture
Future AI-generated integrations must create and update structured provider, connection, mapping, and automation definitions. AI should not write arbitrary spaghetti logic directly into runtime paths.

---

# System boundaries

## 1. Settings
General platform and module settings only.

Examples:
- workspace preferences
- non-sensitive configuration
- feature toggles
- UI settings

**Do not use Settings as the long-term home for secrets.**

---

## 2. Secrets
Secrets are sensitive values required by integrations and secure workflows.

### Responsibilities
- store encrypted secrets
- support secret versioning
- support workspace-level ownership
- support runtime resolution by workers

### Examples
- API keys
- OAuth client secrets
- refresh tokens
- webhook signing secrets
- private keys
- passwords

### Rules
- secrets must never contain business logic
- automations must not own raw secrets directly
- integrations reference secrets by ID or variable name
- workers resolve secrets only at runtime

### Suggested model
- `id`
- `workspace_id`
- `provider_key`
- `secret_key`
- `encrypted_value`
- `status`
- `version`
- `last_rotated_at`
- `created_at`
- `updated_at`

---

## 3. Integrations
The Integrations app is the system of record for external system connectivity.

An integration should answer:
- what provider is this
- which workspace owns it
- how is it authenticated
- what capabilities are available
- what webhook and sync config applies
- what mappings are defined
- what health state is it in

### Integrations app responsibilities
- provider registry
- connection records
- auth metadata
- secret references
- base URLs and account metadata
- webhook registration metadata
- sync settings
- mapping profiles
- health and last success/failure state

### Integrations app should not own
- business workflow logic
- generic automation rules
- transient execution state
- queue jobs

### Integration concepts

#### Provider
A provider is a reusable template shipped by Octodrop.

Examples:
- Xero
- MYOB
- Simpro
- SharePoint
- Slack
- Generic REST API
- Generic Webhook
- Email SMTP
- SFTP

A provider defines:
- auth type
- required secrets
- supported triggers
- supported actions
- config schema
- validation rules
- setup UI schema

#### Connection
A connection is a workspace-specific configured instance of a provider.

Examples:
- `Xero - AusPac Solar`
- `Simpro - Armstrongs`
- `Generic REST - Client CRM`

A connection stores:
- workspace ownership
- provider reference
- auth configuration
- secret references
- status
- health
- provider account metadata
- sync settings
- webhook settings

### Suggested integration models

#### `integration_providers`
Defines built-in provider templates.

Fields:
- `id`
- `key`
- `name`
- `description`
- `auth_type`
- `manifest_json`
- `is_system`
- `created_at`
- `updated_at`

#### `integration_connections`
Defines configured provider instances per workspace.

Fields:
- `id`
- `workspace_id`
- `provider_id`
- `name`
- `status` (`draft`, `connected`, `error`, `disabled`)
- `base_url`
- `config_json`
- `health_status`
- `last_tested_at`
- `last_success_at`
- `last_error`
- `created_at`
- `updated_at`

#### `integration_connection_secrets`
Maps a connection to required secret references.

Fields:
- `id`
- `connection_id`
- `secret_id`
- `secret_key`
- `created_at`

#### `integration_mappings`
Stores reusable mapping profiles.

Fields:
- `id`
- `workspace_id`
- `connection_id`
- `name`
- `source_entity`
- `target_entity`
- `mapping_json`
- `created_at`
- `updated_at`

#### `integration_webhooks`
Stores inbound or outbound webhook metadata for a connection.

Fields:
- `id`
- `connection_id`
- `direction` (`inbound`, `outbound`)
- `event_key`
- `endpoint_path`
- `signing_secret_id`
- `status`
- `config_json`
- `created_at`
- `updated_at`

---

## 4. Automations
Automations define business behavior.

Integration answers: **how to connect**  
Automation answers: **what to do**

### Examples
- when a job is completed, create invoice in Xero
- every night sync customers from MYOB
- when a webhook is received from Simpro, create a work order
- when a lead is created, post to Slack

### Automation responsibilities
- trigger configuration
- schedules
- filters and conditions
- action steps
- mapping selection
- retry policy
- approval requirements if needed
- notifications
- enabled or disabled state

### Automation should not own
- raw credentials
- long-lived provider auth state
- low-level provider definitions

### Suggested automation models

#### `automations`
Fields:
- `id`
- `workspace_id`
- `name`
- `description`
- `status` (`draft`, `active`, `paused`, `disabled`)
- `trigger_type`
- `trigger_config_json`
- `schedule_cron`
- `conditions_json`
- `retry_policy_json`
- `notification_policy_json`
- `created_at`
- `updated_at`

#### `automation_steps`
Fields:
- `id`
- `automation_id`
- `step_order`
- `step_type`
- `connection_id`
- `action_key`
- `mapping_id`
- `config_json`
- `created_at`
- `updated_at`

#### `automation_runs`
Fields:
- `id`
- `automation_id`
- `workspace_id`
- `status`
- `trigger_payload_json`
- `started_at`
- `completed_at`
- `error_message`
- `result_json`

---

## 5. Workers and runtime
Workers are the execution layer for background jobs.

### Responsibilities
- run automations
- process webhooks
- run scheduled syncs
- perform retries
- handle outbound API calls
- process file and AI jobs later
- refresh tokens when needed

### Core rule
Workers must be stateless and shared across workspaces.

Workers do not belong to a workspace. They pull the next eligible job, load workspace context, resolve secrets, execute the task, and persist results.

---

# Queue architecture

## Current and target direction
Octodrop should use:
- 1 API service
- 1 scheduler service
- 1 shared queue system
- a shared worker pool

Do **not** create one worker per workspace.

### Why shared workers
- simpler deployment
- lower infra overhead
- better resource use
- easier scaling
- easier debugging

### When dedicated tenant workers might exist later
Only as an advanced option for:
- enterprise isolation
- premium plans
- very high throughput tenants
- compliance requirements

This is not the default architecture.

---

## Job design
Every job must include workspace and execution context.

### Suggested `jobs` table
- `id`
- `workspace_id`
- `queue_name`
- `job_type`
- `status` (`queued`, `running`, `done`, `failed`, `dead`)
- `priority`
- `payload_json`
- `attempt_count`
- `max_attempts`
- `run_after`
- `locked_by`
- `locked_at`
- `idempotency_key`
- `created_at`
- `completed_at`
- `last_error`

### Queue names
Define queue names early even if a single worker can consume all of them.

Recommended queues:
- `default`
- `automations`
- `integrations`
- `webhooks`
- `files`
- `ai`

This gives a clean path for future worker specialization.

---

## Scheduler
Scheduling must be DB-driven.

The scheduler should:
- poll for due automation schedules
- enqueue jobs for due work
- never execute business logic directly

Rule:
- **Scheduler decides what should run**
- **Workers execute**

---

## Worker specialization roadmap

### Stage 1
Shared workers processing all queues.

Deployment:
- 1 API
- 1 scheduler
- 1 to 2 worker instances

### Stage 2
Split workers by job class.

Examples:
- `worker-automation`
- `worker-integration`
- `worker-heavy`

### Stage 3
Add fairness and controls.

Examples:
- per-workspace concurrency limits
- queue priorities
- rate limits per provider
- retry backoff rules
- dead-letter handling

### Stage 4
Optional enterprise isolation.

Only for specific high-end cases.

---

# Runtime safety requirements

## 1. Idempotency
All webhook and automation jobs must support idempotency.

Examples of idempotency keys:
- provider event ID
- automation run hash
- external record ID + event type

A repeated event must not create duplicate side effects.

## 2. Job locking
Workers must claim jobs atomically to avoid duplicate processing.

## 3. Retries
Retries must support:
- max attempts
- exponential backoff
- dead-letter state after failure threshold

Do not retry forever.

## 4. Auditability
Every execution path must be traceable.

Store:
- trigger payload
- step results
- errors
- timestamps
- connection used
- workspace context

## 5. Workspace context
Every job must run with:
- workspace ID
- actor or system user context if relevant
- secret resolution scope
- permissions context where needed

---

# Webhook architecture

Webhooks must be a first-class feature.

## Inbound webhook flow
1. external provider sends webhook
2. Octodrop API receives the request on a generic ingress endpoint
3. signature or auth is verified using the linked secret
4. raw event is stored in `webhook_events`
5. API returns quickly
6. job is enqueued for async processing
7. worker parses and routes the event
8. worker creates an internal event or starts an automation

### `webhook_events` suggested fields
- `id`
- `workspace_id`
- `connection_id`
- `provider_event_id`
- `event_key`
- `headers_json`
- `payload_json`
- `signature_valid`
- `status`
- `received_at`
- `processed_at`
- `error_message`

### Webhook rules
- always store raw payloads
- always store headers
- always try to capture provider event ID
- always apply idempotency checks
- always process asynchronously after receipt

## Outbound webhook flow
Treat outbound webhooks as integration actions invoked by automation steps.

---

# Sync architecture

Octodrop must support four sync patterns:

## 1. Event-driven sync
Use provider webhooks where available.

## 2. Polling sync
Use scheduled jobs when providers do not support webhooks.

## 3. Manual sync
Allow admins to trigger imports or exports.

## 4. Scheduled batch sync
Nightly, hourly, or configured intervals.

### Suggested checkpoint model
#### `sync_checkpoints`
- `id`
- `workspace_id`
- `connection_id`
- `resource_key`
- `checkpoint_value`
- `updated_at`

Use checkpoints for polling-based integrations so only changed records are processed.

---

# Mapping layer

A reusable mapping layer is required for both self-service and future AI generation.

Mappings should support:
- source field to target field mapping
- default values
- constants
- formatting rules
- simple transforms
- conditional mappings
- lookup rules
- null handling

### Important rule
Mappings must remain declarative. Avoid unrestricted custom code in mappings unless sandboxed and heavily controlled.

---

# Provider manifest direction

Because AI will generate integrations in the future, provider behavior must be represented through manifests.

## Provider manifest example
```json
{
  "key": "simpro",
  "name": "Simpro",
  "auth": {
    "type": "oauth2",
    "required_secrets": ["client_id", "client_secret", "refresh_token"]
  },
  "capabilities": {
    "triggers": ["webhook.job.created", "poll.jobs.modified"],
    "actions": ["jobs.list", "jobs.get", "customers.get"]
  },
  "setup_schema": {},
  "mapping_targets": ["contacts", "jobs", "invoices"]
}
```

## Connection manifest
Represents a workspace-specific configured instance.

## Automation manifest
Represents a workflow using triggers and actions.

## Mapping manifest
Represents field-level transformations between source and target entities.

### Key implementation rule
AI must generate or update these manifests and related records. AI must not bypass the declarative architecture.

---

# AI architecture rules

## What AI should do later
AI should be able to:
- suggest providers and actions
- create draft connections
- create draft automations
- generate mapping definitions
- explain errors
- suggest retries or fixes

## What AI must not do by default
AI must not:
- write arbitrary runtime code into production paths
- gain direct raw secret access
- run unrestricted SQL
- make unrestricted outbound calls outside the integration model

## Example of correct AI behavior
User says:
> Sync MYOB customers to Octodrop contacts every night.

AI should:
- choose provider `myob`
- create or reference a connection
- create nightly automation schedule
- create mapping profile from MYOB customer fields to Octodrop contacts
- define checkpoint strategy
- define retry rules
- present draft for review or publish through guardrails

---

# Why not MCP as the core architecture

MCP can be useful as an interface layer for AI tool access, but it should not be Octodrop's main runtime model.

## Correct position for MCP
Possible future use:
- expose selected actions as AI tools
- let external AI clients call Octodrop capabilities through a standard interface

## Incorrect position for MCP
Do not design the whole integration runtime around MCP.

Octodrop should be built around:
- provider templates
- connection instances
- automation definitions
- secret references
- worker runtime
- queue and logs
- internal events
- manifests

MCP is optional on top, not the foundation.

---

# Internal event model

Octodrop should have an internal event model to decouple app changes from automation execution.

Examples:
- `octodrop.record.created`
- `octodrop.record.updated`
- `octodrop.job.status_changed`
- `integration.webhook.received`
- `integration.connection.failed`
- `automation.run.failed`

Automations should subscribe to internal events rather than custom code hooks.

---

# Generic REST provider

A Generic REST provider is important and should be implemented early.

It should support:
- base URL
- auth types
- headers
- GET POST PUT PATCH DELETE
- pagination config
- retry config
- rate limiting config
- response mapping
- polling setup

This provider will unlock many client integrations before custom adapters are built.

---

# Self-service client configuration

Clients should be able to configure integrations, but only within safe boundaries.

## Clients can configure
- connection credentials
- provider setup fields
- schedules
- trigger and action selections
- mapping profiles
- notifications
- test connection
- enable and disable

## Clients cannot freely configure
- arbitrary code execution
- raw secret access
- unrestricted SQL
- unrestricted outbound requests
- unsafe transform scripts

The configuration surface should be no-code or low-code with guardrails.

---

# Deployment guidance

## Near-term deployment
For current scale, recommended deployment is:
- 1 API app
- 1 scheduler process
- 1 shared queue implementation
- 1 to 2 worker instances

### Important
Do not create one worker per workspace.

## Scaling path
1. make jobs safe
2. add queue fairness and priorities
3. increase worker count
4. split workers by queue type
5. consider dedicated tenant workers only if truly needed

---

# Recommended implementation phases

## Phase 1: Foundations
Build:
- proper Secrets model
- provider registry
- connection records
- test connection action
- shared jobs table or queue
- scheduler
- basic worker runtime
- integration logs
- webhook ingress and storage

## Phase 2: Automation binding
Build:
- automation definitions
- automation steps
- schedule to job enqueueing
- automation run tracking
- connection action execution from workers
- retries and backoff

## Phase 3: Core provider support
Implement first providers:
- Generic Webhook
- Generic REST API
- Email
- one accounting provider
- one operational provider

Suggested operational targets:
- MYOB
- Xero
- Simpro

## Phase 4: Mapping and self-service
Build:
- mapping profiles
- setup forms
- connection testing UI
- reconnect auth flow
- logs and troubleshooting UI

## Phase 5: AI-assisted build
Build:
- AI generation of draft manifests
- AI mapping suggestions
- AI automation suggestions
- human review and publish flow

---

# Final architecture summary

## Ownership split

### Settings
General non-sensitive platform settings.

### Secrets
Sensitive values only.

### Integrations
Providers, connections, auth metadata, secret references, mappings, health, sync config, webhook metadata.

### Automations
Triggers, conditions, schedules, steps, retry and notification policies, run definitions.

### Workers / Runtime
Job queue, locking, retries, execution, checkpoints, logs, webhook processing.

---

# Non-negotiable rules

1. Do not store business logic in Secrets.
2. Do not store raw credentials in Automations.
3. Do not process webhook business logic inline in the API request.
4. Do not create one worker per workspace by default.
5. Do not allow AI to bypass manifests and structured configuration.
6. Do not let clients run arbitrary code in integrations.
7. All jobs must support idempotency, locking, retry, and audit logging.

---

# Build target for Codex

Codex should implement the architecture so that Octodrop becomes:

- a configurable app platform
- a secure integration platform
- a workflow automation runtime
- a middleware layer between client systems
- a future AI-assisted integration builder

The first implementation should favor:
- shared queues
- shared workers
- provider templates
- connection instances
- declarative automations
- runtime safety
- extensibility over one-off custom code
