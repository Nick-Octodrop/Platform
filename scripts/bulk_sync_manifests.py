#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from graphlib import TopologicalSorter
from pathlib import Path
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest


@dataclass
class ManifestFile:
    path: Path
    module_id: str
    module_key: str
    manifest: dict[str, Any]
    required_deps: list[str]


@dataclass
class InstalledModule:
    module_id: str
    module_key: str
    updated_at: str


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


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


def _parse_required_deps(manifest: dict[str, Any]) -> list[str]:
    depends_on = manifest.get("depends_on")
    if not isinstance(depends_on, dict):
        return []
    required = depends_on.get("required")
    if not isinstance(required, list):
        return []
    out: list[str] = []
    for item in required:
        if not isinstance(item, dict):
            continue
        module_id = item.get("module")
        if isinstance(module_id, str) and module_id.strip():
            out.append(module_id.strip())
    seen: set[str] = set()
    deduped: list[str] = []
    for dep in out:
        if dep in seen:
            continue
        seen.add(dep)
        deduped.append(dep)
    return deduped


def _parse_module_key(manifest: dict[str, Any], module_id: str) -> str:
    module = manifest.get("module")
    key = module.get("key") if isinstance(module, dict) else None
    if isinstance(key, str) and key.strip():
        return key.strip()
    return module_id


def _load_manifest_files(manifest_dir: Path, pattern: str, only: set[str] | None = None) -> dict[str, ManifestFile]:
    files = sorted(manifest_dir.glob(pattern))
    if not files:
        raise RuntimeError(f"No manifest files matched: {manifest_dir}/{pattern}")
    out: dict[str, ManifestFile] = {}
    for path in files:
        text = path.read_text(encoding="utf-8")
        try:
            manifest = json.loads(text)
        except Exception as exc:
            raise RuntimeError(f"Invalid JSON in {path}: {exc}") from exc
        if not isinstance(manifest, dict):
            raise RuntimeError(f"Manifest must be object: {path}")
        module = manifest.get("module")
        module_id = module.get("id") if isinstance(module, dict) else None
        if not isinstance(module_id, str) or not module_id.strip():
            raise RuntimeError(f"Missing module.id in {path}")
        module_id = module_id.strip()
        if only and module_id not in only:
            continue
        if module_id in out:
            raise RuntimeError(f"Duplicate module.id '{module_id}' in {path} and {out[module_id].path}")
        out[module_id] = ManifestFile(
            path=path,
            module_id=module_id,
            module_key=_parse_module_key(manifest, module_id),
            manifest=manifest,
            required_deps=_parse_required_deps(manifest),
        )
    if only:
        missing = sorted(only.difference(out.keys()))
        if missing:
            raise RuntimeError(f"Requested modules not found in directory: {', '.join(missing)}")
    return out


def _dependency_order(items: dict[str, ManifestFile]) -> list[str]:
    graph: dict[str, set[str]] = {}
    local_ids = set(items.keys())
    for module_id, item in items.items():
        graph[module_id] = {dep for dep in item.required_deps if dep in local_ids}
    sorter = TopologicalSorter(graph)
    return list(sorter.static_order())


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


def _is_ok(payload: dict[str, Any]) -> bool:
    return bool(payload.get("ok") is True)


def _load_installed_modules(base_url: str, token: str | None, workspace_id: str | None) -> list[InstalledModule]:
    status, payload = _api_call(
        "GET",
        f"{base_url}/modules",
        token=token,
        workspace_id=workspace_id,
    )
    if status >= 400:
        raise RuntimeError(f"Failed to list installed modules: {_collect_error_text(payload)}")
    rows = payload.get("modules")
    if not isinstance(rows, list):
        raise RuntimeError("Failed to list installed modules: malformed response from /modules")
    out: list[InstalledModule] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        module_id = row.get("module_id")
        if not isinstance(module_id, str) or not module_id:
            continue
        module_key = row.get("module_key")
        if not isinstance(module_key, str) or not module_key.strip():
            module_key = module_id
        updated_at = row.get("updated_at") if isinstance(row.get("updated_at"), str) else ""
        out.append(
            InstalledModule(
                module_id=module_id,
                module_key=module_key.strip(),
                updated_at=updated_at,
            )
        )
    return out


def _parse_target_map(raw: str) -> dict[str, str]:
    out: dict[str, str] = {}
    if not raw:
        return out
    for part in raw.split(","):
        token = part.strip()
        if not token:
            continue
        if "=" not in token:
            raise RuntimeError(f"Invalid --target-map item '{token}', expected key=module_id")
        left, right = token.split("=", 1)
        left = left.strip()
        right = right.strip()
        if not left or not right:
            raise RuntimeError(f"Invalid --target-map item '{token}', expected key=module_id")
        out[left] = right
    return out


