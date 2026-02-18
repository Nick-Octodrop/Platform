"""DB-backed stores for product layer persistence."""

from __future__ import annotations

import base64
import copy
import json
import uuid
import logging
import os
import psycopg2
from datetime import datetime, timezone
from typing import Any, Dict, List

from octo.manifest_hash import manifest_hash

logger = logging.getLogger("octo.chatter")

from app.db import execute, fetch_all, fetch_one, get_conn, init_pool, _get_pool, set_active_conn, clear_active_conn


from contextvars import ContextVar

_ORG_ID: ContextVar[str] = ContextVar("org_id", default="default")


def _json_dumps(value: object) -> str:
    return json.dumps(value, default=str)


def get_org_id() -> str:
    return _ORG_ID.get()


def set_org_id(value: str):
    return _ORG_ID.set(value)


def reset_org_id(token):
    _ORG_ID.reset(token)
# Auto-migration allowlist (ALLOWED_AUTO_MIGRATION)
_ALLOWED_AUTO_MIGRATION_TABLES = {"module_draft_versions"}
_AUTO_MIGRATION_LOGGED: set[str] = set()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _deepcopy(value):
    return copy.deepcopy(value)


class _TxContext:
    def __init__(self, conn, pool):
        self.conn = conn
        self.pool = pool
        self.depth = 1
        self.failed = False


_TX_CONTEXT: list[_TxContext | None] = [None]


class DbTx:
    def __init__(self, ctx: _TxContext):
        self._ctx = ctx

    @property
    def conn(self):
        return self._ctx.conn

    def nest(self) -> "DbTx":
        self._ctx.depth += 1
        return DbTx(self._ctx)

    def commit(self) -> None:
        ctx = self._ctx
        if ctx.depth > 1:
            ctx.depth -= 1
            return
        try:
            if ctx.failed:
                ctx.conn.rollback()
            else:
                ctx.conn.commit()
        finally:
            ctx.pool.putconn(ctx.conn)
            _TX_CONTEXT[0] = None
            clear_active_conn()

    def rollback(self) -> None:
        ctx = self._ctx
        ctx.failed = True
        if ctx.depth > 1:
            ctx.depth -= 1
            return
        try:
            ctx.conn.rollback()
        finally:
            ctx.pool.putconn(ctx.conn)
            _TX_CONTEXT[0] = None
            clear_active_conn()


class DbTxManager:
    def begin(self) -> DbTx:
        ctx = _TX_CONTEXT[0]
        if ctx is not None:
            ctx.depth += 1
            return DbTx(ctx)
        init_pool()
        pool = _get_pool()
        conn = pool.getconn()
        ctx = _TxContext(conn, pool)
        _TX_CONTEXT[0] = ctx
        set_active_conn(conn)
        return DbTx(ctx)


def _ensure_json(value):
    if isinstance(value, str):
        return json.loads(value)
    return value


def _to_iso(value):
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%dT%H:%M:%SZ")
    return value


def _is_safe_field_id(value: str) -> bool:
    if not value or not isinstance(value, str):
        return False
    for ch in value:
        if not (ch.isalnum() or ch in "._-"):
            return False
    return True


def _encode_cursor(updated_at, record_id: str) -> str | None:
    if not updated_at or not record_id:
        return None
    ts = _to_iso(updated_at)
    raw = f"{ts}|{record_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8")


def _decode_cursor(cursor: str) -> tuple[str, str] | None:
    if not cursor or not isinstance(cursor, str):
        return None
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("utf-8")).decode("utf-8")
        if "|" not in raw:
            return None
        ts, record_id = raw.split("|", 1)
        if not ts or not record_id:
            return None
        return ts, record_id
    except Exception:
        return None


def _module_from_row(row: dict) -> dict:
    return {
        "module_id": row["module_id"],
        "name": row.get("name"),
        "enabled": row.get("enabled"),
        "current_hash": row.get("current_hash"),
        "installed_at": _to_iso(row.get("installed_at")),
        "updated_at": _to_iso(row.get("updated_at")),
        "tags": _ensure_json(row.get("tags")) if row.get("tags") is not None else None,
        "status": row.get("status"),
        "active_version": row.get("active_version"),
        "last_error": row.get("last_error"),
        "archived": row.get("archived"),
        "icon_key": row.get("icon_key"),
        "display_order": row.get("display_order"),
        "manifest_version": row.get("manifest_version"),
    }


def _module_name_from_manifest(manifest: dict) -> str | None:
    module = manifest.get("module") if isinstance(manifest, dict) else None
    if not isinstance(module, dict):
        return None
    name = module.get("name")
    return name if isinstance(name, str) and name.strip() else None


def _get_module_version_by_id(conn, module_id: str, version_id: str) -> dict | None:
    row = fetch_one(
        conn,
        """
        select version_id, version_num, manifest_hash, manifest, created_at, created_by, notes
        from module_versions
        where org_id=%s and module_id=%s and version_id=%s
        """,
        [get_org_id(), module_id, version_id],
        query_name="module_versions.get_by_id",
    )
    return row


def _get_module_version_by_num(conn, module_id: str, version_num: int) -> dict | None:
    row = fetch_one(
        conn,
        """
        select version_id, version_num, manifest_hash, manifest, created_at, created_by, notes
        from module_versions
        where org_id=%s and module_id=%s and version_num=%s
        """,
        [get_org_id(), module_id, version_num],
        query_name="module_versions.get_by_num",
    )
    return row


def _get_module_version_by_hash(conn, module_id: str, manifest_hash_value: str) -> dict | None:
    row = fetch_one(
        conn,
        """
        select version_id, version_num, manifest_hash, manifest, created_at, created_by, notes
        from module_versions
        where org_id=%s and module_id=%s and manifest_hash=%s
        """,
        [get_org_id(), module_id, manifest_hash_value],
        query_name="module_versions.get_by_hash",
    )
    return row


