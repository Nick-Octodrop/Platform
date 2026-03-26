Construction Worker PWA

Standalone worker-facing PWA for construction field crews.

Goals:
- separate from the main Octodrop frontend
- login with Octodrop Supabase user accounts
- only allow users mapped to an active `construction_worker` record
- simple French-first worker flows

Current flows:
- login
- verify worker mapping
- clock in
- clock out
- submit material usage

Environment:
- copy `.env.example` to `.env`
- set `VITE_API_URL`
- set `VITE_SUPABASE_URL`
- set `VITE_SUPABASE_ANON_KEY`
- set `VITE_WORKSPACE_ID`

Run:
- `npm install`
- `npm run dev`

Current backend assumptions:
- worker records exist in `entity.construction_worker`
- time entries exist in `entity.time_entry`
- material logs exist in `entity.material_log`
- project records exist in `entity.construction_project`

Worker access rule:
- Supabase-authenticated user must match `construction_worker.portal_user_id`
- worker record must also have `construction_worker.active = true`
