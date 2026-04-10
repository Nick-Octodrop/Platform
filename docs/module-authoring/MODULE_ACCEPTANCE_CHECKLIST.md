# Module Acceptance Checklist

Use this before calling a module "done".

Mark each item `yes` or `no`.

## A. Contract Validity

- `manifest_version` is set and valid.
- `module.id`, `module.key`, `module.name`, `module.version` are present.
- only supported top-level keys are used.
- all view/page/action targets resolve.
- all field ids referenced by views/actions/workflows exist.
- the manifest validates cleanly.

## B. App Structure

- `app.home` exists and resolves.
- the module has explicit nav.
- main entities have `entity_home_page` and `entity_form_page`.
- list and form pages exist for each main entity.

## C. Entity Quality

- every main entity has a proper `display_field`.
- no user-facing title falls back to a UUID.
- field types are correct, not guessed.
- lookups define `entity`.
- lookups define `display_field` where useful.
- enum fields define options.
- user/user fields use `user` or `users`, not plain strings.

## D. UI Quality

- list view is usable without editing JSON.
- form sections are grouped sensibly.
- primary actions are obvious.
- disabled/hidden action rules are explicit.
- breadcrumbs and titles resolve to human values.
- activity is enabled only where it adds real value.

## E. Workflow Quality

- if status matters, a real workflow exists.
- workflow states and transitions are coherent.
- required fields by state are intentional.
- workflow actions/labels make sense in UI.

## F. Related Data

- related lists point to real entities/views.
- record domains use valid field refs.
- create defaults for related records are correct.
- transformations are explicit where business flow needs them.

## G. Dynamic Platform Features

- automation-relevant fields use correct types.
- enums, users, and lookups are authored so dynamic controls can work.
- schedulable/documentable/dashboardable interfaces are only enabled where appropriate.

## H. Test Flow

- module installs cleanly.
- app opens to the correct home route.
- list page loads.
- record opens from list.
- create new record works.
- save/edit works.
- key actions work.
- workflow transitions work.
- activity/comments/attachments work where enabled.

## I. Anti-Pattern Checks

- no workspace-specific hardcoded values in canonical module content.
- no missing pages with hidden shell inference.
- no action ids without matching action definitions.
- no fake workflow on a decorative enum.
- no random unsupported manifest keys.

## J. Release Readiness

- example/seed records are realistic.
- labels are client-safe.
- nav names are correct.
- obvious empty states are acceptable.
- module is understandable without a walkthrough.
