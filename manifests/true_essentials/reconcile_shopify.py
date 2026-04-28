#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def build_subcommand(
    script_name: str,
    *,
    base_url: str,
    workspace_id: str,
    connection_id: str | None,
    connection_name: str | None,
    dry_run: bool,
    import_images: bool,
    overwrite_local: bool,
    orders_new_only: bool,
    orders_since_last_local: bool,
    max_orders: int | None,
    page_size: int | None,
) -> list[str]:
    command = [sys.executable, str(ROOT / script_name), "--base-url", base_url, "--workspace-id", workspace_id]
    if connection_id:
        command.extend(["--connection-id", connection_id])
    elif connection_name:
        command.extend(["--connection-name", connection_name])
    if dry_run:
        command.append("--dry-run")
    if import_images and script_name == "import_shopify_products.py":
        command.append("--import-images")
    if overwrite_local and script_name in {"import_shopify_products.py", "import_shopify_customers.py"}:
        command.append("--overwrite-local")
    if script_name == "import_shopify_orders.py":
        if orders_new_only:
            command.append("--new-only")
        if orders_since_last_local:
            command.append("--since-last-local")
        if max_orders:
            command.extend(["--max-orders", str(max_orders)])
        if page_size:
            command.extend(["--page-size", str(page_size)])
    return command


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the full True Essentials Shopify reconciliation flow.")
    parser.add_argument("--base-url", default=os.getenv("OCTO_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--workspace-id", default=os.getenv("OCTO_WORKSPACE_ID"))
    parser.add_argument("--connection-id")
    parser.add_argument("--connection-name")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--import-images", action="store_true")
    parser.add_argument("--overwrite-local", action="store_true")
    parser.add_argument("--continue-on-error", action="store_true")
    parser.add_argument("--orders-only", action="store_true", help="Only run Shopify order import, skipping customers and products")
    parser.add_argument("--orders-new-only", action="store_true", help="Create missing Shopify orders only; do not patch existing local orders")
    parser.add_argument("--orders-since-last-local", action="store_true", help="Start order import after the highest local Shopify order ID")
    parser.add_argument("--max-orders", type=int, default=None, help="Maximum Shopify orders to scan in the order import step")
    parser.add_argument("--page-size", type=int, default=None, help="Shopify order page size for the order import step")
    args = parser.parse_args()

    if not args.workspace_id:
        raise SystemExit("Missing --workspace-id or OCTO_WORKSPACE_ID")
    if not args.connection_id and not args.connection_name:
        raise SystemExit("Either --connection-id or --connection-name is required")

    steps = [("orders", "import_shopify_orders.py")] if args.orders_only else [
        ("customers", "import_shopify_customers.py"),
        ("products", "import_shopify_products.py"),
        ("orders", "import_shopify_orders.py"),
    ]
    for label, script_name in steps:
        command = build_subcommand(
            script_name,
            base_url=args.base_url.rstrip("/"),
            workspace_id=args.workspace_id,
            connection_id=args.connection_id,
            connection_name=args.connection_name,
            dry_run=args.dry_run,
            import_images=args.import_images,
            overwrite_local=args.overwrite_local,
            orders_new_only=args.orders_new_only,
            orders_since_last_local=args.orders_since_last_local,
            max_orders=args.max_orders,
            page_size=args.page_size,
        )
        print(f"[reconcile] {label}: {' '.join(command)}", flush=True)
        result = subprocess.run(command, check=False)
        if result.returncode == 0:
            continue
        print(f"[reconcile] {label} failed with exit code {result.returncode}", flush=True)
        if not args.continue_on_error:
            return result.returncode
    print("[reconcile] complete", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
