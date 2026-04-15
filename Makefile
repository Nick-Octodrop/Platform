perf:
	python -m unittest tests.test_perf_backend

security:
	python3 scripts/security_check.py

security-strict:
	python3 scripts/security_check.py --strict

security-runtime:
	python3 scripts/runtime_security_verify.py

sync-marketplace:
	python3 scripts/bulk_sync_manifests.py --dir manifests/marketplace --validate-first --skip-equal

sync-marketplace-v1:
	python3 scripts/bulk_sync_manifests.py --dir manifests/marketplace --validate-first --skip-equal

seed-marketplace:
	python3 scripts/seed_dummy_data.py --v1-only --count 30 --mode append --continue-on-error

seed-marketplace-v1:
	python3 scripts/seed_dummy_data.py --v1-only --count 30 --mode append --continue-on-error

clear-marketplace-records:
	python3 scripts/clear_v1_records.py --dry-run

clear-marketplace-v1-records:
	python3 scripts/clear_v1_records.py --dry-run