def _insert_module_version(conn, module_id: str, manifest_hash_value: str, manifest: dict, actor: dict | None, notes: str | None) -> dict:
    row = fetch_one(
        conn,
        """
        select max(version_num) as max_version
        from module_versions
        where org_id=%s and module_id=%s
        """,
        [get_org_id(), module_id],
        query_name="module_versions.max",
    )
    next_version = int(row.get("max_version") or 0) + 1
    version_id = str(uuid.uuid4())
    execute(
        conn,
        """
        insert into module_versions (org_id, module_id, version_id, version_num, manifest_hash, manifest, created_at, created_by, notes)
        values (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        [
            get_org_id(),
            module_id,
            version_id,
            next_version,
            manifest_hash_value,
            json.dumps(manifest),
            _now(),
            _json_dumps(actor) if actor else None,
            notes,
        ],
        query_name="module_versions.insert",
    )
    return {"version_id": version_id, "version_num": next_version, "manifest_hash": manifest_hash_value}




class DbManifestStore:
    def get_head(self, module_id: str) -> str | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select manifest_hash from manifest_snapshots
                where org_id=%s and module_id=%s
                order by created_at desc
                limit 1
                """,
                [get_org_id(), module_id],
                query_name="manifest_snapshots.head",
            )
            return row["manifest_hash"] if row else None

    def get_snapshot(self, module_id: str, manifest_hash_value: str) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select manifest from manifest_snapshots
                where org_id=%s and module_id=%s and manifest_hash=%s
                """,
                [get_org_id(), module_id, manifest_hash_value],
                query_name="manifest_snapshots.get",
            )
            if not row:
                raise KeyError("Snapshot not found")
            return _deepcopy(_ensure_json(row["manifest"]))

    def list_history(self, module_id: str) -> list[dict]:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                select audit from module_audit
                where org_id=%s and module_id=%s
                order by created_at desc
                """,
                [get_org_id(), module_id],
                query_name="module_audit.list",
            )
            return [_deepcopy(r["audit"]) for r in rows]

    def init_module(self, module_id: str, manifest: dict, actor: dict | None = None, reason: str = "init") -> str:
        manifest_copy = _deepcopy(manifest)
        new_hash = manifest_hash(manifest_copy)
        with get_conn() as conn:
            existing = fetch_one(
                conn,
                """
                select manifest_hash from manifest_snapshots
                where org_id=%s and module_id=%s and manifest_hash=%s
                """,
                [get_org_id(), module_id, new_hash],
                query_name="manifest_snapshots.exists",
            )
            if existing:
                return new_hash
            execute(
                conn,
                """
                insert into manifest_snapshots (org_id, module_id, manifest_hash, manifest, created_at, actor, reason)
                values (%s,%s,%s,%s,%s,%s,%s)
                """,
                [get_org_id(), module_id, new_hash, json.dumps(manifest_copy), _now(), _json_dumps(actor) if actor else None, reason],
                query_name="manifest_snapshots.insert",
            )
        return new_hash

    def list_snapshots(self, module_id: str) -> list[dict]:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                select manifest_hash, created_at, actor, reason
                from manifest_snapshots
                where org_id=%s and module_id=%s
                order by created_at desc
                """,
                [get_org_id(), module_id],
                query_name="manifest_snapshots.list",
            )
            return [
                {
                    "manifest_hash": r.get("manifest_hash"),
                    "created_at": _to_iso(r.get("created_at")),
                    "created_by": _ensure_json(r.get("actor")),
                    "reason": r.get("reason"),
                }
                for r in rows
            ]

    def apply_approved_preview(self, approved: dict) -> dict:
        # reuse logic from in-memory store for validation and apply
        from manifest_store import _apply_ops  # local import to avoid circular

        errors: List[dict] = []
        warnings: List[dict] = []

        if not isinstance(approved, dict) or not isinstance(approved.get("patch"), dict) or not isinstance(approved.get("preview"), dict):
            return {"ok": False, "errors": [{"code": "APPLY_INVALID", "message": "approved preview invalid", "path": "$", "detail": None}], "warnings": [], "from_hash": None, "to_hash": None, "audit_id": None}

        patch = approved["patch"]
        preview = approved["preview"]
        if preview.get("ok") is not True:
            return {"ok": False, "errors": [{"code": "APPLY_PREVIEW_NOT_OK", "message": "preview.ok must be true", "path": "preview.ok", "detail": None}], "warnings": [], "from_hash": None, "to_hash": None, "audit_id": None}

        if patch.get("mode") != "preview":
            return {"ok": False, "errors": [{"code": "APPLY_INVALID", "message": "patch.mode must be preview", "path": "patch.mode", "detail": None}], "warnings": [], "from_hash": None, "to_hash": None, "audit_id": None}

        module_id = patch.get("target_module_id")
        from_hash = patch.get("target_manifest_hash")
        if not isinstance(module_id, str) or not isinstance(from_hash, str):
            return {"ok": False, "errors": [{"code": "APPLY_INVALID", "message": "module_id and from_hash required", "path": "patch", "detail": None}], "warnings": [], "from_hash": None, "to_hash": None, "audit_id": None}

        head = self.get_head(module_id)
        if head != from_hash:
            return {"ok": False, "errors": [{"code": "APPLY_HASH_MISMATCH", "message": "from_hash does not match head", "path": "patch.target_manifest_hash", "detail": None}], "warnings": [], "from_hash": from_hash, "to_hash": None, "audit_id": None}

        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select manifest from manifest_snapshots
                where org_id=%s and module_id=%s and manifest_hash=%s
                """,
                [get_org_id(), module_id, from_hash],
                query_name="manifest_snapshots.get_for_apply",
            )
            if not row:
                return {"ok": False, "errors": [{"code": "APPLY_UNKNOWN_HASH", "message": "from_hash not found", "path": "patch.target_manifest_hash", "detail": None}], "warnings": [], "from_hash": from_hash, "to_hash": None, "audit_id": None}

            resolved_ops = preview.get("resolved_ops")
            if not isinstance(resolved_ops, list):
                return {"ok": False, "errors": [{"code": "APPLY_INVALID", "message": "resolved_ops must be list", "path": "preview.resolved_ops", "detail": None}], "warnings": [], "from_hash": from_hash, "to_hash": None, "audit_id": None}

            for op in resolved_ops:
                for key in ("path", "from"):
                    if key in op and isinstance(op[key], str) and "@[id=" in op[key]:
                        return {"ok": False, "errors": [{"code": "APPLY_UNRESOLVED_SELECTOR", "message": "selector segment found", "path": "preview.resolved_ops", "detail": None}], "warnings": [], "from_hash": from_hash, "to_hash": None, "audit_id": None}

            new_manifest = _deepcopy(_ensure_json(row["manifest"]))
            try:
                _apply_ops(new_manifest, resolved_ops)
            except Exception as exc:
                return {"ok": False, "errors": [{"code": "APPLY_FAILED", "message": str(exc), "path": "preview.resolved_ops", "detail": None}], "warnings": [], "from_hash": from_hash, "to_hash": None, "audit_id": None}

            try:
                to_hash = manifest_hash(new_manifest)
            except Exception as exc:
                return {"ok": False, "errors": [{"code": "APPLY_MANIFEST_INVALID", "message": str(exc), "path": "manifest", "detail": None}], "warnings": [], "from_hash": from_hash, "to_hash": None, "audit_id": None}

            execute(
                conn,
                """
                insert into manifest_snapshots (org_id, module_id, manifest_hash, manifest, created_at, actor, reason)
                values (%s,%s,%s,%s,%s,%s,%s)
                on conflict do nothing
                """,
                [get_org_id(), module_id, to_hash, json.dumps(new_manifest), _now(), _json_dumps(approved.get("approved_by")) if approved.get("approved_by") else None, patch.get("reason")],
                query_name="manifest_snapshots.insert_apply",
            )

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
            execute(
                conn,
                """
                insert into module_audit (org_id, module_id, audit_id, audit, created_at)
                values (%s,%s,%s,%s,%s)
                """,
                [get_org_id(), module_id, audit_id, _json_dumps(audit), _now()],
                query_name="module_audit.insert_apply",
            )

        return {"ok": True, "errors": [], "warnings": warnings, "from_hash": from_hash, "to_hash": to_hash, "audit_id": audit_id}

    def rollback(self, module_id: str, to_hash: str, actor: dict, reason: str) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select manifest_hash from manifest_snapshots
                where org_id=%s and module_id=%s and manifest_hash=%s
                """,
                [get_org_id(), module_id, to_hash],
                query_name="manifest_snapshots.rollback_check",
            )
            if not row:
                return {"ok": False, "errors": [{"code": "ROLLBACK_UNKNOWN_HASH", "message": "hash not found", "path": "to_hash", "detail": None}], "warnings": [], "from_hash": None, "to_hash": None, "audit_id": None}

            head = self.get_head(module_id)
            audit_id = str(uuid.uuid4())
            audit = {
                "audit_id": audit_id,
                "module_id": module_id,
                "action": "rollback",
                "patch_id": None,
                "from_hash": head,
                "to_hash": to_hash,
                "actor": actor,
                "reason": reason,
                "at": _now(),
            }
            execute(
                conn,
                """
                insert into module_audit (org_id, module_id, audit_id, audit, created_at)
                values (%s,%s,%s,%s,%s)
                """,
                [get_org_id(), module_id, audit_id, _json_dumps(audit), _now()],
                query_name="module_audit.insert_rollback",
            )

        return {"ok": True, "errors": [], "warnings": [], "from_hash": head, "to_hash": to_hash, "audit_id": audit_id}


class DbModuleRegistry:
    def __init__(self, manifest_store: DbManifestStore) -> None:
        self._store = manifest_store

    def get(self, module_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select m.module_id, m.name, m.enabled, m.current_hash, m.installed_at, m.updated_at, m.tags,
                       m.status, m.active_version, m.last_error, m.archived, m.display_order,
                       coalesce(m.icon_key, mi.icon_key) as icon_key,
                       ms.manifest->>'manifest_version' as manifest_version
                from modules_installed m
                left join module_icons mi on mi.module_id = m.module_id
                left join manifest_snapshots ms
                  on ms.org_id = m.org_id and ms.module_id = m.module_id and ms.manifest_hash = m.current_hash
                where m.org_id=%s and m.module_id=%s
                """,
                [get_org_id(), module_id],
                query_name="modules_installed.get",
            )
            return _deepcopy(_module_from_row(row)) if row else None

    def list(self) -> list[dict]:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                select m.module_id, m.name, m.enabled, m.current_hash, m.installed_at, m.updated_at, m.tags,
                       m.status, m.active_version, m.last_error, m.archived, m.display_order,
                       coalesce(m.icon_key, mi.icon_key) as icon_key,
                       ms.manifest->>'manifest_version' as manifest_version
                from modules_installed m
                left join module_icons mi on mi.module_id = m.module_id
                left join manifest_snapshots ms
                  on ms.org_id = m.org_id and ms.module_id = m.module_id and ms.manifest_hash = m.current_hash
                where m.org_id=%s and m.archived=false
                order by m.display_order nulls last, m.module_id
                """,
                [get_org_id()],
                query_name="modules_installed.list",
            )
            return [_deepcopy(_module_from_row(r)) for r in rows]

    def set_icon(self, module_id: str, icon_key: str) -> None:
        with get_conn() as conn:
            execute(
                conn,
                """
                update modules_installed
                set icon_key=%s, updated_at=%s
                where org_id=%s and module_id=%s
                """,
                [icon_key, _now(), get_org_id(), module_id],
                query_name="modules_installed.set_icon",
            )
            execute(
                conn,
                """
                insert into module_icons (module_id, icon_key, updated_at)
                values (%s,%s,%s)
                on conflict (module_id) do update
                set icon_key=excluded.icon_key, updated_at=excluded.updated_at
                """,
                [module_id, icon_key, _now()],
                query_name="module_icons.upsert",
            )

    def clear_icon(self, module_id: str) -> None:
        with get_conn() as conn:
            execute(
                conn,
                """
                update modules_installed
                set icon_key=null, updated_at=%s
                where org_id=%s and module_id=%s
                """,
                [_now(), get_org_id(), module_id],
                query_name="modules_installed.clear_icon",
            )
            execute(
                conn,
                "delete from module_icons where module_id=%s",
                [module_id],
                query_name="module_icons.delete",
            )

    def set_display_order(self, module_id: str, display_order: int | None) -> None:
        with get_conn() as conn:
            execute(
                conn,
                """
                update modules_installed
                set display_order=%s, updated_at=%s
                where org_id=%s and module_id=%s
                """,
                [display_order, _now(), get_org_id(), module_id],
                query_name="modules_installed.set_display_order",
            )

    def history(self, module_id: str) -> list[dict]:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                select audit from module_audit where org_id=%s and module_id=%s
                order by created_at desc
                """,
                [get_org_id(), module_id],
                query_name="module_audit.history",
            )
            return [_deepcopy(r["audit"]) for r in rows]

    def register(self, module_id: str, name: str | None, actor: dict | None, reason: str = "register") -> dict:
        existing = self.get(module_id)
        if existing is not None:
            return {"ok": False, "errors": [{"code": "MODULE_ALREADY_REGISTERED", "message": "module already registered", "path": "module_id", "detail": None}], "warnings": [], "module": None, "audit_id": None}

        head = self._store.get_head(module_id)
        if head is None:
            return {"ok": False, "errors": [{"code": "MODULE_NO_MANIFEST_HEAD", "message": "module has no manifest head", "path": "module_id", "detail": None}], "warnings": [], "module": None, "audit_id": None}

        manifest = self._store.get_snapshot(module_id, head)
        module_name = name or _module_name_from_manifest(manifest)
        with get_conn() as conn:
            execute(
                conn,
                """
                insert into modules_installed (org_id, module_id, enabled, current_hash, name, installed_at, updated_at, tags, status, active_version, last_error, archived)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                [get_org_id(), module_id, False, head, module_name, _now(), _now(), None, "installed", None, None, False],
                query_name="modules_installed.register",
            )
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
            execute(
                conn,
                """
                insert into module_audit (org_id, module_id, audit_id, audit, created_at)
                values (%s,%s,%s,%s,%s)
                """,
                [get_org_id(), module_id, audit_id, _json_dumps(audit), _now()],
                query_name="module_audit.insert_register",
            )

        return {"ok": True, "errors": [], "warnings": [], "module": self.get(module_id), "audit_id": audit_id}

    def set_enabled(self, module_id: str, enabled: bool, actor: dict | None, reason: str) -> dict:
        record = self.get(module_id)
        if record is None:
            return {"ok": False, "errors": [{"code": "MODULE_NOT_FOUND", "message": "module not found", "path": "module_id", "detail": None}], "warnings": [], "module": None, "audit_id": None}

        warnings = []
        if record.get("enabled") == enabled:
            warnings.append({"code": "MODULE_ENABLED_NOOP", "message": "no change", "path": "enabled", "detail": None})

        with get_conn() as conn:
            execute(
                conn,
                """
                update modules_installed set enabled=%s, updated_at=%s
                where org_id=%s and module_id=%s
                """,
                [enabled, _now(), get_org_id(), module_id],
                query_name="modules_installed.set_enabled",
            )
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
            execute(
                conn,
                """
                insert into module_audit (org_id, module_id, audit_id, audit, created_at)
                values (%s,%s,%s,%s,%s)
                """,
                [get_org_id(), module_id, audit_id, _json_dumps(audit), _now()],
                query_name="module_audit.insert_enabled",
            )

        return {"ok": True, "errors": [], "warnings": warnings, "module": self.get(module_id), "audit_id": audit_id}

    def install(self, approved: dict) -> dict:
        return self._apply(approved, action="install", auto_register=True)

    def upgrade(self, approved: dict) -> dict:
        return self._apply(approved, action="upgrade", auto_register=False)

    def _apply(self, approved: dict, action: str, auto_register: bool) -> dict:
        patch = approved.get("patch") if isinstance(approved, dict) else None
        if not isinstance(patch, dict):
            return {"ok": False, "errors": [{"code": "MODULE_INVALID", "message": "approved preview invalid", "path": "approved", "detail": None}], "warnings": [], "module": None, "audit_id": None}

        module_id = patch.get("target_module_id")
        if not isinstance(module_id, str):
            return {"ok": False, "errors": [{"code": "MODULE_INVALID", "message": "target_module_id required", "path": "patch.target_module_id", "detail": None}], "warnings": [], "module": None, "audit_id": None}

        if patch.get("mode") != "preview":
            return {"ok": False, "errors": [{"code": "MODULE_INVALID", "message": "patch.mode must be preview", "path": "patch.mode", "detail": None}], "warnings": [], "module": None, "audit_id": None}

        existing = self.get(module_id)
        if existing is None and not auto_register:
            return {"ok": False, "errors": [{"code": "MODULE_NOT_FOUND", "message": "module not found", "path": "module_id", "detail": None}], "warnings": [], "module": None, "audit_id": None}

        with get_conn() as conn:
            set_active_conn(conn)
            try:
                if existing and action == "upgrade":
                    execute(
                        conn,
                        """
                        update modules_installed set status=%s, last_error=%s, updated_at=%s
                        where org_id=%s and module_id=%s
                        """,
                        ["upgrading", None, _now(), get_org_id(), module_id],
                        query_name="modules_installed.set_upgrading",
                    )

                store_result = self._store.apply_approved_preview(approved)
                if not store_result.get("ok"):
                    if existing:
                        execute(
                            conn,
                            """
                            update modules_installed set status=%s, last_error=%s, updated_at=%s
                            where org_id=%s and module_id=%s
                            """,
                            ["failed", (store_result.get("errors") or [{}])[0].get("message"), _now(), get_org_id(), module_id],
                            query_name="modules_installed.set_failed",
                        )
                    return {"ok": False, "errors": store_result.get("errors", []), "warnings": [], "module": None, "audit_id": None}

                to_hash = store_result.get("to_hash")
                manifest = self._store.get_snapshot(module_id, to_hash)
                module_name = _module_name_from_manifest(manifest) if isinstance(manifest, dict) else None
                version = _insert_module_version(conn, module_id, to_hash, manifest, approved.get("approved_by"), patch.get("reason"))
                if existing is None:
                    execute(
                        conn,
                        """
                        insert into modules_installed (org_id, module_id, enabled, current_hash, name, installed_at, updated_at, tags, status, active_version, last_error, archived)
                        values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        """,
                        [get_org_id(), module_id, True, to_hash, module_name, _now(), _now(), None, "installed", version.get("version_id"), None, False],
                        query_name="modules_installed.insert",
                    )
                else:
                    execute(
                        conn,
                        """
                        update modules_installed
                        set current_hash=%s, updated_at=%s, status=%s, active_version=%s, last_error=%s, name=coalesce(%s, name)
                        where org_id=%s and module_id=%s
                        """,
                        [to_hash, _now(), "installed", version.get("version_id"), None, module_name, get_org_id(), module_id],
                        query_name="modules_installed.update_hash",
                    )
                    if action == "install":
                        execute(
                            conn,
                            """
                            update modules_installed set enabled=true, updated_at=%s
                            where org_id=%s and module_id=%s
                            """,
                            [_now(), get_org_id(), module_id],
                            query_name="modules_installed.enable",
                        )
            except Exception as exc:
                if existing:
                    execute(
                        conn,
                        """
                        update modules_installed set status=%s, last_error=%s, updated_at=%s
                        where org_id=%s and module_id=%s
                        """,
                        ["failed", str(exc), _now(), get_org_id(), module_id],
                        query_name="modules_installed.set_failed_exception",
                    )
                return {"ok": False, "errors": [{"code": "MODULE_APPLY_FAILED", "message": str(exc), "path": None, "detail": None}], "warnings": [], "module": None, "audit_id": None}
            finally:
                clear_active_conn()

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
            execute(
                conn,
                """
                insert into module_audit (org_id, module_id, audit_id, audit, created_at)
                values (%s,%s,%s,%s,%s)
                """,
                [get_org_id(), module_id, audit_id, _json_dumps(audit), _now()],
                query_name="module_audit.insert_apply_action",
            )

        return {"ok": True, "errors": [], "warnings": [], "module": self.get(module_id), "audit_id": audit_id}

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
        record = self.get(module_id)
        if record is None:
            return {"ok": False, "errors": [{"code": "MODULE_NOT_FOUND", "message": "module not found", "path": "module_id", "detail": None}], "warnings": [], "module": None, "audit_id": None}

        warnings = []
        with get_conn() as conn:
            target_version = None
            if to_version_id:
                target_version = _get_module_version_by_id(conn, module_id, to_version_id)
                if not target_version:
                    return {"ok": False, "errors": [{"code": "ROLLBACK_UNKNOWN_VERSION", "message": "version_id not found", "path": "to_version_id", "detail": None}], "warnings": [], "module": None, "audit_id": None}
            elif to_version_num is not None:
                target_version = _get_module_version_by_num(conn, module_id, int(to_version_num))
                if not target_version:
                    return {"ok": False, "errors": [{"code": "ROLLBACK_UNKNOWN_VERSION", "message": "version_num not found", "path": "to_version_num", "detail": None}], "warnings": [], "module": None, "audit_id": None}
            elif isinstance(to_hash, str) and to_hash:
                target_version = _get_module_version_by_hash(conn, module_id, to_hash)
            if target_version:
                to_hash = target_version.get("manifest_hash")

        if not isinstance(to_hash, str) or not to_hash:
            return {"ok": False, "errors": [{"code": "ROLLBACK_INVALID_HASH", "message": "to_hash is required", "path": "to_hash", "detail": None}], "warnings": [], "module": None, "audit_id": None}

        try:
            manifest = self._store.get_snapshot(module_id, to_hash)
        except Exception:
            return {"ok": False, "errors": [{"code": "ROLLBACK_UNKNOWN_HASH", "message": "hash not found", "path": "to_hash", "detail": None}], "warnings": [], "module": None, "audit_id": None}

        from_hash = record.get("current_hash")
        if from_hash == to_hash:
            warnings.append({"code": "MODULE_ALREADY_AT_SNAPSHOT", "message": "module already at requested snapshot", "path": "to_hash", "detail": None})

        with get_conn() as conn:
            if not target_version:
                target_version = _get_module_version_by_hash(conn, module_id, to_hash)
            if not target_version:
                target_version = _insert_module_version(conn, module_id, to_hash, manifest, actor, notes="rollback_snapshot")
                warnings.append({"code": "MODULE_VERSION_CREATED", "message": "version created from snapshot for rollback", "path": "to_hash", "detail": None})
            execute(
                conn,
                """
                update modules_installed
                set current_hash=%s, updated_at=%s, status=%s, active_version=%s, last_error=%s
                where org_id=%s and module_id=%s
                """,
                [to_hash, _now(), "installed", target_version.get("version_id"), None, get_org_id(), module_id],
                query_name="modules_installed.rollback",
            )
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
            execute(
                conn,
                """
                insert into module_audit (org_id, module_id, audit_id, audit, created_at)
                values (%s,%s,%s,%s,%s)
                """,
                [get_org_id(), module_id, audit_id, _json_dumps(audit), _now()],
                query_name="module_audit.insert_rollback_action",
            )

        return {"ok": True, "errors": [], "warnings": warnings, "module": self.get(module_id), "audit_id": audit_id}


class DbDraftStore:
    def _ensure_draft_versions_meta(self) -> None:
        table = "module_draft_versions"
        if table not in _ALLOWED_AUTO_MIGRATION_TABLES:
            raise RuntimeError("auto_migration_not_allowed: module_draft_versions")
        with get_conn() as conn:
            execute(
                conn,
                """
                alter table if exists module_draft_versions
                  add column if not exists parent_version_id text null,
                  add column if not exists ops_applied jsonb null,
                  add column if not exists validation_errors jsonb null;
                """,
                query_name="module_draft_versions.ensure_meta",
            )
            execute(
                conn,
                """
                create index if not exists module_draft_versions_parent_idx
                  on module_draft_versions (parent_version_id);
                """,
                query_name="module_draft_versions.ensure_parent_idx",
            )
        if table not in _AUTO_MIGRATION_LOGGED:
            logging.getLogger("octo").info(
                "auto_migration_applied table=%s columns=%s",
                table,
                ["parent_version_id", "ops_applied", "validation_errors"],
            )
            _AUTO_MIGRATION_LOGGED.add(table)

    def list_drafts(self) -> list[dict]:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                select module_id, manifest, updated_at, updated_by, base_snapshot_id
                from module_drafts
                where org_id=%s
                order by updated_at desc
                """,
                [get_org_id()],
                query_name="module_drafts.list",
            )
            return [_deepcopy(r) for r in rows]

    def get_draft(self, module_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select module_id, manifest, created_at, updated_at, updated_by, base_snapshot_id
                from module_drafts
                where org_id=%s and module_id=%s
                """,
                [get_org_id(), module_id],
                query_name="module_drafts.get",
            )
            return _deepcopy(row) if row else None

    def upsert_draft(self, module_id: str, manifest: dict, updated_by: str | None = None, base_snapshot_id: str | None = None) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into module_drafts (org_id, module_id, manifest, updated_at, updated_by, base_snapshot_id)
                values (%s,%s,%s,%s,%s,%s)
                on conflict (org_id, module_id) do update
                  set manifest = excluded.manifest,
                      updated_at = excluded.updated_at,
                      updated_by = excluded.updated_by,
                      base_snapshot_id = coalesce(excluded.base_snapshot_id, module_drafts.base_snapshot_id)
                returning module_id, manifest, created_at, updated_at, updated_by, base_snapshot_id
                """,
                [get_org_id(), module_id, json.dumps(manifest), _now(), updated_by, base_snapshot_id],
                query_name="module_drafts.upsert",
            )
            return _deepcopy(row)

    def create_draft_version(
        self,
        module_id: str,
        manifest: dict,
        note: str | None = None,
        created_by: str | None = None,
        parent_version_id: str | None = None,
        ops_applied: list | None = None,
        validation_errors: list | None = None,
    ) -> dict:
        version_id = str(uuid.uuid4())
        try:
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    """
                    insert into module_draft_versions (
                        id, org_id, module_id, manifest, note, created_at, created_by,
                        parent_version_id, ops_applied, validation_errors
                    )
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    returning id, module_id, manifest, note, created_at, created_by,
                              parent_version_id, ops_applied, validation_errors
                    """,
                    [
                        version_id,
                        get_org_id(),
                        module_id,
                        json.dumps(manifest),
                        note,
                        _now(),
                        created_by,
                        parent_version_id,
                        json.dumps(ops_applied) if ops_applied is not None else None,
                        json.dumps(validation_errors) if validation_errors is not None else None,
                    ],
                    query_name="module_draft_versions.insert",
                )
        except psycopg2.errors.UndefinedColumn:
            logger.warning("module_draft_versions missing columns; applying meta migration")
            self._ensure_draft_versions_meta()
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    """
                    insert into module_draft_versions (
                        id, org_id, module_id, manifest, note, created_at, created_by,
                        parent_version_id, ops_applied, validation_errors
                    )
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    returning id, module_id, manifest, note, created_at, created_by,
                              parent_version_id, ops_applied, validation_errors
                    """,
                    [
                        version_id,
                        get_org_id(),
                        module_id,
                        json.dumps(manifest),
                        note,
                        _now(),
                        created_by,
                        parent_version_id,
                        json.dumps(ops_applied) if ops_applied is not None else None,
                        json.dumps(validation_errors) if validation_errors is not None else None,
                    ],
                    query_name="module_draft_versions.insert",
                )
        except psycopg2.errors.UndefinedTable:
            logger.warning("module_draft_versions table missing; falling back to module_drafts only")
            self.upsert_draft(module_id, manifest, updated_by=created_by)
            return {
                "id": version_id,
                "module_id": module_id,
                "manifest": _deepcopy(manifest),
                "note": note,
                "created_at": _now(),
                "created_by": created_by,
                "parent_version_id": parent_version_id,
                "ops_applied": ops_applied,
                "validation_errors": validation_errors,
            }
        self.upsert_draft(module_id, manifest, updated_by=created_by)
        return _deepcopy(row)

    def list_draft_versions(self, module_id: str) -> list[dict]:
        try:
            with get_conn() as conn:
                rows = fetch_all(
                    conn,
                    """
                    select id, module_id, manifest, note, created_at, created_by,
                           parent_version_id, ops_applied, validation_errors
                    from module_draft_versions
                    where org_id=%s and module_id=%s
                    order by created_at desc
                    """,
                    [get_org_id(), module_id],
                    query_name="module_draft_versions.list",
                )
                return [_deepcopy(r) for r in rows]
        except psycopg2.errors.UndefinedColumn:
            logger.warning("module_draft_versions missing columns; applying meta migration")
            self._ensure_draft_versions_meta()
            with get_conn() as conn:
                rows = fetch_all(
                    conn,
                    """
                    select id, module_id, manifest, note, created_at, created_by,
                           parent_version_id, ops_applied, validation_errors
                    from module_draft_versions
                    where org_id=%s and module_id=%s
                    order by created_at desc
                    """,
                    [get_org_id(), module_id],
                    query_name="module_draft_versions.list",
                )
                return [_deepcopy(r) for r in rows]
        except psycopg2.errors.UndefinedTable:
            logger.warning("module_draft_versions table missing; returning empty list")
            return []

    def get_draft_version(self, module_id: str, version_id: str) -> dict | None:
        try:
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    """
                    select id, module_id, manifest, note, created_at, created_by,
                           parent_version_id, ops_applied, validation_errors
                    from module_draft_versions
                    where org_id=%s and module_id=%s and id=%s
                    """,
                    [get_org_id(), module_id, version_id],
                    query_name="module_draft_versions.get",
                )
                return _deepcopy(row) if row else None
        except psycopg2.errors.UndefinedColumn:
            logger.warning("module_draft_versions missing columns; applying meta migration")
            self._ensure_draft_versions_meta()
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    """
                    select id, module_id, manifest, note, created_at, created_by,
                           parent_version_id, ops_applied, validation_errors
                    from module_draft_versions
                    where org_id=%s and module_id=%s and id=%s
                    """,
                    [get_org_id(), module_id, version_id],
                    query_name="module_draft_versions.get",
                )
                return _deepcopy(row) if row else None
        except psycopg2.errors.UndefinedTable:
            logger.warning("module_draft_versions table missing; get_draft_version returns None")
            return None

    def delete_draft(self, module_id: str) -> None:
        with get_conn() as conn:
            execute(conn, "delete from module_drafts where org_id=%s and module_id=%s", [get_org_id(), module_id], query_name="module_drafts.delete")
            try:
                execute(conn, "delete from module_draft_versions where org_id=%s and module_id=%s", [get_org_id(), module_id], query_name="module_draft_versions.delete")
            except psycopg2.errors.UndefinedTable:
                logger.warning("module_draft_versions table missing; skip delete")


