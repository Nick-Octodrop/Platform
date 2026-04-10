# Production Performance Audit

Date: 2026-04-10

## Scope

This audit focused on generic platform-wide performance, caching, layout stability, and code health issues across the app. Workspace-specific and manifest-specific optimizations were intentionally excluded.

## Baseline Evidence

- CRM module trace showed:
  - `GET /modules` about `900ms`
  - `GET /modules/biz_crm/manifest` about `905ms`
  - `GET /page/bootstrap?...` about `945ms`
  - intermittent `POST /system/dashboard/query` `500`s
  - large N+1 storms of `/records/entity.biz_contact/:id`, stretching out to `6s+`
- Production build still contains several large route chunks plus a large dynamic icon chunk:
  - `dynamicIconImports` about `235kB`
  - main route chunks around `221kB` to `415kB`
- Recent regressions clustered in shell/loading/perf commits:
  - `92a7da1 loading1`
  - `eb65df7 big-sql-performance1`
  - `ac1cd8b ui12`

## Top Issues

### 1. N+1 lookup label fetching in list/kanban/calendar rendering

- Severity: Critical
- Location:
  - [ViewModesBlock.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/ui/ViewModesBlock.jsx)
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
  - [stores_db.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/stores_db.py)
- Evidence:
  - one CRM view triggered dozens of `/records/entity.biz_contact/:id` requests
  - request chain extended visible page readiness into multi-second delays
- Exact fix:
  - added generic batched lookup-label endpoint
  - added generic store `get_many(...)`
  - switched card/calendar lookup resolution to batched requests
- Impact category:
  - route performance
  - perceived speed
  - scalability
  - caching

### 2. Dashboard SQL fast path could fail with `500` instead of falling back

- Severity: High
- Location:
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
- Evidence:
  - `POST /system/dashboard/query` intermittently returned `500`
  - same screen later recovered with `200`, indicating a brittle fast path
- Exact fix:
  - wrapped the SQL fast path with safe fallback to the existing slower path
  - kept the optimization when it works, removed production-breaking behavior when it does not
- Impact category:
  - route performance
  - perceived speed
  - layout stability
  - maintainability/scalability

### 3. Access context boot duplicated across the shell and feature pages

- Severity: High
- Location:
  - [access.js](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/access.js)
  - [App.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/App.jsx)
  - [SettingsUsersPage.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/pages/SettingsUsersPage.jsx)
  - [SettingsWorkspacesPage.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/pages/SettingsWorkspacesPage.jsx)
- Evidence:
  - access context was mounted in many consumers
  - in-flight request dedupe existed, but each consumer still owned its own loading/error lifecycle
  - route guards and pages could show separate spinners around the same data
- Exact fix:
  - introduced a shared `AccessContextProvider`
  - added reusable `getAccessContext()`
  - seeded the provider from app boot when possible
  - moved settings pages to use shared access context instead of refetching it
- Impact category:
  - initial load
  - route performance
  - perceived speed
  - caching correctness
  - maintainability/scalability

### 4. Access-context cache invalidation was incomplete

- Severity: High
- Location:
  - [api.js](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/api.js)
- Evidence:
  - member/profile/workspace mutations invalidated related lists but not the access-context snapshot consistently
  - stale access state risks extra refetches and inconsistent UI
- Exact fix:
  - added request policy for `GET /access/context`
  - invalidated `/access/context` on access member/profile/workspace mutations
- Impact category:
  - caching correctness
  - route performance
  - maintainability/scalability

### 5. Module store was bypassing the modules cache on mount/workspace refresh

- Severity: Medium
- Location:
  - [moduleStore.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/state/moduleStore.jsx)
- Evidence:
  - `refresh({ force: true })` ran on provider mount/workspace change
  - this defeated client-side caching even though workspace switches already clear caches explicitly
- Exact fix:
  - changed provider refresh effect to `refresh()` and let real invalidation own freshness
