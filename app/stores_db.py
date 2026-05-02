"""DB-backed stores for product layer persistence."""

from __future__ import annotations

import base64
import copy
import json
import uuid
import logging
import os
import psycopg2
import psycopg2.extras
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Dict, List

from octo.manifest_hash import manifest_hash
from app.module_dependencies import module_key_from_manifest, module_version_from_manifest

logger = logging.getLogger("octo.chatter")


def _job_lock_lease_seconds() -> int:
    raw = os.getenv("OCTO_JOB_LOCK_LEASE_SECONDS", "1200")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = 1200
    return max(60, value)


from app.db import (
    clear_active_conn,
    db_internal_service,
    execute,
    fetch_all,
    fetch_one,
    get_conn,
    init_pool,
    reset_db_org_id,
    set_active_conn,
    set_db_org_id,
    _get_pool,
)


from contextvars import ContextVar

_ORG_ID: ContextVar[str] = ContextVar("org_id", default="default")


def _provider_env(*keys: str) -> str:
    for key in keys:
        value = os.getenv(key, "").strip()
        if value:
            return value
    return ""


def _json_dumps(value: object) -> str:
    return json.dumps(value, default=str)


def get_org_id() -> str:
    return _ORG_ID.get()


def set_org_id(value: str):
    return (_ORG_ID.set(value), set_db_org_id(value))


def reset_org_id(token):
    if isinstance(token, tuple) and len(token) == 2:
        _ORG_ID.reset(token[0])
        reset_db_org_id(token[1])
        return
    _ORG_ID.reset(token)
    set_db_org_id(_ORG_ID.get())
# Auto-migration allowlist (ALLOWED_AUTO_MIGRATION)
_ALLOWED_AUTO_MIGRATION_TABLES = {"module_draft_versions"}
_AUTO_MIGRATION_LOGGED: set[str] = set()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _deepcopy(value):
    return copy.deepcopy(value)


def _is_undefined_table(exc: Exception) -> bool:
    return isinstance(exc, psycopg2.Error) and getattr(exc, "pgcode", "") == "42P01"


_RECORD_FIELD_INDEX_AVAILABLE: bool | None = None
_RECORD_FIELD_INDEX_DISABLED = False
_RECORD_FIELD_INDEX_SAVEPOINT = "octo_record_field_index"


def _disable_record_field_index(reason: str, exc: Exception | None = None) -> None:
    global _RECORD_FIELD_INDEX_AVAILABLE, _RECORD_FIELD_INDEX_DISABLED
    _RECORD_FIELD_INDEX_AVAILABLE = False
    _RECORD_FIELD_INDEX_DISABLED = True
    if exc is not None:
        logger.warning("records_generic field index disabled: %s", reason, exc_info=True)
    else:
        logger.warning("records_generic field index disabled: %s", reason)


def _record_field_index_available(conn) -> bool:
    global _RECORD_FIELD_INDEX_AVAILABLE
    if _RECORD_FIELD_INDEX_DISABLED:
        return False
    if _RECORD_FIELD_INDEX_AVAILABLE is True:
        return True
    row = fetch_one(
        conn,
        "select to_regclass('public.records_generic_field_values') is not null as available",
        [],
        query_name="records_generic.field_index_available",
    )
    available = bool(row and row.get("available"))
    if available:
        _RECORD_FIELD_INDEX_AVAILABLE = True
    return available


def _record_field_scalar(value: Any) -> tuple[str | None, str | None, bool | None] | None:
    if value is None:
        return None, None, None
    if isinstance(value, bool):
        return ("true" if value else "false"), None, value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value), str(value), None
    if isinstance(value, str):
        return value, None, None
    return None


def _record_field_index_rows(
    *,
    tenant_id: str,
    entity_id: str,
    record_id: str,
    record: dict,
    updated_at: str,
) -> list[tuple[str, str, str, str, str | None, str | None, bool | None, str]]:
    if not isinstance(record, dict):
        return []
    rows: list[tuple[str, str, str, str, str | None, str | None, bool | None, str]] = []
    for field_id, value in record.items():
        if not isinstance(field_id, str) or not field_id:
            continue
        scalar = _record_field_scalar(value)
        if scalar is None:
            continue
        value_text, value_num, value_bool = scalar
        rows.append((tenant_id, entity_id, record_id, field_id, value_text, value_num, value_bool, updated_at))
    return rows


