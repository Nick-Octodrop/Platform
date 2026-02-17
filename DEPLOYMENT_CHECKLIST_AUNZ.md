# OCTO Deployment Checklist (AU/NZ, Low Cost)

Use this as a step-by-step tracker. Do one section at a time.

## Important note on Supabase region

- Supabase project region cannot be changed in-place.
- To move from one region to another (for example Mumbai to Sydney), create a new Supabase project in the target region and migrate data/auth/storage.

---

## Phase 0 - Preflight

- [ ] Confirm target stack:
  - Frontend: Cloudflare Pages
  - API + Worker: Fly.io (`syd`)
  - DB/Auth/Storage: Supabase (`ap-southeast-2`, Sydney)
- [ ] Confirm GitHub repo is ready and pushed from local.
- [ ] Confirm current local app runs (`web` + `app`) before migration.

---

## Phase 1 - New Supabase (Sydney)

- [ ] Create new Supabase project in Sydney (`ap-southeast-2`).
- [ ] Save these values in a secure note:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_DB_URL` / `DATABASE_URL`
- [ ] Recreate required storage buckets (for example `attachments`, `branding`).
- [ ] Run all DB migrations on new project:

```bash
for f in app/migrations/*.sql; do
  psql "$SUPABASE_DB_URL" -f "$f"
done
```

- [ ] Migrate existing data (if needed):
  - records
  - templates
  - automations
  - users/workspace config
- [ ] Smoke test local app using new Supabase env values.

Rollback:
- Keep old Supabase project untouched until prod is stable.

---

## Phase 2 - Backend + Worker on Fly.io (Sydney)

- [ ] Install Fly CLI and login.
- [ ] Create Fly app (or apps) in `syd`.
- [ ] Add backend deployment config (`fly.toml` + Dockerfile if needed).
- [ ] Set Fly secrets:
  - `SUPABASE_URL`
  - `SUPABASE_JWT_AUD`
  - `USE_DB=1`
  - `SUPABASE_DB_URL` / `DATABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` (if storage uploads need it server-side)
  - `OPENAI_*` keys if used
- [ ] Ensure process commands:
  - web: `uvicorn app.main:app --host 0.0.0.0 --port 8000`
  - worker: `python3 -m app.worker`
- [ ] Deploy:

```bash
fly deploy
```

- [ ] Verify:
  - API health
  - auth works
  - file upload works
  - automation worker picks jobs
  - document generation works

Rollback:
- Revert Fly secrets back to old DB if needed.

---

## Phase 3 - Frontend on Cloudflare Pages

- [ ] Create Cloudflare Pages project from GitHub repo.
- [ ] Build settings:
  - Root: `web`
  - Build: `npm ci && npm run build`
  - Output: `dist`
- [ ] Set env vars:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_API_URL` (Fly API URL)
- [ ] Deploy and open app URL.
- [ ] Validate login + app navigation + module pages.

Rollback:
- Keep previous domain/URL until this is verified.

---

## Phase 4 - Domain + TLS + Final Cutover

- [ ] Point production domain to Cloudflare Pages.
- [ ] Add API subdomain to Fly app.
- [ ] Confirm TLS certs active.
- [ ] Update `VITE_API_URL` to final API domain.
- [ ] Re-test:
  - record CRUD
  - attachments
  - email templates
  - document templates
  - automation document generation

---

## Phase 5 - Operations Baseline

- [ ] Enable uptime checks (API + frontend).
- [ ] Set alerting (5xx spikes, worker failures, queue depth).
- [ ] Confirm backup policy on new Supabase project.
- [ ] Confirm log access for:
  - backend
  - worker
  - frontend

---

## Local/Prod workflow (no code switching)

- Local uses:
  - `app/.env`
  - `web/.env`
- Prod uses:
  - Fly secrets
  - Cloudflare Pages env vars
- Keep the same variable names in both places.

Standard release flow:

```bash
git add .
git commit -m "feat: ..."
git push
```

- Frontend auto deploys (Pages).
- Backend/worker deploy with `fly deploy` (or CI later).

---

## Optional VS Code helpers (not required)

- GitHub Pull Requests and Issues
- GitHub Actions
- DotENV

Deployments still run via Git + CLI; no mandatory VS Code plugin.




flyctl secrets set POSTMARK_API_TOKEN=2e7c6368-6749-4616-82a0-03404938e748 -a octodrop-platform-worker



# 1) force non-Depot builds for this session
$env:FLY_NO_DEPOT="1"

# 2) set secrets one-by-one (safer)
flyctl secrets set USE_DB=1 -a octodrop-platform-worker
flyctl secrets set SUPABASE_URL=https://tjgbrpnzwgloczszjnbt.supabase.co -a octodrop-platform-worker
flyctl secrets set SUPABASE_JWT_AUD=authenticated -a octodrop-platform-worker
flyctl secrets set SUPABASE_ANON_KEY="<SUPABASE_ANON_KEY>" -a octodrop-platform-worker
flyctl secrets set SUPABASE_SERVICE_ROLE_KEY="<SUPABASE_SERVICE_ROLE_KEY>" -a octodrop-platform-worker
flyctl secrets set SUPABASE_DB_URL="<SUPABASE_DB_URL>" -a octodrop-platform-worker
flyctl secrets set SUPABASE_STORAGE_BUCKET_ATTACHMENTS=attachments -a octodrop-platform-worker
flyctl secrets set SUPABASE_STORAGE_BUCKET_BRANDING=branding -a octodrop-platform-worker
flyctl secrets set OPENAI_API_KEY="<OPENAI_API_KEY>" -a octodrop-platform-worker
flyctl secrets set OPENAI_MODEL=gpt-4o-mini -a octodrop-platform-worker



flyctl secrets set WORKER_POLL_MS=1000 -a octodrop-platform-worker
flyctl secrets set WORKER_BATCH=5 -a octodrop-platform-worker
flyctl secrets set WORKER_ORG_ID="<WORKER_ORG_ID>" -a octodrop-platform-worker


flyctl secrets set SUPABASE_DB_URL="<SUPABASE_DB_URL_ENCODED_SSL>" -a octodrop-platform-api
flyctl secrets set SUPABASE_DB_URL="<SUPABASE_DB_URL_ENCODED_SSL>" -a octodrop-platform-worker


cd "C:\Users\nicwi\Documents\My Projects\OCTO"
git add -A
git commit -m "api: <change>"
git push
flyctl deploy -a octodrop-platform-api


cd "C:\Users\nicwi\Documents\My Projects\OCTO"
git add -A
git commit -m "worker: <change>"
git push
flyctl deploy -c fly.worker.toml -a octodrop-platform-worker


flyctl deploy -a octodrop-platform-api
flyctl deploy -c fly.worker.toml -a octodrop-platform-worker


flyctl secrets set KEY=value -a octodrop-platform-api
flyctl secrets set KEY=value -a octodrop-platform-worker


flyctl status -a octodrop-platform-api
flyctl status -a octodrop-platform-worker
flyctl logs -a octodrop-platform-api
flyctl logs -a octodrop-platform-worker




flyctl machines restart 59185590da2583 -a octodrop-platform-worker