- Impact category:
  - initial load
  - route performance
  - caching correctness
  - maintainability/scalability

### 6. `/modules` cold path was rehydrating app metadata from manifests

- Severity: Medium
- Location:
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
- Evidence:
  - `/modules` was about `900ms` in the reported trace
  - cache miss path walked the registry and reopened snapshots to backfill missing metadata
- Exact fix:
  - introduced a cached enriched registry list keyed by a generic registry fingerprint
  - module list metadata enrichment now happens once per registry fingerprint instead of every cold request path
- Impact category:
  - initial load
  - route performance
  - perceived speed
  - caching
  - scalability

### 7. Actor-filtered manifest compilation was repeated on bootstrap hot paths

- Severity: Medium
- Location:
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
- Evidence:
  - `/page/bootstrap` was about `945ms` in the reported trace
  - actor-filtered manifests were cached, but compiled filtered manifests were still rebuilt on the hot path
- Exact fix:
  - added compiled-manifest variant caching keyed by module, manifest hash, and access-policy hash
  - `/modules/:id/manifest` now prewarms the actor-filtered compiled variant
  - `/page/bootstrap` reuses the cached filtered compiled manifest
- Impact category:
  - route performance
  - initial load
  - perceived speed
  - caching
  - scalability

### 8. Large icon catalog still contributes meaningful runtime cost

- Severity: Medium
- Location:
  - build output
  - [AppModuleIcon.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/components/AppModuleIcon.jsx)
  - icon catalog modules under `web/src/state/`
- Evidence:
  - `dynamicIconImports` still around `235kB`
  - icon browsing/search was previously coupled too closely to app runtime
- Exact fix:
  - icon catalogs were already moved to on-demand loading in the prior perf pass
  - remaining cost is now isolated rather than blocking general app boot
- Impact category:
  - bundle size
  - initial load
  - maintainability/scalability

### 9. Home/App Manager/SideNav were fetching manifests before navigation

- Severity: Medium
- Location:
  - [HomePage.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/pages/HomePage.jsx)
  - [AppsPage.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/pages/AppsPage.jsx)
  - [SideNav.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/layout/SideNav.jsx)
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
- Evidence:
  - module opens from shell entry points depended on `getManifest(...)` before route navigation
  - this added an extra request before even hitting the actual module page
- Exact fix:
  - `/modules` now includes a generic computed `home_route`
  - Home, App Manager, and SideNav navigate directly using that cached route metadata
- Impact category:
  - route performance
  - perceived speed
  - caching
  - scalability

### 10. Bootstrap results were not seeding the frontend manifest cache

- Severity: Medium
- Location:
  - [api.js](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/api.js)
- Evidence:
  - module routes often load through `/page/bootstrap`, but later manifest consumers could still hit `/modules/:id/manifest`
  - that duplicated manifest work on route entry and chrome rendering
- Exact fix:
  - `getPageBootstrap(...)` now seeds the existing frontend manifest caches with `manifest_hash`, `manifest`, and compiled manifest data
  - later `getManifest(...)` reads can reuse bootstrap data instead of re-requesting the module manifest
- Impact category:
  - route performance
  - perceived speed
  - caching
  - maintainability/scalability

### 11. Module hot paths were underusing cached registry rows and over-filtering unrestricted manifests

- Severity: Medium
- Location:
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
- Evidence:
  - `_get_module(...)` could miss already-cached module rows and fall through to registry reads
  - unrestricted writers still paid the full manifest deep-copy/filter path on hot bootstrap/manifest requests
  - compiled manifest invalidation was keyed incorrectly, so stale compiled variants could survive installs/updates until broader cache clears
- Exact fix:
  - `_get_module(...)` now reuses cached `/modules` and request-scoped enriched registry rows before hitting the registry again
  - `_filter_manifest_for_actor(...)` now short-circuits for truly unrestricted write actors with empty policy maps
  - compiled manifest invalidation now keys by `org_id + module_id`, matching the actual compiled cache keys