def _release_record_field_index_savepoint(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(f"release savepoint {_RECORD_FIELD_INDEX_SAVEPOINT}")


def _rollback_record_field_index_savepoint(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(f"rollback to savepoint {_RECORD_FIELD_INDEX_SAVEPOINT}")
        cur.execute(f"release savepoint {_RECORD_FIELD_INDEX_SAVEPOINT}")


def _replace_record_field_index(conn, tenant_id: str, entity_id: str, record_id: str, record: dict, updated_at: str) -> None:
    if not _record_field_index_available(conn):
        return
    rows = _record_field_index_rows(
        tenant_id=tenant_id,
        entity_id=entity_id,
        record_id=record_id,
        record=record,
        updated_at=updated_at,
    )
    with conn.cursor() as cur:
        cur.execute(f"savepoint {_RECORD_FIELD_INDEX_SAVEPOINT}")
    try:
        execute(
            conn,
            """
            delete from records_generic_field_values
            where tenant_id=%s and entity_id=%s and record_id=%s
            """,
            [tenant_id, entity_id, record_id],
            query_name="records_generic.field_index.delete_record",
        )
        if rows:
            with conn.cursor() as cur:
                psycopg2.extras.execute_values(
                    cur,
                    """
                    insert into records_generic_field_values (
                        tenant_id, entity_id, record_id, field_id,
                        value_text, value_num, value_bool, updated_at
                    )
                    values %s
                    on conflict (tenant_id, entity_id, record_id, field_id)
                    do update set
                        value_text = excluded.value_text,
                        value_num = excluded.value_num,
                        value_bool = excluded.value_bool,
                        updated_at = excluded.updated_at
                    """,
                    rows,
                    page_size=500,
                )
        _release_record_field_index_savepoint(conn)
    except Exception as exc:
        _rollback_record_field_index_savepoint(conn)
        _disable_record_field_index("write failed; falling back to JSONB scans", exc)


def _delete_record_field_index(conn, tenant_id: str, entity_id: str, record_id: str) -> None:
    if not _record_field_index_available(conn):
        return
    with conn.cursor() as cur:
        cur.execute(f"savepoint {_RECORD_FIELD_INDEX_SAVEPOINT}")
    try:
        execute(
            conn,
            """
            delete from records_generic_field_values
            where tenant_id=%s and entity_id=%s and record_id=%s
            """,
            [tenant_id, entity_id, record_id],
            query_name="records_generic.field_index.delete_record",
        )
        _release_record_field_index_savepoint(conn)
    except Exception as exc:
        _rollback_record_field_index_savepoint(conn)
        _disable_record_field_index("delete failed; relying on records_generic cascade or JSONB scans", exc)


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
        "description": row.get("description"),
        "category": row.get("category"),
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
        "module_version": row.get("module_version"),
        "module_key": row.get("module_key"),
        "home_route": row.get("home_route"),
        "manifest_version": row.get("manifest_version") or row.get("module_version"),
    }


def _module_name_from_manifest(manifest: dict) -> str | None:
    module = manifest.get("module") if isinstance(manifest, dict) else None
    if not isinstance(module, dict):
        return None
    name = module.get("name")
    return name if isinstance(name, str) and name.strip() else None


def _manifest_parse_target(target: str | None) -> tuple[str | None, str | None]:
    if not isinstance(target, str) or not target:
        return None, None
    if target.startswith("page:"):
        return "page", target.split("page:", 1)[1]
    if target.startswith("view:"):
        return "view", target.split("view:", 1)[1]
    return None, None


def _manifest_find_page_by_id(manifest: dict, page_id: str | None) -> dict | None:
    if not isinstance(page_id, str) or not page_id:
        return None
    pages = manifest.get("pages") if isinstance(manifest, dict) else None
    if not isinstance(pages, list):
        return None
    return next((page for page in pages if isinstance(page, dict) and page.get("id") == page_id), None)


def _manifest_find_first_view_modes_block(blocks: list | None) -> dict | None:
    if not isinstance(blocks, list):
        return None
    for block in blocks:
        if not isinstance(block, dict):
            continue
        if block.get("kind") == "view_modes":
            return block
        nested = block.get("content")
        found = _manifest_find_first_view_modes_block(nested if isinstance(nested, list) else None)
        if found:
            return found
        items = block.get("items")
        if isinstance(items, list):
            for item in items:
                if not isinstance(item, dict):
                    continue
                found = _manifest_find_first_view_modes_block(item.get("content") if isinstance(item.get("content"), list) else None)
                if found:
                    return found
        tabs = block.get("tabs")
        if isinstance(tabs, list):
            for tab in tabs:
                if not isinstance(tab, dict):
                    continue
                found = _manifest_find_first_view_modes_block(tab.get("content") if isinstance(tab.get("content"), list) else None)
                if found:
                    return found
    return None


def _manifest_default_query_for_page(manifest: dict, page_id: str | None) -> str:
    page = _manifest_find_page_by_id(manifest, page_id)
    block = _manifest_find_first_view_modes_block(page.get("content") if isinstance(page, dict) else None)
    if not isinstance(block, dict):
        return ""
    params: dict[str, str] = {}
    modes = block.get("modes") if isinstance(block.get("modes"), list) else []
    default_mode = block.get("default_mode") if isinstance(block.get("default_mode"), str) and block.get("default_mode") else None
    if not default_mode and modes and isinstance(modes[0], dict):
        default_mode = modes[0].get("mode") if isinstance(modes[0].get("mode"), str) else None
    if isinstance(default_mode, str) and default_mode:
        params["mode"] = default_mode
    default_filter_id = block.get("default_filter_id")
    if isinstance(default_filter_id, str) and default_filter_id:
        params["filter"] = default_filter_id
    active_mode = next((mode for mode in modes if isinstance(mode, dict) and mode.get("mode") == default_mode), None)
    group_by = None
    if isinstance(active_mode, dict):
        active_group = active_mode.get("default_group_by")
        if isinstance(active_group, str) and active_group:
            group_by = active_group
    if not group_by:
        block_group = block.get("default_group_by")
        if isinstance(block_group, str) and block_group:
            group_by = block_group
    if isinstance(group_by, str) and group_by:
        params["group_by"] = group_by
    return urllib.parse.urlencode(params)


def _module_home_route_from_manifest(module_id: str, manifest: dict) -> str | None:
    if not isinstance(module_id, str) or not module_id or not isinstance(manifest, dict):
        return None
    app_def = manifest.get("app") if isinstance(manifest.get("app"), dict) else {}
    target_kind, target_id = _manifest_parse_target(app_def.get("home"))
    if target_kind == "page" and isinstance(target_id, str) and target_id:
        route = f"/apps/{module_id}/page/{target_id}"
        query = _manifest_default_query_for_page(manifest, target_id)
        return f"{route}?{query}" if query else route
    if target_kind == "view" and isinstance(target_id, str) and target_id:
        return f"/apps/{module_id}/view/{target_id}"
    return f"/apps/{module_id}"


def _module_registry_meta_from_manifest(module_id: str, manifest: dict) -> dict[str, str | None]:
    module_def = manifest.get("module") if isinstance(manifest, dict) and isinstance(manifest.get("module"), dict) else {}
    name_key = module_def.get("name_key") if isinstance(module_def.get("name_key"), str) and module_def.get("name_key").strip() else None
    description = module_def.get("description") if isinstance(module_def.get("description"), str) and module_def.get("description").strip() else None
    description_key = module_def.get("description_key") if isinstance(module_def.get("description_key"), str) and module_def.get("description_key").strip() else None
    category = module_def.get("category") if isinstance(module_def.get("category"), str) and module_def.get("category").strip() else None
    version = module_version_from_manifest(manifest)
    module_key = module_key_from_manifest(manifest) or module_id
    home_route = _module_home_route_from_manifest(module_id, manifest)
    icon_key = module_def.get("icon_key") or module_def.get("icon")
    if isinstance(icon_key, str):
        icon_key = icon_key.strip() or None
    else:
        icon_key = None
    return {
        "name": _module_name_from_manifest(manifest),
        "name_key": name_key,
        "description": description,
        "description_key": description_key,
        "category": category,
        "module_version": version if isinstance(version, str) and version.strip() else None,
        "module_key": module_key.strip() if isinstance(module_key, str) and module_key.strip() else None,
        "home_route": home_route.strip() if isinstance(home_route, str) and home_route.strip() else None,
        "icon_key": icon_key,
    }


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

    def _get_any(self, module_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select m.module_id, m.name, m.description, m.category, m.enabled, m.current_hash,
                       m.installed_at, m.updated_at, m.tags, m.status, m.active_version, m.last_error,
                       m.archived, m.display_order, coalesce(m.icon_key, mi.icon_key) as icon_key,
                       m.module_version, m.module_key, m.home_route
                from modules_installed m
                left join module_icons mi on mi.module_id = m.module_id
                where m.org_id=%s and m.module_id=%s
                """,
                [get_org_id(), module_id],
                query_name="modules_installed.get_any",
            )
            return _deepcopy(_module_from_row(row)) if row else None

    def get(self, module_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select m.module_id, m.name, m.description, m.category, m.enabled, m.current_hash,
                       m.installed_at, m.updated_at, m.tags, m.status, m.active_version, m.last_error,
                       m.archived, m.display_order, coalesce(m.icon_key, mi.icon_key) as icon_key,
                       m.module_version, m.module_key, m.home_route
                from modules_installed m
                left join module_icons mi on mi.module_id = m.module_id
                where m.org_id=%s and m.module_id=%s and m.archived=false
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
                select m.module_id, m.name, m.description, m.category, m.enabled, m.current_hash,
                       m.installed_at, m.updated_at, m.tags, m.status, m.active_version, m.last_error,
                       m.archived, m.display_order, coalesce(m.icon_key, mi.icon_key) as icon_key,
                       m.module_version, m.module_key, m.home_route
                from modules_installed m
                left join module_icons mi on mi.module_id = m.module_id
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
        module_meta = _module_registry_meta_from_manifest(module_id, manifest if isinstance(manifest, dict) else {})
        module_name = name or module_meta.get("name")
        with get_conn() as conn:
            execute(
                conn,
                """
                insert into modules_installed (
                  org_id, module_id, enabled, current_hash, name, description, category, module_version,
                  module_key, home_route, icon_key, installed_at, updated_at, tags, status, active_version, last_error, archived
                )
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                [
                    get_org_id(),
                    module_id,
                    False,
                    head,
                    module_name,
                    module_meta.get("description"),
                    module_meta.get("category"),
                    module_meta.get("module_version"),
                    module_meta.get("module_key"),
                    module_meta.get("home_route"),
                    module_meta.get("icon_key"),
                    _now(),
                    _now(),
                    None,
                    "installed",
                    None,
                    None,
                    False,
                ],
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
        existing_any = existing or self._get_any(module_id)
        archived_existing = bool(existing_any and existing_any.get("archived"))
        if existing is None and archived_existing:
            existing = existing_any
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
                module_meta = _module_registry_meta_from_manifest(module_id, manifest if isinstance(manifest, dict) else {})
                module_name = module_meta.get("name")
                version = _insert_module_version(conn, module_id, to_hash, manifest, approved.get("approved_by"), patch.get("reason"))
                if existing is None:
                    execute(
                        conn,
                        """
                        insert into modules_installed (
                          org_id, module_id, enabled, current_hash, name, description, category, module_version,
                          module_key, home_route, icon_key, installed_at, updated_at, tags, status, active_version, last_error, archived
                        )
                        values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        """,
                        [
                            get_org_id(),
                            module_id,
                            True,
                            to_hash,
                            module_name,
                            module_meta.get("description"),
                            module_meta.get("category"),
                            module_meta.get("module_version"),
                            module_meta.get("module_key"),
                            module_meta.get("home_route"),
                            module_meta.get("icon_key"),
                            _now(),
                            _now(),
                            None,
                            "installed",
                            version.get("version_id"),
                            None,
                            False,
                        ],
                        query_name="modules_installed.insert",
                    )
                else:
                    execute(
                        conn,
                        """
                        update modules_installed
                        set current_hash=%s,
                            updated_at=%s,
                            status=%s,
                            active_version=%s,
                            last_error=%s,
                            name=coalesce(%s, name),
                            description=coalesce(%s, description),
                            category=coalesce(%s, category),
                            module_version=coalesce(%s, module_version),
                            module_key=coalesce(%s, module_key),
                            home_route=coalesce(%s, home_route),
                            icon_key=coalesce(%s, icon_key),
                            archived=false
                        where org_id=%s and module_id=%s
                        """,
                        [
                            to_hash,
                            _now(),
                            "installed",
                            version.get("version_id"),
                            None,
                            module_name,
                            module_meta.get("description"),
                            module_meta.get("category"),
                            module_meta.get("module_version"),
                            module_meta.get("module_key"),
                            module_meta.get("home_route"),
                            module_meta.get("icon_key"),
                            get_org_id(),
                            module_id,
                        ],
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
        module_meta = _module_registry_meta_from_manifest(module_id, manifest if isinstance(manifest, dict) else {})

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
                set current_hash=%s,
                    updated_at=%s,
                    status=%s,
                    active_version=%s,
                    last_error=%s,
                    name=coalesce(%s, name),
                    description=coalesce(%s, description),
                    category=coalesce(%s, category),
                    module_version=coalesce(%s, module_version),
                    module_key=coalesce(%s, module_key),
                    home_route=coalesce(%s, home_route),
                    icon_key=coalesce(%s, icon_key)
                where org_id=%s and module_id=%s
                """,
                [
                    to_hash,
                    _now(),
                    "installed",
                    target_version.get("version_id"),
                    None,
                    module_meta.get("name"),
                    module_meta.get("description"),
                    module_meta.get("category"),
                    module_meta.get("module_version"),
                    module_meta.get("module_key"),
                    module_meta.get("home_route"),
                    module_meta.get("icon_key"),
                    get_org_id(),
                    module_id,
                ],
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
    def get_many(
        self,
        entity_id: str,
        record_ids: list[str],
        tenant_id: str | None = None,
        fields: list[str] | None = None,
    ) -> list[dict]:
        tenant_id = tenant_id or get_org_id()
        normalized_ids = [str(record_id).strip() for record_id in (record_ids or []) if isinstance(record_id, str) and str(record_id).strip()]
        if not normalized_ids:
            return []
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
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                f"""
                select id, {data_expr}
                from records_generic
                where tenant_id=%s and entity_id=%s and id = any(%s)
                """,
                select_params + [tenant_id, entity_id, normalized_ids],
                query_name="records_generic.get_many",
            )
        items: list[dict] = []
        for row in rows:
            record = _deepcopy(row.get("data") or {})
            record_id = str(row.get("id"))
            if isinstance(record, dict):
                record["id"] = record_id
            items.append({"record_id": record_id, "record": record})
        return items

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

    def list_by_field_value(
        self,
        entity_id: str,
        field_id: str,
        value: Any,
        tenant_id: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[dict]:
        tenant_id = tenant_id or get_org_id()
        if not isinstance(field_id, str) or not field_id.strip():
            return []
        scalar: str | None
        if value is None:
            scalar = None
        elif isinstance(value, bool):
            scalar = "true" if value else "false"
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            scalar = str(value)
        elif isinstance(value, str):
            scalar = value
        else:
            return []
        try:
            with get_conn() as conn:
                if _record_field_index_available(conn):
                    params: list[Any] = [tenant_id, entity_id, field_id.strip()]
                    if scalar is None:
                        value_clause = "idx.value_text is null"
                    else:
                        value_clause = "md5(idx.value_text) = md5(%s) and idx.value_text = %s"
                        params.extend([scalar, scalar])
                    params.extend([limit, offset])
                    rows = fetch_all(
                        conn,
                        f"""
                        select r.id, r.data
                        from records_generic_field_values idx
                        join records_generic r
                          on r.tenant_id=idx.tenant_id
                         and r.entity_id=idx.entity_id
                         and r.id::text=idx.record_id
                        where idx.tenant_id=%s
                          and idx.entity_id=%s
                          and idx.field_id=%s
                          and {value_clause}
                        order by idx.updated_at desc, idx.record_id desc
                        limit %s offset %s
                        """,
                        params,
                        query_name="records_generic.list_by_field_value_indexed",
                    )
                    items: list[dict] = []
                    for row in rows:
                        record = _deepcopy(row.get("data") or {})
                        record["id"] = str(row.get("id"))
                        items.append({"record_id": str(row.get("id")), "record": record})
                    return items
        except Exception as exc:
            _disable_record_field_index("read failed; falling back to JSONB scans", exc)
        params: list[Any] = [tenant_id, entity_id, field_id.strip()]
        where = "where tenant_id=%s and entity_id=%s and data ->> %s = %s"
        if scalar is None:
            where = "where tenant_id=%s and entity_id=%s and data -> %s = 'null'::jsonb"
        else:
            params.append(scalar)
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
                query_name="records_generic.list_by_field_value",
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
        if display_field and q_lower and len(q_lower) <= 512:
            try:
                with get_conn() as conn:
                    if _record_field_index_available(conn):
                        rows = fetch_all(
                            conn,
                            """
                            select idx.record_id as id, idx.value_text as label
                            from records_generic_field_values idx
                            join records_generic r
                              on r.tenant_id=idx.tenant_id
                             and r.entity_id=idx.entity_id
                             and r.id::text=idx.record_id
                            where idx.tenant_id=%s
                              and idx.entity_id=%s
                              and idx.field_id=%s
                              and idx.value_text is not null
                              and left(lower(idx.value_text), 512) like %s
                            order by idx.updated_at desc, idx.record_id desc
                            limit %s
                            """,
                            [tenant_id, entity_id, display_field, f"{q_lower}%", limit],
                            query_name="records_generic.list_lookup_indexed",
                        )
                        return [
                            {
                                "record_id": str(row.get("id")),
                                "record": {display_field: row.get("label"), "id": str(row.get("id"))},
                            }
                            for row in rows
                        ]
            except Exception as exc:
                _disable_record_field_index("lookup read failed; falling back to JSONB scans", exc)
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
        provided_id = data.get("id") if isinstance(data, dict) else None
        record_id = str(provided_id).strip() if isinstance(provided_id, str) and str(provided_id).strip() else str(uuid.uuid4())
        record = _deepcopy(data)
        record["id"] = record_id
        now = _now()
        with get_conn() as conn:
            execute(
                conn,
                """
                insert into records_generic (tenant_id, entity_id, id, data, created_at, updated_at)
                values (%s,%s,%s,%s,%s,%s)
                """,
                [tenant_id, entity_id, record_id, json.dumps(record), now, now],
                query_name="records_generic.create",
            )
            _replace_record_field_index(conn, tenant_id, entity_id, record_id, record, now)
        return {"record_id": record_id, "record": record}

    def update(self, entity_id: str, record_id: str, data: dict, tenant_id: str | None = None) -> dict:
        tenant_id = tenant_id or get_org_id()
        record = _deepcopy(data)
        record["id"] = record_id
        now = _now()
        with get_conn() as conn:
            execute(
                conn,
                """
                update records_generic
                set data=%s, updated_at=%s
                where tenant_id=%s and entity_id=%s and id=%s
                """,
                [json.dumps(record), now, tenant_id, entity_id, record_id],
                query_name="records_generic.update",
            )
            _replace_record_field_index(conn, tenant_id, entity_id, record_id, record, now)
        return {"record_id": record_id, "record": record}

    def delete(self, entity_id: str, record_id: str, tenant_id: str | None = None) -> None:
        tenant_id = tenant_id or get_org_id()
        with get_conn() as conn:
            _delete_record_field_index(conn, tenant_id, entity_id, record_id)
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
    def _row_to_secret(self, row: dict) -> dict:
        return {
            "id": row.get("id"),
            "org_id": row.get("org_id"),
            "name": row.get("name"),
            "provider_key": row.get("provider_key"),
            "secret_key": row.get("secret_key"),
            "status": row.get("status") or "active",
            "version": row.get("version") or 1,
            "last_rotated_at": row.get("last_rotated_at"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
        }

    def create(
        self,
        name: str | None,
        secret_enc: str,
        *,
        provider_key: str | None = None,
        secret_key: str | None = None,
        status: str | None = None,
        version: int | None = None,
        last_rotated_at: str | None = None,
    ) -> dict:
        with get_conn() as conn:
            try:
                row = fetch_one(
                    conn,
                    """
                    insert into secrets (
                      org_id, name, provider_key, secret_key, secret_enc, status, version, last_rotated_at, created_at, updated_at
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, now(), now())
                    returning id, org_id, name, provider_key, secret_key, status, version, last_rotated_at, created_at, updated_at
                    """,
                    [get_org_id(), name, provider_key, secret_key, secret_enc, status or "active", version or 1, last_rotated_at],
                    query_name="secrets.insert",
                )
                return self._row_to_secret(dict(row))
            except psycopg2.errors.UndefinedColumn:
                row = fetch_one(
                    conn,
                    """
                    insert into secrets (org_id, name, secret_enc, created_at, updated_at)
                    values (%s, %s, %s, now(), now())
                    returning id, org_id, name, created_at, updated_at
                    """,
                    [get_org_id(), name, secret_enc],
                    query_name="secrets.insert_legacy",
                )
                return self._row_to_secret(dict(row))

    def get(self, secret_id: str) -> dict | None:
        with get_conn() as conn:
            try:
                row = fetch_one(
                    conn,
                    """
                    select id, org_id, name, provider_key, secret_key, secret_enc, status, version, last_rotated_at, created_at, updated_at
                    from secrets where org_id=%s and id=%s
                    """,
                    [get_org_id(), secret_id],
                    query_name="secrets.get",
                )
            except psycopg2.errors.UndefinedColumn:
                row = fetch_one(
                    conn,
                    """
                    select id, org_id, name, secret_enc, created_at, updated_at
                    from secrets where org_id=%s and id=%s
                    """,
                    [get_org_id(), secret_id],
                    query_name="secrets.get_legacy",
                )
            return self._row_to_secret(dict(row)) if row else None

    def list(self, limit: int = 200) -> list[dict]:
        with get_conn() as conn:
            try:
                rows = fetch_all(
                    conn,
                    """
                    select id, org_id, name, provider_key, secret_key, status, version, last_rotated_at, created_at, updated_at
                    from secrets
                    where org_id=%s
                    order by created_at desc
                    limit %s
                    """,
                    [get_org_id(), max(1, min(int(limit or 200), 1000))],
                    query_name="secrets.list",
                )
            except psycopg2.errors.UndefinedColumn:
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
                    query_name="secrets.list_legacy",
                )
            return [self._row_to_secret(dict(r)) for r in rows]

    def rotate(self, secret_id: str, secret_enc: str) -> dict | None:
        with get_conn() as conn:
            try:
                row = fetch_one(
                    conn,
                    """
                    update secrets
                    set secret_enc=%s,
                        version=coalesce(version, 1) + 1,
                        last_rotated_at=now(),
                        updated_at=now()
                    where org_id=%s and id=%s
                    returning id, org_id, name, provider_key, secret_key, status, version, last_rotated_at, created_at, updated_at
                    """,
                    [secret_enc, get_org_id(), secret_id],
                    query_name="secrets.rotate",
                )
                return self._row_to_secret(dict(row)) if row else None
            except psycopg2.errors.UndefinedColumn:
                row = fetch_one(
                    conn,
                    """
                    update secrets
                    set secret_enc=%s, updated_at=now()
                    where org_id=%s and id=%s
                    returning id, org_id, name, created_at, updated_at
                    """,
                    [secret_enc, get_org_id(), secret_id],
                    query_name="secrets.rotate_legacy",
                )
                return self._row_to_secret(dict(row)) if row else None

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


class DbApiCredentialStore:
    def _row_to_credential(self, row: dict) -> dict:
        scopes = _ensure_json(row.get("scopes_json")) if row.get("scopes_json") is not None else []
        if not isinstance(scopes, list):
            scopes = []
        return {
            "id": row.get("id"),
            "org_id": row.get("org_id"),
            "name": row.get("name"),
            "key_prefix": row.get("key_prefix"),
            "scopes": [str(item).strip() for item in scopes if isinstance(item, str) and item.strip()],
            "status": row.get("status") or "active",
            "created_by": row.get("created_by"),
            "last_used_at": _to_iso(row.get("last_used_at")),
            "expires_at": _to_iso(row.get("expires_at")),
            "last_rotated_at": _to_iso(row.get("last_rotated_at")),
            "revoked_at": _to_iso(row.get("revoked_at")),
            "created_at": _to_iso(row.get("created_at")),
            "updated_at": _to_iso(row.get("updated_at")),
        }

    def create(
        self,
        *,
        name: str,
        key_prefix: str,
        key_hash: str,
        scopes: list[str] | None = None,
        status: str | None = None,
        created_by: str | None = None,
        expires_at: str | None = None,
        last_rotated_at: str | None = None,
    ) -> dict:
        payload_scopes = [str(item).strip() for item in (scopes or []) if isinstance(item, str) and str(item).strip()]
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into api_credentials (
                  id, org_id, name, key_prefix, key_hash, scopes_json, status, created_by, expires_at, last_rotated_at, created_at, updated_at
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now(), now())
                returning id, org_id, name, key_prefix, scopes_json, status, created_by, last_used_at, expires_at, last_rotated_at, revoked_at, created_at, updated_at
                """,
                [str(uuid.uuid4()), get_org_id(), name, key_prefix, key_hash, json.dumps(payload_scopes), status or "active", created_by, expires_at, last_rotated_at or _now()],
                query_name="api_credentials.create",
            )
            return self._row_to_credential(dict(row))

    def get(self, credential_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select id, org_id, name, key_prefix, scopes_json, status, created_by, last_used_at, expires_at, last_rotated_at, revoked_at, created_at, updated_at
                from api_credentials
                where org_id=%s and id=%s
                """,
                [get_org_id(), credential_id],
                query_name="api_credentials.get",
            )
            return self._row_to_credential(dict(row)) if row else None

    def list(self, limit: int = 200) -> list[dict]:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                select id, org_id, name, key_prefix, scopes_json, status, created_by, last_used_at, expires_at, last_rotated_at, revoked_at, created_at, updated_at
                from api_credentials
                where org_id=%s
                order by created_at desc
                limit %s
                """,
                [get_org_id(), max(1, min(int(limit or 200), 1000))],
                query_name="api_credentials.list",
            )
            return [self._row_to_credential(dict(row)) for row in rows]

    def revoke(self, credential_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                update api_credentials
                set status='revoked', revoked_at=now(), updated_at=now()
                where org_id=%s and id=%s
                returning id, org_id, name, key_prefix, scopes_json, status, created_by, last_used_at, expires_at, last_rotated_at, revoked_at, created_at, updated_at
                """,
                [get_org_id(), credential_id],
                query_name="api_credentials.revoke",
            )
            return self._row_to_credential(dict(row)) if row else None

    def rotate(self, credential_id: str, *, key_prefix: str, key_hash: str, expires_at: str | None = None) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                update api_credentials
                set key_prefix=%s,
                    key_hash=%s,
                    expires_at=coalesce(%s, expires_at),
                    last_rotated_at=now(),
                    status='active',
                    revoked_at=null,
                    updated_at=now()
                where org_id=%s and id=%s
                returning id, org_id, name, key_prefix, scopes_json, status, created_by, last_used_at, expires_at, last_rotated_at, revoked_at, created_at, updated_at
                """,
                [key_prefix, key_hash, expires_at, get_org_id(), credential_id],
                query_name="api_credentials.rotate",
            )
            return self._row_to_credential(dict(row)) if row else None

    def delete(self, credential_id: str) -> bool:
        with get_conn() as conn:
            execute(
                conn,
                """
                update api_request_logs
                set api_credential_id=null
                where org_id=%s and api_credential_id=%s
                """,
                [get_org_id(), credential_id],
                query_name="api_request_logs.clear_deleted_credential",
            )
            row = fetch_one(
                conn,
                """
                delete from api_credentials
                where org_id=%s and id=%s
                returning id
                """,
                [get_org_id(), credential_id],
                query_name="api_credentials.delete",
            )
            return bool(row)

    def get_by_key_hash_any(self, key_hash: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select id, org_id, name, key_prefix, scopes_json, status, created_by, last_used_at, expires_at, last_rotated_at, revoked_at, created_at, updated_at
                from api_credentials
                where key_hash=%s
                limit 1
                """,
                [key_hash],
                query_name="api_credentials.get_by_key_hash_any",
            )
            return self._row_to_credential(dict(row)) if row else None

    def touch_last_used_any(self, credential_id: str) -> None:
        with get_conn() as conn:
            execute(
                conn,
                """
                update api_credentials
                set last_used_at=now(), updated_at=now()
                where id=%s
                """,
                [credential_id],
                query_name="api_credentials.touch_last_used_any",
            )


class DbApiRequestLogStore:
    def create(self, entry: dict) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into api_request_logs (
                  id, org_id, api_credential_id, method, path, status_code,
                  duration_ms, ip_address, user_agent, created_at
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                returning *
                """,
                [
                    str(uuid.uuid4()),
                    get_org_id(),
                    entry.get("api_credential_id"),
                    entry.get("method"),
                    entry.get("path"),
                    int(entry.get("status_code") or 0),
                    int(entry.get("duration_ms")) if entry.get("duration_ms") is not None else None,
                    entry.get("ip_address"),
                    entry.get("user_agent"),
                ],
                query_name="api_request_logs.create",
            )
            return dict(row)

    def list(self, credential_id: str | None = None, limit: int = 200) -> list[dict]:
        clauses = ["org_id=%s"]
        params: list[Any] = [get_org_id()]
        if credential_id:
            clauses.append("api_credential_id=%s")
            params.append(credential_id)
        params.append(max(1, min(int(limit or 200), 1000)))
        where = " and ".join(clauses)
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                f"""
                select *
                from api_request_logs
                where {where}
                order by created_at desc
                limit %s
                """,
                params,
                query_name="api_request_logs.list",
            )
            return [dict(row) for row in rows]

    def count_recent(self, credential_id: str, window_seconds: int = 60) -> int:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select count(*)::int as total
                from api_request_logs
                where org_id=%s
                  and api_credential_id=%s
                  and created_at >= (now() - make_interval(secs => %s))
                """,
                [get_org_id(), credential_id, max(1, int(window_seconds or 60))],
                query_name="api_request_logs.count_recent",
            )
            return int((row or {}).get("total") or 0)


class DbExternalWebhookSubscriptionStore:
    def create(self, record: dict) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into external_webhook_subscriptions (
                  id, org_id, name, target_url, event_pattern, signing_secret_id,
                  status, headers_json, created_at, updated_at
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, now(), now())
                returning *
                """,
                [
                    str(uuid.uuid4()),
                    get_org_id(),
                    record.get("name"),
                    record.get("target_url"),
                    record.get("event_pattern"),
                    record.get("signing_secret_id"),
                    record.get("status") or "active",
                    json.dumps(record.get("headers_json") or {}),
                ],
                query_name="external_webhook_subscriptions.create",
            )
            return dict(row)

    def update(self, subscription_id: str, updates: dict) -> dict | None:
        fields: list[str] = []
        params: list[Any] = []
        for key in ("name", "target_url", "event_pattern", "signing_secret_id", "status", "headers_json", "last_delivered_at", "last_status_code", "last_error"):
            if key in updates:
                fields.append(f"{key}=%s")
                value = updates[key]
                if key == "headers_json":
                    value = json.dumps(value or {})
                params.append(value)
        if not fields:
            return self.get(subscription_id)
        params.extend([get_org_id(), subscription_id])
        with get_conn() as conn:
            row = fetch_one(
                conn,
                f"""
                update external_webhook_subscriptions
                set {', '.join(fields)}, updated_at=now()
                where org_id=%s and id=%s
                returning *
                """,
                params,
                query_name="external_webhook_subscriptions.update",
            )
            return dict(row) if row else None

    def get(self, subscription_id: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                "select * from external_webhook_subscriptions where org_id=%s and id=%s",
                [get_org_id(), subscription_id],
                query_name="external_webhook_subscriptions.get",
            )
            return dict(row) if row else None

    def list(self, status: str | None = None, limit: int = 500) -> list[dict]:
        clauses = ["org_id=%s"]
        params: list[Any] = [get_org_id()]
        if status:
            clauses.append("status=%s")
            params.append(status)
        params.append(max(1, min(int(limit or 500), 2000)))
        where = " and ".join(clauses)
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                f"""
                select *
                from external_webhook_subscriptions
                where {where}
                order by created_at desc
                limit %s
                """,
                params,
                query_name="external_webhook_subscriptions.list",
            )
            return [dict(row) for row in rows]

    def delete(self, subscription_id: str) -> bool:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                delete from external_webhook_subscriptions
                where org_id=%s and id=%s
                returning id
                """,
                [get_org_id(), subscription_id],
                query_name="external_webhook_subscriptions.delete",
            )
            return bool(row)


_SYSTEM_INTEGRATION_PROVIDERS: list[dict[str, Any]] = [
    {
        "key": "generic_rest",
        "name": "Generic REST API",
        "description": "Call external REST APIs with configurable auth and mappings.",
        "auth_type": "configurable",
        "manifest": {
            "capabilities": ["action.http_request", "sync.poll", "webhook.outbound"],
            "secret_keys": ["api_key", "bearer_token", "password", "client_secret", "access_token", "refresh_token"],
            "supported_auth_modes": ["none", "bearer", "api_key", "basic", "oauth2"],
            "setup_schema": {
                "fields": [
                    {
                        "id": "base_url",
                        "type": "text",
                        "label": "Base URL",
                        "group": "connection",
                        "help": "Base API URL for this system, for example https://api.example.com/v1.",
                        "placeholder": "https://api.example.com/v1",
                    },
                    {
                        "id": "auth_mode",
                        "type": "select",
                        "label": "Authentication mode",
                        "group": "connection",
                        "help": "Choose how this API authenticates requests.",
                        "options": ["none", "bearer", "api_key", "basic"],
                    },
                    {
                        "id": "api_key_in",
                        "type": "select",
                        "label": "API key location",
                        "group": "connection",
                        "help": "Only used when Authentication mode is API key.",
                        "options": [
                            {"value": "header", "label": "Header"},
                            {"value": "query", "label": "Query string"},
                        ],
                        "show_when": {"field": "auth_mode", "in": ["api_key"]},
                    },
                    {
                        "id": "api_key_name",
                        "type": "text",
                        "label": "API key field name",
                        "group": "connection",
                        "help": "For example X-API-Key or api_key.",
                        "placeholder": "X-API-Key",
                        "show_when": {"field": "auth_mode", "in": ["api_key"]},
                    },
                    {
                        "id": "username",
                        "type": "text",
                        "label": "Username",
                        "group": "connection",
                        "help": "Only used when Authentication mode is Basic.",
                        "show_when": {"field": "auth_mode", "in": ["basic"]},
                    },
                    {
                        "id": "authorization_url",
                        "type": "text",
                        "label": "Authorization URL",
                        "group": "connection",
                        "help": "Browser URL used to start the OAuth2 authorization flow.",
                        "placeholder": "https://provider.example.com/oauth/authorize",
                        "show_when": {"field": "auth_mode", "in": ["oauth2"]},
                    },
                    {
                        "id": "token_url",
                        "type": "text",
                        "label": "Token URL",
                        "group": "connection",
                        "help": "Token endpoint used to exchange authorization codes and refresh access tokens.",
                        "placeholder": "https://provider.example.com/oauth/token",
                        "show_when": {"field": "auth_mode", "in": ["oauth2"]},
                    },
                    {
                        "id": "client_id",
                        "type": "text",
                        "label": "Client ID",
                        "group": "connection",
                        "help": "OAuth2 client identifier issued by the provider.",
                        "show_when": {"field": "auth_mode", "in": ["oauth2"]},
                    },
                    {
                        "id": "oauth_scope",
                        "type": "text",
                        "label": "Scopes",
                        "group": "connection",
                        "help": "Space-separated scopes requested during OAuth2 authorization.",
                        "placeholder": "contacts.read contacts.write",
                        "show_when": {"field": "auth_mode", "in": ["oauth2"]},
                    },
                    {
                        "id": "oauth_audience",
                        "type": "text",
                        "label": "Audience",
                        "group": "advanced",
                        "help": "Optional audience parameter for providers that require it.",
                        "show_when": {"field": "auth_mode", "in": ["oauth2"]},
                    },
                    {
                        "id": "oauth_extra_authorize_params",
                        "type": "json",
                        "label": "Extra authorize parameters",
                        "group": "advanced",
                        "help": "Optional extra query parameters appended to the authorize URL.",
                        "show_when": {"field": "auth_mode", "in": ["oauth2"]},
                    },
                    {
                        "id": "oauth_extra_token_params",
                        "type": "json",
                        "label": "Extra token parameters",
                        "group": "advanced",
                        "help": "Optional extra parameters sent to the token endpoint.",
                        "show_when": {"field": "auth_mode", "in": ["oauth2"]},
                    },
                    {
                        "id": "oauth_token_refresh_leeway_seconds",
                        "type": "number",
                        "label": "Token refresh leeway seconds",
                        "group": "advanced",
                        "help": "Refresh access tokens slightly before they expire.",
                        "placeholder": "120",
                        "show_when": {"field": "auth_mode", "in": ["oauth2"]},
                    },
                    {
                        "id": "default_headers",
                        "type": "json",
                        "label": "Default headers",
                        "group": "advanced",
                        "help": "Optional headers sent with every request.",
                    },
                    {
                        "id": "test_request",
                        "type": "json",
                        "label": "Saved test request",
                        "group": "advanced",
                        "help": "Used by Test connection. Example: {\"method\":\"GET\",\"path\":\"/health\"}",
                    },
                ]
            },
            "sync_schema": {
                "fields": [
                    {
                        "id": "schedule_enabled",
                        "type": "boolean",
                        "label": "Run on a schedule",
                        "help": "Turn this on if Octodrop should poll this connection automatically in the background.",
                    },
                    {
                        "id": "schedule_every_minutes",
                        "type": "number",
                        "label": "Run every N minutes",
                        "help": "Simple polling interval for the shared scheduler.",
                        "placeholder": "60",
                    },
                    {
                        "id": "resource_key",
                        "type": "text",
                        "label": "Resource key",
                        "help": "Short name for what this sync imports, such as contacts or invoices.",
                        "placeholder": "contacts",
                    },
                    {
                        "id": "scope_key",
                        "type": "text",
                        "label": "Checkpoint scope",
                        "help": "Separate checkpoints by scope when one connection syncs more than one resource.",
                        "placeholder": "contacts",
                    },
                    {
                        "id": "request",
                        "type": "request_builder",
                        "label": "Sync request",
                        "help": "The API call used to fetch the next batch.",
                    },
                    {
                        "id": "items_path",
                        "type": "text",
                        "label": "Items path",
                        "help": "Dot path to the array of records in the JSON response, such as items or data.records.",
                        "placeholder": "items",
                    },
                    {
                        "id": "cursor_param",
                        "type": "text",
                        "label": "Cursor query parameter",
                        "help": "If set, the last checkpoint cursor is injected into this query parameter on the next run.",
                        "placeholder": "updated_since",
                    },
                    {
                        "id": "cursor_value_path",
                        "type": "text",
                        "label": "Next cursor path",
                        "help": "Optional dot path to the next cursor value in the response JSON.",
                        "placeholder": "meta.next_cursor",
                    },
                    {
                        "id": "last_item_cursor_path",
                        "type": "text",
                        "label": "Last-item cursor path",
                        "help": "Fallback cursor taken from the last returned item if the API does not return a separate next cursor.",
                        "placeholder": "updated_at",
                    },
                    {
                        "id": "limit_param",
                        "type": "text",
                        "label": "Limit query parameter",
                        "help": "Optional query parameter name for page size, such as limit or page_size.",
                        "placeholder": "limit",
                    },
                    {
                        "id": "max_items",
                        "type": "number",
                        "label": "Max items per run",
                        "help": "Optional page size injected into the limit parameter.",
                        "placeholder": "100",
                    },
                    {
                        "id": "emit_events",
                        "type": "boolean",
                        "label": "Emit automation events for each item",
                        "help": "When enabled, each fetched item is emitted into the automation event stream.",
                    },
                ]
            },
        },
    },
    {
        "key": "xero",
        "name": "Xero",
        "description": "Connect a client workspace to Xero using Octodrop's shared OAuth app and per-workspace authorization.",
        "auth_type": "oauth2",
        "manifest": {
            "capabilities": ["action.http_request", "sync.poll"],
            "secret_keys": ["client_secret", "access_token", "refresh_token"],
            "supported_auth_modes": ["oauth2"],
            "default_config": {
                "auth_mode": "oauth2",
                "base_url": "https://api.xero.com/api.xro/2.0",
                "authorization_url": "https://login.xero.com/identity/connect/authorize",
                "token_url": "https://identity.xero.com/connect/token",
                "client_id": _provider_env("OCTO_XERO_CLIENT_ID", "XERO_CLIENT_ID"),
                "oauth_scope": "openid profile email offline_access accounting.invoices accounting.contacts accounting.settings",
                "oauth_token_refresh_leeway_seconds": 120,
                "default_headers": {
                    "Accept": "application/json",
                },
                "test_request": {
                    "method": "GET",
                    "url": "https://api.xero.com/connections",
                },
                "sync": {
                    "sync_mode": "inbound_only",
                    "source_of_truth": "provider",
                    "conflict_policy": "source_of_truth",
                    "resource_key": "Contacts",
                    "scope_key": "Contacts",
                },
            },
            "sync_schema": {
                "fields": [
                    {
                        "id": "sync_mode",
                        "type": "select",
                        "label": "Sync mode",
                        "help": "Choose whether this connection currently pulls from Xero only or is reserved for future outbound/bidirectional sync.",
                        "options": [
                            {"value": "inbound_only", "label": "Inbound only (Xero -> OCTO)"},
                            {"value": "outbound_only", "label": "Outbound only (reserved)"},
                            {"value": "bidirectional", "label": "Bidirectional (reserved)"},
                        ],
                    },
                    {
                        "id": "source_of_truth",
                        "type": "select",
                        "label": "Source of truth",
                        "help": "Define which system owns synced values for this connection.",
                        "options": [
                            {"value": "provider", "label": "Provider owns synced fields"},
                            {"value": "octo", "label": "OCTO owns synced fields"},
                            {"value": "field_level", "label": "Field-level ownership (reserved)"},
                        ],
                    },
                    {
                        "id": "conflict_policy",
                        "type": "select",
                        "label": "Conflict policy",
                        "help": "Choose what should happen if inbound and local values differ.",
                        "options": [
                            {"value": "source_of_truth", "label": "Use source of truth"},
                            {"value": "newest_wins", "label": "Newest change wins (reserved)"},
                            {"value": "manual_review", "label": "Flag for manual review (reserved)"},
                        ],
                    },
                    {
                        "id": "schedule_enabled",
                        "type": "boolean",
                        "label": "Run on a schedule",
                        "help": "Turn this on if Octodrop should poll Xero automatically for the selected resource.",
                    },
                    {
                        "id": "schedule_every_minutes",
                        "type": "number",
                        "label": "Run every N minutes",
                        "help": "Simple polling interval for the shared scheduler.",
                        "placeholder": "60",
                    },
                    {
                        "id": "resource_key",
                        "type": "select",
                        "label": "Xero resource",
                        "help": "Choose which Xero resource this sync pulls into OCTO.",
                        "options": [
                            {"value": "Contacts", "label": "Contacts"},
                            {"value": "Invoices", "label": "Invoices"},
                            {"value": "Items", "label": "Items"},
                        ],
                    },
                    {
                        "id": "scope_key",
                        "type": "text",
                        "label": "Checkpoint scope",
                        "help": "Separate checkpoints by resource when one Xero connection syncs more than one resource.",
                        "placeholder": "Contacts",
                    },
                    {
                        "id": "emit_events",
                        "type": "boolean",
                        "label": "Emit automation events for each synced item",
                        "help": "When enabled, each fetched Xero item is emitted into the automation event stream after sync.",
                    },
                ]
            },
            "mapping_catalog": {
                "resources": [
                    {
                        "key": "Contacts",
                        "label": "Contacts",
                        "source_entity": "xero.contacts",
                        "suggested_target_entity": "entity.biz_contact",
                        "fields": [
                            {"path": "ContactID", "label": "Contact ID", "type": "string"},
                            {"path": "Name", "label": "Name", "type": "string"},
                            {"path": "FirstName", "label": "First name", "type": "string"},
                            {"path": "LastName", "label": "Last name", "type": "string"},
                            {"path": "EmailAddress", "label": "Email address", "type": "string"},
                            {"path": "ContactNumber", "label": "Contact number", "type": "string"},
                            {"path": "Phones[0].PhoneNumber", "label": "Primary phone", "type": "string"},
                            {"path": "ContactStatus", "label": "Contact status", "type": "string"},
                            {"path": "IsCustomer", "label": "Is customer", "type": "boolean"},
                            {"path": "IsSupplier", "label": "Is supplier", "type": "boolean"},
                        ],
                        "sample_record": {
                            "ContactID": "00000000-0000-0000-0000-000000000001",
                            "Name": "Acme Ltd",
                            "FirstName": "Ada",
                            "LastName": "Lovelace",
                            "EmailAddress": "ada@acme.test",
                            "ContactNumber": "C-100",
                            "Phones": [{"PhoneNumber": "+64 9 555 0100"}],
                            "ContactStatus": "ACTIVE",
                            "IsCustomer": True,
                            "IsSupplier": False,
                        },
                    },
                    {
                        "key": "Invoices",
                        "label": "Invoices",
                        "source_entity": "xero.invoices",
                        "suggested_target_entity": "entity.billing_invoice",
                        "fields": [
                            {"path": "InvoiceID", "label": "Invoice ID", "type": "string"},
                            {"path": "InvoiceNumber", "label": "Invoice number", "type": "string"},
                            {"path": "Type", "label": "Type", "type": "string"},
                            {"path": "Status", "label": "Status", "type": "string"},
                            {"path": "Date", "label": "Date", "type": "string"},
                            {"path": "DueDate", "label": "Due date", "type": "string"},
                            {"path": "Reference", "label": "Reference", "type": "string"},
                            {"path": "CurrencyCode", "label": "Currency", "type": "string"},
                            {"path": "SubTotal", "label": "Subtotal", "type": "number"},
                            {"path": "TotalTax", "label": "Tax", "type": "number"},
                            {"path": "Total", "label": "Total", "type": "number"},
                            {"path": "AmountDue", "label": "Amount due", "type": "number"},
                            {"path": "Contact.ContactID", "label": "Contact ID", "type": "string"},
                            {"path": "Contact.Name", "label": "Contact name", "type": "string"},
                        ],
                        "sample_record": {
                            "InvoiceID": "00000000-0000-0000-0000-000000000002",
                            "InvoiceNumber": "INV-1001",
                            "Type": "ACCREC",
                            "Status": "AUTHORISED",
                            "Date": "2026-04-16",
                            "DueDate": "2026-04-30",
                            "Reference": "PO-123",
                            "CurrencyCode": "NZD",
                            "SubTotal": 1000.0,
                            "TotalTax": 150.0,
                            "Total": 1150.0,
                            "AmountDue": 1150.0,
                            "Contact": {
                                "ContactID": "00000000-0000-0000-0000-000000000001",
                                "Name": "Acme Ltd",
                            },
                        },
                    },
                    {
                        "key": "Items",
                        "label": "Items",
                        "source_entity": "xero.items",
                        "suggested_target_entity": "entity.inventory_item",
                        "fields": [
                            {"path": "ItemID", "label": "Item ID", "type": "string"},
                            {"path": "Code", "label": "Code", "type": "string"},
                            {"path": "Name", "label": "Name", "type": "string"},
                            {"path": "Description", "label": "Description", "type": "string"},
                            {"path": "PurchaseDescription", "label": "Purchase description", "type": "string"},
                            {"path": "SalesDetails.UnitPrice", "label": "Sales unit price", "type": "number"},
                            {"path": "PurchaseDetails.UnitPrice", "label": "Purchase unit price", "type": "number"},
                            {"path": "IsTrackedAsInventory", "label": "Tracked inventory", "type": "boolean"},
                        ],
                        "sample_record": {
                            "ItemID": "00000000-0000-0000-0000-000000000003",
                            "Code": "WIDGET-01",
                            "Name": "Widget",
                            "Description": "Standard widget",
                            "PurchaseDescription": "Standard widget purchase",
                            "SalesDetails": {"UnitPrice": 49.95},
                            "PurchaseDetails": {"UnitPrice": 28.5},
                            "IsTrackedAsInventory": True,
                        },
                    },
                ]
            },
            "setup_schema": {
                "fields": [
                    {
                        "id": "base_url",
                        "type": "text",
                        "label": "Base URL",
                        "group": "connection",
                        "help": "Default Xero API base URL. Leave this as the standard Xero API unless you know you need a different endpoint family.",
                        "placeholder": "https://api.xero.com/api.xro/2.0",
                    },
                    {
                        "id": "authorization_url",
                        "type": "text",
                        "label": "Authorization URL",
                        "group": "connection",
                        "help": "Xero OAuth2 authorize endpoint for the shared Octodrop app.",
                        "placeholder": "https://login.xero.com/identity/connect/authorize",
                    },
                    {
                        "id": "token_url",
                        "type": "text",
                        "label": "Token URL",
                        "group": "connection",
                        "help": "Xero OAuth2 token endpoint for exchanging auth codes and refreshing tokens.",
                        "placeholder": "https://identity.xero.com/connect/token",
                    },
                    {
                        "id": "client_id",
                        "type": "text",
                        "label": "Client ID",
                        "group": "connection",
                        "help": "Client ID from the Octodrop Xero app in the Xero developer portal.",
                    },
                    {
                        "id": "oauth_scope",
                        "type": "text",
                        "label": "Scopes",
                        "group": "connection",
                        "help": "Scopes requested during Xero authorization. Adjust only if this workspace needs fewer or more permissions.",
                        "placeholder": "openid profile email offline_access accounting.invoices accounting.contacts accounting.settings",
                    },
                    {
                        "id": "xero_tenant_name",
                        "type": "text",
                        "label": "Selected tenant",
                        "group": "connection",
                        "help": "Filled automatically after the workspace authorizes Xero.",
                        "placeholder": "Acme Ltd",
                    },
                    {
                        "id": "xero_tenant_id",
                        "type": "text",
                        "label": "Selected tenant ID",
                        "group": "connection",
                        "help": "Used automatically on API requests via the Xero-Tenant-Id header.",
                    },
                    {
                        "id": "default_headers",
                        "type": "json",
                        "label": "Default headers",
                        "group": "advanced",
                        "help": "Optional extra headers sent with every request. Accept: application/json is included by default.",
                    },
                    {
                        "id": "oauth_token_refresh_leeway_seconds",
                        "type": "number",
                        "label": "Token refresh leeway seconds",
                        "group": "advanced",
                        "help": "Refresh access tokens slightly before they expire.",
                        "placeholder": "120",
                    },
                    {
                        "id": "xero_tenants",
                        "type": "json",
                        "label": "Discovered tenants",
                        "group": "advanced",
                        "help": "Stored automatically after authorization so the workspace can target the correct Xero organisation.",
                    },
                    {
                        "id": "test_request",
                        "type": "json",
                        "label": "Saved test request",
                        "group": "advanced",
                        "help": "Used by Test connection. The default checks the Xero tenant list endpoint.",
                    },
                ]
            },
        },
    },
    {
        "key": "shopify",
        "name": "Shopify",
        "description": "Connect a Shopify store for product, inventory, and order sync using Octodrop's shared app credentials and per-store authorization.",
        "auth_type": "oauth2",
        "manifest": {
            "capabilities": ["action.http_request", "sync.poll", "webhook.inbound"],
            "secret_keys": ["client_secret", "access_token", "signing_secret"],
            "supported_auth_modes": ["oauth2"],
            "default_config": {
                "auth_mode": "oauth2",
                "api_version": "2026-01",
                "client_id": _provider_env("OCTO_SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_ID"),
                "oauth_scope": "read_products,write_products,read_inventory,write_inventory,read_orders,read_all_orders,read_customers,read_locations",
                "default_headers": {
                    "Accept": "application/json",
                },
                "default_inventory_location_id": "",
                "test_request": {
                    "method": "GET",
                    "path": "/shop.json",
                },
                "sync": {
                    "sync_mode": "inbound_only",
                    "source_of_truth": "provider",
                    "conflict_policy": "source_of_truth",
                    "resource_key": "products",
                    "scope_key": "products",
                },
            },
            "sync_schema": {
                "fields": [
                    {
                        "id": "sync_mode",
                        "type": "select",
                        "label": "Sync mode",
                        "help": "Choose whether this connection currently pulls from Shopify only or is reserved for future outbound/bidirectional sync.",
                        "options": [
                            {"value": "inbound_only", "label": "Inbound only (Shopify -> OCTO)"},
                            {"value": "outbound_only", "label": "Outbound only (reserved)"},
                            {"value": "bidirectional", "label": "Bidirectional (reserved)"},
                        ],
                    },
                    {
                        "id": "source_of_truth",
                        "type": "select",
                        "label": "Source of truth",
                        "help": "Define which system owns synced values for this connection.",
                        "options": [
                            {"value": "provider", "label": "Provider owns synced fields"},
                            {"value": "octo", "label": "OCTO owns synced fields"},
                            {"value": "field_level", "label": "Field-level ownership (reserved)"},
                        ],
                    },
                    {
                        "id": "conflict_policy",
                        "type": "select",
                        "label": "Conflict policy",
                        "help": "Choose what should happen if inbound and local values differ.",
                        "options": [
                            {"value": "source_of_truth", "label": "Use source of truth"},
                            {"value": "newest_wins", "label": "Newest change wins (reserved)"},
                            {"value": "manual_review", "label": "Flag for manual review (reserved)"},
                        ],
                    },
                    {
                        "id": "schedule_enabled",
                        "type": "boolean",
                        "label": "Run on a schedule",
                        "help": "Turn this on if Octodrop should poll Shopify automatically for the selected resource.",
                    },
                    {
                        "id": "schedule_every_minutes",
                        "type": "number",
                        "label": "Run every N minutes",
                        "help": "Simple polling interval for the shared scheduler.",
                        "placeholder": "30",
                    },
                    {
                        "id": "resource_key",
                        "type": "select",
                        "label": "Shopify resource",
                        "help": "Choose which Shopify resource this sync pulls into OCTO.",
                        "options": [
                            {"value": "products", "label": "Products"},
                            {"value": "inventory_levels", "label": "Inventory levels"},
                            {"value": "orders", "label": "Orders"},
                        ],
                    },
                    {
                        "id": "scope_key",
                        "type": "text",
                        "label": "Checkpoint scope",
                        "help": "Separate checkpoints by resource when one Shopify connection syncs more than one resource.",
                        "placeholder": "products",
                    },
                    {
                        "id": "emit_events",
                        "type": "boolean",
                        "label": "Emit automation events for each synced item",
                        "help": "When enabled, each fetched Shopify item is emitted into the automation event stream after sync.",
                    },
                ]
            },
            "mapping_catalog": {
                "resources": [
                    {
                        "key": "products",
                        "label": "Products",
                        "source_entity": "shopify.products",
                        "fields": [
                            {"path": "id", "label": "Product ID", "type": "string"},
                            {"path": "title", "label": "Title", "type": "string"},
                            {"path": "handle", "label": "Handle", "type": "string"},
                            {"path": "status", "label": "Status", "type": "string"},
                            {"path": "vendor", "label": "Vendor", "type": "string"},
                            {"path": "productType", "label": "Product type", "type": "string"},
                            {"path": "variants[0].id", "label": "Primary variant ID", "type": "string"},
                            {"path": "variants[0].sku", "label": "Primary SKU", "type": "string"},
                            {"path": "variants[0].title", "label": "Primary variant title", "type": "string"},
                            {"path": "variants[0].price", "label": "Primary price", "type": "number"},
                            {"path": "variants[0].compareAtPrice", "label": "Primary compare-at price", "type": "number"},
                            {"path": "variants[0].inventoryItem.id", "label": "Inventory item ID", "type": "string"},
                            {"path": "onlineStoreUrl", "label": "Online store URL", "type": "string"},
                        ],
                        "sample_record": {
                            "id": "gid://shopify/Product/1001",
                            "title": "Magnesium Sleep Support",
                            "handle": "magnesium-sleep-support",
                            "status": "ACTIVE",
                            "vendor": "Example Vendor",
                            "productType": "Wellness",
                            "variants": [
                                {
                                    "id": "gid://shopify/ProductVariant/2001",
                                    "sku": "SKU-001",
                                    "title": "Default Title",
                                    "price": "39.90",
                                    "compareAtPrice": "49.90",
                                    "inventoryItem": {"id": "gid://shopify/InventoryItem/3001"},
                                }
                            ],
                            "onlineStoreUrl": "https://example-store.myshopify.com/products/magnesium-sleep-support",
                        },
                    },
                    {
                        "key": "inventory_levels",
                        "label": "Inventory Levels",
                        "source_entity": "shopify.inventory_levels",
                        "fields": [
                            {"path": "inventoryItem.id", "label": "Inventory item ID", "type": "string"},
                            {"path": "location.id", "label": "Location ID", "type": "string"},
                            {"path": "location.name", "label": "Location name", "type": "string"},
                            {"path": "quantities[0].name", "label": "Quantity type", "type": "string"},
                            {"path": "quantities[0].quantity", "label": "Quantity", "type": "number"},
                            {"path": "updatedAt", "label": "Updated at", "type": "string"},
                        ],
                        "sample_record": {
                            "inventoryItem": {"id": "gid://shopify/InventoryItem/3001"},
                            "location": {"id": "gid://shopify/Location/4001", "name": "Main Warehouse"},
                            "quantities": [{"name": "available", "quantity": 24}],
                            "updatedAt": "2026-04-17T10:15:00Z",
                        },
                    },
                    {
                        "key": "orders",
                        "label": "Orders",
                        "source_entity": "shopify.orders",
                        "fields": [
                            {"path": "id", "label": "Order ID", "type": "string"},
                            {"path": "name", "label": "Order number", "type": "string"},
                            {"path": "createdAt", "label": "Created at", "type": "string"},
                            {"path": "displayFinancialStatus", "label": "Financial status", "type": "string"},
                            {"path": "displayFulfillmentStatus", "label": "Fulfilment status", "type": "string"},
                            {"path": "totalPriceSet.shopMoney.amount", "label": "Total amount", "type": "number"},
                            {"path": "customer.id", "label": "Customer ID", "type": "string"},
                            {"path": "customer.email", "label": "Customer email", "type": "string"},
                        ],
                        "sample_record": {
                            "id": "gid://shopify/Order/5001",
                            "name": "#1001",
                            "createdAt": "2026-04-17T10:20:00Z",
                            "displayFinancialStatus": "PAID",
                            "displayFulfillmentStatus": "UNFULFILLED",
                            "totalPriceSet": {"shopMoney": {"amount": "131.00"}},
                            "customer": {"id": "gid://shopify/Customer/6001", "email": "customer@example.com"},
                        },
                    },
                ]
            },
            "setup_schema": {
                "fields": [
                    {
                        "id": "shop_domain",
                        "type": "text",
                        "label": "Shop domain",
                        "group": "connection",
                        "help": "Use the store's myshopify domain, for example example-store.myshopify.com.",
                        "placeholder": "example-store.myshopify.com",
                    },
                    {
                        "id": "api_version",
                        "type": "text",
                        "label": "Admin API version",
                        "group": "connection",
                        "help": "Pinned Shopify Admin API version used for requests.",
                        "placeholder": "2026-01",
                    },
                    {
                        "id": "client_id",
                        "type": "text",
                        "label": "Client ID",
                        "group": "connection",
                        "help": "Client ID from the Octodrop Shopify app in the Shopify Partner dashboard.",
                    },
                    {
                        "id": "oauth_scope",
                        "type": "text",
                        "label": "Scopes",
                        "group": "connection",
                        "help": "Comma-separated Shopify scopes requested during authorization.",
                        "placeholder": "read_products,write_products,read_inventory,write_inventory,read_orders,read_all_orders,read_customers,read_locations",
                    },
                    {
                        "id": "shopify_shop_name",
                        "type": "text",
                        "label": "Connected shop",
                        "group": "connection",
                        "help": "Filled automatically after the store authorizes Shopify.",
                    },
                    {
                        "id": "shopify_myshopify_domain",
                        "type": "text",
                        "label": "Connected myshopify domain",
                        "group": "connection",
                        "help": "Filled automatically after the store authorizes Shopify.",
                    },
                    {
                        "id": "shopify_shop_currency",
                        "type": "text",
                        "label": "Shop currency",
                        "group": "connection",
                        "help": "Filled automatically after the store authorizes Shopify.",
                    },
                    {
                        "id": "default_inventory_location_id",
                        "type": "text",
                        "label": "Default inventory location ID",
                        "group": "connection",
                        "help": "Shopify GID for the location Octodrop should update when pushing available stock.",
                        "placeholder": "gid://shopify/Location/123456789",
                    },
                    {
                        "id": "default_headers",
                        "type": "json",
                        "label": "Default headers",
                        "group": "advanced",
                        "help": "Optional extra headers sent with every request. Accept: application/json is included by default.",
                    },
                    {
                        "id": "test_request",
                        "type": "json",
                        "label": "Saved test request",
                        "group": "advanced",
                        "help": "Used by Test connection. The default checks the connected Shopify shop endpoint.",
                    },
                ]
            },
        },
    },
    {
        "key": "generic_webhook",
        "name": "Generic Webhook",
        "description": "Receive or send signed webhook events.",
        "auth_type": "webhook_signature",
        "manifest": {
            "capabilities": ["webhook.inbound", "webhook.outbound", "action.http_request"],
            "secret_keys": ["signing_secret"],
            "setup_schema": {
                "fields": [
                    {
                        "id": "endpoint_url",
                        "type": "text",
                        "label": "Outbound endpoint URL",
                        "group": "connection",
                        "help": "Used when this connection sends outbound webhooks.",
                        "placeholder": "https://hooks.example.com/inbound",
                    },
                    {
                        "id": "default_headers",
                        "type": "json",
                        "label": "Default headers",
                        "group": "advanced",
                        "help": "Optional headers sent with every webhook request.",
                    },
                    {
                        "id": "test_request",
                        "type": "json",
                        "label": "Saved test request",
                        "group": "advanced",
                        "help": "Optional test payload for validating outbound webhook setup.",
                    },
                ]
            },
        },
    },
    {
        "key": "smtp",
        "name": "SMTP",
        "description": "Send email via SMTP.",
        "auth_type": "basic",
        "manifest": {
            "capabilities": ["email.send"],
            "secret_keys": ["password"],
        },
    },
    {
        "key": "postmark",
        "name": "Postmark",
        "description": "Send email via Postmark.",
        "auth_type": "api_key",
        "manifest": {
            "capabilities": ["email.send"],
            "secret_keys": ["api_token"],
        },
    },
    {
        "key": "slack",
        "name": "Slack",
        "description": "Post messages and receive webhook events from Slack.",
        "auth_type": "oauth2",
        "manifest": {
            "capabilities": ["action.post_message", "webhook.inbound"],
            "secret_keys": ["bot_token", "signing_secret"],
        },
    },
]


class DbIntegrationProviderStore:
    def bootstrap_system(self) -> None:
        try:
            with db_internal_service():
                with get_conn() as conn:
                    for provider in _SYSTEM_INTEGRATION_PROVIDERS:
                        execute(
                            conn,
                            """
                            insert into integration_providers (
                              key, name, description, auth_type, manifest_json, is_system, created_at, updated_at
                            )
                            values (%s, %s, %s, %s, %s, true, now(), now())
                            on conflict (key)
                            do update set
                              name=excluded.name,
                              description=excluded.description,
                              auth_type=excluded.auth_type,
                              manifest_json=excluded.manifest_json,
                              updated_at=now()
                            """,
                            [
                                provider["key"],
                                provider["name"],
                                provider.get("description"),
                                provider.get("auth_type") or "none",
                                json.dumps(provider.get("manifest") or {}),
                            ],
                            query_name="integration_providers.bootstrap",
                        )
        except Exception as exc:
            if not _is_undefined_table(exc):
                return

    def list(self, include_system: bool = True) -> list[dict]:
        self.bootstrap_system()
        clauses: list[str] = []
        params: list[Any] = []
        if not include_system:
            clauses.append("is_system=false")
        where = f"where {' and '.join(clauses)}" if clauses else ""
        try:
            with get_conn() as conn:
                rows = fetch_all(
                    conn,
                    f"""
                    select id, key, name, description, auth_type, manifest_json, is_system, created_at, updated_at
                    from integration_providers
                    {where}
                    order by is_system desc, name asc
                    """,
                    params,
                    query_name="integration_providers.list",
                )
                return [dict(r) for r in rows]
        except Exception as exc:
            if include_system:
                return [
                    {
                        "id": None,
                        "key": provider["key"],
                        "name": provider["name"],
                        "description": provider.get("description"),
                        "auth_type": provider.get("auth_type") or "none",
                        "manifest_json": provider.get("manifest") or {},
                        "is_system": True,
                        "created_at": None,
                        "updated_at": None,
                    }
                    for provider in _SYSTEM_INTEGRATION_PROVIDERS
                ]
            return []

    def get_by_key(self, key: str) -> dict | None:
        self.bootstrap_system()
        try:
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    """
                    select id, key, name, description, auth_type, manifest_json, is_system, created_at, updated_at
                    from integration_providers
                    where key=%s
                    """,
                    [key],
                    query_name="integration_providers.get_by_key",
                )
                return dict(row) if row else None
        except Exception as exc:
            for provider in _SYSTEM_INTEGRATION_PROVIDERS:
                if provider["key"] == key:
                    return {
                        "id": None,
                        "key": provider["key"],
                        "name": provider["name"],
                        "description": provider.get("description"),
                        "auth_type": provider.get("auth_type") or "none",
                        "manifest_json": provider.get("manifest") or {},
                        "is_system": True,
                        "created_at": None,
                        "updated_at": None,
                    }
            return None


class DbConnectionSecretStore:
    def replace_for_connection(self, connection_id: str, secret_refs: dict[str, str | None] | None) -> list[dict]:
        refs = {str(k).strip(): v for k, v in (secret_refs or {}).items() if str(k).strip()}
        try:
            with get_conn() as conn:
                execute(
                    conn,
                    """
                    delete from integration_connection_secrets
                    where org_id=%s and connection_id=%s
                    """,
                    [get_org_id(), connection_id],
                    query_name="integration_connection_secrets.replace.delete",
                )
                for secret_key, secret_id in refs.items():
                    if not secret_id:
                        continue
                    execute(
                        conn,
                        """
                        insert into integration_connection_secrets (
                          org_id, connection_id, secret_id, secret_key, created_at, updated_at
                        )
                        values (%s, %s, %s, %s, now(), now())
                        """,
                        [get_org_id(), connection_id, secret_id, secret_key],
                        query_name="integration_connection_secrets.replace.insert",
                    )
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return []
        return self.list_for_connection(connection_id)

    def list_for_connection(self, connection_id: str) -> list[dict]:
        try:
            with get_conn() as conn:
                rows = fetch_all(
                    conn,
                    """
                    select id, org_id, connection_id, secret_id, secret_key, created_at, updated_at
                    from integration_connection_secrets
                    where org_id=%s and connection_id=%s
                    order by secret_key asc, created_at asc
                    """,
                    [get_org_id(), connection_id],
                    query_name="integration_connection_secrets.list_for_connection",
                )
                return [dict(r) for r in rows]
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return []

    def get_secret_ref(self, connection_id: str, secret_key: str | None = None) -> str | None:
        clauses = ["org_id=%s", "connection_id=%s"]
        params: list[Any] = [get_org_id(), connection_id]
        if secret_key:
            clauses.append("secret_key=%s")
            params.append(secret_key)
        sql = f"""
            select secret_id
            from integration_connection_secrets
            where {' and '.join(clauses)}
            order by case when secret_key=%s then 0 else 1 end, created_at asc
            limit 1
        """
        params.append(secret_key or "")
        try:
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    sql,
                    params,
                    query_name="integration_connection_secrets.get_secret_ref",
                )
                return str(row["secret_id"]) if row and row.get("secret_id") else None
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return None


def _attach_connection_secret_links(connection: dict | None) -> dict | None:
    if not connection or not connection.get("id"):
        return connection
    store = DbConnectionSecretStore()
    links = store.list_for_connection(str(connection["id"]))
    record = dict(connection)
    record["secret_links"] = links
    record["secret_refs"] = {item.get("secret_key"): item.get("secret_id") for item in links if item.get("secret_key")}
    return record


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
            record = dict(row)
        secret_refs = connection.get("secret_refs")
        if isinstance(secret_refs, dict):
            DbConnectionSecretStore().replace_for_connection(str(record["id"]), secret_refs)
        return _attach_connection_secret_links(record)

    def update(self, connection_id: str, updates: dict) -> dict | None:
        fields = []
        params = []
        for key in ("name", "config", "secret_ref", "status", "health_status", "last_tested_at", "last_success_at", "last_error"):
            if key in updates:
                fields.append(f"{key}=%s")
                value = updates[key]
                if key == "config":
                    value = json.dumps(value or {})
                params.append(value)
        secret_refs_update = updates.get("secret_refs") if isinstance(updates.get("secret_refs"), dict) else None
        if not fields:
            if secret_refs_update is not None:
                DbConnectionSecretStore().replace_for_connection(connection_id, secret_refs_update)
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
            record = dict(row) if row else None
        if record and secret_refs_update is not None:
            DbConnectionSecretStore().replace_for_connection(connection_id, secret_refs_update)
        return _attach_connection_secret_links(record)

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
            return _attach_connection_secret_links(dict(row)) if row else None

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
            return [_attach_connection_secret_links(dict(r)) for r in rows]

    def list_any(self, connection_type: str | None = None, status: str | None = None) -> list[dict]:
        clauses: list[str] = []
        params: list[Any] = []
        if connection_type:
            clauses.append("type=%s")
            params.append(connection_type)
        if status:
            clauses.append("status=%s")
            params.append(status)
        where = f"where {' and '.join(clauses)}" if clauses else ""
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                f"""
                select * from connections
                {where}
                order by created_at desc
                """,
                params,
                query_name="connections.list_any",
            )
            return [_attach_connection_secret_links(dict(r)) for r in rows]

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
            return _attach_connection_secret_links(dict(row)) if row else None

    def delete(self, connection_id: str) -> bool:
        with get_conn() as conn:
            execute(
                conn,
                """
                delete from connections where org_id=%s and id=%s
                """,
                [get_org_id(), connection_id],
                query_name="connections.delete",
            )
            return True


class DbIntegrationMappingStore:
    def create(self, mapping: dict) -> dict:
        try:
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    """
                    insert into integration_mappings (
                      org_id, connection_id, name, source_entity, target_entity, mapping_json, created_at, updated_at
                    )
                    values (%s, %s, %s, %s, %s, %s, now(), now())
                    returning *
                    """,
                    [
                        get_org_id(),
                        mapping.get("connection_id"),
                        mapping.get("name"),
                        mapping.get("source_entity"),
                        mapping.get("target_entity"),
                        json.dumps(mapping.get("mapping_json") or {}),
                    ],
                    query_name="integration_mappings.create",
                )
                return dict(row)
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            record = dict(mapping)
            record.setdefault("id", None)
            record.setdefault("org_id", get_org_id())
            return record

    def update(self, mapping_id: str, updates: dict) -> dict | None:
        fields: list[str] = []
        params: list[Any] = []
        for key in ("connection_id", "name", "source_entity", "target_entity", "mapping_json"):
            if key in updates:
                fields.append(f"{key}=%s")
                value = updates[key]
                if key == "mapping_json":
                    value = json.dumps(value or {})
                params.append(value)
        if not fields:
            return self.get(mapping_id)
        params.extend([get_org_id(), mapping_id])
        try:
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    f"""
                    update integration_mappings
                    set {', '.join(fields)}, updated_at=now()
                    where org_id=%s and id=%s
                    returning *
                    """,
                    params,
                    query_name="integration_mappings.update",
                )
                return dict(row) if row else None
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return None

    def get(self, mapping_id: str) -> dict | None:
        try:
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    "select * from integration_mappings where org_id=%s and id=%s",
                    [get_org_id(), mapping_id],
                    query_name="integration_mappings.get",
                )
                return dict(row) if row else None
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return None

    def list(self, connection_id: str | None = None) -> list[dict]:
        clauses = ["org_id=%s"]
        params: list[Any] = [get_org_id()]
        if connection_id:
            clauses.append("connection_id=%s")
            params.append(connection_id)
        try:
            with get_conn() as conn:
                rows = fetch_all(
                    conn,
                    f"""
                    select *
                    from integration_mappings
                    where {' and '.join(clauses)}
                    order by created_at desc
                    """,
                    params,
                    query_name="integration_mappings.list",
                )
                return [dict(r) for r in rows]
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return []

    def delete(self, mapping_id: str) -> bool:
        try:
            with get_conn() as conn:
                execute(
                    conn,
                    "delete from integration_mappings where org_id=%s and id=%s",
                    [get_org_id(), mapping_id],
                    query_name="integration_mappings.delete",
                )
                return True
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return False


class DbIntegrationWebhookStore:
    def create(self, webhook: dict) -> dict:
        try:
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    """
                    insert into integration_webhooks (
                      org_id, connection_id, direction, event_key, endpoint_path,
                      signing_secret_id, status, config_json, created_at, updated_at
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, now(), now())
                    returning *
                    """,
                    [
                        get_org_id(),
                        webhook.get("connection_id"),
                        webhook.get("direction"),
                        webhook.get("event_key"),
                        webhook.get("endpoint_path"),
                        webhook.get("signing_secret_id"),
                        webhook.get("status") or "active",
                        json.dumps(webhook.get("config_json") or {}),
                    ],
                    query_name="integration_webhooks.create",
                )
                return dict(row)
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            record = dict(webhook)
            record.setdefault("id", None)
            record.setdefault("org_id", get_org_id())
            return record

    def update(self, webhook_id: str, updates: dict) -> dict | None:
        fields: list[str] = []
        params: list[Any] = []
        for key in ("direction", "event_key", "endpoint_path", "signing_secret_id", "status", "config_json"):
            if key in updates:
                fields.append(f"{key}=%s")
                value = updates[key]
                if key == "config_json":
                    value = json.dumps(value or {})
                params.append(value)
        if not fields:
            return self.get(webhook_id)
        params.extend([get_org_id(), webhook_id])
        try:
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    f"""
                    update integration_webhooks
                    set {', '.join(fields)}, updated_at=now()
                    where org_id=%s and id=%s
                    returning *
                    """,
                    params,
                    query_name="integration_webhooks.update",
                )
                return dict(row) if row else None
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return None

    def get(self, webhook_id: str) -> dict | None:
        try:
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    "select * from integration_webhooks where org_id=%s and id=%s",
                    [get_org_id(), webhook_id],
                    query_name="integration_webhooks.get",
                )
                return dict(row) if row else None
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return None

    def get_any(self, webhook_id: str) -> dict | None:
        try:
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    "select * from integration_webhooks where id=%s",
                    [webhook_id],
                    query_name="integration_webhooks.get_any",
                )
                return dict(row) if row else None
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return None

    def list(self, connection_id: str | None = None) -> list[dict]:
        clauses = ["org_id=%s"]
        params: list[Any] = [get_org_id()]
        if connection_id:
            clauses.append("connection_id=%s")
            params.append(connection_id)
        try:
            with get_conn() as conn:
                rows = fetch_all(
                    conn,
                    f"""
                    select *
                    from integration_webhooks
                    where {' and '.join(clauses)}
                    order by created_at desc
                    """,
                    params,
                    query_name="integration_webhooks.list",
                )
                return [dict(r) for r in rows]
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return []

    def delete(self, webhook_id: str) -> bool:
        try:
            with get_conn() as conn:
                execute(
                    conn,
                    "delete from integration_webhooks where org_id=%s and id=%s",
                    [get_org_id(), webhook_id],
                    query_name="integration_webhooks.delete",
                )
                return True
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return False


class DbIntegrationRequestLogStore:
    def create(self, entry: dict) -> dict:
        try:
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    """
                    insert into integration_request_logs (
                      org_id, connection_id, source, direction, method, url,
                      request_headers_json, request_query_json, request_body_json, request_body_text,
                      response_status, response_headers_json, response_body_json, response_body_text,
                      ok, error_message, created_at
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                    returning *
                    """,
                    [
                        get_org_id(),
                        entry.get("connection_id"),
                        entry.get("source") or "manual",
                        entry.get("direction") or "outbound",
                        entry.get("method"),
                        entry.get("url"),
                        json.dumps(entry.get("request_headers_json") or {}),
                        json.dumps(entry.get("request_query_json") or {}),
                        json.dumps(entry.get("request_body_json")) if entry.get("request_body_json") is not None else None,
                        entry.get("request_body_text"),
                        entry.get("response_status"),
                        json.dumps(entry.get("response_headers_json") or {}),
                        json.dumps(entry.get("response_body_json")) if entry.get("response_body_json") is not None else None,
                        entry.get("response_body_text"),
                        entry.get("ok"),
                        entry.get("error_message"),
                    ],
                    query_name="integration_request_logs.create",
                )
                return dict(row)
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            record = dict(entry)
            record.setdefault("id", None)
            record.setdefault("org_id", get_org_id())
            return record

    def list(self, connection_id: str | None = None, source: str | None = None, limit: int = 200) -> list[dict]:
        clauses = ["org_id=%s"]
        params: list[Any] = [get_org_id()]
        if connection_id:
            clauses.append("connection_id=%s")
            params.append(connection_id)
        if source:
            clauses.append("source=%s")
            params.append(source)
        params.append(max(1, min(int(limit or 200), 1000)))
        try:
            with get_conn() as conn:
                rows = fetch_all(
                    conn,
                    f"""
                    select *
                    from integration_request_logs
                    where {' and '.join(clauses)}
                    order by created_at desc
                    limit %s
                    """,
                    params,
                    query_name="integration_request_logs.list",
                )
                return [dict(r) for r in rows]
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return []


class DbWebhookEventStore:
    def get(self, event_id: str) -> dict | None:
        try:
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    "select * from webhook_events where org_id=%s and id=%s",
                    [get_org_id(), event_id],
                    query_name="webhook_events.get",
                )
                return dict(row) if row else None
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return None

    def list(self, connection_id: str | None = None, status: str | None = None, limit: int = 200) -> list[dict]:
        clauses = ["org_id=%s"]
        params: list[Any] = [get_org_id()]
        if connection_id:
            clauses.append("connection_id=%s")
            params.append(connection_id)
        if status:
            clauses.append("status=%s")
            params.append(status)
        params.append(max(1, min(int(limit or 200), 1000)))
        try:
            with get_conn() as conn:
                rows = fetch_all(
                    conn,
                    f"""
                    select *
                    from webhook_events
                    where {' and '.join(clauses)}
                    order by received_at desc
                    limit %s
                    """,
                    params,
                    query_name="webhook_events.list",
                )
                return [dict(r) for r in rows]
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return []

    def create(self, event: dict) -> dict:
        try:
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    """
                    insert into webhook_events (
                      org_id, connection_id, provider_event_id, event_key,
                      headers_json, payload_json, signature_valid, status,
                      received_at, processed_at, error_message
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, now(), %s, %s)
                    on conflict (org_id, connection_id, provider_event_id)
                    where provider_event_id is not null
                    do update set
                      headers_json=excluded.headers_json,
                      payload_json=excluded.payload_json,
                      signature_valid=excluded.signature_valid,
                      status=excluded.status,
                      processed_at=excluded.processed_at,
                      error_message=excluded.error_message
                    returning *
                    """,
                    [
                        get_org_id(),
                        event.get("connection_id"),
                        event.get("provider_event_id"),
                        event.get("event_key"),
                        json.dumps(event.get("headers_json") or {}),
                        json.dumps(event.get("payload_json") or {}),
                        event.get("signature_valid"),
                        event.get("status") or "received",
                        event.get("processed_at"),
                        event.get("error_message"),
                    ],
                    query_name="webhook_events.insert",
                )
                return dict(row)
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return {
                "id": None,
                "org_id": get_org_id(),
                "connection_id": event.get("connection_id"),
                "provider_event_id": event.get("provider_event_id"),
                "event_key": event.get("event_key"),
                "headers_json": event.get("headers_json") or {},
                "payload_json": event.get("payload_json") or {},
                "signature_valid": event.get("signature_valid"),
                "status": event.get("status") or "received",
                "received_at": _now(),
                "processed_at": event.get("processed_at"),
                "error_message": event.get("error_message"),
            }

    def update_status(self, event_id: str, status: str, *, processed_at: str | None = None, error_message: str | None = None) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                update webhook_events
                set status=%s, processed_at=%s, error_message=%s
                where org_id=%s and id=%s
                returning *
                """,
                [status, processed_at, error_message, get_org_id(), event_id],
                query_name="webhook_events.update_status",
            )
            return dict(row) if row else None