class DbGenericRecordStore:
    def list_page(
        self,
        entity_id: str,
        tenant_id: str | None = None,
        limit: int = 50,
        cursor: str | None = None,
        q: str | None = None,
        search_fields: list[str] | None = None,
        fields: list[str] | None = None,
    ) -> tuple[list[dict], str | None]:
        tenant_id = tenant_id or get_org_id()
        q_lower = str(q).strip().lower() if isinstance(q, str) else None
        where_params: list = [tenant_id, entity_id]
        where = "where tenant_id=%s and entity_id=%s"
        if q_lower:
            if search_fields:
                clauses = []
                for field_id in search_fields:
                    clauses.append("lower(data ->> %s) like %s")
                    where_params.extend([field_id, f"{q_lower}%"])
                where += " and (" + " or ".join(clauses) + ")"
            else:
                where += " and (data::text ilike %s)"
                where_params.append(f"%{q_lower}%")
        decoded = _decode_cursor(cursor) if cursor else None
        if decoded:
            cursor_ts, cursor_id = decoded
            where += " and (updated_at, id) < (%s, %s)"
            where_params.extend([cursor_ts, cursor_id])
        safe_fields = [f for f in (fields or []) if _is_safe_field_id(f)]
        select_params: list = []
        if safe_fields:
            parts = []
            for field_id in safe_fields:
                parts.append("%s, data -> %s")
                select_params.extend([field_id, field_id])
            data_expr = f"jsonb_build_object({', '.join(parts)}) as data"
        else:
            data_expr = "data"
        params = select_params + where_params + [limit + 1]
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                f"""
                select id, {data_expr}, updated_at
                from records_generic
                {where}
                order by updated_at desc, id desc
                limit %s
                """,
                params,
                query_name="records_generic.list_page",
            )
        next_cursor = None
        if len(rows) > limit:
            tail = rows[limit - 1]
            next_cursor = _encode_cursor(tail.get("updated_at"), str(tail.get("id")))
            rows = rows[:limit]
        items: list[dict] = []
        for row in rows:
            record = _deepcopy(row.get("data") or {})
            record_id = str(row.get("id"))
            if isinstance(record, dict):
                record["id"] = record_id
            items.append({"record_id": record_id, "record": record})
        return items, next_cursor

    def list(
        self,
        entity_id: str,
        tenant_id: str | None = None,
        limit: int = 200,
        offset: int = 0,
        q: str | None = None,
        search_fields: list[str] | None = None,
    ) -> list[dict]:
        tenant_id = tenant_id or get_org_id()
        q_lower = str(q).strip().lower() if isinstance(q, str) else None
        params: list = [tenant_id, entity_id]
        where = "where tenant_id=%s and entity_id=%s"
        if q_lower:
            if search_fields:
                clauses = []
                for field_id in search_fields:
                    clauses.append("lower(data ->> %s) like %s")
                    params.extend([field_id, f"{q_lower}%"])
                where += " and (" + " or ".join(clauses) + ")"
            else:
                where += " and (data::text ilike %s)"
                params.append(f"%{q_lower}%")
        params.extend([limit, offset])
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                f"""
                select id, data
                from records_generic
                {where}
                order by updated_at desc
                limit %s offset %s
                """,
                params,
                query_name="records_generic.list",
            )
        items: list[dict] = []
        for row in rows:
            record = _deepcopy(row.get("data") or {})
            record["id"] = str(row.get("id"))
            items.append({"record_id": str(row.get("id")), "record": record})
        return items

    def list_lookup(
        self,
        entity_id: str,
        display_field: str | None,
        tenant_id: str | None = None,
        limit: int = 50,
        q: str | None = None,
    ) -> list[dict]:
        tenant_id = tenant_id or get_org_id()
        q_lower = str(q).strip().lower() if isinstance(q, str) else None
        params: list = []
        where = "where tenant_id=%s and entity_id=%s"
        if display_field:
            sql = f"""
                select id, data ->> %s as label
                from records_generic
                {where}
                order by updated_at desc
                limit %s
            """
            params = [display_field, tenant_id, entity_id]
            if q_lower:
                where = "where tenant_id=%s and entity_id=%s and (lower(data ->> %s) like %s)"
                sql = f"""
                    select id, data ->> %s as label
                    from records_generic
                    {where}
                    order by updated_at desc
                    limit %s
                """
                params = [display_field, tenant_id, entity_id, display_field, f"{q_lower}%"]
        else:
            sql = f"""
                select id, data
                from records_generic
                {where}
                order by updated_at desc
                limit %s
            """
            params = [tenant_id, entity_id]
        params.append(limit)
        with get_conn() as conn:
            rows = fetch_all(conn, sql, params, query_name="records_generic.list_lookup")
        items: list[dict] = []
        for row in rows:
            record_id = str(row.get("id"))
            if display_field and "label" in row:
                record = {display_field: row.get("label"), "id": record_id}
            else:
                record = _deepcopy(row.get("data") or {})
                record["id"] = record_id
            items.append({"record_id": record_id, "record": record})
        return items

    def get(self, entity_id: str, record_id: str, tenant_id: str | None = None) -> dict | None:
        tenant_id = tenant_id or get_org_id()
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select id, data
                from records_generic
                where tenant_id=%s and entity_id=%s and id=%s
                """,
                [tenant_id, entity_id, record_id],
                query_name="records_generic.get",
            )
            if not row:
                return None
            record = _deepcopy(row.get("data") or {})
            record["id"] = str(row.get("id"))
            return {"record_id": str(row.get("id")), "record": record}

    def create(self, entity_id: str, data: dict, tenant_id: str | None = None) -> dict:
        tenant_id = tenant_id or get_org_id()
        record_id = str(uuid.uuid4())
        record = _deepcopy(data)
        record["id"] = record_id
        with get_conn() as conn:
            execute(
                conn,
                """
                insert into records_generic (tenant_id, entity_id, id, data, created_at, updated_at)
                values (%s,%s,%s,%s,%s,%s)
                """,
                [tenant_id, entity_id, record_id, json.dumps(record), _now(), _now()],
                query_name="records_generic.create",
            )
        return {"record_id": record_id, "record": record}

    def update(self, entity_id: str, record_id: str, data: dict, tenant_id: str | None = None) -> dict:
        tenant_id = tenant_id or get_org_id()
        record = _deepcopy(data)
        record["id"] = record_id
        with get_conn() as conn:
            execute(
                conn,
                """
                update records_generic
                set data=%s, updated_at=%s
                where tenant_id=%s and entity_id=%s and id=%s
                """,
                [json.dumps(record), _now(), tenant_id, entity_id, record_id],
                query_name="records_generic.update",
            )
        return {"record_id": record_id, "record": record}

    def delete(self, entity_id: str, record_id: str, tenant_id: str | None = None) -> None:
        tenant_id = tenant_id or get_org_id()
        with get_conn() as conn:
            execute(
                conn,
                "delete from records_generic where tenant_id=%s and entity_id=%s and id=%s",
                [tenant_id, entity_id, record_id],
                query_name="records_generic.delete",
            )


class DbChatterStore:
    def list(self, entity_id: str, record_id: str, limit: int = 200) -> list[dict]:
        try:
            with get_conn() as conn:
                rows = fetch_all(
                    conn,
                    """
                    select id, type, body, actor, created_at
                    from records_chatter
                    where org_id=%s and entity_id=%s and record_id=%s
                    order by created_at desc
                    limit %s
                    """,
                    [get_org_id(), entity_id, record_id, limit],
                    query_name="records_chatter.list",
                )
                return [
                    {
                        "id": r.get("id"),
                        "type": r.get("type"),
                        "body": r.get("body"),
                        "actor": _ensure_json(r.get("actor")) if r.get("actor") is not None else None,
                        "created_at": _to_iso(r.get("created_at")),
                    }
                    for r in rows
                ]
        except Exception as exc:
            if "records_chatter" in str(exc):
                logger.warning("records_chatter table missing; run migration 009_records_chatter.sql")
                return []
            raise

    def add(self, entity_id: str, record_id: str, entry_type: str, body: str, actor: dict | None) -> dict:
        entry_id = str(uuid.uuid4())
        try:
            with get_conn() as conn:
                execute(
                    conn,
                    """
                    insert into records_chatter (org_id, entity_id, record_id, id, type, body, actor, created_at)
                    values (%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    [get_org_id(), entity_id, record_id, entry_id, entry_type, body, _json_dumps(actor) if actor else None, _now()],
                    query_name="records_chatter.insert",
                )
        except Exception as exc:
            if "records_chatter" in str(exc):
                logger.warning("records_chatter table missing; run migration 009_records_chatter.sql")
                return {"id": entry_id, "type": entry_type, "body": body, "actor": actor, "created_at": _now()}
            raise
        return {"id": entry_id, "type": entry_type, "body": body, "actor": actor, "created_at": _now()}


