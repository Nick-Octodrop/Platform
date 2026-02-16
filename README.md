OCTO kernel slice #1: canonical JSON + manifest hash.

Run tests:
- `python3 -m venv .venv && source .venv/bin/activate`
- `pip install -r app/requirements.txt`
- `python3 -m unittest`
- Windows (PowerShell): `py -3 -m venv .venv; .\\.venv\\Scripts\\activate; pip install -r app\\requirements.txt; py -3 -m unittest`
- Frontend (optional): `cd web && npm test` (requires Node.js)

Manifest docs + examples:
- `MANIFEST_CONTRACT.md` (authoring contract)
- `manifests/request_lab.json` (Odoo-style example)

Dev reset (wipes all modules + data):
- `scripts/reset_modules.sql`

DB migrations (including chatter table) live in `app/migrations` — see `README_PRODUCT.md` for the full ordered list.
