# Octodrop Custom Modules

This folder is a clean workspace for custom Octodrop manifests that are not part of the built-in `manifests/` catalog.

Included here:

- `work_management/work_management.json`
- `work_management/automation_create_invoice_draft.json`
- `billing/billing.json`
- `billing/automation_generate_invoice_pdf.json`
- `billing/automation_email_invoice.json`
- `billing/invoice_template.html`
- `billing/invoice_template_payload.json`

Suggested install order:

1. Ensure the shared `contacts` module is already installed.
2. Import `work_management/work_management.json`.
3. Import `billing/billing.json`.
4. Create a document template in Octodrop using `billing/invoice_template_payload.json` or the companion HTML file.
5. Import `work_management/automation_create_invoice_draft.json`.
6. Import `billing/automation_generate_invoice_pdf.json` and replace `REPLACE_WITH_INVOICE_DOC_TEMPLATE_ID` with the real document template id.
7. Import `billing/automation_email_invoice.json` and make sure a default email connection is configured.

Important notes about this v1:

- This keeps the architecture to 2 custom modules: `work_management` and `billing`.
- It reuses shared `contacts` instead of duplicating client records.
- It does not introduce timer kernel infrastructure.
- It stays inside current manifest/runtime capabilities.
- Billing is now automation-first: users create draft invoices from Work Management, generate PDFs from Billing, and email invoices from Billing.

Current platform limits to be aware of:

- `duration_hours` and `amount` are included on time entries, but current pure-manifest v1 does not auto-calculate them.
- Rate fallback from task -> project -> entry is not automatic in pure manifests.
- Cross-module related lists are not currently available, so `work_management` cannot render billing invoices directly inside the project form without deeper platform work.
- The supplied invoice PDF template is a starter asset. Current document templates can render invoice record fields cleanly, but related invoice lines and rich linked-contact details still rely on the current runtime context shape.
- The email automation assumes the invoice PDF has already been generated with purpose `invoice_pdf`; the recommended user flow is `Create Draft Invoice` -> `Generate PDF` -> `Email Invoice`.

That means this workspace gives you a clean real foundation for Studio import now, while keeping the remaining gaps explicit instead of hiding them behind fake buttons.
