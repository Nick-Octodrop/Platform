# Backend Production Runbook (Fly.io)

Use this to update OCTO backend in production.

## 0) Prerequisites

- Repo root: `C:\Users\nicwi\Documents\My Projects\OCTO`
- Fly apps:
  - API: `octodrop-platform-api`
  - Worker: `octodrop-platform-worker`
- Worker config file exists: `fly.worker.toml`

## 1) Login + quick checks

```powershell
cd "C:\Users\nicwi\Documents\My Projects\OCTO"
flyctl auth login
flyctl auth whoami
flyctl apps list
```

## 2) Confirm required secrets exist

```powershell
flyctl secrets list -a octodrop-platform-api
flyctl secrets list -a octodrop-platform-worker
```

Expected key names (API):
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

Expected key names (Worker):
- all core Supabase/OpenAI keys above (except `SUPABASE_ANON_KEY` optional for worker)
- `WORKER_POLL_MS`
- `WORKER_BATCH`
- `WORKER_ORG_ID`

## 3) Update secrets (only when needed)

Example (DB URL fix with encoded password + sslmode):

```powershell
flyctl secrets set SUPABASE_DB_URL="postgresql://postgres:<ENCODED_PASSWORD>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require" -a octodrop-platform-api
flyctl secrets set SUPABASE_DB_URL="postgresql://postgres:<ENCODED_PASSWORD>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require" -a octodrop-platform-worker
```

## 4) Deploy API

```powershell
flyctl deploy -a octodrop-platform-api
```

## 5) Deploy Worker

```powershell
flyctl deploy -c fly.worker.toml -a octodrop-platform-worker
```

## 6) Verify API

```powershell
flyctl status -a octodrop-platform-api
flyctl logs -a octodrop-platform-api
Invoke-RestMethod https://octodrop-platform-api.fly.dev/health
```

## 7) Verify Worker

```powershell
flyctl status -a octodrop-platform-worker
flyctl logs -a octodrop-platform-worker
```

You should see polling lines (for example `jobs.claim_batch`).

## 8) Post-deploy smoke test

- Login to app.
- Open modules list.
- Create/update a record.
- Trigger one automation/job (document generation is good test).
- Confirm worker logs show claim + execute + success.

## 9) Rollback (if needed)

```powershell
flyctl releases -a octodrop-platform-api
flyctl releases -a octodrop-platform-worker
```

Pick previous version and deploy that image:

```powershell
flyctl deploy -a octodrop-platform-api --image <previous-image-ref>
flyctl deploy -a octodrop-platform-worker --image <previous-image-ref>
```

## 10) Common failures

- `Not authorized to access this firecrackerapp`
  - Run `flyctl auth logout` then `flyctl auth login`.
  - Re-run `flyctl status -a <app>`.

- `Invalid format for user or db_name` (DB connect)
  - Fix `SUPABASE_DB_URL`.
  - URL-encode special chars in password (`!` => `%21`).
  - Include `?sslmode=require`.

- App starts but frontend gets CORS errors
  - Backend currently allows localhost by default.
  - Add production frontend origin to backend CORS config, then redeploy API.

## 11) Security reminder

- Never commit secrets to git.
- Rotate keys immediately if exposed:
  - OpenAI API key
  - Supabase service role key
  - Database password
