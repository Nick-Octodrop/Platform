# Final Summary

Date: 2026-04-10

## What Changed

### Generic platform code changes

- shared access-context provider added:
  - [access.js](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/access.js)
  - [App.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/App.jsx)
- access-context request caching/invalidation tightened:
  - [api.js](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/api.js)
- settings pages now reuse shared access state instead of refetching it:
  - [SettingsUsersPage.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/pages/SettingsUsersPage.jsx)
  - [SettingsWorkspacesPage.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/pages/SettingsWorkspacesPage.jsx)
- module store no longer force-bypasses the cache on mount:
  - [moduleStore.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/state/moduleStore.jsx)
- backend module startup path now caches enriched registry metadata and actor-filtered compiled manifests:
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
  - [stores_db.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/stores_db.py)
  - [056_modules_installed_manifest_meta.sql](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/migrations/056_modules_installed_manifest_meta.sql)
- generic module hot paths now reuse cached module rows more aggressively, skip manifest filtering for unrestricted write actors, and invalidate compiled manifests correctly:
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
- startup endpoints now expose `Server-Timing` headers so `/modules`, `/modules/:id/manifest`, and `/page/bootstrap` can be measured directly in production-like builds:
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
- module entry points now use server-computed home routes instead of fetching manifests before navigation:
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
  - [HomePage.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/pages/HomePage.jsx)
  - [AppsPage.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/pages/AppsPage.jsx)
  - [SideNav.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/layout/SideNav.jsx)
- bootstrap responses now seed the shared frontend manifest cache:
  - [api.js](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/api.js)
- generic batched lookup-label resolution added:
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
  - [stores_db.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/stores_db.py)
  - [ViewModesBlock.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/ui/ViewModesBlock.jsx)
- dashboard query fast path hardened with safe fallback:
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)

## Before / After Observations

### Before

- module/dashboard screens could trigger N+1 lookup fetch storms
- access context was network-deduped but still booted through many separate component lifecycles
- access mutations did not invalidate access context consistently
- dashboard fast path could surface intermittent `500`s
- `/modules` cold path rehydrated metadata from manifests
- filtered manifest compilation was repeated on bootstrap hot paths
- compiled manifest invalidation could miss the actual cached variants
- module entry points fetched manifests before they could navigate
- bootstrap-loaded pages could still trigger a later manifest fetch

### After

- card/calendar lookup labels resolve in batches
- access state is booted once and reused by the shell
- access mutations refresh cached context safely
- dashboard fast path no longer breaks the page when it fails
- `/modules` can reuse a cached enriched registry list
- installed-module rows now persist generic manifest metadata instead of forcing repeated snapshot decoration
- `/page/bootstrap` can reuse actor-filtered compiled manifests
- unrestricted write actors can now reuse raw manifest variants without the filtered deep-copy path
- module lookups now reuse cached `/modules` and request-scoped enriched registry rows before falling through to registry reads
- shell entry points can open modules from cached registry metadata without a manifest round trip
- bootstrap payloads now warm the manifest cache for later consumers on the same route

## Impact By Category

### Initial load speed

- improved by shared access boot and reduced forced cache bypass

### Route performance

- improved by removing N+1 card fetches and reducing duplicate access work

### Perceived speed

- improved by fewer request storms and fewer duplicated loading lifecycles

### Layout stability

- improved indirectly by removing duplicate guard/page loading cycles and dashboard error churn

### Bundle size

- no major new bundle-size work in this specific pass
- prior route splitting/icon work remains in place

### Caching correctness

- improved for access context, lookup label resolution, and bootstrap/manifest reuse
- improved for generic module row reuse and compiled manifest invalidation
- improved by adding direct server timing visibility for the remaining startup bottlenecks

### Maintainability / scalability

- improved by moving from per-consumer access boot to a shared provider
- improved by adding generic batched lookup support instead of module-specific hacks
- improved by persisting generic manifest metadata on installed modules instead of rebuilding it on cold registry reads

## Remaining Risks

- `/modules`, `/modules/:id/manifest`, and `/page/bootstrap` are still the biggest measured startup bottlenecks, even though they now do less duplicate work
- several route bundles are still sizeable
- direct fallback module routes and some shell consumers still depend on manifest route resolution in some places

## Next Recommendations

1. Profile server time inside `/modules`, `/modules/:id/manifest`, and `/page/bootstrap`.
2. Keep trimming direct fallback route and shell manifest reads where they are still required.
3. Continue bundle audit on the remaining largest chunks.

## When To Stop

Stop the generic platform performance pass once:
- first-hit `/modules` is below about `250ms`
- first-hit `/modules/:id/manifest` is below about `350ms`
- first-hit `/page/bootstrap` is below about `500ms` on common routes
- `Server-Timing` no longer shows obvious duplicate work
- remaining slowness is route-specific or data-specific rather than generic shell/bootstrap overhead
