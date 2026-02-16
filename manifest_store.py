"""In-memory manifest snapshot store with apply/rollback pipeline."""

from __future__ import annotations

import copy
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

from octo.manifest_hash import manifest_hash


Issue = Dict[str, Any]


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _issue(code: str, message: str, path: str | None = None, detail: dict | None = None) -> Issue:
    return {"code": code, "message": message, "path": path, "detail": detail}


def _decode_segment(segment: str) -> str:
    return segment.replace("~1", "/").replace("~0", "~")


def _parse_pointer(pointer: str) -> List[str]:
    if pointer == "":
        return []
    parts = pointer.split("/")
    if parts and parts[0] == "":
        parts = parts[1:]
    return [_decode_segment(p) for p in parts]


def _get_container_and_token(doc: Any, pointer: str) -> Tuple[Any, str]:
    tokens = _parse_pointer(pointer)
    if not tokens:
        return (None, "")
    current = doc
    for token in tokens[:-1]:
        if isinstance(current, dict):
            if token not in current:
                raise KeyError("Missing object key")
            current = current[token]
        elif isinstance(current, list):
            if not token.isdigit():
                raise IndexError("Invalid list index")
            idx = int(token)
            if idx < 0 or idx >= len(current):
                raise IndexError("List index out of range")
            current = current[idx]
        else:
            raise TypeError("Cannot traverse into non-container")
    return current, tokens[-1]


def _get_value(doc: Any, pointer: str) -> Any:
    tokens = _parse_pointer(pointer)
    current = doc
    for token in tokens:
        if isinstance(current, dict):
            if token not in current:
                raise KeyError("Missing object key")
            current = current[token]
        elif isinstance(current, list):
            if not token.isdigit():
                raise IndexError("Invalid list index")
            idx = int(token)
            if idx < 0 or idx >= len(current):
                raise IndexError("List index out of range")
            current = current[idx]
        else:
            raise TypeError("Cannot traverse into non-container")
    return current


def _apply_add(doc: Any, path: str, value: Any) -> None:
    if path == "":
        raise ValueError("Cannot add at document root")
    container, token = _get_container_and_token(doc, path)
    if isinstance(container, dict):
        container[token] = value
        return
    if isinstance(container, list):
        if token == "-":
            container.append(value)
            return
        if not token.isdigit():
            raise IndexError("Invalid list index")
        idx = int(token)
        if idx < 0 or idx > len(container):
            raise IndexError("List index out of range")
        container.insert(idx, value)
        return
    raise TypeError("Cannot add into non-container")


def _apply_remove(doc: Any, path: str) -> None:
    container, token = _get_container_and_token(doc, path)
    if isinstance(container, dict):
        if token not in container:
            raise KeyError("Missing object key")
        del container[token]
        return
    if isinstance(container, list):
        if not token.isdigit():
            raise IndexError("Invalid list index")
        idx = int(token)
        if idx < 0 or idx >= len(container):
            raise IndexError("List index out of range")
        del container[idx]
        return
    raise TypeError("Cannot remove from non-container")


def _apply_replace(doc: Any, path: str, value: Any) -> None:
    if path == "":
        raise ValueError("Cannot replace document root")
    container, token = _get_container_and_token(doc, path)
    if isinstance(container, dict):
        if token not in container:
            raise KeyError("Missing object key")
        container[token] = value
        return
    if isinstance(container, list):
        if not token.isdigit():
            raise IndexError("Invalid list index")
        idx = int(token)
        if idx < 0 or idx >= len(container):
            raise IndexError("List index out of range")
        container[idx] = value
        return
    raise TypeError("Cannot replace in non-container")


def _apply_test(doc: Any, path: str, value: Any) -> None:
    existing = _get_value(doc, path)
    if existing != value:
        raise ValueError("Test operation failed")


def _apply_move(doc: Any, from_path: str, path: str) -> None:
    value = _get_value(doc, from_path)
    _apply_remove(doc, from_path)
    _apply_add(doc, path, value)


def _apply_copy(doc: Any, from_path: str, path: str) -> None:
    value = copy.deepcopy(_get_value(doc, from_path))
    _apply_add(doc, path, value)