class DbActivityStore:
    def _author_user_id(self, actor: dict | None) -> str | None:
        if not isinstance(actor, dict):
            return None
        user_id = actor.get("user_id") or actor.get("id") or actor.get("sub")
        return str(user_id) if user_id else None

    def _author(self, actor: dict | None) -> dict | None:
        if not isinstance(actor, dict):
            return None
        user_id = actor.get("user_id") or actor.get("id") or actor.get("sub")
        name = actor.get("name") or actor.get("full_name") or actor.get("display_name") or actor.get("email")
        email = actor.get("email")
        out = {
            "id": str(user_id) if user_id else None,
            "name": str(name) if name else (str(email) if email else "System"),
            "email": str(email) if email else None,
        }
        return out

    def add_event(
        self,
        entity_id: str,
        record_id: str,
        event_type: str,
        payload: dict | None,
        actor: dict | None = None,
        created_at: str | None = None,
    ) -> dict:
        item_id = str(uuid.uuid4())
        created = created_at or _now()
        event_payload = dict(payload or {})
        author = self._author(actor)
        if author:
            event_payload["_author"] = author
        with get_conn() as conn:
            execute(
                conn,
                """
                insert into record_activity_events (
                  id, org_id, entity_id, record_id, event_type, author_user_id, payload, created_at
                ) values (%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                [
                    item_id,
                    get_org_id(),
                    entity_id,
                    str(record_id),
                    event_type,
                    self._author_user_id(actor),
                    json.dumps(event_payload),
                    created,
                ],
                query_name="record_activity_events.insert",
            )
        return {
            "id": item_id,
            "event_type": event_type,
            "author": author,
            "payload": payload or {},
            "created_at": created,
        }

    def add_comment(self, entity_id: str, record_id: str, body: str, actor: dict | None = None) -> dict:
        return self.add_event(entity_id, record_id, "comment", {"body": body}, actor=actor)

    def add_change(self, entity_id: str, record_id: str, changes: list[dict], actor: dict | None = None) -> dict:
        return self.add_event(entity_id, record_id, "change", {"changes": changes}, actor=actor)

    def add_attachment(self, entity_id: str, record_id: str, attachment: dict, actor: dict | None = None) -> dict:
        payload = {
            "attachment_id": attachment.get("id"),
            "filename": attachment.get("filename"),
            "mime_type": attachment.get("mime_type"),
            "size": attachment.get("size"),
        }
        return self.add_event(entity_id, record_id, "attachment", payload, actor=actor)

    def _row_to_item(self, row: dict) -> dict:
        payload = _ensure_json(row.get("payload")) or {}
        author_user_id = row.get("author_user_id")
        payload_author = payload.get("_author") if isinstance(payload, dict) else None
        if isinstance(payload_author, dict):
            author = payload_author
        else:
            author = {"id": str(author_user_id), "name": str(author_user_id)} if author_user_id else None
        if isinstance(payload, dict) and "_author" in payload:
            payload = dict(payload)
            payload.pop("_author", None)
        return {
            "id": row.get("id"),
            "event_type": row.get("event_type"),
            "author": author,
            "payload": payload,
            "created_at": _to_iso(row.get("created_at")),
        }

    def list(self, entity_id: str, record_id: str, limit: int = 50) -> list[dict]:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                select id, event_type, payload, author_user_id, created_at
                from record_activity_events
                where org_id=%s and entity_id=%s and record_id=%s
                order by created_at desc, id desc
                limit %s
                """,
                [get_org_id(), entity_id, str(record_id), max(1, min(int(limit or 50), 200))],
                query_name="record_activity_events.list",
            )
        return [self._row_to_item(row) for row in rows]

    def list_since(self, entity_id: str, record_id: str, since: str, limit: int = 50) -> list[dict]:
        # `since` is expected to be an ISO8601 timestamp string (validated by the API layer).
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                select id, event_type, payload, author_user_id, created_at
                from record_activity_events
                where org_id=%s and entity_id=%s and record_id=%s and created_at > %s
                order by created_at desc, id desc
                limit %s
                """,
                [get_org_id(), entity_id, str(record_id), since, max(1, min(int(limit or 50), 200))],
                query_name="record_activity_events.list_since",
            )
        return [self._row_to_item(row) for row in rows]


class DbWorkflowStore:
    def __init__(self) -> None:
        limit_raw = os.getenv("OCTO_WORKFLOW_HISTORY_LIMIT", "50").strip()
        try:
            limit = int(limit_raw)
        except ValueError:
            limit = 50
        self._history_limit = max(limit, 1)

    def _limit_history(self, history: list[dict]) -> list[dict]:
        if not history:
            return []
        if len(history) <= self._history_limit:
            return history
        return history[-self._history_limit :]

    def _insert_event(self, conn, instance_id: str, event: dict) -> None:
        execute(
            conn,
            """
            insert into workflow_instance_events (org_id, instance_id, event, created_at)
            values (%s,%s,%s,%s)
            """,
            [get_org_id(), instance_id, json.dumps(event), event.get("at") or _now()],
            query_name="workflow_instance_events.insert",
        )

    def create_instance(self, module_id: str, workflow_id: str, initial_state: str, record_ref: dict | None, actor: dict | None, reason: str = "init") -> dict:
        instance_id = str(uuid.uuid4())
        now = _now()
        history = [
            {
                "at": now,
                "actor": actor,
                "from_state": initial_state,
                "to_state": initial_state,
                "transition_id": "init",
                "actions": [],
                "events": [],
                "status": "applied",
                "detail": {"reason": reason},
            }
        ]
        with get_conn() as conn:
            execute(
                conn,
                """
                insert into workflow_instances (org_id, instance_id, module_id, workflow_id, subject_ref, state, history, updated_at)
                values (%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                [get_org_id(), instance_id, module_id, workflow_id, json.dumps(record_ref) if record_ref else None, initial_state, json.dumps(self._limit_history(history)), now],
                query_name="workflow_instances.insert",
            )
            self._insert_event(conn, instance_id, history[0])
        return {
            "instance_id": instance_id,
            "module_id": module_id,
            "workflow_id": workflow_id,
            "record_ref": _deepcopy(record_ref),
            "current_state": initial_state,
            "created_at": now,
            "updated_at": now,
            "history": history,
        }

    def get_instance(self, instance_id: str) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select * from workflow_instances where org_id=%s and instance_id=%s
                """,
                [get_org_id(), instance_id],
                query_name="workflow_instances.get",
            )
            if not row:
                raise KeyError("Instance not found")
            return {
                "instance_id": row["instance_id"],
                "module_id": row["module_id"],
                "workflow_id": row["workflow_id"],
                "record_ref": _deepcopy(_ensure_json(row["subject_ref"])) if row["subject_ref"] is not None else None,
                "current_state": row["state"],
                "created_at": None,
                "updated_at": row["updated_at"].strftime("%Y-%m-%dT%H:%M:%SZ") if hasattr(row["updated_at"], "strftime") else row["updated_at"],
                "history": _deepcopy(_ensure_json(row["history"])),
            }

    def update_instance(self, instance: dict) -> None:
        history = instance.get("history", []) or []
        last_event = history[-1] if history else None
        with get_conn() as conn:
            execute(
                conn,
                """
                update workflow_instances set state=%s, history=%s, updated_at=%s
                where org_id=%s and instance_id=%s
                """,
                [instance.get("current_state"), json.dumps(self._limit_history(history)), _now(), get_org_id(), instance.get("instance_id")],
                query_name="workflow_instances.update",
            )
            if last_event:
                self._insert_event(conn, instance.get("instance_id"), last_event)

    def list_instances(self, module_id: str, workflow_id: str | None = None) -> list[dict]:
        with get_conn() as conn:
            if workflow_id:
                rows = fetch_all(
                    conn,
                    """
                    select * from workflow_instances where org_id=%s and module_id=%s and workflow_id=%s
                    """,
                    [get_org_id(), module_id, workflow_id],
                    query_name="workflow_instances.list_by_workflow",
                )
            else:
                rows = fetch_all(
                    conn,
                    """
                    select * from workflow_instances where org_id=%s and module_id=%s
                    """,
                    [get_org_id(), module_id],
                    query_name="workflow_instances.list",
                )
            results = []
            for row in rows:
                results.append(
                    {
                        "instance_id": row["instance_id"],
                        "module_id": row["module_id"],
                        "workflow_id": row["workflow_id"],
                        "record_ref": _deepcopy(_ensure_json(row["subject_ref"])) if row["subject_ref"] is not None else None,
                        "current_state": row["state"],
                        "created_at": None,
                        "updated_at": row["updated_at"].strftime("%Y-%m-%dT%H:%M:%SZ") if hasattr(row["updated_at"], "strftime") else row["updated_at"],
                        "history": _deepcopy(_ensure_json(row["history"])),
                    }
                )
            return results


class DbSecretStore:
    def create(self, name: str | None, secret_enc: str) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into secrets (org_id, name, secret_enc, created_at, updated_at)
                values (%s, %s, %s, now(), now())
                returning id, org_id, name, created_at, updated_at
                """,
                [get_org_id(), name, secret_enc],
                query_name="secrets.insert",
            )
            return {
                "id": row["id"],
                "org_id": row["org_id"],
                "name": row["name"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }

    def get(self, secret_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select id, org_id, name, secret_enc, created_at, updated_at
                from secrets where org_id=%s and id=%s
                """,
                [get_org_id(), secret_id],
                query_name="secrets.get",
            )
            return dict(row) if row else None

    def list(self, limit: int = 200) -> list[dict]:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                select id, org_id, name, created_at, updated_at
                from secrets
                where org_id=%s
                order by created_at desc
                limit %s
                """,
                [get_org_id(), max(1, min(int(limit or 200), 1000))],
                query_name="secrets.list",
            )
            return [dict(r) for r in rows]

    def delete(self, secret_id: str) -> bool:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                delete from secrets
                where org_id=%s and id=%s
                returning id
                """,
                [get_org_id(), secret_id],
                query_name="secrets.delete",
            )
            return bool(row)


class DbConnectionStore:
    def create(self, connection: dict) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into connections (org_id, type, name, config, secret_ref, status, created_at, updated_at)
                values (%s, %s, %s, %s, %s, %s, now(), now())
                returning *
                """,
                [
                    get_org_id(),
                    connection.get("type"),
                    connection.get("name"),
                    json.dumps(connection.get("config") or {}),
                    connection.get("secret_ref"),
                    connection.get("status", "active"),
                ],
                query_name="connections.insert",
            )
            return dict(row)

    def update(self, connection_id: str, updates: dict) -> dict | None:
        fields = []
        params = []
        for key in ("name", "config", "secret_ref", "status"):
            if key in updates:
                fields.append(f"{key}=%s")
                value = updates[key]
                if key == "config":
                    value = json.dumps(value or {})
                params.append(value)
        if not fields:
            return self.get(connection_id)
        params.extend([_now(), get_org_id(), connection_id])
        with get_conn() as conn:
            row = fetch_one(
                conn,
                f"""
                update connections set {', '.join(fields)}, updated_at=%s
                where org_id=%s and id=%s
                returning *
                """,
                params,
                query_name="connections.update",
            )
            return dict(row) if row else None

    def get(self, connection_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select * from connections where org_id=%s and id=%s
                """,
                [get_org_id(), connection_id],
                query_name="connections.get",
            )
            return dict(row) if row else None

    def list(self, connection_type: str | None = None, status: str | None = None) -> list[dict]:
        clauses = ["org_id=%s"]
        params = [get_org_id()]
        if connection_type:
            clauses.append("type=%s")
            params.append(connection_type)
        if status:
            clauses.append("status=%s")
            params.append(status)
        where = " and ".join(clauses)
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                f"""
                select * from connections where {where} order by created_at desc
                """,
                params,
                query_name="connections.list",
            )
            return [dict(r) for r in rows]

    def get_default_email(self) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select * from connections
                where org_id=%s and type in ('smtp','postmark') and status='active'
                order by case when type='smtp' then 0 else 1 end, created_at asc
                limit 1
                """,
                [get_org_id()],
                query_name="connections.default_email",
            )
            return dict(row) if row else None


