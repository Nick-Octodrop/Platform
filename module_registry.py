"""In-memory module registry with install/upgrade via ManifestStore."""

from __future__ import annotations

import copy
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from manifest_store import ManifestStore


Issue = Dict[str, Any]


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _issue(code: str, message: str, path: str | None = None, detail: dict | None = None) -> Issue:
    return {"code": code, "message": message, "path": path, "detail": detail}


def _is_hash(value: Any) -> bool:
    return isinstance(value, str) and value.startswith("sha256:")


class ModuleRegistry:
    def __init__(self, manifest_store: ManifestStore) -> None:
        self._store = manifest_store
        self._modules: Dict[str, dict] = {}
        self._audit: Dict[str, List[dict]] = {}
        self._versions: Dict[str, List[dict]] = {}
        self._icons: Dict[str, str] = {}

    def get(self, module_id: str) -> dict | None:
        record = self._modules.get(module_id)
        if not record:
            return None
        record = copy.deepcopy(record)
        if module_id in self._icons:
            record["icon_key"] = self._icons[module_id]
        return record

    def list(self) -> list[dict]:
        modules = []
        for mid in sorted(self._modules.keys()):
            record = self._modules[mid]
            if record.get("archived"):
                continue
            rec = copy.deepcopy(record)
            if mid in self._icons:
                rec["icon_key"] = self._icons[mid]
            modules.append(rec)
        return modules

    def history(self, module_id: str) -> list[dict]:
        return list(self._audit.get(module_id, []))

    def register(self, module_id: str, name: str | None, actor: dict | None, reason: str = "register") -> dict:
        errors: List[Issue] = []
        warnings: List[Issue] = []

        if module_id in self._modules:
            errors.append(_issue("MODULE_ALREADY_REGISTERED", "module already registered", "module_id"))
            return {"ok": False, "errors": errors, "warnings": warnings, "module": None, "audit_id": None}

        head = self._store.get_head(module_id)
        if head is None:
            errors.append(_issue("MODULE_NO_MANIFEST_HEAD", "module has no manifest head", "module_id"))
            return {"ok": False, "errors": errors, "warnings": warnings, "module": None, "audit_id": None}

        record = {
            "module_id": module_id,
            "name": name,
            "enabled": False,
            "current_hash": head,
            "installed_at": _now(),
            "updated_at": _now(),
            "tags": None,
            "status": "installed",
            "active_version": None,
            "last_error": None,
            "archived": False,
        }
        self._modules[module_id] = copy.deepcopy(record)

        audit_id = str(uuid.uuid4())
        audit = {
            "audit_id": audit_id,
            "module_id": module_id,
            "action": "register",
            "from_hash": None,
            "to_hash": head,
            "patch_id": None,
            "actor": actor,
            "reason": reason,
            "at": _now(),
        }
        self._audit.setdefault(module_id, []).insert(0, audit)

        return {"ok": True, "errors": errors, "warnings": warnings, "module": copy.deepcopy(record), "audit_id": audit_id}

    def list_versions(self, module_id: str) -> list[dict]:
        return copy.deepcopy(self._versions.get(module_id, []))

    def _next_version_num(self, module_id: str) -> int:
        versions = self._versions.get(module_id, [])
        if not versions:
            return 1
        return max(v.get("version_num", 0) for v in versions) + 1

    def _create_version(self, module_id: str, manifest_hash: str, manifest: dict, actor: dict | None, notes: str | None) -> dict:
        version_id = str(uuid.uuid4())
        version = {
            "version_id": version_id,
            "version_num": self._next_version_num(module_id),
            "manifest_hash": manifest_hash,
            "manifest": copy.deepcopy(manifest),
            "created_at": _now(),
            "created_by": copy.deepcopy(actor) if actor else None,
            "notes": notes,
        }
        self._versions.setdefault(module_id, []).append(version)
        return version

    def _find_version(
        self,
        module_id: str,
        *,
        version_id: str | None = None,
        version_num: int | None = None,
        manifest_hash: str | None = None,
    ) -> dict | None:
        for version in self._versions.get(module_id, []):
            if version_id and version.get("version_id") == version_id:
                return copy.deepcopy(version)
            if version_num and version.get("version_num") == version_num:
                return copy.deepcopy(version)
            if manifest_hash and version.get("manifest_hash") == manifest_hash:
                return copy.deepcopy(version)
        return None

    def install(self, approved: dict) -> dict:
        return self._apply(approved, action="install", auto_register=True)

    def upgrade(self, approved: dict) -> dict:
        return self._apply(approved, action="upgrade", auto_register=False)

    def set_enabled(self, module_id: str, enabled: bool, actor: dict | None, reason: str) -> dict:
        errors: List[Issue] = []
        warnings: List[Issue] = []

        record = self._modules.get(module_id)
        if record is None:
            errors.append(_issue("MODULE_NOT_FOUND", "module not found", "module_id"))
            return {"ok": False, "errors": errors, "warnings": warnings, "module": None, "audit_id": None}

        if record.get("enabled") == enabled:
            warnings.append(_issue("MODULE_ENABLED_NOOP", "no change", "enabled"))

        record = copy.deepcopy(record)
        record["enabled"] = enabled
        record["updated_at"] = _now()
        self._modules[module_id] = copy.deepcopy(record)

        audit_id = str(uuid.uuid4())
        audit = {
            "audit_id": audit_id,
            "module_id": module_id,
            "action": "enable" if enabled else "disable",
            "from_hash": record.get("current_hash"),
            "to_hash": record.get("current_hash"),
            "patch_id": None,
            "actor": actor,
            "reason": reason,
            "at": _now(),
        }
        self._audit.setdefault(module_id, []).insert(0, audit)

        return {"ok": True, "errors": errors, "warnings": warnings, "module": copy.deepcopy(record), "audit_id": audit_id}

    def set_icon(self, module_id: str, icon_key: str) -> None:
        self._icons[module_id] = icon_key

    def clear_icon(self, module_id: str) -> None:
        if module_id in self._icons:
            del self._icons[module_id]

    def rollback(
        self,
        module_id: str,
        to_hash: str,
        actor: dict | None,
        reason: str,
        *,
        to_version_id: str | None = None,
        to_version_num: int | None = None,
    ) -> dict:
        errors: List[Issue] = []
        warnings: List[Issue] = []

        record = self._modules.get(module_id)
        if record is None:
            errors.append(_issue("MODULE_NOT_FOUND", "module not found", "module_id"))
            return {"ok": False, "errors": errors, "warnings": warnings, "module": None, "audit_id": None}

        target_version = None
        if to_version_id or to_version_num:
            target_version = self._find_version(module_id, version_id=to_version_id, version_num=to_version_num)
            if not target_version:
                errors.append(_issue("ROLLBACK_UNKNOWN_VERSION", "version not found", "to_version_id"))
                return {"ok": False, "errors": errors, "warnings": warnings, "module": None, "audit_id": None}
            to_hash = target_version.get("manifest_hash")
        if not isinstance(to_hash, str) or not _is_hash(to_hash):
            errors.append(_issue("ROLLBACK_INVALID_HASH", "to_hash must be a manifest hash", "to_hash"))
            return {"ok": False, "errors": errors, "warnings": warnings, "module": None, "audit_id": None}

        store_result = self._store.rollback(module_id, to_hash, actor=actor, reason=reason)
        if not store_result.get("ok"):
            errors.extend(store_result.get("errors", []))
            return {"ok": False, "errors": errors, "warnings": warnings, "module": None, "audit_id": None}

        from_hash = record.get("current_hash")
        if from_hash == to_hash:
            warnings.append(_issue("MODULE_ALREADY_AT_SNAPSHOT", "module already at requested snapshot", "to_hash"))

        record = copy.deepcopy(record)
        record["current_hash"] = to_hash
        record["updated_at"] = _now()
        record["status"] = "installed"
        record["last_error"] = None
        if not target_version:
            target_version = self._find_version(module_id, manifest_hash=to_hash)
        if target_version:
            record["active_version"] = target_version.get("version_id")
        self._modules[module_id] = copy.deepcopy(record)

        audit_id = store_result.get("audit_id") or str(uuid.uuid4())
        audit = {
            "audit_id": audit_id,
            "module_id": module_id,
            "action": "rollback",
            "from_hash": from_hash,
            "to_hash": to_hash,
            "patch_id": None,
            "actor": actor,
            "reason": reason,
            "at": _now(),
        }
        self._audit.setdefault(module_id, []).insert(0, audit)

        return {"ok": True, "errors": errors, "warnings": warnings, "module": copy.deepcopy(record), "audit_id": audit_id}

    def _apply(self, approved: dict, action: str, auto_register: bool) -> dict:
        errors: List[Issue] = []
        warnings: List[Issue] = []

        if not isinstance(approved, dict) or not isinstance(approved.get("patch"), dict):
            errors.append(_issue("MODULE_INVALID", "approved preview invalid", "approved"))
            return {"ok": False, "errors": errors, "warnings": warnings, "module": None, "audit_id": None}

        patch = approved.get("patch")
        module_id = patch.get("target_module_id")
        if not isinstance(module_id, str):
            errors.append(_issue("MODULE_INVALID", "target_module_id required", "patch.target_module_id"))
            return {"ok": False, "errors": errors, "warnings": warnings, "module": None, "audit_id": None}

        if patch.get("mode") != "preview":
            errors.append(_issue("MODULE_INVALID", "patch.mode must be preview", "patch.mode"))
            return {"ok": False, "errors": errors, "warnings": warnings, "module": None, "audit_id": None}

        record = self._modules.get(module_id)
        if record is None:
            if auto_register:
                record = None
            else:
                errors.append(_issue("MODULE_NOT_FOUND", "module not found", "module_id"))
                return {"ok": False, "errors": errors, "warnings": warnings, "module": None, "audit_id": None}

        store_result = self._store.apply_approved_preview(approved)
        if not store_result.get("ok"):
            errors.extend(store_result.get("errors", []))
            if record is not None:
                record = copy.deepcopy(record)
                record["status"] = "failed"
                record["last_error"] = errors[0]["message"] if errors else "apply failed"
                record["updated_at"] = _now()
                self._modules[module_id] = copy.deepcopy(record)
            return {"ok": False, "errors": errors, "warnings": warnings, "module": None, "audit_id": None}

        to_hash = store_result.get("to_hash")
        if not _is_hash(to_hash):
            errors.append(_issue("MODULE_INVALID", "invalid to_hash", "to_hash"))
            return {"ok": False, "errors": errors, "warnings": warnings, "module": None, "audit_id": None}

        manifest = self._store.get_snapshot(module_id, to_hash)

        if record is None:
            record = {
                "module_id": module_id,
                "name": None,
                "enabled": True,
                "current_hash": to_hash,
                "installed_at": _now(),
                "updated_at": _now(),
                "tags": None,
                "status": "installed",
                "active_version": None,
                "last_error": None,
                "archived": False,
            }
        else:
            record = copy.deepcopy(record)
            record["current_hash"] = to_hash
            record["updated_at"] = _now()
            if action == "install":
                record["enabled"] = True
            record["status"] = "installed"
            record["last_error"] = None

        version = self._create_version(module_id, to_hash, manifest, approved.get("approved_by"), notes=patch.get("reason"))
        record["active_version"] = version.get("version_id")
        self._modules[module_id] = copy.deepcopy(record)

        audit_id = str(uuid.uuid4())
        audit = {
            "audit_id": audit_id,
            "module_id": module_id,
            "action": action,
            "from_hash": store_result.get("from_hash"),
            "to_hash": to_hash,
            "patch_id": patch.get("patch_id"),
            "transaction_group_id": patch.get("transaction_group_id"),
            "actor": approved.get("approved_by"),
            "reason": patch.get("reason"),
            "at": _now(),
        }
        self._audit.setdefault(module_id, []).insert(0, audit)

        return {"ok": True, "errors": errors, "warnings": warnings, "module": copy.deepcopy(record), "audit_id": audit_id}
