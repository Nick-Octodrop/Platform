#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib import parse as urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "_shared"))

from manifest_tooling import api_call, collect_error_text, is_ok


REMOVED_MODULES = ["biz_dashboard", "biz_settings"]


def main() -> int:
    base_url = os.environ.get("OCTO_BASE_URL", "").strip().rstrip("/")
    token = os.environ.get("OCTO_API_TOKEN", "").strip() or None
    workspace_id = os.environ.get("OCTO_WORKSPACE_ID", "").strip() or None
    if not base_url:
        raise SystemExit("OCTO_BASE_URL is required")
    if not token:
        raise SystemExit("OCTO_API_TOKEN is required")
    for module_id in REMOVED_MODULES:
        status, payload = api_call(
            "DELETE",
            f"{base_url}/modules/{urlparse.quote(module_id, safe='')}?archive=true",
            token=token,
            workspace_id=workspace_id,
            timeout=120,
        )
        if status == 404:
            print(f"[cleanup] missing  {module_id}")
            continue
        if status >= 400 or not is_ok(payload):
            raise SystemExit(f"[cleanup] failed   {module_id}: {collect_error_text(payload)}")
        print(f"[cleanup] archived {module_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
