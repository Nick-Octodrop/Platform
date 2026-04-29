#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "_shared"))

from manifest_tooling import api_call, collect_error_text, is_ok


SCRIPT_DIR = Path(__file__).resolve().parent


def run_step(
    name: str,
    args: list[str],
    *,
    dry_run: bool,
    supports_dry_run: bool = True,
    token_provided: bool = True,
    requires_token_for_dry_run: bool = False,
) -> None:
    cmd = [sys.executable, *args]
    if dry_run and requires_token_for_dry_run and not token_provided:
        print(f"\n[uat] {name}")
        print("[uat] skipped in dry-run because this step needs an API token to inspect workspace state")
        print("[uat] " + " ".join(cmd))
        return
    if dry_run and not supports_dry_run:
        print(f"\n[uat] {name}")
        print("[uat] skipped in dry-run because the script does not expose --dry-run")
        print("[uat] " + " ".join(cmd))
        return
    if dry_run and "--dry-run" not in cmd:
        cmd.append("--dry-run")
    print(f"\n[uat] {name}")
    print("[uat] " + " ".join(cmd))
    subprocess.run(cmd, cwd=Path(__file__).resolve().parents[2], check=True)


def common_args(args: argparse.Namespace) -> list[str]:
    out = [
        "--base-url",
        args.base_url,
        "--workspace-id",
        args.workspace_id,
    ]
    if args.token:
        out.extend(["--token", args.token])
    return out