class DbJobStore:
    def enqueue(self, job: dict) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into jobs (
                  org_id, type, status, priority, run_at, attempt, max_attempts,
                  locked_at, locked_by, last_error, payload, idempotency_key, created_at, updated_at
                ) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),now())
                on conflict (org_id, type, idempotency_key) where idempotency_key is not null
                do update set updated_at=now()
                returning *
                """,
                [
                    get_org_id(),
                    job.get("type"),
                    job.get("status", "queued"),
                    job.get("priority", 0),
                    job.get("run_at") or _now(),
                    job.get("attempt", 0),
                    job.get("max_attempts", 10),
                    job.get("locked_at"),
                    job.get("locked_by"),
                    job.get("last_error"),
                    json.dumps(job.get("payload") or {}),
                    job.get("idempotency_key"),
                ],
                query_name="jobs.insert",
            )
            return dict(row)

    def claim_batch(self, limit: int, worker_id: str) -> list[dict]:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                with candidates as (
                  select id from jobs
                  where org_id=%s
                    and status='queued'
                    and run_at <= now()
                  order by priority desc, run_at asc
                  for update skip locked
                  limit %s
                )
                update jobs j
                set status='running',
                    locked_at=now(),
                    locked_by=%s,
                    attempt=attempt+1,
                    updated_at=now()
                from candidates c
                where j.id = c.id
                returning j.*
                """,
                [get_org_id(), limit, worker_id],
                query_name="jobs.claim_batch",
            )
            return [dict(r) for r in rows]

    def update(self, job_id: str, changes: dict) -> dict | None:
        fields = []
        params = []
        for key in (
            "status",
            "priority",
            "run_at",
            "attempt",
            "max_attempts",
            "locked_at",
            "locked_by",
            "last_error",
            "payload",
        ):
            if key in changes:
                fields.append(f"{key}=%s")
                value = changes[key]
                if key == "payload":
                    value = json.dumps(value or {})
                params.append(value)
        if not fields:
            return self.get(job_id)
        params.extend([_now(), get_org_id(), job_id])
        with get_conn() as conn:
            row = fetch_one(
                conn,
                f"""
                update jobs set {', '.join(fields)}, updated_at=%s
                where org_id=%s and id=%s
                returning *
                """,
                params,
                query_name="jobs.update",
            )
            return dict(row) if row else None

    def get(self, job_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select * from jobs where org_id=%s and id=%s
                """,
                [get_org_id(), job_id],
                query_name="jobs.get",
            )
            return dict(row) if row else None

    def list(self, status: str | None = None, job_type: str | None = None, limit: int = 200) -> list[dict]:
        clauses = ["org_id=%s"]
        params = [get_org_id()]
        if status:
            clauses.append("status=%s")
            params.append(status)
        if job_type:
            clauses.append("type=%s")
            params.append(job_type)
        where = " and ".join(clauses)
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                f"""
                select * from jobs where {where}
                order by created_at desc
                limit %s
                """,
                params + [limit],
                query_name="jobs.list",
            )
            return [dict(r) for r in rows]

    def list_by_payload(self, job_type: str, payload_key: str, payload_value: str, limit: int = 200) -> list[dict]:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                select * from jobs
                where org_id=%s and type=%s and payload ->> %s = %s
                order by created_at desc
                limit %s
                """,
                [get_org_id(), job_type, payload_key, payload_value, limit],
                query_name="jobs.list_by_payload",
            )
            return [dict(r) for r in rows]

    def add_event(self, job_id: str, level: str, message: str, data: dict | None = None) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into job_events (job_id, org_id, ts, level, message, data)
                values (%s, %s, now(), %s, %s, %s)
                returning *
                """,
                [job_id, get_org_id(), level, message, _json_dumps(data or {})],
                query_name="job_events.insert",
            )
            return dict(row)

    def list_events(self, job_id: str, limit: int = 200) -> list[dict]:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                select * from job_events where job_id=%s
                order by ts desc
                limit %s
                """,
                [job_id, limit],
                query_name="job_events.list",
            )
            return [dict(r) for r in rows]


