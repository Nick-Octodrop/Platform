# Marketplace v1 UAT Regression Matrix

## 1) Global Preflight

- Confirm workspace has at least 3 members (for `user/users` assignment tests).
- Install/enable modules in dependency order: `contacts`, `catalog`, `sales`, `crm`, `jobs`, `tasks`, `calendar`, `documents`, `field_service`, `maintenance`, `variations`.
- Verify each module opens with no `Record not found`, missing page/view, or missing entity errors.
- Verify each list page default filter resolves (no invalid `default_filter_id` behavior).
- Verify create modal uses sticky bottom-right `Save` + `Discard` controls.

## 2) Assignment UX (All user-facing modules)

Run for entities with `user`/`users` fields:
- [ ] single-user picker is searchable and stores user id.
- [ ] multi-user picker supports add/remove chips and stores array.
- [ ] list view renders member labels (not raw ids).
- [ ] `Mine` filter returns expected records for current user.
- [ ] `Mine` filter supports participant arrays where configured.

Entities:
- `entity.task`
- `entity.calendar_event`
- `entity.job`
- `entity.quote`
- `entity.opportunity`
- `entity.maintenance_request`
- `entity.site_visit`
- `entity.service_report`
- `entity.variation`
- `entity.document_record`
- `entity.contact`

## 3) Core Module Flows

### Contacts
- [ ] create person/company/customer
- [ ] owner assignment + `Mine` filter
- [ ] open record from list

### CRM
- [ ] create opportunity
- [ ] qualify action transitions `new -> qualified`
- [ ] create quote transform succeeds
- [ ] redirects to actual quote form record (not `/data/entity.*` debug page)

### Sales
- [ ] quote list default filter loads records (`open`)
- [ ] create quote with manual opportunity lookup
- [ ] approve quote -> create job transform
- [ ] redirect to created job record form works

### Jobs
- [ ] job create/edit with owner/assignee/participants
- [ ] line editor add/update/delete
- [ ] calendar/list filters consistent

### Tasks
- [ ] create task with assignee + participants
- [ ] kanban drag status transition works
- [ ] list + calendar default to `Mine`

### Calendar
- [ ] schedule page loads calendar mode cleanly
- [ ] list page uses same view mode shell (calendar/list)
- [ ] owner + participants + scope fields persist and filter correctly

### Field Service
- [ ] dispatch page view modes (calendar/kanban/list)
- [ ] visit status actions: planned -> en_route -> on_site -> completed
- [ ] report create/submit/approve
- [ ] `Mine` filters for technician/assignee

### Maintenance
- [ ] request create from requests page
- [ ] asset create/edit
- [ ] related maintenance requests on asset form load and create
- [ ] assignee `Mine` filter

### Variations
- [ ] create variation linked to job/quote/contact
- [ ] submit/approve/reject/cancel actions visibility and state gating
- [ ] `approved_by` only visible when approved
- [ ] `decision_date` visible for approved/rejected/cancelled

### Documents
- [ ] create document record
- [ ] owner assignment + `Mine`
- [ ] attachment preview/download behavior

## 4) Cross-Module Integrity

- [ ] lookup fields only show enabled target entities.
- [ ] lookup search works from form fields (no stale cache mismatches).
- [ ] transforms set link fields both directions (source->target, target->source).
- [ ] chatter/activity panels load without duplicate modal behavior.
- [ ] module disable/install respects dependency validation.

## 5) Automation + Notifications

- [ ] import templates from `AUTOMATION_TEMPLATES.md`.
- [ ] publish automations successfully.
- [ ] verify notification creation for assignee/participant workflows.
- [ ] verify notification `link_to` opens target record.
- [ ] verify mentions in activity continue to notify tagged users.

## 6) Release Gate

Ready for release when:
- [ ] zero manifest validation errors.
- [ ] all critical flows above pass once on clean workspace.
- [ ] no record routing defects in CRM->Sales->Jobs path.
- [ ] no duplicate modal confirmations.
- [ ] no unresolved lookup labels in key lists.

