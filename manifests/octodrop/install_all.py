#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "_shared"))

from manifest_tooling import install_folder


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Install all curated Octodrop manifest packs")
    parser.add_argument("--base-url", default=os.environ.get("OCTO_BASE_URL", "").strip(), help="Octodrop API base URL")
    parser.add_argument("--token", default=os.environ.get("OCTO_API_TOKEN", "").strip(), help="Bearer token")
    parser.add_argument("--workspace-id", default=os.environ.get("OCTO_WORKSPACE_ID", "").strip(), help="Workspace ID")
    parser.add_argument("--dry-run", action="store_true", help="Print the install order without applying manifests")
    args = parser.parse_args()
    base = Path(__file__).resolve().parent
    for subfolder in ["billing", "work_management", "outreach", "octo_ai"]:
        install_folder(
            base / subfolder,
            dry_run=args.dry_run,
            base_url=args.base_url,
            token=args.token,
            workspace_id=args.workspace_id,
        )
