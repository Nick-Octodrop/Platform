# OCTO Product Layer (MVP)

## Overview
Product layer runs a FastAPI backend and a React web app that call the kernel as a library. The current demo flow is:

login → create module draft in Studio → validate/preview/apply → open app → create records

## Prerequisites
- Python 3.11
- Node.js + npm

## Environment Variables

Backend (`/app/.env`):
- `SUPABASE_URL` (required) – your Supabase project URL
- `SUPABASE_JWT_AUD` (optional) – JWT audience (often `authenticated`)
 - `USE_DB` (optional) – set to `1` to use Postgres persistence
 - `SUPABASE_DB_URL` (required when USE_DB=1) – Postgres connection string

Frontend (`/web/.env`):
- `VITE_SUPABASE_URL` (required) – same as backend URL
- `VITE_SUPABASE_ANON_KEY` (required) – Supabase anon key
- `VITE_API_URL` (optional, default `http://localhost:8000`) – FastAPI base URL

## Copy .env.example → .env
Backend:
```powershell
copy app\\.env.example app\\.env
```
```bash
cp app/.env.example app/.env
```

Frontend:
```powershell
copy web\\.env.example web\\.env
```
```bash
cp web/.env.example web/.env
```

## Run Commands

### Windows (PowerShell)
Backend:
```powershell
cd "C:\Users\nicwi\Documents\My Projects\OCTO"
python -m venv .venv
.\.venv\Scripts\activate
pip install -r app\requirements.txt
$env:SUPABASE_URL="https://<your-project>.supabase.co"
$env:SUPABASE_JWT_AUD="authenticated"
uvicorn app.main:app --reload --port 8000
```
Tests:
```powershell
cd "C:\Users\nicwi\Documents\My Projects\OCTO"
.\.venv\Scripts\activate
py -3 -m unittest
```

Frontend:
```powershell
cd "C:\Users\nicwi\Documents\My Projects\OCTO\web"
npm install
$env:VITE_SUPABASE_URL="https://<your-project>.supabase.co"
$env:VITE_SUPABASE_ANON_KEY="<anon-key>"
$env:VITE_API_URL="http://localhost:8000"
npm run dev
```

### macOS/Linux (bash)
Backend:
```bash
cd "/path/to/OCTO"
python3 -m venv .venv
source .venv/bin/activate
pip install -r app/requirements.txt
export SUPABASE_URL="https://<your-project>.supabase.co"
export SUPABASE_JWT_AUD="authenticated"
uvicorn app.main:app --reload --port 8000
```
Tests:
```bash
cd "/path/to/OCTO"
source .venv/bin/activate
python3 -m unittest
```

Frontend:
```bash
cd "/path/to/OCTO/web"
npm install
export VITE_SUPABASE_URL="https://<your-project>.supabase.co"
export VITE_SUPABASE_ANON_KEY="<anon-key>"
export VITE_API_URL="http://localhost:8000"
npm run dev
```

## Demo Flow
1) Open the web app at `http://localhost:5173`.
2) Log in with a Supabase user.
3) Go to Studio → click “New Module”.
4) Validate → Preview → Apply the draft.
5) Go to Home → open the new app.
6) Create and view records.

Expected behavior when logged out: no red errors; pages show “Please log in …”.

## Manifest authoring
- Contract/spec: `MANIFEST_CONTRACT.md`
- Example module: `manifests/request_lab.json` (Odoo-style list → form with statusbar, tabs, chatter)

Notes:
- Surfaces (cards/panels) should be declared via `container` blocks in page content.
- Views (list/form) render flat; they do not add card styling implicitly.
- Use `app.defaults.entities` to route `open_form` actions to the correct per-entity form page.

