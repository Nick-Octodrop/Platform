# Marketplace

Global reusable standard apps for client workspaces.

Contents:
- `calendar.json`
- `catalog.json`
- `contacts.json`
- `crm.json`
- `documents.json`
- `field_service.json`
- `jobs.json`
- `maintenance.json`
- `sales.json`
- `tasks.json`
- `variations.json`

Scripts:
- `python3 manifests/marketplace/install_all.py`
- `python3 manifests/marketplace/seed_dummy_examples.py`

Environment:
- `OCTO_BASE_URL`
- `OCTO_API_TOKEN`
- `OCTO_WORKSPACE_ID`

Use `--dry-run` on either script to preview the install order or seed plan.
