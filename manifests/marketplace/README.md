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
- `octo_ai.json`
- `outreach.json`
- `sales.json`
- `shop_finance.json`
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



export OCTO_BASE_URL="https://octodrop-platform-api.fly.dev"
export OCTO_API_TOKEN="<paste a short-lived local token; never commit real tokens>"
export OCTO_WORKSPACE_ID="1c346031-9227-4d58-b4c2-625d111bdb41"
python3 manifests/marketplace/install_all.py


$env:OCTO_BASE_URL="https://octodrop-platform-api.fly.dev"
$env:OCTO_API_TOKEN=""


python manifests/commercial_v2/install_all.py
python manifests/commercial_v2/cleanup_removed_modules.py
python manifests/commercial_v2/setup_document_numbering.py
python manifests/commercial_v2/seed_dummy_examples.py
python manifests/commercial_v2/setup_access_profiles.py --skip-assignments

python manifests/commercial_v2/clear_workspace_data.py --include-settings


