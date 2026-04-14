# Paul Construction

Current construction operations pack.

Contents:
- `catalog.json`
- `contacts.json`
- `construction.json`

Scripts:
- `python3 manifests/paul_construction/install_all.py`
- `python3 manifests/paul_construction/seed_dummy_examples.py`

Environment:
- `OCTO_BASE_URL`
- `OCTO_API_TOKEN`
- `OCTO_WORKSPACE_ID`

Notes:
- `catalog.json` now provides the local `catalog` dependency for Paul Construction.
- `contacts.json` now provides the local `contacts` dependency for Paul Construction.
- Use `item.material_type` on catalog items so the construction PWA can write `material_log.material_type` without guessing from item names.
- `contact.address_line_1` and `construction_site.address` use the shared Google Places autocomplete flow when the workspace has a Google Maps key configured.
- Google Places selections now populate `latitude` and `longitude`, which the construction site geofence already uses for nearby clock-in checks.