class DbNotificationStore:
    def create(self, record: dict) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into notifications (
                  org_id, recipient_user_id, title, body, severity, link_to, source_event, created_at
                ) values (%s,%s,%s,%s,%s,%s,%s,now())
                returning *
                """,
                [
                    get_org_id(),
                    record.get("recipient_user_id"),
                    record.get("title"),
                    record.get("body"),
                    record.get("severity", "info"),
                    record.get("link_to"),
                    json.dumps(record.get("source_event") or {}),
                ],
                query_name="notifications.insert",
            )
            return dict(row)

    def list(self, user_id: str, unread_only: bool = False, limit: int = 200) -> list[dict]:
        clauses = ["org_id=%s", "recipient_user_id=%s"]
        params = [get_org_id(), user_id]
        if unread_only:
            clauses.append("read_at is null")
        where = " and ".join(clauses)
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                f"""
                select * from notifications where {where}
                order by created_at desc
                limit %s
                """,
                params + [limit],
                query_name="notifications.list",
            )
            return [dict(r) for r in rows]

    def mark_read(self, notification_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                update notifications set read_at=now()
                where org_id=%s and id=%s
                returning *
                """,
                [get_org_id(), notification_id],
                query_name="notifications.mark_read",
            )
            return dict(row) if row else None

    def mark_all_read(self, user_id: str) -> int:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                update notifications set read_at=now()
                where org_id=%s and recipient_user_id=%s and read_at is null
                returning count(*) as count
                """,
                [get_org_id(), user_id],
                query_name="notifications.mark_all",
            )
            return int(row["count"]) if row else 0

    def unread_count(self, user_id: str) -> int:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select count(*) as count from notifications
                where org_id=%s and recipient_user_id=%s and read_at is null
                """,
                [get_org_id(), user_id],
                query_name="notifications.unread_count",
            )
            return int(row["count"]) if row else 0


