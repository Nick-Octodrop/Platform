import time

from app.stores import MemoryGenericRecordStore
from app.webhook_signing import build_webhook_signature_headers, verify_webhook_signature
from scripts import security_check


def test_security_check_flags_committed_jwt(tmp_path, monkeypatch):
    monkeypatch.setattr(security_check, "ROOT", tmp_path)
    fixture = tmp_path / "README.md"
    fixture.write_text(
        'OCTO_API_TOKEN="eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.'
        'eyJzdWIiOiJ1c2VyIiwiaWF0IjoxNzAwMDAwMDAwfQ.'
        'abcdefghijklmnopqrstuvwxyz1234567890"\n',
        encoding="utf-8",
    )

    findings = security_check.scan_secrets(paths=[fixture])

    assert any(finding.code == "SECRET_IN_REPOSITORY" for finding in findings)


def test_security_check_allows_placeholder_token(tmp_path, monkeypatch):
    monkeypatch.setattr(security_check, "ROOT", tmp_path)
    fixture = tmp_path / "README.md"
    fixture.write_text(
        'export OCTO_API_TOKEN="<paste a short-lived local token; never commit real tokens>"\n',
        encoding="utf-8",
    )

    assert security_check.scan_secrets(paths=[fixture]) == []


def test_security_check_strict_flags_missing_tenant_owner_column(tmp_path, monkeypatch):
    monkeypatch.setattr(security_check, "ROOT", tmp_path)
    migrations = tmp_path / "app" / "migrations"
    migrations.mkdir(parents=True)
    (migrations / "001.sql").write_text(
        "create table if not exists records_generic (entity_id text not null, id text primary key);\n",
        encoding="utf-8",
    )

    findings = security_check.scan_tenant_ownership()

    assert any(finding.code == "TENANT_OWNERSHIP_FIELD_MISSING" for finding in findings)


def test_security_check_flags_missing_storage_policy_coverage(tmp_path, monkeypatch):
    monkeypatch.setattr(security_check, "ROOT", tmp_path)
    migrations = tmp_path / "app" / "migrations"
    migrations.mkdir(parents=True)
    (migrations / "001.sql").write_text("alter table storage.objects enable row level security;\n", encoding="utf-8")

    findings = security_check.scan_storage_policies()

    assert any(finding.code == "STORAGE_POLICY_COVERAGE_MISSING" for finding in findings)


def test_memory_generic_record_store_is_tenant_scoped():
    store = MemoryGenericRecordStore()
    tenant_a_record = store.create("entity.invoice", {"id": "inv-1", "amount": 100}, tenant_id="tenant-a")
    store.create("entity.invoice", {"id": "inv-1", "amount": 900}, tenant_id="tenant-b")

    assert tenant_a_record["amount"] == 100
    assert store.get("entity.invoice", "inv-1", tenant_id="tenant-a")["amount"] == 100
    assert store.get("entity.invoice", "inv-1", tenant_id="tenant-b")["amount"] == 900


def test_webhook_signature_accepts_fresh_timestamped_signature():
    payload = b'{"event":"invoice.paid"}'
    headers = build_webhook_signature_headers(payload, "secret", timestamp=str(int(time.time())))

    ok, reason = verify_webhook_signature(
        payload,
        "secret",
        headers["X-Octo-Signature"],
        provided_timestamp=headers["X-Octo-Timestamp"],
        allow_legacy_payload_only=False,
    )

    assert ok is True
    assert reason is None


def test_webhook_signature_rejects_missing_timestamp_when_required():
    payload = b'{"event":"invoice.paid"}'
    headers = build_webhook_signature_headers(payload, "secret")

    ok, reason = verify_webhook_signature(
        payload,
        "secret",
        headers["X-Octo-Signature"],
        provided_timestamp=None,
        allow_legacy_payload_only=False,
    )

    assert ok is False
    assert reason == "Missing webhook timestamp"


def test_webhook_signature_rejects_expired_timestamp():
    payload = b'{"event":"invoice.paid"}'
    old_timestamp = str(int(time.time()) - 10_000)
    headers = build_webhook_signature_headers(payload, "secret", timestamp=old_timestamp)

    ok, reason = verify_webhook_signature(
        payload,
        "secret",
        headers["X-Octo-Signature"],
        provided_timestamp=old_timestamp,
        tolerance_seconds=300,
        allow_legacy_payload_only=False,
    )

    assert ok is False
    assert reason == "Webhook timestamp expired"
