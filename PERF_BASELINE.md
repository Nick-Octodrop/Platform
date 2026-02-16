# Performance Baseline

Date: 2026-02-09
Environment:
- APP_ENV: __________
- API region: __________
- DB region: __________
- Supabase pooler: __________ (Shared/Dedicated/Direct)
- Client: __________ (local/WAN)

## Instrumentation
- Backend timing middleware: enabled
- DB query timing: enabled
- Slow query explain: dev-only, gated by `OCTO_QUERY_EXPLAIN=1`
- Frontend perf marks: `nav_start`, `bootstrap_loaded`, `list_rendered`, `form_rendered`

## Baseline (Before)
Fill these after running with warm cache/pool.

### List page (list view)
- nav_start → list_rendered (perceived interactive): ____ ms
- API total: ____ ms (p95)
- DB ms: ____ ms (typical)
- Queries: ____
- Payload size (list data): ____ KB
- Requests per page: ____

### Record open (form view)
- nav_start → form_rendered: ____ ms
- API total: ____ ms (p95)
- DB ms: ____ ms (typical)
- Queries: ____
- Requests per page: ____

### New record open
- nav_start → form_rendered: ____ ms
- Requests per page: ____

### Save
- form save API total: ____ ms (p95)
- DB ms: ____ ms (typical)
- Queries: ____

## Notes
- Record top 3 slow endpoints and query names observed.
- Attach logs/screenshots in your run notes.

[perf] 2026-02-09 20:36:11Z bootstrap_list p50=0.8 p95=1.1

[perf] 2026-02-09 20:36:11Z record_get p50=1161.0 p95=1168.2

[perf] 2026-02-09 20:36:11Z notifications_unread p50=1160.1 p95=1167.8

[perf] 2026-02-09 20:39:18Z bootstrap_list p50=0.8 p95=1.3

[perf] 2026-02-09 20:39:18Z record_get p50=0.9 p95=1.1

[perf] 2026-02-09 20:39:18Z notifications_unread p50=1168.6 p95=1176.0
