#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from graphlib import TopologicalSorter
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest


DEFAULT_EXCLUDED_CATEGORIES = {
    "settings",
    "system",
    "admin",
    "security",
    "platform",
    "studio",
    "integrations",
}

DEFAULT_EXCLUDED_MODULE_PREFIXES = (
    "settings_",
    "system_",
    "studio_",
    "core_",
    "admin_",
    "platform_",
    "integration_",
)


@dataclass(frozen=True)
class InstalledManifest:
    module_id: str
    module_key: str
    name: str
    category: str
    enabled: bool
    manifest: dict[str, Any]


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
    return any(isinstance(entry, dict) and entry.get("code") == code for entry in errors)


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


def trimmed(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def lowered_set(values: list[str] | tuple[str, ...] | set[str]) -> set[str]:
    return {trimmed(value).lower() for value in values if trimmed(value)}


def fetch_installed_modules(base_url: str, *, token: str | None, workspace_id: str | None) -> list[dict[str, Any]]:
    status, payload = api_call(
        "GET",
        f"{base_url}/studio2/modules",
        token=token,
        workspace_id=workspace_id,
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"Failed to read installed modules: {collect_error_text(payload)}")
    data = payload.get("data")
    modules = data.get("modules") if isinstance(data, dict) else None
    return [item for item in modules if isinstance(item, dict)] if isinstance(modules, list) else []


def fetch_installed_manifest(
    base_url: str,
    module_id: str,
    *,
    token: str | None,
    workspace_id: str | None,
) -> InstalledManifest:
    status, payload = api_call(
        "GET",
        f"{base_url}/studio2/modules/{urlparse.quote(module_id, safe='')}/manifest",
        token=token,
        workspace_id=workspace_id,
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"Failed to read manifest for {module_id}: {collect_error_text(payload)}")
    data = payload.get("data")
    manifest = data.get("manifest") if isinstance(data, dict) else None
    if not isinstance(manifest, dict):
        raise RuntimeError(f"Manifest payload missing for {module_id}")
    module_meta = manifest.get("module") if isinstance(manifest.get("module"), dict) else {}
    return InstalledManifest(
        module_id=module_id,
        module_key=trimmed(module_meta.get("key")) or trimmed(data.get("module_key")),
        name=trimmed(module_meta.get("name")) or module_id,
        category=trimmed(module_meta.get("category")) or trimmed(data.get("category")),
        enabled=True,
        manifest=manifest,
    )


def should_include_module(
    installed_row: dict[str, Any],
    installed_manifest: InstalledManifest,
    *,
    excluded_categories: set[str],
    excluded_modules: set[str],
    excluded_prefixes: tuple[str, ...],
    included_modules: set[str],
    enabled_only: bool,
) -> tuple[bool, str]:
    module_id = installed_manifest.module_id
    module_key = installed_manifest.module_key or trimmed(installed_row.get("module_key"))
    category = installed_manifest.category or trimmed(installed_row.get("category"))
    enabled = bool(installed_row.get("enabled", True))
    lower_id = module_id.lower()
    lower_key = module_key.lower()

    if included_modules and lower_id not in included_modules and lower_key not in included_modules:
        return False, "not included"
    if enabled_only and not enabled:
        return False, "disabled"
    if lower_id in excluded_modules or lower_key in excluded_modules:
        return False, "excluded module"
    category_key = category.lower()
    if category_key and category_key in excluded_categories:
        return False, f"excluded category:{category}"
    for prefix in excluded_prefixes:
        if lower_id.startswith(prefix) or lower_key.startswith(prefix):
            return False, f"excluded prefix:{prefix}"
    return True, "included"


def collect_entity_dependencies(manifests: list[InstalledManifest]) -> tuple[set[str], dict[str, set[str]]]:
    entity_ids: set[str] = set()
    deps: dict[str, set[str]] = {}
    for item in manifests:
        for entity in item.manifest.get("entities", []):
            if not isinstance(entity, dict):
                continue
            entity_id = entity.get("id")
            if not isinstance(entity_id, str) or not entity_id:
                continue
            entity_ids.add(entity_id)
            deps.setdefault(entity_id, set())
    for item in manifests:
        for entity in item.manifest.get("entities", []):
            if not isinstance(entity, dict):
                continue
            entity_id = entity.get("id")
            if entity_id not in entity_ids:
                continue
            fields = entity.get("fields")
            if not isinstance(fields, list):
                continue
            for field in fields:
                if not isinstance(field, dict) or field.get("type") != "lookup":
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


def list_record_ids(
    base_url: str,
    *,
    token: str | None,
    workspace_id: str | None,
    entity_id: str,
    cap: int,
) -> tuple[list[str], bool]:
    out: list[str] = []
    cursor: str | None = None
    truncated = False
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
                return [], False
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
        cursor = payload.get("next_cursor") if isinstance(payload.get("next_cursor"), str) and payload.get("next_cursor") else None
        if not cursor:
            break
    if cursor and len(out) >= cap:
        truncated = True
    return out, truncated


def delete_record(
    base_url: str,
    *,
    token: str | None,
    workspace_id: str | None,
    entity_id: str,
    record_id: str,
) -> None:
    status, payload = api_call(
        "DELETE",
        f"{base_url}/records/{urlparse.quote(entity_id, safe='')}/{urlparse.quote(record_id, safe='')}",
        token=token,
        workspace_id=workspace_id,
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(collect_error_text(payload))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Delete record data for installed manifest modules while skipping system/settings-style modules."
    )
    parser.add_argument("--base-url", default=os.getenv("OCTO_BASE_URL", "http://localhost:8000"), help="API base URL")
    parser.add_argument("--token", default=os.getenv("OCTO_API_TOKEN", "").strip(), help="Bearer token")
    parser.add_argument("--workspace-id", default=os.getenv("OCTO_WORKSPACE_ID", "").strip(), help="Workspace ID")
    parser.add_argument("--max-per-entity", type=int, default=50000, help="Safety cap per entity")
    parser.add_argument("--dry-run", action="store_true", help="Print counts only, do not delete")
    parser.add_argument("--continue-on-error", action="store_true", help="Continue when one delete fails")
    parser.add_argument("--enabled-only", action="store_true", help="Only include enabled installed modules")
    parser.add_argument(
        "--exclude-category",
        action="append",
        default=[],
        help="Exclude modules by category label. Repeatable. Defaults already skip Settings/System/Admin/Security/Platform/Studio/Integrations.",
    )
    parser.add_argument(
        "--exclude-module",
        action="append",
        default=[],
        help="Exclude a specific module id or module key. Repeatable.",
    )
    parser.add_argument(
        "--include-module",
        action="append",
        default=[],
        help="If set, only these module ids or module keys are included. Repeatable.",
    )
    parser.add_argument(
        "--exclude-prefix",
        action="append",
        default=[],
        help="Exclude modules whose id or key starts with this prefix. Repeatable.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    base_url = trimmed(args.base_url).rstrip("/")
    token = trimmed(args.token) or None
    workspace_id = trimmed(args.workspace_id) or None
    if not base_url:
        raise SystemExit("Missing --base-url or OCTO_BASE_URL")
    if not workspace_id:
        raise SystemExit("Missing --workspace-id or OCTO_WORKSPACE_ID")
    if args.max_per_entity <= 0:
        raise SystemExit("--max-per-entity must be > 0")
    if not args.dry_run:
        require_token_window(token, min_seconds=10 * 60, label="clear_installed_manifest_records")

    excluded_categories = lowered_set([*DEFAULT_EXCLUDED_CATEGORIES, *args.exclude_category])
    excluded_modules = lowered_set(args.exclude_module)
    included_modules = lowered_set(args.include_module)
    excluded_prefixes = tuple(
        prefix.lower()
        for prefix in [*DEFAULT_EXCLUDED_MODULE_PREFIXES, *args.exclude_prefix]
        if trimmed(prefix)
    )

    installed_rows = fetch_installed_modules(base_url, token=token, workspace_id=workspace_id)
    if not installed_rows:
        print("[clear-installed] no installed modules found")
        return 0

    selected_manifests: list[InstalledManifest] = []
    skipped: list[tuple[str, str]] = []
    fetch_failed = 0

    print("[clear-installed] workspace:", workspace_id)
    print("[clear-installed] reading installed manifests...")
    for row in installed_rows:
        module_id = trimmed(row.get("module_id"))
        if not module_id:
            continue
        try:
            manifest_item = fetch_installed_manifest(base_url, module_id, token=token, workspace_id=workspace_id)
        except Exception as exc:
            fetch_failed += 1
            skipped.append((module_id, f"manifest fetch failed: {exc}"))
            continue
        include, reason = should_include_module(
            row,
            manifest_item,
            excluded_categories=excluded_categories,
            excluded_modules=excluded_modules,
            excluded_prefixes=excluded_prefixes,
            included_modules=included_modules,
            enabled_only=bool(args.enabled_only),
        )
        if include:
            selected_manifests.append(manifest_item)
        else:
            skipped.append((module_id, reason))

    if fetch_failed:
        print(f"[clear-installed] manifest fetch failures: {fetch_failed}")
    if skipped:
        print("[clear-installed] skipped modules:")
        for module_id, reason in skipped:
            print(f"  - {module_id}: {reason}")

    if not selected_manifests:
        print("[clear-installed] no modules matched the inclusion rules")
        return 0

    print("[clear-installed] included modules:")
    for item in selected_manifests:
        print(f"  - {item.module_id} [{item.category or 'Uncategorized'}] {item.name}")

    entity_ids, deps = collect_entity_dependencies(selected_manifests)
    order = entity_delete_order(entity_ids, deps)
    module_by_entity: dict[str, str] = {}
    for item in selected_manifests:
        for entity in item.manifest.get("entities", []):
            if not isinstance(entity, dict):
                continue
            entity_id = entity.get("id")
            if isinstance(entity_id, str) and entity_id:
                module_by_entity[entity_id] = item.module_id

    print("\n[clear-installed] entities in delete order:")
    for entity_id in order:
        print(f"  - {entity_id} ({module_by_entity.get(entity_id, 'unknown module')})")

    print("\n[clear-installed] scanning current records...")
    per_entity_ids: dict[str, list[str]] = {}
    total = 0
    truncated_entities: list[str] = []
    for entity_id in order:
        ids, truncated = list_record_ids(
            base_url,
            token=token,
            workspace_id=workspace_id,
            entity_id=entity_id,
            cap=args.max_per_entity,
        )
        per_entity_ids[entity_id] = ids
        total += len(ids)
        status = " (TRUNCATED)" if truncated else ""
        print(f"  - {entity_id}: {len(ids)}{status}")
        if truncated:
            truncated_entities.append(entity_id)

    if truncated_entities:
        print("\n[clear-installed] aborting: one or more entities exceeded --max-per-entity", file=sys.stderr)
        for entity_id in truncated_entities:
            print(f"  - {entity_id}", file=sys.stderr)
        return 1

    print(f"\n[clear-installed] total matched: {total}")
    if args.dry_run:
        return 0

    deleted = 0
    failed = 0
    for entity_id in order:
        ids = per_entity_ids.get(entity_id, [])
        if not ids:
            continue
        print(f"\n[clear-installed] deleting {entity_id} ({len(ids)})...")
        for record_id in ids:
            try:
                delete_record(
                    base_url,
                    token=token,
                    workspace_id=workspace_id,
                    entity_id=entity_id,
                    record_id=record_id,
                )
                deleted += 1
            except Exception as exc:
                failed += 1
                print(f"  delete failed {entity_id}/{record_id}: {exc}")
                if not args.continue_on_error:
                    print("\n[clear-installed] stopped on first error. Re-run with --continue-on-error.", file=sys.stderr)
                    return 1

    print("\n[clear-installed] summary:")
    print(f"  deleted: {deleted}")
    print(f"  failed:  {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
