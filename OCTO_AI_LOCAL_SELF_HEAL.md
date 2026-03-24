Octo AI Local Self-Heal

Goal:
Run Octo AI improvement loops against your local backend so code changes reload immediately and you avoid Fly costs during iteration.

Recommended setup:
1. Run the backend locally with autoreload.
2. Optionally run the frontend locally.
3. Run the self-heal loop against `http://localhost:8000`.

Why local is better for this loop:
- `uvicorn --reload` picks up code edits immediately.
- the self-heal loop can patch files and the backend restarts automatically
- no Fly deploy is required between cycles
- much cheaper than repeatedly deploying while debugging planner behavior
- the local backend launcher defaults `USE_DB=0` for faster, cheaper planner-focused iteration
- local auth still uses your real Supabase project URL from `web/.env`, so bearer-token verification keeps working

Backend terminal:
```powershell
cd "C:\Users\nicwi\Documents\My Projects\OCTO"
.\scripts\run_octo_local_backend.ps1
```

Frontend terminal:
```powershell
cd "C:\Users\nicwi\Documents\My Projects\OCTO"
.\scripts\run_octo_local_frontend.ps1
```

If your local backend uses normal auth, set:
```powershell
$env:OCTO_AI_EVAL_EMAIL="nick@octodrop.com"
$env:OCTO_AI_EVAL_PASSWORD="<YOUR_PASSWORD>"
```

Notes:
- `USE_DB=0` keeps Octo AI evals off the remote DB path, but auth still validates against your real Supabase project.
- Do not manually set `SUPABASE_URL=http://localhost` for this workflow.

Overnight self-heal loop:
```powershell
cd "C:\Users\nicwi\Documents\My Projects\OCTO"
.\scripts\run_octo_ai_self_heal_local.ps1 -StopOnClean
```

What the loop does:
1. runs the eval suite against `http://localhost:8000`
2. reads the latest `summary.json`
3. launches non-interactive Codex with the persistent self-heal brief
4. patches the repo
5. local backend autoreload picks up changes
6. reruns the eval suite

Where run artifacts go:
- default folder: `C:\temp\octo_ai_self_heal_local`
- each cycle gets its own subfolder
- inside each cycle folder:
  - `summary.json`
  - `iteration_001\*.json`
  - `codex_fix_prompt.txt`
  - `codex_last_message.txt`

If you want it to keep running until you manually stop it:
```powershell
.\scripts\run_octo_ai_self_heal_local.ps1
```

Useful options:
- one cycle only:
```powershell
.\scripts\run_octo_ai_self_heal_local.ps1 -Cycles 1
```

- custom local API port:
```powershell
.\scripts\run_octo_local_backend.ps1 -Port 8001
.\scripts\run_octo_ai_self_heal_local.ps1 -BaseUrl "http://localhost:8001"
```

What you need installed:
- Python venv at `.venv`
- Node/npm for the frontend
- Codex CLI logged in

You do not need Fly running for the local self-heal loop.