class DbEmailStore:
    def create_template(self, record: dict) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into email_templates (
                  org_id, name, subject, body_html, body_text, variables_schema,
                  is_active, default_connection_id, created_at, updated_at
                ) values (%s,%s,%s,%s,%s,%s,%s,%s,now(),now())
                returning *
                """,
                [
                    get_org_id(),
                    record.get("name"),
                    record.get("subject"),
                    record.get("body_html"),
                    record.get("body_text"),
                    json.dumps(record.get("variables_schema") or {}),
                    bool(record.get("is_active", True)),
                    record.get("default_connection_id"),
                ],
                query_name="email_templates.insert",
            )
            return dict(row)

    def update_template(self, template_id: str, updates: dict) -> dict | None:
        fields = []
        params = []
        for key in ("name", "subject", "body_html", "body_text", "variables_schema", "is_active", "default_connection_id"):
            if key in updates:
                fields.append(f"{key}=%s")
                value = updates[key]
                if key == "variables_schema":
                    value = json.dumps(value or {})
                params.append(value)
        if not fields:
            return self.get_template(template_id)
        params.extend([_now(), get_org_id(), template_id])
        with get_conn() as conn:
            row = fetch_one(
                conn,
                f"""
                update email_templates set {', '.join(fields)}, updated_at=%s
                where org_id=%s and id=%s
                returning *
                """,
                params,
                query_name="email_templates.update",
            )
            return dict(row) if row else None

    def get_template(self, template_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select * from email_templates where org_id=%s and id=%s
                """,
                [get_org_id(), template_id],
                query_name="email_templates.get",
            )
            return dict(row) if row else None

    def list_templates(self) -> list[dict]:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                select * from email_templates where org_id=%s order by created_at desc
                """,
                [get_org_id()],
                query_name="email_templates.list",
            )
            return [dict(r) for r in rows]

    def create_outbox(self, record: dict) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into email_outbox (
                  org_id, "to", cc, bcc, from_email, reply_to, subject,
                  body_html, body_text, status, provider_message_id, last_error, template_id, created_at, sent_at
                ) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),%s)
                returning *
                """,
                [
                    get_org_id(),
                    json.dumps(record.get("to") or []),
                    json.dumps(record.get("cc") or []),
                    json.dumps(record.get("bcc") or []),
                    record.get("from_email"),
                    record.get("reply_to"),
                    record.get("subject"),
                    record.get("body_html"),
                    record.get("body_text"),
                    record.get("status", "queued"),
                    record.get("provider_message_id"),
                    record.get("last_error"),
                    record.get("template_id"),
                    record.get("sent_at"),
                ],
                query_name="email_outbox.insert",
            )
            return dict(row)

    def update_outbox(self, outbox_id: str, updates: dict) -> dict | None:
        fields = []
        params = []
        for key in ("status", "provider_message_id", "last_error", "sent_at"):
            if key in updates:
                fields.append(f"{key}=%s")
                params.append(updates[key])
        if not fields:
            return self.get_outbox(outbox_id)
        params.extend([get_org_id(), outbox_id])
        with get_conn() as conn:
            row = fetch_one(
                conn,
                f"""
                update email_outbox set {', '.join(fields)}
                where org_id=%s and id=%s
                returning *
                """,
                params,
                query_name="email_outbox.update",
            )
            return dict(row) if row else None

    def list_outbox(self, limit: int = 200, template_id: str | None = None) -> list[dict]:
        clauses = ["org_id=%s"]
        params = [get_org_id()]
        if template_id:
            clauses.append("template_id=%s")
            params.append(template_id)
        where = " and ".join(clauses)
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                f"""
                select * from email_outbox where {where} order by created_at desc limit %s
                """,
                params + [limit],
                query_name="email_outbox.list",
            )
            return [dict(r) for r in rows]

    def get_outbox(self, outbox_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select * from email_outbox where org_id=%s and id=%s
                """,
                [get_org_id(), outbox_id],
                query_name="email_outbox.get",
            )
            return dict(row) if row else None


class DbAttachmentStore:
    def create_attachment(self, record: dict) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into attachments (
                  org_id, filename, mime_type, size, storage_key, sha256, created_by, created_at, source
                ) values (%s,%s,%s,%s,%s,%s,%s,now(),%s)
                returning *
                """,
                [
                    get_org_id(),
                    record.get("filename"),
                    record.get("mime_type"),
                    record.get("size"),
                    record.get("storage_key"),
                    record.get("sha256"),
                    record.get("created_by"),
                    record.get("source", "upload"),
                ],
                query_name="attachments.insert",
            )
            return dict(row)

    def get_attachment(self, attachment_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select * from attachments where org_id=%s and id=%s
                """,
                [get_org_id(), attachment_id],
                query_name="attachments.get",
            )
            return dict(row) if row else None

    def delete_by_source_before(self, source: str, before_ts: str, limit: int = 200) -> list[dict]:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                select id, storage_key
                from attachments
                where org_id=%s and source=%s and created_at < %s
                order by created_at asc
                limit %s
                """,
                [get_org_id(), source, before_ts, limit],
                query_name="attachments.cleanup_list",
            )
            items = [dict(r) for r in rows]
            if not items:
                return []
            ids = [item.get("id") for item in items]
            execute(
                conn,
                """
                delete from attachments
                where org_id=%s and id = any(%s)
                """,
                [get_org_id(), ids],
                query_name="attachments.cleanup_delete",
            )
            return items

    def list_links_by_purpose(self, purpose: str, limit: int = 200) -> list[dict]:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                select * from attachment_links
                where org_id=%s and purpose=%s
                order by created_at desc
                limit %s
                """,
                [get_org_id(), purpose, limit],
                query_name="attachment_links.list_by_purpose",
            )
            return [dict(r) for r in rows]

    def link(self, record: dict) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into attachment_links (
                  org_id, attachment_id, entity_id, record_id, purpose, created_at
                ) values (%s,%s,%s,%s,%s,now())
                returning *
                """,
                [
                    get_org_id(),
                    record.get("attachment_id"),
                    record.get("entity_id"),
                    record.get("record_id"),
                    record.get("purpose", "default"),
                ],
                query_name="attachment_links.insert",
            )
            return dict(row)

    def list_links(self, entity_id: str, record_id: str, purpose: str | None = None) -> list[dict]:
        with get_conn() as conn:
            if purpose:
                rows = fetch_all(
                    conn,
                    """
                    select * from attachment_links
                    where org_id=%s and entity_id=%s and record_id=%s and purpose=%s
                    order by created_at desc
                    """,
                    [get_org_id(), entity_id, record_id, purpose],
                    query_name="attachment_links.list_by_record_purpose",
                )
            else:
                rows = fetch_all(
                    conn,
                    """
                    select * from attachment_links
                    where org_id=%s and entity_id=%s and record_id=%s
                    order by created_at desc
                    """,
                    [get_org_id(), entity_id, record_id],
                    query_name="attachment_links.list",
                )
            return [dict(r) for r in rows]

    def unlink(self, entity_id: str, record_id: str, attachment_id: str, purpose: str | None = None) -> int:
        with get_conn() as conn:
            if purpose:
                rows = fetch_all(
                    conn,
                    """
                    delete from attachment_links
                    where org_id=%s and entity_id=%s and record_id=%s and attachment_id=%s and purpose=%s
                    returning id
                    """,
                    [get_org_id(), entity_id, record_id, attachment_id, purpose],
                    query_name="attachment_links.unlink_by_purpose",
                )
            else:
                rows = fetch_all(
                    conn,
                    """
                    delete from attachment_links
                    where org_id=%s and entity_id=%s and record_id=%s and attachment_id=%s
                    returning id
                    """,
                    [get_org_id(), entity_id, record_id, attachment_id],
                    query_name="attachment_links.unlink",
                )
            return len(rows or [])

    def count_links(self, attachment_id: str) -> int:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select count(*)::int as total
                from attachment_links
                where org_id=%s and attachment_id=%s
                """,
                [get_org_id(), attachment_id],
                query_name="attachment_links.count_by_attachment",
            )
            return int((row or {}).get("total") or 0)

    def delete_attachment(self, attachment_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                delete from attachments
                where org_id=%s and id=%s
                returning *
                """,
                [get_org_id(), attachment_id],
                query_name="attachments.delete",
            )
            return dict(row) if row else None


