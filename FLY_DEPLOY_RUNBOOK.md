# Fly Deploy Runbook

Use this as the single source of truth for deploying the OCTO backend on Fly.

## Current topology

- API app: `octodrop-platform-api`
- Worker app: `octodrop-platform-worker`
- Scheduler app: `octodrop-platform-scheduler`

Fly config files:

- API: [fly.toml](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/fly.toml)
- Worker: [fly.worker.toml](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/fly.worker.toml)
- Scheduler: [fly.scheduler.toml](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/fly.scheduler.toml)

Dockerfiles:

- API: [Dockerfile](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/Dockerfile)
- Worker and scheduler: [Dockerfile.worker](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/Dockerfile.worker)

## What we currently have

### API

Runs `uvicorn app.main:app`.

### Worker

Runs `python -m app.worker`.

This is a shared worker, not separate worker roles. It can claim jobs across all workspaces when `WORKER_ORG_ID` is not set.

Current job types handled by the worker:

- `email.send`
- `doc.generate`
- `automation.run`
- `attachments.cleanup`
- `integration.webhook.process`
- `integration.sync.run`
- `external.webhook.deliver`

### Scheduler

Runs `python -m app.scheduler`.

This is the process that queues:

- scheduled automation runs
- scheduled integration sync runs

## Important answer about "different workers"

With the current setup, no, we do not yet have different worker roles deployed on Fly.

What we have today:

- one shared worker app that processes all job types
- one separate scheduler app that only enqueues timed work

So the separation is:

- API
- worker
- scheduler

It is not yet split into role-specific workers such as:

- email worker
- automation worker
- webhook delivery worker
- sync worker

If we want that later, we can add more Fly apps or process groups and gate job claiming by allowed job types. That is not implemented in the current worker.

## Prerequisites

From repo root:

```bash
cd "/mnt/c/Users/nicwi/Documents/My Projects/OCTO"
```

Login:

```bash
flyctl auth login
flyctl auth whoami
flyctl apps list
```

## Fly apps

Create apps if missing:

```bash
flyctl apps create octodrop-platform-api
flyctl apps create octodrop-platform-worker
flyctl apps create octodrop-platform-scheduler
```

## Secrets

### API secrets

Expected minimum:

- `USE_DB`
- `SUPABASE_URL`
- `SUPABASE_JWT_AUD`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`
- `SUPABASE_STORAGE_BUCKET_ATTACHMENTS`
- `SUPABASE_STORAGE_BUCKET_BRANDING`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

Check:

```bash
flyctl secrets list -a octodrop-platform-api
```

### Worker secrets

Expected minimum:

- all core DB/storage keys needed by the backend runtime
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `WORKER_POLL_MS`
- `WORKER_BATCH`

Normally unset:

- `WORKER_ORG_ID`
- `OCTO_WORKER_ORG_ID`

Only set these for a deliberately tenant-dedicated worker. The production shared worker must leave them unset so it can claim jobs across all workspaces.

Check:

```bash
flyctl secrets list -a octodrop-platform-worker
```

### Scheduler secrets

Expected minimum:

- all DB keys required to access jobs, automations, connections
- `SCHEDULER_POLL_SECONDS`

Optional:

- `SCHEDULER_ORG_ID`

Check:

```bash
flyctl secrets list -a octodrop-platform-scheduler
```

### Copy shared secrets

In practice, worker and scheduler should usually get the same Supabase/database secrets as the API.

## Build shared runtime base

Run this when `Dockerfile.base` or Python requirements changed:

```bash
pwsh -File ./scripts/build_runtime_base.ps1
```

That publishes the runtime base image used by the API build and by the worker/scheduler image.

## Deploy order

Recommended order:

1. Build runtime base if needed
2. Deploy API
3. Deploy worker
4. Deploy scheduler

## Deploy commands

### API

```bash
flyctl deploy -c fly.toml -a octodrop-platform-api
```

### Worker

```bash
flyctl deploy -c fly.worker.toml -a octodrop-platform-worker
```

### Scheduler

```bash
flyctl deploy -c fly.scheduler.toml -a octodrop-platform-scheduler
```

## Scale and machine checks

### API

```bash
flyctl status -a octodrop-platform-api
flyctl machines list -a octodrop-platform-api
flyctl logs -a octodrop-platform-api
```

### Worker

```bash
flyctl status -a octodrop-platform-worker
flyctl machines list -a octodrop-platform-worker
flyctl logs -a octodrop-platform-worker
```

### Scheduler

```bash
flyctl status -a octodrop-platform-scheduler
flyctl machines list -a octodrop-platform-scheduler
flyctl logs -a octodrop-platform-scheduler
```

## Health and smoke checks

### API

```bash
curl https://octodrop-platform-api.fly.dev/health
```

### Worker

Worker should show job polling and successful claims in logs.

### Scheduler

Scheduler should log startup and periodic queueing for:

- due scheduled automations
- due scheduled syncs

## Rollback

List releases:

```bash
flyctl releases -a octodrop-platform-api
flyctl releases -a octodrop-platform-worker
flyctl releases -a octodrop-platform-scheduler
```

Deploy a previous image:

```bash
flyctl deploy -a octodrop-platform-api --image <previous-image-ref>
flyctl deploy -a octodrop-platform-worker --image <previous-image-ref>
flyctl deploy -a octodrop-platform-scheduler --image <previous-image-ref>
```

## Migrations reminder

Before or during rollout, make sure the recent DB migrations are applied, especially:

- [042_automation_run_idempotency.sql](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/migrations/042_automation_run_idempotency.sql)
- [043_api_credentials.sql](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/migrations/043_api_credentials.sql)
- [044_api_request_logs.sql](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/migrations/044_api_request_logs.sql)
- [045_api_credential_security_fields.sql](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/migrations/045_api_credential_security_fields.sql)
- [046_external_webhook_subscriptions.sql](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/migrations/046_external_webhook_subscriptions.sql)

## Future worker split

If we later need different workers, the next clean split would be:

- `octodrop-platform-worker-automation`
- `octodrop-platform-worker-sync`
- `octodrop-platform-worker-webhooks`
- `octodrop-platform-worker-email`

That requires worker-side job-type filtering, which is not part of the current runtime yet.
