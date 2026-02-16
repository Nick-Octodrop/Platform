# Performance Tuning Notes

Date: 2026-02-09

## Connection Pooling
- Backend uses `psycopg2.pool.SimpleConnectionPool`.
- Configure via env:
  - `OCTO_DB_POOL_MIN` (default: 1)
  - `OCTO_DB_POOL_MAX` (default: 10)
- Recommendation: set pool sizes per instance based on CPU and expected concurrency.

## Supabase Pooler Options
- **Dedicated Pooler** (recommended for production latency):
  - Lowest latency, best tail performance under concurrency.
  - More predictable performance for `p95` targets.
- **Shared Pooler**:
  - Cheaper but higher contention; can spike latency under load.
  - OK for low-traffic or dev.
- **Direct**:
  - Avoid in multi-instance deployments; risk of exhausting DB connections.

## Region Alignment
- Ensure API server region matches Supabase DB region.
- Target same cloud region to reduce RTT (avoid cross-region egress).

## FastAPI / Uvicorn
- Suggested baseline (adjust per CPU/RAM):
  - `--workers`: 2–4 per CPU (start with 2)
  - `--loop`: `uvloop` (if available)
  - `--http`: `h11`
  - `--timeout-keep-alive`: 5–10s
- Avoid blocking calls in async endpoints (use threadpool/async when needed).

## Query Plan Capture (Dev)
- Enable with `OCTO_QUERY_EXPLAIN=1` (dev-only) for slow queries.
- Threshold via `OCTO_QUERY_SLOW_MS` (default 200ms).

## Realtime Subscriptions (Supabase)
- Realtime adds constant DB load. Disable unless actively needed.
- Frontend flag: `VITE_SUPABASE_REALTIME=1` enables realtime. Default is off.

## Workflow History Writes
- Large `history` JSON updates can dominate latency.
- `OCTO_WORKFLOW_HISTORY_LIMIT` (default 50) caps history stored on the instance row.
- Full workflow history is now stored in `workflow_instance_events` (append-only).

## Observability Targets
- Backend p95: < 200ms (warm)
- DB list queries: < 80ms typical
- Requests per list page: 1–2

## Automated Perf Tests
Run locally:
- `make perf`
- or `python -m unittest tests.test_perf_backend`

Environment budgets (defaults shown):
- `PERF_P95_MS_BOOTSTRAP_LIST=250`
- `PERF_MAX_QUERIES_BOOTSTRAP_LIST=10`
- `PERF_P95_MS_BOOTSTRAP_FORM=300`
- `PERF_MAX_QUERIES_BOOTSTRAP_FORM=12`

Additional perf budgets test:
- `python -m unittest tests.test_perf_budgets`
- Budgets (defaults if unset):
  - `PERF_P95_MS_RECORD_GET=1200`
  - `PERF_MAX_QUERIES_RECORD_GET=10`
  - `PERF_MAX_BYTES_RECORD_GET=150000`
  - `PERF_P95_MS_NOTIF_UNREAD=1200`
  - `PERF_MAX_QUERIES_NOTIF_UNREAD=10`
  - `PERF_MAX_BYTES_NOTIF_UNREAD=150000`
  - `PERF_MAX_BYTES_BOOTSTRAP_LIST=150000`
  - `PERF_WRITE_BASELINE=1` to append p50/p95 into `PERF_BASELINE.md`

CI guidance:
- Use looser budgets in CI env vars.
- Consider nightly “perf strict” job for tighter budgets.
