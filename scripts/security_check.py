#!/usr/bin/env python3
"""Local security guardrails for Octodrop.

The checks are intentionally dependency-free so they can run in CI before the
Python and Node environments are fully prepared.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

EXCLUDED_PARTS = {
    ".git",
    ".pytest_cache",
    "__pycache__",
    "node_modules",
    "dist",
    "web/dist",
    "construction-worker-pwa/dist",
    "storage",
}
EXCLUDED_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".pdf",
    ".docx",
    ".zip",
    ".gz",
    ".lock",
    ".pyc",
}

SECRET_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b")),
    ("openai_key", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b")),
    ("supabase_service_role", re.compile(r"SUPABASE_SERVICE_ROLE_KEY\s*=\s*['\"]?[^'\"\s<#][^'\"\s#]*")),
    ("database_url", re.compile(r"(?:SUPABASE_DB_URL|DATABASE_URL)\s*=\s*['\"]?postgres(?:ql)?://[^'\"\s<]+")),
]

ALLOWLIST_SNIPPETS = {
    "VITE_SUPABASE_ANON_KEY=",
    "<SUPABASE_SERVICE_ROLE_KEY>",
    "<SUPABASE_DB_URL",
    "<ENCODED_PASSWORD>",
    "SUPABASE_DB_URL=postgres://...",
    "OPENAI_API_KEY=sk-...",
    "<paste a short-lived local token",
}

TENANT_OWNED_TABLES: dict[str, set[str]] = {
    "org_members": {"org_id"},
    "modules_installed": {"org_id"},
    "manifest_snapshots": {"org_id"},
    "manifest_audit": {"org_id"},
    "module_audit": {"org_id"},
    "jobs": {"org_id"},
    "workflow_instances": {"org_id"},
    "contacts": {"org_id"},
    "templates": {"org_id"},
    "module_drafts": {"org_id"},
    "records_chatter": {"org_id"},
    "module_draft_versions": {"org_id"},
    "saved_filters": {"org_id"},
    "user_entity_prefs": {"org_id"},
    "module_versions": {"org_id"},
    "job_events": {"org_id"},
    "notifications": {"org_id"},
    "email_templates": {"org_id"},
    "email_outbox": {"org_id"},
    "attachments": {"org_id"},
    "attachment_links": {"org_id"},
    "doc_templates": {"org_id"},
    "secrets": {"org_id"},
    "connections": {"org_id"},
    "automations": {"org_id"},
    "automation_runs": {"org_id"},
    "automation_step_runs": {"org_id"},
    "workflow_instance_events": {"org_id"},
    "workspace_ui_prefs": {"org_id"},
    "user_ui_prefs": {"org_id"},
    "workspace_invites": {"workspace_id"},
    "record_activity_events": {"org_id"},
    "marketplace_apps": {"source_org_id"},
    "integration_connection_secrets": {"org_id"},
    "integration_mappings": {"org_id"},
    "integration_webhooks": {"org_id"},
    "webhook_events": {"org_id"},
    "sync_checkpoints": {"org_id"},
    "integration_request_logs": {"org_id"},
    "api_credentials": {"org_id"},
    "api_request_logs": {"org_id"},
    "external_webhook_subscriptions": {"org_id"},
    "workspace_access_profiles": {"org_id"},
    "workspace_access_profile_assignments": {"org_id"},
    "workspace_access_policy_rules": {"org_id"},
    "document_sequence_definitions": {"org_id"},
    "document_sequence_counters": {"org_id"},
    "document_sequence_assignment_logs": {"org_id"},
    "records_generic": {"tenant_id"},
}


@dataclass
class Finding:
    severity: str
    code: str
    message: str
    path: str | None = None
    line: int | None = None

    def render(self) -> str:
        location = ""
        if self.path:
            location = self.path
            if self.line:
                location += f":{self.line}"
            location = f" {location}"
        return f"[{self.severity}] {self.code}{location} - {self.message}"


def tracked_files() -> list[Path]:
    try:
        output = subprocess.check_output(["git", "ls-files"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL)
        candidates = [ROOT / line.strip() for line in output.splitlines() if line.strip()]
    except Exception:
        candidates = [path for path in ROOT.rglob("*") if path.is_file()]
    return [path for path in candidates if should_scan(path)]


def should_scan(path: Path) -> bool:
    rel = path.relative_to(ROOT)
    rel_text = str(rel).replace("\\", "/")
    if path.suffix.lower() in EXCLUDED_SUFFIXES:
        return False
    return not any(part in rel.parts or rel_text.startswith(part + "/") for part in EXCLUDED_PARTS)


def scan_secrets(paths: list[Path] | None = None) -> list[Finding]:
    findings: list[Finding] = []
    for path in paths or tracked_files():
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        except Exception as exc:
            findings.append(Finding("LOW", "SECURITY_SCAN_READ_FAILED", str(exc), str(path.relative_to(ROOT))))
            continue
        for line_no, line in enumerate(text.splitlines(), start=1):
            if any(snippet in line for snippet in ALLOWLIST_SNIPPETS):
                continue
            for name, pattern in SECRET_PATTERNS:
                if pattern.search(line):
                    findings.append(
                        Finding(
                            "CRITICAL",
                            "SECRET_IN_REPOSITORY",
                            f"Potential committed secret matched pattern {name}. Rotate it and replace with a placeholder.",
                            str(path.relative_to(ROOT)),
                            line_no,
                        )
                    )
    return findings


def scan_rls() -> list[Finding]:
    migrations = sorted((ROOT / "app" / "migrations").glob("*.sql"))
    combined = "\n".join(path.read_text(encoding="utf-8", errors="ignore").lower() for path in migrations)
    findings: list[Finding] = []
    if "enable row level security" not in combined or "create policy" not in combined:
        findings.append(
            Finding(
                "HIGH",
                "RLS_NOT_FOUND_IN_MIGRATIONS",
                "No Supabase/Postgres RLS enablement or policies were found in migrations; tenant isolation is currently application-enforced only.",
                "app/migrations",
            )
        )
        return findings
    rls_migration_text = (ROOT / "app" / "migrations" / "052_rls_tenant_isolation.sql").read_text(encoding="utf-8", errors="ignore").lower() if (ROOT / "app" / "migrations" / "052_rls_tenant_isolation.sql").exists() else ""
    for table in sorted(TENANT_OWNED_TABLES):
        if table not in combined:
            continue
        if re.search(rf"alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?{re.escape(table)}\s+enable\s+row\s+level\s+security", combined) is None and f"'{table}'" not in rls_migration_text:
            findings.append(
                Finding(
                    "HIGH",
                    "TENANT_TABLE_RLS_MISSING",
                    f"{table} is tenant-owned but no RLS enablement was found for it.",
                    "app/migrations",
                )
            )
    return findings


def _migration_columns() -> dict[str, set[str]]:
    columns: dict[str, set[str]] = {}
    for path in sorted((ROOT / "app" / "migrations").glob("*.sql")):
        text = path.read_text(encoding="utf-8", errors="ignore")
        for match in re.finditer(r"create\s+table\s+if\s+not\s+exists\s+([\w.]+)\s*\((.*?)\);", text, re.I | re.S):
            table = match.group(1).split(".")[-1].lower()
            bucket = columns.setdefault(table, set())
            for raw_line in match.group(2).splitlines():
                line = raw_line.strip().rstrip(",")
                if not line or line.startswith("--") or line.lower().startswith(("primary ", "unique ", "constraint ", "foreign ", "check ")):
                    continue
                bucket.add(line.split()[0].strip('"').lower())
        for match in re.finditer(r"alter\s+table\s+(?:if\s+exists\s+)?([\w.]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([\w\"]+)", text, re.I):
            table = match.group(1).split(".")[-1].lower()
            column = match.group(2).strip('"').lower()
            columns.setdefault(table, set()).add(column)
    return columns


def scan_tenant_ownership() -> list[Finding]:
    columns = _migration_columns()
    findings: list[Finding] = []
    for table, owner_columns in sorted(TENANT_OWNED_TABLES.items()):
        actual = columns.get(table)
        if not actual:
            continue
        if not (actual & {col.lower() for col in owner_columns}):
            findings.append(
                Finding(
                    "HIGH",
                    "TENANT_OWNERSHIP_FIELD_MISSING",
                    f"{table} is tenant-owned but lacks one of: {', '.join(sorted(owner_columns))}.",
                    "app/migrations",
                )
            )
    return findings


def scan_storage_policies() -> list[Finding]:
    migrations = sorted((ROOT / "app" / "migrations").glob("*.sql"))
    combined = "\n".join(path.read_text(encoding="utf-8", errors="ignore").lower() for path in migrations)
    required = [
        "storage.objects",
        "octo_attachments_storage_select",
        "octo_attachments_storage_insert",
        "octo_attachments_storage_update",
        "octo_attachments_storage_delete",
        "bucket_id = 'attachments'",
        "octo_security.path_workspace_id(name)",
    ]
    missing = [item for item in required if item not in combined]
    if missing:
        return [
            Finding(
                "HIGH",
                "STORAGE_POLICY_COVERAGE_MISSING",
                f"Supabase storage policy coverage is missing: {', '.join(missing)}.",
                "app/migrations",
            )
        ]
    return []


def check_prod_env() -> list[Finding]:
    env = (os.getenv("APP_ENV") or os.getenv("ENV") or "dev").strip().lower()
    if env not in {"prod", "production"}:
        return []
    findings: list[Finding] = []
    if os.getenv("OCTO_DISABLE_AUTH", "").strip().lower() in {"1", "true", "yes"}:
        findings.append(Finding("CRITICAL", "AUTH_DISABLED_IN_PROD", "OCTO_DISABLE_AUTH is enabled in production."))
    for name in ("SUPABASE_URL", "SUPABASE_DB_URL", "APP_SECRET_KEY", "OCTO_CORS_ORIGINS", "OCTO_TRUSTED_HOSTS"):
        if not os.getenv(name, "").strip():
            findings.append(Finding("HIGH", "PROD_SECURITY_ENV_MISSING", f"{name} must be set for production."))
    if os.getenv("STUDIO2_AGENT_LOG_PAYLOAD", "").strip().lower() in {"1", "true", "yes"}:
        findings.append(Finding("HIGH", "AI_PAYLOAD_LOGGING_IN_PROD", "STUDIO2_AGENT_LOG_PAYLOAD is enabled in production."))
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Octodrop security checks.")
    parser.add_argument("--strict", action="store_true", help="Fail on high-risk architectural gaps, not only leaked secrets/prod env issues.")
    args = parser.parse_args()

    findings = [*scan_secrets(), *check_prod_env()]
    rls_findings = scan_rls()
    findings.extend(rls_findings)
    findings.extend(scan_tenant_ownership())
    findings.extend(scan_storage_policies())

    if findings:
        for finding in findings:
            print(finding.render(), file=sys.stderr)
    else:
        print("security_check: no findings")

    fail_codes = {"SECRET_IN_REPOSITORY", "AUTH_DISABLED_IN_PROD", "AI_PAYLOAD_LOGGING_IN_PROD", "PROD_SECURITY_ENV_MISSING"}
    if args.strict:
        fail_codes.update({"RLS_NOT_FOUND_IN_MIGRATIONS", "TENANT_TABLE_RLS_MISSING", "TENANT_OWNERSHIP_FIELD_MISSING", "STORAGE_POLICY_COVERAGE_MISSING"})
    return 1 if any(finding.code in fail_codes for finding in findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
