UI Rules (v1.3)

- Views are flat; do not nest views inside views.
- Containers define surfaces; use container/toolbar/statusbar/record blocks for composition.
- Page content must be valid block DSL for v1.3.
- Use stable ids; avoid renaming unless requested.
- Prefer minimal, incremental changes.

Layout baseline (required unless user asks otherwise):
- Provide `list_page` and `form_page` for each primary entity.
- Use page headers with `variant: none` by default.
- Wrap major content in `container` cards.
- Use form page `grid` with 12 columns: form card (`span: 8`) + activity card (`span: 4`).
- Keep chatter/activity in a separate right-side card, not mixed inside form card.
- Nav targets must always be `page:<id>`.
