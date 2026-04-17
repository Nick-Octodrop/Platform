#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest


@dataclass
class ManifestFile:
    path: Path
    manifest: dict[str, Any]


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def api_call(
    method: str,
    url: str,
    *,
    token: str | None = None,
    workspace_id: str | None = None,
    body: dict[str, Any] | None = None,
    timeout: int = 120,
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
    return bool(payload.get("ok") is True or payload.get("status") == "ok")


def collect_error_text(payload: dict[str, Any]) -> str:
    errors = payload.get("errors")
    if not isinstance(errors, list) or not errors:
        detail = payload.get("detail")
        if isinstance(detail, str) and detail:
            return detail
        return "Unknown error"
    parts: list[str] = []
    for entry in errors[:10]:
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


def error_codes(payload: dict[str, Any]) -> list[str]:
    errors = payload.get("errors")
    if not isinstance(errors, list):
        return []
    codes: list[str] = []
    for entry in errors:
        if not isinstance(entry, dict):
            continue
        code = entry.get("code")
        if isinstance(code, str) and code:
            codes.append(code)
    return codes


def first_error(payload: dict[str, Any]) -> dict[str, Any] | None:
    errors = payload.get("errors")
    if not isinstance(errors, list) or not errors:
        return None
    first = errors[0]
    return first if isinstance(first, dict) else None


def _bundle_paths(folder: Path) -> list[Path]:
    bundle_path = folder / "bundle.json"
    if not bundle_path.exists():
        return sorted(
            path
            for path in folder.rglob("*.json")
            if path.name != "bundle.json" and "docs" not in path.parts and "_shared" not in path.parts
        )
    bundle = json.loads(bundle_path.read_text())
    manifest_paths = bundle.get("manifests")
    if not isinstance(manifest_paths, list):
        raise SystemExit(f"Invalid bundle.json in {folder}: 'manifests' list required")
    resolved: list[Path] = []
    for rel in manifest_paths:
        if not isinstance(rel, str) or not rel.strip():
            continue
        target = (bundle_path.parent / rel).resolve()
        if not target.exists():
            raise SystemExit(f"Missing manifest referenced by {bundle_path}: {rel}")
        resolved.append(target)
    return resolved


def load_manifest_files(folder: Path) -> list[ManifestFile]:
    manifest_files: list[ManifestFile] = []
    for path in _bundle_paths(folder):
        data = json.loads(path.read_text())
        if not isinstance(data, dict):
            raise SystemExit(f"Manifest is not an object: {path}")
        manifest_files.append(ManifestFile(path=path, manifest=data))
    return manifest_files


def _module_id(manifest: dict[str, Any]) -> str:
    module = manifest.get("module")
    if not isinstance(module, dict):
        raise SystemExit("Manifest missing module block")
    module_id = module.get("id")
    if not isinstance(module_id, str) or not module_id:
        raise SystemExit("Manifest missing module.id")
    return module_id


def _module_name(manifest: dict[str, Any]) -> str | None:
    module = manifest.get("module")
    if not isinstance(module, dict):
        return None
    name = module.get("name")
    return name.strip() if isinstance(name, str) and name.strip() else None


def _module_key(manifest: dict[str, Any]) -> str | None:
    module = manifest.get("module")
    if not isinstance(module, dict):
        return None
    key = module.get("key")
    if isinstance(key, str) and key.strip():
        return key.strip()
    module_id = module.get("id")
    return module_id.strip() if isinstance(module_id, str) and module_id.strip() else None


def _normalize_identity(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.strip().lower().split())
    return cleaned or None


def _depends_on_ids(manifest: dict[str, Any]) -> list[str]:
    deps = manifest.get("depends_on")
    if isinstance(deps, dict):
        collected: list[str] = []
        entries = deps.get("required")
        if not isinstance(entries, list):
            return collected
        for dep in entries:
            if isinstance(dep, str) and dep:
                collected.append(dep)
                continue
            if isinstance(dep, dict):
                module_id = dep.get("module") or dep.get("id")
                if isinstance(module_id, str) and module_id:
                    collected.append(module_id)
        return collected
    if not isinstance(deps, list):
        return []
    out: list[str] = []
    for dep in deps:
        if isinstance(dep, str) and dep:
            out.append(dep)
            continue
        if isinstance(dep, dict):
            module_id = dep.get("module") or dep.get("id")
            if isinstance(module_id, str) and module_id:
                out.append(module_id)
    return out


def order_manifest_files(files: list[ManifestFile]) -> list[ManifestFile]:
    by_module = {_module_id(item.manifest): item for item in files}
    incoming: dict[str, set[str]] = {module_id: set() for module_id in by_module}
    outgoing: dict[str, set[str]] = defaultdict(set)
    for module_id, item in by_module.items():
        for dep in _depends_on_ids(item.manifest):
            if dep not in by_module:
                continue
            incoming[module_id].add(dep)
            outgoing[dep].add(module_id)
    queue = deque(sorted(module_id for module_id, deps in incoming.items() if not deps))
    ordered: list[str] = []
    while queue:
        module_id = queue.popleft()
        ordered.append(module_id)
        for dependent in sorted(outgoing.get(module_id, ())):
            incoming[dependent].discard(module_id)
            if not incoming[dependent]:
                queue.append(dependent)
    if len(ordered) != len(by_module):
        remaining = sorted(set(by_module) - set(ordered))
        ordered.extend(remaining)
    return [by_module[module_id] for module_id in ordered]


def _fetch_installed_modules(base_url: str, token: str | None, workspace_id: str | None) -> list[dict[str, Any]]:
    status, payload = api_call(
        "GET",
        f"{base_url}/studio2/modules",
        token=token,
        workspace_id=workspace_id,
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise SystemExit(f"Failed to read installed modules: {collect_error_text(payload)}")
    data = payload.get("data")
    modules = data.get("modules") if isinstance(data, dict) else None
    return [item for item in modules if isinstance(item, dict)] if isinstance(modules, list) else []


def _installed_module_ids(installed: list[dict[str, Any]]) -> set[str]:
    out: set[str] = set()
    for item in installed:
        module_id = item.get("module_id")
        if isinstance(module_id, str) and module_id:
            out.add(module_id)
    return out


def _module_installed(
    base_url: str,
    token: str | None,
    workspace_id: str | None,
    module_id: str,
    *,
    retries: int = 5,
    delay_seconds: float = 1.0,
) -> bool:
    for attempt in range(max(1, retries)):
        installed = _fetch_installed_modules(base_url, token, workspace_id)
        if module_id in _installed_module_ids(installed):
            return True

        status, payload = api_call(
            "GET",
            f"{base_url}/studio2/modules/{urlparse.quote(module_id, safe='')}/manifest",
            token=token,
            workspace_id=workspace_id,
            timeout=120,
        )
        data = payload.get("data") if isinstance(payload, dict) else None
        if (
            status < 400
            and is_ok(payload)
            and isinstance(data, dict)
            and data.get("module_id") == module_id
            and isinstance(data.get("manifest_hash"), str)
            and data.get("manifest_hash")
        ):
            return True

        if attempt < retries - 1:
            time.sleep(delay_seconds)
    return False


def _archive_module(base_url: str, token: str | None, workspace_id: str | None, module_id: str) -> None:
    status, payload = api_call(
        "DELETE",
        f"{base_url}/modules/{urlparse.quote(module_id, safe='')}?archive=true",
        token=token,
        workspace_id=workspace_id,
        timeout=240,
    )
    if status >= 400 or not is_ok(payload):
        raise SystemExit(f"Archive failed for {module_id}: {collect_error_text(payload)}")


def _archive_module_recursive(
    base_url: str,
    token: str | None,
    workspace_id: str | None,
    module_id: str,
    *,
    seen: set[str] | None = None,
) -> None:
    active = seen if isinstance(seen, set) else set()
    if module_id in active:
        return
    active.add(module_id)
    status, payload = api_call(
        "DELETE",
        f"{base_url}/modules/{urlparse.quote(module_id, safe='')}?archive=true",
        token=token,
        workspace_id=workspace_id,
        timeout=240,
    )
    if status < 400 and is_ok(payload):
        return
    err = first_error(payload) or {}
    code = err.get("code")
    detail = err.get("detail") if isinstance(err.get("detail"), dict) else {}
    if code == "MODULE_DISABLE_BLOCKED_BY_DEPENDENTS":
        dependents = detail.get("enabled_dependents")
        if isinstance(dependents, list):
            for dep in dependents:
                if not isinstance(dep, str) or not dep.startswith("module_"):
                    continue
                _archive_module_recursive(base_url, token, workspace_id, dep, seen=active)
            status, payload = api_call(
                "DELETE",
                f"{base_url}/modules/{urlparse.quote(module_id, safe='')}?archive=true",
                token=token,
                workspace_id=workspace_id,
                timeout=240,
            )
            if status < 400 and is_ok(payload):
                return
    raise SystemExit(f"Archive failed for {module_id}: {collect_error_text(payload)}")


def _conflicting_modules(installed: list[dict[str, Any]], manifest: dict[str, Any]) -> list[dict[str, Any]]:
    desired_id = _module_id(manifest)
    desired_name = _normalize_identity(_module_name(manifest))
    desired_key = _normalize_identity(_module_key(manifest))
    conflicts: list[dict[str, Any]] = []
    for mod in installed:
        module_id = mod.get("module_id")
        if not isinstance(module_id, str) or not module_id or module_id == desired_id:
            continue
        existing_name = _normalize_identity(mod.get("name") if isinstance(mod.get("name"), str) else None)
        existing_key = _normalize_identity(mod.get("module_key") if isinstance(mod.get("module_key"), str) else None)
        if desired_key and existing_key == desired_key:
            conflicts.append(mod)
            continue
        if desired_name and existing_name == desired_name:
            conflicts.append(mod)
            continue
    return conflicts


def _select_install_target(installed: list[dict[str, Any]], manifest: dict[str, Any]) -> tuple[str, dict[str, Any] | None, list[dict[str, Any]]]:
    desired_id = _module_id(manifest)
    exact: dict[str, Any] | None = None
    for mod in installed:
        module_id = mod.get("module_id")
        if isinstance(module_id, str) and module_id == desired_id:
            exact = mod
            break
    conflicts = _conflicting_modules(installed, manifest)
    if exact is not None:
        return desired_id, exact, conflicts
    if len(conflicts) == 1:
        conflict = conflicts[0]
        conflict_id = conflict.get("module_id")
        if isinstance(conflict_id, str) and conflict_id:
            return conflict_id, conflict, conflicts
    return desired_id, None, conflicts


def install_folder(folder: Path, *, dry_run: bool = False, base_url: str | None = None, token: str | None = None, workspace_id: str | None = None) -> int:
    files = order_manifest_files(load_manifest_files(folder))
    if not files:
        raise SystemExit(f"No manifests found in {folder}")
    base_url = (base_url or os.environ.get("OCTO_BASE_URL", "")).strip().rstrip("/")
    token = (token or os.environ.get("OCTO_API_TOKEN", "")).strip() or None
    workspace_id = (workspace_id or os.environ.get("OCTO_WORKSPACE_ID", "")).strip() or None
    if not dry_run and not base_url:
        raise SystemExit("Missing --base-url or OCTO_BASE_URL")
    if not dry_run and not token:
        raise SystemExit("Missing --token or OCTO_API_TOKEN")
    print(f"[install] folder: {folder}")
    pending = list(files)
    max_rounds = max(3, len(pending) + 3)
    for round_index in range(1, max_rounds + 1):
        next_pending: list[ManifestFile] = []
        progress = False
        for item in pending:
            manifest_module_id = _module_id(item.manifest)
            print(f"[install] {'plan   ' if dry_run else 'apply  '} {manifest_module_id} <- {item.path.relative_to(_repo_root())}")
            if dry_run:
                continue
            installed = _fetch_installed_modules(base_url, token, workspace_id)
            target_module_id, incumbent, conflicts = _select_install_target(installed, item.manifest)
            if len(conflicts) > 1 and incumbent is None:
                labels = ", ".join(
                    str(conflict.get("module_id") or conflict.get("name") or "unknown")
                    for conflict in conflicts
                )
                raise SystemExit(
                    f"Install failed for {manifest_module_id}: multiple existing modules match this manifest. "
                    f"Resolve manually before upgrading: {labels}"
                )
            if incumbent is not None and target_module_id != manifest_module_id:
                incumbent_name = incumbent.get("name") if isinstance(incumbent.get("name"), str) else target_module_id
                print(f"[install] adopt  {target_module_id} ({incumbent_name}) <- manifest {manifest_module_id}")
            status, payload = api_call(
                "POST",
                f"{base_url}/studio2/modules/{urlparse.quote(target_module_id, safe='')}/install",
                token=token,
                workspace_id=workspace_id,
                body={"manifest": item.manifest},
                timeout=240,
            )
            if status < 400 and is_ok(payload):
                if not _module_installed(base_url, token, workspace_id, target_module_id):
                    raise SystemExit(
                        f"Install reported success for {target_module_id}, but it is not present in /studio2/modules for workspace {workspace_id or 'default'}"
                    )
                progress = True
                continue
            codes = set(error_codes(payload))
            if "MODULE_DEPENDENCY_MISSING" in codes and round_index < max_rounds:
                print(f"[install] defer  {manifest_module_id} waiting for dependency registration")
                next_pending.append(item)
                continue
            raise SystemExit(f"Install failed for {manifest_module_id}: {collect_error_text(payload)}")
        if dry_run:
            break
        if not next_pending:
            break
        if not progress:
            if round_index < max_rounds:
                print("[install] wait   allowing dependency registration to catch up")
                time.sleep(3)
            else:
                stalled = ", ".join(_module_id(item.manifest) for item in next_pending)
                raise SystemExit(f"Install stalled waiting on dependencies: {stalled}")
        pending = next_pending
    print("[install] complete")
    return 0


def _slug(text: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "_" for ch in text).strip("_") or "sample"


def _field_options(field: dict[str, Any]) -> list[str]:
    options = field.get("options")
    if not isinstance(options, list):
        return []
    out: list[str] = []
    for option in options:
        if isinstance(option, dict):
            option_id = option.get("id") or option.get("value")
            if isinstance(option_id, str) and option_id:
                out.append(option_id)
        elif isinstance(option, str) and option:
            out.append(option)
    return out


def _value_for_field(
    field: dict[str, Any],
    *,
    entity_id: str,
    entity_label: str,
    index: int,
    created_refs: dict[str, list[str]],
) -> Any:
    if field.get("readonly"):
        return None
    if "default" in field:
        return field.get("default")
    field_type = str(field.get("type") or "string").lower()
    field_id = str(field.get("id") or "")
    label = str(field.get("label") or field_id.split(".")[-1].replace("_", " ").title())
    lower = f"{field_id} {label}".lower()
    if field_type == "lookup":
        target = field.get("entity")
        if isinstance(target, str) and created_refs.get(target):
            return created_refs[target][0]
        return None
    if field_type in {"enum", "select"}:
        options = _field_options(field)
        return options[0] if options else None
    if field_type in {"boolean", "bool"}:
        return False
    if field_type in {"integer", "int"}:
        if "year" in lower:
            return date.today().year
        if "sort" in lower or "order" in lower:
            return index
        return 1 + index
    if field_type in {"number", "float", "decimal", "currency"}:
        if "percent" in lower or "probability" in lower:
            return 50
        if "rate" in lower:
            return 15
        if "qty" in lower or "quantity" in lower:
            return 1
        return 100 + index
    if field_type == "date":
        if "due" in lower or "end" in lower or "target" in lower:
            return (date.today() + timedelta(days=7 + index)).isoformat()
        return date.today().isoformat()
    if field_type in {"datetime", "timestamp"}:
        when = datetime.now(timezone.utc) + timedelta(hours=index)
        return when.isoformat().replace("+00:00", "Z")
    if field_type in {"json", "object", "array", "attachments", "attachment", "image", "file"}:
        return None
    if "email" in lower:
        return f"{_slug(entity_label)}_{index}@example.com"
    if "website" in lower or "url" in lower:
        return f"https://example.com/{_slug(entity_label)}"
    if "phone" in lower or "mobile" in lower:
        return "+64 9 555 0100"
    if "country" in lower:
        return "New Zealand"
    if "city" in lower:
        return "Auckland"
    if "state" in lower or "region" in lower:
        return "Auckland"
    if "postcode" in lower or "zip" in lower:
        return "1010"
    if "currency" in lower:
        return "NZD"
    if "timezone" in lower:
        return "Pacific/Auckland"
    if "language" in lower:
        return "en-NZ"
    if "code" in lower:
        return f"{_slug(entity_label)[:6].upper()}-{index:03d}"
    if "number" in lower:
        return f"{_slug(entity_label)[:3].upper()}-{date.today().year}-{index:04d}"
    if "status" in lower:
        return "active"
    if "priority" in lower:
        return "medium"
    if "name" in lower or "title" in lower or "subject" in lower or "summary" in lower:
        return f"Sample {entity_label} {index}"
    if "description" in lower or "notes" in lower:
        return f"Sample data for {entity_label.lower()} {index}."
    if field.get("required"):
        return f"Sample {label} {index}"
    return None


def _entity_dependencies(entity: dict[str, Any]) -> set[str]:
    deps: set[str] = set()
    for field in entity.get("fields", []):
        if not isinstance(field, dict):
            continue
        if str(field.get("type") or "").lower() != "lookup":
            continue
        target = field.get("entity")
        if isinstance(target, str) and target:
            deps.add(target)
    return deps


def _order_entities(entities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {entity["id"]: entity for entity in entities if isinstance(entity, dict) and isinstance(entity.get("id"), str)}
    incoming: dict[str, set[str]] = {entity_id: set() for entity_id in by_id}
    outgoing: dict[str, set[str]] = defaultdict(set)
    for entity_id, entity in by_id.items():
        for dep in _entity_dependencies(entity):
            if dep not in by_id:
                continue
            incoming[entity_id].add(dep)
            outgoing[dep].add(entity_id)
    queue = deque(sorted(entity_id for entity_id, deps in incoming.items() if not deps))
    ordered: list[str] = []
    while queue:
        entity_id = queue.popleft()
        ordered.append(entity_id)
        for dependent in sorted(outgoing.get(entity_id, ())):
            incoming[dependent].discard(entity_id)
            if not incoming[dependent]:
                queue.append(dependent)
    if len(ordered) != len(by_id):
        ordered.extend(sorted(set(by_id) - set(ordered)))
    return [by_id[entity_id] for entity_id in ordered]


def seed_folder(folder: Path, *, dry_run: bool = False, base_url: str | None = None, token: str | None = None, workspace_id: str | None = None, records_per_entity: int = 1) -> int:
    files = load_manifest_files(folder)
    base_url = (base_url or os.environ.get("OCTO_BASE_URL", "")).strip().rstrip("/")
    token = (token or os.environ.get("OCTO_API_TOKEN", "")).strip() or None
    workspace_id = (workspace_id or os.environ.get("OCTO_WORKSPACE_ID", "")).strip() or None
    if not dry_run and not base_url:
        raise SystemExit("Missing --base-url or OCTO_BASE_URL")
    if not dry_run and not token:
        raise SystemExit("Missing --token or OCTO_API_TOKEN")
    entities: list[dict[str, Any]] = []
    for item in files:
        for entity in item.manifest.get("entities", []):
            if isinstance(entity, dict) and isinstance(entity.get("id"), str):
                entities.append(entity)
    created_refs: dict[str, list[str]] = defaultdict(list)
    print(f"[seed] folder: {folder}")
    for entity in _order_entities(entities):
        entity_id = entity["id"]
        entity_label = str(entity.get("label") or entity_id.split(".")[-1].replace("_", " ").title())
        for index in range(1, records_per_entity + 1):
            record: dict[str, Any] = {}
            for field in entity.get("fields", []):
                if not isinstance(field, dict):
                    continue
                field_id = field.get("id")
                if not isinstance(field_id, str) or not field_id:
                    continue
                value = _value_for_field(field, entity_id=entity_id, entity_label=entity_label, index=index, created_refs=created_refs)
                if value is None:
                    continue
                record[field_id] = value
            print(f"[seed] {'plan   ' if dry_run else 'create '} {entity_id}")
            if dry_run:
                created_refs[entity_id].append(f"dry-run:{entity_id}:{index}")
                continue
            status, payload = api_call(
                "POST",
                f"{base_url}/records/{urlparse.quote(entity_id, safe='')}",
                token=token,
                workspace_id=workspace_id,
                body={"record": record},
                timeout=240,
            )
            if status >= 400 or not is_ok(payload):
                print(f"[seed] skip   {entity_id}: {collect_error_text(payload)}")
                continue
            record_id = payload.get("record_id")
            if isinstance(record_id, str) and record_id:
                created_refs[entity_id].append(record_id)
                print(f"[seed] created {entity_id} -> {record_id}")
    print("[seed] complete")
    return 0


def run_install_cli(folder: Path) -> int:
    parser = argparse.ArgumentParser(description=f"Install manifests from {folder}")
    parser.add_argument("--base-url", default=os.environ.get("OCTO_BASE_URL", "").strip(), help="Octodrop API base URL")
    parser.add_argument("--token", default=os.environ.get("OCTO_API_TOKEN", "").strip(), help="Bearer token")
    parser.add_argument("--workspace-id", default=os.environ.get("OCTO_WORKSPACE_ID", "").strip(), help="Workspace ID")
    parser.add_argument("--dry-run", action="store_true", help="Print the install order without applying manifests")
    args = parser.parse_args()
    return install_folder(folder, dry_run=args.dry_run, base_url=args.base_url, token=args.token, workspace_id=args.workspace_id)


def run_seed_cli(folder: Path) -> int:
    parser = argparse.ArgumentParser(description=f"Seed example data for manifests in {folder}")
    parser.add_argument("--base-url", default=os.environ.get("OCTO_BASE_URL", "").strip(), help="Octodrop API base URL")
    parser.add_argument("--token", default=os.environ.get("OCTO_API_TOKEN", "").strip(), help="Bearer token")
    parser.add_argument("--workspace-id", default=os.environ.get("OCTO_WORKSPACE_ID", "").strip(), help="Workspace ID")
    parser.add_argument("--dry-run", action="store_true", help="Print the seed plan without creating records")
    parser.add_argument("--records-per-entity", type=int, default=1, help="How many example records to create per entity")
    args = parser.parse_args()
    return seed_folder(
        folder,
        dry_run=args.dry_run,
        base_url=args.base_url,
        token=args.token,
        workspace_id=args.workspace_id,
        records_per_entity=max(1, args.records_per_entity),
    )
