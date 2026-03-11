perf:
	python -m unittest tests.test_perf_backend

sync-marketplace-v1:
	python3 scripts/bulk_sync_manifests.py --dir manifests/marketplace_v1 --validate-first --skip-equal

seed-marketplace-v1:
	python3 scripts/seed_dummy_data.py --v1-only --count 30 --mode append --continue-on-error

clear-marketplace-v1-records:
	python3 scripts/clear_v1_records.py --dry-run
