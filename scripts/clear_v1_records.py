#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from graphlib import TopologicalSorter
from pathlib import Path
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest


def _api_call(
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


def _is_ok(payload: dict[str, Any]) -> bool:
    return bool(payload.get("ok") is True)


def _collect_error_text(payload: dict[str, Any]) -> str:
    errors = payload.get("errors")
    if not isinstance(errors, list) or not errors:
        return "Unknown error"
    lines: list[str] = []
    for entry in errors[:6]:
        if isinstance(entry, dict):
            code = entry.get("code")
            message = entry.get("message")
            path = entry.get("path")
            prefix = f"[{code}] " if isinstance(code, str) and code else ""
            suffix = f" ({path})" if isinstance(path, str) and path else ""
            lines.append(f"{prefix}{message or 'Error'}{suffix}")
        else:
            lines.append(str(entry))
    return "; ".join(lines)


def _parse_modules_filter(raw: str) -> set[str]:
    return {part.strip() for part in raw.split(",") if part.strip()}


def _read_manifest_entities(manifest_dir: Path, pattern: str, selected_modules: set[str]) -> tuple[set[str], dict[str, set[str]]]:
    files = sorted(manifest_dir.glob(pattern))
    if not files:
        raise RuntimeError(f"No manifest files matched: {manifest_dir}/{pattern}")
    entity_ids: set[str] = set()
    deps: dict[str, set[str]] = {}
    for path in files:
        text = path.read_text(encoding="utf-8")
        manifest = json.loads(text)
        if not isinstance(manifest, dict):
            continue
        module = manifest.get("module")
        module_id = module.get("id") if isinstance(module, dict) else None
        module_key = module.get("key") if isinstance(module, dict) else None
        if selected_modules and module_id not in selected_modules and module_key not in selected_modules:
            continue
        entities = manifest.get("entities")
        if not isinstance(entities, list):
            continue
        for entity in entities:
            if not isinstance(entity, dict):
                continue
            entity_id = entity.get("id")
            if not isinstance(entity_id, str) or not entity_id:
                continue
            entity_ids.add(entity_id)
            deps.setdefault(entity_id, set())
    for path in files:
        text = path.read_text(encoding="utf-8")
        manifest = json.loads(text)
        if not isinstance(manifest, dict):
            continue
        module = manifest.get("module")
        module_id = module.get("id") if isinstance(module, dict) else None
        module_key = module.get("key") if isinstance(module, dict) else None
        if selected_modules and module_id not in selected_modules and module_key not in selected_modules:
            continue
        entities = manifest.get("entities")
        if not isinstance(entities, list):
            continue
        for entity in entities:
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
                if isinstance(target, str) and target in entity_ids:
                    deps.setdefault(entity_id, set()).add(target)
    return entity_ids, deps


def _entity_delete_order(entity_ids: set[str], deps: dict[str, set[str]]) -> list[str]:
    graph = {entity_id: set(deps.get(entity_id, set())) for entity_id in entity_ids}
    try:
        order = list(TopologicalSorter(graph).static_order())
    except Exception:
        order = sorted(entity_ids)
    order.reverse()
    return order


def _list_record_ids(base_url: str, token: str | None, workspace_id: str | None, entity_id: str, cap: int) -> list[str]:
    out: list[str] = []
    cursor: str | None = None
    while len(out) < cap:
        params: dict[str, Any] = {"limit": min(200, cap - len(out))}
        if cursor:
            params["cursor"] = cursor
        url = f"{base_url}/records/{urlparse.quote(entity_id, safe='')}"
        status, payload = _api_call(
            "GET",
            f"{url}?{urlparse.urlencode(params)}",
            token=token,
            workspace_id=workspace_id,
        )
        if status >= 400 or not _is_ok(payload):
            break
        rows = payload.get("records")
        if not isinstance(rows, list) or not rows:
            break
        for row in rows:
            if not isinstance(row, dict):
                continue
            rid = row.get("record_id")
            if isinstance(rid, str) and rid:
                out.append(rid)
        cursor = payload.get("next_cursor") if isinstance(payload.get("next_cursor"), str) else None
        if not cursor:
            break
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Delete all records for marketplace v1 module entities.")
    parser.add_argument("--dir", default="manifests/marketplace_v1", help="Manifest directory")
    parser.add_argument("--pattern", default="*.json", help="Manifest file glob pattern")
    parser.add_argument("--base-url", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--token", default="", help="Bearer token (or env OCTO_API_TOKEN)")
    parser.add_argument("--workspace-id", default="", help="Workspace id (or env OCTO_WORKSPACE_ID)")
    parser.add_argument("--modules", default="", help="Comma-separated module ids/keys to include")
    parser.add_argument("--max-per-entity", type=int, default=50000, help="Safety cap for records listed per entity")
    parser.add_argument("--dry-run", action="store_true", help="Print counts only, do not delete")
    parser.add_argument("--continue-on-error", action="store_true", help="Continue when one entity fails")
    args = parser.parse_args()

    manifest_dir = Path(args.dir)
    if not manifest_dir.exists():
        print(f"Manifest directory not found: {manifest_dir}", file=sys.stderr)
        return 2
    if args.max_per_entity <= 0:
        print("--max-per-entity must be > 0", file=sys.stderr)
        return 2

    token = (args.token or "").strip() or os.environ.get("OCTO_API_TOKEN", "").strip()
    workspace_id = (args.workspace_id or "").strip() or os.environ.get("OCTO_WORKSPACE_ID", "").strip()
    selected_modules = _parse_modules_filter(args.modules)

    try:
        entity_ids, deps = _read_manifest_entities(manifest_dir, args.pattern, selected_modules)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if not entity_ids:
        print("No entity IDs found from manifests.", file=sys.stderr)
        return 2

    order = _entity_delete_order(entity_ids, deps)
    base_url = args.base_url.rstrip("/")

    print("Entity delete order:")
    for idx, entity_id in enumerate(order, start=1):
        print(f"  {idx}. {entity_id}")

    total_listed = 0
    per_entity_ids: dict[str, list[str]] = {}
    print("\nScanning current records...")
    for entity_id in order:
        ids = _list_record_ids(base_url, token or None, workspace_id or None, entity_id, cap=args.max_per_entity)
        per_entity_ids[entity_id] = ids
        total_listed += len(ids)
        print(f"  - {entity_id}: {len(ids)}")

    print(f"\nTotal records matched: {total_listed}")
    if args.dry_run:
        return 0

    deleted = 0
    failed = 0
    for entity_id in order:
        ids = per_entity_ids.get(entity_id, [])
        if not ids:
            continue
        print(f"\nDeleting {entity_id} ({len(ids)})...")
        for record_id in ids:
            url = f"{base_url}/records/{urlparse.quote(entity_id, safe='')}/{urlparse.quote(record_id, safe='')}"
            status, payload = _api_call("DELETE", url, token=token or None, workspace_id=workspace_id or None)
            if status >= 400 or not _is_ok(payload):
                failed += 1
                print(f"  delete failed {entity_id}/{record_id}: {_collect_error_text(payload)}")
                if not args.continue_on_error:
                    print("\nStopped on first error. Re-run with --continue-on-error.", file=sys.stderr)
                    return 1
                continue
            deleted += 1

    print("\nClear summary:")
    print(f"  deleted: {deleted}")
    print(f"  failed:  {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