def _apply_ops(doc: Any, ops: List[dict]) -> None:
    for op in ops:
        name = op.get("op")
        if name == "add":
            _apply_add(doc, op["path"], op["value"])
        elif name == "remove":
            _apply_remove(doc, op["path"])
        elif name == "replace":
            _apply_replace(doc, op["path"], op["value"])
        elif name == "move":
            _apply_move(doc, op["from"], op["path"])
        elif name == "copy":
            _apply_copy(doc, op["from"], op["path"])
        elif name == "test":
            _apply_test(doc, op["path"], op["value"])
        else:
            raise ValueError("Unsupported op")


class ManifestStore:
    def __init__(self) -> None:
        self._snapshots: Dict[str, Dict[str, dict]] = {}
        self._head: Dict[str, str] = {}
        self._audit: Dict[str, List[dict]] = {}

    def get_head(self, module_id: str) -> str | None:
        return self._head.get(module_id)

    def get_snapshot(self, module_id: str, manifest_hash_value: str) -> dict:
        record = self._snapshots.get(module_id, {}).get(manifest_hash_value)
        if record is None:
            raise KeyError("Snapshot not found")
        return copy.deepcopy(record["manifest"])

    def list_history(self, module_id: str) -> list[dict]:
        return list(self._audit.get(module_id, []))

    def list_snapshots(self, module_id: str) -> list[dict]:
        records = self._snapshots.get(module_id, {})
        items = []
        for manifest_hash_value, record in records.items():
            items.append(
                {
                    "manifest_hash": manifest_hash_value,
                    "created_at": record.get("created_at"),
                    "created_by": record.get("created_by"),
                    "reason": record.get("reason"),
                }
            )
        items.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        return items

    def init_module(self, module_id: str, manifest: dict, actor: dict | None = None, reason: str = "init") -> str:
        manifest_copy = copy.deepcopy(manifest)
        new_hash = manifest_hash(manifest_copy)
        record = {
            "module_id": module_id,
            "manifest_hash": new_hash,
            "manifest": manifest_copy,
            "created_at": _now(),
            "created_by": actor,
            "reason": reason,
        }
        self._snapshots.setdefault(module_id, {})[new_hash] = record
        self._head[module_id] = new_hash
        audit = {
            "audit_id": str(uuid.uuid4()),
            "module_id": module_id,
            "action": "init",
            "patch_id": None,
            "from_hash": None,
            "to_hash": new_hash,
            "actor": actor,
            "reason": reason,
            "at": _now(),
        }
        self._audit.setdefault(module_id, []).insert(0, audit)
        return new_hash

    def apply_approved_preview(self, approved: dict) -> dict:
        errors: List[Issue] = []
        warnings: List[Issue] = []

        if not isinstance(approved, dict):
            errors.append(_issue("APPLY_INVALID", "approved must be object", "$"))
            return {"ok": False, "errors": errors, "warnings": warnings, "from_hash": None, "to_hash": None, "audit_id": None}

        patch = approved.get("patch")
        preview = approved.get("preview")
        if not isinstance(patch, dict) or not isinstance(preview, dict):
            errors.append(_issue("APPLY_INVALID", "patch and preview required", "$"))
            return {"ok": False, "errors": errors, "warnings": warnings, "from_hash": None, "to_hash": None, "audit_id": None}

        if preview.get("ok") is not True:
            errors.append(_issue("APPLY_PREVIEW_NOT_OK", "preview.ok must be true", "preview.ok"))
            return {"ok": False, "errors": errors, "warnings": warnings, "from_hash": None, "to_hash": None, "audit_id": None}

        if patch.get("mode") != "preview":
            errors.append(_issue("APPLY_INVALID", "patch.mode must be preview", "patch.mode"))
            return {"ok": False, "errors": errors, "warnings": warnings, "from_hash": None, "to_hash": None, "audit_id": None}

        module_id = patch.get("target_module_id")
        from_hash = patch.get("target_manifest_hash")
        if not isinstance(module_id, str) or not isinstance(from_hash, str):
            errors.append(_issue("APPLY_INVALID", "module_id and from_hash required", "patch"))
            return {"ok": False, "errors": errors, "warnings": warnings, "from_hash": None, "to_hash": None, "audit_id": None}

        head = self._head.get(module_id)
        if head != from_hash:
            errors.append(_issue("APPLY_HASH_MISMATCH", "from_hash does not match head", "patch.target_manifest_hash"))
            return {"ok": False, "errors": errors, "warnings": warnings, "from_hash": from_hash, "to_hash": None, "audit_id": None}

        current_record = self._snapshots.get(module_id, {}).get(from_hash)
        if current_record is None:
            errors.append(_issue("APPLY_UNKNOWN_HASH", "from_hash not found", "patch.target_manifest_hash"))
            return {"ok": False, "errors": errors, "warnings": warnings, "from_hash": from_hash, "to_hash": None, "audit_id": None}

        resolved_ops = preview.get("resolved_ops")
        if not isinstance(resolved_ops, list):
            errors.append(_issue("APPLY_INVALID", "resolved_ops must be list", "preview.resolved_ops"))
            return {"ok": False, "errors": errors, "warnings": warnings, "from_hash": from_hash, "to_hash": None, "audit_id": None}

        for idx, op in enumerate(resolved_ops):
            if not isinstance(op, dict):
                errors.append(_issue("APPLY_INVALID", "op must be object", f"preview.resolved_ops[{idx}]"))
                return {"ok": False, "errors": errors, "warnings": warnings, "from_hash": from_hash, "to_hash": None, "audit_id": None}
            for key in ("path", "from"):
                if key in op and isinstance(op[key], str) and "@[id=" in op[key]:
                    errors.append(_issue("APPLY_UNRESOLVED_SELECTOR", "selector segment found", f"preview.resolved_ops[{idx}].{key}"))
                    return {"ok": False, "errors": errors, "warnings": warnings, "from_hash": from_hash, "to_hash": None, "audit_id": None}

        new_manifest = copy.deepcopy(current_record["manifest"])
        try:
            _apply_ops(new_manifest, resolved_ops)
        except Exception as exc:
            errors.append(_issue("APPLY_FAILED", str(exc), "preview.resolved_ops"))
            return {"ok": False, "errors": errors, "warnings": warnings, "from_hash": from_hash, "to_hash": None, "audit_id": None}

        try:
            to_hash = manifest_hash(new_manifest)
        except Exception as exc:
            errors.append(_issue("APPLY_MANIFEST_INVALID", str(exc), "manifest"))
            return {"ok": False, "errors": errors, "warnings": warnings, "from_hash": from_hash, "to_hash": None, "audit_id": None}

        record = {
            "module_id": module_id,
            "manifest_hash": to_hash,
            "manifest": copy.deepcopy(new_manifest),
            "created_at": _now(),
            "created_by": approved.get("approved_by"),
            "reason": patch.get("reason"),
        }
        self._snapshots.setdefault(module_id, {})[to_hash] = record
        self._head[module_id] = to_hash

        audit_id = str(uuid.uuid4())
        audit = {
            "audit_id": audit_id,
            "module_id": module_id,
            "action": "apply",
            "patch_id": patch.get("patch_id"),
            "from_hash": from_hash,
            "to_hash": to_hash,
            "actor": approved.get("approved_by"),
            "reason": patch.get("reason"),
            "at": approved.get("approved_at"),
        }
        self._audit.setdefault(module_id, []).insert(0, audit)

        return {
            "ok": True,
            "errors": errors,
            "warnings": warnings,
            "from_hash": from_hash,
            "to_hash": to_hash,
            "audit_id": audit_id,
        }

    def rollback(self, module_id: str, to_hash: str, actor: dict, reason: str) -> dict:
        errors: List[Issue] = []
        warnings: List[Issue] = []

        if module_id not in self._snapshots:
            errors.append(_issue("ROLLBACK_UNKNOWN_MODULE", "module not found", "module_id"))
            return {"ok": False, "errors": errors, "warnings": warnings, "from_hash": None, "to_hash": None, "audit_id": None}

        if to_hash not in self._snapshots[module_id]:
            errors.append(_issue("ROLLBACK_UNKNOWN_HASH", "hash not found", "to_hash"))
            return {"ok": False, "errors": errors, "warnings": warnings, "from_hash": None, "to_hash": None, "audit_id": None}

        from_hash = self._head.get(module_id)
        self._head[module_id] = to_hash

        audit_id = str(uuid.uuid4())
        audit = {
            "audit_id": audit_id,
            "module_id": module_id,
            "action": "rollback",
            "patch_id": None,
            "from_hash": from_hash,
            "to_hash": to_hash,
            "actor": actor,
            "reason": reason,
            "at": _now(),
        }
        self._audit.setdefault(module_id, []).insert(0, audit)

        return {
            "ok": True,
            "errors": errors,
            "warnings": warnings,
            "from_hash": from_hash,
            "to_hash": to_hash,
            "audit_id": audit_id,
        }