- Impact category:
  - initial load
  - route performance
  - perceived speed
  - caching
  - maintainability/scalability

## Implemented Fixes In This Pass

### Shared access bootstrap and invalidation

- Files:
  - [access.js](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/access.js)
  - [App.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/App.jsx)
  - [api.js](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/api.js)
  - [SettingsUsersPage.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/pages/SettingsUsersPage.jsx)
  - [SettingsWorkspacesPage.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/pages/SettingsWorkspacesPage.jsx)
  - [moduleStore.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/state/moduleStore.jsx)
- Improves:
  - initial load speed
  - route performance
  - perceived speed
  - caching correctness
  - maintainability/scalability

### Generic batched lookup label resolution

- Files:
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
  - [stores_db.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/stores_db.py)
  - [ViewModesBlock.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/ui/ViewModesBlock.jsx)
- Improves:
  - route performance
  - perceived speed
  - caching correctness
  - scalability

### Dashboard query failure hardening

- Files:
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
- Improves:
  - route performance
  - perceived speed
  - layout stability
  - maintainability/scalability

### Generic backend startup-path caching

- Files:
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
  - [stores_db.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/stores_db.py)
  - [056_modules_installed_manifest_meta.sql](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/migrations/056_modules_installed_manifest_meta.sql)
- Improves:
  - initial load speed
  - route performance
  - perceived speed
  - caching correctness
  - maintainability/scalability

### Generic module entry-route caching

- Files:
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
  - [HomePage.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/pages/HomePage.jsx)
  - [AppsPage.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/pages/AppsPage.jsx)
  - [SideNav.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/layout/SideNav.jsx)
- Improves:
  - route performance
  - perceived speed
  - caching correctness
  - maintainability/scalability

### Bootstrap-to-manifest cache reuse

- Files:
  - [api.js](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/api.js)
- Improves:
  - route performance
  - perceived speed
  - caching correctness
  - maintainability/scalability

### Generic registry/module hot-path reuse

- Files:
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
- Improves:
  - initial load speed
  - route performance
  - perceived speed
  - caching correctness
  - maintainability/scalability

### Server timing instrumentation for startup endpoints

- Files:
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
- Exact fix:
  - added `Server-Timing` headers to `/modules`, `/modules/:id/manifest`, and `/page/bootstrap`
  - exposed phase timings like `auth`, `load`, `manifest`, `filter`, `compile`, `data`, and `total`
- Improves:
  - route performance
  - caching correctness
  - maintainability/scalability

## Remaining Risks / Next Targets

### 1. Slow backend startup path for app entry

- `/modules`, `/modules/:id/manifest`, and `/page/bootstrap` are still around `900ms` on the reported trace
- Next action:
  - inspect the new `Server-Timing` headers on these endpoints with realistic data
  - inspect registry/snapshot/manifest-filter hot paths

### 2. Route-target resolution still depends on manifest reads in some flows

- direct `/apps/:moduleId` fallback and some shell consumers can still depend on manifest reads
- Next action:
  - move more route metadata into cached module registry responses, or add a lightweight server-computed home-route field

### 3. Bundle still contains several large route chunks

- Current route chunking is much better than before, but some chunks remain heavy
- Next action:
  - audit remaining largest route bundles and shared imports
  - continue shrinking large icon/dynamic import surfaces where it is safe

## Stop Criteria

Stop the generic platform-wide performance pass when all of these are true on a production-like build:

1. `/modules` is consistently below about `250ms` server time.
2. `/modules/:id/manifest` is consistently below about `350ms` server time.
3. `/page/bootstrap` is consistently below about `500ms` server time for common entry routes.
4. `Server-Timing` shows no obvious duplicate work on those endpoints.
5. Remaining slowness is data-specific, network-specific, or route-specific, not generic shell/bootstrap overhead.

At that point, further work should shift from generic tuning to targeted profiling of specific heavy workspaces, datasets, or workflows.
