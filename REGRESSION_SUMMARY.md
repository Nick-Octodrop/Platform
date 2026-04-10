# Regression Summary

Date: 2026-04-10

## Likely Causes Of Recent Slowdown

The slowdown appears to be both frontend and backend.

### Frontend

- repeated access-context boot across guards/pages/components
- forced cache bypass in module store refresh
- N+1 lookup-label fetch pattern in card/calendar rendering
- route flows depending on manifest fetches before navigation

### Backend

- slow first-hit `/modules`, `/modules/:id/manifest`, and `/page/bootstrap`
- registry reads still depended too heavily on manifest/snapshot metadata decoration
- compiled manifest invalidation was not aligned with the real cache key shape
- unrestricted full-write users were still paying the filtered-manifest hot path
- brittle dashboard SQL fast path causing intermittent `500`s
- record lookup endpoints being hammered by the N+1 client path

## Most Suspicious Recent Areas

### `92a7da1 loading1`

- touched:
  - [App.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/App.jsx)
  - [AppShell.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/apps/AppShell.jsx)
  - [appShellUtils.js](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/apps/appShellUtils.js)
  - [HomePage.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/pages/HomePage.jsx)
  - [AppsPage.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/pages/AppsPage.jsx)
- Why suspicious:
  - route/loading behavior changes often introduce extra preloading, double spinners, or duplicate boot work

### `eb65df7 big-sql-performance1`

- touched both backend and many frontend shell/runtime files
- Why suspicious:
  - large cross-cutting perf changes are a common source of regressions when fast paths fail or invalidation is incomplete

### `ac1cd8b ui12`

- touched:
  - [main.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/main.py)
  - [AppShell.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/apps/AppShell.jsx)
  - [FormViewRenderer.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/ui/FormViewRenderer.jsx)
  - [styles.css](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/styles.css)
- Why suspicious:
  - shell and field rendering changes can easily create layout shift and perceived slowness

## Confirmed Issues Fixed In This Pass

### Frontend

- duplicated access bootstrap lifecycle
- incomplete access-context invalidation
- forced module-cache bypass on provider mount
- N+1 lookup label fetching in cards/calendar

### Backend

- dashboard SQL fast path returning `500` instead of falling back
- missing generic batched record lookup support for view rendering
- installed-module metadata not being persisted generically enough for fast registry reads
- compiled manifest invalidation not matching compiled cache keys
- module hot paths underusing already-cached module rows and unrestricted manifest variants

## Current Classification

- Frontend: Yes
- Backend: Yes
- Both together: Yes

The app’s recent slowness is not one single bug. It is the compound effect of:
- slower server bootstrap endpoints
- duplicate shell boot work
- cache invalidation gaps
- N+1 client fetch patterns
