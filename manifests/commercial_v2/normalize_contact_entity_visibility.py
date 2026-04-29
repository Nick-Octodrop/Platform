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


CONTACT_ENTITY = "entity.biz_contact"
PERSON_ENTITY = "entity.biz_contact_person"
NLIGHT_SCOPE = "NLight BV"
ECOTECH_SCOPE = "EcoTech FZCO"
SHARED_SCOPE = "Shared"
VALID_SCOPES = {NLIGHT_SCOPE, ECOTECH_SCOPE, SHARED_SCOPE}


def list_records(base_url: str, entity_id: str, *, token: str | None, workspace_id: str | None) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        params: dict[str, str | int] = {"limit": 200}
        if cursor:
            params["cursor"] = cursor
        status, payload = api_call(
            "GET",
            f"{base_url}/records/{urlparse.quote(entity_id, safe='')}?{urlparse.urlencode(params)}",
            token=token,
            workspace_id=workspace_id,
            timeout=180,
        )
        if status >= 400 or not is_ok(payload):
            raise RuntimeError(f"list {entity_id} failed: {collect_error_text(payload)}")
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


def lookup_record_id(value: Any) -> str | None:
    if isinstance(value, str) and value:
        return value
    if not isinstance(value, dict):
        return None
    for key in ("id", "record_id", "value"):
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate:
            return candidate
    return None


def update_record(
    base_url: str,
    entity_id: str,
    rid: str,
    record: dict[str, Any],
    *,
    token: str | None,
    workspace_id: str | None,
) -> None:
    status, payload = api_call(
        "PUT",
        f"{base_url}/records/{urlparse.quote(entity_id, safe='')}/{urlparse.quote(rid, safe='')}",
        token=token,
        workspace_id=workspace_id,
        body={"record": record},
        timeout=180,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"update {entity_id}/{rid} failed: {collect_error_text(payload)}")


def normalize_scope(raw: Any, *, default_unscoped_customer: str | None = None, contact_type: str | None = None) -> str | None:
    values: list[str] = []
    if isinstance(raw, list):
        values = [str(item).strip() for item in raw if str(item).strip()]
    elif isinstance(raw, str):
        cleaned = raw.strip()
        if cleaned:
            values = [cleaned]
    elif raw is not None:
        values = [str(raw).strip()]

    normalized_values = {" ".join(value.lower().replace("/", " ").replace("+", " ").split()) for value in values}
    joined = " ".join(normalized_values)
    has_shared = any(value == "shared" for value in normalized_values)
    has_nlight = any(value == NLIGHT_SCOPE.lower() for value in normalized_values) or "nlight" in joined
    has_ecotech = any(value == ECOTECH_SCOPE.lower() for value in normalized_values) or "ecotech" in joined or "cis" in joined

    if has_shared or (has_nlight and has_ecotech):
        return SHARED_SCOPE
    if has_nlight:
        return NLIGHT_SCOPE
    if has_ecotech:
        return ECOTECH_SCOPE
    if contact_type == "customer" and default_unscoped_customer in VALID_SCOPES:
        return default_unscoped_customer
    return None


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Normalize NLight contact visibility from legacy typed tags to the controlled dropdown values."
    )
    parser.add_argument("--base-url", default=None, help="API base URL, e.g. https://app.octodrop.com")
    parser.add_argument("--token", default=None, help="Bearer token")
    parser.add_argument("--workspace-id", default=None, help="Workspace ID")
    parser.add_argument("--dry-run", action="store_true", help="Print planned changes without writing")
    parser.add_argument(
        "--default-unscoped-customer",
        choices=[NLIGHT_SCOPE, ECOTECH_SCOPE, SHARED_SCOPE],
        default=None,
        help="Optional fallback for customer contacts with no existing visibility value.",
    )
    args = parser.parse_args()

    base_url = (args.base_url or os.environ.get("OCTO_BASE_URL", "")).strip().rstrip("/")
    token = (args.token or os.environ.get("OCTO_API_TOKEN", "")).strip() or None
    workspace_id = (args.workspace_id or os.environ.get("OCTO_WORKSPACE_ID", "")).strip() or None
    if not base_url:
        raise SystemExit("--base-url or OCTO_BASE_URL is required")
    if not workspace_id:
        raise SystemExit("--workspace-id or OCTO_WORKSPACE_ID is required")

    contacts = list_records(base_url, CONTACT_ENTITY, token=token, workspace_id=workspace_id)
    contacts_by_id: dict[str, dict[str, Any]] = {}
    contact_updates = 0
    skipped_unscoped = 0
    for row in contacts:
        rid = record_id(row)
        record = record_payload(row)
        if not rid:
            continue
        contact_type = str(record.get("biz_contact.contact_type") or "").strip()
        normalized = normalize_scope(
            record.get("biz_contact.company_entity_scope"),
            default_unscoped_customer=args.default_unscoped_customer,
            contact_type=contact_type,
        )
        if not normalized:
            if contact_type == "customer":
                skipped_unscoped += 1
            contacts_by_id[rid] = record
            continue
        merged = {**record, "biz_contact.company_entity_scope": normalized}
        contacts_by_id[rid] = merged
        if record.get("biz_contact.company_entity_scope") == normalized:
            continue
        contact_updates += 1
        label = record.get("biz_contact.name") or rid
        print(f"[visibility] contact {label}: {record.get('biz_contact.company_entity_scope')!r} -> {normalized!r}")
        if not args.dry_run:
            update_record(base_url, CONTACT_ENTITY, rid, merged, token=token, workspace_id=workspace_id)

    people = list_records(base_url, PERSON_ENTITY, token=token, workspace_id=workspace_id)
    person_updates = 0
    for row in people:
        rid = record_id(row)
        record = record_payload(row)
        if not rid:
            continue
        company_id = lookup_record_id(record.get("biz_contact_person.company_id"))
        parent = contacts_by_id.get(company_id) if company_id else None
        if not parent:
            continue
        desired_type = parent.get("biz_contact.contact_type")
        desired_scope = parent.get("biz_contact.company_entity_scope")
        patch: dict[str, Any] = {}
        if desired_type and record.get("biz_contact_person.company_contact_type_snapshot") != desired_type:
            patch["biz_contact_person.company_contact_type_snapshot"] = desired_type
        if desired_scope and record.get("biz_contact_person.company_entity_scope_snapshot") != desired_scope:
            patch["biz_contact_person.company_entity_scope_snapshot"] = desired_scope
        if not patch:
            continue
        person_updates += 1
        label = record.get("biz_contact_person.display_name") or rid
        print(f"[visibility] person {label}: update snapshots {patch}")
        if not args.dry_run:
            update_record(base_url, PERSON_ENTITY, rid, {**record, **patch}, token=token, workspace_id=workspace_id)

    print(
        f"[visibility] complete: contacts_updated={contact_updates}, people_updated={person_updates}, "
        f"unscoped_customers_skipped={skipped_unscoped}, dry_run={args.dry_run}"
    )


if __name__ == "__main__":
    main()
