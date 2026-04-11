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
- field types support conditions and expressions correctly.
- currency is modeled intentionally where money exists.
- quantity/UOM is modeled intentionally where measurable units exist.
- money fields use runtime currency formatting where users should see symbol-aware amounts.
- quantity, duration, and percent fields use runtime formatting where affixes improve comprehension.
- money summary cards use currency formatting instead of plain number rendering.
- quantity fields and their UOM are visible together where quantity meaning matters operationally.
- addresses are structured where location/autocomplete matters.
- enums, lookups, users, dates, and numbers are typed to support dynamic controls.
- context-sensitive lookups are filtered where the business logic requires it.
- dependent fields are modeled intentionally where parent selections affect downstream choices.

## D. UI Quality

- list view is usable without editing JSON.
- form sections are grouped sensibly.
- record header feels operational and clear.
- statusbar exists where appropriate.
- operational records have sensible header actions.
- one obvious next action exists for the current state.
- primary actions are obvious.
- secondary actions are not cluttering the main header.
- primary vs overflow actions are well prioritised.
- destructive/admin actions do not dominate the record header.
- disabled/hidden action rules are explicit.
- workflow actions only appear when valid.
- document/email/automation actions are present where expected for the record type.
- modal-based actions are used where confirmation or extra input is needed.
- helper text is present where confusion or validation risk exists.
- attachment UX is clear and named by purpose where appropriate.
- archive/duplicate behavior is considered where relevant.
- readonly-by-state behavior is intentional where lifecycle matters.
- required-by-state behavior is intentional where lifecycle matters.
- smart buttons / related counters are used intentionally where they improve navigation.
- related lists and line items are placed in tabs, not mixed into the main form body.
- true operational line items use the inline `line_editor` pattern rather than a generic related list.
- child contacts/addresses/other subordinate master-data are not incorrectly modeled as line items.
- embedded child lists use an inline-focused view that hides redundant parent columns where appropriate.
- view modes included are appropriate to the data shape.
- list/search/filter/group-by behavior is useful.
- dashboard/status cards are used only where justified and not sprayed across normal pages.
- breadcrumbs and titles resolve to human values.
- activity is enabled only where it adds real value.
- important actions/events are represented in activity where appropriate.
- activity is enabled for operational records.
- source-linking or source-import UX is traceable and coherent where used.

## E. Workflow Quality

- if status matters, a real workflow exists.
- workflow states and transitions are coherent.
- required fields by state are intentional.
- workflow actions/labels make sense in UI.
- status actions align to valid transitions.
- action visibility/enabled rules are intentional.
- source records are filtered by valid state/workflow/consumption status where relevant.

## F. Related Data

- related lists point to real entities/views.
- record domains use valid field refs.
- create defaults for related records are correct.
- transformations are explicit where business flow needs them.
- transformation needs are considered where record conversion is likely.
- changing a parent field clears or revalidates stale dependent values where required.
- key cross-record relationships are validated on save/action, not only in the picker UI.

## G. Dynamic Platform Features

- automation-relevant fields use correct types.
- enums, users, and lookups are authored so dynamic controls can work.
- schedulable/documentable/dashboardable interfaces are only enabled where appropriate.
- module design does not block likely future interoperability.
- selecting a source/parent record prefills related context where that behavior is expected.
- settings-based numbering is considered where the record needs a formal business number.
- UUIDs are not used as business-facing identifiers.
- context-aware filtering, prefill, and save validation work together rather than relying on UI alone.

## H. Test Flow

- module installs cleanly.
- app opens to the correct home route.
- list page loads.
- record opens from list.
- create new record works.
- save/edit works.
- key actions work.
- workflow transitions work.
- document/email/automation entry actions work where present.
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
