# Construction Suite v3

`construction_suite_v3` replaces the fragmented v2 construction prototype with one unified backend module for simpler demos and clearer navigation.

## What Changed

- Collapsed the v2 installable construction modules into a single `construction.json` manifest.
- Kept shared platform dependencies limited to `contacts` and `catalog`.
- Made Projects the centre of the backend flow.
- Kept dashboards inside the unified Construction module instead of splitting reporting into a separate app.
- Simplified the app navigation to:
  - Dashboard
  - Projects
  - Sites
  - Workers
  - Time Entries
  - Material Logs
  - Expenses / Costs
  - Daily Reports
  - Issues

## Design Intent

This version is deliberately less ERP-like than v2. It keeps the same core records and relationships, but presents them as one construction product instead of a bundle of separate domain apps.

The main demo goals are:

- easier navigation for Paul
- faster understanding in a demo video
- project-level visibility across labour, materials, and costs
- simple worker/mobile support without letting the backend become mobile-shaped

## Built-In Dashboards And Reports

Dashboards in v3 are implemented directly inside `construction.json` using normal views, actions, pages, and menu structure. They sit on top of the existing construction records rather than introducing a separate dashboard/reporting module.

### Operations Dashboard

The main top-level dashboard is the default landing screen for the Construction app.

It is designed to give Paul a quick operational view of:

- workers on site today
- labour hours
- material activity
- cost activity
- active projects
- open issues
- recent time, material, and daily report activity

### Project Dashboard

The Project form remains the manager's main screen. It now includes summary fields for:

- total hours
- labour cost
- material cost
- other costs
- total cost to date

These fields are included inside the Project form so project-level visibility stays part of the main management experience.

### Lightweight Report Pages

The unified module also includes simple report-style pages for:

- Time Entries Report
- Material Usage Report
- Project Cost Summary
- Daily Site Summary

These stay inside the same Construction module and reuse the same operational data model.

## Project-Centric Flow

Projects remain the core management record and connect the main operational data:

- site
- client
- supervisor
- workers / crew
- time entries
- material logs
- expenses / costs
- daily reports
- issues

The Project form is reshaped into a manager-facing screen with tabs for:

- Overview
- Workers / Crew
- Time Entries
- Materials
- Costs / Expenses
- Daily Reports
- Issues

## v1 Prototype Focus

v3 is intentionally focused on:

- worker check-in / check-out
- daily material entry
- simple labour / material / cost visibility
- project-level management
- clean dashboard storytelling

It intentionally does not centre the demo around:

- approvals
- complex budget workflows
- purchasing flows
- subcontract package control
- advanced finance structures

## Notes

- Some supporting records from v2, such as project tasks, assignments, budgets, requests, and receipts, are still preserved in the unified manifest even if they are no longer promoted in the main left navigation.
- The backend stays honest to the current manifest/page capabilities. v3 simplifies and centralises the experience without pretending to be a fully embedded ERP workspace.
- Dashboard is the default landing screen for the Construction app so Paul immediately sees activity, labour, materials, and costs when opening the backend.