class DbSyncCheckpointStore:
    def upsert(self, checkpoint: dict) -> dict:
        try:
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    """
                    insert into sync_checkpoints (
                      org_id, connection_id, scope_key, cursor_value, cursor_json,
                      last_synced_at, status, last_error, created_at, updated_at
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, now(), now())
                    on conflict (org_id, connection_id, scope_key)
                    do update set
                      cursor_value=excluded.cursor_value,
                      cursor_json=excluded.cursor_json,
                      last_synced_at=excluded.last_synced_at,
                      status=excluded.status,
                      last_error=excluded.last_error,
                      updated_at=now()
                    returning *
                    """,
                    [
                        get_org_id(),
                        checkpoint.get("connection_id"),
                        checkpoint.get("scope_key"),
                        checkpoint.get("cursor_value"),
                        json.dumps(checkpoint.get("cursor_json") or {}),
                        checkpoint.get("last_synced_at"),
                        checkpoint.get("status") or "idle",
                        checkpoint.get("last_error"),
                    ],
                    query_name="sync_checkpoints.upsert",
                )
                return dict(row)
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return {
                "id": None,
                "org_id": get_org_id(),
                "connection_id": checkpoint.get("connection_id"),
                "scope_key": checkpoint.get("scope_key"),
                "cursor_value": checkpoint.get("cursor_value"),
                "cursor_json": checkpoint.get("cursor_json") or {},
                "last_synced_at": checkpoint.get("last_synced_at"),
                "status": checkpoint.get("status") or "idle",
                "last_error": checkpoint.get("last_error"),
                "created_at": None,
                "updated_at": None,
            }

    def get(self, connection_id: str, scope_key: str) -> dict | None:
        try:
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    """
                    select *
                    from sync_checkpoints
                    where org_id=%s and connection_id=%s and scope_key=%s
                    """,
                    [get_org_id(), connection_id, scope_key],
                    query_name="sync_checkpoints.get",
                )
                return dict(row) if row else None
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return None

    def list(self, connection_id: str | None = None) -> list[dict]:
        clauses = ["org_id=%s"]
        params: list[Any] = [get_org_id()]
        if connection_id:
            clauses.append("connection_id=%s")
            params.append(connection_id)
        try:
            with get_conn() as conn:
                rows = fetch_all(
                    conn,
                    f"""
                    select *
                    from sync_checkpoints
                    where {' and '.join(clauses)}
                    order by updated_at desc
                    """,
                    params,
                    query_name="sync_checkpoints.list",
                )
                return [dict(r) for r in rows]
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
            return []


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
                    and (
                      (status='queued' and run_at <= now())
                      or (
                        status='running'
                        and locked_at is not null
                        and locked_at < now() - (%s * interval '1 second')
                        and attempt < max_attempts
                      )
                    )
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
                [get_org_id(), _job_lock_lease_seconds(), limit, worker_id],
                query_name="jobs.claim_batch",
            )
            return [dict(r) for r in rows]

    def claim_batch_any(self, limit: int, worker_id: str) -> list[dict]:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                with candidates as (
                  select id from jobs
                  where (
                    (status='queued' and run_at <= now())
                    or (
                      status='running'
                      and locked_at is not null
                      and locked_at < now() - (%s * interval '1 second')
                      and attempt < max_attempts
                    )
                  )
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
                [_job_lock_lease_seconds(), limit, worker_id],
                query_name="jobs.claim_batch_any",
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

    def get_by_idempotency(self, job_type: str, idempotency_key: str) -> dict | None:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select * from jobs
                where org_id=%s and type=%s and idempotency_key=%s
                order by created_at desc
                limit 1
                """,
                [get_org_id(), job_type, idempotency_key],
                query_name="jobs.get_by_idempotency",
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

    def delete(self, job_id: str) -> bool:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                delete from jobs
                where org_id=%s and id=%s
                returning id
                """,
                [get_org_id(), job_id],
                query_name="jobs.delete",
            )
            return bool(row)


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

    def list_since(self, user_id: str, since: str, unread_only: bool = False, limit: int = 200) -> list[dict]:
        clauses = ["org_id=%s", "recipient_user_id=%s", "created_at > %s"]
        params = [get_org_id(), user_id, since]
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
                query_name="notifications.list_since",
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
                with updated as (
                  update notifications
                  set read_at=now()
                  where org_id=%s and recipient_user_id=%s and read_at is null
                  returning 1
                )
                select count(*) as count from updated
                """,
                [get_org_id(), user_id],
                query_name="notifications.mark_all",
            )
            return int(row["count"]) if row else 0

    def clear_all(self, user_id: str) -> int:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                with deleted as (
                  delete from notifications
                  where org_id=%s and recipient_user_id=%s
                  returning 1
                )
                select count(*) as count from deleted
                """,
                [get_org_id(), user_id],
                query_name="notifications.clear_all",
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
                  org_id, name, description, subject, body_html, body_text, variables_schema,
                  is_active, default_connection_id, created_at, updated_at
                ) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),now())
                returning *
                """,
                [
                    get_org_id(),
                    record.get("name"),
                    record.get("description"),
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
        for key in ("name", "description", "subject", "body_html", "body_text", "variables_schema", "is_active", "default_connection_id"):
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

    def delete_template(self, template_id: str) -> bool:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                delete from email_templates
                where org_id=%s and id=%s
                returning id
                """,
                [get_org_id(), template_id],
                query_name="email_templates.delete",
            )
            return bool(row)

    def create_outbox(self, record: dict) -> dict:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into email_outbox (
                  org_id, "to", cc, bcc, from_email, reply_to, subject,
                  body_html, body_text, status, provider_message_id, last_error, template_id, attachments_json, created_at, sent_at
                ) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),%s)
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
                    json.dumps(record.get("attachments_json") or []),
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

    def delete_outbox(self, outbox_id: str) -> bool:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                delete from email_outbox
                where org_id=%s and id=%s
                returning id
                """,
                [get_org_id(), outbox_id],
                query_name="email_outbox.delete",
            )
            return bool(row)


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
                  org_id, name, description, format, html, filename_pattern, paper_size,
                  margin_top, margin_right, margin_bottom, margin_left,
                  header_html, footer_html, variables_schema, created_at, updated_at
                ) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),now())
                returning *
                """,
                [
                    get_org_id(),
                    record.get("name"),
                    record.get("description"),
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
                    json.dumps(record.get("variables_schema") or {}),
                ],
                query_name="doc_templates.insert",
            )
            return dict(row)

    def update(self, template_id: str, updates: dict) -> dict | None:
        fields = []
        params = []
        for key in (
            "name",
            "description",
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
            "variables_schema",
        ):
            if key in updates:
                fields.append(f"{key}=%s")
                value = updates[key]
                if key == "variables_schema":
                    value = json.dumps(value or {})
                params.append(value)
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

    def delete(self, template_id: str) -> bool:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                delete from doc_templates
                where org_id=%s and id=%s
                returning id
                """,
                [get_org_id(), template_id],
                query_name="doc_templates.delete",
            )
            return bool(row)


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

    def list_any(self, status: str | None = None) -> list[dict]:
        clauses: list[str] = []
        params: list[Any] = []
        if status:
            clauses.append("status=%s")
            params.append(status)
        where = f"where {' and '.join(clauses)}" if clauses else ""
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                f"""
                select * from automations {where} order by updated_at desc
                """,
                params,
                query_name="automations.list_any",
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
            try:
                row = fetch_one(
                    conn,
                    """
                    insert into automation_runs (
                      org_id, automation_id, status, trigger_event_id, trigger_type, trigger_payload,
                      current_step_index, created_at, updated_at, started_at, ended_at, last_error, idempotency_key
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    on conflict (org_id, automation_id, idempotency_key)
                    where idempotency_key is not null
                    do update set updated_at=excluded.updated_at
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
                        record.get("idempotency_key"),
                    ],
                    query_name="automation_runs.create",
                )
            except psycopg2.errors.UndefinedColumn:
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
                    query_name="automation_runs.create_legacy",
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
