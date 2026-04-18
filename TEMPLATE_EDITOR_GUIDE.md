# Template Editor Guide (OCTO)

This document explains how OCTO templates are structured so you can ask any AI to generate valid templates.

## 1) Template Types

## Document templates
- Main HTML/Jinja body field: `html`
- Optional repeating header field: `header_html`
- Optional repeating footer field: `footer_html`
- Filename pattern field: `filename_pattern`
- Layout fields: `paper_size`, `margin_top`, `margin_right`, `margin_bottom`, `margin_left`

## Email templates
- Subject field: `subject`
- Main HTML/Jinja field: `body_html`
- Optional text fallback field: `body_text`

---

## 2) Runtime Data Available to Jinja

Primary object:
- `record` (entity record selected in template sample/preview)

Depending on route/runtime, other objects may or may not exist. Do **not** assume they exist unless tested.

Common helper objects:
- `formatted`
- `formatted_nested`
- `lines`
- `line_items`
- `formatted_line_items`

Branding objects commonly available:
- `workspace`
- `company`
- `branding`

Common branding fields:
- `workspace.name`
- `workspace.logo_url`
- `workspace.colors.primary`
- `workspace.colors.secondary`
- `workspace.colors.accent`
- `branding.primary_color`
- `branding.secondary_color`
- `branding.accent_color`

For entities with child rows such as invoices and purchase orders, OCTO may also provide:
- `lines`
- `line_items`
- `formatted_line_items`

These are the preferred collections for repeating tables. Do not guess `record['lines']` unless the preview context actually includes it.

Safe access pattern:

```jinja
{{ record['workorder.number'] if record is defined and record and record['workorder.number'] is defined and record['workorder.number'] else '' }}
```

---

## 3) Important Rendering Rules

1. Header/body/footer are rendered separately for document templates.  
   Variables set in body are not automatically shared with header/footer.

2. Do not rely on unavailable Jinja filters/functions (example: `strftime` is not available in this environment).

3. Validation warnings like `Undefined: record` mean your template references variables directly without safety checks.

4. Prefer direct safe expressions over chained assumptions.

5. Use the selected entity’s real field ids. If the template is for `entity.te_purchase_order`, prefer ids like `te_purchase_order.po_number`, not invented aliases like `po_number` unless the preview confirms they exist.

6. For line item tables, prefer the provided helper collections:
   - `lines`
   - `line_items`
   - `formatted_line_items`

---

## 4) Document Template Recommended Structure

Provide these 4 outputs when asking AI for a document template:

1. `filename_pattern` (single Jinja line)
2. `header_html` (Jinja + HTML)
3. `footer_html` (Jinja + HTML)
4. `html` (main body Jinja + HTML)

Optional:
5. recommended margins/paper size

---

## 5) Style/Branding Requirements

- Prefer workspace branding from render context when available
- Keep output professional, clean, readable in print/PDF
- Use inline styles only (email/PDF-safe)
- Avoid external CSS/JS
- Default to strong design quality without extra prompting: clear masthead, good spacing, readable hierarchy, disciplined tables, and realistic production copy

### Logo usage

Preferred:
- `workspace.logo_url` (if available in render context)

Safe logo snippet:

```jinja
{% set logo_url = workspace.logo_url if workspace is defined and workspace and workspace.logo_url is defined and workspace.logo_url else '' %}
{% if logo_url %}
  <img src="{{ logo_url }}" alt="{{ workspace.name if workspace is defined and workspace and workspace.name is defined and workspace.name else 'Company' }}" style="height:34px; width:auto;" />
{% endif %}
```

Safe primary color snippet:

```jinja
{% set brand_primary =
  (branding.primary_color if branding is defined and branding and branding.primary_color is defined and branding.primary_color else
  (workspace.colors.primary if workspace is defined and workspace and workspace.colors is defined and workspace.colors and workspace.colors.primary is defined and workspace.colors.primary else '#1f2937'))
%}
```

---

## 6) Work Order Field Reference (from manifest)

Useful fields:
- `workorder.number`
- `workorder.title`
- `workorder.status`
- `workorder.priority`
- `workorder.type`
- `workorder.contact_id`
- `workorder.assignee_id`
- `workorder.scheduled_start`
- `workorder.scheduled_end`
- `workorder.completed_at`
- `workorder.qc_notes`
- `workorder.site_name`
- `workorder.site_address`
- `workorder.city`
- `workorder.country`
- `workorder.labor_hours`
- `workorder.materials_cost`
- `workorder.total_cost`
- `workorder.description`
- `workorder.internal_notes`

---

## 7) AI Prompt Contract (copy/paste)

Use this prompt with other AIs:

```text
Create an OCTO [document/email] template using Jinja.

Constraints:
- Use safe Jinja access checks (`is defined` style) for record fields.
- Do not use unsupported filters like strftime.
- For document templates, output 4 separate sections:
  1) filename_pattern
  2) header_html
  3) footer_html
  4) body_html
- Use workspace branding from `workspace`, `company`, and `branding` when available.
- Keep layout professional and print-friendly.
- Use only inline styles.

Entity fields available:
[paste relevant field ids]
```

---

## 8) Common Failure Patterns

- `No filter named 'strftime'`  
  -> remove filter usage.

- `Undefined: record`  
  -> wrap all record references in safe checks.

- `Undefined: some_variable` in header/footer  
  -> define that variable in that section or inline the expression directly.

---

## 9) Quick QA Checklist

Before saving:
- Template validates with zero compile errors
- Preview renders for a real sample record
- Repeating tables use real helper collections or confirmed entity fields
- Header/footer render correctly on multipage output
- Filename pattern returns non-empty value
- No unsupported filters/functions