def list_document_templates(base_url: str, *, token: str, workspace_id: str) -> list[dict[str, Any]]:
    status, payload = api_call(
        "GET",
        f"{base_url}/documents/templates",
        token=token,
        workspace_id=workspace_id,
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"list document templates failed: {collect_error_text(payload)}")
    rows = payload.get("templates")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def resolve_template_id(args: argparse.Namespace, name: str, env_name: str) -> str | None:
    explicit = str(os.getenv(env_name, "") or "").strip()
    if explicit:
        return explicit
    if args.dry_run or not args.token:
        return None
    for item in list_document_templates(args.base_url, token=args.token, workspace_id=args.workspace_id):
        if str(item.get("name") or "").strip().lower() == name.strip().lower():
            template_id = item.get("id")
            return template_id if isinstance(template_id, str) and template_id else None
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the repeatable Commercial V2 UAT workspace setup.")
    parser.add_argument("--base-url", default=os.getenv("OCTO_BASE_URL", "http://localhost:8000").strip())
    parser.add_argument("--token", default=os.getenv("OCTO_API_TOKEN", "").strip())
    parser.add_argument("--workspace-id", default=os.getenv("OCTO_WORKSPACE_ID", "").strip())
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--clear-records", action="store_true", help="Delete commercial manifest records before setup")
    parser.add_argument("--continue-clear-on-error", action="store_true")
    parser.add_argument("--seed-demo-records", action="store_true", help="Also run the larger demo/sample data seed")
    parser.add_argument("--skip-access-assignments", action="store_true")
    parser.add_argument("--publish-automations", action="store_true")
    parser.add_argument("--xero-connection-id", default=os.getenv("OCTO_XERO_CONNECTION_ID", "").strip())
    parser.add_argument("--xero-connection-name", default=os.getenv("OCTO_XERO_CONNECTION_NAME", "").strip())
    parser.add_argument("--xero-sales-entity", default=os.getenv("OCTO_XERO_SALES_ENTITY", "").strip())
    parser.add_argument("--xero-sales-account-code", default=os.getenv("OCTO_XERO_SALES_ACCOUNT_CODE", "200").strip())
    parser.add_argument("--xero-tax-type", default=os.getenv("OCTO_XERO_DEFAULT_TAX_TYPE", "OUTPUT").strip())
    args = parser.parse_args()

    args.base_url = (args.base_url or "").rstrip("/")
    args.token = (args.token or "").strip()
    args.workspace_id = (args.workspace_id or "").strip()
    if not args.base_url:
        raise SystemExit("Missing --base-url or OCTO_BASE_URL")
    if not args.workspace_id:
        raise SystemExit("Missing --workspace-id or OCTO_WORKSPACE_ID")
    if not args.dry_run and not args.token:
        raise SystemExit("Missing --token or OCTO_API_TOKEN")

    shared = common_args(args)

    if args.clear_records:
        clear_args = [str(SCRIPT_DIR / "clear_workspace_data.py"), *shared]
        if args.continue_clear_on_error:
            clear_args.append("--continue-on-error")
        run_step("Clear commercial records", clear_args, dry_run=args.dry_run)

    run_step("Install commercial modules", [str(SCRIPT_DIR / "install_all.py"), *shared], dry_run=args.dry_run)
    run_step("Cleanup removed modules", [str(SCRIPT_DIR / "cleanup_removed_modules.py"), *shared], dry_run=args.dry_run)
    run_step(
        "Setup document registry metadata",
        [str(SCRIPT_DIR / "setup_document_registry_metadata.py"), *shared],
        dry_run=args.dry_run,
        token_provided=bool(args.token),
        requires_token_for_dry_run=True,
    )
    run_step(
        "Setup document numbering",
        [str(SCRIPT_DIR / "setup_document_numbering.py"), *shared],
        dry_run=args.dry_run,
        token_provided=bool(args.token),
        requires_token_for_dry_run=True,
    )
    run_step(
        "Setup quote document template",
        [str(SCRIPT_DIR / "setup_quote_document_templates.py"), *shared],
        dry_run=args.dry_run,
        token_provided=bool(args.token),
        requires_token_for_dry_run=True,
    )
    run_step("Setup quote scripts", [str(SCRIPT_DIR / "setup_quote_scripts.py"), *shared], dry_run=args.dry_run, supports_dry_run=False)
    run_step(
        "Seed catalogue items",
        [str(SCRIPT_DIR / "seed_catalog_items.py"), *shared],
        dry_run=args.dry_run,
        token_provided=bool(args.token),
        requires_token_for_dry_run=True,
    )

    access_args = [str(SCRIPT_DIR / "setup_access_profiles.py"), *shared]
    if args.skip_access_assignments:
        access_args.append("--skip-assignments")
    run_step("Setup access profiles", access_args, dry_run=args.dry_run, supports_dry_run=False)

    quote_template_id = resolve_template_id(args, "Customer Quote Template", "OCTO_QUOTE_DOCUMENT_TEMPLATE_ID")
    automation_args = [str(SCRIPT_DIR / "setup_commercial_automations.py"), *shared]
    if quote_template_id:
        automation_args.extend(["--quote-document-template-id", quote_template_id])
    else:
        print("[uat] quote template id not resolved; document generation automation will only include non-template automations")
    if args.publish_automations:
        automation_args.append("--publish")
    run_step(
        "Setup commercial automations",
        automation_args,
        dry_run=args.dry_run,
        token_provided=bool(args.token),
        requires_token_for_dry_run=True,
    )

    if args.xero_connection_id or args.xero_connection_name:
        if not args.xero_sales_entity:
            raise SystemExit("--xero-sales-entity is required when configuring Xero")
        xero_args = [
            str(SCRIPT_DIR / "setup_xero_phase1.py"),
            *shared,
            "--sales-entity",
            args.xero_sales_entity,
            "--sales-account-code",
            args.xero_sales_account_code,
            "--default-tax-type",
            args.xero_tax_type,
        ]
        if args.xero_connection_id:
            xero_args.extend(["--connection-id", args.xero_connection_id])
        if args.xero_connection_name:
            xero_args.extend(["--connection-name", args.xero_connection_name])
        if args.publish_automations:
            xero_args.append("--publish")
        run_step("Setup Xero phase 1", xero_args, dry_run=args.dry_run)
    else:
        print("\n[uat] Xero skipped; pass --xero-connection-id or --xero-connection-name to configure it.")

    if args.seed_demo_records:
        run_step("Seed demo records", [str(SCRIPT_DIR / "seed_dummy_examples.py"), *shared], dry_run=args.dry_run)

    print("\n[uat] setup complete")


if __name__ == "__main__":
    main()