class DbDocTemplateStore:
    def create(self, record: dict) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into doc_templates (
                  org_id, name, format, html, filename_pattern, paper_size,
                  margin_top, margin_right, margin_bottom, margin_left,
                  header_html, footer_html, created_at, updated_at
                ) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),now())
                returning *
                """,
                [
                    get_org_id(),
                    record.get("name"),
                    record.get("format", "html"),
                    record.get("html"),
                    record.get("filename_pattern"),
                    record.get("paper_size", "A4"),
                    record.get("margin_top", "12mm"),
                    record.get("margin_right", "12mm"),
                    record.get("margin_bottom", "12mm"),
                    record.get("margin_left", "12mm"),
                    record.get("header_html"),
                    record.get("footer_html"),
                ],
                query_name="doc_templates.insert",
            )
            return dict(row)

    def update(self, template_id: str, updates: dict) -> dict | None:
        fields = []
        params = []
        for key in (
            "name",
            "format",
            "html",
            "filename_pattern",
            "paper_size",
            "margin_top",
            "margin_right",
            "margin_bottom",
            "margin_left",
            "header_html",
            "footer_html",
        ):
            if key in updates:
                fields.append(f"{key}=%s")
                params.append(updates[key])
        if not fields:
            return self.get(template_id)
        params.extend([_now(), get_org_id(), template_id])
        with get_conn() as conn:
            row = fetch_one(
                conn,
                f"""
                update doc_templates set {', '.join(fields)}, updated_at=%s
                where org_id=%s and id=%s
                returning *
                """,
                params,
                query_name="doc_templates.update",
            )
            return dict(row) if row else None

    def get(self, template_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select * from doc_templates where org_id=%s and id=%s
                """,
                [get_org_id(), template_id],
                query_name="doc_templates.get",
            )
            return dict(row) if row else None

    def list(self) -> list[dict]:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                select * from doc_templates where org_id=%s order by created_at desc
                """,
                [get_org_id()],
                query_name="doc_templates.list",
            )
            return [dict(r) for r in rows]


class DbAutomationStore:
    def create(self, record: dict) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into automations (org_id, name, description, status, trigger, steps, created_at, updated_at)
                values (%s, %s, %s, %s, %s, %s, %s, %s)
                returning *
                """,
                [
                    get_org_id(),
                    record.get("name"),
                    record.get("description"),
                    record.get("status", "draft"),
                    json.dumps(record.get("trigger") or {}),
                    json.dumps(record.get("steps") or []),
                    _now(),
                    _now(),
                ],
                query_name="automations.create",
            )
            return dict(row)

    def update(self, automation_id: str, updates: dict) -> dict | None:
        fields = []
        params = []
        for key in ("name", "description", "status", "trigger", "steps", "published_at", "published_by"):
            if key in updates:
                if key in {"trigger", "steps"}:
                    fields.append(f"{key}=%s")
                    params.append(json.dumps(updates[key]))
                else:
                    fields.append(f"{key}=%s")
                    params.append(updates[key])
        if not fields:
            return self.get(automation_id)
        params.extend([_now(), get_org_id(), automation_id])
        with get_conn() as conn:
            row = fetch_one(
                conn,
                f"""
                update automations set {', '.join(fields)}, updated_at=%s
                where org_id=%s and id=%s
                returning *
                """,
                params,
                query_name="automations.update",
            )
            return dict(row) if row else None

    def get(self, automation_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select * from automations where org_id=%s and id=%s
                """,
                [get_org_id(), automation_id],
                query_name="automations.get",
            )
            return dict(row) if row else None

    def list(self, status: str | None = None) -> list[dict]:
        clauses = ["org_id=%s"]
        params = [get_org_id()]
        if status:
            clauses.append("status=%s")
            params.append(status)
        where = " and ".join(clauses)
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                f"""
                select * from automations where {where} order by updated_at desc
                """,
                params,
                query_name="automations.list",
            )
            return [dict(r) for r in rows]

    def delete(self, automation_id: str) -> bool:
        with get_conn() as conn:
            row = execute(
                conn,
                """
                delete from automations where org_id=%s and id=%s
                """,
                [get_org_id(), automation_id],
                query_name="automations.delete",
            )
            return bool(row)

    def create_run(self, record: dict) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into automation_runs (
                  org_id, automation_id, status, trigger_event_id, trigger_type, trigger_payload,
                  current_step_index, created_at, updated_at, started_at, ended_at, last_error
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                returning *
                """,
                [
                    get_org_id(),
                    record.get("automation_id"),
                    record.get("status", "queued"),
                    record.get("trigger_event_id"),
                    record.get("trigger_type"),
                    json.dumps(record.get("trigger_payload") or {}),
                    record.get("current_step_index", 0),
                    _now(),
                    _now(),
                    record.get("started_at"),
                    record.get("ended_at"),
                    record.get("last_error"),
                ],
                query_name="automation_runs.create",
            )
            return dict(row)

    def update_run(self, run_id: str, updates: dict) -> dict | None:
        fields = []
        params = []
        for key in (
            "status",
            "trigger_event_id",
            "trigger_type",
            "trigger_payload",
            "current_step_index",
            "started_at",
            "ended_at",
            "last_error",
        ):
            if key in updates:
                if key == "trigger_payload":
                    fields.append(f"{key}=%s")
                    params.append(json.dumps(updates[key]))
                else:
                    fields.append(f"{key}=%s")
                    params.append(updates[key])
        if not fields:
            return self.get_run(run_id)
        params.extend([_now(), get_org_id(), run_id])
        with get_conn() as conn:
            row = fetch_one(
                conn,
                f"""
                update automation_runs set {', '.join(fields)}, updated_at=%s
                where org_id=%s and id=%s
                returning *
                """,
                params,
                query_name="automation_runs.update",
            )
            return dict(row) if row else None

    def get_run(self, run_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select * from automation_runs where org_id=%s and id=%s
                """,
                [get_org_id(), run_id],
                query_name="automation_runs.get",
            )
            return dict(row) if row else None

    def list_runs(self, automation_id: str | None = None) -> list[dict]:
        clauses = ["org_id=%s"]
        params = [get_org_id()]
        if automation_id:
            clauses.append("automation_id=%s")
            params.append(automation_id)
        where = " and ".join(clauses)
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                f"""
                select * from automation_runs where {where} order by created_at desc
                """,
                params,
                query_name="automation_runs.list",
            )
            return [dict(r) for r in rows]

    def create_step_run(self, record: dict) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into automation_step_runs (
                  org_id, run_id, step_index, step_id, status, attempt,
                  started_at, ended_at, input, output, last_error, idempotency_key
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                returning *
                """,
                [
                    get_org_id(),
                    record.get("run_id"),
                    record.get("step_index"),
                    record.get("step_id"),
                    record.get("status", "queued"),
                    record.get("attempt", 0),
                    record.get("started_at"),
                    record.get("ended_at"),
                    _json_dumps(record.get("input") or {}) if record.get("input") is not None else None,
                    _json_dumps(record.get("output") or {}) if record.get("output") is not None else None,
                    record.get("last_error"),
                    record.get("idempotency_key"),
                ],
                query_name="automation_step_runs.create",
            )
            return dict(row)

    def update_step_run(self, step_run_id: str, updates: dict) -> dict | None:
        fields = []
        params = []
        for key in ("status", "attempt", "started_at", "ended_at", "input", "output", "last_error"):
            if key in updates:
                if key in {"input", "output"}:
                    fields.append(f"{key}=%s")
                    params.append(_json_dumps(updates[key]) if updates[key] is not None else None)
                else:
                    fields.append(f"{key}=%s")
                    params.append(updates[key])
        if not fields:
            return self.get_step_run(step_run_id)
        params.extend([get_org_id(), step_run_id])
        with get_conn() as conn:
            row = fetch_one(
                conn,
                f"""
                update automation_step_runs set {', '.join(fields)}
                where org_id=%s and id=%s
                returning *
                """,
                params,
                query_name="automation_step_runs.update",
            )
            return dict(row) if row else None

    def get_step_run(self, step_run_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select * from automation_step_runs where org_id=%s and id=%s
                """,
                [get_org_id(), step_run_id],
                query_name="automation_step_runs.get",
            )
            return dict(row) if row else None

    def list_step_runs(self, run_id: str) -> list[dict]:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                select * from automation_step_runs where org_id=%s and run_id=%s order by step_index asc, attempt asc
                """,
                [get_org_id(), run_id],
                query_name="automation_step_runs.list",
            )
            return [dict(r) for r in rows]

    def get_step_run_by_idempotency(self, idempotency_key: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select * from automation_step_runs where org_id=%s and idempotency_key=%s
                order by started_at desc
                limit 1
                """,
                [get_org_id(), idempotency_key],
                query_name="automation_step_runs.get_by_idem",
            )
            return dict(row) if row else None
