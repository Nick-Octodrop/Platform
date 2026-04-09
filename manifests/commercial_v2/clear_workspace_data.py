#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from graphlib import TopologicalSorter
from pathlib import Path
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest


DEFAULT_MANIFEST_FILES = [
    "calendar.json",
    "contacts.json",
    "crm.json",
    "documents.json",
    "invoices.json",
    "orders.json",
    "products.json",
    "purchase_orders.json",
    "quotes.json",
    "tasks.json",
]

SETTINGS_MANIFEST_FILES = [
    "settings.json",
]


def api_call(
    method: str,
    url: str,
    *,
    token: str | None = None,
    workspace_id: str | None = None,
    body: dict[str, Any] | None = None,
    timeout: int = 60,
) -> tuple[int, dict[str, Any]]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if workspace_id:
        headers["X-Workspace-Id"] = workspace_id
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urlrequest.Request(url, method=method, headers=headers, data=data)
    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            payload = json.loads(raw.decode("utf-8")) if raw else {}
            return int(resp.status), payload if isinstance(payload, dict) else {}
    except urlerror.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            payload = {"ok": False, "errors": [{"message": raw.decode("utf-8", errors="replace")}]}
        return int(exc.code), payload if isinstance(payload, dict) else {}


def is_ok(payload: dict[str, Any]) -> bool:
    return bool(payload.get("ok") is True)


def collect_error_text(payload: dict[str, Any]) -> str:
    errors = payload.get("errors")
    if not isinstance(errors, list) or not errors:
        return "Unknown error"
    parts: list[str] = []
    for entry in errors[:8]:
        if isinstance(entry, dict):
            code = entry.get("code")
            message = entry.get("message")
            path = entry.get("path")
            prefix = f"[{code}] " if isinstance(code, str) and code else ""
            suffix = f" ({path})" if isinstance(path, str) and path else ""
            parts.append(f"{prefix}{message or 'Error'}{suffix}")
        else:
            parts.append(str(entry))
    return "; ".join(parts)


def has_error_code(payload: dict[str, Any], code: str) -> bool:
    errors = payload.get("errors")
    if not isinstance(errors, list):
        return False
    for entry in errors:
        if isinstance(entry, dict) and entry.get("code") == code:
            return True
    return False


