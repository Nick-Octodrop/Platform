#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any
from urllib import parse as urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "_shared"))

from manifest_tooling import api_call, collect_error_text, is_ok


OPPORTUNITY_ENTITY = "entity.crm_opportunity"

LEGACY_STAGE_MAP = {
    "new": "deal_qualification",
    "discovery": "meeting",
    "solution": "proposal",
    "quote": "proposal",
    "negotiation": "negotiation_commitment",
}


def list_records(base_url: str, *, token: str | None, workspace_id: str | None) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        params: dict[str, str | int] = {"limit": 200}
        if cursor:
            params["cursor"] = cursor
        status, payload = api_call(
            "GET",
            f"{base_url}/records/{urlparse.quote(OPPORTUNITY_ENTITY, safe='')}?{urlparse.urlencode(params)}",
            token=token,
            workspace_id=workspace_id,
            timeout=180,
        )
        if status >= 400 or not is_ok(payload):
            raise RuntimeError(f"list {OPPORTUNITY_ENTITY} failed: {collect_error_text(payload)}")
        batch = payload.get("records")
        if not isinstance(batch, list) or not batch:
            break
        records.extend(row for row in batch if isinstance(row, dict))
        cursor = payload.get("next_cursor") if isinstance(payload.get("next_cursor"), str) else None
        if not cursor:
            break
    return records


def record_payload(row: dict[str, Any]) -> dict[str, Any]:
    record = row.get("record")
    return record if isinstance(record, dict) else {}


def record_id(row: dict[str, Any]) -> str | None:
    value = row.get("record_id") or record_payload(row).get("id")
    return value if isinstance(value, str) and value else None


def update_record(
    base_url: str,
    rid: str,
    record: dict[str, Any],
    *,
    token: str | None,
    workspace_id: str | None,
) -> None:
    status, payload = api_call(
        "PUT",
        f"{base_url}/records/{urlparse.quote(OPPORTUNITY_ENTITY, safe='')}/{urlparse.quote(rid, safe='')}",
        token=token,
        workspace_id=workspace_id,
        body={"record": record},
        timeout=180,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"update {OPPORTUNITY_ENTITY}/{rid} failed: {collect_error_text(payload)}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Map legacy commercial CRM opportunity stages to the Pipedrive-style phase-1 stage values."
    )
    parser.add_argument("--base-url", default=None, help="API base URL, e.g. https://app.octodrop.com")
    parser.add_argument("--token", default=None, help="Bearer token")
    parser.add_argument("--workspace-id", default=None, help="Workspace ID")
    parser.add_argument("--dry-run", action="store_true", help="Print planned changes without writing")
    args = parser.parse_args()

    base_url = (args.base_url or os.environ.get("OCTO_BASE_URL", "")).strip().rstrip("/")
    token = (args.token or os.environ.get("OCTO_API_TOKEN", "")).strip() or None
    workspace_id = (args.workspace_id or os.environ.get("OCTO_WORKSPACE_ID", "")).strip() or None
    if not base_url:
        raise SystemExit("--base-url or OCTO_BASE_URL is required")
    if not workspace_id:
        raise SystemExit("--workspace-id or OCTO_WORKSPACE_ID is required")

    records = list_records(base_url, token=token, workspace_id=workspace_id)
    updated = 0
    skipped = 0
    for row in records:
        rid = record_id(row)
        record = record_payload(row)
        if not rid:
            continue
        current = str(record.get("crm_opportunity.stage") or "").strip()
        target = LEGACY_STAGE_MAP.get(current)
        if not target:
            skipped += 1
            continue
        updated += 1
        label = record.get("crm_opportunity.title") or rid
        print(f"[crm-stage] {label}: {current!r} -> {target!r}")
        if not args.dry_run:
            update_record(
                base_url,
                rid,
                {**record, "crm_opportunity.stage": target},
                token=token,
                workspace_id=workspace_id,
            )

    print(f"[crm-stage] complete: updated={updated}, skipped={skipped}, dry_run={args.dry_run}")


if __name__ == "__main__":
    main()
