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

## 5) Style/Branding Requirements (Octodrop)

- Brand color: `#e97026`
- Keep output professional, clean, readable in print/PDF
- Use inline styles only (email/PDF-safe)
- Avoid external CSS/JS

### Logo usage

Preferred:
- `workspace.logo_url` (if available in render context)

Fallback (current Octodrop logo):
- `https://ippalsmyourhiqihvqmf.supabase.co/storage/v1/object/public/branding/1c346031-9227-4d58-b4c2-625d111bdb41/35ce088789faee626b7766b65445c9ab11912799b674917e757a636f97675d70_Octodrop-Horizontal-RGB-medium-orange-png.png`

Safe logo snippet:

```jinja
{% set logo_url =
  (workspace.logo_url if workspace is defined and workspace and workspace.logo_url is defined and workspace.logo_url else
  'https://ippalsmyourhiqihvqmf.supabase.co/storage/v1/object/public/branding/1c346031-9227-4d58-b4c2-625d111bdb41/35ce088789faee626b7766b65445c9ab11912799b674917e757a636f97675d70_Octodrop-Horizontal-RGB-medium-orange-png.png')
%}
<img src="{{ logo_url }}" alt="Octodrop" style="height:34px; width:auto;" />
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
- Brand color is #e97026 (Octodrop).
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
- Header/footer render correctly on multipage output
- Filename pattern returns non-empty value
- No unsupported filters/functions
