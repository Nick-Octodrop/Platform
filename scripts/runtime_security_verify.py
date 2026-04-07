#!/usr/bin/env python3
"""Verify deployed database/storage tenant-isolation controls.

This script is intentionally read-only. It checks the live database state after
RLS migrations have been applied; it does not infer safety from migration files.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor

from scripts.security_check import TENANT_OWNED_TABLES


TENANT_POLICY_NAMES = {
    "octo_tenant_select",
    "octo_tenant_insert",
    "octo_tenant_update",
    "octo_tenant_delete",
}

SPECIAL_PUBLIC_POLICIES: dict[str, set[str]] = {
    "workspaces": {
        "octo_workspaces_select",
        "octo_workspaces_insert",
        "octo_workspaces_update",
        "octo_workspaces_delete",
    },
    "workspace_members": {
        "octo_workspace_members_select",
        "octo_workspace_members_insert",
        "octo_workspace_members_update",
        "octo_workspace_members_delete",
    },
    "orgs": {
        "octo_orgs_select",
        "octo_orgs_insert",
        "octo_orgs_update",
        "octo_orgs_delete",
    },
    "user_platform_roles": {
        "octo_user_platform_roles_select",
        "octo_user_platform_roles_write",
    },
    "marketplace_apps": {
        "octo_marketplace_apps_select",
        "octo_marketplace_apps_insert",
        "octo_marketplace_apps_update",
        "octo_marketplace_apps_delete",
    },
    "integration_providers": {
        "octo_integration_providers_select",
        "octo_integration_providers_write",
    },
    "module_icons": {
        "octo_module_icons_read",
        "octo_module_icons_write",
    },
}

STORAGE_POLICY_NAMES = {
    "octo_attachments_storage_select",
    "octo_attachments_storage_insert",
    "octo_attachments_storage_update",
    "octo_attachments_storage_delete",
    "octo_branding_storage_select",
    "octo_branding_storage_insert",
    "octo_branding_storage_update",
    "octo_branding_storage_delete",
}

FORCE_RLS_EXEMPT_TABLES = {"integration_providers", "module_icons"}


@dataclass
class RuntimeFinding:
    severity: str
    code: str
    message: str
    component: str | None = None

    def render(self) -> str:
        component = f" {self.component}" if self.component else ""
        return f"[{self.severity}] {self.code}{component} - {self.message}"


def _fetch_all(conn, query: str, params: list[Any] | None = None) -> list[dict]:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(query, params or [])
        return [dict(row) for row in cur.fetchall()]


def _fetch_one(conn, query: str, params: list[Any] | None = None) -> dict | None:
    rows = _fetch_all(conn, query, params)
    return rows[0] if rows else None


def _table_state(conn, table_names: set[str]) -> dict[str, dict]:
    if not table_names:
        return {}
    rows = _fetch_all(
        conn,
        """
        select
          c.relname as table_name,
          c.relrowsecurity as row_security,
          c.relforcerowsecurity as force_row_security
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
          and c.relname = any(%s)
        """,
        [list(sorted(table_names))],
    )
    return {str(row["table_name"]): row for row in rows}


def _policy_state(conn, schema: str, table_names: set[str]) -> dict[str, set[str]]:
    if not table_names:
        return {}
    rows = _fetch_all(
        conn,
        """
        select tablename, policyname
        from pg_policies
        where schemaname = %s and tablename = any(%s)
        """,
        [schema, list(sorted(table_names))],
    )
    policies: dict[str, set[str]] = {}
    for row in rows:
        policies.setdefault(str(row["tablename"]), set()).add(str(row["policyname"]))
    return policies


def verify_runtime_role(conn) -> list[RuntimeFinding]:
    row = _fetch_one(
        conn,
        """
        select r.rolname, r.rolsuper, r.rolbypassrls
        from pg_roles r
        where r.rolname = current_user
        """,
    )
    if not row:
        return [RuntimeFinding("HIGH", "RUNTIME_ROLE_UNKNOWN", "Could not inspect current database role.", "database")]
    findings: list[RuntimeFinding] = []
    if row.get("rolsuper"):
        findings.append(RuntimeFinding("CRITICAL", "RUNTIME_ROLE_SUPERUSER", "Runtime DB role is SUPERUSER and bypasses RLS.", str(row.get("rolname"))))
    if row.get("rolbypassrls"):
        findings.append(RuntimeFinding("CRITICAL", "RUNTIME_ROLE_BYPASSRLS", "Runtime DB role has BYPASSRLS and bypasses RLS.", str(row.get("rolname"))))
    return findings


def verify_public_rls(conn, *, allow_missing_tables: bool = False) -> list[RuntimeFinding]:
    tenant_tables = set(TENANT_OWNED_TABLES)
    all_tables = tenant_tables | set(SPECIAL_PUBLIC_POLICIES)
    table_state = _table_state(conn, all_tables)
    policies = _policy_state(conn, "public", all_tables)
    findings: list[RuntimeFinding] = []

    for table in sorted(all_tables):
        if table not in table_state:
            if not allow_missing_tables:
                findings.append(RuntimeFinding("HIGH", "EXPECTED_TABLE_MISSING", "Expected tenant/security table does not exist.", table))
            continue
        state = table_state[table]
        if not state.get("row_security"):
            findings.append(RuntimeFinding("HIGH", "RLS_DISABLED", "Row Level Security is not enabled.", table))
        if table not in FORCE_RLS_EXEMPT_TABLES and not state.get("force_row_security"):
            findings.append(RuntimeFinding("MEDIUM", "FORCE_RLS_DISABLED", "FORCE ROW LEVEL SECURITY is not enabled.", table))
        expected = SPECIAL_PUBLIC_POLICIES.get(table) or TENANT_POLICY_NAMES
        missing = expected - policies.get(table, set())
        if missing:
            findings.append(RuntimeFinding("HIGH", "RLS_POLICY_MISSING", f"Missing policies: {', '.join(sorted(missing))}.", table))
    return findings


def verify_storage(conn, *, allow_missing_storage: bool = False) -> list[RuntimeFinding]:
    has_storage = _fetch_one(conn, "select to_regclass('storage.objects')::text as name")
    if not has_storage or not has_storage.get("name"):
        if allow_missing_storage:
            return []
        return [RuntimeFinding("HIGH", "STORAGE_OBJECTS_MISSING", "storage.objects was not found.", "storage.objects")]

    policies = _policy_state(conn, "storage", {"objects"}).get("objects", set())
    missing = STORAGE_POLICY_NAMES - policies
    findings: list[RuntimeFinding] = []
    if missing:
        findings.append(RuntimeFinding("HIGH", "STORAGE_POLICY_MISSING", f"Missing policies: {', '.join(sorted(missing))}.", "storage.objects"))

    bucket_table = _fetch_one(conn, "select to_regclass('storage.buckets')::text as name")
    if bucket_table and bucket_table.get("name"):
        buckets = {
            str(row["id"]): row
            for row in _fetch_all(conn, "select id, public from storage.buckets where id = any(%s)", [["attachments", "branding"]])
        }
        attachment_bucket = buckets.get("attachments")
        if not attachment_bucket:
            findings.append(RuntimeFinding("HIGH", "ATTACHMENTS_BUCKET_MISSING", "attachments bucket was not found.", "storage.buckets"))
        elif attachment_bucket.get("public"):
            findings.append(RuntimeFinding("CRITICAL", "ATTACHMENTS_BUCKET_PUBLIC", "attachments bucket is public.", "storage.buckets"))
    return findings


def verify_helper_functions(conn) -> list[RuntimeFinding]:
    expected = [
        "octo_security.current_org_id()",
        "octo_security.current_user_id()",
        "octo_security.is_internal_service()",
        "octo_security.path_workspace_id(text)",
    ]
    findings: list[RuntimeFinding] = []
    for signature in expected:
        row = _fetch_one(conn, "select to_regprocedure(%s)::text as procedure_name", [signature])
        if not row or not row.get("procedure_name"):
            findings.append(RuntimeFinding("HIGH", "RLS_HELPER_MISSING", "Expected RLS helper function is missing.", signature))
    return findings


def run(args: argparse.Namespace) -> list[RuntimeFinding]:
    database_url = args.database_url or os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
    if not database_url:
        return [RuntimeFinding("HIGH", "DATABASE_URL_MISSING", "Set SUPABASE_DB_URL, DATABASE_URL, or pass --database-url.", "config")]
    conn = psycopg2.connect(database_url)
    try:
        findings: list[RuntimeFinding] = []
        findings.extend(verify_runtime_role(conn))
        findings.extend(verify_helper_functions(conn))
        findings.extend(verify_public_rls(conn, allow_missing_tables=args.allow_missing_tables))
        findings.extend(verify_storage(conn, allow_missing_storage=args.allow_missing_storage))
        return findings
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify deployed Octodrop RLS/storage security controls.")
    parser.add_argument("--database-url", help="Database URL. Defaults to SUPABASE_DB_URL or DATABASE_URL.")
    parser.add_argument("--allow-missing-storage", action="store_true", help="Do not fail if storage.objects/policies are unavailable in this environment.")
    parser.add_argument("--allow-missing-tables", action="store_true", help="Do not fail if expected tables are missing.")
    parser.add_argument("--json", action="store_true", help="Emit JSON findings.")
    args = parser.parse_args()

    findings = run(args)
    if args.json:
        print(json.dumps([asdict(finding) for finding in findings], indent=2))
    elif findings:
        for finding in findings:
            print(finding.render(), file=sys.stderr)
    else:
        print("runtime_security_verify: no findings")
    return 1 if any(f.severity in {"CRITICAL", "HIGH"} for f in findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