def jwt_expiry_seconds(token: str | None) -> int | None:
    if not token:
        return None
    parts = token.split(".")
    if len(parts) < 2:
        return None
    try:
        padded = parts[1] + ("=" * (-len(parts[1]) % 4))
        claims = json.loads(base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8"))
    except Exception:
        return None
    exp = claims.get("exp")
    if isinstance(exp, (int, float)):
        return int(exp) - int(time.time())
    return None


def require_token_window(token: str | None, *, min_seconds: int, label: str) -> None:
    remaining = jwt_expiry_seconds(token)
    if remaining is None:
        return
    if remaining <= 0:
        raise SystemExit(f"{label}: OCTO_API_TOKEN is expired. Refresh it before running this script.")
    if remaining < min_seconds:
        minutes = max(1, remaining // 60)
        required = max(1, min_seconds // 60)
        raise SystemExit(
            f"{label}: OCTO_API_TOKEN expires in about {minutes} minute(s). "
            f"Refresh it before running this script; this run needs at least {required} minute(s)."
        )


def read_manifest_entities(folder: Path, filenames: list[str]) -> tuple[set[str], dict[str, set[str]]]:
    entity_ids: set[str] = set()
    deps: dict[str, set[str]] = {}
    manifests: list[dict[str, Any]] = []

    for name in filenames:
        path = folder / name
        if not path.exists():
            raise RuntimeError(f"Missing manifest file: {path}")
        manifest = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            continue
        manifests.append(manifest)
        for entity in manifest.get("entities", []):
            if not isinstance(entity, dict):
                continue
            entity_id = entity.get("id")
            if not isinstance(entity_id, str) or not entity_id:
                continue
            entity_ids.add(entity_id)
            deps.setdefault(entity_id, set())

    for manifest in manifests:
        for entity in manifest.get("entities", []):
            if not isinstance(entity, dict):
                continue
            entity_id = entity.get("id")
            if entity_id not in entity_ids:
                continue
            fields = entity.get("fields")
            if not isinstance(fields, list):
                continue
            for field in fields:
                if not isinstance(field, dict):
                    continue
                if field.get("type") != "lookup":
                    continue
                target = field.get("entity")
                if isinstance(target, str) and target in entity_ids and target != entity_id:
                    deps.setdefault(entity_id, set()).add(target)

    return entity_ids, deps


def entity_delete_order(entity_ids: set[str], deps: dict[str, set[str]]) -> list[str]:
    graph = {entity_id: set(deps.get(entity_id, set())) for entity_id in entity_ids}
    try:
        order = list(TopologicalSorter(graph).static_order())
    except Exception:
        order = sorted(entity_ids)
    order.reverse()
    return order


def list_record_ids(base_url: str, token: str | None, workspace_id: str | None, entity_id: str, cap: int) -> list[str]:
    out: list[str] = []
    cursor: str | None = None
    while len(out) < cap:
        params: dict[str, str | int] = {"limit": min(200, cap - len(out))}
        if cursor:
            params["cursor"] = cursor
        status, payload = api_call(
            "GET",
            f"{base_url}/records/{urlparse.quote(entity_id, safe='')}?{urlparse.urlencode(params)}",
            token=token,
            workspace_id=workspace_id,
            timeout=120,
        )
        if status >= 400 or not is_ok(payload):
            if has_error_code(payload, "ENTITY_NOT_FOUND"):
                return []
            raise RuntimeError(f"list {entity_id} failed: {collect_error_text(payload)}")
        rows = payload.get("records")
        if not isinstance(rows, list) or not rows:
            break
        for row in rows:
            if not isinstance(row, dict):
                continue
            record_id = row.get("record_id")
            if isinstance(record_id, str) and record_id:
                out.append(record_id)
        cursor = payload.get("next_cursor") if isinstance(payload.get("next_cursor"), str) else None
        if not cursor:
            break
    return out


def delete_record(base_url: str, token: str | None, workspace_id: str | None, entity_id: str, record_id: str) -> None:
    status, payload = api_call(
        "DELETE",
        f"{base_url}/records/{urlparse.quote(entity_id, safe='')}/{urlparse.quote(record_id, safe='')}",
        token=token,
        workspace_id=workspace_id,
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(collect_error_text(payload))


def main() -> int:
    parser = argparse.ArgumentParser(description="Delete Luke commercial_v2 workspace data so it can be reseeded.")
    parser.add_argument("--base-url", default=os.getenv("OCTO_BASE_URL", "http://localhost:8000"), help="API base URL")
    parser.add_argument("--token", default=os.getenv("OCTO_API_TOKEN", "").strip(), help="Bearer token")
    parser.add_argument("--workspace-id", default=os.getenv("OCTO_WORKSPACE_ID", "").strip(), help="Workspace ID")
    parser.add_argument("--max-per-entity", type=int, default=50000, help="Safety cap per entity")
    parser.add_argument("--include-settings", action="store_true", help="Also delete settings/config entities from settings.json")
    parser.add_argument("--dry-run", action="store_true", help="Print counts only, do not delete")
    parser.add_argument("--continue-on-error", action="store_true", help="Continue when one delete fails")
    args = parser.parse_args()

    base_url = (args.base_url or "").strip().rstrip("/")
    token = (args.token or "").strip() or None
    workspace_id = (args.workspace_id or "").strip() or None
    if not base_url:
        raise SystemExit("Missing --base-url or OCTO_BASE_URL")
    if not workspace_id:
        raise SystemExit("Missing --workspace-id or OCTO_WORKSPACE_ID")
    if args.max_per_entity <= 0:
        raise SystemExit("--max-per-entity must be > 0")
    if not args.dry_run:
        require_token_window(token, min_seconds=8 * 60, label="clear_workspace_data")

    folder = Path(__file__).resolve().parent
    manifest_files = list(DEFAULT_MANIFEST_FILES)
    if args.include_settings:
        manifest_files.extend(SETTINGS_MANIFEST_FILES)

    entity_ids, deps = read_manifest_entities(folder, manifest_files)
    order = entity_delete_order(entity_ids, deps)

    print("[clear] manifest folder:", folder)
    print("[clear] workspace:", workspace_id)
    print("[clear] entities:")
    for entity_id in order:
        print(f"  - {entity_id}")

    print("\n[clear] scanning current records...")
    per_entity_ids: dict[str, list[str]] = {}
    total = 0
    for entity_id in order:
        ids = list_record_ids(base_url, token, workspace_id, entity_id, cap=args.max_per_entity)
        per_entity_ids[entity_id] = ids
        total += len(ids)
        print(f"  - {entity_id}: {len(ids)}")

    print(f"\n[clear] total matched: {total}")
    if args.dry_run:
        return 0

    deleted = 0
    failed = 0
    for entity_id in order:
        ids = per_entity_ids.get(entity_id, [])
        if not ids:
            continue
        print(f"\n[clear] deleting {entity_id} ({len(ids)})...")
        for record_id in ids:
            try:
                delete_record(base_url, token, workspace_id, entity_id, record_id)
                deleted += 1
            except Exception as exc:
                failed += 1
                print(f"  delete failed {entity_id}/{record_id}: {exc}")
                if not args.continue_on_error:
                    print("\n[clear] stopped on first error. Re-run with --continue-on-error.", file=sys.stderr)
                    return 1

    print("\n[clear] summary:")
    print(f"  deleted: {deleted}")
    print(f"  failed:  {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
