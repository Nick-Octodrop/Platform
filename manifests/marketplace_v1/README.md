# Marketplace v1 Manifests

This folder contains Studio-installable v1 manifests for reusable marketplace-style modules.

Principles used:
- Stable manifest keys only.
- No workspace-specific IDs.
- No hardcoded DB/workspace IDs.
- Contract-compatible with `manifest_version: "1.3"`.

Core business modules:
- `contacts.json`
- `crm.json`
- `sales.json`
- `jobs.json`
- `tasks.json`
- `field_service.json`
- `maintenance.json`
- `variations.json`

System utility modules:
- `calendar.json`
- `documents.json`

Layout standard:
- `LAYOUT_STYLE_GUIDE.md`

Import flow:
1. Open Studio.
2. Create/import module manifest.
3. Paste JSON from one of the files in this folder.
4. Publish/install.

Bulk sync flow (recommended):
1. Start backend locally.
2. Run:

```bash
python3 scripts/bulk_sync_manifests.py \
  --dir manifests/marketplace_v1 \
  --validate-first \
  --skip-equal
```

The sync tool resolves by `module.key` to existing installed modules, so legacy IDs
like `module_xxxxxx` are upgraded in place instead of creating duplicates.
If needed, force specific targets:

```bash
python3 scripts/bulk_sync_manifests.py \
  --dir manifests/marketplace_v1 \
  --target-map contacts=module_27052f,sales=module_326524 \
  --validate-first --skip-equal
```

If you already have duplicate installed modules with the same `module.key`,
the sync tool now stops with an ambiguity error. Resolve once by either:
- deleting/archiving the duplicate modules you do not want, or
- running with `--target-map` to pin each key to the module ID to keep.

Optional auth/workspace flags:
- `--token <jwt>` (or env `OCTO_API_TOKEN`)
- `--workspace-id <workspace_id>` (or env `OCTO_WORKSPACE_ID`)

Useful options:
- `--dry-run` (print dependency order only)
- `--only sales,crm,jobs` (partial sync)
- `--continue-on-error` (keep syncing other modules)

Dummy data seeding:

```bash
python3 scripts/seed_dummy_data.py \
  --base-url http://localhost:8000 \
  --v1-only \
  --count 30 \
  --mode append \
  --continue-on-error
```

Optional flags:
- `--modules contacts,crm,sales` (seed subset)
- `--mode fill` (top up each entity to `--count`)
- `--dry-run` (show plan only)
- `--user-ids <id1,id2,...>` (assign specific users)

Clear all current v1 records:

```bash
python3 scripts/clear_v1_records.py \
  --base-url http://localhost:8000 \
  --dry-run
```

Then run without `--dry-run` to delete.
