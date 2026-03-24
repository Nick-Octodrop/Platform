# Octo AI Scale Runbook

Use this when you want Octo AI improving itself while you keep working elsewhere.

## Recommended setup

The ready-to-run path is the main repo. The local backend only reloads on changes under `app\`, so edits to tests and scripts will not keep bouncing the server.

If you later want a fully isolated self-heal lane, use a separate worktree or clone and create a venv there first. That is optional and not required for the commands below.

## Daily run

### PowerShell 1: backend

```powershell
cd "C:\Users\nicwi\Documents\My Projects\OCTO"
.\scripts\run_octo_local_backend.ps1
```

### PowerShell 2: continuous milestone loop

```powershell
cd "C:\Users\nicwi\Documents\My Projects\OCTO"
$env:OCTO_AI_EVAL_EMAIL="nick@octodrop.com"
$env:OCTO_AI_EVAL_PASSWORD="<YOUR_PASSWORD>"
.\scripts\run_octo_ai_milestone_local.ps1
```

### PowerShell 2: bounded run

```powershell
cd "C:\Users\nicwi\Documents\My Projects\OCTO"
$env:OCTO_AI_EVAL_EMAIL="nick@octodrop.com"
$env:OCTO_AI_EVAL_PASSWORD="<YOUR_PASSWORD>"
.\scripts\run_octo_ai_milestone_local.ps1 -Cycles 20
```

## What to watch

- `C:\temp\octo_ai_milestone_local\curriculum_state.json`
- latest run `summary.json`
- latest run `scoreboard.json`
- latest run `failure_digest.md`
- latest run `codex_last_message.txt`

## What good looks like

- current curriculum level keeps increasing
- representative failures shrink
- `codex_last_message.txt` mentions real planner fixes, not only test edits
- latest run keeps a high pass rate on the current level before unlocking the next one

## Deploy backend

```powershell
cd "C:\Users\nicwi\Documents\My Projects\OCTO"
flyctl deploy -a octodrop-platform-api
```

## Current scaling direction

The scalable path is:

1. user request -> structured plan
2. plain-English preview -> approval
3. approved plan -> constrained compiler
4. compiled operations -> validation and patch generation
5. harder curriculum levels -> broader self-heal loops
