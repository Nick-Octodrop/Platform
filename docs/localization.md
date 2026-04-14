# Localisation

Octodrop now treats locale, timezone, and currency as separate concerns.

- Locale controls presentation: language, date/time formatting, number separators, and currency display style.
- Timezone controls how stored UTC datetimes are shown to the user.
- Currency controls the monetary unit. It does not come from locale.

## Resolution order

- Locale: `user.locale` -> `workspace.default_locale` -> `en-NZ`
- Timezone: `user.timezone` -> `workspace.default_timezone` -> `UTC`
- Currency for money fields:
  1. `currency_code`
  2. `currency_field`
  3. `currency_source: "workspace_default"`
  4. `workspace.default_currency`
  5. `NZD`

## Translation files

Translation assets live under [web/src/locales](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/web/src/locales).

- Add a new locale by creating a folder such as `web/src/locales/de-DE/`.
- Add namespace files such as `common.json`, `navigation.json`, `settings.json`, or module files like `contacts.json`.
- Keys are namespaced. Example: `common.save`, `settings.default_currency_label`, `contacts.fields.name`.

## Adding a translation key

1. Add the key to `web/src/locales/en-NZ/<namespace>.json`.
2. Add the translated value to other locale files such as `web/src/locales/fr-FR/<namespace>.json`.
3. Use `t("namespace.key")` in React or `translateRuntime("namespace.key")` in shared renderer helpers.

## Localising manifests

Manifest text remains backward compatible.

- If `label_key` exists, the translated value is used.
- If `label_key` is missing and `label` exists, the plain label is used as-is.
- The same fallback pattern applies to `help_text_key`, `description_key`, `placeholder_key`, `action_label_key`, `section_title_key`, `tab_label_key`, `menu_label_key`, and `status_label_key`.

Example field:

```json
{
  "id": "biz_contact.name",
  "type": "string",
  "label_key": "contacts.fields.name",
  "label": "Name"
}
```

Example action:

```json
{
  "id": "action.contact_new",
  "kind": "open_form",
  "action_label_key": "contacts.actions.new",
  "label": "New contact"
}
```

Example nav item:

```json
{
  "menu_label_key": "contacts.navigation.contacts",
  "label": "Contacts",
  "to": "page:biz_contact.list_page"
}
```

## Formatting helpers

Use the localisation provider hook in React:

```js
const { formatDate, formatDateTime, formatNumber, formatCurrency } = useI18n();
```

Rules:

- Use `formatDate`, `formatTime`, or `formatDateTime` for user-visible dates and times.
- Use `formatNumber` for counts, quantities, and decimals.
- Use `formatPercent` for percentages.
- Use `formatCurrency(value, currencyCode)` for money. Always pass the resolved currency code.

Do not hardcode date formats like `DD/MM/YYYY` or number separators like `1,234.56`.

## Currency vs locale

These are intentionally separate.

- `fr-FR` + `USD` means French presentation for a US dollar amount.
- `en-NZ` + `USD` means New Zealand English presentation for the same US dollar amount.
- The currency code remains `USD` in both cases.

## Fallback behavior

- Missing locale-specific translations fall back to `en-NZ`.
- Missing manifest translation keys fall back to the plain manifest string if provided.
- If no translation and no plain fallback exist, the key is left visible for debugging.

## Server-side preparation

Backend localisation helpers live in [app/localization.py](/mnt/c/Users/nicwi/Documents/My Projects/OCTO/app/localization.py).

Template render context now includes:

- `localization.locale`
- `localization.timezone`
- `localization.default_currency`
- `localization.messages`

That context is ready to be reused by future PDF, email, notification, export, and print rendering work.
