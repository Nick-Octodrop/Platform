#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
import argparse
from pathlib import Path
from urllib import parse as urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "_shared"))

from manifest_tooling import api_call, collect_error_text, is_ok


REMOVED_MODULES = ["biz_dashboard", "biz_settings"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Archive commercial_v2 modules that were removed from the bundle.")
    parser.add_argument("--base-url", default=os.environ.get("OCTO_BASE_URL", "").strip(), help="Octodrop API base URL")
    parser.add_argument("--token", default=os.environ.get("OCTO_API_TOKEN", "").strip(), help="Bearer token")
    parser.add_argument("--workspace-id", default=os.environ.get("OCTO_WORKSPACE_ID", "").strip(), help="Workspace ID")
    parser.add_argument("--dry-run", action="store_true", help="Print planned archive operations without writing")
    args = parser.parse_args()

    base_url = args.base_url.strip().rstrip("/")
    token = args.token.strip() or None
    workspace_id = args.workspace_id.strip() or None
    if not base_url:
        raise SystemExit("OCTO_BASE_URL is required")
    if not token and not args.dry_run:
        raise SystemExit("OCTO_API_TOKEN is required")
    for module_id in REMOVED_MODULES:
        if args.dry_run:
            print(f"[cleanup] would archive {module_id}")
            continue
        status, payload = api_call(
            "DELETE",
            f"{base_url}/modules/{urlparse.quote(module_id, safe='')}?archive=true",
            token=token,
            workspace_id=workspace_id,
            timeout=120,
        )
        errors = payload.get("errors") if isinstance(payload, dict) else None
        codes: set[str] = set()
        if isinstance(errors, list):
            for entry in errors:
                if isinstance(entry, dict) and isinstance(entry.get("code"), str):
                    codes.add(entry["code"])
        if status == 404 or "MODULE_NOT_FOUND" in codes:
            print(f"[cleanup] missing  {module_id}")
            continue
        if status >= 400 or not is_ok(payload):
            raise SystemExit(f"[cleanup] failed   {module_id}: {collect_error_text(payload)}")
        print(f"[cleanup] archived {module_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
