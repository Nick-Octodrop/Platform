# Caching Strategy Review

Date: 2026-04-10

## Current Cache Layers

### Frontend request cache

- File: [api.js](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/api.js)
- Behavior:
  - request cache + in-flight dedupe
  - workspace-scoped keys
  - route/bootstrap/records/modules/provider-status/etc. already cached with short TTLs

### Frontend manifest caches

- File: [api.js](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/api.js)
- Behavior:
  - manifest text, manifest hash, compiled manifest structures cached in memory
  - `/page/bootstrap` now seeds the same manifest cache so route entry can reuse bootstrap payloads

### Backend in-process caches

- File: [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
- Behavior:
  - module list cache
  - manifest/snapshot caches
  - enriched registry metadata cache
  - page bootstrap cache
  - aggregate/pivot/dashboard/source caches

## Current Issues Found

### 1. Access context was cached on the wire, but not reused as shared app state

- Problem:
  - network dedupe existed, but every consumer still spun its own loading/error lifecycle
- Fix applied:
  - shared `AccessContextProvider`
  - `GET /access/context` request policy
  - proper invalidation on member/profile/workspace mutations

### 2. Forced invalidation was bypassing useful module cache reuse

- Problem:
  - module store mount/workspace refresh used `force: true`
- Fix applied:
  - provider mount now respects cache and lets real invalidation own freshness

### 3. Lookup-card rendering lacked reusable label caching

- Problem:
  - label resolution degenerated into many single-record requests
- Fix applied:
  - introduced generic batched lookup label resolution path

### 4. Some server caches are correct but still hide slow first-hit work

- Problem:
  - first-hit `/modules`, `/manifest`, and `/page/bootstrap` remain slow enough to be user-visible
- Fix applied:
  - persisted generic manifest metadata on `modules_installed`
  - removed snapshot join from registry reads
  - lazy backfill for missing generic route metadata like `home_route`

### 5. Compiled manifest invalidation and unrestricted manifest reuse were incomplete

- Problem:
  - compiled manifest invalidation did not match the real cache key shape
  - unrestricted full-write actors were still paying the filtered-manifest deep-copy path
  - module lookups were not always reusing already-cached registry/module rows
- Fix applied:
  - corrected compiled cache invalidation to invalidate by `org_id + module_id`
  - short-circuited manifest filtering for truly unrestricted write actors
  - `_get_module(...)` now checks cached `/modules` and request-scoped enriched registry rows first

## Recommended Generic Caching Strategy

### Frontend

- Keep short workspace-scoped request cache for:
  - `/access/context`
  - `/modules`
  - `/modules/:id/manifest`
  - `/page/bootstrap`
  - `/records/:entity`
  - `/records/:entity/:id`
  - `/prefs/ui`
  - `/settings/provider-status`
- Reuse shared provider state for:
  - access context
  - module registry
  - UI prefs where appropriate
- Prefer in-flight dedupe + short TTL over long stale caches for record data

### Backend

- Keep fast in-process caches for:
  - filtered manifest/compiled manifest
  - page bootstrap
  - enriched module registry metadata and persisted installed-module metadata
  - dashboard/aggregate/pivot reads
  - interface/dashboard/document source registries
- Prefer returning already-cached unrestricted manifest variants directly when actor policy maps are empty
- Keep record-write invalidation broad enough to avoid stale analytics/bootstrap data

## Invalidation Considerations

### Safe to invalidate broadly

- record writes
- manifest/module installs and updates
- workspace switches
- action runs that can mutate arbitrary records

### Must explicitly invalidate

- `/access/context` on:
  - member changes
  - access profile changes
  - workspace membership/workspace deletion changes
- `/settings/provider-status` on:
  - provider secret writes/deletes

## Risks / Tradeoffs

### Short TTL caches

- Tradeoff:
  - extra requests on cold or long-lived sessions
- Benefit:
  - safer freshness across workspaces and admin changes

### In-process backend caches

- Tradeoff:
  - cache resets on deploy/restart
  - per-process rather than distributed
- Benefit:
  - simple and cheap for current architecture

### Broad invalidation on action/record mutations

- Tradeoff:
  - some caches are dropped more often than strictly necessary
- Benefit:
  - avoids stale manifests, stale dashboards, stale bootstrap payloads

## Recommended Next Caching Work

1. Use the new `Server-Timing` headers on `/modules`, `/modules/:id/manifest`, and `/page/bootstrap` to identify the next real server bottleneck.
2. Cache or precompute more route metadata if manifest fetches are still needed for navigation.
3. Consider a shared provider for UI prefs if repeated boot reads remain visible.