## Troubleshooting
- **CORS errors**: ensure backend allows `http://localhost:5173` and you’re using the same origin in `VITE_API_URL`.
- **JWT audience errors**: set `SUPABASE_JWT_AUD` to your project’s audience (often `authenticated`).
- **401 Unauthorized**: ensure you’re logged in and `VITE_SUPABASE_*` values are correct.
- **VITE_API_URL mismatch**: verify it matches the FastAPI host/port.
- **Missing env vars**: backend requires `SUPABASE_URL`; frontend requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
 - **USE_DB enabled but no DB URL**: set `SUPABASE_DB_URL` (or `DATABASE_URL`) before starting the backend.

## Persistence mode (optional)
To persist data across restarts, enable DB mode and run migrations.

1) Apply migrations (in order):
```bash
psql "$SUPABASE_DB_URL" -f app/migrations/002_persistence.sql
psql "$SUPABASE_DB_URL" -f app/migrations/003_contacts.sql
psql "$SUPABASE_DB_URL" -f app/migrations/004_jobs_contact_id.sql
psql "$SUPABASE_DB_URL" -f app/migrations/005_templates.sql
psql "$SUPABASE_DB_URL" -f app/migrations/006_module_drafts.sql
psql "$SUPABASE_DB_URL" -f app/migrations/007_records_generic.sql
psql "$SUPABASE_DB_URL" -f app/migrations/008_module_drafts_base_snapshot.sql
psql "$SUPABASE_DB_URL" -f app/migrations/009_records_chatter.sql
```

2) Set env vars:
```
USE_DB=1
SUPABASE_DB_URL=postgres://...
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com
OPENAI_MODEL=gpt-4o-mini
```

Manual verification checklist:
- apply module → restart → module still installed
- create record → restart → record still present

## Demo Endpoints Used
- `GET /modules`
- `GET /modules/{id}/snapshots`
- `POST /modules/{id}/rollback`
- `DELETE /modules/{id}`
- `GET /studio/modules`
- `POST /studio/modules/new`
- `PUT /studio/modules/{id}`
- `POST /studio/modules/{id}/validate`
- `POST /studio/modules/{id}/preview`
- `POST /studio/modules/{id}/apply`
- `POST /studio/modules/{id}/discard_draft`

## Studio2 Flow + Endpoints

Studio2 lives at `/studio2` and enforces: PatchSet → validate → preview → apply → snapshot → rollback.

- `GET /studio2/registry` compact registry snapshot
- `GET /studio2/modules/{module_id}/manifest` installed manifest
- `POST /studio2/modules/create` create draft module (v1.3 seed)
- `POST /studio2/patchset/validate` validate PatchSet only
- `POST /studio2/patchset/preview` resolve draft manifest + summary
- `POST /studio2/patchset/apply` apply PatchSet (transaction_group_id)
- `POST /studio2/patchset/rollback` rollback by transaction_group_id or manifest hash
- `POST /studio2/json/fix` heuristic JSON repair
- `POST /studio2/ai/plan` AI PatchSet stub (USE_AI=1 to enable later)
- `POST /studio2/ai/fix_json` AI JSON fix stub
- `POST /studio2/agent/chat` OpenAI-backed PatchSet chat (requires OPENAI_API_KEY)
- `POST /studio2/agent/chat/stream` SSE progress stream (plan/ops/validation)
- `GET /studio2/agent/status` OpenAI configuration status

### Studio2 Agent Streaming (SSE)

`POST /studio2/agent/chat/stream` returns `text/event-stream` frames. Events include `run_started`, `planner_result`, `builder_result`, `apply_result`, `validate_result`, `stopped`, and `done`.

Client example (browser):

```
const res = await fetch("/studio2/agent/chat/stream", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ module_id, message })
});
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const parts = buffer.split("\\n\\n");
  buffer = parts.pop() || "";
  for (const part of parts) {
    const lines = part.split("\\n");
    const eventLine = lines.find(l => l.startsWith("event:"));
    const dataLine = lines.find(l => l.startsWith("data:"));
    if (!dataLine) continue;
    const payload = JSON.parse(dataLine.replace("data: ", ""));
    // render payload.data
  }
}
```

## Notes
- Backend uses in-memory stores (data resets on restart).
- Database migrations live in `/app/migrations` for later Supabase setup.
