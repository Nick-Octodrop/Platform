from types import SimpleNamespace

from scripts import runtime_security_verify


def test_runtime_verifier_flags_superuser_and_bypassrls(monkeypatch):
    monkeypatch.setattr(
        runtime_security_verify,
        "_fetch_one",
        lambda conn, query, params=None: {"rolname": "postgres", "rolsuper": True, "rolbypassrls": True},
    )

    findings = runtime_security_verify.verify_runtime_role(object())

    assert {finding.code for finding in findings} == {"RUNTIME_ROLE_SUPERUSER", "RUNTIME_ROLE_BYPASSRLS"}


def test_runtime_verifier_flags_missing_public_table_policy(monkeypatch):
    monkeypatch.setattr(
        runtime_security_verify,
        "_table_state",
        lambda conn, tables: {
            table: {"row_security": True, "force_row_security": True}
            for table in tables
        },
    )
    monkeypatch.setattr(runtime_security_verify, "_policy_state", lambda conn, schema, tables: {})

    findings = runtime_security_verify.verify_public_rls(object())

    assert any(finding.code == "RLS_POLICY_MISSING" for finding in findings)


def test_runtime_verifier_flags_public_attachments_bucket(monkeypatch):
    def fake_fetch_one(conn, query, params=None):
        if "storage.objects" in query:
            return {"name": "storage.objects"}
        if "storage.buckets" in query:
            return {"name": "storage.buckets"}
        return {}

    monkeypatch.setattr(runtime_security_verify, "_fetch_one", fake_fetch_one)
    monkeypatch.setattr(
        runtime_security_verify,
        "_policy_state",
        lambda conn, schema, tables: {"objects": set(runtime_security_verify.STORAGE_POLICY_NAMES)},
    )
    monkeypatch.setattr(
        runtime_security_verify,
        "_fetch_all",
        lambda conn, query, params=None: [{"id": "attachments", "public": True}],
    )

    findings = runtime_security_verify.verify_storage(object())

    assert any(finding.code == "ATTACHMENTS_BUCKET_PUBLIC" for finding in findings)


def test_runtime_verifier_missing_database_url_returns_finding(monkeypatch):
    monkeypatch.delenv("SUPABASE_DB_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)

    findings = runtime_security_verify.run(
        SimpleNamespace(
            database_url=None,
            allow_missing_storage=False,
            allow_missing_tables=False,
        )
    )

    assert any(finding.code == "DATABASE_URL_MISSING" for finding in findings)
