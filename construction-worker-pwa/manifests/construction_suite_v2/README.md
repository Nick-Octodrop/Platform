Construction Suite v2

This folder contains a construction suite structured the way an Odoo implementer would usually shape it:

- split master data from transactions
- keep field capture simple
- let managers work from approvals, dashboards, and cost control
- reuse shared platform modules instead of duplicating masters

Use shared platform modules
- `contacts`
  - clients
  - suppliers
  - subcontractors
- `catalog`
  - materials
  - stocked items
  - standard consumables

Recommended install order
1. `contacts`
2. `catalog`
3. `construction_core.json`
4. `construction_projects.json`
5. `construction_workforce.json`
6. `construction_site_ops.json`
7. `construction_material_control.json`
8. `construction_cost_control.json`

Module design
- `construction_core`
  - sites
  - crews
  - cost codes
  - shared operational masters
- `construction_projects`
  - jobs / projects
  - work items / phases / packages
  - project-level planning and ownership
- `construction_workforce`
  - workers
  - portal linkage
  - time entries
  - labor approval flow
- `construction_site_ops`
  - daily reports
  - field issues
  - delays / defects / safety
- `construction_material_control`
  - material requests
  - receipts
  - daily usage logs
  - site-level material accountability
- `construction_cost_control`
  - budget lines
  - expense lines
  - posted actuals against projects and cost codes

PWA integration targets
- worker authentication
  - `entity.construction_worker`
  - linked by `construction_worker.portal_user_id`
- project selection
  - `entity.construction_project`
- clock in / out
  - `entity.time_entry`
- daily material usage
  - `entity.material_log`

Why this structure
- It follows the same broad split Odoo teams use:
  - masters
  - project execution
  - workforce transactions
  - site operations
  - material flow
  - financial control
- It avoids turning the worker app into the ERP.
- It leaves room for later additions:
  - purchase approvals
  - subcontract tracking
  - invoice integration
  - payroll export
  - richer project profitability dashboards

Recommended v1 operating model
- Workers use only the PWA.
- Supervisors use:
  - time approvals
  - material approvals
  - daily reports
  - issues
- Managers use:
  - projects
  - budgets
  - expenses
  - dashboards

Suggested future add-ons
- subcontractor package control
- equipment logs
- variation orders
- client progress claims
- retention / defect liability tracking