def _resolve_target_module_ids(
    order: list[str],
    manifests: dict[str, ManifestFile],
    installed: list[InstalledModule],
    *,
    resolve_by_key: bool,
    target_overrides: dict[str, str] | None,
) -> tuple[dict[str, str], list[str]]:
    by_id = {item.module_id: item for item in installed}
    by_key: dict[str, list[InstalledModule]] = {}
    for item in installed:
        by_key.setdefault(item.module_key, []).append(item)
    target_overrides = target_overrides or {}
    resolved: dict[str, str] = {}
    notes: list[str] = []
    for local_id in order:
        item = manifests[local_id]
        override_target = target_overrides.get(local_id) or target_overrides.get(item.module_key)
        if isinstance(override_target, str) and override_target:
            resolved[local_id] = override_target
            notes.append(f"{local_id} -> {override_target} (override)")
            continue
        if resolve_by_key:
            candidates = by_key.get(item.module_key, [])
            if len(candidates) == 1:
                resolved[local_id] = candidates[0].module_id
                if candidates[0].module_id != local_id:
                    notes.append(f"{local_id} -> {candidates[0].module_id} (matched by key '{item.module_key}')")
                continue
            if len(candidates) > 1:
                ids = ", ".join(sorted(c.module_id for c in candidates))
                raise RuntimeError(
                    f"Ambiguous installed modules for key '{item.module_key}' ({local_id}): {ids}. "
                    "Archive duplicates or pass --target-map."
                )
        if local_id in by_id:
            resolved[local_id] = local_id
            continue
        resolved[local_id] = local_id
    return resolved, notes


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bulk validate/install Studio v1 manifests in dependency order.",
    )
    parser.add_argument("--dir", default="manifests/marketplace_v1", help="Manifest directory")
    parser.add_argument("--pattern", default="*.json", help="Glob pattern")
    parser.add_argument("--base-url", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--token", default="", help="Bearer token (or set OCTO_API_TOKEN)")
    parser.add_argument("--workspace-id", default="", help="Workspace header (or set OCTO_WORKSPACE_ID)")
    parser.add_argument("--reason", default="bulk_manifest_sync", help="Install reason/audit note")
    parser.add_argument("--only", default="", help="Comma-separated module ids to sync")
    parser.add_argument(
        "--target-map",
        default="",
        help="Optional key->module_id map, e.g. contacts=module_27052f,sales=module_326524",
    )
    parser.add_argument(
        "--no-resolve-by-key",
        action="store_true",
        help="Disable resolving local manifests to installed module ids by module.key",
    )
    parser.add_argument("--validate-first", action="store_true", help="Run server-side validate before install")
    parser.add_argument("--skip-equal", action="store_true", help="Skip install when server manifest is identical")
    parser.add_argument("--dry-run", action="store_true", help="Print order only")
    parser.add_argument("--continue-on-error", action="store_true", help="Continue when a module fails")
    args = parser.parse_args()

    token = (args.token or "").strip() or os.environ.get("OCTO_API_TOKEN", "").strip()
    workspace_id = (args.workspace_id or "").strip() or os.environ.get("OCTO_WORKSPACE_ID", "").strip()
    manifest_dir = Path(args.dir)
    if not manifest_dir.exists():
        print(f"Manifest directory not found: {manifest_dir}", file=sys.stderr)
        return 2

    only = {part.strip() for part in args.only.split(",") if part.strip()} if args.only else None
    try:
        manifests = _load_manifest_files(manifest_dir, args.pattern, only=only)
        order = _dependency_order(manifests)
        target_overrides = _parse_target_map(args.target_map)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 2

    base_url = args.base_url.rstrip("/")
    try:
        installed_modules = _load_installed_modules(base_url, token or None, workspace_id or None)
        target_ids, mapping_notes = _resolve_target_module_ids(
            order,
            manifests,
            installed_modules,
            resolve_by_key=not args.no_resolve_by_key,
            target_overrides=target_overrides,
        )
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 2

    print("Sync order:")
    for idx, module_id in enumerate(order, start=1):
        target_id = target_ids.get(module_id, module_id)
        if target_id == module_id:
            print(f"  {idx}. {module_id}  ({manifests[module_id].path})")
        else:
            print(f"  {idx}. {module_id} -> {target_id}  ({manifests[module_id].path})")
    if mapping_notes:
        print("\nMapping notes:")
        for note in mapping_notes:
            print(f"  - {note}")
    if args.dry_run:
        return 0

    failures = 0
    skipped = 0
    installed = 0

    for module_id in order:
        item = manifests[module_id]
        target_module_id = target_ids.get(module_id, module_id)
        print(f"\n[{module_id}] target={target_module_id}")

        if args.validate_first:
            status, payload = _api_call(
                "POST",
                f"{base_url}/studio2/modules/{target_module_id}/validate",
                token=token or None,
                workspace_id=workspace_id or None,
                body={"manifest": item.manifest},
            )
            if status >= 400 or not _is_ok(payload):
                failures += 1
                print(f"  validate failed: {_collect_error_text(payload)}")
                if not args.continue_on_error:
                    break
                continue
            data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
            errs = data.get("errors") if isinstance(data.get("errors"), list) else []
            completeness = data.get("completeness_errors") if isinstance(data.get("completeness_errors"), list) else []
            if errs or completeness:
                failures += 1
                print(f"  validate errors: {len(errs)}; completeness errors: {len(completeness)}")
                if not args.continue_on_error:
                    break
                continue
            print("  validate ok")

        if args.skip_equal:
            status, payload = _api_call(
                "GET",
                f"{base_url}/studio2/modules/{target_module_id}/manifest",
                token=token or None,
                workspace_id=workspace_id or None,
            )
            if status == 200 and _is_ok(payload):
                server_manifest = ((payload.get("data") or {}).get("manifest"))
                if _canonical_json(server_manifest) == _canonical_json(item.manifest):
                    skipped += 1
                    print("  unchanged; skipped")
                    continue

        status, payload = _api_call(
            "POST",
            f"{base_url}/studio2/modules/{target_module_id}/install",
            token=token or None,
            workspace_id=workspace_id or None,
            body={"manifest": item.manifest, "reason": args.reason},
            timeout=120,
        )
        if status >= 400 or not _is_ok(payload):
            failures += 1
            print(f"  install failed: {_collect_error_text(payload)}")
            if not args.continue_on_error:
                break
            continue

        installed += 1
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        from_hash = data.get("from_hash")
        to_hash = data.get("to_hash")
        print(f"  installed ok: {from_hash} -> {to_hash}")

    print("\nSummary:")
    print(f"  installed: {installed}")
    print(f"  skipped:   {skipped}")
    print(f"  failed:    {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
