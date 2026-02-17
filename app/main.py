"""FastAPI app for OCTO MVP product layer."""

from __future__ import annotations

import os
import re
import sys
import hashlib
import urllib.request
import urllib.error
from types import SimpleNamespace
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, Response

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_file(ROOT / "app" / ".env")

import time
import asyncio
import anyio
import logging
import json
import logging
import copy
import uuid
import socket
from datetime import date, datetime
from urllib.parse import urlparse
from dataclasses import dataclass, field

if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        pass

from app.agent_stream import (
    AgentProgress,
    summarize_build_spec,
    summarize_plan,
    preview_calls,
    diff_manifest,
    top_errors,
)

from app.auth import SupabaseAuthMiddleware
from app.db import get_db_ms, reset_db_ms, get_db_stats, get_db_query_log
from app.manifest_validate import validate_manifest, validate_manifest_raw
from app.diagnostics import build_diagnostics
from app.records_validation import (
    entities_from_manifest as _entities_from_manifest,
    match_entity_id as _match_entity_id,
    normalize_entity_id as _normalize_entity_id,
    find_entity_def as _find_entity_def_in_registry,
    find_entity_workflow as _find_entity_workflow,
    validate_record_payload as _validate_record_payload,
    validate_lookup_fields as _validate_lookup_fields,
    enum_values as _enum_values,
    is_uuid as _is_uuid,
)
from app.conditions import eval_condition
from app.module_delete import collect_entity_record_ids, delete_module_memory, SYSTEM_MODULE_IDS
from app.stores import (
    InMemoryActionCaller,
    InMemoryQueryRunner,
    InMemoryTxManager,
    MemoryDraftStore,
    MemoryGenericRecordStore,
    MemoryChatterStore,
    MemoryActivityStore,
    MemoryJobStore,
    MemoryNotificationStore,
    MemoryEmailStore,
    MemoryAttachmentStore,
    MemoryDocTemplateStore,
    MemoryConnectionStore,
    MemoryAutomationStore,
)
from app.db import execute, get_conn, fetch_all, fetch_one
from app.stores_db import (
    DbManifestStore,
    DbModuleRegistry,
    DbTxManager,
    DbDraftStore,
    DbGenericRecordStore,
    DbChatterStore,
    DbActivityStore,
    DbJobStore,
    DbNotificationStore,
    DbEmailStore,
    DbAttachmentStore,
    DbDocTemplateStore,
    DbConnectionStore,
    DbSecretStore,
    DbAutomationStore,
    _now,
    set_org_id,
    reset_org_id,
    get_org_id,
    _insert_module_version,
)
from app.email import render_template, get_provider
from app.template_render import collect_undeclared_vars, validate_templates
from app.secrets import create_secret, encrypt_secret, resolve_secret, SecretStoreError
from app.attachments import store_bytes, resolve_path, read_bytes, public_url, branding_bucket, using_supabase_storage
from app.doc_render import render_html, render_pdf, normalize_margins
from app.automations import match_event
from app.automations_runtime import handle_event as handle_automation_event
from app.workspaces import (
    list_memberships,
    get_membership,
    create_workspace_for_user,
    list_workspace_members,
    list_user_workspaces,
    list_all_workspaces,
    workspace_exists,
    get_platform_role,
    add_workspace_member,
    update_workspace_member_role,
    remove_workspace_member,
    set_platform_role,
)
from octo.manifest_hash import manifest_hash
from manifest_store import ManifestStore
from module_registry import ModuleRegistry
from outbox import Outbox
from event_bus import EventBus, make_event


app = FastAPI(title="OCTO MVP")
_action_logger = logging.getLogger("octo.actions")
logger = logging.getLogger("octo")
logging.basicConfig(level=logging.INFO)
_LOCAL_CORS_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
}
_LOCAL_CORS_REGEX = re.compile(r"^http://(localhost|127\.0\.0\.1):\d+$")
_EXTRA_CORS_ORIGINS = {
    origin.strip().rstrip("/")
    for origin in os.getenv("OCTO_CORS_ORIGINS", "").split(",")
    if origin.strip()
}
_CORS_ORIGINS = _LOCAL_CORS_ORIGINS | _EXTRA_CORS_ORIGINS


@app.middleware("http")
async def local_cors_fallback_middleware(request: Request, call_next):
    origin = request.headers.get("origin")
    if request.method == "OPTIONS":
        response = JSONResponse({}, status_code=200)
    else:
        response = await call_next(request)
    normalized_origin = origin.rstrip("/") if isinstance(origin, str) else origin
    if normalized_origin and (normalized_origin in _CORS_ORIGINS or _LOCAL_CORS_REGEX.match(normalized_origin)):
        response.headers.setdefault("Access-Control-Allow-Origin", origin)
        response.headers.setdefault("Access-Control-Allow-Credentials", "true")
        response.headers.setdefault("Access-Control-Allow-Headers", "*")
        response.headers.setdefault("Access-Control-Allow-Methods", "*")
        response.headers.setdefault("Vary", "Origin")
    return response


def _log_db_rtt_once() -> None:
    url = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
    if not url:
        return
    try:
        parsed = urlparse(url)
        host = parsed.hostname
        port = parsed.port or 5432
        if not host:
            return
        start = time.perf_counter()
        with socket.create_connection((host, port), timeout=1.0):
            pass
        rtt_ms = (time.perf_counter() - start) * 1000
        logger.info("db_rtt host=%s port=%s rtt_ms=%.1f", host, port, rtt_ms)
    except Exception:
        return


_log_db_rtt_once()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_AUD = os.getenv("SUPABASE_JWT_AUD", "").strip() or None
DISABLE_AUTH = os.getenv("OCTO_DISABLE_AUTH", "").strip().lower() in ("1", "true", "yes")
logger.info("auth_disabled=%s supabase_url=%s supabase_aud=%s", DISABLE_AUTH, SUPABASE_URL, SUPABASE_AUD)
ALLOWED_ACTION_KINDS = {"navigate", "open_form", "refresh", "create_record", "update_record", "bulk_update"}
LEGACY_ENTITY_PREFIX = "entity."


def _legacy_entity_id(entity_id: str) -> str | None:
    if isinstance(entity_id, str) and entity_id.startswith(LEGACY_ENTITY_PREFIX):
        return entity_id[len(LEGACY_ENTITY_PREFIX) :]
    return None


def _find_record_anywhere(record_id: str) -> tuple[str, dict] | None:
    if not isinstance(record_id, str) or not record_id:
        return None
    if hasattr(generic_records, "_records"):
        buckets = getattr(generic_records, "_records", {})
        for tenant_id, entities in buckets.items():
            for entity_id, records in entities.items():
                record = records.get(record_id)
                if record:
                    return entity_id, {"record_id": record_id, "record": record}
        return None
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            select entity_id, data
            from records_generic
            where id=%s
            limit 1
            """,
            [record_id],
            query_name="records_generic.find_anywhere",
        )
        if not row:
            return None
        data = row.get("data")
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                data = {}
        return row.get("entity_id"), {"record_id": record_id, "record": data or {}}


def _get_perf_budget_ms(method: str, path: str) -> float | None:
    budgets = {
        ("GET", "/modules"): 300.0,
        ("GET", "/studio2/modules"): 300.0,
        ("GET", "/studio2/registry"): 300.0,
    }
    budget = budgets.get((method, path))
    if budget is not None:
        return budget
    if method == "GET" and path.startswith("/records/"):
        return 300.0
    return None



@app.middleware("http")
async def timing_middleware(request: Request, call_next):
    if not hasattr(request.state, "cache"):
        request.state.cache = {}
    reset_db_ms()
    start = time.perf_counter()
    response = await call_next(request)
    total_ms = (time.perf_counter() - start) * 1000
    auth_ms = getattr(request.state, "auth_ms", 0.0)
    db_ms = get_db_ms()
    db_stats = get_db_stats()
    handler_ms = max(total_ms - auth_ms - db_ms, 0.0)
    route = request.scope.get("route")
    route_name = getattr(route, "name", None) or getattr(request.scope.get("endpoint"), "__name__", None) or "unknown"
    logger.info(
        "%s %s %s route=%s total_ms=%.1f auth_ms=%.1f db_ms=%.1f db_q=%s db_acquire_ms=%.1f db_wire_ms=%.1f db_decode_ms=%.1f handler_ms=%.1f",
        request.method,
        request.url.path,
        response.status_code,
        route_name,
        total_ms,
        auth_ms,
        db_ms,
        db_stats.get("queries", 0),
        db_stats.get("acquire_ms", 0.0),
        db_stats.get("wire_ms", db_stats.get("execute_ms", 0.0)),
        db_stats.get("decode_ms", 0.0),
        handler_ms,
    )
    if total_ms >= REQ_SLOW_MS or db_ms >= REQ_DB_SLOW_MS:
        logger.warning(
            "slow_request method=%s path=%s route=%s total_ms=%.1f db_ms=%.1f status=%s",
            request.method,
            request.url.path,
            route_name,
            total_ms,
            db_ms,
            response.status_code,
        )
    budget_ms = _get_perf_budget_ms(request.method, request.url.path)
    if budget_ms is not None and total_ms > budget_ms:
        logger.warning(
            "perf_budget_exceeded method=%s path=%s total_ms=%.1f budget_ms=%.1f",
            request.method,
            request.url.path,
            total_ms,
            budget_ms,
        )
    if db_stats.get("queries", 0) > 1:
        logger.warning("db_queries=%s", get_db_query_log())
    if IS_DEV:
        response.headers["X-Req-MS"] = f"{total_ms:.1f}"
        response.headers["X-DB-MS"] = f"{db_ms:.1f}"
        response.headers["X-Queries"] = str(db_stats.get("queries", 0))
        response.headers["X-DB-Wire-MS"] = f"{db_stats.get('wire_ms', 0.0):.1f}"
        response.headers["X-DB-Decode-MS"] = f"{db_stats.get('decode_ms', 0.0):.1f}"
        response.headers["X-Route"] = route_name
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    return _error_response("INTERNAL_ERROR", "Unexpected server error", detail={"error": str(exc)}, status=500)


USE_DB = os.getenv("USE_DB", "").strip() == "1"
USE_AI = os.getenv("USE_AI", "").strip() == "1"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "").strip() or "https://api.openai.com"
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "").strip() or "gpt-4o-mini"
STUDIO2_PLANNER_MODEL = os.getenv("STUDIO2_PLANNER_MODEL", "").strip() or OPENAI_MODEL
STUDIO2_BUILDER_MODEL = os.getenv("STUDIO2_BUILDER_MODEL", "").strip() or OPENAI_MODEL
OPENAI_TIMEOUT = float(os.getenv("OPENAI_TIMEOUT", "120"))
STUDIO2_AGENT_DEBUG = os.getenv("STUDIO2_AGENT_DEBUG", "").strip().lower() in ("1", "true", "yes")
STUDIO2_AGENT_LOG_PAYLOAD = os.getenv("STUDIO2_AGENT_LOG_PAYLOAD", "").strip().lower() in ("1", "true", "yes")
STUDIO2_AGENT_STREAM_DEBUG = os.getenv("STUDIO2_AGENT_STREAM_DEBUG", "").strip().lower() in ("1", "true", "yes")
STUDIO2_MAX_CONTEXT_BYTES = int(os.getenv("STUDIO2_MAX_CONTEXT_BYTES", "12000"))
STUDIO2_MAX_REGISTRY_BYTES = int(os.getenv("STUDIO2_MAX_REGISTRY_BYTES", "3000"))
STUDIO2_READ_MANIFEST_MAX_BYTES = int(os.getenv("STUDIO2_READ_MANIFEST_MAX_BYTES", "80000"))
MAX_AGENT_ITERS = int(os.getenv("STUDIO2_AGENT_MAX_ITERS", os.getenv("MAX_AGENT_ITERS", "6")))
MAX_AGENT_OPS = int(os.getenv("MAX_AGENT_OPS", "200"))

if USE_DB:
    store = DbManifestStore()
    registry = DbModuleRegistry(store)
    generic_records = DbGenericRecordStore()
    chatter_store = DbChatterStore()
    activity_store = DbActivityStore()
    tx_mgr = DbTxManager()
    drafts = DbDraftStore()
    job_store = DbJobStore()
    notification_store = DbNotificationStore()
    email_store = DbEmailStore()
    attachment_store = DbAttachmentStore()
    doc_template_store = DbDocTemplateStore()
    connection_store = DbConnectionStore()
    secret_store = DbSecretStore()
    automation_store = DbAutomationStore()
else:
    store = ManifestStore()
    registry = ModuleRegistry(store)
    generic_records = MemoryGenericRecordStore()
    chatter_store = MemoryChatterStore()
    activity_store = MemoryActivityStore()
    tx_mgr = InMemoryTxManager()
    drafts = MemoryDraftStore()
    job_store = MemoryJobStore()
    notification_store = MemoryNotificationStore()
    email_store = MemoryEmailStore()
    attachment_store = MemoryAttachmentStore()
    doc_template_store = MemoryDocTemplateStore()
    connection_store = MemoryConnectionStore()
    secret_store = None
    automation_store = MemoryAutomationStore()

actions = InMemoryActionCaller()
queries = InMemoryQueryRunner()
outbox = Outbox()
event_bus = EventBus(outbox)
_cache = {
    "modules": {"value": None, "ts": 0.0},
    "manifest": {},  # key -> {value, ts}
    "studio_modules": {"value": None, "ts": 0.0},
    "registry_list": {"value": None, "ts": 0.0},
    "studio2_registry": {},
    "studio2_registry_summary": {},
}
_compiled_cache = {}  # key -> {value, ts}
_entity_def_cache: dict[str, dict] = {}
_response_cache: dict[str, dict] = {}
_CACHE_TTL_S = 30.0
_RESPONSE_TTL_S = 60.0
APP_ENV = os.getenv("APP_ENV", os.getenv("ENV", "dev")).strip().lower() or "dev"
IS_DEV = APP_ENV == "dev"
DEV_MODE_ALLOW_OVERRIDE = os.getenv("DEV_MODE_ALLOW_OVERRIDE", "").strip() == "1"
REQ_SLOW_MS = float(os.getenv("OCTO_REQ_SLOW_MS", "250"))
REQ_DB_SLOW_MS = float(os.getenv("OCTO_REQ_DB_SLOW_MS", "100"))
_MODULE_MUTATIONS: set[str] = set()


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


@app.get("/ops/db_ping")
async def db_ping() -> dict:
    start = time.perf_counter()
    with get_conn() as conn:
        fetch_one(conn, "select 1 as ok", query_name="ops.db_ping")
    elapsed_ms = (time.perf_counter() - start) * 1000
    return {"ok": True, "ms": round(elapsed_ms, 2)}


def _error_response(code: str, message: str, path: str | None = None, detail: dict | None = None, status: int = 400) -> JSONResponse:
    body = {
        "ok": False,
        "errors": [{"code": code, "message": message, "path": path, "detail": detail}],
        "warnings": [],
    }
    return JSONResponse(jsonable_encoder(body), status_code=status)


def _ok_response(payload: dict, warnings: list | None = None, status: int = 200) -> JSONResponse:
    body = {"ok": True, **payload, "errors": [], "warnings": warnings or []}
    return JSONResponse(jsonable_encoder(body), status_code=status)


def _issue(code: str, message: str, path: str | None = None) -> dict:
    return {"code": code, "message": message, "path": path}


def _actor_event_meta(actor: dict | None) -> dict | None:
    if not isinstance(actor, dict):
        return None
    actor_id = actor.get("user_id") or actor.get("id")
    if not actor_id:
        return None
    role = actor.get("role")
    roles = [role] if isinstance(role, str) else []
    return {"id": actor_id, "roles": roles}


def _matching_triggers(manifest: dict, event: str, entity_id: str | None, action_id: str | None, status_field: str | None) -> list[dict]:
    triggers = manifest.get("triggers") if isinstance(manifest, dict) else None
    if not isinstance(triggers, list):
        return []
    matched = []
    for trig in triggers:
        if not isinstance(trig, dict):
            continue
        if trig.get("event") != event:
            continue
        if event in {"record.created", "record.updated", "workflow.status_changed"}:
            if entity_id and trig.get("entity_id") != entity_id:
                continue
            if trig.get("status_field") and status_field and trig.get("status_field") != status_field:
                continue
        if event == "action.clicked":
            if action_id and trig.get("action_id") != action_id:
                continue
        matched.append(trig)
    return matched


def _emit_triggers(
    request: Request,
    module_id: str,
    manifest: dict,
    event: str,
    payload: dict,
    *,
    entity_id: str | None = None,
    action_id: str | None = None,
    status_field: str | None = None,
) -> None:
    if not isinstance(manifest, dict):
        return
    triggers = _matching_triggers(manifest, event, entity_id, action_id, status_field)
    if not triggers:
        return
    module = _get_module(request, module_id)
    manifest_hash = module.get("current_hash") if isinstance(module, dict) else None
    if not isinstance(manifest_hash, str):
        return
    module_slug = (manifest.get("module") or {}).get("id")
    if not isinstance(module_slug, str) or not module_slug:
        module_slug = module_id
    actor = getattr(request.state, "actor", None)
    meta = {
        "module_id": module_id,
        "manifest_hash": manifest_hash,
        "actor": _actor_event_meta(actor),
        "org_id": actor.get("workspace_id") if isinstance(actor, dict) else None,
        "trace_id": request.headers.get("x-request-id") if hasattr(request, "headers") else None,
    }

    def _derive_namespaced_event() -> str:
        if event == "action.clicked" and action_id:
            return f"{module_slug}.action.{action_id}.clicked"
        if event == "workflow.status_changed":
            return f"{module_slug}.workflow.status_changed"
        if event in {"record.created", "record.updated"}:
            return f"{module_slug}.{event}"
        return f"{module_slug}.{event}"

    for trig in triggers:
        name = trig.get("id") or event
        event_payload = {
            **payload,
            "event": event,
            "trigger_id": trig.get("id"),
        }
        try:
            emitted = make_event(name, event_payload, meta)
            event_bus.publish(emitted)
            _handle_automation_event(emitted)
            trigger_id = trig.get("id")
            if isinstance(trigger_id, str) and trigger_id and trigger_id != event:
                namespaced_payload = dict(event_payload)
                namespaced_payload["event"] = trigger_id
                emitted_ns = make_event(trigger_id, namespaced_payload, meta)
                event_bus.publish(emitted_ns)
                _handle_automation_event(emitted_ns)
            elif not trigger_id:
                namespaced_event = _derive_namespaced_event()
                if namespaced_event and namespaced_event != event:
                    namespaced_payload = dict(event_payload)
                    namespaced_payload["event"] = namespaced_event
                    emitted_ns = make_event(namespaced_event, namespaced_payload, meta)
                    event_bus.publish(emitted_ns)
                    _handle_automation_event(emitted_ns)
        except Exception as exc:
            logger.warning("trigger_emit_failed module_id=%s event=%s error=%s", module_id, event, exc)


def _handle_automation_event(event: dict) -> None:
    try:
        handle_automation_event(automation_store, job_store, event)
    except Exception as exc:
        logger.warning("automation_event_failed error=%s", exc)


def _resolve_actor(request: Request) -> dict | JSONResponse:
    user = getattr(request.state, "user", None)
    if os.getenv("OCTO_DISABLE_AUTH", "").strip().lower() in ("1", "true", "yes"):
        if not user or not user.get("id"):
            return {
                "user_id": "test-user",
                "email": "test@example.com",
                "role": "owner",
                "workspace_id": "default",
                "claims": {},
            }
    if not user or not user.get("id"):
        return _error_response("AUTH_REQUIRED", "Authenticated user required", status=401)
    if not USE_DB:
        return {
            "user_id": user.get("id"),
            "email": user.get("email"),
            "role": "admin",
            "workspace_role": "admin",
            "platform_role": "superadmin",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "admin", "workspace_name": "Default"}],
            "claims": user.get("claims"),
        }
    user_id = user.get("id")
    platform_role = get_platform_role(user_id)
    memberships = list_memberships(user_id)
    user_workspaces = list_user_workspaces(user_id)
    workspace_header = request.headers.get("X-Workspace-Id")
    if not memberships:
        workspace_id = create_workspace_for_user(user)
        memberships = list_memberships(user_id)
        user_workspaces = list_user_workspaces(user_id)
        role = "admin"
        return {
            "user_id": user_id,
            "email": user.get("email"),
            "role": role,
            "workspace_role": role,
            "platform_role": platform_role,
            "workspace_id": workspace_id,
            "workspaces": user_workspaces,
            "claims": user.get("claims"),
        }
    if workspace_header:
        membership = get_membership(user_id, workspace_header)
        if not membership and platform_role != "superadmin":
            return _error_response("WORKSPACE_FORBIDDEN", "User is not a member of this workspace", "X-Workspace-Id", status=403)
        if membership:
            role = membership.get("role") or "member"
        elif workspace_exists(workspace_header):
            role = "admin"
        else:
            return _error_response("WORKSPACE_NOT_FOUND", "Workspace does not exist", "X-Workspace-Id", status=404)
        workspace_id = workspace_header
    elif len(memberships) == 1:
        workspace_id = memberships[0].get("workspace_id")
        role = memberships[0].get("role") or "member"
    elif platform_role == "superadmin":
        all_workspaces = list_all_workspaces()
        if not all_workspaces:
            return _error_response("WORKSPACE_NOT_FOUND", "No workspaces exist yet", status=404)
        workspace_id = all_workspaces[0].get("workspace_id")
        role = "admin"
    else:
        return _error_response("WORKSPACE_REQUIRED", "Multiple workspaces found; specify X-Workspace-Id", "X-Workspace-Id", status=400)
    return {
        "user_id": user_id,
        "email": user.get("email"),
        "role": role,
        "workspace_role": role,
        "platform_role": platform_role,
        "workspace_id": workspace_id,
        "workspaces": user_workspaces,
        "claims": user.get("claims"),
    }


_CAPABILITIES_BY_ROLE = {
    "admin": {
        "workspace.manage_members",
        "workspace.manage_settings",
        "modules.manage",
        "templates.manage",
        "automations.manage",
        "records.read",
        "records.write",
    },
    "member": {"records.read", "records.write"},
    "readonly": {"records.read"},
    "portal": {"records.read", "records.write"},
}


def _has_capability(actor: dict | None, capability: str) -> bool:
    if not isinstance(actor, dict):
        return False
    if actor.get("platform_role") == "superadmin":
        return True
    role = actor.get("workspace_role") or actor.get("role") or "member"
    return capability in _CAPABILITIES_BY_ROLE.get(role, set())


def _require_capability(actor: dict | None, capability: str, message: str = "Forbidden") -> JSONResponse | None:
    if not _has_capability(actor, capability):
        return _error_response("FORBIDDEN", message, status=403)
    return None


def _require_admin(actor: dict | None) -> JSONResponse | None:
    denied = _require_capability(actor, "workspace.manage_settings", "Admin role required")
    if denied:
        return denied
    return None


_WORKSPACE_ROLES = {"admin", "member", "readonly", "portal"}
_PLATFORM_ROLES = {"standard", "superadmin"}


def _normalize_workspace_role(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    role = value.strip().lower()
    if role == "owner":
        role = "admin"
    if role in _WORKSPACE_ROLES:
        return role
    return None


def _supabase_admin_headers() -> dict:
    key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    return {"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": "application/json"}


def _supabase_admin_enabled() -> bool:
    return bool((os.getenv("SUPABASE_URL") or "").strip() and (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip())


def _supabase_invite_user(email: str, redirect_to: str | None = None) -> dict:
    if not _supabase_admin_enabled():
        raise RuntimeError("Supabase service role not configured")
    base = (os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    payload: dict[str, Any] = {"email": email}
    if isinstance(redirect_to, str) and redirect_to.strip():
        payload["redirect_to"] = redirect_to.strip()
    req = urllib.request.Request(
        f"{base}/auth/v1/invite",
        data=json.dumps(payload).encode("utf-8"),
        headers=_supabase_admin_headers(),
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"invite_failed:{exc.code}:{body}") from exc


class ActorContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS" or request.url.path in {"/health"}:
            return await call_next(request)
        actor = _resolve_actor(request)
        if isinstance(actor, JSONResponse):
            return actor
        request.state.actor = actor
        token = set_org_id(actor.get("workspace_id") or "default")
        try:
            return await call_next(request)
        finally:
            reset_org_id(token)


app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(_CORS_ORIGINS),
    allow_origin_regex=r"http://localhost:\d+|http://127\.0\.0\.1:\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(ActorContextMiddleware)
if not DISABLE_AUTH:
    if not SUPABASE_URL:
        raise RuntimeError("SUPABASE_URL is required for auth")
    app.add_middleware(SupabaseAuthMiddleware, supabase_url=SUPABASE_URL, audience=SUPABASE_AUD)


def _json_pointer_escape(token: str) -> str:
    return token.replace("~", "~0").replace("/", "~1")


def _path_to_json_pointer(path: str | None) -> str | None:
    if not path or not isinstance(path, str):
        return None
    if path.startswith("$."):
        path = path[2:]
    elif path.startswith("$"):
        path = path[1:]
    if path.startswith("/"):
        return path
    tokens: list[str] = []
    buf = ""
    i = 0
    while i < len(path):
        ch = path[i]
        if ch == ".":
            if buf:
                tokens.append(buf)
                buf = ""
            i += 1
            continue
        if ch == "[":
            if buf:
                tokens.append(buf)
                buf = ""
            j = path.find("]", i)
            if j == -1:
                break
            tokens.append(path[i + 1 : j])
            i = j + 1
            continue
        buf += ch
        i += 1
    if buf:
        tokens.append(buf)
    if not tokens:
        return None
    return "/" + "/".join(_json_pointer_escape(tok) for tok in tokens if tok != "")


def _normalize_validation_entry(entry) -> dict:
    if isinstance(entry, str):
        return {"code": "ERR", "message": entry, "path": None, "json_pointer": None, "detail": None}
    if not isinstance(entry, dict):
        return {"code": "ERR", "message": str(entry), "path": None, "json_pointer": None, "detail": None}
    path = entry.get("json_pointer") or entry.get("path")
    json_pointer = _path_to_json_pointer(path) if path else None
    payload = dict(entry)
    payload["json_pointer"] = json_pointer
    return payload


def _normalize_validation_list(items: list | None) -> list:
    if not items:
        return []
    return [_normalize_validation_entry(item) for item in items]


def _changed_fields(before: dict, after: dict) -> list[str]:
    if not isinstance(before, dict) or not isinstance(after, dict):
        return []
    keys = set(before.keys()) | set(after.keys())
    changed = []
    for key in sorted(keys):
        if before.get(key) != after.get(key):
            changed.append(key)
    return changed


def _validation_response(errors: list, warnings: list, status: int = 400) -> JSONResponse:
    body = {
        "ok": False,
        "errors": _normalize_validation_list(errors),
        "warnings": _normalize_validation_list(warnings),
        "data": None,
    }
    return JSONResponse(jsonable_encoder(body), status_code=status)


def _require_module_enabled(request: Request, module_id: str, label: str) -> tuple[bool, JSONResponse | None]:
    module = _get_module(request, module_id)
    if module is None:
        return False, _error_response("MODULE_NOT_INSTALLED", f"{label} module not installed", "module_id")
    if not module.get("enabled"):
        return False, _error_response("MODULE_DISABLED", f"{label} module is disabled", "module_id")
    return True, None


def _workflow_required_fields(workflow: dict | None, status_value: str | None) -> list[str]:
    if not workflow or not status_value:
        return []
    required: list[str] = []
    for state in workflow.get("states") or []:
        if not isinstance(state, dict):
            continue
        if state.get("id") == status_value:
            fields = state.get("required_fields")
            if isinstance(fields, list):
                required.extend([f for f in fields if isinstance(f, str)])
    required_map = workflow.get("required_fields_by_state")
    if isinstance(required_map, dict):
        fields = required_map.get(status_value)
        if isinstance(fields, list):
            required.extend([f for f in fields if isinstance(f, str)])
    # de-dupe
    return list(dict.fromkeys(required))


def _log_record_validation_errors(
    entity_id: str,
    payload: dict | None,
    errors: list[dict],
    workflow: dict | None = None,
) -> None:
    payload = payload if isinstance(payload, dict) else {}
    missing_required = [err.get("path") for err in errors if err.get("code") == "REQUIRED_FIELD" and err.get("path")]
    status_value = None
    status_field = workflow.get("status_field") if isinstance(workflow, dict) else None
    if isinstance(status_field, str):
        status_value = payload.get(status_field)
    workflow_required = _workflow_required_fields(workflow, status_value) if workflow else []
    logger.warning(
        "record_validation_failed entity_id=%s missing_required=%s workflow_required=%s payload_keys=%s",
        entity_id,
        sorted(set(missing_required)),
        workflow_required,
        sorted(payload.keys()),
    )


def _wrap_db_constraint_error(exc: Exception) -> dict | None:
    diag = getattr(exc, "diag", None)
    constraint = getattr(diag, "constraint_name", None) if diag else None
    table = getattr(diag, "table_name", None) if diag else None
    column = getattr(diag, "column_name", None) if diag else None
    if constraint or table or column:
        return {
            "code": "DB_CONSTRAINT",
            "message": "Database constraint violation",
            "path": None,
            "detail": {"constraint": constraint, "table": table, "column": column},
        }
    return None



def _with_tx(tx_mgr, fn):
    tx = tx_mgr.begin()
    try:
        result = fn(tx)
        tx.commit()
        return result
    except Exception:
        tx.rollback()
        raise


def _req_cache_get(request: Request, key: str):
    cache = getattr(request.state, "cache", None)
    if not isinstance(cache, dict):
        return None
    return cache.get(key)


def _req_cache_set(request: Request, key: str, value) -> None:
    cache = getattr(request.state, "cache", None)
    if isinstance(cache, dict):
        cache[key] = value


def _get_module(request: Request, module_id: str):
    cache_key = f"module:{module_id}"
    cached = _req_cache_get(request, cache_key)
    if cached is not None:
        return cached
    registry_cached = _cache_get("registry_list")
    if isinstance(registry_cached, list):
        for item in registry_cached:
            if item.get("module_id") == module_id:
                _req_cache_set(request, cache_key, item)
                return item
    module = registry.get(module_id)
    _req_cache_set(request, cache_key, module)
    return module


def _get_registry_list(request: Request) -> list[dict]:
    cache_key = "registry:list"
    cached = _req_cache_get(request, cache_key)
    if cached is not None:
        return cached
    global_cached = _cache_get("registry_list")
    if global_cached is not None:
        _req_cache_set(request, cache_key, global_cached)
        return global_cached
    modules = registry.list()
    _req_cache_set(request, cache_key, modules)
    _cache_set("registry_list", modules)
    return modules


class _CachedRegistry:
    def __init__(self, request: Request):
        self._request = request

    def list(self):
        return _get_registry_list(self._request)


def _registry_for_request(request: Request):
    return _CachedRegistry(request)


def _get_head(request: Request, module_id: str) -> str | None:
    cache_key = f"head:{module_id}"
    cached = _req_cache_get(request, cache_key)
    if cached is not None:
        return cached
    record = _get_module(request, module_id)
    head = record.get("current_hash") if record else None
    if head is None:
        head = store.get_head(module_id)
    _req_cache_set(request, cache_key, head)
    return head


def _get_snapshot(request: Request, module_id: str, manifest_hash: str):
    cache_key = f"snapshot:{module_id}:{manifest_hash}"
    cached = _req_cache_get(request, cache_key)
    if cached is not None:
        return cached
    global_cached = _cache_get("manifest", f"{module_id}:{manifest_hash}")
    if global_cached is not None:
        _req_cache_set(request, cache_key, global_cached)
        return global_cached
    manifest = store.get_snapshot(module_id, manifest_hash)
    _req_cache_set(request, cache_key, manifest)
    _cache_set("manifest", manifest, f"{module_id}:{manifest_hash}")
    return manifest


def _filter_records_by_domain(items: list[dict], domain: dict | None, record_context: dict) -> list[dict]:
    if not domain:
        return items
    filtered = []
    for item in items:
        record = item.get("record") or {}
        try:
            if eval_condition(domain, {"record": record_context or {}, "candidate": record}):
                filtered.append(item)
        except Exception:
            continue
    return filtered


def _enforce_lookup_domains(entity: dict, data: dict) -> list[dict]:
    errors: list[dict] = []
    fields = entity.get("fields") or []
    if not isinstance(fields, list):
        return errors
    for field in fields:
        if not isinstance(field, dict):
            continue
        if field.get("type") != "lookup":
            continue
        domain = field.get("domain")
        if not domain:
            continue
        field_id = field.get("id")
        if not isinstance(field_id, str):
            continue
        value = data.get(field_id)
        if not value:
            continue
        target = field.get("entity")
        if not isinstance(target, str) or not target:
            continue
        target_entity = target[7:] if target.startswith("entity.") else target
        candidate = generic_records.get(target_entity, value)
        if not candidate:
            errors.append(
                {
                    "code": "LOOKUP_TARGET_NOT_FOUND",
                    "message": "Lookup target not found",
                    "path": field_id,
                    "detail": None,
                }
            )
            continue
        try:
            if not eval_condition(domain, {"record": data, "candidate": candidate.get("record") or {}}):
                errors.append(
                    {
                        "code": "LOOKUP_DOMAIN_VIOLATION",
                        "message": "Lookup selection does not match domain",
                        "path": field_id,
                        "detail": None,
                    }
                )
        except Exception:
            errors.append(
                {
                    "code": "LOOKUP_DOMAIN_VIOLATION",
                    "message": "Lookup selection does not match domain",
                    "path": field_id,
                    "detail": None,
                }
            )
    return errors


def _add_chatter_entry(entity_id: str, record_id: str, entry_type: str, body: str, actor: dict | None) -> None:
    try:
        chatter_store.add(entity_id, record_id, entry_type, body, actor)
    except Exception:
        return


def _activity_view_config(manifest: dict, entity_id: str) -> dict | None:
    views = manifest.get("views") if isinstance(manifest, dict) else None
    if not isinstance(views, list):
        return None
    normalized_entity = _normalize_entity_id(entity_id)
    for view in views:
        if not isinstance(view, dict):
            continue
        vtype = view.get("kind") or view.get("type")
        if vtype != "form":
            continue
        view_entity = _normalize_entity_id(view.get("entity") or view.get("entity_id") or view.get("entityId"))
        if view_entity != normalized_entity:
            continue
        activity = view.get("activity")
        if isinstance(activity, dict) and activity.get("enabled") is True:
            return activity
    return None


def _format_activity_value(value):
    if value is None:
        return "empty"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, list):
        if not value:
            return "empty"
        return ", ".join([str(v) for v in value])
    if isinstance(value, dict):
        if "label" in value and value.get("label"):
            return str(value.get("label"))
        if "id" in value and value.get("id"):
            return str(value.get("id"))
        return json.dumps(value, default=str)
    text = str(value)
    return text if text != "" else "empty"


def _collect_activity_changes(
    entity_def: dict,
    before_record: dict,
    after_record: dict,
    tracked_fields: list[str] | None = None,
) -> list[dict]:
    fields = entity_def.get("fields") if isinstance(entity_def, dict) else None
    field_by_id = {}
    if isinstance(fields, list):
        for field in fields:
            if isinstance(field, dict) and isinstance(field.get("id"), str):
                field_by_id[field["id"]] = field
    candidates = tracked_fields or sorted(field_by_id.keys())
    changes: list[dict] = []
    for field_id in candidates:
        if not isinstance(field_id, str):
            continue
        before_val = before_record.get(field_id)
        after_val = after_record.get(field_id)
        if before_val == after_val:
            continue
        label = (field_by_id.get(field_id) or {}).get("label") or field_id
        changes.append(
            {
                "field": field_id,
                "label": label,
                "from": _format_activity_value(before_val),
                "to": _format_activity_value(after_val),
            }
        )
    return changes


def _compile_manifest(manifest: dict) -> dict:
    entities = manifest.get("entities") if isinstance(manifest, dict) else None
    views = manifest.get("views") if isinstance(manifest, dict) else None
    actions = manifest.get("actions") if isinstance(manifest, dict) else None
    entity_by_id: dict = {}
    view_by_id: dict = {}
    field_by_entity: dict = {}
    action_by_id: dict = {}
    if isinstance(entities, list):
        for entity in entities:
            if not isinstance(entity, dict):
                continue
            entity_id = entity.get("id")
            if not isinstance(entity_id, str):
                continue
            entity_by_id[entity_id] = entity
            fields = entity.get("fields")
            if isinstance(fields, list):
                field_map = {}
                for field in fields:
                    if isinstance(field, dict) and isinstance(field.get("id"), str):
                        field_map[field["id"]] = field
                field_by_entity[entity_id] = field_map
    if isinstance(views, list):
        for view in views:
            if isinstance(view, dict) and isinstance(view.get("id"), str):
                view_by_id[view["id"]] = view
    if isinstance(actions, list):
        for action in actions:
            if isinstance(action, dict) and isinstance(action.get("id"), str):
                action_by_id[action["id"]] = action
    return {
        "entity_by_id": entity_by_id,
        "field_by_entity": field_by_entity,
        "view_by_id": view_by_id,
        "action_by_id": action_by_id,
    }


def _validate_patch_payload(entity: dict, patch: dict, existing: dict, workflow: dict | None = None) -> tuple[list[dict], dict]:
    errors: list[dict] = []
    if not isinstance(patch, dict):
        return [
            {
                "code": "INVALID_PAYLOAD",
                "message": "Patch must be an object",
                "path": None,
                "detail": None,
            }
        ], {}
    fields = entity.get("fields") or []
    if isinstance(fields, dict):
        field_list = []
        for field_id, field_def in fields.items():
            if isinstance(field_def, dict):
                field_list.append({"id": field_id, **field_def})
            else:
                field_list.append({"id": field_id})
        fields = field_list
    field_by_id = {f.get("id"): f for f in fields if f.get("id")}

    def _add_error(code: str, message: str, path: str | None = None, detail: dict | None = None):
        errors.append({"code": code, "message": message, "path": path, "detail": detail})

    for key in patch.keys():
        if key == "id":
            continue
        if key not in field_by_id:
            _add_error("UNKNOWN_FIELD", f"Unknown field: {key}", path=key)

    for field_id, val in patch.items():
        if field_id == "id":
            continue
        field = field_by_id.get(field_id)
        if not field:
            continue
        ftype = field.get("type")
        if val is None:
            continue
        if ftype in ("string", "text"):
            if not isinstance(val, str):
                _add_error("TYPE_MISMATCH", f"{field_id} must be a string", path=field_id)
        elif ftype == "number":
            if not isinstance(val, (int, float)) or isinstance(val, bool):
                _add_error("TYPE_MISMATCH", f"{field_id} must be a number", path=field_id)
        elif ftype == "boolean" or ftype == "bool":
            if not isinstance(val, bool):
                _add_error("TYPE_MISMATCH", f"{field_id} must be a boolean", path=field_id)
        elif ftype == "enum":
            allowed = _enum_values(field)
            if val not in allowed:
                _add_error("INVALID_ENUM", f"{field_id} must be one of {allowed}", path=field_id)
        elif ftype == "date":
            if not isinstance(val, str):
                _add_error("TYPE_MISMATCH", f"{field_id} must be a date string", path=field_id)
            else:
                try:
                    date.fromisoformat(val)
                except Exception:
                    _add_error("INVALID_DATE", f"{field_id} must be YYYY-MM-DD", path=field_id)
        elif ftype == "datetime":
            if not isinstance(val, str):
                _add_error("TYPE_MISMATCH", f"{field_id} must be a datetime string", path=field_id)
            else:
                try:
                    datetime.fromisoformat(val.replace("Z", "+00:00"))
                except Exception:
                    _add_error("INVALID_DATETIME", f"{field_id} must be ISO8601", path=field_id)
        elif ftype == "uuid":
            if not isinstance(val, str) or not _is_uuid(val):
                _add_error("TYPE_MISMATCH", f"{field_id} must be a UUID", path=field_id)
        elif ftype == "lookup":
            if not isinstance(val, str):
                _add_error("TYPE_MISMATCH", f"{field_id} must be a string", path=field_id)
        elif ftype == "tags":
            if not isinstance(val, list):
                _add_error("TYPE_MISMATCH", f"{field_id} must be a list", path=field_id)

    if workflow:
        status_field = workflow.get("status_field")
        status_value = None
        if isinstance(status_field, str) and status_field in patch:
            status_value = patch.get(status_field)
        elif isinstance(status_field, str):
            status_value = existing.get(status_field)
        if status_field and status_value is not None:
            states = [s.get("id") for s in workflow.get("states") or [] if isinstance(s, dict)]
            if status_value not in states:
                _add_error("INVALID_STATUS", f"{status_field} must be one of {states}", path=status_field)

    if errors:
        return errors, {}
    updated = dict(existing)
    updated.update(patch)
    return [], updated


def _get_installed_manifest(request: Request, module_id: str) -> tuple[dict | None, dict | None]:
    module = _get_module(request, module_id)
    if not module:
        return None, None
    if not module.get("enabled"):
        return module, None
    manifest_hash = module.get("current_hash")
    if not manifest_hash:
        return module, None
    cache_key = f"{module_id}:{manifest_hash}"
    cached = _cache_get("manifest", cache_key)
    if cached is not None:
        return module, cached
    try:
        manifest = _get_snapshot(request, module_id, manifest_hash)
    except Exception:
        return module, None
    _cache_set("manifest", manifest, cache_key)
    return module, manifest


def _resolve_action(manifest: dict, action_id: str) -> dict | None:
    actions = manifest.get("actions") if isinstance(manifest, dict) else None
    if not isinstance(actions, list):
        return None
    for action in actions:
        if isinstance(action, dict) and action.get("id") == action_id:
            return action
    return None


def _find_entity_def(request: Request, entity_id: str) -> tuple[str, dict, dict] | None:
    entity_id = _normalize_entity_id(entity_id)
    entry = _entity_def_cache.get(entity_id)
    now = time.time()
    if entry and now - entry["ts"] < _CACHE_TTL_S:
        return entry["value"]
    modules = _get_registry_list(request)
    result = None
    for module in modules:
        if not module.get("enabled"):
            continue
        module_id = module.get("module_id")
        manifest_hash = module.get("current_hash")
        if not module_id or not manifest_hash:
            continue
        try:
            manifest = _get_snapshot(request, module_id, manifest_hash)
        except Exception:
            continue
        for ent in _entities_from_manifest(manifest):
            ent_id = ent.get("id")
            if ent_id and _match_entity_id(entity_id, ent_id):
                result = (module_id, ent, manifest)
                break
        if result:
            break
    _entity_def_cache[entity_id] = {"value": result, "ts": now}
    return result


def _get_compiled_manifest(module_id: str, manifest_hash: str, manifest: dict) -> dict:
    cache_key = f"{module_id}:{manifest_hash}"
    entry = _compiled_cache.get(cache_key)
    now = time.time()
    if entry and now - entry["ts"] < _CACHE_TTL_S:
        return entry["value"]
    compiled = _compile_manifest(manifest)
    _compiled_cache[cache_key] = {"value": compiled, "ts": now}
    return compiled


def _cache_get(bucket: str, key: str | None = None):
    now = time.time()
    if key is None:
        entry = _cache[bucket]
        if entry["value"] is not None and now - entry["ts"] < _CACHE_TTL_S:
            return entry["value"]
        return None
    entry = _cache[bucket].get(key)
    if entry and now - entry["ts"] < _CACHE_TTL_S:
        return entry["value"]
    return None


def _cache_set(bucket: str, value, key: str | None = None):
    if key is None:
        _cache[bucket]["value"] = value
        _cache[bucket]["ts"] = time.time()
    else:
        _cache[bucket][key] = {"value": value, "ts": time.time()}


def _cache_invalidate(bucket: str, key: str | None = None):
    if key is None:
        if "value" in _cache[bucket]:
            _cache[bucket]["value"] = None
            _cache[bucket]["ts"] = 0.0
        else:
            _cache[bucket].clear()
    else:
        _cache[bucket].pop(key, None)
    if bucket in {"manifest", "modules", "registry_list"}:
        _entity_def_cache.clear()
        _cache["studio2_registry"].clear()
        _cache["studio2_registry_summary"].clear()


def _resp_cache_get(key: str):
    entry = _response_cache.get(key)
    now = time.time()
    if entry and now - entry["ts"] < _RESPONSE_TTL_S:
        return entry["value"]
    return None


def _resp_cache_set(key: str, value):
    _response_cache[key] = {"value": value, "ts": time.time()}


def _resp_cache_invalidate_prefix(prefix: str) -> None:
    for key in list(_response_cache.keys()):
        if key.startswith(prefix):
            _response_cache.pop(key, None)


def _resp_cache_invalidate_entity(entity_id: str) -> None:
    prefix = f"records:list:{get_org_id()}:{entity_id}:"
    _resp_cache_invalidate_prefix(prefix)
    prefix = f"lookup:{get_org_id()}:{entity_id}:"
    _resp_cache_invalidate_prefix(prefix)


def _resp_cache_invalidate_record(entity_id: str, record_id: str) -> None:
    _resp_cache_invalidate_prefix(f"records:get:{get_org_id()}:{entity_id}:{record_id}:")
    _resp_cache_invalidate_prefix(f"chatter:{get_org_id()}:{entity_id}:{record_id}:")


def _domain_hash(domain: dict | None) -> str:
    if not domain:
        return ""
    try:
        payload = json.dumps(domain, sort_keys=True)
    except Exception:
        payload = str(domain)
    return str(abs(hash(payload)))


def _context_hash(ctx: dict | None) -> str:
    if not ctx:
        return ""
    try:
        payload = json.dumps(ctx, sort_keys=True)
    except Exception:
        payload = str(ctx)
    return str(abs(hash(payload)))


def _compiled_cache_invalidate(module_id: str | None = None):
    if module_id is None:
        _compiled_cache.clear()
        return
    prefix = f"{module_id}:"
    for key in list(_compiled_cache.keys()):
        if key.startswith(prefix):
            _compiled_cache.pop(key, None)


def _module_name_from_manifest(manifest: dict | None) -> str | None:
    if not isinstance(manifest, dict):
        return None
    module_def = manifest.get("module")
    if not isinstance(module_def, dict):
        return None
    name = module_def.get("name")
    if isinstance(name, str) and name.strip():
        return name
    return None


def _begin_module_mutation(module_id: str) -> bool:
    if module_id in _MODULE_MUTATIONS:
        return False
    _MODULE_MUTATIONS.add(module_id)
    return True


def _end_module_mutation(module_id: str) -> None:
    _MODULE_MUTATIONS.discard(module_id)


def _preview_payload(module_id: str, current_hash: str | None, manifest: dict, reason: str, patch_id: str, actor_id: str) -> dict:
    proposed_hash = manifest_hash(manifest)
    warnings = []
    if current_hash == proposed_hash:
        warnings.append({"code": "MODULE_ALREADY_UP_TO_DATE", "message": "Module already up to date", "path": "module_id", "detail": None})
    patch = {
        "patch_id": patch_id,
        "target_module_id": module_id,
        "target_manifest_hash": current_hash,
        "mode": "preview",
        "reason": reason,
        "operations": [],
        "metadata": {"generated_by": {"type": "user", "id": actor_id, "name": ""}},
    }
    preview = {
        "ok": True,
        "errors": [],
        "warnings": warnings,
        "impact": None,
        "resolved_ops": [],
        "diff_summary": {"touched": [], "counts": {"add": 0, "remove": 0, "replace": 0, "move": 0, "copy": 0, "test": 0}},
    }
    return {
        "module_id": module_id,
        "current_hash": current_hash,
        "proposed_hash": proposed_hash,
        "patch": patch,
        "preview": preview,
    }


def _is_valid_module_id(module_id: str) -> bool:
    return bool(re.match(r"^[a-z][a-z0-9_]{2,32}$", module_id))


def _generate_module_id() -> str:
    for _ in range(25):
        candidate = f"module_{uuid.uuid4().hex[:6]}"
        if _is_valid_module_id(candidate) and registry.get(candidate) is None and drafts.get_draft(candidate) is None:
            return candidate
    return f"module_{uuid.uuid4().hex[:6]}"


def _draft_hash(manifest: dict) -> str:
    normalized, _, _ = validate_manifest_raw(manifest)
    return manifest_hash(normalized)


def _build_v1_template(module_id: str) -> dict:
    entity_name = f"{module_id}_item"
    contact_name = f"{module_id}_contact"
    title_name = module_id.replace("_", " ").replace("-", " ").title()
    return {
        "manifest_version": "1.3",
        "module": {"id": module_id, "name": title_name or "New Module", "version": "1.0.0", "description": ""},
        "app": {
            "home": f"page:{entity_name}.list_page",
            "defaults": {
                "entity_home_page": f"page:{entity_name}.list_page",
                "entity_form_page": f"page:{entity_name}.form_page",
            },
            "nav": [
                {
                    "group": "Main",
                    "items": [
                        {"label": "All Items", "to": f"page:{entity_name}.list_page"},
                        {"label": "Contacts", "to": f"page:{contact_name}.list_page"},
                    ],
                }
            ],
        },
        "actions": [
            {"id": "action.refresh", "kind": "refresh", "label": "Refresh"},
        ],
        "pages": [
            {
                "id": f"{entity_name}.list_page",
                "title": "All Items",
                "layout": "single",
                "content": [
                    {"kind": "view", "target": f"{entity_name}.list"},
                ],
            },
            {
                "id": f"{entity_name}.form_page",
                "title": "Item",
                "layout": "single",
                "content": [
                    {
                        "kind": "record",
                        "entity_id": f"entity.{entity_name}",
                        "record_id_query": "record",
                        "content": [
                            {
                                "kind": "container",
                                "variant": "flat",
                                "content": [
                                    {
                                        "kind": "toolbar",
                                        "align": "between",
                                        "actions": [
                                            {"action_id": "action.refresh"},
                                        ],
                                    },
                                    {
                                        "kind": "grid",
                                        "columns": 12,
                                        "gap": "md",
                                        "items": [
                                            {
                                                "span": 8,
                                                "content": [
                                                    {"kind": "view", "target": f"{entity_name}.form"},
                                                ],
                                            },
                                            {
                                                "span": 4,
                                                "content": [
                                                    {
                                                        "kind": "chatter",
                                                        "entity_id": f"entity.{entity_name}",
                                                        "record_ref": "$record.id",
                                                    }
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            }
                        ],
                    }
                ],
            },
            {
                "id": f"{contact_name}.list_page",
                "title": "Contacts",
                "layout": "single",
                "content": [
                    {"kind": "view", "target": f"{contact_name}.list"},
                ],
            },
            {
                "id": f"{contact_name}.form_page",
                "title": "Contact",
                "layout": "single",
                "content": [
                    {
                        "kind": "record",
                        "entity_id": f"entity.{contact_name}",
                        "record_id_query": "record",
                        "content": [
                            {"kind": "view", "target": f"{contact_name}.form"},
                        ],
                    }
                ],
            },
        ],
        "entities": [
            {
                "id": f"entity.{contact_name}",
                "label": "Contact",
                "display_field": f"{contact_name}.full_name",
                "fields": [
                    {"id": f"{contact_name}.id", "type": "uuid", "label": "ID", "readonly": True},
                    {"id": f"{contact_name}.full_name", "type": "string", "label": "Full name", "required": True},
                    {"id": f"{contact_name}.email", "type": "string", "label": "Email"},
                    {
                        "id": f"{contact_name}.region",
                        "type": "enum",
                        "label": "Region",
                        "options": [{"label": "North", "value": "north"}, {"label": "South", "value": "south"}],
                    },
                ],
            },
            {
                "id": f"entity.{entity_name}",
                "label": "Item",
                "display_field": f"{entity_name}.title",
                "fields": [
                    {"id": f"{entity_name}.id", "type": "uuid", "label": "ID", "readonly": True},
                    {"id": f"{entity_name}.title", "type": "string", "label": "Title", "required": True},
                    {
                        "id": f"{entity_name}.status",
                        "type": "enum",
                        "label": "Status",
                        "default": "new",
                        "ui": {"widget": "steps"},
                        "options": [
                            {"label": "New", "value": "new"},
                            {"label": "In Progress", "value": "in_progress"},
                            {"label": "Done", "value": "done"},
                        ],
                    },
                    {
                        "id": f"{entity_name}.region",
                        "type": "enum",
                        "label": "Region",
                        "options": [{"label": "North", "value": "north"}, {"label": "South", "value": "south"}],
                    },
                    {
                        "id": f"{entity_name}.contact_id",
                        "type": "lookup",
                        "label": "Primary Contact",
                        "entity": f"entity.{contact_name}",
                        "display_field": f"{contact_name}.full_name",
                        "domain": {
                            "op": "eq",
                            "left": {"ref": f"$candidate.{contact_name}.region"},
                            "right": {"ref": f"$record.{entity_name}.region"},
                        },
                    },
                    {
                        "id": f"{entity_name}.completion_notes",
                        "type": "text",
                        "label": "Completion Notes",
                        "required_when": {"op": "eq", "field": f"{entity_name}.status", "value": "done"},
                    },
                ],
            },
        ],
        "views": [
            {
                "id": f"{contact_name}.list",
                "entity": contact_name,
                "kind": "list",
                "open_record": {"to": f"page:{contact_name}.form_page", "param": "record"},
                "header": {
                    "primary_actions": [{"kind": "open_form", "label": "New Contact", "target": f"{contact_name}.form"}],
                    "search": {"enabled": True, "placeholder": "Search contacts...", "fields": [f"{contact_name}.full_name", f"{contact_name}.email", f"{contact_name}.region"]},
                },
                "columns": [{"field_id": f"{contact_name}.full_name", "label": "Name"}],
            },
            {"id": f"{contact_name}.form", "entity": contact_name, "kind": "form", "sections": [{"id": "main", "title": "Contact", "fields": [f"{contact_name}.full_name", f"{contact_name}.email", f"{contact_name}.region"]}]},
            {
                "id": f"{entity_name}.list",
                "entity": entity_name,
                "kind": "list",
                "open_record": {"to": f"page:{entity_name}.form_page", "param": "record"},
                "header": {
                    "primary_actions": [{"kind": "open_form", "label": "New Item", "target": f"{entity_name}.form"}],
                    "search": {"enabled": True, "placeholder": "Search items...", "fields": [f"{entity_name}.title", f"{entity_name}.status", f"{entity_name}.region"]},
                    "filters": [
                        {"id": "new", "label": "New", "domain": {"op": "eq", "field": f"{entity_name}.status", "value": "new"}},
                        {"id": "in_progress", "label": "In Progress", "domain": {"op": "eq", "field": f"{entity_name}.status", "value": "in_progress"}},
                        {"id": "done", "label": "Done", "domain": {"op": "eq", "field": f"{entity_name}.status", "value": "done"}},
                    ],
                },
                "columns": [
                    {"field_id": f"{entity_name}.title", "label": "Title"},
                    {"field_id": f"{entity_name}.status", "label": "Status"},
                    {"field_id": f"{entity_name}.contact_id", "label": "Contact"},
                ],
            },
            {
                "id": f"{entity_name}.form",
                "entity": entity_name,
                "kind": "form",
                "header": {
                    "save_mode": "top",
                    "statusbar": {"field_id": f"{entity_name}.status"},
                },
                "sections": [
                    {"id": "main", "title": "Main", "fields": [f"{entity_name}.title", f"{entity_name}.status", f"{entity_name}.region", f"{entity_name}.contact_id"]},
                    {"id": "details", "title": "Details", "fields": [f"{entity_name}.completion_notes"]},
                ],
            },
        ],
        "relations": [],
        "workflows": [],
        "queries": {},
        "interfaces": {},
    }


def _build_v1_template_with_name(module_id: str, module_name: str | None) -> dict:
    manifest = _build_v1_template(module_id)
    if module_name:
        module_section = manifest.get("module") if isinstance(manifest.get("module"), dict) else None
        if isinstance(module_section, dict):
            module_section["name"] = module_name
    return manifest


def _build_v1_empty_template(module_id: str, module_name: str | None) -> dict:
    name = module_name or module_id.replace("_", " ").replace("-", " ").title() or "New Module"
    return {
        "manifest_version": "1.3",
        "module": {"id": module_id, "name": name, "version": "0.1.0", "description": ""},
        "app": {},
        "entities": [],
        "pages": [],
        "views": [],
        "actions": [],
        "relations": [],
    }


def _build_scaffold_single_entity(
    module_id: str,
    module_name: str | None,
    entity_slug: str,
    entity_label: str,
    fields: list[dict],
    nav_label: str | None = None,
) -> dict:
    name = module_name or module_id.replace("_", " ").replace("-", " ").title() or "New Module"
    entity_id = f"entity.{entity_slug}"
    list_page = f"{entity_slug}.list_page"
    form_page = f"{entity_slug}.form_page"
    list_view = f"{entity_slug}.list"
    form_view = f"{entity_slug}.form"
    action_id = f"action.{entity_slug}_new"
    nav_label = nav_label or entity_label

    base_fields = [
        {"id": f"{entity_slug}.id", "type": "uuid", "label": "ID", "readonly": True},
    ]
    entity_fields = base_fields + fields
    display_field = entity_fields[1]["id"] if len(entity_fields) > 1 else entity_fields[0]["id"]

    return {
        "manifest_version": "1.3",
        "module": {"id": module_id, "name": name, "version": "0.1.0", "description": ""},
        "app": {
            "home": f"page:{list_page}",
            "nav": [{"group": "Main", "items": [{"label": nav_label, "to": f"page:{list_page}"}]}],
            "defaults": {
                "entity_form_page": f"page:{form_page}",
                "entity_home_page": f"page:{list_page}",
                "entities": {
                    entity_id: {
                        "entity_form_page": f"page:{form_page}",
                        "entity_home_page": f"page:{list_page}",
                    }
                },
            },
        },
        "entities": [
            {
                "id": entity_id,
                "label": entity_label,
                "display_field": display_field,
                "fields": entity_fields,
            }
        ],
        "views": [
            {
                "id": list_view,
                "kind": "list",
                "entity": entity_id,
                "header": {
                    "search": {"fields": [display_field], "enabled": True, "placeholder": f"Search {nav_label.lower()}..."},
                    "primary_actions": [{"action_id": action_id}],
                },
                "columns": [{"label": entity_label, "field_id": display_field}],
                "open_record": {"to": f"page:{form_page}", "param": "record"},
            },
            {
                "id": form_view,
                "kind": "form",
                "entity": entity_id,
                "header": {
                    "auto_save": True,
                    "save_mode": "top",
                    "title_field": display_field,
                    "auto_save_debounce_ms": 750,
                },
                "sections": [
                    {
                        "id": "main",
                        "title": "Details",
                        "fields": [f.get("id") for f in entity_fields if f.get("id")],
                        "layout": "columns",
                        "columns": 2,
                    }
                ],
            },
        ],
        "pages": [
            {
                "id": list_page,
                "title": nav_label,
                "header": {"variant": "none"},
                "layout": "single",
                "content": [
                    {
                        "kind": "container",
                        "variant": "card",
                        "content": [{"kind": "view", "target": f"view:{list_view}"}],
                    }
                ],
            },
            {
                "id": form_page,
                "title": entity_label,
                "header": {"variant": "none"},
                "layout": "single",
                "content": [
                    {
                        "kind": "record",
                        "entity_id": entity_id,
                        "record_id_query": "record",
                        "content": [
                            {
                                "kind": "grid",
                                "columns": 12,
                                "gap": "md",
                                "items": [
                                    {
                                        "span": 8,
                                        "content": [
                                            {
                                                "kind": "container",
                                                "variant": "card",
                                                "content": [{"kind": "view", "target": f"view:{form_view}"}],
                                            }
                                        ],
                                    },
                                    {
                                        "span": 4,
                                        "content": [
                                            {
                                                "kind": "container",
                                                "title": "Chatter",
                                                "variant": "card",
                                                "content": [
                                                    {
                                                        "kind": "chatter",
                                                        "entity_id": entity_id,
                                                        "record_ref": "$record.id",
                                                    }
                                                ],
                                            }
                                        ],
                                    },
                                ],
                            }
                        ],
                    }
                ],
            },
        ],
        "actions": [{"id": action_id, "kind": "navigate", "label": f"New {entity_label}", "target": f"page:{form_page}"}],
        "relations": [],
    }


def _build_scaffold_template(module_id: str, module_name: str | None, pattern_key: str | None) -> dict:
    key = (pattern_key or "").lower() if pattern_key else ""
    if key == "contacts":
        fields = [
            {"id": "contact.name", "type": "string", "label": "Name", "required": True},
            {"id": "contact.email", "type": "string", "label": "Email"},
            {"id": "contact.phone", "type": "string", "label": "Phone"},
            {"id": "contact.company", "type": "string", "label": "Company"},
            {"id": "contact.tags", "type": "tags", "label": "Tags"},
            {
                "id": "contact.status",
                "type": "enum",
                "label": "Status",
                "default": "active",
                "options": [{"label": "Active", "value": "active"}, {"label": "Inactive", "value": "inactive"}],
            },
        ]
        return _build_scaffold_single_entity(module_id, module_name, "contact", "Contact", fields, nav_label="All Contacts")
    if key == "jobs":
        fields = [
            {"id": "job.title", "type": "string", "label": "Title", "required": True},
            {
                "id": "job.status",
                "type": "enum",
                "label": "Status",
                "default": "new",
                "options": [{"label": "New", "value": "new"}, {"label": "In Progress", "value": "in_progress"}, {"label": "Done", "value": "done"}],
            },
            {"id": "job.due_date", "type": "date", "label": "Due Date"},
            {"id": "job.price", "type": "number", "label": "Price"},
            {"id": "job.notes", "type": "text", "label": "Notes"},
        ]
        return _build_scaffold_single_entity(module_id, module_name, "job", "Job", fields, nav_label="Jobs")
    if key == "todo":
        fields = [
            {"id": "task.title", "type": "string", "label": "Title", "required": True},
            {
                "id": "task.status",
                "type": "enum",
                "label": "Status",
                "default": "todo",
                "options": [{"label": "To Do", "value": "todo"}, {"label": "In Progress", "value": "in_progress"}, {"label": "Done", "value": "done"}],
            },
            {"id": "task.due_date", "type": "date", "label": "Due Date"},
            {"id": "task.notes", "type": "text", "label": "Notes"},
        ]
        return _build_scaffold_single_entity(module_id, module_name, "task", "Task", fields, nav_label="Tasks")
    if key == "inventory":
        fields = [
            {"id": "item.name", "type": "string", "label": "Name", "required": True},
            {"id": "item.sku", "type": "string", "label": "SKU"},
            {"id": "item.qty", "type": "number", "label": "Quantity"},
            {
                "id": "item.status",
                "type": "enum",
                "label": "Status",
                "default": "active",
                "options": [{"label": "Active", "value": "active"}, {"label": "Inactive", "value": "inactive"}],
            },
            {"id": "item.notes", "type": "text", "label": "Notes"},
        ]
        return _build_scaffold_single_entity(module_id, module_name, "item", "Item", fields, nav_label="Items")
    if key == "crm":
        fields = [
            {"id": "lead.title", "type": "string", "label": "Title", "required": True},
            {
                "id": "lead.stage",
                "type": "enum",
                "label": "Stage",
                "default": "new",
                "options": [{"label": "New", "value": "new"}, {"label": "Qualified", "value": "qualified"}, {"label": "Won", "value": "won"}],
            },
            {"id": "lead.value", "type": "number", "label": "Value"},
            {"id": "lead.notes", "type": "text", "label": "Notes"},
        ]
        return _build_scaffold_single_entity(module_id, module_name, "lead", "Lead", fields, nav_label="Leads")
    return _build_v1_empty_template(module_id, module_name)


def _parse_manifest_body(body: dict) -> dict | None:
    if not isinstance(body, dict):
        return None
    if "manifest" in body and isinstance(body.get("manifest"), dict):
        return body.get("manifest")
    if "manifest_json" in body and isinstance(body.get("manifest_json"), dict):
        return body.get("manifest_json")
    if "text" in body:
        return None
    return body


def _parse_manifest_text(body: dict) -> dict | None:
    if not isinstance(body, dict):
        return None
    text = body.get("text")
    if not isinstance(text, str):
        return None
    try:
        value = json.loads(text)
    except Exception:
        return None
    return value if isinstance(value, dict) else None


async def _safe_json(request: Request) -> dict:
    try:
        return await request.json()
    except Exception:
        return {}


def _studio2_registry_fingerprint(installed: list[dict]) -> str:
    parts = []
    for mod in sorted(installed, key=lambda m: m.get("module_id") or ""):
        module_id = mod.get("module_id") or ""
        current_hash = mod.get("current_hash") or ""
        updated_at = mod.get("updated_at") or ""
        parts.append(f"{module_id}:{current_hash}:{updated_at}")
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _studio2_extract_view_ids_from_blocks(blocks: list) -> list[str]:
    view_ids: set[str] = set()

    def visit(block) -> None:
        if not isinstance(block, dict):
            return
        kind = block.get("kind")
        if kind == "view":
            target = block.get("target")
            if isinstance(target, str) and target:
                if target.startswith("view:"):
                    view_ids.add(target.split("view:", 1)[1])
                else:
                    view_ids.add(target)
        for key in ("content",):
            nested = block.get(key)
            if isinstance(nested, list):
                for item in nested:
                    visit(item)
        items = block.get("items")
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    content = item.get("content")
                    if isinstance(content, list):
                        for child in content:
                            visit(child)
        tabs = block.get("tabs")
        if isinstance(tabs, list):
            for tab in tabs:
                if isinstance(tab, dict):
                    content = tab.get("content")
                    if isinstance(content, list):
                        for child in content:
                            visit(child)

    for block in blocks or []:
        visit(block)
    return sorted(view_ids)


def _resolve_bootstrap_view(manifest: dict, page_id: str | None, view_id: str | None) -> tuple[dict | None, dict | None]:
    views = manifest.get("views") if isinstance(manifest, dict) else None
    pages = manifest.get("pages") if isinstance(manifest, dict) else None
    view_obj = None
    page_obj = None
    resolved_view_id = None
    if isinstance(view_id, str) and view_id:
        resolved_view_id = view_id.split("view:", 1)[1] if view_id.startswith("view:") else view_id
    if resolved_view_id and isinstance(views, list):
        view_obj = next((v for v in views if isinstance(v, dict) and v.get("id") == resolved_view_id), None)
    if isinstance(page_id, str) and page_id and isinstance(pages, list):
        page_obj = next((p for p in pages if isinstance(p, dict) and p.get("id") == page_id), None)
        if page_obj and not view_obj:
            content = page_obj.get("content")
            view_ids = _studio2_extract_view_ids_from_blocks(content if isinstance(content, list) else [])
            if view_ids and isinstance(views, list):
                view_obj = next((v for v in views if isinstance(v, dict) and v.get("id") == view_ids[0]), None)
    return view_obj, page_obj


def _fallback_view_id_from_page_id(manifest: dict, page_id: str | None) -> str | None:
    if not isinstance(page_id, str) or not page_id:
        return None
    views = manifest.get("views") if isinstance(manifest, dict) else None
    if not isinstance(views, list):
        return None
    suffix = None
    base = page_id
    if page_id.endswith(".list_page"):
        base = page_id.replace(".list_page", "")
        suffix = ".list"
    elif page_id.endswith(".form_page"):
        base = page_id.replace(".form_page", "")
        suffix = ".form"
    elif page_id.endswith("_list_page"):
        base = page_id.replace("_list_page", "")
        suffix = ".list"
    elif page_id.endswith("_form_page"):
        base = page_id.replace("_form_page", "")
        suffix = ".form"
    candidates = []
    if suffix:
        candidates.extend([f"{base}{suffix}", f"{base}s{suffix}", f"{base}es{suffix}"])
        candidates.extend([f"entity.{base}{suffix}", f"entity.{base}s{suffix}", f"entity.{base}es{suffix}"])
    for view in views:
        if not isinstance(view, dict):
            continue
        view_id = view.get("id")
        if not isinstance(view_id, str):
            continue
        if view_id in candidates:
            return view_id
    return None


def _studio2_compact_manifest(manifest: dict) -> dict:
    entities_payload = []
    for entity in manifest.get("entities", []) if isinstance(manifest.get("entities"), list) else []:
        if not isinstance(entity, dict):
            continue
        fields_payload = []
        for field in entity.get("fields", []) if isinstance(entity.get("fields"), list) else []:
            if not isinstance(field, dict):
                continue
            fields_payload.append(
                {
                    "id": field.get("id"),
                    "type": field.get("type"),
                    "label": field.get("label"),
                }
            )
        entities_payload.append(
            {
                "id": entity.get("id"),
                "display_field": entity.get("display_field"),
                "fields": fields_payload,
            }
        )

    views_payload = []
    for view in manifest.get("views", []) if isinstance(manifest.get("views"), list) else []:
        if not isinstance(view, dict):
            continue
        views_payload.append(
            {
                "id": view.get("id"),
                "kind": view.get("kind") or view.get("type"),
                "entity_id": view.get("entity") or view.get("entity_id") or view.get("entityId"),
            }
        )

    pages_payload = []
    for page in manifest.get("pages", []) if isinstance(manifest.get("pages"), list) else []:
        if not isinstance(page, dict):
            continue
        view_ids = set()
        header = page.get("header") if isinstance(page.get("header"), dict) else None
        if header and isinstance(header.get("actions"), list):
            for action in header.get("actions") or []:
                if not isinstance(action, dict):
                    continue
                target = action.get("target")
                if isinstance(target, str) and target.startswith("view:"):
                    view_ids.add(target.split("view:", 1)[1])
        content = page.get("content")
        if isinstance(content, list):
            view_ids.update(_studio2_extract_view_ids_from_blocks(content))
        pages_payload.append(
            {
                "id": page.get("id"),
                "title": page.get("title"),
                "view_ids": sorted(view_ids),
            }
        )

    actions_payload = []
    for action in manifest.get("actions", []) if isinstance(manifest.get("actions"), list) else []:
        if not isinstance(action, dict):
            continue
        actions_payload.append(
            {
                "id": action.get("id"),
                "kind": action.get("kind"),
                "entity_id": action.get("entity_id") or action.get("entity"),
            }
        )

    relations_payload = []
    for rel in manifest.get("relations", []) if isinstance(manifest.get("relations"), list) else []:
        if not isinstance(rel, dict):
            continue
        relations_payload.append({"from": rel.get("from"), "to": rel.get("to")})

    return {
        "entities": entities_payload,
        "views": views_payload,
        "pages": pages_payload,
        "actions": actions_payload,
        "relations": relations_payload,
    }


def _studio2_trim_manifest_payload(manifest: dict, max_bytes: int) -> tuple[dict, bool]:
    payload = copy.deepcopy(manifest)
    try:
        if len(json.dumps(payload, separators=(",", ":")).encode("utf-8")) <= max_bytes:
            return payload, False
    except Exception:
        pass
    truncated_keys = []
    for key in ("entities", "views", "pages", "actions", "relations", "workflows"):
        items = payload.get(key)
        if isinstance(items, list) and len(items) > 20:
            payload[key] = items[:20]
            truncated_keys.append(key)
    payload["_truncated"] = True
    if truncated_keys:
        payload["_truncated_keys"] = truncated_keys
    return payload, True


def _studio2_read_manifest_payload(request: Request, module_id: str, level: str | None) -> dict:
    module, manifest = _get_installed_manifest(request, module_id)
    if not module or not manifest:
        return {
            "ok": False,
            "error": {"code": "MODULE_NOT_FOUND", "message": "Module not installed or manifest missing"},
            "module_id": module_id,
        }
    level_norm = level if level in {"summary", "full"} else "summary"
    if level_norm == "summary":
        payload = _studio2_compact_manifest(manifest)
        return {"ok": True, "module_id": module_id, "level": "summary", "manifest": payload, "truncated": False}
    trimmed, truncated = _studio2_trim_manifest_payload(manifest, STUDIO2_READ_MANIFEST_MAX_BYTES)
    return {"ok": True, "module_id": module_id, "level": "full", "manifest": trimmed, "truncated": truncated}


def _studio2_build_registry_snapshot(request: Request) -> dict:
    installed = _get_registry_list(request)
    fingerprint = _studio2_registry_fingerprint(installed)
    cached = _cache_get("studio2_registry", fingerprint)
    if cached is not None:
        return cached

    manifest_by_id: dict[str, dict] = {}
    if USE_DB:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                """
                select m.module_id, m.name, m.current_hash, m.updated_at, s.manifest
                from modules_installed m
                join manifest_snapshots s
                  on s.org_id=m.org_id
                 and s.module_id=m.module_id
                 and s.manifest_hash=m.current_hash
                where m.org_id=%s
                """,
                [get_org_id()],
                query_name="studio2.registry.snapshot",
            )
        for row in rows:
            mid = row.get("module_id")
            manifest = row.get("manifest")
            if isinstance(manifest, str):
                try:
                    manifest = json.loads(manifest)
                except Exception:
                    manifest = None
            if isinstance(mid, str) and isinstance(manifest, dict):
                manifest_by_id[mid] = manifest

    modules_payload = []
    for mod in installed:
        module_id = mod.get("module_id")
        if not module_id:
            continue
        manifest = manifest_by_id.get(module_id)
        if manifest is None:
            head = mod.get("current_hash")
            if isinstance(head, str):
                try:
                    manifest = _get_snapshot(request, module_id, head)
                except Exception:
                    manifest = None
        if not isinstance(manifest, dict):
            continue
        module_section = manifest.get("module") if isinstance(manifest.get("module"), dict) else {}
        name = module_section.get("name") or mod.get("name")
        version = module_section.get("version")
        compact = _studio2_compact_manifest(manifest)
        modules_payload.append(
            {
                "module_id": module_id,
                "name": name,
                "version": version,
                "updated_at": mod.get("updated_at"),
                **compact,
            }
        )

    payload = {"snapshot_hash": fingerprint, "modules": modules_payload}
    _cache_set("studio2_registry", payload, fingerprint)
    return payload


def _studio2_list_modules(request: Request) -> dict:
    installed = _get_registry_list(request)
    drafts_list = drafts.list_drafts()
    drafts_by_id = {d.get("module_id"): d for d in drafts_list if isinstance(d, dict)}
    def _draft_name(draft_row: dict | None) -> str | None:
        if not isinstance(draft_row, dict):
            return None
        manifest = draft_row.get("manifest")
        if not isinstance(manifest, dict):
            return None
        manifest = _sanitize_manifest(manifest)
        module_section = manifest.get("module") if isinstance(manifest.get("module"), dict) else None
        name = module_section.get("name") if isinstance(module_section, dict) else None
        return name if isinstance(name, str) and name.strip() else None

    items = []
    for mod in installed:
        module_id = mod.get("module_id")
        draft = drafts_by_id.get(module_id)
        draft_name = _draft_name(draft)
        items.append(
            {
                "module_id": module_id,
                "name": draft_name or mod.get("name") or module_id,
                "installed": True,
                "enabled": mod.get("enabled"),
                "current_hash": mod.get("current_hash"),
                "updated_at": mod.get("updated_at"),
                "draft": {
                    "updated_at": draft.get("updated_at") if isinstance(draft, dict) else None,
                    "updated_by": draft.get("updated_by") if isinstance(draft, dict) else None,
                    "base_snapshot_id": draft.get("base_snapshot_id") if isinstance(draft, dict) else None,
                }
                if isinstance(draft, dict)
                else None,
            }
        )
    for draft in drafts_list:
        module_id = draft.get("module_id")
        if not module_id or any(item["module_id"] == module_id for item in items):
            continue
        draft_name = _draft_name(draft)
        items.append(
            {
                "module_id": module_id,
                "name": draft_name or module_id,
                "installed": False,
                "enabled": False,
                "current_hash": None,
                "updated_at": None,
                "draft": {
                    "updated_at": draft.get("updated_at"),
                    "updated_by": draft.get("updated_by"),
                    "base_snapshot_id": draft.get("base_snapshot_id"),
                },
            }
        )
    return {"modules": items}


def _decode_segment(segment: str) -> str:
    return segment.replace("~1", "/").replace("~0", "~")


def _parse_pointer(pointer: str) -> list[str]:
    if pointer == "":
        return []
    parts = pointer.split("/")
    if parts and parts[0] == "":
        parts = parts[1:]
    return [_decode_segment(p) for p in parts]


def _get_container_and_token(doc: Any, pointer: str):
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


def _pointer_exists(doc: Any, pointer: str) -> bool:
    try:
        _get_value(doc, pointer)
        return True
    except Exception:
        return False


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


def _apply_ops(doc: Any, ops: list[dict]) -> None:
    for op in ops:
        name = op.get("op")
        if name == "add":
            _apply_add(doc, op["path"], op["value"])
        elif name == "remove":
            _apply_remove(doc, op["path"])
        elif name == "replace":
            _apply_replace(doc, op["path"], op["value"])
        else:
            raise ValueError("Unsupported op")


def _studio2_diff_summary(ops: list[dict]) -> dict:
    counts: dict[str, int] = {"add": 0, "remove": 0, "replace": 0}
    touched = []
    for op in ops:
        name = op.get("op")
        if name in counts:
            counts[name] += 1
        path = op.get("path")
        if isinstance(path, str):
            touched.append(path)
    return {"counts": counts, "touched": sorted(set(touched))}


def _studio2_build_patchset_from_manifest(module_id: str, base_manifest: dict, target_manifest: dict) -> dict:
    base_keys = set(base_manifest.keys()) if isinstance(base_manifest, dict) else set()
    target_keys = set(target_manifest.keys()) if isinstance(target_manifest, dict) else set()
    keys = sorted(base_keys | target_keys)
    ops: list[dict] = []
    for key in keys:
        path = f"/{_encode_pointer_token(str(key))}"
        if key not in target_keys:
            ops.append({"op": "remove", "path": path})
            continue
        value = target_manifest.get(key)
        if key not in base_keys:
            ops.append({"op": "add", "path": path, "value": value})
        else:
            ops.append({"op": "set", "path": path, "value": value})
    return {
        "patchset_id": f"ps_{uuid.uuid4().hex}",
        "summary": "Apply manifest draft",
        "patches": [{"module_id": module_id, "ops": ops}],
    }


def _encode_pointer_token(token: str) -> str:
    return token.replace("~", "~0").replace("/", "~1")


def _find_entity_ref_paths(node: Any, old_ids: set[str], path: str = "") -> list[str]:
    matches: list[str] = []
    if isinstance(node, dict):
        for key, value in node.items():
            next_path = f"{path}/{_encode_pointer_token(str(key))}"
            if key in {"entity", "entity_id", "entityId"} and isinstance(value, str) and value in old_ids:
                matches.append(next_path)
            matches.extend(_find_entity_ref_paths(value, old_ids, next_path))
        return matches
    if isinstance(node, list):
        for idx, value in enumerate(node):
            next_path = f"{path}/{idx}"
            matches.extend(_find_entity_ref_paths(value, old_ids, next_path))
    return matches


def _studio2_resolve_ops(manifest: dict, ops: list[dict]) -> tuple[list[dict], list[dict]]:
    errors: list[dict] = []
    resolved_ops: list[dict] = []
    rename_entities: list[tuple[str, str]] = []
    for idx, op in enumerate(ops):
        if not isinstance(op, dict):
            errors.append({"code": "OP_INVALID", "message": "op must be object", "path": f"ops[{idx}]"})
            continue
        name = op.get("op")
        if name is None:
            if isinstance(op.get("add"), dict):
                payload = op.get("add")
                op = {"op": "add", "path": payload.get("path"), "value": payload.get("value")}
                name = "add"
            elif isinstance(op.get("set"), dict):
                payload = op.get("set")
                op = {"op": "set", "path": payload.get("path"), "value": payload.get("value")}
                name = "set"
            elif isinstance(op.get("remove"), dict):
                payload = op.get("remove")
                op = {"op": "remove", "path": payload.get("path")}
                name = "remove"
            elif isinstance(op.get("rename_id"), dict):
                payload = op.get("rename_id")
                op = {"op": "rename_id", "path": payload.get("path"), "value": payload.get("value")}
                name = "rename_id"
        path = op.get("path")
        if name not in {"set", "add", "remove", "rename_id"}:
            errors.append({"code": "OP_UNSUPPORTED", "message": f"unsupported op {name}", "path": f"ops[{idx}].op"})
            continue
        if not isinstance(path, str) or not path.startswith("/"):
            errors.append({"code": "OP_PATH_INVALID", "message": "path must be JSON pointer", "path": f"ops[{idx}].path"})
            continue
        if name == "remove":
            resolved_ops.append({"op": "remove", "path": path})
            continue
        value = op.get("value")
        if name in {"set", "add", "rename_id"} and value is None:
            errors.append({"code": "OP_VALUE_REQUIRED", "message": "value is required", "path": f"ops[{idx}].value"})
            continue
        if name == "rename_id":
            try:
                current = _get_value(manifest, path)
            except Exception:
                current = None
            if isinstance(current, dict):
                old_id = current.get("id") if isinstance(current.get("id"), str) else None
                if old_id and isinstance(value, str) and (path.startswith("/entities/") or old_id.startswith("entity.")):
                    rename_entities.append((old_id, value))
                resolved_ops.append({"op": "replace", "path": f"{path}/id", "value": value})
            else:
                if isinstance(current, str) and isinstance(value, str) and (path.startswith("/entities/") or current.startswith("entity.")):
                    rename_entities.append((current, value))
                resolved_ops.append({"op": "replace", "path": path, "value": value})
            continue
        if name == "add":
            resolved_ops.append({"op": "add", "path": path, "value": value})
            continue
        if name == "set":
            op_name = "replace" if _pointer_exists(manifest, path) else "add"
            resolved_ops.append({"op": op_name, "path": path, "value": value})
            continue
    if rename_entities:
        replaced: dict[str, str] = {}
        for old_id, new_id in rename_entities:
            if not isinstance(old_id, str) or not isinstance(new_id, str) or old_id == new_id:
                continue
            full_new = new_id if new_id.startswith("entity.") else f"entity.{new_id}"
            old_ids = {old_id}
            if old_id.startswith("entity."):
                old_ids.add(old_id[7:])
            else:
                old_ids.add(f"entity.{old_id}")
            for path in _find_entity_ref_paths(manifest, old_ids):
                replaced[path] = full_new
        for path in sorted(replaced):
            resolved_ops.append({"op": "replace", "path": path, "value": replaced[path]})
    return resolved_ops, errors


def _studio2_apply_patchset(manifest: dict, patchset: dict) -> dict:
    patches = patchset.get("patches", []) if isinstance(patchset, dict) else []
    if not isinstance(patches, list) or len(patches) != 1:
        return {
            "ok": False,
            "errors": [{"code": "PATCHSET_INVALID", "message": "single patch required", "path": "patches"}],
            "warnings": [],
            "resolved_ops": [],
            "manifest": None,
        }
    patch = patches[0]
    ops = patch.get("ops")
    if not isinstance(ops, list):
        return {
            "ok": False,
            "errors": [{"code": "PATCHSET_INVALID", "message": "ops must be list", "path": "patches[0].ops"}],
            "warnings": [],
            "resolved_ops": [],
            "manifest": None,
        }
    resolved_ops, errors = _studio2_resolve_ops(manifest, ops)
    if errors:
        return {"ok": False, "errors": errors, "warnings": [], "resolved_ops": resolved_ops, "manifest": None}
    updated = json.loads(json.dumps(manifest))
    try:
        _apply_ops(updated, resolved_ops)
    except Exception as exc:
        return {
            "ok": False,
            "errors": [{"code": "PATCH_APPLY_FAILED", "message": str(exc), "path": "patches[0].ops"}],
            "warnings": [],
            "resolved_ops": resolved_ops,
            "manifest": None,
        }
    return {"ok": True, "errors": [], "warnings": [], "resolved_ops": resolved_ops, "manifest": updated}


def _json_fix_attempt(text: str, line: int | None, col: int | None) -> tuple[str | None, list[str]]:
    suggestions: list[str] = []

    def can_parse(candidate: str) -> bool:
        try:
            json.loads(candidate)
            return True
        except Exception:
            return False

    if can_parse(text):
        return text, suggestions

    cleaned = re.sub(r",\s*([}\]])", r"\1", text)
    if cleaned != text:
        suggestions.append("removed trailing commas")
    if can_parse(cleaned):
        return cleaned, suggestions

    fixed = cleaned
    open_braces = fixed.count("{")
    close_braces = fixed.count("}")
    open_brackets = fixed.count("[")
    close_brackets = fixed.count("]")
    if open_braces > close_braces:
        fixed = fixed + ("}" * (open_braces - close_braces))
        suggestions.append("added missing closing braces")
    if open_brackets > close_brackets:
        fixed = fixed + ("]" * (open_brackets - close_brackets))
        suggestions.append("added missing closing brackets")
    if can_parse(fixed):
        return fixed, suggestions

    if line and col:
        lines = fixed.splitlines()
        if 1 <= line <= len(lines):
            idx = 0
            for i, l in enumerate(lines, start=1):
                if i == line:
                    idx += max(col - 1, 0)
                    break
                idx += len(l) + 1
            if 0 <= idx <= len(fixed):
                if idx > 0 and fixed[idx - 1] not in "{[,": 
                    candidate = fixed[:idx] + "," + fixed[idx:]
                    suggestions.append("inserted missing comma")
                    if can_parse(candidate):
                        return candidate, suggestions

    return None, suggestions


def _preview_module_change(request: Request, module_id: str, manifest: dict, reason: str, patch_id: str, mode: str) -> dict:
    head = _get_head(request, module_id)
    if mode == "upgrade" and head is None:
        return {"error": _error_response("MODULE_NOT_INSTALLED", "Module not installed", "module_id", status=404)}
    actor = getattr(request.state, "actor", None)
    actor_id = actor.get("user_id") if isinstance(actor, dict) else "anonymous"
    payload = _preview_payload(
        module_id,
        head,
        manifest,
        reason,
        patch_id,
        actor_id,
    )
    payload["mode"] = mode
    return payload


def _apply_module_change_db(module_id: str, manifest: dict, actor: dict | None, mode: str, reason: str, patch_id: str | None) -> dict:
    existing = registry.get(module_id)
    warnings = []
    if mode == "install":
        if existing is not None:
            warnings.append({"code": "MODULE_ALREADY_INSTALLED", "message": "Module already installed", "path": "module_id", "detail": None})
            return {"ok": True, "errors": [], "warnings": warnings, "module": existing, "audit_id": None}
        new_hash = store.init_module(module_id, manifest, actor=actor, reason=reason)
        module_name = _module_name_from_manifest(manifest)
        with get_conn() as conn:
            version = _insert_module_version(conn, module_id, new_hash, manifest, actor, notes=reason)
            execute(
                conn,
                """
                insert into modules_installed (org_id, module_id, enabled, current_hash, name, installed_at, updated_at, tags, status, active_version, last_error, archived)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                [get_org_id(), module_id, True, new_hash, module_name, _now(), _now(), None, "installed", version.get("version_id"), None, False],
                query_name="modules_installed.insert_install",
            )
            audit_id = str(uuid.uuid4())
            audit = {
                "audit_id": audit_id,
                "module_id": module_id,
                "action": "install",
                "from_hash": None,
                "to_hash": new_hash,
                "patch_id": patch_id,
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
                [get_org_id(), module_id, audit_id, json.dumps(audit), _now()],
                query_name="module_audit.insert_install",
            )
        return {"ok": True, "errors": [], "warnings": warnings, "module": registry.get(module_id), "audit_id": audit_id}

    result = _upgrade_module_db(module_id, manifest, actor=actor, reason=reason, patch_id=patch_id)
    return result


def _apply_module_change_memory(module_id: str, manifest: dict, actor: dict | None, mode: str, reason: str, patch_id: str | None) -> dict:
    existing = registry.get(module_id)
    warnings = []
    if mode == "install" and existing is not None:
        warnings.append({"code": "MODULE_ALREADY_INSTALLED", "message": "Module already installed", "path": "module_id", "detail": None})
        return {"ok": True, "errors": [], "warnings": warnings, "module": existing, "audit_id": None}

    new_hash = store.init_module(module_id, manifest, actor=actor, reason=reason)
    now = _now()
    prev_hash = existing.get("current_hash") if existing else None
    if existing is None:
        record = {
            "module_id": module_id,
            "name": _module_name_from_manifest(manifest),
            "enabled": True,
            "current_hash": new_hash,
            "installed_at": now,
            "updated_at": now,
            "tags": None,
        }
    else:
        record = dict(existing)
        record["current_hash"] = new_hash
        record["updated_at"] = now
        module_name = _module_name_from_manifest(manifest)
        if module_name:
            record["name"] = module_name
        if mode == "install":
            record["enabled"] = True
    # In-memory registry does not expose a public setter, so we update internals here.
    registry._modules[module_id] = record
    audit_id = str(uuid.uuid4())
    audit = {
        "audit_id": audit_id,
        "module_id": module_id,
        "action": mode,
        "from_hash": prev_hash,
        "to_hash": new_hash,
        "patch_id": patch_id,
        "actor": actor,
        "reason": reason,
        "at": now,
    }
    registry._audit.setdefault(module_id, []).insert(0, audit)
    return {"ok": True, "errors": [], "warnings": warnings, "module": record, "audit_id": audit_id}


def _apply_module_change(request: Request, module_id: str, manifest: dict, mode: str, reason: str, patch_id: str | None) -> dict:
    actor = getattr(request.state, "actor", None)
    if USE_DB:
        return _apply_module_change_db(module_id, manifest, actor=actor, mode=mode, reason=reason, patch_id=patch_id)
    return _apply_module_change_memory(module_id, manifest, actor=actor, mode=mode, reason=reason, patch_id=patch_id)


def _delete_module_db(module_id: str, actor: dict | None, reason: str, force: bool = False, archive: bool = False) -> dict:
    record = registry.get(module_id)
    if record is None:
        return {"ok": False, "errors": [{"code": "MODULE_NOT_FOUND", "message": "module not found", "path": "module_id", "detail": None}], "warnings": [], "module": None, "audit_id": None}
    if module_id in SYSTEM_MODULE_IDS:
        return {"ok": False, "errors": [{"code": "MODULE_DELETE_FORBIDDEN", "message": "System module cannot be deleted", "path": "module_id", "detail": None}], "warnings": [], "module": None, "audit_id": None}

    manifest = None
    manifest_hash = record.get("current_hash")
    if manifest_hash:
        try:
            manifest = store.get_snapshot(module_id, manifest_hash)
        except Exception:
            manifest = None

    entity_ids = collect_entity_record_ids(manifest or {})
    audit_id = str(uuid.uuid4())
    audit = {
        "audit_id": audit_id,
        "module_id": module_id,
        "action": "module_archived" if archive else "module_deleted",
        "from_hash": record.get("current_hash"),
        "to_hash": None,
        "patch_id": None,
        "actor": actor,
        "reason": "archive" if archive else reason,
        "at": _now(),
    }
    with get_conn() as conn:
        record_count = 0
        entity_counts: dict[str, int] = {}
        if entity_ids:
            placeholders = ",".join(["%s"] * len(entity_ids))
            rows = fetch_all(
                conn,
                f"""
                select entity_id, count(*) as count
                from records_generic
                where tenant_id=%s and entity_id in ({placeholders})
                group by entity_id
                """,
                [get_org_id(), *sorted(entity_ids)],
                query_name="records_generic.count_module_entities",
            )
            for row in rows:
                entity_id = row.get("entity_id")
                if not isinstance(entity_id, str):
                    continue
                count = int(row.get("count") or 0)
                if count:
                    entity_counts[entity_id] = count
                    record_count += count
        if record_count > 0 and not force and not archive:
            return {
                "ok": False,
                "errors": [
                    {
                        "code": "MODULE_HAS_RECORDS",
                        "message": "Module has records; delete blocked unless forced",
                        "path": "module_id",
                        "detail": {"record_count": record_count, "entity_counts": entity_counts},
                    }
                ],
                "warnings": [],
                "module": None,
                "audit_id": None,
            }
        if force and entity_ids:
            placeholders = ",".join(["%s"] * len(entity_ids))
            execute(
                conn,
                f"delete from records_generic where tenant_id=%s and entity_id in ({placeholders})",
                [get_org_id(), *sorted(entity_ids)],
                query_name="records_generic.delete_module_entities",
            )
        execute(conn, "delete from module_drafts where module_id=%s", [module_id], query_name="module_drafts.delete")
        execute(conn, "delete from module_draft_versions where module_id=%s", [module_id], query_name="module_draft_versions.delete")
        execute(
            conn,
            """
            update modules_installed
            set archived=true, enabled=false, status=%s, updated_at=%s
            where org_id=%s and module_id=%s
            """,
            ["archived", _now(), get_org_id(), module_id],
            query_name="modules_installed.archive",
        )
        execute(
            conn,
            """
            insert into module_audit (org_id, module_id, audit_id, audit, created_at)
            values (%s,%s,%s,%s,%s)
            """,
            [get_org_id(), module_id, audit_id, json.dumps(audit), _now()],
            query_name="module_audit.insert_delete",
        )
    return {"ok": True, "errors": [], "warnings": [], "module": None, "audit_id": audit_id}


def _delete_module_memory(module_id: str, actor: dict | None, reason: str, force: bool = False, archive: bool = False) -> dict:
    return delete_module_memory(
        module_id,
        registry,
        store,
        generic_records,
        drafts=drafts,
        actor=actor,
        reason=reason,
        force=force,
        archive=archive,
    )


@app.get("/modules")
async def list_modules(request: Request) -> dict:
    cached = _cache_get("modules")
    if cached is not None:
        return {"modules": cached}
    modules = _get_registry_list(request)
    for mod in modules:
        if mod.get("name"):
            continue
        module_id = mod.get("module_id")
        manifest_hash = mod.get("current_hash")
        if not module_id or not manifest_hash:
            continue
        try:
            manifest = _get_snapshot(request, module_id, manifest_hash)
        except Exception:
            continue
        name = _module_name_from_manifest(manifest)
        if name:
            mod["name"] = name
    _cache_set("modules", modules)
    return {"modules": modules}


@app.post("/modules/{module_id}/icon")
async def set_module_icon(module_id: str, request: Request) -> dict:
    body = await request.json()
    icon_key = body.get("icon_key") or body.get("icon")
    if not isinstance(icon_key, str) or not icon_key.strip():
        return _error_response("ICON_REQUIRED", "icon_key required", "icon_key", status=400)
    registry.set_icon(module_id, icon_key.strip())
    _cache_invalidate("modules")
    _cache_invalidate("registry_list")
    return {"ok": True}


@app.delete("/modules/{module_id}/icon")
async def clear_module_icon(module_id: str) -> dict:
    registry.clear_icon(module_id)
    _cache_invalidate("modules")
    _cache_invalidate("registry_list")
    return {"ok": True}


@app.post("/modules/{module_id}/order")
async def set_module_order(module_id: str, request: Request) -> dict:
    body = await request.json()
    order = body.get("display_order")
    if order is None or order == "":
        display_order = None
    elif isinstance(order, int):
        display_order = order
    elif isinstance(order, str) and order.strip().lstrip("-").isdigit():
        display_order = int(order)
    else:
        return _error_response("ORDER_INVALID", "display_order must be an integer", "display_order", status=400)
    registry.set_display_order(module_id, display_order)
    _cache_invalidate("modules")
    _cache_invalidate("registry_list")
    return {"ok": True}


@app.get("/modules/{module_id}/manifest")
async def get_module_manifest(module_id: str, request: Request) -> dict:
    module = _get_module(request, module_id)
    if module is None:
        return _error_response("MODULE_NOT_INSTALLED", "Module not installed", "module_id", status=404)
    if not module.get("enabled"):
        return _error_response("MODULE_DISABLED", "Module is disabled", "module_id", status=400)
    manifest_hash = module.get("current_hash")
    cache_key = f"{module_id}:{manifest_hash}"
    cached = _cache_get("manifest", cache_key)
    if cached is not None:
        return _ok_response({"module_id": module_id, "manifest_hash": manifest_hash, "manifest": cached})
    try:
        manifest = _get_snapshot(request, module_id, manifest_hash)
    except Exception:
        return _error_response("MODULE_NOT_FOUND", "Module manifest not found", "module_id", status=404)
    _get_compiled_manifest(module_id, manifest_hash, manifest)
    _cache_set("manifest", manifest, cache_key)
    return _ok_response({"module_id": module_id, "manifest_hash": manifest_hash, "manifest": manifest})


@app.get("/page/bootstrap")
async def page_bootstrap(
    request: Request,
    module_id: str,
    page_id: str | None = None,
    view_id: str | None = None,
    record_id: str | None = None,
    cursor: str | None = None,
    limit: int = 50,
    q: str | None = None,
    search_fields: str | None = None,
    domain: str | None = None,
) -> dict:
    if not module_id:
        return _error_response("MODULE_REQUIRED", "module_id is required", "module_id", status=400)
    module, manifest = _get_installed_manifest(request, module_id)
    if module is None or manifest is None:
        return _error_response("MODULE_NOT_FOUND", "Module not found or disabled", "module_id", status=404)
    manifest_hash = module.get("current_hash")
    if not isinstance(manifest_hash, str):
        return _error_response("MODULE_INVALID", "Module manifest hash missing", "module_id", status=400)
    org_id = get_org_id()
    cache_key = f"bootstrap:{org_id}:{module_id}:{manifest_hash}:{page_id or ''}:{view_id or ''}:{record_id or ''}:{cursor or ''}:{limit}:{q or ''}:{search_fields or ''}:{domain or ''}"
    cached = _resp_cache_get(cache_key)
    if cached is not None:
        logger.info("cache_hit=page_bootstrap key=%s", cache_key)
        return cached
    compiled = _get_compiled_manifest(module_id, manifest_hash, manifest)
    view_obj, page_obj = _resolve_bootstrap_view(manifest, page_id, view_id)
    if not view_obj:
        fallback_view = _fallback_view_id_from_page_id(manifest, page_id) if not view_id else None
        if fallback_view:
            view_obj, page_obj = _resolve_bootstrap_view(manifest, page_id, fallback_view)
            if view_obj:
                view_id = fallback_view
        if not view_obj:
            return _error_response("VIEW_NOT_FOUND", "View not found for bootstrap", "view_id", status=404)
    kind = view_obj.get("kind") or view_obj.get("type")
    view_entity = view_obj.get("entity") or view_obj.get("entity_id") or view_obj.get("entityId")
    view_entity = _normalize_entity_id(view_entity) if isinstance(view_entity, str) else view_entity

    payload: dict = {
        "module_id": module_id,
        "manifest_hash": manifest_hash,
        "manifest": manifest,
        "compiled": compiled,
        "page": page_obj,
        "view_id": view_obj.get("id"),
        "page_id": page_obj.get("id") if isinstance(page_obj, dict) else None,
        "permissions": {},
    }

    if kind == "list" and view_entity:
        columns = view_obj.get("columns") if isinstance(view_obj.get("columns"), list) else []
        field_ids = []
        for col in columns:
            if isinstance(col, dict) and isinstance(col.get("field_id"), str):
                field_ids.append(col.get("field_id"))
        entity_def = None
        for ent in manifest.get("entities", []) if isinstance(manifest.get("entities"), list) else []:
            if isinstance(ent, dict) and _match_entity_id(view_entity, ent.get("id")):
                entity_def = ent
                break
        display_field = entity_def.get("display_field") if isinstance(entity_def, dict) else None
        if isinstance(display_field, str):
            field_ids.append(display_field)
        field_ids = list(dict.fromkeys([f for f in field_ids if isinstance(f, str) and f]))
        fields_list = [f.strip() for f in search_fields.split(",")] if isinstance(search_fields, str) and search_fields.strip() else None
        parsed_domain = None
        if isinstance(domain, str) and domain.strip():
            try:
                parsed_domain = json.loads(domain)
            except Exception:
                parsed_domain = None
        items, next_cursor = generic_records.list_page(
            view_entity,
            limit=limit,
            cursor=cursor,
            q=q,
            search_fields=fields_list,
            fields=None if parsed_domain else field_ids,
        )
        if parsed_domain:
            items = _filter_records_by_domain(items, parsed_domain, {})
        payload["list"] = {
            "entity_id": view_entity,
            "records": items,
            "next_cursor": next_cursor,
            "columns": columns,
        }

    if kind == "form" and view_entity and record_id:
        record = generic_records.get(view_entity, record_id)
        payload["record"] = {
            "entity_id": view_entity,
            "record_id": record_id,
            "record": record.get("record") if record else None,
        }

    response = _ok_response(payload)
    _resp_cache_set(cache_key, response)
    logger.info("cache_miss=page_bootstrap key=%s", cache_key)
    return response




def _upgrade_module_db(module_id: str, manifest: dict, actor: dict | None, reason: str, patch_id: str | None = None) -> dict:
    existing = registry.get(module_id)
    if existing is None:
        return {"ok": False, "errors": [{"code": "MODULE_NOT_FOUND", "message": "module not found", "path": "module_id", "detail": None}], "warnings": [], "module": None, "audit_id": None}
    new_hash = store.init_module(module_id, manifest, actor=actor, reason=reason)
    module_name = _module_name_from_manifest(manifest)
    warnings = []
    if existing.get("current_hash") == new_hash:
        warnings.append({"code": "MODULE_ALREADY_UP_TO_DATE", "message": "Module already up to date", "path": "module_id", "detail": None})
    try:
        with get_conn() as conn:
            version = _insert_module_version(conn, module_id, new_hash, manifest, actor, notes=reason)
            execute(
                conn,
                """
                update modules_installed
                set current_hash=%s, updated_at=%s, status=%s, active_version=%s, last_error=%s
                where org_id=%s and module_id=%s
                """,
                [new_hash, _now(), "installed", version.get("version_id"), None, get_org_id(), module_id],
                query_name="modules_installed.update_hash_upgrade",
            )
            if module_name:
                execute(
                    conn,
                    """
                    update modules_installed set name=%s, updated_at=%s
                    where org_id=%s and module_id=%s
                    """,
                    [module_name, _now(), get_org_id(), module_id],
                    query_name="modules_installed.update_name_upgrade",
                )
            audit_id = str(uuid.uuid4())
            audit = {
                "audit_id": audit_id,
                "module_id": module_id,
                "action": "upgrade",
                "from_hash": existing.get("current_hash"),
                "to_hash": new_hash,
                "patch_id": patch_id,
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
                [get_org_id(), module_id, audit_id, json.dumps(audit), _now()],
                query_name="module_audit.insert_upgrade",
            )
    except Exception as exc:
        with get_conn() as conn:
            execute(
                conn,
                """
                update modules_installed set status=%s, last_error=%s, updated_at=%s
                where org_id=%s and module_id=%s
                """,
                ["failed", str(exc), _now(), get_org_id(), module_id],
                query_name="modules_installed.upgrade_failed",
            )
        return {"ok": False, "errors": [{"code": "MODULE_UPGRADE_FAILED", "message": str(exc), "path": "module_id", "detail": None}], "warnings": [], "module": None, "audit_id": None}
    return {"ok": True, "errors": [], "warnings": warnings, "module": registry.get(module_id), "audit_id": audit_id}





@app.post("/modules/{module_id}/enable")
async def module_enable(module_id: str, request: Request) -> dict:
    actor = getattr(request.state, "actor", None)
    denied = _require_admin(actor)
    if denied:
        return denied
    body = await request.json()
    result = registry.set_enabled(module_id, True, actor=actor, reason=body.get("reason", "enable"))
    if not result["ok"]:
        return _error_response(result["errors"][0]["code"], result["errors"][0]["message"], result["errors"][0].get("path"), result["errors"][0].get("detail"))
    _cache_invalidate("modules")
    _cache_invalidate("registry_list")
    _cache_invalidate("manifest")
    _compiled_cache_invalidate(module_id)
    return _ok_response({"module": result["module"], "audit_id": result["audit_id"]}, warnings=result["warnings"])


@app.post("/modules/{module_id}/disable")
async def module_disable(module_id: str, request: Request) -> dict:
    actor = getattr(request.state, "actor", None)
    denied = _require_admin(actor)
    if denied:
        return denied
    body = await request.json()
    result = registry.set_enabled(module_id, False, actor=actor, reason=body.get("reason", "disable"))
    if not result["ok"]:
        return _error_response(result["errors"][0]["code"], result["errors"][0]["message"], result["errors"][0].get("path"), result["errors"][0].get("detail"))
    _cache_invalidate("modules")
    _cache_invalidate("registry_list")
    _cache_invalidate("manifest")
    _compiled_cache_invalidate(module_id)
    return _ok_response({"module": result["module"], "audit_id": result["audit_id"]}, warnings=result["warnings"])


@app.delete("/modules/{module_id}")
async def module_delete(module_id: str, request: Request, force: bool = False, archive: bool = False) -> dict:
    actor = getattr(request.state, "actor", None)
    denied = _require_admin(actor)
    if denied:
        return denied
    reason = "delete"
    if not _begin_module_mutation(module_id):
        return _error_response("MODULE_MUTATION_IN_PROGRESS", "Module mutation in progress", "module_id", status=409)
    try:
        if USE_DB:
            result = _delete_module_db(module_id, actor=actor, reason=reason, force=force, archive=archive)
        else:
            result = _delete_module_memory(module_id, actor=actor, reason=reason, force=force, archive=archive)
        if not result.get("ok"):
            return _error_response(result["errors"][0]["code"], result["errors"][0]["message"], result["errors"][0].get("path"), result["errors"][0].get("detail"))
        _cache_invalidate("modules")
        _cache_invalidate("registry_list")
        _cache_invalidate("manifest")
        _compiled_cache_invalidate(module_id)
        return _ok_response({"module": None, "audit_id": result.get("audit_id")})
    finally:
        _end_module_mutation(module_id)


@app.get("/modules/{module_id}/snapshots")
async def module_snapshots(module_id: str, request: Request) -> dict:
    module = _get_module(request, module_id)
    if module is None:
        return _error_response("MODULE_NOT_INSTALLED", "Module not installed", "module_id", status=404)
    snapshots = store.list_snapshots(module_id)
    return _ok_response({"data": {"module_id": module_id, "snapshots": snapshots}})


@app.post("/modules/{module_id}/rollback")
async def module_rollback(module_id: str, request: Request) -> dict:
    actor = getattr(request.state, "actor", None)
    denied = _require_admin(actor)
    if denied:
        return denied
    if module_id in SYSTEM_MODULE_IDS:
        return _error_response("MODULE_ROLLBACK_FORBIDDEN", "System module cannot be rolled back", "module_id", status=403)
    module = _get_module(request, module_id)
    if module is None:
        return _error_response("MODULE_NOT_INSTALLED", "Module not installed", "module_id", status=404)
    if not _begin_module_mutation(module_id):
        return _error_response("MODULE_MUTATION_IN_PROGRESS", "Module mutation in progress", "module_id", status=409)
    try:
        body = await _safe_json(request)
        snapshot_id = body.get("snapshot_id") or body.get("manifest_hash")
        to_version_id = body.get("to_version_id") or body.get("version_id")
        to_version_num = body.get("to_version_num") or body.get("version_num")
        if not snapshot_id and not to_version_id and to_version_num is None:
            return _error_response("ROLLBACK_INVALID", "snapshot_id or version_id is required", "snapshot_id", status=400)
        result = registry.rollback(
            module_id,
            snapshot_id,
            actor=actor,
            reason=body.get("reason", "rollback"),
            to_version_id=to_version_id,
            to_version_num=to_version_num,
        )
        if not result.get("ok"):
            return _error_response(result["errors"][0]["code"], result["errors"][0]["message"], result["errors"][0].get("path"), result["errors"][0].get("detail"))
        _cache_invalidate("modules")
        _cache_invalidate("registry_list")
        _cache_invalidate("manifest")
        _compiled_cache_invalidate(module_id)
        return _ok_response({"data": {"module": result.get("module"), "audit_id": result.get("audit_id")}}, warnings=result.get("warnings"))
    finally:
        _end_module_mutation(module_id)


@app.get("/studio/modules")
async def studio_list_modules(request: Request) -> dict:
    cached = _cache_get("studio_modules")
    if cached is not None:
        return _ok_response({"data": cached})

    drafts_list = drafts.list_drafts()
    installed_list = _get_registry_list(request)
    installed_by_id = {m.get("module_id"): m for m in installed_list if m.get("module_id")}

    draft_payload = []
    draft_meta_by_id: dict[str, dict] = {}
    for draft in drafts_list:
        module_id = draft.get("module_id")
        draft_manifest = draft.get("manifest") if isinstance(draft.get("manifest"), dict) else None
        draft_hash = _draft_hash(draft_manifest) if isinstance(draft_manifest, dict) else None
        draft_name = _module_name_from_manifest(draft_manifest)
        installed = installed_by_id.get(module_id) if module_id else None
        installed_hash = installed.get("current_hash") if installed else None
        payload = {
            **{k: v for k, v in draft.items() if k != "manifest"},
            "name": draft_name,
            "draft_hash": draft_hash,
            "is_installed": installed is not None,
            "installed_hash": installed_hash,
            "in_sync": bool(draft_hash and installed_hash and draft_hash == installed_hash),
        }
        draft_payload.append(payload)
        if module_id:
            draft_meta_by_id[module_id] = {"hash": draft_hash, "name": draft_name, "updated_at": draft.get("updated_at")}

    installed = []
    for mod in installed_list:
        module_id = mod.get("module_id")
        draft_meta = draft_meta_by_id.get(module_id) if module_id else None
        draft_hash = draft_meta.get("hash") if draft_meta else None
        name = draft_meta.get("name") if draft_meta and draft_meta.get("name") else mod.get("name")
        installed.append(
            {
                "module_id": module_id,
                "name": name,
                "installed": True,
                "enabled": bool(mod.get("enabled")),
                "current_hash": mod.get("current_hash"),
                "has_draft": draft_meta is not None,
                "draft_updated_at": draft_meta.get("updated_at") if draft_meta else None,
                "draft_hash": draft_hash,
                "draft_in_sync": bool(draft_hash and mod.get("current_hash") and draft_hash == mod.get("current_hash")),
            }
        )
    payload = {"drafts": draft_payload, "installed": installed}
    _cache_set("studio_modules", payload)
    return _ok_response({"data": payload})


@app.post("/studio2/agent/chat")
async def studio2_agent_chat(request: Request) -> dict:
    body = await _safe_json(request)
    include_progress = bool(body.get("include_progress")) if isinstance(body, dict) else False
    if not isinstance(body, dict):
        body = {}
    return await _studio2_agent_chat_run(request, body, progress=None, include_progress=include_progress)


@app.post("/studio2/agent/chat/stream")
async def studio2_agent_chat_stream(request: Request) -> StreamingResponse:
    body = await _safe_json(request)
    if not isinstance(body, dict):
        body = {}
    module_id = body.get("module_id")
    message = body.get("message")
    if not isinstance(module_id, str) or not isinstance(message, str):
        return _error_response("AGENT_INVALID", "module_id and message required", "module_id")

    request_id = request.headers.get("x-request-id") if hasattr(request, "headers") else None
    request_id_value = request_id or str(uuid.uuid4())
    queue: asyncio.Queue[str] = asyncio.Queue()
    done_event = asyncio.Event()

    def _sink(frame: str) -> None:
        queue.put_nowait(frame)

    progress = AgentProgress(
        request_id=request_id_value,
        module_id=module_id,
        stream_debug=STUDIO2_AGENT_STREAM_DEBUG,
        sink=_sink,
    )

    async def _run() -> None:
        try:
            result = await _studio2_agent_chat_run(request, body, progress=progress, include_progress=True)
            if isinstance(result, JSONResponse):
                payload = json.loads(result.body)
            else:
                payload = result
            if isinstance(payload, dict) and not payload.get("ok"):
                progress.emit(
                    "stopped",
                    "stop",
                    None,
                    {"stop_reason": "validation_error", "final_error_counts": {}},
                )
            progress.emit(
                "final_done",
                "done",
                None,
                {"final_payload": payload},
            )
            progress.emit(
                "done",
                "done",
                None,
                {"final_payload": payload, "progress": progress.to_progress_list()},
            )
            logger.info("studio2_agent_stream_done request_id=%s module_id=%s", request_id_value, module_id)
        except Exception as exc:
            progress.emit(
                "stopped",
                "stop",
                None,
                {"stop_reason": "exception", "error": str(exc)},
            )
            progress.emit(
                "final_done",
                "done",
                None,
                {
                    "final_payload": {
                        "ok": False,
                        "errors": [{"code": "STREAM_ERROR", "message": str(exc)}],
                        "warnings": [],
                    }
                },
            )
            progress.emit(
                "done",
                "done",
                None,
                {
                    "final_payload": {
                        "ok": False,
                        "errors": [{"code": "STREAM_ERROR", "message": str(exc)}],
                        "warnings": [],
                    }
                },
            )
        finally:
            done_event.set()

    async def event_generator():
        asyncio.create_task(_run())
        while True:
            try:
                frame = await asyncio.wait_for(queue.get(), timeout=15.0)
                yield frame
            except asyncio.TimeoutError:
                yield ": ping\n\n"
            if done_event.is_set() and queue.empty():
                break

    headers = {"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}
    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=headers)


@app.get("/studio/modules/{module_id}")
async def studio_get_draft(module_id: str) -> dict:
    draft = drafts.get_draft(module_id)
    installed = registry.get(module_id)
    installed_manifest = None
    if installed and installed.get("current_hash"):
        try:
            installed_manifest = store.get_snapshot(module_id, installed.get("current_hash"))
        except Exception:
            installed_manifest = None
    draft_hash = None
    if draft and isinstance(draft.get("manifest"), dict):
        draft_hash = _draft_hash(draft.get("manifest"))
    installed_hash = installed.get("current_hash") if installed else None
    payload = {"draft": draft, "installed": installed, "installed_manifest": installed_manifest, "draft_hash": draft_hash, "installed_hash": installed_hash}
    if draft is None and installed is None:
        return _error_response("MODULE_NOT_FOUND", "Module not found", "module_id", status=404)
    return _ok_response({"data": payload})


@app.post("/studio/modules/new")
async def studio_create_draft(request: Request) -> dict:
    module_id = _generate_module_id()
    manifest = _build_v1_template(module_id)
    updated_by = None
    if hasattr(request.state, "user"):
        actor = getattr(request.state, "actor", None)
        updated_by = (actor or {}).get("email") or (actor or {}).get("user_id")
    saved = drafts.upsert_draft(module_id, manifest, updated_by=updated_by, base_snapshot_id=None)
    _cache_invalidate("studio_modules")
    return _ok_response({"data": {"module_id": module_id, "draft": saved}})


@app.put("/studio/modules/{module_id}")
async def studio_upsert_draft(module_id: str, request: Request) -> dict:
    if not _is_valid_module_id(module_id):
        return _error_response("MODULE_ID_INVALID", "module_id is invalid", "module_id")

    body = await _safe_json(request)
    manifest = _parse_manifest_body(body)
    if not isinstance(manifest, dict):
        return _error_response("MANIFEST_INVALID", "manifest must be an object", "manifest")
    declared_id = manifest.get("module_id")
    module_section = manifest.get("module") if isinstance(manifest.get("module"), dict) else None
    module_section_id = module_section.get("id") if module_section else None
    if declared_id and declared_id != module_id:
        return _error_response("MODULE_ID_MISMATCH", "manifest.module_id must match route", "manifest.module_id")
    if module_section_id and module_section_id != module_id:
        return _error_response("MODULE_ID_MISMATCH", "module.id must match route", "module.id")

    updated_by = None
    if hasattr(request.state, "user"):
        actor = getattr(request.state, "actor", None)
        updated_by = (actor or {}).get("email") or (actor or {}).get("user_id")
    base_snapshot_id = None
    if registry.get(module_id):
        base_snapshot_id = registry.get(module_id).get("current_hash")
    saved = drafts.upsert_draft(module_id, manifest, updated_by=updated_by, base_snapshot_id=base_snapshot_id)
    _cache_invalidate("studio_modules")
    return _ok_response({"data": {"module_id": module_id, "updated_at": saved.get("updated_at")}})


@app.post("/studio/modules/{module_id}/discard_draft")
async def studio_discard_draft(module_id: str) -> dict:
    try:
        drafts.delete_draft(module_id)
    except Exception:
        pass
    _cache_invalidate("studio_modules")
    return _ok_response({"data": {"module_id": module_id, "discarded": True}})


@app.post("/studio/modules/{module_id}/validate")
async def studio_validate_draft(module_id: str, include_normalized: bool = False) -> dict:
    draft = drafts.get_draft(module_id)
    if draft is None:
        return _error_response("DRAFT_NOT_FOUND", "Draft not found", "module_id", status=404)
    manifest = draft.get("manifest")
    normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id=module_id)
    data = {"errors": errors, "warnings": warnings}
    if include_normalized or DEV_MODE_ALLOW_OVERRIDE:
        data["normalized"] = normalized
    return _ok_response({"data": data})


@app.post("/studio/modules/{module_id}/preview")
async def studio_preview_draft(module_id: str, request: Request) -> dict:
    draft = drafts.get_draft(module_id)
    if draft is None:
        return _error_response("DRAFT_NOT_FOUND", "Draft not found", "module_id", status=404)
    manifest = draft.get("manifest")
    normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id=module_id)
    if errors:
        return _validation_response(errors, warnings, status=200)

    body = await _safe_json(request)
    mode = "upgrade" if registry.get(module_id) else "install"
    preview = _preview_module_change(
        request,
        module_id,
        normalized,
        body.get("reason", "studio"),
        body.get("patch_id", "studio-preview-1"),
        mode,
    )
    if isinstance(preview, dict) and preview.get("error"):
        return preview["error"]
    preview["validation"] = {"errors": errors, "warnings": warnings}
    return _ok_response({"data": preview})


@app.post("/studio/modules/{module_id}/apply")
async def studio_apply_draft(module_id: str, request: Request) -> dict:
    draft = drafts.get_draft(module_id)
    if draft is None:
        return _error_response("DRAFT_NOT_FOUND", "Draft not found", "module_id", status=404)
    manifest = draft.get("manifest")
    normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id=module_id)
    if errors:
        return _validation_response(errors, warnings, status=200)

    body = await _safe_json(request)
    mode = "upgrade" if registry.get(module_id) else "install"
    if not _begin_module_mutation(module_id):
        return _error_response("MODULE_MUTATION_IN_PROGRESS", "Module mutation in progress", "module_id", status=409)
    try:
        result = _apply_module_change(
            request,
            module_id,
            normalized,
            mode,
            body.get("reason", "studio"),
            body.get("patch_id", "studio-apply-1"),
        )
    finally:
        _end_module_mutation(module_id)
    if not result.get("ok"):
        return _error_response(result["errors"][0]["code"], result["errors"][0]["message"], result["errors"][0].get("path"), result["errors"][0].get("detail"))
    _cache_invalidate("modules")
    _cache_invalidate("registry_list")
    _cache_invalidate("manifest")
    _cache_invalidate("studio_modules")
    _compiled_cache_invalidate(module_id)
    return _ok_response({"data": {"mode": mode, "module": result["module"], "audit_id": result["audit_id"]}}, warnings=result.get("warnings"))


@app.post("/studio/modules/{module_id}/upgrade")
async def studio_upgrade_module(module_id: str, request: Request) -> dict:
    actor = getattr(request.state, "actor", None)
    denied = _require_admin(actor)
    if denied:
        return denied
    return await studio_apply_draft(module_id, request)


@app.post("/studio/modules/{module_id}/rollback")
async def studio_module_rollback(module_id: str, request: Request) -> dict:
    actor = getattr(request.state, "actor", None)
    denied = _require_admin(actor)
    if denied:
        return denied
    return await module_rollback(module_id, request)


@app.post("/studio/modules/{module_id}/delete")
async def studio_module_delete(module_id: str, request: Request, force: bool = False, archive: bool = False) -> dict:
    actor = getattr(request.state, "actor", None)
    denied = _require_admin(actor)
    if denied:
        return denied
    reason = "delete"
    if not _begin_module_mutation(module_id):
        return _error_response("MODULE_MUTATION_IN_PROGRESS", "Module mutation in progress", "module_id", status=409)
    try:
        if USE_DB:
            result = _delete_module_db(module_id, actor=actor, reason=reason, force=force, archive=archive)
        else:
            result = _delete_module_memory(module_id, actor=actor, reason=reason, force=force, archive=archive)
        if not result.get("ok"):
            return _error_response(result["errors"][0]["code"], result["errors"][0]["message"], result["errors"][0].get("path"), result["errors"][0].get("detail"))
        _cache_invalidate("modules")
        _cache_invalidate("registry_list")
        _cache_invalidate("manifest")
        _compiled_cache_invalidate(module_id)
        return _ok_response({"module": None, "audit_id": result.get("audit_id")})
    finally:
        _end_module_mutation(module_id)


@app.get("/studio2/registry")
async def studio2_registry(request: Request) -> dict:
    payload = _studio2_build_registry_snapshot(request)
    return _ok_response({"data": payload})


@app.get("/studio2/modules")
async def studio2_modules(request: Request) -> dict:
    payload = _studio2_list_modules(request)
    return _ok_response({"data": payload})


@app.post("/studio2/modules/create")
async def studio2_modules_create_v2(request: Request) -> dict:
    body = await _safe_json(request)
    module_name = body.get("module_name") if isinstance(body, dict) else None
    if not isinstance(module_name, str) or not module_name.strip():
        return _error_response("MODULE_NAME_REQUIRED", "module_name is required", "module_name")
    description = body.get("description") if isinstance(body, dict) else None
    module_id = _generate_module_id()
    if registry.get(module_id) is not None or drafts.get_draft(module_id) is not None:
        return _error_response("MODULE_ID_TAKEN", "module_id already exists", "module_id", status=409)
    manifest = _build_v1_empty_template(module_id, module_name.strip())
    module_section = manifest.get("module") if isinstance(manifest.get("module"), dict) else None
    if isinstance(module_section, dict) and isinstance(description, str):
        module_section["description"] = description.strip()
    updated_by = None
    if hasattr(request.state, "user"):
        actor = getattr(request.state, "actor", None)
        updated_by = (actor or {}).get("email") or (actor or {}).get("user_id")
    draft_version = drafts.create_draft_version(module_id, manifest, note="manual_create", created_by=updated_by)
    _cache_invalidate("studio_modules")
    return _ok_response({"data": {"module_id": module_id, "draft_version_id": draft_version.get("id")}})


@app.post("/studio2/modules")
async def studio2_modules_create(request: Request) -> dict:
    body = await _safe_json(request)
    module_id = body.get("module_id") if isinstance(body, dict) else None
    name = body.get("name") if isinstance(body, dict) else None
    seed = body.get("seed") if isinstance(body, dict) else None
    if module_id is None or (isinstance(module_id, str) and not module_id.strip()):
        module_id = _generate_module_id()
    if not isinstance(module_id, str) or not _is_valid_module_id(module_id):
        return _error_response("MODULE_ID_INVALID", "module_id is invalid", "module_id")
    if registry.get(module_id) is not None or drafts.get_draft(module_id) is not None:
        return _error_response("MODULE_ID_TAKEN", "module_id already exists", "module_id", status=409)
    module_name = name if isinstance(name, str) and name.strip() else None
    if seed is None or seed == "empty":
        manifest = _build_v1_empty_template(module_id, module_name)
    else:
        manifest = _build_v1_template_with_name(module_id, module_name)
    updated_by = None
    if hasattr(request.state, "user"):
        actor = getattr(request.state, "actor", None)
        updated_by = (actor or {}).get("email") or (actor or {}).get("user_id")
    draft_version = drafts.create_draft_version(module_id, manifest, note="seed", created_by=updated_by)
    _cache_invalidate("studio_modules")
    return _ok_response({"data": {"module_id": module_id, "draft_version_id": draft_version.get("id")}})


@app.get("/studio2/modules/{module_id}")
async def studio2_module_get(module_id: str, request: Request) -> dict:
    module = _get_module(request, module_id)
    draft = drafts.get_draft(module_id)
    if module is None and draft is None:
        return _error_response("MODULE_NOT_FOUND", "Module not found", "module_id", status=404)
    payload = {
        "module_id": module_id,
        "installed": module,
        "draft": draft,
    }
    return _ok_response({"data": payload})


@app.get("/studio2/modules/{module_id}/manifest")
async def studio2_get_manifest(module_id: str, request: Request) -> dict:
    module = _get_module(request, module_id)
    if module is None or not module.get("current_hash"):
        return _error_response("MODULE_NOT_INSTALLED", "Module not installed", "module_id", status=404)
    manifest_hash_value = module.get("current_hash")
    manifest = _get_snapshot(request, module_id, manifest_hash_value)
    return _ok_response({"data": {"module_id": module_id, "manifest_hash": manifest_hash_value, "manifest": manifest}})


@app.get("/studio2/modules/{module_id}/draft")
async def studio2_get_draft(module_id: str, request: Request) -> dict:
    draft = drafts.get_draft(module_id)
    if not draft:
        return _error_response("DRAFT_NOT_FOUND", "Draft not found", "module_id", status=404)
    versions = drafts.list_draft_versions(module_id)
    if not versions:
        actor = getattr(request.state, "actor", None)
        created_by = actor.get("email") if isinstance(actor, dict) else None
        seeded = drafts.create_draft_version(module_id, draft.get("manifest"), note="seed", created_by=created_by)
        version_id = seeded.get("id")
    else:
        version_id = versions[0].get("id")
    return _ok_response({"data": {"module_id": module_id, "draft_version_id": version_id, "manifest": draft.get("manifest")}})


@app.post("/studio2/modules/{module_id}/draft")
async def studio2_save_draft(module_id: str, request: Request) -> dict:
    body = await _safe_json(request)
    manifest = _parse_manifest_body(body) if isinstance(body, dict) else None
    if manifest is None:
        manifest = _parse_manifest_text(body)
    if not isinstance(manifest, dict):
        return _error_response("MANIFEST_INVALID", "manifest_json required", "manifest_json")
    note = body.get("note") if isinstance(body, dict) else None
    actor = getattr(request.state, "actor", None)
    created_by = actor.get("email") if isinstance(actor, dict) else None
    version = drafts.create_draft_version(module_id, manifest, note=note, created_by=created_by)
    _cache_invalidate("studio_modules")
    return _ok_response({"data": {"module_id": module_id, "draft_version_id": version.get("id")}})


@app.post("/studio2/modules/{module_id}/validate")
async def studio2_validate_draft(module_id: str, request: Request) -> dict:
    body = await _safe_json(request)
    manifest = _parse_manifest_body(body) if isinstance(body, dict) else None
    if manifest is None:
        manifest = _parse_manifest_text(body)
    if manifest is None:
        draft = drafts.get_draft(module_id)
        manifest = draft.get("manifest") if draft else None
    if not isinstance(manifest, dict):
        return _error_response("MANIFEST_INVALID", "manifest_json required", "manifest_json")
    manifest = _ensure_app_home(_ensure_module_id(_sanitize_manifest(manifest), module_id))
    normalize_cache = getattr(request.state, "studio2_norm_cache", None)
    if normalize_cache is None:
        normalize_cache = {}
        request.state.studio2_norm_cache = normalize_cache
    normalized, normalization_warnings = normalize_manifest_v13(manifest, module_id=module_id, cache=normalize_cache)
    normalized, errors, warnings = validate_manifest_raw(normalized, expected_module_id=module_id)
    lookup_errors = _studio2_validate_lookup_targets(
        normalized,
        _registry_for_request(request),
        lambda mod_id, manifest_hash: _get_snapshot(request, mod_id, manifest_hash),
    )
    if lookup_errors:
        errors = (errors or []) + lookup_errors
    strict_errors = _studio2_strict_validate(normalized, expected_module_id=module_id)
    if strict_errors:
        errors = (errors or []) + strict_errors
    completeness_errors = [] if errors else _studio2_completeness_check(normalized)
    design_warnings = _studio2_design_warnings(normalized)
    if normalization_warnings:
        warnings = (warnings or []) + normalization_warnings
    if warnings:
        warnings = [w for w in warnings if w.get("code") != "MANIFEST_LOOKUP_TARGET_EXTERNAL"]
    payload = {
        "errors": _normalize_validation_list(errors),
        "warnings": _normalize_validation_list(warnings),
        "strict_errors": _normalize_validation_list(strict_errors),
        "completeness_errors": _normalize_validation_list(completeness_errors),
        "design_warnings": _normalize_validation_list(design_warnings),
        "normalized": normalized if DEV_MODE_ALLOW_OVERRIDE else None,
    }
    return _ok_response({"data": payload})


@app.get("/studio2/modules/{module_id}/history")
async def studio2_module_history(module_id: str, request: Request) -> dict:
    module = _get_module(request, module_id)
    draft = drafts.get_draft(module_id)
    if module is None and draft is None:
        return _error_response("MODULE_NOT_FOUND", "Module not found", "module_id", status=404)
    audits = store.list_history(module_id)
    snapshots = []
    for entry in audits:
        to_hash = entry.get("to_hash")
        if not to_hash:
            continue
        snapshots.append(
            {
                "manifest_hash": to_hash,
                "created_at": entry.get("at"),
                "transaction_group_id": entry.get("transaction_group_id"),
                "action": entry.get("action"),
            }
        )
    draft_versions = drafts.list_draft_versions(module_id)
    draft_payload = [
        {
            "draft_version_id": v.get("id"),
            "created_at": v.get("created_at"),
            "note": v.get("note"),
            "created_by": v.get("created_by"),
            "parent_version_id": v.get("parent_version_id"),
            "ops_applied": v.get("ops_applied"),
            "validation_errors": v.get("validation_errors"),
        }
        for v in draft_versions
    ]
    return _ok_response({"data": {"module_id": module_id, "snapshots": snapshots, "draft_versions": draft_payload}})


@app.post("/studio2/modules/{module_id}/rollback")
async def studio2_module_rollback(module_id: str, request: Request) -> dict:
    actor = getattr(request.state, "actor", None)
    denied = _require_admin(actor)
    if denied:
        return denied
    body = await _safe_json(request)
    to_snapshot = body.get("to_snapshot_hash")
    to_tx = body.get("to_transaction_group_id")
    to_draft = body.get("to_draft_version_id")
    to_version_id = body.get("to_version_id") or body.get("version_id")
    to_version_num = body.get("to_version_num") or body.get("version_num")
    if to_draft:
        version = drafts.get_draft_version(module_id, to_draft)
        if not version:
            return _error_response("DRAFT_VERSION_NOT_FOUND", "Draft version not found", "to_draft_version_id", status=404)
        actor = getattr(request.state, "actor", None)
        created_by = actor.get("email") if isinstance(actor, dict) else None
        new_version = drafts.create_draft_version(module_id, version.get("manifest"), note="rollback", created_by=created_by)
        _cache_invalidate("studio_modules")
        return _ok_response({"data": {"module_id": module_id, "draft_version_id": new_version.get("id")}})

    if not to_snapshot and not to_tx and not to_version_id and to_version_num is None:
        return _error_response("ROLLBACK_INVALID", "to_snapshot_hash or to_transaction_group_id required", "to_snapshot_hash")
    if module_id in SYSTEM_MODULE_IDS:
        return _error_response("MODULE_ROLLBACK_FORBIDDEN", "System module cannot be rolled back", "module_id", status=403)
    module = _get_module(request, module_id)
    if module is None:
        return _error_response("MODULE_NOT_INSTALLED", "Module not installed", "module_id", status=404)
    if not _begin_module_mutation(module_id):
        return _error_response("MODULE_MUTATION_IN_PROGRESS", "Module mutation in progress", "module_id", status=409)
    try:
        target_hash = to_snapshot or ""
        if to_tx and not to_snapshot:
            audits = store.list_history(module_id)
            for entry in audits:
                if entry.get("transaction_group_id") == to_tx:
                    target_hash = entry.get("to_hash")
                    break
        if not target_hash and not to_version_id and to_version_num is None:
            return _error_response("ROLLBACK_INVALID", "transaction_group_id not found", "to_transaction_group_id", status=404)
        actor = getattr(request.state, "actor", None)
        result = registry.rollback(
            module_id,
            target_hash,
            actor=actor,
            reason=body.get("reason", "rollback"),
            to_version_id=to_version_id,
            to_version_num=to_version_num,
        )
        if not result.get("ok"):
            return _error_response(result["errors"][0]["code"], result["errors"][0]["message"], result["errors"][0].get("path"), result["errors"][0].get("detail"))
        _cache_invalidate("modules")
        _cache_invalidate("registry_list")
        _cache_invalidate("manifest")
        _compiled_cache_invalidate(module_id)
        return _ok_response({"data": {"module_id": module_id, "snapshot_hash": target_hash, "audit_id": result.get("audit_id")}})
    finally:
        _end_module_mutation(module_id)


@app.post("/studio2/modules/create")
async def studio2_create_module(request: Request) -> dict:
    body = await _safe_json(request)
    module_id = body.get("module_id") if isinstance(body, dict) else None
    name = body.get("name") if isinstance(body, dict) else None
    seed = body.get("seed") if isinstance(body, dict) else None
    if module_id is None or (isinstance(module_id, str) and not module_id.strip()):
        module_id = _generate_module_id()
    if not isinstance(module_id, str) or not _is_valid_module_id(module_id):
        return _error_response("MODULE_ID_INVALID", "module_id is invalid", "module_id")
    if registry.get(module_id) is not None or drafts.get_draft(module_id) is not None:
        return _error_response("MODULE_ID_TAKEN", "module_id already exists", "module_id", status=409)
    module_name = name if isinstance(name, str) and name.strip() else None
    if seed is None or seed == "empty":
        manifest = _build_v1_empty_template(module_id, module_name)
    else:
        manifest = _build_v1_template_with_name(module_id, module_name)
    updated_by = None
    if hasattr(request.state, "user"):
        actor = getattr(request.state, "actor", None)
        updated_by = (actor or {}).get("email") or (actor or {}).get("user_id")
    version = drafts.create_draft_version(module_id, manifest, note="seed", created_by=updated_by)
    _cache_invalidate("studio_modules")
    return _ok_response({"data": {"module_id": module_id, "draft_version_id": version.get("id")}})


@app.post("/studio2/modules/{module_id}/draft/delete")
async def studio2_delete_draft(module_id: str, request: Request) -> dict:
    if registry.get(module_id) is not None:
        return _error_response("MODULE_INSTALLED", "Module is installed; delete via /modules/{module_id}", "module_id", status=409)
    if drafts.get_draft(module_id) is None:
        return _error_response("DRAFT_NOT_FOUND", "Draft not found", "module_id", status=404)
    drafts.delete_draft(module_id)
    _cache_invalidate("studio_modules")
    return _ok_response({"data": {"module_id": module_id, "deleted": True}})


@app.post("/studio2/manifest/validate")
async def studio2_validate_manifest(request: Request) -> dict:
    body = await _safe_json(request)
    module_id = body.get("module_id") if isinstance(body, dict) else None
    manifest = _parse_manifest_body(body) if isinstance(body, dict) else None
    if manifest is None and isinstance(body, dict) and isinstance(body.get("text"), str):
        try:
            manifest = json.loads(body.get("text"))
        except Exception:
            manifest = None
    if not isinstance(module_id, str):
        return _error_response("MODULE_ID_REQUIRED", "module_id required", "module_id")
    if not isinstance(manifest, dict):
        return _error_response("MANIFEST_INVALID", "manifest required", "manifest")
    normalize_cache = getattr(request.state, "studio2_norm_cache", None)
    if normalize_cache is None:
        normalize_cache = {}
        request.state.studio2_norm_cache = normalize_cache
    normalized, normalization_warnings = normalize_manifest_v13(manifest, module_id=module_id, cache=normalize_cache)
    normalized, errors, warnings = validate_manifest_raw(normalized, expected_module_id=module_id)
    strict_errors = _studio2_strict_validate(normalized, expected_module_id=module_id)
    if strict_errors:
        errors = (errors or []) + strict_errors
    completeness_errors = [] if errors else _studio2_completeness_check(normalized)
    design_warnings = _studio2_design_warnings(normalized)
    if normalization_warnings:
        warnings = (warnings or []) + normalization_warnings
    return _ok_response(
        {
            "data": {
                "errors": _normalize_validation_list(errors),
                "warnings": _normalize_validation_list(warnings),
                "strict_errors": _normalize_validation_list(strict_errors),
                "completeness_errors": _normalize_validation_list(completeness_errors),
                "design_warnings": _normalize_validation_list(design_warnings),
                "normalized": normalized if DEV_MODE_ALLOW_OVERRIDE else None,
            }
        }
    )


@app.post("/studio2/modules/{module_id}/install")
async def studio2_install_manifest(module_id: str, request: Request) -> dict:
    actor = getattr(request.state, "actor", None)
    denied = _require_admin(actor)
    if denied:
        return denied
    if module_id in SYSTEM_MODULE_IDS:
        return _error_response("MODULE_APPLY_FORBIDDEN", "System module cannot be modified", "module_id", status=403)
    body = await _safe_json(request)
    manifest = _parse_manifest_body(body) if isinstance(body, dict) else None
    if manifest is None:
        manifest = _parse_manifest_text(body)
    if manifest is None:
        draft = drafts.get_draft(module_id)
        manifest = draft.get("manifest") if draft else None
    if not isinstance(manifest, dict):
        return _error_response("MANIFEST_INVALID", "manifest required", "manifest")
    manifest = _ensure_app_home(_ensure_module_id(_sanitize_manifest(manifest), module_id))
    normalize_cache = getattr(request.state, "studio2_norm_cache", None)
    if normalize_cache is None:
        normalize_cache = {}
        request.state.studio2_norm_cache = normalize_cache
    normalized, normalization_warnings = normalize_manifest_v13(manifest, module_id=module_id, cache=normalize_cache)
    normalized, errors, warnings = validate_manifest_raw(normalized, expected_module_id=module_id)
    strict_errors = _studio2_strict_validate(normalized, expected_module_id=module_id)
    if strict_errors:
        errors = (errors or []) + strict_errors
    if errors:
        if normalization_warnings:
            warnings = (warnings or []) + normalization_warnings
        return _validation_response(errors, warnings)
    completeness_errors = _studio2_completeness_check(normalized)
    if completeness_errors:
        if normalization_warnings:
            warnings = (warnings or []) + normalization_warnings
        return _validation_response(completeness_errors, warnings)

    module = _get_module(request, module_id)
    if module and module.get("current_hash"):
        base_hash = module.get("current_hash")
        base_manifest = _get_snapshot(request, module_id, base_hash)
        mode = "upgrade"
    else:
        base_hash = store.get_head(module_id)
        if not base_hash:
            base_hash = store.init_module(module_id, {}, actor=actor, reason="studio2_base")
        base_manifest = store.get_snapshot(module_id, base_hash)
        mode = "install"

    patchset = _studio2_build_patchset_from_manifest(module_id, base_manifest, normalized)
    applied = _studio2_apply_patchset(base_manifest, patchset)
    if not applied.get("ok"):
        return _validation_response(applied.get("errors", []), applied.get("warnings", []), status=200)
    normalized_after, val_errors, val_warnings = validate_manifest_raw(applied.get("manifest"), expected_module_id=module_id)
    strict_errors = _studio2_strict_validate(normalized_after, expected_module_id=module_id)
    if strict_errors:
        val_errors = (val_errors or []) + strict_errors
    if val_errors:
        return _validation_response(val_errors, val_warnings, status=200)

    transaction_group_id = f"tg_{uuid.uuid4().hex}"
    patch_payload = {
        "patch_id": patchset.get("patchset_id") or f"ps_{uuid.uuid4().hex}",
        "transaction_group_id": transaction_group_id,
        "target_module_id": module_id,
        "target_manifest_hash": base_hash,
        "mode": "preview",
        "reason": body.get("reason", "studio2_install"),
        "operations": applied.get("resolved_ops", []),
    }
    preview_payload = {
        "ok": True,
        "errors": [],
        "warnings": [],
        "impact": None,
        "resolved_ops": applied.get("resolved_ops", []),
        "diff_summary": _studio2_diff_summary(applied.get("resolved_ops", [])),
    }
    approved = {
        "patch": patch_payload,
        "preview": preview_payload,
        "approved_by": actor,
        "approved_at": _now(),
    }
    result = registry.install(approved) if mode == "install" else registry.upgrade(approved)
    if not result.get("ok"):
        return _error_response(result["errors"][0]["code"], result["errors"][0]["message"], result["errors"][0].get("path"), result["errors"][0].get("detail"))
    # keep draft history; do not delete drafts on install
    _cache_invalidate("modules")
    _cache_invalidate("registry_list")
    _cache_invalidate("manifest")
    _cache_invalidate("studio_modules")
    _compiled_cache_invalidate(module_id)
    return _ok_response(
        {
            "data": {
                "module_id": module_id,
                "from_hash": base_hash,
                "to_hash": result.get("module", {}).get("current_hash"),
                "audit_id": result.get("audit_id"),
                "transaction_group_id": transaction_group_id,
            }
        },
        warnings=val_warnings,
    )


def _studio2_extract_patchset(body: dict) -> tuple[dict | None, list[dict]]:
    errors: list[dict] = []
    patchset = body.get("patchset") if isinstance(body, dict) else None
    if patchset is None and isinstance(body, dict):
        patchset = body
    if not isinstance(patchset, dict):
        return None, [{"code": "PATCHSET_INVALID", "message": "patchset must be object", "path": "patchset"}]
    patches = patchset.get("patches")
    if not isinstance(patches, list) or len(patches) == 0:
        errors.append({"code": "PATCHSET_INVALID", "message": "patches must be non-empty list", "path": "patchset.patches"})
        return patchset, errors
    if len(patches) != 1:
        errors.append({"code": "PATCHSET_MULTI_UNSUPPORTED", "message": "only single-module patchset supported", "path": "patchset.patches"})
    patch = patches[0] if patches else None
    module_id = patch.get("module_id") if isinstance(patch, dict) else None
    if not isinstance(module_id, str):
        errors.append({"code": "PATCHSET_INVALID", "message": "module_id required", "path": "patchset.patches[0].module_id"})
    ops = patch.get("ops") if isinstance(patch, dict) else None
    if not isinstance(ops, list):
        errors.append({"code": "PATCHSET_INVALID", "message": "ops must be list", "path": "patchset.patches[0].ops"})
    return patchset, errors


@app.post("/studio2/patchset/validate")
async def studio2_patchset_validate(request: Request) -> dict:
    body = await _safe_json(request)
    patchset, errors = _studio2_extract_patchset(body)
    if errors:
        return _validation_response(errors, [])
    patch = patchset["patches"][0]
    module_id = patch.get("module_id")
    module = _get_module(request, module_id)
    if module is None or not module.get("current_hash"):
        return _error_response("MODULE_NOT_INSTALLED", "Module not installed", "module_id", status=404)
    base_manifest = _get_snapshot(request, module_id, module.get("current_hash"))
    applied = _studio2_apply_patchset(base_manifest, patchset)
    if not applied.get("ok"):
        return _validation_response(applied.get("errors", []), applied.get("warnings", []), status=200)
    normalized, val_errors, val_warnings = validate_manifest_raw(applied.get("manifest"), expected_module_id=module_id)
    strict_errors = _studio2_strict_validate(normalized, expected_module_id=module_id)
    if strict_errors:
        val_errors = (val_errors or []) + strict_errors
    return _ok_response({"data": {"errors": val_errors, "warnings": val_warnings, "normalized": normalized if DEV_MODE_ALLOW_OVERRIDE else None}})


@app.post("/studio2/patchset/preview")
async def studio2_patchset_preview(request: Request) -> dict:
    body = await _safe_json(request)
    patchset, errors = _studio2_extract_patchset(body)
    if errors:
        return _validation_response(errors, [])
    patch = patchset["patches"][0]
    module_id = patch.get("module_id")
    module = _get_module(request, module_id)
    if module is None or not module.get("current_hash"):
        return _error_response("MODULE_NOT_INSTALLED", "Module not installed", "module_id", status=404)
    base_hash = module.get("current_hash")
    base_manifest = _get_snapshot(request, module_id, base_hash)
    applied = _studio2_apply_patchset(base_manifest, patchset)
    if not applied.get("ok"):
        return _validation_response(applied.get("errors", []), applied.get("warnings", []), status=200)
    normalized, val_errors, val_warnings = validate_manifest_raw(applied.get("manifest"), expected_module_id=module_id)
    strict_errors = _studio2_strict_validate(normalized, expected_module_id=module_id)
    if strict_errors:
        val_errors = (val_errors or []) + strict_errors
    if val_errors:
        return _validation_response(val_errors, val_warnings, status=200)
    proposed_hash = manifest_hash(normalized)
    summary = _studio2_diff_summary(applied.get("resolved_ops", []))
    payload = {
        "module_id": module_id,
        "from_hash": base_hash,
        "to_hash": proposed_hash,
        "summary": summary,
        "manifest": normalized,
        "validation": {"errors": val_errors, "warnings": val_warnings},
    }
    return _ok_response({"data": payload})


@app.post("/studio2/patchset/apply")
async def studio2_patchset_apply(request: Request) -> dict:
    body = await _safe_json(request)
    patchset, errors = _studio2_extract_patchset(body)
    if errors:
        return _validation_response(errors, [])
    patch = patchset["patches"][0]
    module_id = patch.get("module_id")
    if module_id in SYSTEM_MODULE_IDS:
        return _error_response("MODULE_APPLY_FORBIDDEN", "System module cannot be modified", "module_id", status=403)
    module = _get_module(request, module_id)
    if module is None or not module.get("current_hash"):
        return _error_response("MODULE_NOT_INSTALLED", "Module not installed", "module_id", status=404)
    if not _begin_module_mutation(module_id):
        return _error_response("MODULE_MUTATION_IN_PROGRESS", "Module mutation in progress", "module_id", status=409)
    try:
        base_hash = module.get("current_hash")
        base_manifest = _get_snapshot(request, module_id, base_hash)
        applied = _studio2_apply_patchset(base_manifest, patchset)
        if not applied.get("ok"):
            return _validation_response(applied.get("errors", []), applied.get("warnings", []), status=200)
        normalized, val_errors, val_warnings = validate_manifest_raw(applied.get("manifest"), expected_module_id=module_id)
        strict_errors = _studio2_strict_validate(normalized, expected_module_id=module_id)
        if strict_errors:
            val_errors = (val_errors or []) + strict_errors
        if val_errors:
            return _validation_response(val_errors, val_warnings, status=200)
        transaction_group_id = patchset.get("transaction_group_id") or f"tg_{uuid.uuid4().hex}"
        patch_payload = {
            "patch_id": patchset.get("patchset_id") or f"ps_{uuid.uuid4().hex}",
            "transaction_group_id": transaction_group_id,
            "target_module_id": module_id,
            "target_manifest_hash": base_hash,
            "mode": "preview",
            "reason": body.get("reason", "studio2"),
            "operations": applied.get("resolved_ops", []),
        }
        preview_payload = {
            "ok": True,
            "errors": [],
            "warnings": [],
            "impact": None,
            "resolved_ops": applied.get("resolved_ops", []),
            "diff_summary": _studio2_diff_summary(applied.get("resolved_ops", [])),
        }
        approved = {
            "patch": patch_payload,
            "preview": preview_payload,
            "approved_by": getattr(request.state, "user", None),
            "approved_at": _now(),
        }
        result = registry.upgrade(approved) if registry.get(module_id) else registry.install(approved)
        if not result.get("ok"):
            return _error_response(result["errors"][0]["code"], result["errors"][0]["message"], result["errors"][0].get("path"), result["errors"][0].get("detail"))
        _cache_invalidate("modules")
        _cache_invalidate("registry_list")
        _cache_invalidate("manifest")
        _compiled_cache_invalidate(module_id)
        return _ok_response(
            {
                "data": {
                    "module_id": module_id,
                    "from_hash": base_hash,
                    "to_hash": result.get("module", {}).get("current_hash"),
                    "audit_id": result.get("audit_id"),
                    "transaction_group_id": transaction_group_id,
                }
            },
            warnings=val_warnings,
        )
    finally:
        _end_module_mutation(module_id)


@app.post("/studio2/patchset/rollback")
async def studio2_patchset_rollback(request: Request) -> dict:
    actor = getattr(request.state, "actor", None)
    denied = _require_admin(actor)
    if denied:
        return denied
    body = await _safe_json(request)
    module_id = body.get("module_id")
    if not isinstance(module_id, str):
        return _error_response("MODULE_ID_REQUIRED", "module_id required", "module_id")
    if module_id in SYSTEM_MODULE_IDS:
        return _error_response("MODULE_ROLLBACK_FORBIDDEN", "System module cannot be rolled back", "module_id", status=403)
    snapshot_id = body.get("snapshot_id") or body.get("manifest_hash")
    transaction_group_id = body.get("transaction_group_id")
    if not snapshot_id and not transaction_group_id:
        return _error_response("ROLLBACK_INVALID", "snapshot_id or transaction_group_id required", "transaction_group_id")
    if not _begin_module_mutation(module_id):
        return _error_response("MODULE_MUTATION_IN_PROGRESS", "Module mutation in progress", "module_id", status=409)
    try:
        if transaction_group_id:
            target_hash = None
            if USE_DB:
                with get_conn() as conn:
                    row = fetch_one(
                        conn,
                        """
                        select audit
                        from module_audit
                        where org_id=%s and module_id=%s and audit->>'transaction_group_id'=%s
                        order by created_at desc
                        limit 1
                        """,
                        [get_org_id(), module_id, transaction_group_id],
                        query_name="module_audit.find_transaction_group",
                    )
                if row:
                    audit = row.get("audit")
                    if isinstance(audit, str):
                        try:
                            audit = json.loads(audit)
                        except Exception:
                            audit = None
                    if isinstance(audit, dict):
                        target_hash = audit.get("from_hash")
            else:
                history = registry.history(module_id)
                for audit in history:
                    if audit.get("transaction_group_id") == transaction_group_id:
                        target_hash = audit.get("from_hash")
                        break
            if not target_hash:
                return _error_response("ROLLBACK_GROUP_NOT_FOUND", "transaction_group_id not found", "transaction_group_id", status=404)
            snapshot_id = target_hash
        actor = getattr(request.state, "actor", None)
        result = registry.rollback(module_id, snapshot_id, actor=actor, reason=body.get("reason", "rollback"))
        if not result.get("ok"):
            return _error_response(result["errors"][0]["code"], result["errors"][0]["message"], result["errors"][0].get("path"), result["errors"][0].get("detail"))
        _cache_invalidate("modules")
        _cache_invalidate("registry_list")
        _cache_invalidate("manifest")
        _compiled_cache_invalidate(module_id)
        return _ok_response({"data": {"module": result.get("module"), "audit_id": result.get("audit_id")}}, warnings=result.get("warnings"))
    finally:
        _end_module_mutation(module_id)


@app.post("/studio2/json/fix")
async def studio2_json_fix(request: Request) -> dict:
    body = await _safe_json(request)
    text = body.get("text") if isinstance(body, dict) else None
    error = body.get("error") if isinstance(body, dict) else None
    if not isinstance(text, str):
        return _error_response("JSON_FIX_INVALID", "text required", "text")
    line = error.get("line") if isinstance(error, dict) else None
    col = error.get("col") if isinstance(error, dict) else None
    fixed, suggestions = _json_fix_attempt(text, line, col)
    return _ok_response({"data": {"fixed_text": fixed, "suggestions": suggestions}})


def _load_prompt_pack(name: str) -> str:
    path = ROOT / "app" / "ai" / "prompt_packs" / name
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


_PATTERN_CACHE: dict | None = None
_PATTERN_MTIME: float | None = None


def _load_pattern_memory() -> dict:
    global _PATTERN_CACHE, _PATTERN_MTIME
    path = ROOT / "app" / "ai" / "patterns.json"
    try:
        stat = path.stat()
        if _PATTERN_CACHE is not None and _PATTERN_MTIME == stat.st_mtime:
            return _PATTERN_CACHE
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
        if isinstance(data, dict):
            _PATTERN_CACHE = data
            _PATTERN_MTIME = stat.st_mtime
            return data
    except Exception:
        pass
    _PATTERN_CACHE = {"patterns": {}}
    return _PATTERN_CACHE


def _infer_pattern_key(message: str, module_id: str | None = None) -> str | None:
    text = (message or "").lower()
    if module_id:
        text = f"{text} {module_id.lower()}"
    if "contact" in text:
        return "contacts"
    if "crm" in text or "lead" in text or "opportunit" in text:
        return "crm"
    if "job" in text or "work order" in text:
        return "jobs"
    if "todo" in text or "task" in text:
        return "todo"
    if "inventory" in text or "stock" in text or "warehouse" in text:
        return "inventory"
    return None


def _openai_configured() -> bool:
    return bool(OPENAI_API_KEY)


def _openai_not_configured() -> JSONResponse:
    body = {
        "ok": False,
        "error": {"code": "OPENAI_NOT_CONFIGURED", "message": "OpenAI API key is not configured"},
        "errors": [{"code": "OPENAI_NOT_CONFIGURED", "message": "OpenAI API key is not configured", "path": None, "detail": None}],
        "warnings": [],
    }
    return JSONResponse(jsonable_encoder(body), status_code=501)


def _openai_url(path: str) -> str:
    base = OPENAI_BASE_URL.rstrip("/")
    if base.endswith("/v1"):
        return f"{base}{path}"
    return f"{base}/v1{path}"


def _openai_chat_completion(messages: list[dict], model: str | None = None) -> dict:
    payload = {
        "model": model or OPENAI_MODEL,
        "messages": messages,
        "temperature": 0.2,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        _openai_url("/chat/completions"),
        data=data,
        headers={
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=OPENAI_TIMEOUT) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            last_exc = exc
            if exc.code not in (429, 500, 502, 503, 504):
                raise
        except urllib.error.URLError as exc:
            last_exc = exc
        time.sleep(0.6 * (attempt + 1))
    if last_exc:
        raise last_exc
    raise RuntimeError("OpenAI request failed")


def _extract_first_json_block(text: str) -> tuple[dict | None, str | None]:
    if not isinstance(text, str):
        return None, "assistant_message_invalid"
    start = text.find("{")
    if start == -1:
        return None, "json_not_found"
    stack = 0
    for idx in range(start, len(text)):
        ch = text[idx]
        if ch == "{":
            stack += 1
        elif ch == "}":
            stack -= 1
            if stack == 0:
                candidate = text[start : idx + 1]
                try:
                    return json.loads(candidate), None
                except Exception as exc:
                    return None, f"json_parse_error: {exc}"
    return None, "json_incomplete"


def _extract_patchset_from_response(text: str) -> tuple[dict | None, dict | None]:
    marker = "PATCHSET_JSON:"
    idx = text.find(marker) if isinstance(text, str) else -1
    if idx == -1:
        return None, {"parse_error": "PATCHSET_JSON marker not found", "raw_patchset_text": None}
    tail = text[idx + len(marker) :].strip()
    if not tail:
        return None, {"parse_error": "PATCHSET_JSON empty", "raw_patchset_text": ""}
    start = tail.find("{")
    if start == -1:
        return None, {"parse_error": "PATCHSET_JSON missing object", "raw_patchset_text": tail}
    patchset, error = _extract_first_json_block(tail[start:])
    if error:
        return None, {"parse_error": error, "raw_patchset_text": tail[start:]}
    return patchset, None


def _extract_manifest_from_response(text: str) -> tuple[dict | None, dict | None]:
    marker = "UPDATED_MANIFEST_JSON:"
    idx = text.find(marker) if isinstance(text, str) else -1
    if idx == -1:
        manifest, error = _extract_first_json_block(text)
        if manifest and isinstance(manifest, dict) and "module" in manifest and "manifest_version" in manifest:
            return manifest, None
        return None, {"parse_error": "UPDATED_MANIFEST_JSON marker not found", "raw_manifest_text": None}
    tail = text[idx + len(marker) :].strip()
    if not tail:
        return None, {"parse_error": "UPDATED_MANIFEST_JSON empty", "raw_manifest_text": ""}
    start = tail.find("{")
    if start == -1:
        return None, {"parse_error": "UPDATED_MANIFEST_JSON missing object", "raw_manifest_text": tail}
    manifest, error = _extract_first_json_block(tail[start:])
    if error:
        return None, {"parse_error": error, "raw_manifest_text": tail[start:]}
    return manifest, None


def _extract_patch_ops_from_response(text: str) -> tuple[dict | None, dict | None]:
    if not isinstance(text, str):
        return None, {"parse_error": "assistant_message_invalid", "raw_ops_text": None}
    stripped = text.strip()
    if stripped.startswith("{"):
        payload, err = _extract_first_json_block(stripped)
        if payload is not None:
            return payload, err
    payload, err = _extract_first_json_block(text)
    return payload, err


def _extract_build_spec_from_response(text: str) -> tuple[dict | None, dict | None]:
    if not isinstance(text, str):
        return None, {"parse_error": "assistant_message_invalid", "raw_spec_text": None}
    stripped = text.strip()
    if stripped.startswith("{"):
        payload, err = _extract_first_json_block(stripped)
        if payload is not None:
            return payload, err
    payload, err = _extract_first_json_block(text)
    return payload, err


def _get_by_json_pointer(doc, pointer: str):
    if not pointer or pointer == "/":
        return doc
    if not pointer.startswith("/"):
        return None
    tokens = pointer.split("/")[1:]
    current = doc
    for token in tokens:
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(current, list):
            try:
                idx = int(token)
            except Exception:
                return None
            if idx < 0 or idx >= len(current):
                return None
            current = current[idx]
        elif isinstance(current, dict):
            if token not in current:
                return None
            current = current[token]
        else:
            return None
    return current


def _pointer_parent(pointer: str | None) -> str | None:
    if not pointer or pointer == "/":
        return None
    parts = pointer.split("/")
    if len(parts) <= 2:
        return "/"
    return "/".join(parts[:-1])


def _extract_error_snippets(manifest: dict | None, errors: list[dict]) -> list[dict]:
    if not isinstance(manifest, dict):
        return []
    snippets: list[dict] = []
    seen: set[str] = set()
    for err in errors:
        pointer = err.get("json_pointer") or err.get("path")
        if not pointer:
            continue
        pointer = _path_to_json_pointer(pointer) or pointer
        if pointer in seen:
            continue
        seen.add(pointer)
        parent = _pointer_parent(pointer)
        target = _get_by_json_pointer(manifest, pointer)
        parent_val = _get_by_json_pointer(manifest, parent) if parent else None
        snippets.append(
            {
                "pointer": pointer,
                "parent_pointer": parent,
                "parent": parent_val,
                "value": target,
            }
        )
    return snippets


def _studio2_registry_header(registry_summary: dict | None) -> dict:
    if not isinstance(registry_summary, dict):
        return {"modules": []}
    modules = registry_summary.get("modules") or []
    header = []
    for mod in modules:
        if not isinstance(mod, dict):
            continue
        header.append({"module_id": mod.get("module_id"), "name": mod.get("name")})
    return {"modules": header}


def _studio2_apply_ops(manifest: dict, ops: list[dict]) -> dict:
    if not isinstance(ops, list):
        return {"ok": False, "errors": [{"code": "OPS_INVALID", "message": "ops must be list", "path": "ops"}], "resolved_ops": [], "manifest": None}
    resolved_ops, errors = _studio2_resolve_ops(manifest, ops)
    if errors:
        return {"ok": False, "errors": errors, "resolved_ops": resolved_ops, "manifest": None}
    updated = json.loads(json.dumps(manifest))
    try:
        _apply_ops(updated, resolved_ops)
    except Exception as exc:
        return {"ok": False, "errors": [{"code": "PATCH_APPLY_FAILED", "message": str(exc), "path": "ops"}], "resolved_ops": resolved_ops, "manifest": None}
    return {"ok": True, "errors": [], "resolved_ops": resolved_ops, "manifest": updated}


def _studio2_guard_ops(module_id: str, ops: list[dict], is_new: bool) -> list[dict]:
    errors: list[dict] = []
    if not isinstance(ops, list):
        return [{"code": "OPS_INVALID", "message": "ops must be list", "path": "ops"}]
    if len(ops) > MAX_AGENT_OPS:
        return [{"code": "OPS_LIMIT", "message": f"ops exceeds limit {MAX_AGENT_OPS}", "path": "ops"}]
    for idx, op in enumerate(ops):
        path = op.get("path") if isinstance(op, dict) else None
        name = op.get("op") if isinstance(op, dict) else None
        if not isinstance(path, str):
            errors.append({"code": "OP_PATH_INVALID", "message": "path required", "path": f"ops[{idx}].path"})
            continue
        if not path.startswith("/"):
            errors.append({"code": "OP_PATH_INVALID", "message": "path must be JSON Pointer", "path": f"ops[{idx}].path"})
        if path.startswith("/manifest_version"):
            errors.append({"code": "OP_PATH_FORBIDDEN", "message": "manifest_version is protected", "path": f"ops[{idx}].path"})
        if path.startswith("/module/id") and not is_new:
            errors.append({"code": "OP_PATH_FORBIDDEN", "message": "module.id protected", "path": f"ops[{idx}].path"})
        if path.startswith(("/app", "/pages", "/views", "/actions", "/relations")):
            errors.append({"code": "OP_PATH_LOCKED", "message": "structure is locked; server manages app/pages/views/actions", "path": f"ops[{idx}].path"})
        if name == "remove" and path.startswith("/entities"):
            errors.append({"code": "OP_PATH_FORBIDDEN", "message": "removing entities is forbidden", "path": f"ops[{idx}].path"})
        if name not in {"add", "set", "remove", "rename_id"}:
            errors.append({"code": "OP_UNSUPPORTED", "message": f"unsupported op {name}", "path": f"ops[{idx}].op"})
    return errors


def _studio2_enforce_architecture(manifest: dict) -> dict:
    if not isinstance(manifest, dict):
        return manifest
    app = manifest.get("app") if isinstance(manifest.get("app"), dict) else {}
    entities = manifest.get("entities") if isinstance(manifest.get("entities"), list) else []
    manifest["entities"] = entities
    views = manifest.get("views") if isinstance(manifest.get("views"), list) else []
    pages = manifest.get("pages") if isinstance(manifest.get("pages"), list) else []
    actions = manifest.get("actions") if isinstance(manifest.get("actions"), list) else []

    view_by_id = {v.get("id"): v for v in views if isinstance(v, dict) and isinstance(v.get("id"), str)}
    page_by_id = {p.get("id"): p for p in pages if isinstance(p, dict) and isinstance(p.get("id"), str)}
    action_by_id = {a.get("id"): a for a in actions if isinstance(a, dict) and isinstance(a.get("id"), str)}

    nav_items = []
    defaults_entities = {}

    for entity in entities:
        if not isinstance(entity, dict):
            continue
        ent_id = entity.get("id")
        if not isinstance(ent_id, str) or not ent_id.startswith("entity."):
            continue
        slug = ent_id[7:]
        label = entity.get("label") or slug.replace("_", " ").title()
        fields = entity.get("fields") if isinstance(entity.get("fields"), list) else []
        field_ids = [f.get("id") for f in fields if isinstance(f, dict) and isinstance(f.get("id"), str)]
        display_field = entity.get("display_field")
        if not isinstance(display_field, str) or display_field not in field_ids:
            if field_ids:
                entity["display_field"] = field_ids[0]
                display_field = field_ids[0]

        list_view_id = f"{slug}.list"
        form_view_id = f"{slug}.form"
        list_page_id = f"{slug}.list_page"
        form_page_id = f"{slug}.form_page"
        if list_view_id not in view_by_id:
            view_by_id[list_view_id] = {
                "id": list_view_id,
                "kind": "list",
                "entity": ent_id,
                "columns": [{"label": label, "field_id": display_field}] if display_field else [],
                "open_record": {"to": f"page:{form_page_id}", "param": "record"},
            }
        else:
            existing_list = view_by_id[list_view_id]
            if isinstance(existing_list, dict):
                existing_list.setdefault("kind", "list")
                existing_list.setdefault("entity", ent_id)

        if form_view_id not in view_by_id:
            view_by_id[form_view_id] = {
                "id": form_view_id,
                "kind": "form",
                "entity": ent_id,
                "sections": [
                    {
                        "id": "main",
                        "title": "Details",
                        "fields": field_ids,
                        "layout": "columns",
                        "columns": 2,
                    }
                ],
            }
        else:
            existing_form = view_by_id[form_view_id]
            if isinstance(existing_form, dict):
                existing_form.setdefault("kind", "form")
                existing_form.setdefault("entity", ent_id)
                if not existing_form.get("sections"):
                    existing_form["sections"] = [
                        {"id": "main", "title": "Details", "fields": field_ids, "layout": "columns", "columns": 2}
                    ]

        if list_page_id not in page_by_id:
            page_by_id[list_page_id] = {
                "id": list_page_id,
                "title": label if isinstance(label, str) else slug.title(),
                "layout": "single",
                "content": [{"kind": "view", "target": f"view:{list_view_id}"}],
            }
        else:
            existing_page = page_by_id[list_page_id]
            if isinstance(existing_page, dict):
                existing_page.setdefault("layout", "single")
                content = existing_page.get("content") if isinstance(existing_page.get("content"), list) else []
                if content:
                    has_view = False
                    for node in content:
                        if isinstance(node, dict) and node.get("kind") == "view":
                            has_view = True
                    if not has_view:
                        content.append({"kind": "view", "target": f"view:{list_view_id}"})
                else:
                    content = [{"kind": "view", "target": f"view:{list_view_id}"}]
                existing_page["content"] = content

        if form_page_id not in page_by_id:
            page_by_id[form_page_id] = {
                "id": form_page_id,
                "title": label if isinstance(label, str) else slug.title(),
                "layout": "single",
                "content": [
                    {
                        "kind": "record",
                        "entity_id": ent_id,
                        "record_id_query": "record",
                        "content": [
                            {
                                "kind": "view",
                                "target": f"view:{form_view_id}",
                            }
                        ],
                    }
                ],
            }
        else:
            existing_page = page_by_id[form_page_id]
            if isinstance(existing_page, dict):
                existing_page.setdefault("layout", "single")
                content = existing_page.get("content") if isinstance(existing_page.get("content"), list) else []
                has_record = any(isinstance(node, dict) and node.get("kind") == "record" for node in content)
                if not has_record:
                    content.append(
                        {
                            "kind": "record",
                            "entity_id": ent_id,
                            "record_id_query": "record",
                            "content": [
                                {
                                    "kind": "view",
                                    "target": f"view:{form_view_id}",
                                }
                            ],
                        }
                    )
                existing_page["content"] = content

        nav_items.append({"label": label if isinstance(label, str) else slug.title(), "to": f"page:{list_page_id}"})
        defaults_entities[ent_id] = {"entity_form_page": f"page:{form_page_id}", "entity_home_page": f"page:{list_page_id}"}

    if nav_items:
        if not isinstance(app.get("nav"), list) or len(app.get("nav")) == 0:
            app["nav"] = [{"group": "Main", "items": []}]
        if isinstance(app.get("nav"), list):
            main_group = app["nav"][0] if app["nav"] else {"group": "Main", "items": []}
            items = main_group.get("items") if isinstance(main_group.get("items"), list) else []
            existing_targets = {item.get("to") for item in items if isinstance(item, dict)}
            for item in nav_items:
                if item.get("to") not in existing_targets:
                    items.append(item)
            main_group["items"] = items
            app["nav"][0] = main_group
        home_to = app.get("home")
        valid_home = isinstance(home_to, str) and home_to.startswith("page:")
        if not valid_home:
            home_to = nav_items[0].get("to")
            app["home"] = home_to
        defaults = app.get("defaults") if isinstance(app.get("defaults"), dict) else {}
        defaults_entities_existing = defaults.get("entities") if isinstance(defaults.get("entities"), dict) else {}
        defaults_entities_existing.update(defaults_entities)
        defaults["entities"] = defaults_entities_existing
        app["defaults"] = defaults

    manifest["app"] = app
    manifest["views"] = list(view_by_id.values())
    manifest["pages"] = list(page_by_id.values())
    manifest["actions"] = list(action_by_id.values())
    return manifest


def _studio2_tool_ensure_entity(manifest: dict, entity_id: str) -> dict:
    if not isinstance(manifest, dict):
        return manifest
    entities = manifest.get("entities") if isinstance(manifest.get("entities"), list) else []
    for entity in entities:
        if isinstance(entity, dict) and entity.get("id") == entity_id:
            return manifest
    if not entity_id.startswith("entity."):
        return manifest
    slug = entity_id[7:]
    label = slug.replace("_", " ").title() or "Entity"
    new_entity = {
        "id": entity_id,
        "label": label,
        "display_field": f"{slug}.name",
        "fields": [
            {"id": f"{slug}.id", "type": "uuid", "label": "ID", "readonly": True},
            {"id": f"{slug}.name", "type": "string", "label": "Name", "required": True},
        ],
    }
    entities.append(new_entity)
    manifest["entities"] = entities
    return manifest


def _studio2_tool_ensure_entity_def(manifest: dict, entity_def: dict) -> dict:
    if not isinstance(manifest, dict) or not isinstance(entity_def, dict):
        return manifest
    entity_id = entity_def.get("id")
    if not isinstance(entity_id, str):
        return manifest
    entities = manifest.get("entities") if isinstance(manifest.get("entities"), list) else []
    existing = None
    for entity in entities:
        if isinstance(entity, dict) and entity.get("id") == entity_id:
            existing = entity
            break
    if existing is None:
        entities.append(entity_def)
        manifest["entities"] = entities
        return manifest
    for key in ("label", "display_field"):
        if entity_def.get(key) is not None:
            existing[key] = entity_def.get(key)
    new_fields = entity_def.get("fields") if isinstance(entity_def.get("fields"), list) else []
    if new_fields:
        fields = existing.get("fields") if isinstance(existing.get("fields"), list) else []
        by_id = {f.get("id"): f for f in fields if isinstance(f, dict) and isinstance(f.get("id"), str)}
        for field in new_fields:
            if not isinstance(field, dict):
                continue
            fid = field.get("id")
            if not isinstance(fid, str):
                continue
            if fid in by_id:
                by_id[fid].update(field)
            else:
                fields.append(field)
        existing["fields"] = fields
    return manifest


def _studio2_normalize_lookup_targets(manifest: dict, collect_paths: bool = False):
    if not isinstance(manifest, dict):
        return (manifest, [], []) if collect_paths else manifest
    entities = manifest.get("entities") if isinstance(manifest.get("entities"), list) else []
    entity_ids = {e.get("id") for e in entities if isinstance(e, dict) and isinstance(e.get("id"), str)}
    slug_to_entity = {}
    for eid in entity_ids:
        if eid.startswith("entity."):
            slug_to_entity[eid[7:]] = eid
    paths_changed: list[str] = []
    warnings: list[dict] = []

    def _title_case(value: str) -> str:
        return value.replace("_", " ").replace("-", " ").strip().title()

    def _entity_slug(entity_id: str | None) -> str | None:
        if not isinstance(entity_id, str) or not entity_id:
            return None
        if entity_id.startswith("entity."):
            return entity_id[7:]
        return entity_id

    def normalize_target(raw: str | None) -> str | None:
        if not isinstance(raw, str) or not raw:
            return None
        if raw.startswith("entity."):
            return raw
        return f"entity.{raw}"

    def ensure_entity_for_lookup(target_entity: str, field: dict) -> None:
        slug = _entity_slug(target_entity)
        if not slug or target_entity in entity_ids:
            return
        display_field = field.get("display_field") if isinstance(field.get("display_field"), str) else None
        if not display_field or not display_field.startswith(f"{slug}."):
            display_field = f"{slug}.name"
        fields = [
            {"id": f"{slug}.id", "type": "uuid", "label": "ID", "readonly": True},
            {"id": f"{slug}.name", "type": "string", "label": "Name"},
        ]
        if display_field != f"{slug}.name":
            fields.append({"id": display_field, "type": "string", "label": _title_case(display_field.split(".")[-1])})
        entity_def = {
            "id": target_entity,
            "label": _title_case(slug),
            "display_field": display_field,
            "fields": fields,
        }
        _studio2_tool_ensure_entity_def(manifest, entity_def)
        entity_ids.add(target_entity)
        slug_to_entity[slug] = target_entity
        warnings.append(
            {
                "code": "LOOKUP_TARGET_AUTOCREATED",
                "message": "lookup target entity auto-created",
                "path": None,
                "detail": {"entity_id": target_entity, "display_field": display_field},
            }
        )

    for eidx, entity in enumerate(entities):
        if not isinstance(entity, dict):
            continue
        fields = entity.get("fields") if isinstance(entity.get("fields"), list) else []
        for fidx, field in enumerate(fields):
            if not isinstance(field, dict) or field.get("type") != "lookup":
                continue
            target_key = None
            for key in ("target", "target_entity_id", "entity", "entity_id", "target_entity"):
                if key in field:
                    target_key = key
                    break
            target_val = field.get(target_key) if target_key else None
            normalized = normalize_target(target_val)
            if normalized:
                key_name = target_key or "target"
                if field.get(key_name) != normalized:
                    field[key_name] = normalized
                    paths_changed.append(f"/entities/{eidx}/fields/{fidx}/{key_name}")
                # Only auto-create lookup targets when they already exist in this manifest.
                # This allows explicit external targets (e.g. entity.contact) without
                # forcing a stub entity that then fails completeness checks.
                if normalized in entity_ids:
                    ensure_entity_for_lookup(normalized, field)
                slug = _entity_slug(normalized)
                if slug:
                    display_field = field.get("display_field") if isinstance(field.get("display_field"), str) else None
                    if not display_field or not display_field.startswith(f"{slug}."):
                        field["display_field"] = f"{slug}.name"
                        paths_changed.append(f"/entities/{eidx}/fields/{fidx}/display_field")
                continue
            if not target_val:
                field_id = field.get("id")
                if isinstance(field_id, str) and "." in field_id:
                    suffix = field_id.split(".")[-1]
                    if suffix.endswith("_id"):
                        slug = suffix[:-3]
                        candidate = f"entity.{slug}"
                        if field.get("target") != candidate:
                            field["target"] = candidate
                            paths_changed.append(f"/entities/{eidx}/fields/{fidx}/target")
                        ensure_entity_for_lookup(candidate, field)
                        if not field.get("display_field"):
                            field["display_field"] = f"{slug}.name"
                            paths_changed.append(f"/entities/{eidx}/fields/{fidx}/display_field")
    manifest["entities"] = entities
    return (manifest, paths_changed, warnings) if collect_paths else manifest


def _studio2_validate_lookup_targets(manifest: dict, registry, get_snapshot) -> list[dict]:
    errors: list[dict] = []
    if not isinstance(manifest, dict):
        return errors
    entities = manifest.get("entities") if isinstance(manifest.get("entities"), list) else []
    entity_by_id = {
        e.get("id"): e
        for e in entities
        if isinstance(e, dict) and isinstance(e.get("id"), str)
    }

    def _field_ids(entity: dict) -> set[str]:
        fields = entity.get("fields") or []
        if isinstance(fields, dict):
            fields = [{"id": fid, **fdef} if isinstance(fdef, dict) else {"id": fid} for fid, fdef in fields.items()]
        return {f.get("id") for f in fields if isinstance(f, dict) and isinstance(f.get("id"), str)}

    def _normalize_target(raw: str | None) -> str | None:
        if not isinstance(raw, str) or not raw:
            return None
        return raw if raw.startswith("entity.") else f"entity.{raw}"

    for entity in entities:
        if not isinstance(entity, dict):
            continue
        fields = entity.get("fields") if isinstance(entity.get("fields"), list) else []
        for field in fields:
            if not isinstance(field, dict) or field.get("type") != "lookup":
                continue
            field_id = field.get("id")
            target = _normalize_target(field.get("entity"))
            display = field.get("display_field")
            if not isinstance(target, str) or not target:
                errors.append({"code": "LOOKUP_TARGET_MISSING", "message": "lookup target entity is required", "path": field_id, "detail": None})
                continue
            if not isinstance(display, str) or not display:
                errors.append({"code": "LOOKUP_DISPLAY_MISSING", "message": "lookup display_field is required", "path": field_id, "detail": None})
                continue
            target_entity = entity_by_id.get(target) or entity_by_id.get(target.replace("entity.", ""))
            if not target_entity:
                found = _find_entity_def_in_registry(registry, get_snapshot, target)
                if not found:
                    errors.append({"code": "LOOKUP_TARGET_UNKNOWN", "message": "lookup target entity not found or disabled", "path": field_id, "detail": None})
                    continue
                _, target_entity, _ = found
            target_field_ids = _field_ids(target_entity)
            if display not in target_field_ids:
                errors.append({"code": "LOOKUP_DISPLAY_UNKNOWN", "message": "lookup display_field not found on target entity", "path": field_id, "detail": None})
    return errors


def _studio2_normalize_workflows(manifest: dict, collect_paths: bool = False):
    if not isinstance(manifest, dict):
        return (manifest, [], [], set()) if collect_paths else manifest
    workflows = manifest.get("workflows")
    if not isinstance(workflows, list) or not workflows:
        return (manifest, [], [], set()) if collect_paths else manifest
    def _is_lifecycle_field(status_field: str) -> bool:
        return status_field.endswith(".status") or status_field.endswith(".state") or status_field.endswith(".stage")

    # group by entity for lifecycle enforcement
    workflows_by_entity: dict[str, list[dict]] = {}
    for workflow in workflows:
        if not isinstance(workflow, dict):
            continue
        entity_id = workflow.get("entity")
        status_field = workflow.get("status_field")
        if not isinstance(entity_id, str) or not isinstance(status_field, str):
            continue
        workflows_by_entity.setdefault(entity_id, []).append(workflow)

    normalized: list[dict] = []
    paths_changed: list[str] = []
    warnings: list[dict] = []
    seen_ids: set[str] = set()
    dropped_status_fields: set[str] = set()
    for entity_id, wf_list in workflows_by_entity.items():
        filtered: list[dict] = []
        dropped_non_lifecycle: list[dict] = []
        for wf in wf_list:
            status_field = wf.get("status_field")
            if not isinstance(status_field, str):
                continue
            if _is_lifecycle_field(status_field):
                filtered.append(wf)
            else:
                dropped_non_lifecycle.append(wf)
                dropped_status_fields.add(status_field)
        if dropped_non_lifecycle:
            for wf in dropped_non_lifecycle:
                warnings.append(
                    {
                        "code": "WORKFLOW_DROPPED_NON_LIFECYCLE",
                        "message": "workflow dropped for non-lifecycle field",
                        "path": "/workflows",
                        "detail": {
                            "entity_id": entity_id,
                            "status_field": wf.get("status_field"),
                            "reason": "status_field not lifecycle-like",
                        },
                    }
                )
        if not filtered:
            continue
        # pick preferred workflow
        preferred = None
        for wf in filtered:
            if isinstance(wf.get("status_field"), str) and _is_lifecycle_field(wf.get("status_field")):
                preferred = wf
                break
        if preferred is None:
            preferred = filtered[0]
        dropped_ids = [wf.get("id") for wf in filtered if wf is not preferred and isinstance(wf.get("id"), str)]
        if dropped_ids:
            warnings.append(
                {
                    "code": "WORKFLOW_DEDUPED_MULTI",
                    "message": "multiple workflows found for entity; kept one",
                    "path": "/workflows",
                    "detail": {
                        "entity_id": entity_id,
                        "kept_workflow_id": preferred.get("id"),
                        "dropped_ids": dropped_ids,
                    },
                }
            )

        wf = dict(preferred)
        status_field = wf.get("status_field")
        wf_id = wf.get("id")
        if not isinstance(wf_id, str) or not wf_id:
            suffix = entity_id.replace("entity.", "")
            wf_id = f"workflow.{suffix}"
            wf["id"] = wf_id
            paths_changed.append(f"/workflows/{len(normalized)}/id")
        # ensure unique workflow ids across entities
        if wf_id in seen_ids:
            idx = 2
            while f"{wf_id}_{idx}" in seen_ids:
                idx += 1
            wf["id"] = f"{wf_id}_{idx}"
            paths_changed.append(f"/workflows/{len(normalized)}/id")
            warnings.append(
                {
                    "code": "WORKFLOW_ID_RENAMED_DUPLICATE",
                    "message": "workflow id renamed to avoid duplicate",
                    "path": "/workflows",
                    "detail": {"old_id": wf_id, "new_id": wf["id"], "entity_id": entity_id},
                }
            )
        seen_ids.add(wf["id"])

        states = wf.get("states")
        if isinstance(states, list):
            normalized_states = []
            for state in states:
                if isinstance(state, str):
                    normalized_states.append({"id": state, "label": state.replace("_", " ").title()})
                elif isinstance(state, dict):
                    sid = state.get("id")
                    if not isinstance(sid, str) or not sid:
                        sid = state.get("key") or state.get("name")
                    if not isinstance(sid, str) or not sid:
                        continue
                    label = state.get("label") or sid.replace("_", " ").title()
                    normalized_states.append({**state, "id": sid, "label": label})
            if normalized_states:
                if wf.get("states") != normalized_states:
                    wf["states"] = normalized_states
                    paths_changed.append(f"/workflows/{len(normalized)}/states")
        normalized.append(wf)
    manifest["workflows"] = normalized
    if collect_paths:
        return manifest, paths_changed, warnings, dropped_status_fields
    return manifest


def _index_for_entity(entities: list, entity_id: str) -> int:
    for idx, entity in enumerate(entities):
        if isinstance(entity, dict) and entity.get("id") == entity_id:
            return idx
    return -1


def _studio2_normalize_enum_options(manifest: dict, collect_paths: bool = False):
    if not isinstance(manifest, dict):
        return (manifest, []) if collect_paths else manifest
    workflows = manifest.get("workflows")
    entities = manifest.get("entities") if isinstance(manifest.get("entities"), list) else []
    if not isinstance(workflows, list) or not workflows or not isinstance(entities, list):
        # still strip enum_values if present
        paths_changed: list[str] = []
        for eidx, entity in enumerate(entities):
            if not isinstance(entity, dict):
                continue
            fields = entity.get("fields") if isinstance(entity.get("fields"), list) else []
            for fidx, field in enumerate(fields):
                if not isinstance(field, dict):
                    continue
                if "enum_values" in field:
                    del field["enum_values"]
                    paths_changed.append(f"/entities/{eidx}/fields/{fidx}/enum_values")
                options = field.get("options") or field.get("values")
                if isinstance(options, list) and options and all(isinstance(opt, str) for opt in options):
                    field["options"] = [{"value": opt, "label": opt.replace("_", " ").title()} for opt in options]
                    paths_changed.append(f"/entities/{eidx}/fields/{fidx}/options")
        manifest["entities"] = entities
        return (manifest, paths_changed) if collect_paths else manifest
    entity_by_id = {e.get("id"): e for e in entities if isinstance(e, dict) and isinstance(e.get("id"), str)}
    paths_changed: list[str] = []
    for eidx, entity in enumerate(entities):
        if not isinstance(entity, dict):
            continue
        fields = entity.get("fields") if isinstance(entity.get("fields"), list) else []
        for fidx, field in enumerate(fields):
            if not isinstance(field, dict):
                continue
            if "enum_values" in field:
                del field["enum_values"]
                paths_changed.append(f"/entities/{eidx}/fields/{fidx}/enum_values")
            options = field.get("options") or field.get("values")
            if isinstance(options, list) and options and all(isinstance(opt, str) for opt in options):
                field["options"] = [{"value": opt, "label": opt.replace("_", " ").title()} for opt in options]
                paths_changed.append(f"/entities/{eidx}/fields/{fidx}/options")

    for workflow in workflows:
        if not isinstance(workflow, dict):
            continue
        entity_id = workflow.get("entity")
        status_field = workflow.get("status_field")
        if not isinstance(entity_id, str) or not isinstance(status_field, str):
            continue
        entity = entity_by_id.get(entity_id)
        if not isinstance(entity, dict):
            continue
        fields = entity.get("fields") if isinstance(entity.get("fields"), list) else []
        for fidx, field in enumerate(fields):
            if not isinstance(field, dict):
                continue
            if field.get("id") != status_field or field.get("type") != "enum":
                continue
            options = field.get("options") or field.get("values")
            if isinstance(options, list) and options:
                # normalize string options to object shape
                if all(isinstance(opt, str) for opt in options):
                    field["options"] = [{"value": opt, "label": opt.replace("_", " ").title()} for opt in options]
                    ent_idx = _index_for_entity(entities, entity_id)
                    if ent_idx >= 0:
                        paths_changed.append(f"/entities/{ent_idx}/fields/{fidx}/options")
                break
            states = workflow.get("states")
            if not isinstance(states, list) or not states:
                break
            values = [state.get("id") for state in states if isinstance(state, dict) and isinstance(state.get("id"), str)]
            if values:
                field["options"] = [{"value": value, "label": value.replace("_", " ").title()} for value in values]
                ent_idx = _index_for_entity(entities, entity_id)
                if ent_idx >= 0:
                    paths_changed.append(f"/entities/{ent_idx}/fields/{fidx}/options")
            break
    manifest["entities"] = entities
    return (manifest, paths_changed) if collect_paths else manifest


def _studio2_normalize_relations(manifest: dict, collect_paths: bool = False):
    if not isinstance(manifest, dict):
        return (manifest, [], []) if collect_paths else manifest
    relations = manifest.get("relations") if isinstance(manifest.get("relations"), list) else []
    paths_changed: list[str] = []
    warnings: list[dict] = []
    normalized_relations: list[dict] = []
    for ridx, rel in enumerate(relations):
        if not isinstance(rel, dict):
            warnings.append(
                {
                    "code": "NORMALIZED_RELATION_DROPPED",
                    "message": "relation dropped because it is not an object",
                    "path": f"/relations/{ridx}",
                    "detail": None,
                }
            )
            continue
        source = rel.get("from")
        target = rel.get("to")
        if not (isinstance(source, str) and source and isinstance(target, str) and target):
            from_field = rel.get("from_field")
            to_field = rel.get("to_field")
            if isinstance(from_field, str) and from_field and isinstance(to_field, str) and to_field:
                source = from_field
                target = to_field
                paths_changed.append(f"/relations/{ridx}")
            else:
                warnings.append(
                    {
                        "code": "NORMALIZED_RELATION_DROPPED",
                        "message": "relation dropped because from/to missing",
                        "path": f"/relations/{ridx}",
                        "detail": {"from": rel.get("from"), "to": rel.get("to")},
                    }
                )
                continue
        normalized = {"from": source, "to": target}
        label_field = rel.get("label_field")
        if isinstance(label_field, str) and label_field:
            normalized["label_field"] = label_field
        if not any(r.get("from") == source and r.get("to") == target for r in normalized_relations):
            normalized_relations.append(normalized)
    manifest["relations"] = normalized_relations
    return (manifest, paths_changed, warnings) if collect_paths else manifest


def _studio2_normalize_view_bodies(manifest: dict, collect_paths: bool = False):
    if not isinstance(manifest, dict):
        return (manifest, []) if collect_paths else manifest
    views = manifest.get("views") if isinstance(manifest.get("views"), list) else []
    pages = manifest.get("pages") if isinstance(manifest.get("pages"), list) else []
    entities = manifest.get("entities") if isinstance(manifest.get("entities"), list) else []
    entity_by_id = {e.get("id"): e for e in entities if isinstance(e, dict) and isinstance(e.get("id"), str)}
    paths_changed: list[str] = []

    def _title_case(value: str) -> str:
        return value.replace("_", " ").replace("-", " ").strip().title()

    def _useful_fields(entity: dict) -> list[dict]:
        fields = entity.get("fields") if isinstance(entity.get("fields"), list) else []
        useful: list[dict] = []
        for field in fields:
            if not isinstance(field, dict):
                continue
            fid = field.get("id")
            ftype = field.get("type")
            if not isinstance(fid, str):
                continue
            if ftype == "uuid" or fid.endswith(".id") or fid.endswith("_id"):
                continue
            useful.append(field)
        return useful

    def _select_best_fields(entity: dict, display_field: str | None, limit: int) -> list[str]:
        fields = _useful_fields(entity)
        order = {"string": 0, "text": 1, "enum": 2, "date": 3, "datetime": 4, "lookup": 5, "number": 6, "bool": 7}
        sorted_fields = sorted(
            fields,
            key=lambda f: (
                order.get(f.get("type"), 99),
                f.get("id") != display_field,
                f.get("id"),
            ),
        )
        result: list[str] = []
        for field in sorted_fields:
            fid = field.get("id")
            if not isinstance(fid, str):
                continue
            if fid == display_field:
                continue
            if fid not in result:
                result.append(fid)
            if len(result) >= limit:
                break
        return result

    def _string_fields(entity: dict, display_field: str | None, limit: int) -> list[str]:
        fields = entity.get("fields") if isinstance(entity.get("fields"), list) else []
        result: list[str] = []
        for field in fields:
            if not isinstance(field, dict):
                continue
            fid = field.get("id")
            if not isinstance(fid, str):
                continue
            if field.get("type") not in {"string", "text"}:
                continue
            if fid == display_field:
                continue
            if fid not in result:
                result.append(fid)
            if len(result) >= limit:
                break
        return result

    for vidx, view in enumerate(views):
        if not isinstance(view, dict):
            continue
        kind = view.get("kind") or view.get("type")
        entity_id = view.get("entity") or view.get("entity_id") or view.get("entityId")
        if not isinstance(kind, str) or not isinstance(entity_id, str):
            continue
        entity = entity_by_id.get(entity_id)
        if not isinstance(entity, dict):
            continue
        display_field = entity.get("display_field") if isinstance(entity.get("display_field"), str) else None
        fields = entity.get("fields") if isinstance(entity.get("fields"), list) else []
        field_by_id = {f.get("id"): f for f in fields if isinstance(f, dict) and isinstance(f.get("id"), str)}

        if kind == "list":
            columns = view.get("columns") if isinstance(view.get("columns"), list) else []
            col_fields = [c.get("field_id") for c in columns if isinstance(c, dict) and isinstance(c.get("field_id"), str)]
            if not columns:
                baseline = []
                if display_field:
                    baseline.append({"label": _title_case(display_field.split(".")[-1]), "field_id": display_field})
                for fid in _select_best_fields(entity, display_field, 3):
                    baseline.append({"label": _title_case(fid.split(".")[-1]), "field_id": fid})
                view["columns"] = baseline
                paths_changed.append(f"/views/{vidx}/columns")
            else:
                if display_field and display_field not in col_fields:
                    columns.insert(0, {"label": _title_case(display_field.split(".")[-1]), "field_id": display_field})
                    paths_changed.append(f"/views/{vidx}/columns")
                useful = _select_best_fields(entity, display_field, 3)
                if len(col_fields) < 2 or (len(col_fields) == 1 and col_fields[0] == display_field):
                    for fid in useful:
                        if fid not in col_fields:
                            columns.append({"label": _title_case(fid.split(".")[-1]), "field_id": fid})
                            col_fields.append(fid)
                            paths_changed.append(f"/views/{vidx}/columns")
                            if len(col_fields) >= 4:
                                break
                view["columns"] = columns

            header = view.get("header") if isinstance(view.get("header"), dict) else {}
            search = header.get("search") if isinstance(header.get("search"), dict) else {}
            search_fields = search.get("fields") if isinstance(search.get("fields"), list) else []
            updated_fields = [f for f in search_fields if isinstance(f, str)]
            if not updated_fields:
                if display_field:
                    updated_fields.append(display_field)
                updated_fields.extend(_string_fields(entity, display_field, 2))
                if updated_fields:
                    search["fields"] = updated_fields
                    header["search"] = search
                    view["header"] = header
                    paths_changed.append(f"/views/{vidx}/header/search/fields")
            elif display_field and display_field not in updated_fields:
                updated_fields.insert(0, display_field)
                search["fields"] = updated_fields
                header["search"] = search
                view["header"] = header
                paths_changed.append(f"/views/{vidx}/header/search/fields")

        if kind == "form":
            sections = view.get("sections") if isinstance(view.get("sections"), list) else []
            if not sections:
                sections = [{"id": "main", "title": "Details", "fields": []}]
                view["sections"] = sections
                paths_changed.append(f"/views/{vidx}/sections")
            primary = sections[0] if sections else {}
            if not isinstance(primary, dict):
                primary = {"id": "main", "title": "Details", "fields": []}
                sections[0] = primary
            section_fields = primary.get("fields") if isinstance(primary.get("fields"), list) else []
            section_fields = [f for f in section_fields if isinstance(f, str)]
            missing = []
            if display_field and display_field not in section_fields:
                missing.append(display_field)
            required_missing = []
            for fid, field in field_by_id.items():
                if not isinstance(field, dict):
                    continue
                if not field.get("required"):
                    continue
                if field.get("readonly") is True:
                    continue
                if field.get("default") is not None:
                    continue
                if fid not in section_fields and fid not in missing:
                    required_missing.append(fid)
            if missing or required_missing:
                section_fields.extend(missing + required_missing)
                primary["fields"] = section_fields
                paths_changed.append(f"/views/{vidx}/sections/0/fields")
            if len(section_fields) < 4:
                for field in _select_best_fields(entity, display_field, 12):
                    if field not in section_fields:
                        section_fields.append(field)
                        if len(section_fields) >= 12:
                            break
                primary["fields"] = section_fields
                paths_changed.append(f"/views/{vidx}/sections/0/fields")
            if len(section_fields) > 4:
                if "layout" not in primary:
                    primary["layout"] = "columns"
                    paths_changed.append(f"/views/{vidx}/sections/0/layout")
                if primary.get("layout") == "columns" and "columns" not in primary:
                    primary["columns"] = 2
                    paths_changed.append(f"/views/{vidx}/sections/0/columns")

    for pidx, page in enumerate(pages):
        if not isinstance(page, dict):
            continue
        header = page.get("header") if isinstance(page.get("header"), dict) else {}
        if "variant" not in header:
            header["variant"] = "none"
            page["header"] = header
            paths_changed.append(f"/pages/{pidx}/header/variant")

    manifest["views"] = views
    manifest["pages"] = pages
    return (manifest, paths_changed) if collect_paths else manifest


def _studio2_normalize_system_id_fields(manifest: dict, collect_paths: bool = False):
    if not isinstance(manifest, dict):
        return (manifest, []) if collect_paths else manifest
    entities = manifest.get("entities") if isinstance(manifest.get("entities"), list) else []
    paths_changed: list[str] = []
    for eidx, entity in enumerate(entities):
        if not isinstance(entity, dict):
            continue
        fields = entity.get("fields") if isinstance(entity.get("fields"), list) else []
        for fidx, field in enumerate(fields):
            if not isinstance(field, dict):
                continue
            fid = field.get("id")
            ftype = field.get("type")
            if not isinstance(fid, str) or ftype != "uuid" or not fid.endswith(".id"):
                continue
            changed = False
            if field.get("required") is True:
                field["required"] = False
                changed = True
            if field.get("readonly") is not True:
                field["readonly"] = True
                changed = True
            if changed:
                paths_changed.append(f"/entities/{eidx}/fields/{fidx}")
    return (manifest, paths_changed) if collect_paths else manifest


def _studio2_normalize_status_actions(manifest: dict, collect_paths: bool = False):
    if not isinstance(manifest, dict):
        return (manifest, []) if collect_paths else manifest
    before = manifest_hash(manifest)
    _studio2_tool_ensure_status_actions(manifest)
    after = manifest_hash(manifest)
    if collect_paths and before != after:
        return manifest, ["/actions"]
    return (manifest, []) if collect_paths else manifest


def _studio2_action_label_from_target(target: str | None, page_by_id: dict, view_by_id: dict) -> str | None:
    if not isinstance(target, str) or not target:
        return None
    if target.startswith("page:"):
        page_id = target.split("page:", 1)[1]
        page = page_by_id.get(page_id)
        title = page.get("title") if isinstance(page, dict) else None
        return title if isinstance(title, str) and title.strip() else None
    if target.startswith("view:"):
        view_id = target.split("view:", 1)[1]
        view = view_by_id.get(view_id)
        title = view.get("title") if isinstance(view, dict) else None
        return title if isinstance(title, str) and title.strip() else None
    if target in page_by_id:
        page = page_by_id.get(target)
        title = page.get("title") if isinstance(page, dict) else None
        return title if isinstance(title, str) and title.strip() else None
    if target in view_by_id:
        view = view_by_id.get(target)
        title = view.get("title") if isinstance(view, dict) else None
        return title if isinstance(title, str) and title.strip() else None
    return None


def _studio2_action_default_label(action: dict, page_by_id: dict, view_by_id: dict) -> str | None:
    if not isinstance(action, dict):
        return None
    kind = action.get("kind")
    if kind == "create_record":
        return "New"
    if kind == "update_record":
        return "Save"
    if kind == "refresh":
        return "Refresh"
    if kind == "open_form":
        return "New"
    if kind == "navigate":
        return _studio2_action_label_from_target(action.get("target"), page_by_id, view_by_id)
    return None


def _studio2_normalize_view_headers(
    manifest: dict,
    collect_paths: bool = False,
    dropped_status_fields: set[str] | None = None,
):
    if not isinstance(manifest, dict):
        return (manifest, []) if collect_paths else manifest
    views = manifest.get("views") if isinstance(manifest.get("views"), list) else []
    entities = manifest.get("entities") if isinstance(manifest.get("entities"), list) else []
    actions = manifest.get("actions") if isinstance(manifest.get("actions"), list) else []
    workflows = manifest.get("workflows") if isinstance(manifest.get("workflows"), list) else []
    pages = manifest.get("pages") if isinstance(manifest.get("pages"), list) else []

    entity_by_id = {e.get("id"): e for e in entities if isinstance(e, dict) and isinstance(e.get("id"), str)}
    action_by_id = {a.get("id"): a for a in actions if isinstance(a, dict) and isinstance(a.get("id"), str)}
    page_by_id = {p.get("id"): p for p in pages if isinstance(p, dict) and isinstance(p.get("id"), str)}
    view_by_id = {v.get("id"): v for v in views if isinstance(v, dict) and isinstance(v.get("id"), str)}
    workflow_by_entity = {}
    for wf in workflows:
        if isinstance(wf, dict) and isinstance(wf.get("entity"), str) and isinstance(wf.get("status_field"), str):
            workflow_by_entity.setdefault(wf.get("entity"), wf)

    def _title_case(value: str) -> str:
        return value.replace("_", " ").title()

    paths_changed: list[str] = []
    warnings: list[dict] = []
    dropped_status_fields = dropped_status_fields or set()

    for action in actions:
        if not isinstance(action, dict):
            continue
        if action.get("label"):
            continue
        label = _studio2_action_default_label(action, page_by_id, view_by_id)
        if label:
            action["label"] = label
            paths_changed.append("/actions")

    for vidx, view in enumerate(views):
        if not isinstance(view, dict):
            continue
        kind = view.get("kind") or view.get("type")
        entity_id = view.get("entity") or view.get("entity_id") or view.get("entityId")
        if not isinstance(kind, str) or not isinstance(entity_id, str):
            continue
        entity = entity_by_id.get(entity_id)
        if not isinstance(entity, dict):
            continue
        header = view.get("header")
        if header is None:
            header = {}
            view["header"] = header
            paths_changed.append(f"/views/{vidx}/header")
        if not isinstance(header, dict):
            continue

        display_field = entity.get("display_field")
        fields = entity.get("fields") if isinstance(entity.get("fields"), list) else []
        field_ids = [f.get("id") for f in fields if isinstance(f, dict) and isinstance(f.get("id"), str)]
        if not isinstance(display_field, str) or display_field not in field_ids:
            display_field = field_ids[0] if field_ids else None

        if kind == "list":
            required_fields = []
            for field in fields:
                if not isinstance(field, dict):
                    continue
                fid = field.get("id")
                if not isinstance(fid, str):
                    continue
                if not field.get("required"):
                    continue
                if field.get("readonly") is True:
                    continue
                if field.get("default") is not None:
                    continue
                required_fields.append(fid)

            create_behavior = view.get("create_behavior")
            if create_behavior is None:
                view["create_behavior"] = "open_form"
                create_behavior = "open_form"
                paths_changed.append(f"/views/{vidx}/create_behavior")

            search = header.get("search")
            if not isinstance(search, dict):
                search = {}
                header["search"] = search
                paths_changed.append(f"/views/{vidx}/header/search")
            if "enabled" not in search:
                search["enabled"] = True
                paths_changed.append(f"/views/{vidx}/header/search/enabled")
            if "placeholder" not in search:
                search["placeholder"] = "Search..."
                paths_changed.append(f"/views/{vidx}/header/search/placeholder")
            if "fields" not in search or not isinstance(search.get("fields"), list) or len(search.get("fields")) == 0:
                if display_field:
                    search["fields"] = [display_field]
                    paths_changed.append(f"/views/{vidx}/header/search/fields")

            primary_actions = header.get("primary_actions")
            if not isinstance(primary_actions, list) or len(primary_actions) == 0:
                slug = entity_id.replace("entity.", "")
                action_id = f"action.{slug}_new"
                if action_id not in action_by_id:
                    form_view_id = None
                    for v in views:
                        if not isinstance(v, dict):
                            continue
                        if v.get("kind") == "form" and v.get("entity") == entity_id:
                            form_view_id = v.get("id")
                            break
                    can_instant_create = len(required_fields) == 0
                    if create_behavior == "create_record" and can_instant_create:
                        action = {"id": action_id, "kind": "create_record", "entity_id": entity_id, "label": "New"}
                    elif form_view_id:
                        action = {"id": action_id, "kind": "open_form", "target": form_view_id, "label": "New"}
                    else:
                        action = {"id": action_id, "kind": "create_record", "entity_id": entity_id, "label": "New"}
                    actions.append(action)
                    action_by_id[action_id] = action
                    paths_changed.append("/actions")
                header["primary_actions"] = [{"action_id": action_id}]
                paths_changed.append(f"/views/{vidx}/header/primary_actions")
            if isinstance(primary_actions, list):
                form_view_id = None
                for v in views:
                    if not isinstance(v, dict):
                        continue
                    if v.get("kind") == "form" and v.get("entity") == entity_id:
                        form_view_id = v.get("id")
                        break
                for action_ref in primary_actions:
                    if not isinstance(action_ref, dict):
                        continue
                    action_id = action_ref.get("action_id")
                    if not isinstance(action_id, str):
                        continue
                    action = action_by_id.get(action_id)
                    if not isinstance(action, dict):
                        continue
                    if action.get("kind") != "create_record":
                        continue
                    if action.get("entity_id") != entity_id:
                        continue
                    if create_behavior == "open_form" and form_view_id:
                        action["kind"] = "open_form"
                        action["target"] = form_view_id
                        action.pop("entity_id", None)
                        paths_changed.append("/actions")
                        continue
                    defaults = action.get("defaults") if isinstance(action.get("defaults"), dict) else {}
                    if required_fields:
                        if not set(required_fields).issubset(defaults.keys()):
                            if form_view_id:
                                action["kind"] = "open_form"
                                action["target"] = form_view_id
                                action.pop("entity_id", None)
                                paths_changed.append("/actions")
                    elif form_view_id and action.get("defaults") is None and action.get("patch") is None:
                        action["kind"] = "open_form"
                        action["target"] = form_view_id
                        action.pop("entity_id", None)
                        paths_changed.append("/actions")

        if kind == "form":
            if "title_field" not in header and display_field:
                header["title_field"] = display_field
                paths_changed.append(f"/views/{vidx}/header/title_field")
            if "auto_save" not in header:
                header["auto_save"] = True
                paths_changed.append(f"/views/{vidx}/header/auto_save")
            if "auto_save_debounce_ms" not in header:
                header["auto_save_debounce_ms"] = 750
                paths_changed.append(f"/views/{vidx}/header/auto_save_debounce_ms")
            if "save_mode" not in header:
                header["save_mode"] = "top"
                paths_changed.append(f"/views/{vidx}/header/save_mode")

            statusbar = header.get("statusbar")
            if isinstance(statusbar, dict) and isinstance(statusbar.get("field_id"), str):
                field_id = statusbar.get("field_id")
                wf_count = sum(1 for w in workflows if isinstance(w, dict) and w.get("entity") == entity_id)
                field_def = next((f for f in fields if isinstance(f, dict) and f.get("id") == field_id), None)
                field_is_enum = field_def.get("type") == "enum" if isinstance(field_def, dict) else False
                if wf_count != 1 or field_id in dropped_status_fields or not field_is_enum:
                    header.pop("statusbar", None)
                    paths_changed.append(f"/views/{vidx}/header/statusbar")
                    warnings.append(
                        {
                            "code": "STATUSBAR_REMOVED_NO_WORKFLOW",
                            "message": "statusbar removed due to missing single lifecycle workflow",
                            "path": f"/views/{vidx}/header/statusbar",
                            "detail": {"view_id": view.get("id"), "field_id": field_id},
                        }
                    )
            if "statusbar" not in header:
                wf = workflow_by_entity.get(entity_id)
                wf_count = sum(1 for w in workflows if isinstance(w, dict) and w.get("entity") == entity_id)
                if wf and wf_count == 1:
                    status_field = wf.get("status_field")
                    field_def = next((f for f in fields if isinstance(f, dict) and f.get("id") == status_field), None)
                    if isinstance(status_field, str) and field_def and field_def.get("type") == "enum":
                        header["statusbar"] = {"field_id": status_field}
                        paths_changed.append(f"/views/{vidx}/header/statusbar")
                elif wf_count > 1:
                    warnings.append(
                        {
                            "code": "STATUSBAR_SKIPPED_NO_SINGLE_WORKFLOW",
                            "message": "statusbar not added because workflow count is not 1",
                            "path": f"/views/{vidx}/header",
                            "detail": {"entity_id": entity_id, "workflow_count": wf_count},
                        }
                    )

            sections = view.get("sections") if isinstance(view.get("sections"), list) else []
            if "tabs" not in header and len(sections) > 1:
                tabs_list = []
                for section in sections:
                    if not isinstance(section, dict):
                        continue
                    sid = section.get("id")
                    if not isinstance(sid, str) or not sid:
                        continue
                    label = section.get("title") if isinstance(section.get("title"), str) else _title_case(sid)
                    tabs_list.append({"id": sid, "label": label, "sections": [sid]})
                if tabs_list:
                    header["tabs"] = {"style": "lifted", "default_tab": tabs_list[0]["id"], "tabs": tabs_list}
                    paths_changed.append(f"/views/{vidx}/header/tabs")

    manifest["views"] = views
    manifest["actions"] = actions
    if collect_paths:
        return manifest, paths_changed, warnings
    return manifest


def normalize_manifest_v13(manifest: dict, module_id: str | None = None, cache: dict | None = None):
    if not isinstance(manifest, dict):
        return manifest, []
    cache_key = None
    if cache is not None:
        cache_key = (module_id or "", manifest_hash(manifest))
        cached = cache.get(cache_key)
        if cached:
            return cached

    normalized = copy.deepcopy(manifest)
    warnings: list[dict] = []

    normalized, paths, lookup_warnings = _studio2_normalize_lookup_targets(normalized, collect_paths=True)
    if paths:
        warnings.append(
            {
                "code": "NORMALIZED_LOOKUP_TARGET",
                "message": "lookup targets normalized to entity ids",
                "path": None,
                "detail": {"paths_changed": paths[:50]},
            }
        )
    if lookup_warnings:
        warnings.extend(lookup_warnings)

    normalized, paths, rel_warnings = _studio2_normalize_relations(normalized, collect_paths=True)
    if paths:
        warnings.append(
            {
                "code": "NORMALIZED_RELATION",
                "message": "relations normalized to from/to shape",
                "path": None,
                "detail": {"paths_changed": paths[:50]},
            }
        )
    if rel_warnings:
        warnings.extend(rel_warnings)

    normalized, paths = _studio2_normalize_system_id_fields(normalized, collect_paths=True)
    if paths:
        warnings.append(
            {
                "code": "NORMALIZED_SYSTEM_FIELDS",
                "message": "system id fields normalized",
                "path": None,
                "detail": {"paths_changed": paths[:50]},
            }
        )

    normalized, paths = _studio2_normalize_view_bodies(normalized, collect_paths=True)
    if paths:
        warnings.append(
            {
                "code": "NORMALIZED_VIEW_BODIES",
                "message": "views/pages baseline scaffolding applied",
                "path": None,
                "detail": {"paths_changed": paths[:50]},
            }
        )

    normalized, paths, wf_warnings, dropped_status_fields = _studio2_normalize_workflows(normalized, collect_paths=True)
    if paths:
        warnings.append(
            {
                "code": "NORMALIZED_WORKFLOW",
                "message": "workflow ids/states normalized",
                "path": None,
                "detail": {"paths_changed": paths[:50]},
            }
        )
    if wf_warnings:
        warnings.extend(wf_warnings)

    normalized, paths = _studio2_normalize_enum_options(normalized, collect_paths=True)
    if paths:
        warnings.append(
            {
                "code": "NORMALIZED_ENUM_OPTIONS",
                "message": "enum options filled from workflow states",
                "path": None,
                "detail": {"paths_changed": paths[:50]},
            }
        )

    normalized, paths, vh_warnings = _studio2_normalize_view_headers(
        normalized, collect_paths=True, dropped_status_fields=dropped_status_fields
    )
    if paths:
        warnings.append(
            {
                "code": "NORMALIZED_VIEW_HEADER",
                "message": "view headers filled with defaults",
                "path": None,
                "detail": {"paths_changed": paths[:50]},
            }
        )
    if vh_warnings:
        warnings.extend(vh_warnings)

    normalized, paths = _studio2_normalize_status_actions(normalized, collect_paths=True)
    if paths:
        warnings.append(
            {
                "code": "NORMALIZED_STATUS_ACTIONS",
                "message": "status actions added for workflow",
                "path": None,
                "detail": {"paths_changed": paths[:50]},
            }
        )

    if cache is not None and cache_key is not None:
        cache[cache_key] = (normalized, warnings)
    return normalized, warnings


def _studio2_tool_ensure_entity_pages(manifest: dict, entity_id: str) -> dict:
    if not isinstance(manifest, dict):
        return manifest
    if not isinstance(entity_id, str) or not entity_id.startswith("entity."):
        return manifest
    return _studio2_enforce_architecture(manifest)


def _studio2_tool_ensure_nav(manifest: dict) -> dict:
    if not isinstance(manifest, dict):
        return manifest
    return _studio2_enforce_architecture(manifest)


def _studio2_tool_ensure_status_actions(manifest: dict, entity_id: str | None = None) -> dict:
    if not isinstance(manifest, dict):
        return manifest
    views = manifest.get("views") if isinstance(manifest.get("views"), list) else []
    entities = manifest.get("entities") if isinstance(manifest.get("entities"), list) else []
    workflows = manifest.get("workflows") if isinstance(manifest.get("workflows"), list) else []
    actions = manifest.get("actions") if isinstance(manifest.get("actions"), list) else []

    workflow_by_entity: dict[str, list[dict]] = {}
    for wf in workflows:
        if isinstance(wf, dict) and isinstance(wf.get("entity"), str):
            workflow_by_entity.setdefault(wf.get("entity"), []).append(wf)

    actions_by_id = {a.get("id"): a for a in actions if isinstance(a, dict) and isinstance(a.get("id"), str)}

    for ent in entities:
        if not isinstance(ent, dict):
            continue
        ent_id = ent.get("id")
        if not isinstance(ent_id, str):
            continue
        if entity_id and ent_id != entity_id:
            continue
        wf_list = workflow_by_entity.get(ent_id) or []
        if len(wf_list) != 1:
            continue
        wf = wf_list[0]
        status_field = wf.get("status_field")
        if not isinstance(status_field, str):
            continue
        fields = ent.get("fields") if isinstance(ent.get("fields"), list) else []
        field_def = next((f for f in fields if isinstance(f, dict) and f.get("id") == status_field), None)
        if not field_def or field_def.get("type") != "enum":
            continue
        states = wf.get("states") if isinstance(wf.get("states"), list) else []
        slug = ent_id.replace("entity.", "")

        # create actions for each state
        for state in states:
            if not isinstance(state, dict):
                continue
            sid = state.get("id")
            label = state.get("label") or sid
            if not isinstance(sid, str) or not sid:
                continue
            action_id = f"action.{slug}_set_{sid}"
            if action_id not in actions_by_id:
                actions_by_id[action_id] = {
                    "id": action_id,
                    "kind": "update_record",
                    "entity_id": ent_id,
                    "label": f"Set: {label}" if isinstance(label, str) else f"Set: {sid}",
                    "patch": {status_field: sid},
                }
            bulk_id = f"action.{slug}_bulk_set_{sid}"
            if bulk_id not in actions_by_id:
                actions_by_id[bulk_id] = {
                    "id": bulk_id,
                    "kind": "bulk_update",
                    "entity_id": ent_id,
                    "label": f"Set: {label}" if isinstance(label, str) else f"Set: {sid}",
                    "patch": {status_field: sid},
                }

        # wire actions into views
        for view in views:
            if not isinstance(view, dict):
                continue
            if view.get("entity") != ent_id:
                continue
            header = view.get("header") if isinstance(view.get("header"), dict) else {}
            if view.get("kind") == "form":
                secondary = header.get("secondary_actions") if isinstance(header.get("secondary_actions"), list) else []
                existing = {a.get("action_id") for a in secondary if isinstance(a, dict)}
                for state in states:
                    if not isinstance(state, dict):
                        continue
                    sid = state.get("id")
                    if not isinstance(sid, str) or not sid:
                        continue
                    action_id = f"action.{slug}_set_{sid}"
                    if action_id not in existing:
                        secondary.append({"action_id": action_id})
                header["secondary_actions"] = secondary
                view["header"] = header
            if view.get("kind") == "list":
                bulk = header.get("bulk_actions") if isinstance(header.get("bulk_actions"), list) else []
                existing = {a.get("action_id") for a in bulk if isinstance(a, dict)}
                for state in states:
                    if not isinstance(state, dict):
                        continue
                    sid = state.get("id")
                    if not isinstance(sid, str) or not sid:
                        continue
                    bulk_id = f"action.{slug}_bulk_set_{sid}"
                    if bulk_id not in existing:
                        bulk.append({"action_id": bulk_id})
                header["bulk_actions"] = bulk
                view["header"] = header

    manifest["actions"] = list(actions_by_id.values())
    manifest["views"] = views
    return manifest


def _studio2_tool_ensure_relation(manifest: dict, relation_def: dict) -> dict:
    if not isinstance(manifest, dict) or not isinstance(relation_def, dict):
        return {"ok": False, "reason": "RELATION_INVALID", "missing": ["relation"], "manifest": manifest}
    rel = dict(relation_def)
    source = rel.get("from")
    target = rel.get("to")
    if not (isinstance(source, str) and source and isinstance(target, str) and target):
        missing: list[str] = []
        if not isinstance(source, str) or not source:
            missing.append("from")
        if not isinstance(target, str) or not target:
            missing.append("to")
        from_field = rel.get("from_field")
        to_field = rel.get("to_field")
        if isinstance(from_field, str) and from_field and isinstance(to_field, str) and to_field:
            source = from_field
            target = to_field
        else:
            if not isinstance(from_field, str) or not from_field:
                missing.append("from_field")
            if not isinstance(to_field, str) or not to_field:
                missing.append("to_field")
            return {"ok": False, "reason": "RELATION_MISSING_FIELDS", "missing": missing, "manifest": manifest}
    normalized = {"from": source, "to": target}
    label_field = rel.get("label_field")
    if isinstance(label_field, str) and label_field:
        normalized["label_field"] = label_field
    to_entity = rel.get("to_entity")
    to_field = rel.get("to_field")
    if isinstance(to_entity, str) and to_entity:
        if not to_entity.startswith("entity."):
            to_entity_id = f"entity.{to_entity}"
        else:
            to_entity_id = to_entity
        entities = manifest.get("entities") if isinstance(manifest.get("entities"), list) else []
        existing_entity = next((e for e in entities if isinstance(e, dict) and e.get("id") == to_entity_id), None)
        if existing_entity is None:
            fields = []
            if isinstance(to_field, str) and to_field:
                fields.append({"id": to_field, "type": "uuid", "label": "ID", "readonly": True})
            if isinstance(label_field, str) and label_field:
                fields.append({"id": label_field, "type": "string", "label": "Name"})
            entities.append(
                {
                    "id": to_entity_id,
                    "display_field": label_field,
                    "fields": fields,
                }
            )
            manifest["entities"] = entities
        else:
            if isinstance(label_field, str) and label_field and not existing_entity.get("display_field"):
                existing_entity["display_field"] = label_field
    relations = manifest.get("relations") if isinstance(manifest.get("relations"), list) else []
    existing = next((r for r in relations if isinstance(r, dict) and r.get("from") == source and r.get("to") == target), None)
    if existing is None:
        relations.append(normalized)
    else:
        if normalized.get("label_field") and not existing.get("label_field"):
            existing["label_field"] = normalized.get("label_field")
    manifest["relations"] = relations
    return manifest


def _studio2_tool_ensure_workflow(manifest: dict, workflow_def: dict) -> dict:
    if not isinstance(manifest, dict) or not isinstance(workflow_def, dict):
        return manifest
    workflows = manifest.get("workflows") if isinstance(manifest.get("workflows"), list) else []
    wf = dict(workflow_def)
    entity_id = wf.get("entity")
    status_field = wf.get("status_field")
    if isinstance(entity_id, str) and isinstance(status_field, str):
        if not (status_field.endswith(".status") or status_field.endswith(".state") or status_field.endswith(".stage")):
            return {
                "ok": False,
                "reason": "NON_LIFECYCLE_FIELD",
                "hint": "Use enum field options for dropdown categories. Workflows are only for lifecycle status/state/stage fields.",
                "manifest": manifest,
            }
        if not isinstance(wf.get("id"), str) or not wf.get("id"):
            suffix = entity_id.replace("entity.", "")
            wf["id"] = f"workflow.{suffix}"
        states = wf.get("states")
        if isinstance(states, list):
            normalized_states = []
            for state in states:
                if isinstance(state, str):
                    normalized_states.append({"id": state, "label": state.replace("_", " ").title()})
                elif isinstance(state, dict):
                    sid = state.get("id")
                    if not isinstance(sid, str) or not sid:
                        sid = state.get("key") or state.get("name")
                    if not isinstance(sid, str) or not sid:
                        continue
                    label = state.get("label") or sid.replace("_", " ").title()
                    normalized_states.append({**state, "id": sid, "label": label})
            if normalized_states:
                wf["states"] = normalized_states
        if not wf.get("states"):
            wf["states"] = [
                {"id": "draft", "label": "Draft"},
                {"id": "in_progress", "label": "In Progress"},
                {"id": "completed", "label": "Completed"},
                {"id": "cancelled", "label": "Cancelled"},
            ]
    workflows.append(wf)
    manifest["workflows"] = workflows
    return manifest


def _studio2_tool_ensure_ui_pattern(manifest: dict, pattern_def: dict | None = None) -> dict:
    if not isinstance(manifest, dict):
        return manifest
    return _studio2_enforce_architecture(manifest)


def _studio2_registry_summary(snapshot: dict) -> dict:
    modules = snapshot.get("modules") if isinstance(snapshot, dict) else None
    summary = []
    for mod in modules or []:
        if not isinstance(mod, dict):
            continue
        entities = []
        for entity in mod.get("entities") or []:
            if not isinstance(entity, dict):
                continue
            fields = []
            for field in entity.get("fields") or []:
                if not isinstance(field, dict):
                    continue
                fields.append(
                    {
                        "id": field.get("id"),
                        "type": field.get("type"),
                        "label": field.get("label"),
                    }
                )
                if len(fields) >= 12:
                    break
            entities.append(
                {
                    "id": entity.get("id"),
                    "display_field": entity.get("display_field"),
                    "fields": fields,
                }
            )
        relations = []
        for rel in mod.get("relations") or []:
            if not isinstance(rel, dict):
                continue
            relations.append({"from": rel.get("from"), "to": rel.get("to")})
        summary.append(
            {
                "module_id": mod.get("module_id"),
                "name": mod.get("name"),
                "version": mod.get("version"),
                "entities": entities,
                "relations": relations,
            }
        )
    return {"modules": summary}


def _studio2_build_registry_summary(request: Request) -> dict:
    cache_key = "summary"
    cached_req = _req_cache_get(request, f"studio2_registry_summary:{cache_key}")
    if cached_req is not None:
        return cached_req
    cached = _cache_get("studio2_registry_summary", cache_key)
    if cached is not None:
        _req_cache_set(request, f"studio2_registry_summary:{cache_key}", cached)
        return cached
    snapshot = _studio2_build_registry_snapshot(request)
    summary = _studio2_registry_summary(snapshot)
    _cache_set("studio2_registry_summary", summary, cache_key)
    _req_cache_set(request, f"studio2_registry_summary:{cache_key}", summary)
    return summary


def _studio2_get_target_manifest(request: Request, module_id: str, draft_text: str | None) -> dict:
    if isinstance(draft_text, str) and draft_text.strip():
        try:
            draft_manifest = json.loads(draft_text)
            if isinstance(draft_manifest, dict):
                return draft_manifest
        except Exception:
            pass
    draft = drafts.get_draft(module_id)
    if draft and isinstance(draft.get("manifest"), dict):
        return draft.get("manifest")
    module = _get_module(request, module_id)
    if module and module.get("current_hash"):
        return _get_snapshot(request, module_id, module.get("current_hash"))
    return {}


def _ensure_module_id(manifest: dict, module_id: str) -> dict:
    if not isinstance(manifest, dict):
        return manifest
    manifest_copy = json.loads(json.dumps(manifest))
    module_section = manifest_copy.get("module")
    if not isinstance(module_section, dict):
        module_section = {}
    module_section["id"] = module_id
    if "name" not in module_section:
        module_section["name"] = module_id.replace("_", " ").replace("-", " ").title() or module_id
    if "version" not in module_section:
        module_section["version"] = "0.1.0"
    if "manifest_version" not in manifest_copy:
        manifest_copy["manifest_version"] = "1.3"
    manifest_copy["module"] = module_section
    return manifest_copy


def _sanitize_manifest(manifest: dict) -> dict:
    if not isinstance(manifest, dict):
        return manifest
    if "text" in manifest and isinstance(manifest.get("text"), str):
        try:
            parsed = json.loads(manifest.get("text"))
            if isinstance(parsed, dict):
                manifest = parsed
        except Exception:
            pass
        cleaned = dict(manifest)
        cleaned.pop("text", None)
        manifest = cleaned

    if not isinstance(manifest, dict):
        return manifest

    fixed = json.loads(json.dumps(manifest))
    for key in list(fixed.keys()):
        if not isinstance(key, str) or "." not in key:
            continue
        head, tail = key.split(".", 1)
        if head in {"module", "app"}:
            target = fixed.get(head)
            if not isinstance(target, dict):
                target = {}
            target[tail] = fixed.get(key)
            fixed[head] = target
            fixed.pop(key, None)

    def normalize_block(block):
        if not isinstance(block, dict):
            return
        if "type" in block and "kind" not in block and isinstance(block.get("type"), str):
            block["kind"] = block.get("type")
            block.pop("type", None)
        for key in ("content", "items", "tabs", "columns"):
            value = block.get(key)
            if isinstance(value, list):
                for item in value:
                    normalize_block(item)
            elif isinstance(value, dict):
                normalize_block(value)

    pages = fixed.get("pages")
    if isinstance(pages, list):
        for page in pages:
            if not isinstance(page, dict):
                continue
            content = page.get("content")
            if isinstance(content, list):
                for item in content:
                    normalize_block(item)
            elif isinstance(content, dict):
                normalize_block(content)

    entities = fixed.get("entities")
    if isinstance(entities, list):
        for ent in entities:
            if not isinstance(ent, dict):
                continue
            fields = ent.get("fields")
            if not isinstance(fields, list):
                continue
            for field in fields:
                if not isinstance(field, dict):
                    continue
                ftype = field.get("type")
                if ftype == "email":
                    field["type"] = "string"

    return fixed


def _ensure_app_home(manifest: dict) -> dict:
    if not isinstance(manifest, dict):
        return manifest
    manifest_copy = json.loads(json.dumps(manifest))
    app_section = manifest_copy.get("app")
    if not isinstance(app_section, dict):
        app_section = {}
    home = app_section.get("home")
    if not isinstance(home, str) or not home.startswith("page:"):
        pages = manifest_copy.get("pages") if isinstance(manifest_copy.get("pages"), list) else []
        page_id = None
        for page in pages:
            if isinstance(page, dict) and isinstance(page.get("id"), str):
                page_id = page.get("id")
                break
        if page_id:
            app_section["home"] = f"page:{page_id}"
        else:
            if not isinstance(manifest_copy.get("pages"), list):
                manifest_copy["pages"] = []
            if "home" not in [p.get("id") for p in manifest_copy["pages"] if isinstance(p, dict)]:
                manifest_copy["pages"].append({"id": "home", "title": "Home", "layout": "single", "content": []})
            app_section["home"] = "page:home"
            if "nav" not in app_section:
                app_section["nav"] = [{"group": "Main", "items": [{"label": "Home", "to": "page:home"}]}]
    manifest_copy["app"] = app_section
    return manifest_copy


def _studio2_completeness_issues(manifest: dict) -> list[dict]:
    issues: list[dict] = []
    if not isinstance(manifest, dict):
        return [{"code": "INCOMPLETE_MANIFEST", "message": "manifest is not an object", "path": None}]
    entities = manifest.get("entities") if isinstance(manifest.get("entities"), list) else []
    pages = manifest.get("pages") if isinstance(manifest.get("pages"), list) else []
    views = manifest.get("views") if isinstance(manifest.get("views"), list) else []
    app = manifest.get("app") if isinstance(manifest.get("app"), dict) else {}
    nav = app.get("nav") if isinstance(app.get("nav"), list) else []
    home = app.get("home")

    if not entities:
        issues.append({"code": "INCOMPLETE_ENTITIES", "message": "no entities defined", "path": "/entities"})
    else:
        for idx, ent in enumerate(entities):
            if not isinstance(ent, dict):
                continue
            display_field = ent.get("display_field")
            if not isinstance(display_field, str) or not display_field.strip():
                issues.append(
                    {
                        "code": "INCOMPLETE_DISPLAY_FIELD",
                        "message": "entity display_field required",
                        "path": f"/entities/{idx}/display_field",
                    }
                )
            fields = ent.get("fields") if isinstance(ent.get("fields"), list) else []
            if not fields:
                issues.append(
                    {
                        "code": "INCOMPLETE_FIELDS",
                        "message": "entity has no fields",
                        "path": f"/entities/{idx}/fields",
                    }
                )

    if not pages:
        issues.append({"code": "INCOMPLETE_PAGES", "message": "no pages defined", "path": "/pages"})
    else:
        list_pages = [p for p in pages if isinstance(p, dict) and "list" in str(p.get("id", ""))]
        form_pages = [p for p in pages if isinstance(p, dict) and "form" in str(p.get("id", ""))]
        if not list_pages:
            issues.append({"code": "INCOMPLETE_LIST_PAGE", "message": "missing list page", "path": "/pages"})
        if not form_pages:
            issues.append({"code": "INCOMPLETE_FORM_PAGE", "message": "missing form page", "path": "/pages"})
        for idx, page in enumerate(pages):
            if not isinstance(page, dict):
                continue
            title = page.get("title")
            if isinstance(title, str) and title.strip() in {"Page 1", "Untitled"}:
                issues.append(
                    {
                        "code": "INCOMPLETE_PLACEHOLDER_TITLE",
                        "message": "placeholder page title",
                        "path": f"/pages/{idx}/title",
                    }
                )
            content = page.get("content")
            if isinstance(content, list) and len(content) == 0:
                issues.append(
                    {
                        "code": "INCOMPLETE_PAGE_CONTENT",
                        "message": "page content is empty",
                        "path": f"/pages/{idx}/content",
                    }
                )

    if not nav:
        issues.append({"code": "INCOMPLETE_NAV", "message": "app.nav is empty", "path": "/app/nav"})

    if isinstance(home, str) and home.startswith("page:"):
        home_id = home.replace("page:", "", 1)
        if not any(isinstance(p, dict) and p.get("id") == home_id for p in pages):
            issues.append({"code": "INCOMPLETE_HOME", "message": "app.home points to missing page", "path": "/app/home"})
    else:
        issues.append({"code": "INCOMPLETE_HOME", "message": "app.home must point to a page:<id>", "path": "/app/home"})

    if not views:
        issues.append({"code": "INCOMPLETE_VIEWS", "message": "no views defined", "path": "/views"})
    return issues


def _studio2_strict_validate(manifest: dict, expected_module_id: str | None = None) -> list[dict]:
    if not isinstance(manifest, dict):
        return [{"code": "MANIFEST_INVALID", "message": "manifest must be an object", "path": None, "json_pointer": None, "detail": None}]
    errors: list[dict] = []

    top_level_forbidden = [key for key in manifest.keys() if isinstance(key, str) and "." in key]
    for key in top_level_forbidden:
        errors.append(
            {
                "code": "MANIFEST_STRICT_DOTTED_KEY",
                "message": f"top-level dotted key is forbidden: {key}",
                "path": key,
                "json_pointer": f"/{_json_pointer_escape(key)}",
                "detail": None,
            }
        )

    module = manifest.get("module") if isinstance(manifest.get("module"), dict) else {}
    module_id = module.get("id")
    if expected_module_id and module_id != expected_module_id:
        errors.append(
            {
                "code": "MANIFEST_MODULE_ID_MISMATCH",
                "message": "module.id must match target module_id",
                "path": "/module/id",
                "json_pointer": "/module/id",
                "detail": {"expected": expected_module_id, "actual": module_id},
            }
        )

    entities = manifest.get("entities") if isinstance(manifest.get("entities"), list) else []
    entity_ids: set[str] = set()
    for e_idx, entity in enumerate(entities):
        if not isinstance(entity, dict):
            continue
        ent_id = entity.get("id")
        if isinstance(ent_id, str):
            entity_ids.add(ent_id)
            if not ent_id.startswith("entity."):
                errors.append(
                    {
                        "code": "MANIFEST_ENTITY_ID_UNNAMESPACED",
                        "message": "entity.id must start with entity.",
                        "path": f"/entities/{e_idx}/id",
                        "json_pointer": f"/entities/{e_idx}/id",
                        "detail": {"id": ent_id},
                    }
                )
        fields = entity.get("fields") if isinstance(entity.get("fields"), list) else []
        ent_short = ent_id[7:] if isinstance(ent_id, str) and ent_id.startswith("entity.") else None
        for f_idx, field in enumerate(fields):
            if not isinstance(field, dict):
                continue
            fid = field.get("id")
            if isinstance(fid, str) and ent_short and not fid.startswith(f"{ent_short}."):
                errors.append(
                    {
                        "code": "MANIFEST_FIELD_ID_UNNAMESPACED",
                        "message": "field.id must be namespaced to its entity (entity.<name> -> <name>.<field>)",
                        "path": f"/entities/{e_idx}/fields/{f_idx}/id",
                        "json_pointer": f"/entities/{e_idx}/fields/{f_idx}/id",
                        "detail": {"id": fid, "expected_prefix": f"{ent_short}."},
                    }
                )
        display_field = entity.get("display_field")
        if isinstance(ent_short, str) and display_field:
            if not any(isinstance(f, dict) and f.get("id") == display_field for f in fields):
                errors.append(
                    {
                        "code": "MANIFEST_DISPLAY_FIELD_INVALID",
                        "message": "display_field must match a field id in the entity",
                        "path": f"/entities/{e_idx}/display_field",
                        "json_pointer": f"/entities/{e_idx}/display_field",
                        "detail": {"display_field": display_field},
                    }
                )

    views = manifest.get("views") if isinstance(manifest.get("views"), list) else []
    view_ids: set[str] = set()
    for v_idx, view in enumerate(views):
        if not isinstance(view, dict):
            continue
        vid = view.get("id")
        if isinstance(vid, str):
            view_ids.add(vid)
        if not view.get("kind"):
            errors.append(
                {
                    "code": "MANIFEST_VIEW_KIND_REQUIRED",
                    "message": "view.kind is required",
                    "path": f"/views/{v_idx}/kind",
                    "json_pointer": f"/views/{v_idx}/kind",
                    "detail": None,
                }
            )
        ent = view.get("entity")
        if isinstance(ent, str) and ent not in entity_ids:
            errors.append(
                {
                    "code": "MANIFEST_VIEW_ENTITY_UNKNOWN",
                    "message": "view.entity not found",
                    "path": f"/views/{v_idx}/entity",
                    "json_pointer": f"/views/{v_idx}/entity",
                    "detail": {"entity": ent},
                }
            )

    pages = manifest.get("pages") if isinstance(manifest.get("pages"), list) else []
    page_ids = {p.get("id") for p in pages if isinstance(p, dict) and isinstance(p.get("id"), str)}
    view_targets: set[str] = set()

    def _collect_view_targets(node, path_prefix):
        if isinstance(node, dict):
            if "type" in node and "kind" not in node:
                errors.append(
                    {
                        "code": "MANIFEST_BLOCK_KEY_INVALID",
                        "message": "blocks must use kind, not type",
                        "path": f"{path_prefix}/type",
                        "json_pointer": f"{path_prefix}/type",
                        "detail": None,
                    }
                )
            if node.get("kind") == "view":
                target = node.get("target")
                if isinstance(target, str):
                    view_targets.add(target)
            for key, value in node.items():
                if isinstance(value, (dict, list)):
                    _collect_view_targets(value, f"{path_prefix}/{_json_pointer_escape(str(key))}")
        elif isinstance(node, list):
            for idx, item in enumerate(node):
                _collect_view_targets(item, f"{path_prefix}/{idx}")

    for p_idx, page in enumerate(pages):
        if not isinstance(page, dict):
            continue
        if not page.get("layout"):
            errors.append(
                {
                    "code": "MANIFEST_PAGE_INCOMPLETE",
                    "message": "page.layout is required",
                    "path": f"/pages/{p_idx}/layout",
                    "json_pointer": f"/pages/{p_idx}/layout",
                    "detail": None,
                }
            )
        content = page.get("content")
        if not isinstance(content, list):
            errors.append(
                {
                    "code": "MANIFEST_PAGE_INCOMPLETE",
                    "message": "page.content must be a list",
                    "path": f"/pages/{p_idx}/content",
                    "json_pointer": f"/pages/{p_idx}/content",
                    "detail": None,
                }
            )
        else:
            _collect_view_targets(content, f"/pages/{p_idx}/content")

    for target in view_targets:
        if not isinstance(target, str):
            continue
        if not target.startswith("view:"):
            errors.append(
                {
                    "code": "MANIFEST_VIEW_TARGET_INVALID",
                    "message": "view targets must be prefixed with view:",
                    "path": None,
                    "json_pointer": None,
                    "detail": {"target": target},
                }
            )
            continue
        view_id = target.replace("view:", "", 1)
        if view_id not in view_ids:
            errors.append(
                {
                    "code": "MANIFEST_VIEW_TARGET_UNKNOWN",
                    "message": "view target does not exist",
                    "path": None,
                    "json_pointer": None,
                    "detail": {"target": target},
                }
            )

    app = manifest.get("app") if isinstance(manifest.get("app"), dict) else {}
    if page_ids or entities:
        home = app.get("home")
        if isinstance(home, str) and home.startswith("page:"):
            home_id = home.replace("page:", "", 1)
            if home_id not in page_ids:
                errors.append(
                    {
                        "code": "MANIFEST_HOME_INVALID",
                        "message": "app.home must point to a valid page",
                        "path": "/app/home",
                        "json_pointer": "/app/home",
                        "detail": {"home": home},
                    }
                )
        else:
            errors.append(
                {
                    "code": "MANIFEST_HOME_INVALID",
                    "message": "app.home must be page:<id>",
                    "path": "/app/home",
                    "json_pointer": "/app/home",
                    "detail": {"home": home},
                }
            )

    nav = app.get("nav") if isinstance(app.get("nav"), list) else []
    for g_idx, group in enumerate(nav):
        if not isinstance(group, dict):
            continue
        items = group.get("items") if isinstance(group.get("items"), list) else []
        for i_idx, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            to = item.get("to")
            if isinstance(to, str) and to.startswith("page:"):
                page_id = to.replace("page:", "", 1)
                if page_id not in page_ids:
                    errors.append(
                        {
                            "code": "MANIFEST_NAV_TARGET_INVALID",
                            "message": "nav target page missing",
                            "path": f"/app/nav/{g_idx}/items/{i_idx}/to",
                            "json_pointer": f"/app/nav/{g_idx}/items/{i_idx}/to",
                            "detail": {"to": to},
                        }
                    )
            elif to is not None:
                errors.append(
                    {
                        "code": "MANIFEST_NAV_TARGET_INVALID",
                        "message": "nav.to must be page:<id>",
                        "path": f"/app/nav/{g_idx}/items/{i_idx}/to",
                        "json_pointer": f"/app/nav/{g_idx}/items/{i_idx}/to",
                        "detail": {"to": to},
                    }
                )

    return errors


def _studio2_completeness_check(manifest: dict) -> list[dict]:
    if not isinstance(manifest, dict):
        return [{"code": "INCOMPLETE_MANIFEST", "message": "manifest must be object", "path": None}]
    issues: list[dict] = []
    app = manifest.get("app") if isinstance(manifest.get("app"), dict) else {}
    pages = manifest.get("pages") if isinstance(manifest.get("pages"), list) else []
    views = manifest.get("views") if isinstance(manifest.get("views"), list) else []
    entities = manifest.get("entities") if isinstance(manifest.get("entities"), list) else []

    page_ids = {p.get("id") for p in pages if isinstance(p, dict) and isinstance(p.get("id"), str)}
    view_ids = {v.get("id") for v in views if isinstance(v, dict) and isinstance(v.get("id"), str)}
    entity_ids = {e.get("id") for e in entities if isinstance(e, dict) and isinstance(e.get("id"), str)}

    # collect view targets from pages
    page_view_targets: set[str] = set()
    page_records: dict[str, list[str]] = {}

    def _collect(node, page_id):
        if isinstance(node, dict):
            if node.get("kind") == "view" and isinstance(node.get("target"), str):
                target = node.get("target")
                page_view_targets.add(target)
                if not target.startswith("view:"):
                    page_view_targets.add(f"view:{target}")
            if node.get("kind") == "record" and isinstance(node.get("entity_id"), str):
                page_records.setdefault(page_id, []).append(node.get("entity_id"))
            if node.get("kind") == "view_modes":
                modes = node.get("modes")
                if isinstance(modes, list):
                    for mode in modes:
                        if isinstance(mode, dict) and isinstance(mode.get("target"), str):
                            target = mode.get("target")
                            page_view_targets.add(target)
                            if not target.startswith("view:"):
                                page_view_targets.add(f"view:{target}")
            for value in node.values():
                _collect(value, page_id)
        elif isinstance(node, list):
            for item in node:
                _collect(item, page_id)

    for page in pages:
        if not isinstance(page, dict):
            continue
        pid = page.get("id")
        if not isinstance(pid, str):
            continue
        _collect(page.get("content"), pid)

    # required list/form pages per entity
    for ent_id in entity_ids:
        if not isinstance(ent_id, str) or not ent_id.startswith("entity."):
            continue
        slug = ent_id[7:]
        list_page = f"{slug}.list_page"
        form_page = f"{slug}.form_page"
        list_view = f"view:{slug}.list"
        form_view = f"view:{slug}.form"
        if list_page not in page_ids:
            issues.append({"code": "INCOMPLETE_LIST_PAGE", "message": "missing list page for entity", "path": f"/pages", "detail": {"entity": ent_id}})
        if form_page not in page_ids:
            issues.append({"code": "INCOMPLETE_FORM_PAGE", "message": "missing form page for entity", "path": f"/pages", "detail": {"entity": ent_id}})
        if list_view not in page_view_targets:
            issues.append({"code": "INCOMPLETE_LIST_VIEW_WIRING", "message": "list page not wired to list view", "path": f"/pages", "detail": {"entity": ent_id}})
        if form_view not in page_view_targets:
            issues.append({"code": "INCOMPLETE_FORM_VIEW_WIRING", "message": "form page not wired to form view", "path": f"/pages", "detail": {"entity": ent_id}})
        if form_page in page_records:
            if ent_id not in page_records.get(form_page, []):
                issues.append({"code": "INCOMPLETE_FORM_RECORD", "message": "form page record block missing entity", "path": f"/pages", "detail": {"entity": ent_id}})
        else:
            issues.append({"code": "INCOMPLETE_FORM_RECORD", "message": "form page record block missing", "path": f"/pages", "detail": {"entity": ent_id}})

    # orphan views
    for view_id in view_ids:
        target = f"view:{view_id}"
        if target not in page_view_targets:
            issues.append({"code": "INCOMPLETE_ORPHAN_VIEW", "message": "view is not referenced by any page", "path": "/views", "detail": {"view": view_id}})

    # orphan pages (not reachable via nav/home or view/default links)
    reachable_pages = set()
    nav = app.get("nav") if isinstance(app.get("nav"), list) else []
    for group in nav:
        if not isinstance(group, dict):
            continue
        for item in group.get("items") or []:
            if isinstance(item, dict) and isinstance(item.get("to"), str) and item.get("to").startswith("page:"):
                reachable_pages.add(item.get("to").replace("page:", "", 1))
    home = app.get("home")
    if isinstance(home, str) and home.startswith("page:"):
        reachable_pages.add(home.replace("page:", "", 1))
    # reachability via list open_record targets
    for view in views:
        if not isinstance(view, dict):
            continue
        open_record = view.get("open_record")
        if isinstance(open_record, dict):
            target = open_record.get("to")
            if isinstance(target, str) and target.startswith("page:"):
                reachable_pages.add(target.replace("page:", "", 1))
    # reachability via app defaults
    defaults = app.get("defaults") if isinstance(app.get("defaults"), dict) else {}
    for key in ("entity_form_page", "entity_home_page"):
        target = defaults.get(key)
        if isinstance(target, str) and target.startswith("page:"):
            reachable_pages.add(target.replace("page:", "", 1))
    defaults_entities = defaults.get("entities") if isinstance(defaults.get("entities"), dict) else {}
    for ent_defaults in defaults_entities.values():
        if not isinstance(ent_defaults, dict):
            continue
        for key in ("entity_form_page", "entity_home_page"):
            target = ent_defaults.get(key)
            if isinstance(target, str) and target.startswith("page:"):
                reachable_pages.add(target.replace("page:", "", 1))
    for pid in page_ids:
        if pid not in reachable_pages:
            issues.append({"code": "INCOMPLETE_ORPHAN_PAGE", "message": "page not reachable from nav/home", "path": "/pages", "detail": {"page": pid}})

    return issues


def _studio2_design_warnings(manifest: dict) -> list[dict]:
    return _studio2_design_lint(manifest)


def _studio2_design_lint(manifest: dict) -> list[dict]:
    if not isinstance(manifest, dict):
        return []
    warnings: list[dict] = []
    views = manifest.get("views") if isinstance(manifest.get("views"), list) else []
    pages = manifest.get("pages") if isinstance(manifest.get("pages"), list) else []
    entities = manifest.get("entities") if isinstance(manifest.get("entities"), list) else []
    actions = manifest.get("actions") if isinstance(manifest.get("actions"), list) else []
    workflows = manifest.get("workflows") if isinstance(manifest.get("workflows"), list) else []

    entity_by_id = {e.get("id"): e for e in entities if isinstance(e, dict) and isinstance(e.get("id"), str)}
    actions_by_id = {a.get("id"): a for a in actions if isinstance(a, dict) and isinstance(a.get("id"), str)}
    workflows_by_entity: dict[str, list[dict]] = {}
    for wf in workflows:
        if isinstance(wf, dict) and isinstance(wf.get("entity"), str):
            workflows_by_entity.setdefault(wf.get("entity"), []).append(wf)

    def _field_label(field_id: str, field_def: dict | None = None) -> str:
        if field_def and isinstance(field_def.get("label"), str):
            return field_def.get("label")
        return field_id.split(".")[-1].replace("_", " ").title()

    def _useful_fields(entity: dict) -> list[dict]:
        fields = entity.get("fields") if isinstance(entity.get("fields"), list) else []
        useful: list[dict] = []
        for field in fields:
            if not isinstance(field, dict):
                continue
            fid = field.get("id")
            ftype = field.get("type")
            if not isinstance(fid, str):
                continue
            if ftype == "uuid" or fid.endswith(".id") or fid.endswith("_id"):
                continue
            useful.append(field)
        return useful

    # form warnings
    for v_idx, view in enumerate(views):
        if not isinstance(view, dict) or view.get("kind") != "form":
            continue
        entity_id = view.get("entity") or view.get("entity_id") or view.get("entityId")
        entity = entity_by_id.get(entity_id) if isinstance(entity_id, str) else None
        sections = view.get("sections") if isinstance(view.get("sections"), list) else []
        fields_shown: list[str] = []
        for section in sections:
            if isinstance(section, dict):
                fields = section.get("fields") if isinstance(section.get("fields"), list) else []
                fields_shown.extend([f for f in fields if isinstance(f, str)])
        if not fields_shown:
            warnings.append(
                {
                    "code": "DESIGN_FORM_EMPTY",
                    "message": "form view has no fields",
                    "path": f"/views/{v_idx}/sections",
                    "detail": {"entity_id": entity_id},
                }
            )
        if isinstance(entity, dict):
            missing_required = []
            for field in entity.get("fields") if isinstance(entity.get("fields"), list) else []:
                if not isinstance(field, dict):
                    continue
                fid = field.get("id")
                if not isinstance(fid, str):
                    continue
                if not field.get("required"):
                    continue
                if field.get("readonly") is True:
                    continue
                if field.get("default") is not None:
                    continue
                if fid not in fields_shown:
                    missing_required.append(_field_label(fid, field))
            if missing_required:
                warnings.append(
                    {
                        "code": "DESIGN_FORM_MISSING_REQUIRED_FIELDS",
                        "message": "required fields missing from form",
                        "path": f"/views/{v_idx}/sections",
                        "detail": {"missing": missing_required, "entity_id": entity_id},
                    }
                )

    # list warnings
    for v_idx, view in enumerate(views):
        if not isinstance(view, dict) or view.get("kind") != "list":
            continue
        entity_id = view.get("entity") or view.get("entity_id") or view.get("entityId")
        entity = entity_by_id.get(entity_id) if isinstance(entity_id, str) else None
        columns = view.get("columns") if isinstance(view.get("columns"), list) else []
        column_fields = [c.get("field_id") for c in columns if isinstance(c, dict) and isinstance(c.get("field_id"), str)]
        if len(column_fields) < 2:
            warnings.append(
                {
                    "code": "DESIGN_LIST_TOO_FEW_COLUMNS",
                    "message": "list view should show at least two columns",
                    "path": f"/views/{v_idx}/columns",
                    "detail": {"entity_id": entity_id},
                }
            )
        if isinstance(entity, dict):
            display_field = entity.get("display_field")
            useful = [f.get("id") for f in _useful_fields(entity) if isinstance(f.get("id"), str)]
            if (
                isinstance(display_field, str)
                and len(column_fields) == 1
                and column_fields[0] == display_field
                and len(useful) > 1
            ):
                warnings.append(
                    {
                        "code": "DESIGN_LIST_TOO_FEW_COLUMNS",
                        "message": "list view only shows display field",
                        "path": f"/views/{v_idx}/columns",
                        "detail": {"entity_id": entity_id},
                    }
                )

    # workflow actions warning
    for entity_id, wf_list in workflows_by_entity.items():
        if len(wf_list) != 1:
            continue
        wf = wf_list[0]
        status_field = wf.get("status_field")
        if not isinstance(status_field, str):
            continue
        entity = entity_by_id.get(entity_id)
        if not isinstance(entity, dict):
            continue
        field_def = next((f for f in entity.get("fields") or [] if isinstance(f, dict) and f.get("id") == status_field), None)
        if not field_def or field_def.get("type") != "enum":
            continue
        has_status_actions = False
        for action in actions:
            if not isinstance(action, dict):
                continue
            if action.get("entity_id") != entity_id:
                continue
            if action.get("kind") not in {"update_record", "bulk_update"}:
                continue
            patch = action.get("patch")
            if isinstance(patch, dict) and status_field in patch:
                has_status_actions = True
                break
        if not has_status_actions:
            warnings.append(
                {
                    "code": "DESIGN_WORKFLOW_NO_STATUS_ACTIONS",
                    "message": "workflow exists but no status actions present",
                    "path": "/actions",
                    "detail": {"entity_id": entity_id, "status_field": status_field},
                }
            )

    # redundant title container warning
    for p_idx, page in enumerate(pages):
        if not isinstance(page, dict):
            continue
        header = page.get("header") if isinstance(page.get("header"), dict) else {}
        if header.get("variant") not in {None, "", "none"}:
            continue
        content = page.get("content") if isinstance(page.get("content"), list) else []
        if len(content) != 1:
            continue
        block = content[0]
        if not isinstance(block, dict):
            continue
        if block.get("kind") not in {"container", "card"}:
            continue
        title = block.get("title") or block.get("header", {}).get("title") if isinstance(block.get("header"), dict) else None
        inner = block.get("content") if isinstance(block.get("content"), list) else []
        if isinstance(title, str) and len(inner) == 1:
            inner_block = inner[0]
            if isinstance(inner_block, dict) and inner_block.get("kind") == "view":
                warnings.append(
                    {
                        "code": "DESIGN_REDUNDANT_TITLE_CONTAINER",
                        "message": "title-only container wraps a single view",
                        "path": f"/pages/{p_idx}/content/0",
                        "detail": {"page_id": page.get("id")},
                    }
                )
    return warnings


def _studio2_prompt_manifest_summary(manifest: dict) -> dict:
    if not isinstance(manifest, dict):
        return {}
    module = manifest.get("module") if isinstance(manifest.get("module"), dict) else {}
    entities = []
    for ent in manifest.get("entities") or []:
        if not isinstance(ent, dict):
            continue
        fields = []
        for field in ent.get("fields") or []:
            if not isinstance(field, dict):
                continue
            if field.get("id"):
                fields.append({"id": field.get("id"), "type": field.get("type"), "label": field.get("label")})
        entities.append({"id": ent.get("id"), "label": ent.get("label"), "fields": fields[:12]})
    pages = []
    for page in manifest.get("pages") or []:
        if isinstance(page, dict) and page.get("id"):
            pages.append({"id": page.get("id"), "title": page.get("title")})
    views = []
    for view in manifest.get("views") or []:
        if isinstance(view, dict) and view.get("id"):
            views.append({"id": view.get("id"), "kind": view.get("kind"), "entity": view.get("entity")})
    return {
        "module_id": module.get("id"),
        "module_name": module.get("name"),
        "entities": entities[:8],
        "pages": pages[:8],
        "views": views[:8],
    }


def _studio2_related_hints(summary: dict, target_manifest: dict, message: str) -> dict:
    target_entities = set()
    for entity in target_manifest.get("entities") or []:
        if isinstance(entity, dict) and isinstance(entity.get("id"), str):
            target_entities.add(entity.get("id"))
            if entity.get("id", "").startswith("entity."):
                target_entities.add(entity.get("id")[7:])

    matched_entities = []
    for mod in summary.get("modules") or []:
        if not isinstance(mod, dict):
            continue
        mod_entities = []
        for entity in mod.get("entities") or []:
            if not isinstance(entity, dict):
                continue
            eid = entity.get("id")
            if not isinstance(eid, str):
                continue
            short = eid[7:] if eid.startswith("entity.") else eid
            if eid in target_entities or short in target_entities:
                continue
            if (eid in message) or (short and short in message):
                mod_entities.append(entity)
        if mod_entities:
            matched_entities.append(
                {
                    "module_id": mod.get("module_id"),
                    "name": mod.get("name"),
                    "entities": mod_entities,
                    "relations": mod.get("relations") or [],
                }
            )
    return {"modules": matched_entities}


@app.post("/studio2/ai/plan")
async def studio2_ai_plan(request: Request) -> dict:
    body = await _safe_json(request)
    prompt = body.get("prompt") if isinstance(body, dict) else None
    module_id = body.get("module_id") if isinstance(body, dict) else None
    if not isinstance(prompt, str) or not isinstance(module_id, str):
        return _error_response("AI_PLAN_INVALID", "prompt and module_id required", "prompt")
    if not USE_AI:
        patchset = {
            "patchset_id": f"ps_{uuid.uuid4().hex}",
            "summary": "AI disabled: no changes proposed",
            "patches": [{"module_id": module_id, "ops": []}],
        }
        return _ok_response({"data": {"patchset": patchset, "mode": "mock"}})
    _ = _load_prompt_pack("manifest_contract_v1_3.md")
    _ = _load_prompt_pack("ui_rules.md")
    _ = _load_prompt_pack("patch_protocol.md")
    patchset = {
        "patchset_id": f"ps_{uuid.uuid4().hex}",
        "summary": "AI not wired: no changes proposed",
        "patches": [{"module_id": module_id, "ops": []}],
    }
    return _ok_response({"data": {"patchset": patchset, "mode": "stub"}})


@app.post("/studio2/ai/fix_json")
async def studio2_ai_fix_json(request: Request) -> dict:
    body = await _safe_json(request)
    text = body.get("text") if isinstance(body, dict) else None
    error = body.get("error") if isinstance(body, dict) else None
    if not isinstance(text, str):
        return _error_response("JSON_FIX_INVALID", "text required", "text")
    line = error.get("line") if isinstance(error, dict) else None
    col = error.get("col") if isinstance(error, dict) else None
    fixed, suggestions = _json_fix_attempt(text, line, col)
    return _ok_response({"data": {"fixed_text": fixed, "explanation": "heuristic fix", "suggestions": suggestions}})


@dataclass
class AgentContext:
    module_id: str
    user_id: str | None
    registry_snapshot: dict
    base_manifest: dict
    working_manifest: dict
    cache: dict = field(default_factory=dict)
    stats: dict = field(default_factory=lambda: {"iteration_logs": []})
    request_id: str | None = None


def _hash_json(value: Any) -> str:
    try:
        payload = json.dumps(value, sort_keys=True, separators=(",", ":"))
    except Exception:
        payload = json.dumps(str(value))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _fingerprint_errors(errors: list[dict]) -> str:
    items = []
    for err in errors:
        if not isinstance(err, dict):
            continue
        items.append(
            (
                err.get("code"),
                err.get("json_pointer"),
                err.get("path"),
                err.get("message"),
            )
        )
    items.sort()
    return _hash_json(items)


def _count_errors(*lists: list[dict]) -> int:
    return sum(len(lst) for lst in lists if isinstance(lst, list))


def _require_user_id(request: Request) -> str | None:
    actor = getattr(request.state, "actor", None)
    if isinstance(actor, dict):
        user_id = actor.get("id")
        if isinstance(user_id, str) and user_id:
            return user_id
    return None


def _update_best_iteration(best: dict | None, current: dict) -> dict:
    if best is None:
        return current
    best_score = (best["total_errors"], best["strict_errors"], best["completeness_errors"])
    current_score = (current["total_errors"], current["strict_errors"], current["completeness_errors"])
    if current_score < best_score:
        return current
    return best


def _studio2_normalize_tool_name(tool: str | None) -> str | None:
    if not isinstance(tool, str):
        return tool
    mapping = {
        "ensure_pages": "ensure_entity_pages",
        "ensure_entity_pages_for": "ensure_entity_pages",
        "ensure_pages_for_entity": "ensure_entity_pages",
        "ensure_navigation": "ensure_nav",
        "ensure_nav_tree": "ensure_nav",
        "ensure_sidebar_nav": "ensure_nav",
        "ensure_actions": "ensure_actions_for_status",
        "ensure_status_actions": "ensure_actions_for_status",
        "ensure_entity_definition": "ensure_entity",
        "ensure_entity_def": "ensure_entity",
        "ensure_pattern": "ensure_ui_pattern",
        "apply_ui_pattern": "ensure_ui_pattern",
        "read_module_manifest": "read_manifest",
    }
    return mapping.get(tool, tool)


def _studio2_contains_patch_ops(plan_ops: dict | None) -> bool:
    if not isinstance(plan_ops, dict):
        return False
    candidate_lists: list[list] = []
    ops = plan_ops.get("ops")
    if isinstance(ops, list):
        candidate_lists.append(ops)
    ops_by_module = plan_ops.get("ops_by_module")
    if isinstance(ops_by_module, list):
        for entry in ops_by_module:
            if isinstance(entry, dict) and isinstance(entry.get("ops"), list):
                candidate_lists.append(entry.get("ops"))
    for items in candidate_lists:
        for op in items:
            if isinstance(op, dict) and "op" in op and "path" in op:
                return True
    return False


async def _studio2_agent_chat_run(
    request: Request,
    body: dict,
    progress: AgentProgress | None = None,
    include_progress: bool = False,
) -> dict:
    if not _openai_configured():
        return _openai_not_configured()
    reset_db_ms()
    request_id = request.headers.get("x-request-id") if hasattr(request, "headers") else None
    module_id = body.get("module_id") if isinstance(body, dict) else None
    message = body.get("message") if isinstance(body, dict) else None
    chat_history = body.get("chat_history") if isinstance(body, dict) else None
    if not isinstance(module_id, str) or not isinstance(message, str):
        return _error_response("AGENT_INVALID", "module_id and message required", "module_id")
    if len(message) > 4000:
        return _error_response("AGENT_MESSAGE_TOO_LONG", "message too long", "message")

    request_id_value = request_id or str(uuid.uuid4())
    if include_progress and progress is None:
        progress = AgentProgress(request_id=request_id_value, module_id=module_id, stream_debug=STUDIO2_AGENT_STREAM_DEBUG)
    if progress:
        progress.emit(
            "run_started",
            "start",
            None,
            {
                "message_len": len(message or ""),
                "has_build_spec": isinstance(body.get("build_spec"), dict),
                "planner_model": STUDIO2_PLANNER_MODEL,
                "builder_model": STUDIO2_BUILDER_MODEL,
            },
        )

    registry_summary = _studio2_build_registry_summary(request)
    registry_header = _studio2_registry_header(registry_summary)
    registry_text = json.dumps(registry_header, separators=(",", ":"))
    pattern_memory = _load_pattern_memory()
    patterns = pattern_memory.get("patterns") if isinstance(pattern_memory, dict) else {}
    pattern_key = _infer_pattern_key(message, module_id)
    pattern_hint = patterns.get(pattern_key) if isinstance(patterns, dict) and pattern_key else None

    system_pack = _load_prompt_pack("system.md")
    contract_pack = _load_prompt_pack("manifest_contract_v1_3.md")
    ui_pack = _load_prompt_pack("ui_rules.md")
    patch_protocol = _load_prompt_pack("patch_protocol.md")
    system_text = "\n\n".join([system_pack, contract_pack, ui_pack, patch_protocol]).strip()

    history = []
    if isinstance(chat_history, list):
        for item in chat_history[-6:]:
            if not isinstance(item, dict):
                continue
            role = item.get("role")
            text = item.get("text")
            if role in {"user", "assistant"} and isinstance(text, str):
                history.append({"role": role, "content": text[:800]})

    base_draft = drafts.get_draft(module_id)
    if base_draft and isinstance(base_draft.get("manifest"), dict):
        base_manifest = base_draft.get("manifest")
    else:
        base_manifest = _build_scaffold_template(module_id, None, pattern_key)
    base_manifest = _ensure_app_home(_ensure_module_id(_sanitize_manifest(base_manifest or {}), module_id))

    actor = getattr(request.state, "user", None)
    created_by = actor.get("email") if isinstance(actor, dict) else None
    ctx = AgentContext(
        module_id=module_id,
        user_id=created_by,
        registry_snapshot=registry_header,
        base_manifest=copy.deepcopy(base_manifest),
        working_manifest=copy.deepcopy(base_manifest),
        request_id=request_id_value,
    )

    build_spec = body.get("build_spec") if isinstance(body, dict) else None
    wall_start = time.perf_counter()
    planner_ms = 0.0
    openai_total_ms = 0.0
    if not isinstance(build_spec, dict):
        planner_pack = _load_prompt_pack("planner.md")
        planner_system = "\n\n".join([planner_pack, contract_pack]).strip()
        planner_context = {
            "module_id": module_id,
            "module_summary": _studio2_prompt_manifest_summary(ctx.base_manifest),
            "registry": registry_header if len(registry_text.encode("utf-8")) <= STUDIO2_MAX_REGISTRY_BYTES else {"modules": []},
            "pattern": {"key": pattern_key, "data": pattern_hint} if pattern_hint else None,
            "history": history,
        }
        planner_text = json.dumps(planner_context, separators=(",", ":"))
        planner_messages = [
            {"role": "system", "content": planner_system},
            {"role": "user", "content": message},
            {"role": "user", "content": f"context.json\n```json\n{planner_text}\n```"},
        ]
        if progress:
            progress.emit("stage_started", "planning", None, {"stage": "planning"})
            progress.emit("planner_started", "planning", None, {"model": STUDIO2_PLANNER_MODEL})
        planner_start = time.perf_counter()
        try:
            planner_resp = _openai_chat_completion(planner_messages, model=STUDIO2_PLANNER_MODEL)
        except Exception as exc:
            return _error_response("OPENAI_ERROR", "Planner request failed", detail={"error": str(exc)}, status=502)
        planner_ms = (time.perf_counter() - planner_start) * 1000
        openai_total_ms += planner_ms
        planner_choices = planner_resp.get("choices") or []
        planner_content = planner_choices[0].get("message", {}).get("content") if planner_choices else None
        if not planner_content:
            return _error_response("OPENAI_EMPTY", "Planner returned empty response", status=502)
        build_spec, spec_diag = _extract_build_spec_from_response(planner_content)
        if not isinstance(build_spec, dict):
            return _error_response("PLANNER_PARSE_FAILED", "Planner response parse failed", detail=spec_diag)

    build_spec_hash = _hash_json(build_spec) if isinstance(build_spec, dict) else None
    if progress and isinstance(build_spec, dict):
        progress.emit(
            "planner_result",
            "planning",
            None,
            {
                "build_spec_hash": build_spec_hash,
                "build_spec_summary": summarize_build_spec(build_spec),
                "pattern_key": pattern_key,
            },
        )
        progress.emit("stage_done", "planning", None, {"stage": "planning"})
        progress.emit("planner_done", "planning", None, {"stage": "planning"})

    # Agent loop runs fully in-memory; persistence happens once after convergence/stop.
    plan_payload: dict | None = None
    notes_text: str | None = None
    last_validation = {"errors": [], "warnings": [], "strict": [], "completeness": [], "design": []}
    best_iteration: dict | None = None
    stop_reason = None
    ops_count = 0
    prev_error_counts: list[int] = []
    prev_strict_fp: str | None = None
    strict_repeat = 0
    planner_repeat = 0
    prev_build_spec_hash: str | None = None
    best_index = 0
    prev_manifest_hash: str | None = None
    prev_error_fp: str | None = None

    is_new = base_draft is None and _get_module(request, module_id) is None

    for attempt in range(MAX_AGENT_ITERS):
        iter_start = time.perf_counter()
        manifest_before = copy.deepcopy(ctx.working_manifest)
        manifest_before_hash = _hash_json(ctx.working_manifest)

        summary_cache = ctx.cache.setdefault("summary_by_hash", {})
        summary = summary_cache.get(manifest_before_hash)
        if summary is None:
            summary = _studio2_prompt_manifest_summary(ctx.working_manifest)
            summary_cache[manifest_before_hash] = summary

        errors_fp = _fingerprint_errors(last_validation["errors"]) if last_validation["errors"] else ""
        snippet_cache = ctx.cache.setdefault("snippets", {})
        snippet_key = f"{manifest_before_hash}:{errors_fp}"
        snippets = snippet_cache.get(snippet_key)
        if snippets is None:
            snippets = _extract_error_snippets(ctx.working_manifest, last_validation["errors"])
            snippet_cache[snippet_key] = snippets

        context = {
            "module_id": module_id,
            "module_summaries": {module_id: summary},
            "build_spec": build_spec,
            "errors": {module_id: last_validation["errors"]},
            "warnings": {module_id: last_validation["warnings"]},
            "design_warnings": {module_id: last_validation["design"]},
            "snippets": {module_id: snippets},
            "registry": registry_header if len(registry_text.encode("utf-8")) <= STUDIO2_MAX_REGISTRY_BYTES else {"modules": []},
            "history": history,
            "pattern": {"key": pattern_key, "data": pattern_hint} if pattern_hint else None,
        }
        linked = ctx.cache.get("linked_manifests")
        if isinstance(linked, dict) and linked:
            context["linked_manifests"] = linked
        context_text = json.dumps(context, separators=(",", ":"))
        if len(context_text.encode("utf-8")) > STUDIO2_MAX_CONTEXT_BYTES:
            context["registry"] = {"modules": []}
            context["snippets"] = {}
            context_text = json.dumps(context, separators=(",", ":"))
        if len(context_text.encode("utf-8")) > STUDIO2_MAX_CONTEXT_BYTES:
            context.pop("linked_manifests", None)
            context_text = json.dumps(context, separators=(",", ":"))

        constraints = (
            "Return strict JSON only. Include plan + calls (tool calls only). No prose. "
            "Do NOT include ops or ops_by_module. "
            "Allowed tools: ensure_entity, ensure_entity_pages, ensure_nav, ensure_actions_for_status, "
            "ensure_relation, ensure_workflow, ensure_ui_pattern, read_manifest. "
            "calls schema: [{\"tool\":\"<allowed>\",\"module_id\":\"<target>\",\"args\":{...}}]. "
            "Do NOT invent tool names. If unsure, choose ensure_entity + ensure_entity_pages + ensure_nav. "
            "If validation includes MANIFEST_* schema errors, you MUST emit at least one tool call. "
            "Workflow schema (required): workflows[] items MUST include id, entity, status_field, states; "
            "states MUST be array of objects: [{\"id\":\"draft\",\"label\":\"Draft\"}, ...]. "
            "Do NOT output states as strings."
        )
        task_template = _load_prompt_pack("task.md")
        task_text = task_template.replace("{{message}}", message).replace("{{constraints}}", constraints)

        messages = [
            {"role": "system", "content": system_text},
            *history,
            {"role": "user", "content": f"context.json\n```json\n{context_text}\n```"},
            {"role": "user", "content": f"task.md\n```\n{task_text}\n```"},
        ]

        target_bytes = len(json.dumps(summary, separators=(",", ":")).encode("utf-8"))
        tokens_est = int(sum(len(m.get("content", "")) for m in messages) / 4)
        logger.info(
            "studio2_agent registry_summary_bytes=%s target_manifest_bytes=%s messages_tokens_estimate=%s model=%s base_url=%s",
            len(registry_text.encode("utf-8")),
            target_bytes,
            tokens_est,
            STUDIO2_BUILDER_MODEL,
            OPENAI_BASE_URL,
        )
        if STUDIO2_AGENT_DEBUG:
            msg_len = len(message or "")
            logger.info("studio2_agent prompt_debug message_len=%s errors_count=%s", msg_len, len(last_validation["errors"]))
        if STUDIO2_AGENT_LOG_PAYLOAD:
            trimmed_messages = []
            for msg in messages:
                role = msg.get("role")
                content = msg.get("content", "")
                snippet = content[:800]
                trimmed_messages.append({"role": role, "content": snippet, "truncated": len(content) > 800})
            logger.info("studio2_agent payload_preview=%s", json.dumps(trimmed_messages))

        if progress:
            progress.emit("stage_started", "building", attempt, {"stage": "building"})
            progress.emit("builder_started", "building", attempt, {"model": STUDIO2_BUILDER_MODEL})
        builder_start = time.perf_counter()
        try:
            response = _openai_chat_completion(messages, model=STUDIO2_BUILDER_MODEL)
        except urllib.error.HTTPError as exc:
            try:
                payload = exc.read().decode("utf-8")
            except Exception:
                payload = None
            if STUDIO2_AGENT_DEBUG:
                logger.warning("studio2_agent openai_http_error status=%s body=%s", exc.code, payload)
            return _error_response("OPENAI_ERROR", "OpenAI request failed", detail={"status": exc.code, "body": payload}, status=502)
        except urllib.error.URLError as exc:
            if STUDIO2_AGENT_DEBUG:
                logger.warning("studio2_agent openai_url_error error=%s", str(exc))
            return _error_response("OPENAI_TIMEOUT", "OpenAI request timed out", detail={"error": str(exc)}, status=504)
        except Exception as exc:
            if STUDIO2_AGENT_DEBUG:
                logger.warning("studio2_agent openai_error error=%s", str(exc))
            return _error_response("OPENAI_ERROR", "OpenAI request failed", detail={"error": str(exc)}, status=502)
        builder_ms = (time.perf_counter() - builder_start) * 1000
        openai_total_ms += builder_ms

        choices = response.get("choices") or []
        content = choices[0].get("message", {}).get("content") if choices else None
        if not content:
            return _error_response("OPENAI_EMPTY", "OpenAI returned empty response", status=502)

        plan_ops, diagnostics = _extract_patch_ops_from_response(content)
        if not isinstance(plan_ops, dict):
            return _error_response("AGENT_PARSE_FAILED", "agent response parse failed", detail=diagnostics)

        plan_payload = plan_ops.get("plan") if isinstance(plan_ops.get("plan"), dict) else None
        notes_text = plan_ops.get("notes") if isinstance(plan_ops.get("notes"), str) else None
        tool_ops = plan_ops.get("ops")
        calls = plan_ops.get("calls")
        if tool_ops is not None and isinstance(tool_ops, list):
            calls = tool_ops
        if calls is None:
            calls = []
        if not isinstance(calls, list):
            return _error_response("AGENT_SCHEMA_INVALID", "calls must be list", "calls")

        ops_by_module = plan_ops.get("ops_by_module")
        if ops_by_module is None:
            ops_by_module = []
        if not isinstance(ops_by_module, list):
            return _error_response("AGENT_SCHEMA_INVALID", "ops_by_module required", "ops_by_module")
        if _studio2_contains_patch_ops(plan_ops):
            last_validation = {
                "errors": [
                    {
                        "code": "AGENT_OPS_DISABLED_FOR_STUDIO2",
                        "message": "Patch ops are disabled for Studio2; use tools only",
                        "path": "ops",
                        "detail": {"hint": "Use tools; ops are disabled"},
                    }
                ],
                "warnings": [],
                "strict": [],
                "completeness": [],
                "design": [],
            }
            stop_reason = "invalid"
            if progress:
                progress.emit("stage_started", "validating", attempt, {"stage": "validating"})
                progress.emit(
                    "validate_result",
                    "validating",
                    attempt,
                    {
                        "error_counts": {"schema": 1, "strict": 0, "completeness": 0, "total": 1},
                        "top_errors": top_errors(last_validation["errors"]),
                        "warnings_count": 0,
                        "design_warnings_count": 0,
                    },
                )
                progress.emit("stage_done", "validating", attempt, {"stage": "validating"})
            break

        prev_total_errors = _count_errors(last_validation["errors"], last_validation["strict"], last_validation["completeness"])
        if prev_total_errors > 0 and len(calls) == 0:
            hint = "No tool calls were produced. You must emit at least one allowed tool call when errors exist."
            last_validation = {
                "errors": [
                    {
                        "code": "AGENT_NO_TOOL_CALLS",
                        "message": hint,
                        "path": "calls",
                        "detail": {"hint": hint},
                    }
                ],
                "warnings": [],
                "strict": [],
                "completeness": [],
                "design": [],
            }
            best_iteration = {
                "index": attempt,
                "manifest": copy.deepcopy(ctx.working_manifest),
                "total_errors": 1,
                "strict_errors": 0,
                "completeness_errors": 0,
                "validation": last_validation,
                "calls": [],
                "ops_by_module": [],
            }
            best_index = attempt
            stop_reason = "no_effect"
            if notes_text:
                if hint not in notes_text:
                    notes_text = f"{notes_text.strip()} {hint}".strip()
            else:
                notes_text = hint
            if progress:
                progress.emit("stage_started", "validating", attempt, {"stage": "validating"})
                progress.emit(
                    "validate_result",
                    "validating",
                    attempt,
                    {
                        "error_counts": {"schema": 1, "strict": 0, "completeness": 0, "total": 1},
                        "top_errors": top_errors(last_validation["errors"]),
                        "warnings_count": 0,
                        "design_warnings_count": 0,
                    },
                )
                progress.emit("stage_done", "validating", attempt, {"stage": "validating"})
            break

        planned_ops_count = sum(len(entry.get("ops", [])) for entry in ops_by_module if isinstance(entry, dict))
        tools_used = sorted({call.get("tool") for call in calls if isinstance(call, dict) and call.get("tool")})
        if progress:
            progress.emit(
                "builder_result",
                "building",
                attempt,
                {
                    "plan_summary": summarize_plan(plan_payload, notes_text),
                    "ops_count": planned_ops_count,
                    "tools_used": tools_used,
                    "calls_preview": preview_calls(calls, STUDIO2_AGENT_STREAM_DEBUG),
                },
            )
            progress.emit("stage_done", "building", attempt, {"stage": "building"})
            progress.emit("builder_done", "building", attempt, {"stage": "building"})

        apply_start = time.perf_counter()
        if progress:
            progress.emit("stage_started", "applying", attempt, {"stage": "applying"})
            progress.emit("apply_started", "applying", attempt, {})
        applied_ops = []
        applied_calls = []
        local_errors: list[dict] = []

        for call in calls:
            if not isinstance(call, dict):
                local_errors.append({"code": "CALL_INVALID", "message": "call must be object", "path": "calls"})
                continue
            tool = _studio2_normalize_tool_name(call.get("tool"))
            call_module_id = call.get("module_id") or call.get("args", {}).get("module_id")
            entity_id = call.get("entity_id") or call.get("args", {}).get("entity_id")
            entity_def = call.get("entity") or call.get("args", {}).get("entity")
            relation_def = call.get("relation") or call.get("args", {}).get("relation")
            workflow_def = call.get("workflow") or call.get("args", {}).get("workflow")
            pattern_def = call.get("pattern") or call.get("args", {}).get("pattern")
            if tool not in {
                "ensure_entity",
                "ensure_entity_pages",
                "ensure_nav",
                "ensure_actions_for_status",
                "ensure_relation",
                "ensure_workflow",
                "ensure_ui_pattern",
                "read_manifest",
            }:
                local_errors.append({"code": "CALL_INVALID", "message": "unknown tool", "path": "calls.tool", "detail": {"tool": tool}})
                continue
            if tool != "read_manifest" and call_module_id != module_id:
                local_errors.append({"code": "CALL_INVALID", "message": "module_id mismatch", "path": "calls.module_id"})
                continue
            base = ctx.working_manifest
            if tool == "ensure_entity":
                if isinstance(entity_def, dict):
                    base = _studio2_tool_ensure_entity_def(base, entity_def)
                elif isinstance(entity_id, str):
                    base = _studio2_tool_ensure_entity(base, entity_id)
                else:
                    local_errors.append({"code": "CALL_INVALID", "message": "entity_id or entity required", "path": "calls.entity_id"})
                    continue
                base = _studio2_enforce_architecture(base)
            elif tool == "ensure_entity_pages":
                if not isinstance(entity_id, str):
                    local_errors.append({"code": "CALL_INVALID", "message": "entity_id required", "path": "calls.entity_id"})
                    continue
                base = _studio2_tool_ensure_entity_pages(base, entity_id)
            elif tool == "ensure_nav":
                base = _studio2_tool_ensure_nav(base)
            elif tool == "ensure_actions_for_status":
                base = _studio2_tool_ensure_status_actions(base, entity_id if isinstance(entity_id, str) else None)
            elif tool == "ensure_relation":
                if not isinstance(relation_def, dict):
                    local_errors.append({"code": "CALL_INVALID", "message": "relation required", "path": "calls.relation"})
                    continue
                result = _studio2_tool_ensure_relation(base, relation_def)
                if isinstance(result, dict) and result.get("ok") is False:
                    local_errors.append(
                        {
                            "code": "CALL_INVALID",
                            "message": result.get("reason", "relation rejected"),
                            "path": "calls.relation",
                            "detail": {"missing": result.get("missing")},
                        }
                    )
                    continue
                base = result if isinstance(result, dict) else base
            elif tool == "ensure_workflow":
                if not isinstance(workflow_def, dict):
                    local_errors.append({"code": "CALL_INVALID", "message": "workflow required", "path": "calls.workflow"})
                    continue
                result = _studio2_tool_ensure_workflow(base, workflow_def)
                if isinstance(result, dict) and result.get("ok") is False:
                    local_errors.append(
                        {
                            "code": "CALL_INVALID",
                            "message": result.get("reason", "workflow rejected"),
                            "path": "calls.workflow",
                            "detail": {"hint": result.get("hint")},
                        }
                    )
                    continue
                if isinstance(result, dict) and isinstance(result.get("manifest"), dict):
                    base = result.get("manifest")
                elif isinstance(result, dict):
                    base = result
            elif tool == "ensure_ui_pattern":
                base = _studio2_tool_ensure_ui_pattern(base, pattern_def if isinstance(pattern_def, dict) else None)
            elif tool == "read_manifest":
                if not isinstance(call_module_id, str) or not call_module_id:
                    local_errors.append({"code": "CALL_INVALID", "message": "module_id required", "path": "calls.module_id"})
                    continue
                level = call.get("level") or call.get("args", {}).get("level")
                result = _studio2_read_manifest_payload(request, call_module_id, level if isinstance(level, str) else None)
                cache = ctx.cache.setdefault("linked_manifests", {})
                if isinstance(cache, dict) and result.get("ok"):
                    cache[call_module_id] = result
                elif not result.get("ok"):
                    local_errors.append(
                        {
                            "code": "CALL_INVALID",
                            "message": result.get("error", {}).get("message", "read_manifest failed"),
                            "path": "calls.module_id",
                        }
                    )
                applied_calls.append(call)
                continue
            ctx.working_manifest = base
            applied_calls.append(call)

        for entry in ops_by_module:
            if not isinstance(entry, dict):
                local_errors.append({"code": "OPS_INVALID", "message": "ops_by_module entry invalid", "path": "ops_by_module"})
                continue
            mod_id = entry.get("module_id")
            ops = entry.get("ops")
            if not isinstance(mod_id, str) or not isinstance(ops, list):
                local_errors.append({"code": "OPS_INVALID", "message": "module_id and ops required", "path": "ops_by_module"})
                continue
            if mod_id != module_id:
                local_errors.append({"code": "OPS_CROSS_MODULE_FORBIDDEN", "message": "cross-module ops not enabled", "path": "ops_by_module"})
                continue
            guard_errors = _studio2_guard_ops(mod_id, ops, is_new)
            if guard_errors:
                local_errors.extend(guard_errors)
                continue
            applied = _studio2_apply_ops(ctx.working_manifest, ops)
            if not applied.get("ok"):
                local_errors.extend(applied.get("errors", []))
                continue
            updated_manifest = applied.get("manifest")
            if isinstance(updated_manifest, dict):
                updated_manifest = _ensure_app_home(_ensure_module_id(_sanitize_manifest(updated_manifest), mod_id))
                updated_manifest = _studio2_enforce_architecture(updated_manifest)
            ctx.working_manifest = updated_manifest
            applied_ops.append({"module_id": mod_id, "ops": applied.get("resolved_ops", [])})

        normalization_warnings: list[dict] = []
        if not local_errors:
            normalize_cache = ctx.cache.setdefault("normalize_cache", {})
            ctx.working_manifest, normalization_warnings = normalize_manifest_v13(
                ctx.working_manifest, module_id=module_id, cache=normalize_cache
            )

        apply_ops_ms = (time.perf_counter() - apply_start) * 1000
        ops_count = sum(len(entry.get("ops", [])) for entry in applied_ops)
        diff_summary = diff_manifest(manifest_before, ctx.working_manifest)
        if progress:
            progress.emit(
                "apply_result",
                "applying",
                attempt,
                {
                    "changed": manifest_before_hash != diff_summary.get("manifest_hash"),
                    "diff_summary": {
                        "entities_added": diff_summary.get("entities_added"),
                        "pages_added": diff_summary.get("pages_added"),
                        "views_added": diff_summary.get("views_added"),
                        "actions_added": diff_summary.get("actions_added"),
                        "nav_changes": diff_summary.get("nav_changes"),
                        "relations_added": diff_summary.get("relations_added"),
                        "workflows_added": diff_summary.get("workflows_added"),
                    },
                    "manifest_hash": diff_summary.get("manifest_hash"),
                },
            )
            progress.emit("stage_done", "applying", attempt, {"stage": "applying"})
            progress.emit("apply_done", "applying", attempt, {"stage": "applying"})

        validate_start = time.perf_counter()
        if progress:
            progress.emit("stage_started", "validating", attempt, {"stage": "validating"})
            progress.emit("validate_started", "validating", attempt, {})
        validation_errors = []
        validation_warnings = []
        strict_errors_all = []
        completeness_issues = []
        design_warnings = []
        if not local_errors:
            _, errors, warnings = validate_manifest_raw(ctx.working_manifest, expected_module_id=module_id)
            if errors:
                for err in errors:
                    entry = _normalize_validation_entry(err)
                    entry["module_id"] = module_id
                    validation_errors.append(entry)
            strict_errors = _studio2_strict_validate(ctx.working_manifest, expected_module_id=module_id)
            if strict_errors:
                for err in strict_errors:
                    entry = _normalize_validation_entry(err)
                    entry["module_id"] = module_id
                    validation_errors.append(entry)
                    strict_errors_all.append(entry)
            if warnings:
                for warn in warnings:
                    entry = _normalize_validation_entry(warn)
                    entry["module_id"] = module_id
                    validation_warnings.append(entry)
            if normalization_warnings:
                for warn in normalization_warnings:
                    entry = _normalize_validation_entry(warn)
                    entry["module_id"] = module_id
                    validation_warnings.append(entry)
            for warn in _studio2_design_warnings(ctx.working_manifest):
                entry = _normalize_validation_entry(warn)
                entry["module_id"] = module_id
                design_warnings.append(entry)
            if not errors:
                for issue in _studio2_completeness_check(ctx.working_manifest):
                    entry = _normalize_validation_entry(issue)
                    entry["module_id"] = module_id
                    completeness_issues.append(entry)
        validate_ms = (time.perf_counter() - validate_start) * 1000

        last_validation = {
            "errors": validation_errors if not local_errors else local_errors,
            "warnings": validation_warnings,
            "strict": strict_errors_all,
            "completeness": completeness_issues,
            "design": design_warnings,
        }

        if local_errors:
            call_invalid = [err for err in local_errors if err.get("code") == "CALL_INVALID"]
            if call_invalid:
                last_validation["errors"] = list(local_errors) + [
                    {
                        "code": "CALL_INVALID_HINT",
                        "message": "Unknown tool. Allowed tools are: ensure_entity, ensure_entity_pages, ensure_nav, ensure_actions_for_status, ensure_relation, ensure_workflow, ensure_ui_pattern, read_manifest.",
                        "path": "calls.tool",
                    }
                ]

        total_errors = _count_errors(last_validation["errors"], last_validation["strict"], last_validation["completeness"])
        strict_fp = _fingerprint_errors(last_validation["strict"]) if last_validation["strict"] else ""
        completeness_fp = _fingerprint_errors(last_validation["completeness"]) if last_validation["completeness"] else ""
        ops_fp = _hash_json({"calls": applied_calls, "ops": applied_ops})
        manifest_after_hash = _hash_json(ctx.working_manifest)
        error_fp = _fingerprint_errors(
            (last_validation["errors"] or []) + (last_validation["strict"] or []) + (last_validation["completeness"] or [])
        )

        if total_errors == 0 and manifest_after_hash == manifest_before_hash:
            warn_count = len(last_validation.get("warnings", [])) + len(last_validation.get("design", []))
            if warn_count > 0:
                notes_text = "No changes applied. Warnings are advisory."

        if progress:
            progress.emit(
                "validate_result",
                "validating",
                attempt,
                {
                    "error_counts": {
                        "schema": len(last_validation["errors"]),
                        "strict": len(last_validation["strict"]),
                        "completeness": len(last_validation["completeness"]),
                        "total": total_errors,
                    },
                    "top_errors": top_errors(last_validation["errors"] or last_validation["strict"] or last_validation["completeness"]),
                    "warnings_count": len(last_validation["warnings"]),
                    "design_warnings_count": len(last_validation["design"]),
                },
            )
            progress.emit("stage_done", "validating", attempt, {"stage": "validating"})
            progress.emit("validate_done", "validating", attempt, {"stage": "validating"})

        iter_log = {
            "iteration": attempt + 1,
            "planner_ms": round(planner_ms, 2) if attempt == 0 else 0.0,
            "builder_ms": round(builder_ms, 2),
            "apply_ops_ms": round(apply_ops_ms, 2),
            "validate_ms": round(validate_ms, 2),
            "iter_total_ms": round((time.perf_counter() - iter_start) * 1000, 2),
            "error_counts": {
                "schema": len(last_validation["errors"]),
                "strict": len(last_validation["strict"]),
                "completeness": len(last_validation["completeness"]),
                "total": total_errors,
            },
            "build_spec_hash": build_spec_hash,
            "ops_count": ops_count,
            "ops_fingerprint": ops_fp,
            "strict_fingerprint": strict_fp,
            "completeness_fingerprint": completeness_fp,
        }
        ctx.stats["iteration_logs"].append(iter_log)
        logger.info(
            "studio2_agent_iter request_id=%s module_id=%s iter=%s total_errors=%s strict_errors=%s completeness_errors=%s",
            ctx.request_id,
            module_id,
            attempt + 1,
            total_errors,
            len(last_validation["strict"]),
            len(last_validation["completeness"]),
        )
        if progress:
            progress.emit(
                "iter_timing",
                "metrics",
                attempt,
                {
                    "planner_ms": iter_log.get("planner_ms"),
                    "builder_ms": iter_log.get("builder_ms"),
                    "apply_ms": iter_log.get("apply_ops_ms"),
                    "validate_ms": iter_log.get("validate_ms"),
                    "iter_total_ms": iter_log.get("iter_total_ms"),
                },
            )

        current_iter_state = {
            "index": attempt,
            "manifest": copy.deepcopy(ctx.working_manifest),
            "total_errors": total_errors,
            "strict_errors": len(last_validation["strict"]),
            "completeness_errors": len(last_validation["completeness"]),
            "validation": last_validation,
            "calls": applied_calls,
            "ops_by_module": applied_ops,
        }
        best_iteration = _update_best_iteration(best_iteration, current_iter_state)
        best_index = best_iteration["index"] if best_iteration else 0

        if total_errors == 0:
            stop_reason = "pass"
            break

        only_call_invalid = False
        if local_errors and all(err.get("code") == "CALL_INVALID" for err in local_errors):
            only_call_invalid = True

        if attempt >= 1 and not only_call_invalid:
            if manifest_after_hash == prev_manifest_hash and error_fp == prev_error_fp:
                stop_reason = "no_effect"
                break

        prev_error_counts.append(total_errors)
        if len(prev_error_counts) >= 3:
            if prev_error_counts[-1] >= prev_error_counts[-2] >= prev_error_counts[-3]:
                stop_reason = "no_progress"
                break

        if strict_fp:
            if strict_fp == prev_strict_fp:
                strict_repeat += 1
            else:
                strict_repeat = 0
            prev_strict_fp = strict_fp
            if strict_repeat >= 1:
                stop_reason = "repeated_errors"
                break

        if build_spec_hash:
            if build_spec_hash == prev_build_spec_hash:
                planner_repeat += 1
            else:
                planner_repeat = 0
            prev_build_spec_hash = build_spec_hash
            if planner_repeat >= 1 and attempt >= 1:
                if manifest_after_hash == prev_manifest_hash and error_fp == prev_error_fp:
                    stop_reason = "planner_repeat"
                    break

        if attempt == MAX_AGENT_ITERS - 1:
            stop_reason = "max_iters"
            break

        prev_manifest_hash = manifest_after_hash
        prev_error_fp = error_fp

    if stop_reason is None:
        stop_reason = "max_iters"

    if progress:
        progress.emit(
            "stopped",
            "stop",
            None,
            {
                "stop_reason": stop_reason,
                "best_iter": best_index,
                "final_error_counts": {
                    "schema": len(last_validation.get("errors", [])),
                    "strict": len(last_validation.get("strict", [])),
                    "completeness": len(last_validation.get("completeness", [])),
                },
            },
        )

    final_state = best_iteration if best_iteration else {
        "index": 0,
        "manifest": ctx.working_manifest,
        "validation": last_validation,
        "calls": [],
        "ops_by_module": [],
        "total_errors": _count_errors(last_validation["errors"], last_validation["strict"], last_validation["completeness"]),
        "strict_errors": len(last_validation["strict"]),
        "completeness_errors": len(last_validation["completeness"]),
    }

    ops_with_meta = list(final_state.get("ops_by_module") or [])
    ops_with_meta.append(
        {
            "meta": {
                "build_spec_hash": build_spec_hash,
                "iterations": len(ctx.stats["iteration_logs"]),
                "stop_reason": stop_reason,
                "ops_applied_count": ops_count,
                "timing_summary": ctx.stats["iteration_logs"],
            }
        }
    )

    draft_version = drafts.create_draft_version(
        module_id,
        final_state["manifest"],
        note=f"ai: {message[:120]} stop:{stop_reason}",
        created_by=created_by,
        parent_version_id=None,
        ops_applied=ops_with_meta,
        validation_errors=final_state["validation"].get("errors"),
    )

    db_stats = get_db_stats()
    db_q = len(get_db_query_log())
    total_ms = (time.perf_counter() - wall_start) * 1000
    summary_log = {
        "request_id": ctx.request_id,
        "module_id": module_id,
        "iterations": len(ctx.stats["iteration_logs"]),
        "stop_reason": stop_reason,
        "total_ms": round(total_ms, 2),
        "openai_total_ms": round(openai_total_ms, 2),
        "db_ms": round(db_stats.get("execute_ms", 0.0), 2),
        "db_q": db_q,
        "final_errors": final_state["total_errors"],
    }
    logger.info("studio2_agent_summary %s", json.dumps(summary_log))

    payload = {
        "assistant_message": notes_text or "",
        "plan": plan_payload,
        "notes": notes_text,
        "calls": final_state.get("calls", []),
        "ops_by_module": final_state.get("ops_by_module", []),
        "drafts": {module_id: final_state["manifest"]},
        "validation": {
            "errors": final_state["validation"].get("errors", []),
            "warnings": final_state["validation"].get("warnings", []),
            "strict_errors": final_state["validation"].get("strict", []),
            "completeness_errors": final_state["validation"].get("completeness", []),
            "design_warnings": final_state["validation"].get("design", []),
        },
        "stop_reason": stop_reason,
        "iterations": len(ctx.stats["iteration_logs"]),
        "timing_summary": {
            "total_ms": round(total_ms, 2),
            "openai_total_ms": round(openai_total_ms, 2),
            "db_ms": round(db_stats.get("execute_ms", 0.0), 2),
            "db_q": db_q,
            "per_iter": ctx.stats["iteration_logs"],
        },
        "persisted_draft_id": draft_version.get("id"),
        "best_iteration_index": best_index,
        "last_build_spec_hash": build_spec_hash,
    }
    if include_progress and progress:
        payload["progress"] = progress.to_progress_list()

    return _ok_response({"data": payload})


@app.post("/studio2/agent/plan")
async def studio2_agent_plan(request: Request) -> dict:
    if not _openai_configured():
        return _openai_not_configured()
    body = await _safe_json(request)
    message = body.get("message") if isinstance(body, dict) else None
    module_id = body.get("module_id") if isinstance(body, dict) else None
    if not isinstance(message, str):
        return _error_response("AGENT_INVALID", "message required", "message")
    registry_summary = _studio2_build_registry_summary(request)
    registry_header = _studio2_registry_header(registry_summary)
    registry_text = json.dumps(registry_header, separators=(",", ":"))
    pattern_memory = _load_pattern_memory()
    patterns = pattern_memory.get("patterns") if isinstance(pattern_memory, dict) else {}
    pattern_key = _infer_pattern_key(message, module_id if isinstance(module_id, str) else None)
    pattern_hint = patterns.get(pattern_key) if isinstance(patterns, dict) and pattern_key else None
    base_manifest = _build_scaffold_template(module_id or "new_module", None, pattern_key)
    context = {
        "module_id": module_id,
        "module_summary": _studio2_prompt_manifest_summary(base_manifest),
        "registry": registry_header if len(registry_text.encode("utf-8")) <= STUDIO2_MAX_REGISTRY_BYTES else {"modules": []},
        "pattern": {"key": pattern_key, "data": pattern_hint} if pattern_hint else None,
    }
    context_text = json.dumps(context, separators=(",", ":"))
    planner_pack = _load_prompt_pack("planner.md")
    contract_pack = _load_prompt_pack("manifest_contract_v1_3.md")
    planner_system = "\n\n".join([planner_pack, contract_pack]).strip()
    messages = [
        {"role": "system", "content": planner_system},
        {"role": "user", "content": message},
        {"role": "user", "content": f"context.json\n```json\n{context_text}\n```"},
    ]
    try:
        response = _openai_chat_completion(messages, model=STUDIO2_PLANNER_MODEL)
    except Exception as exc:
        return _error_response("OPENAI_ERROR", "Planner request failed", detail={"error": str(exc)}, status=502)
    choices = response.get("choices") or []
    content = choices[0].get("message", {}).get("content") if choices else None
    if not content:
        return _error_response("OPENAI_EMPTY", "Planner returned empty response", status=502)
    build_spec, diag = _extract_build_spec_from_response(content)
    if not isinstance(build_spec, dict):
        return _error_response("PLANNER_PARSE_FAILED", "Planner response parse failed", detail=diag)
    return _ok_response({"data": {"build_spec": build_spec}})


@app.get("/studio2/agent/status")
async def studio2_agent_status() -> dict:
    if not _openai_configured():
        return _ok_response({"data": {"configured": False}})
    return _ok_response(
        {
            "data": {
                "configured": True,
                "model": OPENAI_MODEL,
                "planner_model": STUDIO2_PLANNER_MODEL,
                "builder_model": STUDIO2_BUILDER_MODEL,
                "base_url": OPENAI_BASE_URL,
            }
        }
    )


@app.get("/audit")
async def audit_feed(request: Request, limit: int = 50, module_id: str | None = None, since: str | None = None) -> dict:
    events: list[dict] = []
    warnings: list[dict] = []
    if USE_DB:
        params = [get_org_id()]
        where = "org_id=%s"
        if module_id:
            where += " and module_id=%s"
            params.append(module_id)
        if since:
            where += " and created_at >= %s"
            params.append(since)
        params.append(limit)
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                f"""
                select audit_id, audit, created_at
                from module_audit
                where {where}
                order by created_at desc
                limit %s
                """,
                params,
                query_name="module_audit.feed",
            )
        for row in rows:
            audit_raw = row.get("audit") or {}
            audit = audit_raw if isinstance(audit_raw, dict) else json.loads(audit_raw)
            action = (audit.get("action") or "").upper()
            event_type = f"MODULE_{action}" if action else "MODULE_EVENT"
            events.append(
                {
                    "id": audit.get("audit_id") or row.get("audit_id"),
                    "ts": audit.get("at") or row.get("created_at"),
                    "actor": audit.get("actor"),
                    "type": event_type,
                    "module_id": audit.get("module_id"),
                    "status": "ok",
                    "detail": audit,
                }
            )
    else:
        modules = registry.list()
        for mod in modules:
            if module_id and mod.get("module_id") != module_id:
                continue
            for audit in registry.history(mod.get("module_id")):
                if since and audit.get("at") and audit.get("at") < since:
                    continue
                action = (audit.get("action") or "").upper()
                event_type = f"MODULE_{action}" if action else "MODULE_EVENT"
                events.append(
                    {
                        "id": audit.get("audit_id"),
                        "ts": audit.get("at"),
                        "actor": audit.get("actor"),
                        "type": event_type,
                        "module_id": audit.get("module_id"),
                        "status": "ok",
                        "detail": audit,
                    }
                )
        events.sort(key=lambda e: e.get("ts") or "", reverse=True)
        events = events[:limit]
        if not events:
            warnings.append({"code": "AUDIT_NOT_AVAILABLE_IN_MEMORY", "message": "No audit events in memory", "path": None, "detail": None})

    return _ok_response({"data": {"events": events}}, warnings=warnings)


@app.get("/debug/diagnostics")
async def debug_diagnostics(request: Request) -> dict:
    data = build_diagnostics(
        registry,
        lambda module_id, manifest_hash: _get_snapshot(request, module_id, manifest_hash),
    )
    return _ok_response({"data": data})


@app.post("/actions/run")
async def run_action(request: Request) -> dict:
    body = await _safe_json(request)
    module_id = body.get("module_id") if isinstance(body, dict) else None
    action_id = body.get("action_id") if isinstance(body, dict) else None
    context = body.get("context") if isinstance(body, dict) else {}
    return _run_action_core(request, module_id, action_id, context)


def _run_action_core(request: Request, module_id: str | None, action_id: str | None, context: dict | None) -> dict:
    action_start = time.perf_counter()
    phase_ms: dict[str, float] = {}
    if not isinstance(module_id, str) or not module_id:
        return _error_response("ACTION_INVALID", "module_id is required", "module_id", status=400)
    if not isinstance(action_id, str) or not action_id:
        return _error_response("ACTION_INVALID", "action_id is required", "action_id", status=400)
    context = context if isinstance(context, dict) else {}
    t0 = time.perf_counter()
    module, manifest = _get_installed_manifest(request, module_id)
    phase_ms["load_manifest"] = (time.perf_counter() - t0) * 1000
    if module is None:
        return _error_response("MODULE_NOT_INSTALLED", "Module not installed", "module_id", status=404)
    if not module.get("enabled"):
        return _error_response("MODULE_DISABLED", "Module is disabled", "module_id", status=400)
    if manifest is None:
        return _error_response("MODULE_NOT_FOUND", "Module manifest not found", "module_id", status=404)

    t0 = time.perf_counter()
    manifest_hash = module.get("current_hash") if isinstance(module, dict) else None
    compiled = _get_compiled_manifest(module_id, manifest_hash, manifest) if manifest_hash else None
    action = compiled.get("action_by_id", {}).get(action_id) if isinstance(compiled, dict) else None
    if not action:
        action = _resolve_action(manifest, action_id)
    phase_ms["resolve_action"] = (time.perf_counter() - t0) * 1000
    if not action:
        return _error_response("ACTION_NOT_FOUND", "Action not found", "action_id", status=404)
    kind = action.get("kind")
    if kind not in ALLOWED_ACTION_KINDS:
        return _error_response("ACTION_INVALID", "Action kind not allowed", "kind", status=400)

    record_context = {}
    if isinstance(context, dict):
        record_context = context.get("record") or context.get("record_draft") or {}
    try:
        t0 = time.perf_counter()
        enabled_when = action.get("enabled_when")
        if enabled_when and not eval_condition(enabled_when, {"record": record_context}):
            return _error_response("ACTION_DISABLED", "Action is disabled", "action_id", status=400)
        visible_when = action.get("visible_when")
        if visible_when and not eval_condition(visible_when, {"record": record_context}):
            return _error_response("ACTION_DISABLED", "Action is hidden", "action_id", status=400)
        phase_ms["guard_eval"] = (time.perf_counter() - t0) * 1000
    except Exception:
        return _error_response("ACTION_INVALID", "Action condition failed", "action_id", status=400)

    if kind in {"navigate", "open_form", "refresh"}:
        record_id = context.get("record_id") if isinstance(context, dict) else None
        entity_id = action.get("entity_id") if isinstance(action.get("entity_id"), str) else None
        _emit_triggers(
            request,
            module_id,
            manifest,
            "action.clicked",
            {
                "action_id": action_id,
                "kind": kind,
                "entity_id": entity_id,
                "record_id": record_id,
                "changed_fields": [],
                "user_id": (getattr(request.state, "actor", None) or {}).get("user_id"),
                "timestamp": _now(),
            },
            action_id=action_id,
        )
        return _ok_response({"result": {"kind": kind, "target": action.get("target")}})

    entity_id = action.get("entity_id")
    if not isinstance(entity_id, str) or not entity_id:
        return _error_response("ACTION_INVALID", "entity_id is required", "entity_id", status=400)
    entity_id = _normalize_entity_id(entity_id)
    found = _find_entity_def(request, entity_id)
    if not found:
        return _error_response("ENTITY_NOT_FOUND", "Entity not found or disabled", "entity_id", status=404)
    entity_def = found[1]

    if kind == "create_record":
        t0 = time.perf_counter()
        values = action.get("defaults") if isinstance(action.get("defaults"), dict) else {}
        workflow = _find_entity_workflow(found[2], entity_def.get("id"))
        errors, clean = _validate_record_payload(entity_def, values, for_create=True, workflow=workflow)
        lookup_errors = _validate_lookup_fields(entity_def, _registry_for_request(request), lambda module_id, manifest_hash: _get_snapshot(request, module_id, manifest_hash))
        errors.extend(lookup_errors)
        domain_errors = _enforce_lookup_domains(entity_def, clean if isinstance(clean, dict) else {})
        errors.extend(domain_errors)
        if errors:
            _log_record_validation_errors(entity_id, values, errors, workflow)
            return _validation_response(errors, [])
        phase_ms["validate"] = (time.perf_counter() - t0) * 1000
        t0 = time.perf_counter()
        try:
            record = generic_records.create(entity_id, clean)
        except Exception as exc:
            constraint = _wrap_db_constraint_error(exc)
            if constraint:
                return _error_response(
                    "RECORD_WRITE_FAILED",
                    "Record create failed due to constraint",
                    "record",
                    detail=constraint.get("detail"),
                    status=400,
                )
            raise
        _add_chatter_entry(entity_id, record["record_id"], "system", "Record created", getattr(request.state, "user", None))
        _resp_cache_invalidate_entity(entity_id)
        phase_ms["write"] = (time.perf_counter() - t0) * 1000
        phase_ms["total"] = (time.perf_counter() - action_start) * 1000
        _action_logger.info("action_perf=%s", {"action_id": action_id, "kind": kind, "ms": phase_ms})
        created_record = record.get("record") if isinstance(record, dict) else None
        created_id = record.get("record_id") if isinstance(record, dict) else None
        if created_id and isinstance(created_record, dict):
            _emit_triggers(
                request,
                module_id,
                manifest,
                "record.created",
                {
                    "entity_id": entity_def.get("id"),
                    "record_id": created_id,
                    "changed_fields": sorted(created_record.keys()),
                    "user_id": (getattr(request.state, "actor", None) or {}).get("user_id"),
                    "timestamp": _now(),
                },
                entity_id=entity_def.get("id"),
            )
        _emit_triggers(
            request,
            module_id,
            manifest,
            "action.clicked",
            {
                "action_id": action_id,
                "kind": kind,
                "entity_id": entity_def.get("id"),
                "record_id": created_id,
                "changed_fields": sorted(created_record.keys()) if isinstance(created_record, dict) else [],
                "user_id": (getattr(request.state, "actor", None) or {}).get("user_id"),
                "timestamp": _now(),
            },
            action_id=action_id,
        )
        return _ok_response({"result": {"record_id": record["record_id"], "record": record["record"], "entity_id": entity_id}})

    patch = action.get("patch") if isinstance(action.get("patch"), dict) else {}
    if kind == "update_record":
        t0 = time.perf_counter()
        record_id = context.get("record_id") if isinstance(context, dict) else None
        if not isinstance(record_id, str) or not record_id:
            return _error_response("ACTION_INVALID", "record_id is required", "record_id", status=400)
        existing = generic_records.get(entity_id, record_id)
        found_entity_id = entity_id
        if not existing:
            return _error_response("RECORD_NOT_FOUND", "Record not found", "record_id", status=404)
        phase_ms["load_record"] = (time.perf_counter() - t0) * 1000
        t0 = time.perf_counter()
        workflow = _find_entity_workflow(found[2], entity_def.get("id"))
        errors, updated = _validate_patch_payload(entity_def, patch, existing.get("record") or {}, workflow=workflow)
        if errors:
            _log_record_validation_errors(entity_id, patch, errors, workflow)
            return _validation_response(errors, [])
        phase_ms["validate"] = (time.perf_counter() - t0) * 1000
        t0 = time.perf_counter()
        target_entity_id = found_entity_id
        try:
            record = generic_records.update(target_entity_id, record_id, updated)
        except Exception as exc:
            constraint = _wrap_db_constraint_error(exc)
            if constraint:
                return _error_response(
                    "RECORD_WRITE_FAILED",
                    "Record update failed due to constraint",
                    "record",
                    detail=constraint.get("detail"),
                    status=400,
                )
            raise
        _add_chatter_entry(target_entity_id, record_id, "system", "Record updated", getattr(request.state, "user", None))
        _resp_cache_invalidate_record(target_entity_id, record_id)
        _resp_cache_invalidate_entity(target_entity_id)
        phase_ms["write"] = (time.perf_counter() - t0) * 1000
        phase_ms["total"] = (time.perf_counter() - action_start) * 1000
        _action_logger.info("action_perf=%s", {"action_id": action_id, "kind": kind, "ms": phase_ms})
        after_record = record.get("record") if isinstance(record, dict) else None
        before_record = existing.get("record") if isinstance(existing, dict) else None
        changed = _changed_fields(before_record or {}, after_record or {})
        activity_cfg = _activity_view_config(found[2], entity_def.get("id"))
        if isinstance(after_record, dict) and isinstance(before_record, dict) and isinstance(activity_cfg, dict):
            show_changes = activity_cfg.get("show_changes", True) is not False
            tracked_fields = activity_cfg.get("tracked_fields") if isinstance(activity_cfg.get("tracked_fields"), list) else None
            if show_changes:
                changes = _collect_activity_changes(entity_def, before_record, after_record, tracked_fields=tracked_fields)
                if changes:
                    try:
                        activity_store.add_change(
                            entity_def.get("id"),
                            record_id,
                            changes,
                            actor=getattr(request.state, "user", None),
                        )
                    except Exception:
                        pass
        if isinstance(after_record, dict):
            _emit_triggers(
                request,
                module_id,
                manifest,
                "record.updated",
                {
                    "entity_id": entity_def.get("id"),
                    "record_id": record_id,
                    "changed_fields": changed,
                    "user_id": (getattr(request.state, "actor", None) or {}).get("user_id"),
                    "timestamp": _now(),
                },
                entity_id=entity_def.get("id"),
            )
            status_field = (workflow or {}).get("status_field")
            if isinstance(status_field, str) and before_record and before_record.get(status_field) != after_record.get(status_field):
                _emit_triggers(
                    request,
                    module_id,
                    manifest,
                    "workflow.status_changed",
                    {
                        "entity_id": entity_def.get("id"),
                        "record_id": record_id,
                        "changed_fields": [status_field],
                        "from": before_record.get(status_field),
                        "to": after_record.get(status_field),
                        "user_id": (getattr(request.state, "actor", None) or {}).get("user_id"),
                        "timestamp": _now(),
                    },
                    entity_id=entity_def.get("id"),
                    status_field=status_field,
                )
        _emit_triggers(
            request,
            module_id,
            manifest,
            "action.clicked",
            {
                "action_id": action_id,
                "kind": kind,
                "entity_id": entity_def.get("id"),
                "record_id": record_id,
                "changed_fields": changed,
                "user_id": (getattr(request.state, "actor", None) or {}).get("user_id"),
                "timestamp": _now(),
            },
            action_id=action_id,
        )
        return _ok_response({"result": {"record_id": record["record_id"], "record": record["record"], "entity_id": entity_id}})

    if kind == "bulk_update":
        t0 = time.perf_counter()
        selected_ids = context.get("selected_ids") if isinstance(context, dict) else None
        if not isinstance(selected_ids, list) or len(selected_ids) == 0:
            return _error_response("ACTION_INVALID", "selected_ids is required", "selected_ids", status=400)
        updated_count = 0
        updated_ids = []
        for record_id in selected_ids:
            if not isinstance(record_id, str):
                continue
            existing = generic_records.get(entity_id, record_id)
            target_entity_id = entity_id
            if not existing:
                continue
            before_record = existing.get("record") if isinstance(existing, dict) else {}
            updated = dict(before_record or {})
            updated.update(patch)
            workflow = _find_entity_workflow(found[2], entity_def.get("id"))
            errors, clean = _validate_record_payload(entity_def, updated, for_create=False, workflow=workflow)
            lookup_errors = _validate_lookup_fields(entity_def, _registry_for_request(request), lambda module_id, manifest_hash: _get_snapshot(request, module_id, manifest_hash))
            errors.extend(lookup_errors)
            domain_errors = _enforce_lookup_domains(entity_def, clean if isinstance(clean, dict) else {})
            errors.extend(domain_errors)
            if errors:
                return _validation_response(errors, [])
            updated_record = generic_records.update(target_entity_id, record_id, clean)
            _add_chatter_entry(target_entity_id, record_id, "system", "Record updated", getattr(request.state, "user", None))
            updated_count += 1
            updated_ids.append(record_id)
            after_record = updated_record.get("record") if isinstance(updated_record, dict) else None
            changed = _changed_fields(before_record or {}, after_record or {})
            activity_cfg = _activity_view_config(found[2], entity_def.get("id"))
            if isinstance(after_record, dict) and isinstance(before_record, dict) and isinstance(activity_cfg, dict):
                show_changes = activity_cfg.get("show_changes", True) is not False
                tracked_fields = activity_cfg.get("tracked_fields") if isinstance(activity_cfg.get("tracked_fields"), list) else None
                if show_changes:
                    changes = _collect_activity_changes(entity_def, before_record, after_record, tracked_fields=tracked_fields)
                    if changes:
                        try:
                            activity_store.add_change(
                                entity_def.get("id"),
                                record_id,
                                changes,
                                actor=getattr(request.state, "user", None),
                            )
                        except Exception:
                            pass
            if isinstance(after_record, dict):
                _emit_triggers(
                    request,
                    module_id,
                    manifest,
                    "record.updated",
                    {
                        "entity_id": entity_def.get("id"),
                        "record_id": record_id,
                        "changed_fields": changed,
                        "user_id": (getattr(request.state, "actor", None) or {}).get("user_id"),
                        "timestamp": _now(),
                    },
                    entity_id=entity_def.get("id"),
                )
                status_field = (workflow or {}).get("status_field")
                if isinstance(status_field, str) and before_record and before_record.get(status_field) != after_record.get(status_field):
                    _emit_triggers(
                        request,
                        module_id,
                        manifest,
                        "workflow.status_changed",
                        {
                            "entity_id": entity_def.get("id"),
                            "record_id": record_id,
                            "changed_fields": [status_field],
                            "from": before_record.get(status_field),
                            "to": after_record.get(status_field),
                            "user_id": (getattr(request.state, "actor", None) or {}).get("user_id"),
                            "timestamp": _now(),
                        },
                        entity_id=entity_def.get("id"),
                        status_field=status_field,
                    )
        _resp_cache_invalidate_entity(entity_id)
        phase_ms["bulk_total"] = (time.perf_counter() - t0) * 1000
        phase_ms["total"] = (time.perf_counter() - action_start) * 1000
        _action_logger.info("action_perf=%s", {"action_id": action_id, "kind": kind, "ms": phase_ms, "updated": updated_count})
        _emit_triggers(
            request,
            module_id,
            manifest,
            "action.clicked",
            {
                "action_id": action_id,
                "kind": kind,
                "entity_id": entity_def.get("id"),
                "record_id": None,
                "record_ids": updated_ids,
                "changed_fields": list(patch.keys()) if isinstance(patch, dict) else [],
                "user_id": (getattr(request.state, "actor", None) or {}).get("user_id"),
                "timestamp": _now(),
            },
            action_id=action_id,
        )
        return _ok_response({"result": {"updated": updated_count}})

    return _error_response("ACTION_INVALID", "Unhandled action kind", "kind", status=400)


def run_action_internal(module_id: str, action_id: str, context: dict | None, actor: dict | None = None) -> dict:
    internal_req = SimpleNamespace(
        state=SimpleNamespace(cache={}, actor=actor or {"user_id": "system", "role": "system"}),
        headers={},
    )
    return _run_action_core(internal_req, module_id, action_id, context or {})


@app.get("/automations/meta")
async def automations_meta(request: Request) -> dict:
    actor = getattr(request.state, "actor", None) or {}
    org_id = actor.get("workspace_id") or "default"
    cache_key = f"automations_meta:{org_id}"
    cached = _resp_cache_get(cache_key)
    if cached is not None:
        logger.info("cache_hit=automations_meta key=%s", cache_key)
        return cached
    event_types = [
        "record.created",
        "record.updated",
        "workflow.status_changed",
        "action.clicked",
    ]
    event_catalog: list[dict] = []
    system_actions = [
        {"id": "system.notify", "label": "Send notification"},
        {"id": "system.send_email", "label": "Send email"},
        {"id": "system.generate_document", "label": "Generate document"},
        {"id": "system.noop", "label": "No-op (test)"},
    ]
    entities: list[dict] = []
    module_actions: list[dict] = []
    for mod in _get_registry_list(request):
        if not mod.get("enabled"):
            continue
        module_id = mod.get("module_id")
        manifest_hash = mod.get("current_hash")
        if not module_id or not manifest_hash:
            continue
        try:
            manifest = _get_snapshot(request, module_id, manifest_hash)
        except Exception:
            continue
        for ent in manifest.get("entities", []) if isinstance(manifest.get("entities"), list) else []:
            if not isinstance(ent, dict):
                continue
            ent_id = ent.get("id")
            if not isinstance(ent_id, str) or not ent_id:
                continue
            field_items: list[dict] = []
            fields = ent.get("fields")
            if isinstance(fields, list):
                for field in fields:
                    if not isinstance(field, dict):
                        continue
                    field_id = field.get("id")
                    if not isinstance(field_id, str) or not field_id:
                        continue
                    field_items.append(
                        {
                            "id": field_id,
                            "label": field.get("label") or field_id,
                            "type": field.get("type"),
                            "entity": field.get("entity"),
                            "display_field": field.get("display_field"),
                        }
                    )
            entities.append(
                {
                    "id": ent_id,
                    "label": ent.get("label") or ent.get("name") or ent_id,
                    "display_field": ent.get("display_field"),
                    "module_id": module_id,
                    "module_name": mod.get("name"),
                    "fields": field_items,
                }
            )
        actions = []
        module_slug = (manifest.get("module") or {}).get("id")
        if not isinstance(module_slug, str) or not module_slug:
            module_slug = module_id
        for trigger in manifest.get("triggers", []) if isinstance(manifest.get("triggers"), list) else []:
            if not isinstance(trigger, dict):
                continue
            trig_id = trigger.get("id")
            if not isinstance(trig_id, str) or not trig_id:
                continue
            event_types.append(trig_id)
            event = trigger.get("event")
            if event == "action.clicked":
                kind = "action_click"
            elif event == "workflow.status_changed":
                kind = "workflow_change"
            elif event in {"record.created", "record.updated"}:
                kind = "record_event"
            else:
                kind = "event"
            event_catalog.append(
                {
                    "id": trig_id,
                    "label": trigger.get("label") or trig_id,
                    "source_module_id": module_id,
                    "source_module_name": mod.get("name"),
                    "entity_id": trigger.get("entity_id"),
                    "kind": kind,
                    "payload_schema": {},
                }
            )
        for action in manifest.get("actions", []) if isinstance(manifest.get("actions"), list) else []:
            if not isinstance(action, dict):
                continue
            kind = action.get("kind")
            if kind not in {"create_record", "update_record", "bulk_update", "navigate", "open_form", "refresh"}:
                continue
            actions.append(
                {
                    "id": action.get("id"),
                    "label": action.get("label") or action.get("id"),
                    "kind": kind,
                    "entity_id": action.get("entity_id"),
                    "display_id": f"{module_slug}.{action.get('id')}",
                }
            )
        if actions:
            module_actions.append({"module_id": module_id, "module_name": mod.get("name"), "actions": actions})
    workspace_id = actor.get("workspace_id")
    members = list_workspace_members(workspace_id) if isinstance(workspace_id, str) and workspace_id else []
    connections = connection_store.list() if connection_store else []
    email_templates = email_store.list_templates() if email_store else []
    doc_templates = doc_template_store.list() if doc_template_store else []
    response = _ok_response(
        {
            "event_types": list(dict.fromkeys(event_types)),
            "event_catalog": event_catalog,
            "system_actions": system_actions,
            "module_actions": module_actions,
            "entities": entities,
            "members": members,
            "connections": connections,
            "email_templates": email_templates,
            "doc_templates": doc_templates,
        }
    )
    _resp_cache_set(cache_key, response)
    logger.info("cache_miss=automations_meta key=%s", cache_key)
    return response


@app.get("/automations/{automation_id}/export")
async def export_automation(request: Request, automation_id: str) -> dict:
    automation = automation_store.get(automation_id)
    if not automation:
        return _error_response("AUTOMATION_NOT_FOUND", "Automation not found", "automation_id", status=404)
    payload = {
        "name": automation.get("name"),
        "description": automation.get("description"),
        "trigger": automation.get("trigger") or {},
        "steps": automation.get("steps") or [],
    }
    return _ok_response({"automation": payload})


@app.post("/automations/import")
async def import_automation(request: Request) -> dict:
    body = await _safe_json(request)
    if not isinstance(body, dict):
        return _error_response("AUTOMATION_INVALID", "Invalid payload", "body", status=400)
    data = body.get("automation") if isinstance(body.get("automation"), dict) else body
    if not isinstance(data, dict):
        return _error_response("AUTOMATION_INVALID", "Invalid automation", "automation", status=400)
    name = data.get("name") or "Imported Automation"
    record = {
        "name": name,
        "description": data.get("description") or "",
        "status": "draft",
        "trigger": data.get("trigger") or {},
        "steps": data.get("steps") or [],
    }
    automation = automation_store.create(record)
    return _ok_response({"automation": automation})


@app.post("/lookup/{entity_id}/options")
async def lookup_options(request: Request, entity_id: str) -> dict:
    entity_id = _normalize_entity_id(entity_id)
    found = _find_entity_def(request, entity_id)
    if not found:
        return _error_response("ENTITY_NOT_FOUND", "Entity not found or disabled", "entity_id", status=404)
    body = await _safe_json(request)
    q = body.get("q") if isinstance(body, dict) else None
    limit = body.get("limit") if isinstance(body, dict) else None
    domain = body.get("domain") if isinstance(body, dict) else None
    record_context = body.get("record_context") if isinstance(body, dict) else None
    limit_cap = limit if isinstance(limit, int) and limit > 0 else 50
    if limit_cap > 200:
        limit_cap = 200
    if limit_cap > 50:
        limit_cap = 50
    if isinstance(q, str) and len(q.strip()) < 2:
        return _ok_response({"records": []})
    display_field = found[1].get("display_field") if isinstance(found[1], dict) else None
    cache_key = f"lookup:{get_org_id()}:{entity_id}:{display_field}:{limit_cap}:{q or ''}:{_domain_hash(domain)}:{_context_hash(record_context)}"
    cached = _resp_cache_get(cache_key)
    if cached is not None:
        logger.info("cache_hit=lookup key=%s", cache_key)
        return cached
    if domain:
        prefetch = min(200, max(limit_cap * 4, limit_cap))
        items = generic_records.list(entity_id, limit=prefetch, q=q, search_fields=[display_field] if display_field else None)
    else:
        items = generic_records.list_lookup(entity_id, display_field, limit=limit_cap, q=q)
    if domain:
        items = _filter_records_by_domain(items, domain, record_context or {})
    if isinstance(limit_cap, int) and limit_cap > 0:
        items = items[:limit_cap]
    response = _ok_response({"records": items})
    _resp_cache_set(cache_key, response)
    logger.info("cache_miss=lookup key=%s", cache_key)
    return response


@app.get("/records/{entity_id}/aggregate")
async def aggregate_records(
    request: Request,
    entity_id: str,
    group_by: str | None = None,
    measure: str | None = None,
    q: str | None = None,
    search_fields: str | None = None,
    domain: str | None = None,
    limit: int = 2000,
) -> dict:
    entity_id = _normalize_entity_id(entity_id)
    found = _find_entity_def(request, entity_id)
    if not found:
        return _error_response("ENTITY_NOT_FOUND", "Entity not found or disabled", "entity_id", status=404)
    if not isinstance(group_by, str) or not group_by:
        return _error_response("AGGREGATE_INVALID", "group_by is required", "group_by", status=400)
    fields_list = [f.strip() for f in search_fields.split(",")] if isinstance(search_fields, str) and search_fields.strip() else None
    parsed_domain = None
    if isinstance(domain, str) and domain.strip():
        try:
            parsed_domain = json.loads(domain)
        except Exception as exc:
            return _error_response("DOMAIN_INVALID", "domain must be valid JSON", "domain", detail={"error": str(exc)}, status=400)
    limit_cap = limit if isinstance(limit, int) and limit > 0 else 2000
    if limit_cap > 5000:
        limit_cap = 5000
    items = generic_records.list(entity_id, limit=limit_cap, q=q, search_fields=fields_list)
    if parsed_domain:
        items = _filter_records_by_domain(items, parsed_domain, {})
    if isinstance(limit_cap, int) and limit_cap > 0:
        items = items[:limit_cap]
    if not isinstance(measure, str) or not measure:
        measure = "count"
    measure_field = None
    if measure.startswith("sum:"):
        measure_field = measure.split(":", 1)[1]
    groups = {}
    for item in items:
        record = item.get("record") or {}
        key = record.get(group_by)
        if key is None:
            key = ""
        if measure_field:
            try:
                val = record.get(measure_field) or 0
                val = float(val)
            except Exception:
                val = 0
            groups[key] = groups.get(key, 0) + val
        else:
            groups[key] = groups.get(key, 0) + 1
    results = [{"key": k, "value": v} for k, v in groups.items()]
    return _ok_response({"groups": results, "group_by": group_by, "measure": measure})


@app.get("/records/{entity_id}/pivot")
async def pivot_records(
    request: Request,
    entity_id: str,
    row_group_by: str | None = None,
    col_group_by: str | None = None,
    measure: str | None = None,
    q: str | None = None,
    search_fields: str | None = None,
    domain: str | None = None,
    limit: int = 2000,
) -> dict:
    entity_id = _normalize_entity_id(entity_id)
    found = _find_entity_def(request, entity_id)
    if not found:
        return _error_response("ENTITY_NOT_FOUND", "Entity not found or disabled", "entity_id", status=404)
    if not isinstance(row_group_by, str) or not row_group_by:
        return _error_response("PIVOT_INVALID", "row_group_by is required", "row_group_by", status=400)
    fields_list = [f.strip() for f in search_fields.split(",")] if isinstance(search_fields, str) and search_fields.strip() else None
    parsed_domain = None
    if isinstance(domain, str) and domain.strip():
        try:
            parsed_domain = json.loads(domain)
        except Exception as exc:
            return _error_response("DOMAIN_INVALID", "domain must be valid JSON", "domain", detail={"error": str(exc)}, status=400)
    limit_cap = limit if isinstance(limit, int) and limit > 0 else 2000
    if limit_cap > 5000:
        limit_cap = 5000
    items = generic_records.list(entity_id, limit=limit_cap, q=q, search_fields=fields_list)
    if parsed_domain:
        items = _filter_records_by_domain(items, parsed_domain, {})
    if isinstance(limit_cap, int) and limit_cap > 0:
        items = items[:limit_cap]
    if not isinstance(measure, str) or not measure:
        measure = "count"
    measure_field = None
    if measure.startswith("sum:"):
        measure_field = measure.split(":", 1)[1]

    row_keys: list[str] = []
    col_keys: list[str] = []
    matrix: dict[str, dict[str, float]] = {}
    row_totals: dict[str, float] = {}
    col_totals: dict[str, float] = {}
    grand_total = 0.0

    for item in items:
        record = item.get("record") or {}
        row_key = record.get(row_group_by)
        if row_key is None:
            row_key = ""
        col_key = ""
        if isinstance(col_group_by, str) and col_group_by:
            col_key = record.get(col_group_by)
            if col_key is None:
                col_key = ""
        if row_key not in matrix:
            matrix[row_key] = {}
            row_keys.append(row_key)
        if col_key not in matrix[row_key]:
            matrix[row_key][col_key] = 0.0
        if col_key not in col_totals:
            col_totals[col_key] = 0.0
            if col_key not in col_keys:
                col_keys.append(col_key)
        if measure_field:
            try:
                val = record.get(measure_field) or 0
                val = float(val)
            except Exception:
                val = 0.0
        else:
            val = 1.0
        matrix[row_key][col_key] += val
        row_totals[row_key] = row_totals.get(row_key, 0.0) + val
        col_totals[col_key] = col_totals.get(col_key, 0.0) + val
        grand_total += val

    rows = [{"key": k, "label": k} for k in row_keys]
    cols = [{"key": k, "label": k} for k in col_keys] if col_keys else [{"key": "", "label": ""}]

    return _ok_response(
        {
            "rows": rows,
            "cols": cols,
            "matrix": matrix,
            "row_totals": row_totals,
            "col_totals": col_totals,
            "grand_total": grand_total,
            "row_group_by": row_group_by,
            "col_group_by": col_group_by,
            "measure": measure,
        }
    )


@app.get("/records/{entity_id}")
async def list_generic_records(
    request: Request,
    entity_id: str,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
    cursor: str | None = None,
    search_fields: str | None = None,
    fields: str | None = None,
    domain: str | None = None,
) -> dict:
    entity_id = _normalize_entity_id(entity_id)
    found = _find_entity_def(request, entity_id)
    if not found:
        return _error_response("ENTITY_NOT_FOUND", "Entity not found or disabled", "entity_id", status=404)
    limit_cap = limit if isinstance(limit, int) and limit > 0 else 50
    if limit_cap > 200:
        limit_cap = 200
    offset_val = offset if isinstance(offset, int) and offset >= 0 else 0
    fields_list = [f.strip() for f in search_fields.split(",")] if isinstance(search_fields, str) and search_fields.strip() else None
    parsed_domain = None
    if isinstance(domain, str) and domain.strip():
        try:
            parsed_domain = json.loads(domain)
        except Exception as exc:
            return _error_response("DOMAIN_INVALID", "domain must be valid JSON", "domain", detail={"error": str(exc)}, status=400)
    cache_key = f"records:list:{get_org_id()}:{entity_id}:{limit_cap}:{offset_val}:{cursor or ''}:{fields or ''}:{search_fields or ''}:{q or ''}:{_domain_hash(parsed_domain)}"
    cached = _resp_cache_get(cache_key)
    if cached is not None:
        logger.info("cache_hit=records_list key=%s", cache_key)
        return cached
    field_ids = [f.strip() for f in fields.split(",") if f.strip()] if isinstance(fields, str) and fields.strip() else None
    use_cursor = isinstance(cursor, str) and cursor.strip()
    if use_cursor or offset_val == 0:
        items, next_cursor = generic_records.list_page(
            entity_id,
            limit=limit_cap,
            cursor=cursor,
            q=q,
            search_fields=fields_list,
            fields=None if parsed_domain else field_ids,
        )
    else:
        items = generic_records.list(entity_id, limit=limit_cap, offset=offset_val, q=q, search_fields=fields_list)
        next_cursor = None
    if parsed_domain:
        items = _filter_records_by_domain(items, parsed_domain, {})
    if isinstance(limit_cap, int) and limit_cap > 0:
        items = items[:limit_cap]
    if isinstance(field_ids, list) and field_ids:
        trimmed = []
        for item in items:
            record = item.get("record") or {}
            slim = {fid: record.get(fid) for fid in field_ids if fid in record}
            if "id" in record:
                slim["id"] = record.get("id")
            trimmed.append({"record_id": item.get("record_id"), "record": slim})
        items = trimmed
    payload = {"records": items}
    if next_cursor:
        payload["next_cursor"] = next_cursor
    response = _ok_response(payload)
    _resp_cache_set(cache_key, response)
    logger.info("cache_miss=records_list key=%s", cache_key)
    return response


@app.get("/filters/{entity_id}")
async def list_saved_filters(request: Request, entity_id: str) -> dict:
    user_id = _require_user_id(request)
    if not user_id:
        if IS_DEV or os.getenv("OCTO_ALLOW_ANON_PREFS", "").strip() == "1":
            return _ok_response({"filters": []})
        return _error_response("AUTH_REQUIRED", "Authentication required", "user_id", status=401)
    entity_id = _normalize_entity_id(entity_id)
    with get_conn() as conn:
        rows = fetch_all(
            conn,
            """
            select id, name, domain, state, is_default, created_at
            from saved_filters
            where org_id=%s and user_id=%s and entity_id=%s
            order by created_at desc
            """,
            [get_org_id(), user_id, entity_id],
            query_name="saved_filters.list",
        )
        return _ok_response({"filters": rows})


@app.post("/filters/{entity_id}")
async def create_saved_filter(request: Request, entity_id: str) -> dict:
    user_id = _require_user_id(request)
    if not user_id:
        return _error_response("AUTH_REQUIRED", "Authentication required", "user_id", status=401)
    entity_id = _normalize_entity_id(entity_id)
    body = await _safe_json(request)
    name = body.get("name") if isinstance(body, dict) else None
    domain = body.get("domain") if isinstance(body, dict) else None
    state = body.get("state") if isinstance(body, dict) else None
    is_default = bool(body.get("is_default")) if isinstance(body, dict) else False
    if not isinstance(name, str) or not name.strip():
        return _error_response("FILTER_INVALID", "name required", "name", status=400)
    if not isinstance(domain, dict):
        return _error_response("FILTER_INVALID", "domain required", "domain", status=400)
    if state is not None and not isinstance(state, dict):
        return _error_response("FILTER_INVALID", "state must be object", "state", status=400)
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            insert into saved_filters (org_id, user_id, entity_id, name, domain, state, is_default)
            values (%s, %s, %s, %s, %s, %s, %s)
            returning id, name, domain, state, is_default, created_at
            """,
            [get_org_id(), user_id, entity_id, name.strip(), json.dumps(domain), json.dumps(state) if state is not None else None, is_default],
            query_name="saved_filters.insert",
        )
        if is_default:
            execute(
                conn,
                """
                update saved_filters set is_default=false
                where org_id=%s and user_id=%s and entity_id=%s and id <> %s
                """,
                [get_org_id(), user_id, entity_id, row.get("id")],
                query_name="saved_filters.clear_default",
            )
            execute(
                conn,
                """
                insert into user_entity_prefs (org_id, user_id, entity_id, default_filter_id, updated_at)
                values (%s, %s, %s, %s, %s)
                on conflict (org_id, user_id, entity_id)
                do update set default_filter_id=excluded.default_filter_id, default_filter_key=null, updated_at=excluded.updated_at
                """,
                [get_org_id(), user_id, entity_id, row.get("id"), _now()],
                query_name="user_entity_prefs.set_default_filter",
            )
        return _ok_response({"filter": row})


@app.put("/filters/{filter_id}")
async def update_saved_filter(request: Request, filter_id: str) -> dict:
    user_id = _require_user_id(request)
    if not user_id:
        return _error_response("AUTH_REQUIRED", "Authentication required", "user_id", status=401)
    body = await _safe_json(request)
    with get_conn() as conn:
        existing = fetch_one(
            conn,
            "select id, entity_id, is_default from saved_filters where org_id=%s and user_id=%s and id=%s",
            [get_org_id(), user_id, filter_id],
            query_name="saved_filters.get",
        )
        if not existing:
            return _error_response("FILTER_NOT_FOUND", "Filter not found", "filter_id", status=404)
        name = body.get("name") if isinstance(body, dict) else None
        domain = body.get("domain") if isinstance(body, dict) else None
        state = body.get("state") if isinstance(body, dict) else None
        is_default = body.get("is_default") if isinstance(body, dict) else None
        updates = []
        params = []
        if isinstance(name, str) and name.strip():
            updates.append("name=%s")
            params.append(name.strip())
        if isinstance(domain, dict):
            updates.append("domain=%s")
            params.append(json.dumps(domain))
        if isinstance(state, dict):
            updates.append("state=%s")
            params.append(json.dumps(state))
        if isinstance(is_default, bool):
            updates.append("is_default=%s")
            params.append(is_default)
        if updates:
            params.extend([get_org_id(), user_id, filter_id])
            execute(
                conn,
                f"update saved_filters set {', '.join(updates)} where org_id=%s and user_id=%s and id=%s",
                params,
                query_name="saved_filters.update",
            )
        if isinstance(is_default, bool):
            entity_id = existing.get("entity_id")
            if is_default:
                execute(
                    conn,
                    """
                    update saved_filters set is_default=false
                    where org_id=%s and user_id=%s and entity_id=%s and id <> %s
                    """,
                    [get_org_id(), user_id, entity_id, filter_id],
                    query_name="saved_filters.clear_default",
                )
                execute(
                    conn,
                    """
                    insert into user_entity_prefs (org_id, user_id, entity_id, default_filter_id, updated_at)
                    values (%s, %s, %s, %s, %s)
                    on conflict (org_id, user_id, entity_id)
                    do update set default_filter_id=excluded.default_filter_id, default_filter_key=null, updated_at=excluded.updated_at
                    """,
                    [get_org_id(), user_id, entity_id, filter_id, _now()],
                    query_name="user_entity_prefs.set_default_filter",
                )
            else:
                if existing.get("is_default"):
                    execute(
                        conn,
                        "update user_entity_prefs set default_filter_id=null, updated_at=%s where org_id=%s and user_id=%s and entity_id=%s",
                        [_now(), get_org_id(), user_id, existing.get("entity_id")],
                        query_name="user_entity_prefs.clear_default_filter",
                    )
        row = fetch_one(
            conn,
            "select id, name, domain, state, is_default, created_at from saved_filters where org_id=%s and user_id=%s and id=%s",
            [get_org_id(), user_id, filter_id],
            query_name="saved_filters.get",
        )
        return _ok_response({"filter": row})


@app.delete("/filters/{filter_id}")
async def delete_saved_filter(request: Request, filter_id: str) -> dict:
    user_id = _require_user_id(request)
    if not user_id:
        return _error_response("AUTH_REQUIRED", "Authentication required", "user_id", status=401)
    with get_conn() as conn:
        existing = fetch_one(
            conn,
            "select id, entity_id, is_default from saved_filters where org_id=%s and user_id=%s and id=%s",
            [get_org_id(), user_id, filter_id],
            query_name="saved_filters.get",
        )
        if not existing:
            return _error_response("FILTER_NOT_FOUND", "Filter not found", "filter_id", status=404)
        execute(
            conn,
            "delete from saved_filters where org_id=%s and user_id=%s and id=%s",
            [get_org_id(), user_id, filter_id],
            query_name="saved_filters.delete",
        )
        if existing.get("is_default"):
            execute(
                conn,
                "update user_entity_prefs set default_filter_id=null, updated_at=%s where org_id=%s and user_id=%s and entity_id=%s",
                [_now(), get_org_id(), user_id, existing.get("entity_id")],
                query_name="user_entity_prefs.clear_default_filter",
            )
        return _ok_response({"ok": True})


@app.get("/prefs/entity/{entity_id}")
async def get_entity_prefs(request: Request, entity_id: str) -> dict:
    user_id = _require_user_id(request)
    if not user_id:
        if IS_DEV or os.getenv("OCTO_ALLOW_ANON_PREFS", "").strip() == "1":
            return _ok_response({"prefs": {}})
        return _error_response("AUTH_REQUIRED", "Authentication required", "user_id", status=401)
    entity_id = _normalize_entity_id(entity_id)
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            select default_mode, default_filter_id, default_filter_key, default_group_by, updated_at
            from user_entity_prefs
            where org_id=%s and user_id=%s and entity_id=%s
            """,
            [get_org_id(), user_id, entity_id],
            query_name="user_entity_prefs.get",
        )
        return _ok_response({"prefs": row or {}})


@app.put("/prefs/entity/{entity_id}")
async def set_entity_prefs(request: Request, entity_id: str) -> dict:
    user_id = _require_user_id(request)
    if not user_id:
        return _error_response("AUTH_REQUIRED", "Authentication required", "user_id", status=401)
    entity_id = _normalize_entity_id(entity_id)
    body = await _safe_json(request)
    if not isinstance(body, dict):
        return _error_response("PREFS_INVALID", "prefs body required", "body", status=400)
    default_mode = body.get("default_mode")
    default_filter_id = body.get("default_filter_id")
    default_filter_key = body.get("default_filter_key")
    default_group_by = body.get("default_group_by")
    if isinstance(default_filter_id, str) and default_filter_id:
        default_filter_key = None
    if isinstance(default_filter_key, str) and default_filter_key:
        default_filter_id = None
    with get_conn() as conn:
        execute(
            conn,
            """
            insert into user_entity_prefs (org_id, user_id, entity_id, default_mode, default_filter_id, default_filter_key, default_group_by, updated_at)
            values (%s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (org_id, user_id, entity_id)
            do update set default_mode=excluded.default_mode,
                          default_filter_id=excluded.default_filter_id,
                          default_filter_key=excluded.default_filter_key,
                          default_group_by=excluded.default_group_by,
                          updated_at=excluded.updated_at
            """,
            [get_org_id(), user_id, entity_id, default_mode, default_filter_id, default_filter_key, default_group_by, _now()],
            query_name="user_entity_prefs.upsert",
        )
        return _ok_response({"ok": True})


@app.get("/prefs/ui")
async def get_ui_prefs(request: Request) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    org_id = get_org_id()
    user_id = actor.get("user_id")
    with get_conn() as conn:
        workspace = fetch_one(
            conn,
            "select org_id, theme, colors, logo_url from workspace_ui_prefs where org_id=%s",
            [org_id],
            query_name="workspace_ui_prefs.get",
        )
        user = None
        if user_id:
            user = fetch_one(
                conn,
                "select org_id, user_id, theme from user_ui_prefs where org_id=%s and user_id=%s",
                [org_id, user_id],
                query_name="user_ui_prefs.get",
            )
    return _ok_response({"workspace": workspace or {}, "user": user or {}})


def _branding_context_for_org(org_id: str) -> dict:
    with get_conn() as conn:
        workspace = fetch_one(
            conn,
            "select logo_url from workspace_ui_prefs where org_id=%s",
            [org_id],
            query_name="workspace_ui_prefs.branding",
        ) or {}
    logo_url = workspace.get("logo_url")
    return {
        "workspace": {"logo_url": logo_url},
        "company": {"logo_url": logo_url},
    }


def _field_list(entity_def: dict | None) -> list[dict]:
    fields = entity_def.get("fields") if isinstance(entity_def, dict) else []
    if isinstance(fields, list):
        return [f for f in fields if isinstance(f, dict)]
    if isinstance(fields, dict):
        out: list[dict] = []
        for field_id, field_def in fields.items():
            if isinstance(field_def, dict):
                out.append({"id": field_id, **field_def})
            elif isinstance(field_id, str):
                out.append({"id": field_id})
        return out
    return []


def _enum_label_for_value(field: dict, value: object) -> str | None:
    if value in (None, ""):
        return None
    options = field.get("options") or field.get("values") or []
    for opt in options:
        if isinstance(opt, dict):
            if opt.get("value") == value:
                label = opt.get("label")
                if isinstance(label, str) and label.strip():
                    return label
        elif opt == value:
            return str(opt)
    return None


def _lookup_label(target_entity: str, display_field: str, record_id: str) -> str | None:
    candidates = [target_entity]
    if target_entity.startswith("entity."):
        candidates.append(target_entity[7:])
    else:
        candidates.append(f"entity.{target_entity}")
    target_record: dict | None = None
    for candidate in candidates:
        target = generic_records.get(candidate, record_id)
        if not target:
            continue
        maybe_record = target.get("record") if isinstance(target, dict) else None
        if isinstance(maybe_record, dict):
            target_record = maybe_record
            break
    if not isinstance(target_record, dict):
        return None
    field_candidates = [display_field]
    prefix = display_field.split(".", 1)[0] if "." in display_field else None
    if prefix:
        field_candidates.extend([f"{prefix}.display_name", f"{prefix}.name", f"{prefix}.full_name"])
    else:
        field_candidates.extend(["display_name", "name", "full_name"])
    for field_id in field_candidates:
        label = target_record.get(field_id)
        if label in (None, ""):
            continue
        return label if isinstance(label, str) else str(label)
    return None


def _enrich_template_record(record: dict, entity_def: dict | None) -> dict:
    enriched = dict(record or {})
    for field in _field_list(entity_def):
        field_id = field.get("id")
        if not isinstance(field_id, str) or not field_id:
            continue
        value = enriched.get(field_id)
        field_type = field.get("type")
        if field_type == "enum":
            enum_label = _enum_label_for_value(field, value)
            if enum_label:
                enriched[f"{field_id}_label"] = enum_label
            continue
        if field_type != "lookup":
            continue
        if not isinstance(value, str) or not value.strip():
            continue
        target = field.get("entity")
        display_field = field.get("display_field")
        if not isinstance(target, str) or not isinstance(display_field, str):
            continue
        target_entity = target[7:] if target.startswith("entity.") else target
        label = _lookup_label(target_entity, display_field, value)
        if not label:
            continue
        enriched[f"{field_id}_label"] = label
        if field_id.endswith("_id"):
            enriched[f"{field_id[:-3]}_name"] = label
    return enriched


@app.put("/prefs/ui")
async def set_ui_prefs(request: Request) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    org_id = get_org_id()
    user_id = actor.get("user_id")
    body = await _safe_json(request)
    if not isinstance(body, dict):
        return _error_response("PREFS_INVALID", "prefs body required", "body", status=400)
    workspace_data = body.get("workspace") if isinstance(body.get("workspace"), dict) else None
    user_data = body.get("user") if isinstance(body.get("user"), dict) else None
    with get_conn() as conn:
        if workspace_data is not None:
            current = fetch_one(
                conn,
                "select theme, colors, logo_url from workspace_ui_prefs where org_id=%s",
                [org_id],
                query_name="workspace_ui_prefs.current",
            ) or {}
            theme = workspace_data.get("theme") if "theme" in workspace_data else current.get("theme")
            colors = workspace_data.get("colors") if "colors" in workspace_data else current.get("colors")
            logo_url = workspace_data.get("logo_url") if "logo_url" in workspace_data else current.get("logo_url")
            execute(
                conn,
                """
                insert into workspace_ui_prefs (org_id, theme, colors, logo_url, updated_at)
                values (%s, %s, %s, %s, %s)
                on conflict (org_id)
                do update set theme=excluded.theme, colors=excluded.colors, logo_url=excluded.logo_url, updated_at=excluded.updated_at
                """,
                [org_id, theme, json.dumps(colors) if colors is not None else None, logo_url, _now()],
                query_name="workspace_ui_prefs.upsert",
            )
        if user_data is not None and user_id:
            theme = user_data.get("theme")
            execute(
                conn,
                """
                insert into user_ui_prefs (org_id, user_id, theme, updated_at)
                values (%s, %s, %s, %s)
                on conflict (org_id, user_id)
                do update set theme=excluded.theme, updated_at=excluded.updated_at
                """,
                [org_id, user_id, theme, _now()],
                query_name="user_ui_prefs.upsert",
            )
    return _ok_response({"ok": True})


@app.post("/records/{entity_id}")
async def create_generic_record(request: Request, entity_id: str) -> dict:
    entity_id = _normalize_entity_id(entity_id)
    found = _find_entity_def(request, entity_id)
    if not found:
        return _error_response("ENTITY_NOT_FOUND", "Entity not found or disabled", "entity_id", status=404)
    body = await _safe_json(request)
    data = body.get("record") if isinstance(body, dict) and "record" in body else body
    workflow = _find_entity_workflow(found[2], found[1].get("id"))
    errors, clean = _validate_record_payload(found[1], data, for_create=True, workflow=workflow)
    lookup_errors = _validate_lookup_fields(found[1], _registry_for_request(request), lambda module_id, manifest_hash: _get_snapshot(request, module_id, manifest_hash))
    errors.extend(lookup_errors)
    domain_errors = _enforce_lookup_domains(found[1], clean if isinstance(clean, dict) else {})
    errors.extend(domain_errors)
    if errors:
        _log_record_validation_errors(entity_id, data if isinstance(data, dict) else {}, errors, workflow)
        return _validation_response(errors, [])
    try:
        record = generic_records.create(entity_id, clean)
    except Exception as exc:
        constraint = _wrap_db_constraint_error(exc)
        if constraint:
            return _error_response(
                "RECORD_WRITE_FAILED",
                "Record create failed due to constraint",
                "record",
                detail=constraint.get("detail"),
                status=400,
            )
        raise
    _resp_cache_invalidate_entity(entity_id)
    record_id = record.get("record_id") if isinstance(record, dict) else None
    record_payload = record.get("record") if isinstance(record, dict) else None
    if record_id and isinstance(record_payload, dict):
        _emit_triggers(
            request,
            found[0],
            found[2],
            "record.created",
            {
                "entity_id": found[1].get("id"),
                "record_id": record_id,
                "changed_fields": sorted(record_payload.keys()),
                "user_id": (getattr(request.state, "actor", None) or {}).get("user_id"),
                "timestamp": _now(),
            },
            entity_id=found[1].get("id"),
        )
        return _ok_response({"record_id": record_id, "record": record_payload})
    if "id" in record:
        return _ok_response({"record_id": record["id"], "record": record})
    return _ok_response({"record": record})


@app.get("/records/{entity_id}/{record_id}")
async def get_generic_record(request: Request, entity_id: str, record_id: str) -> dict:
    entity_id = _normalize_entity_id(entity_id)
    found = _find_entity_def(request, entity_id)
    if not found:
        return _error_response("ENTITY_NOT_FOUND", "Entity not found or disabled", "entity_id", status=404)
    cache_key = f"records:get:{get_org_id()}:{entity_id}:{record_id}"
    cached = _resp_cache_get(cache_key)
    if cached is not None:
        logger.info("cache_hit=record_get key=%s", cache_key)
        return cached
    record = generic_records.get(entity_id, record_id)
    if not record:
        return _error_response("RECORD_NOT_FOUND", "Record not found", "record_id", status=404)
    response = _ok_response({"record": record["record"], "record_id": record["record_id"]})
    _resp_cache_set(cache_key, response)
    logger.info("cache_miss=record_get key=%s", cache_key)
    return response


@app.put("/records/{entity_id}/{record_id}")
async def update_generic_record(request: Request, entity_id: str, record_id: str) -> dict:
    entity_id = _normalize_entity_id(entity_id)
    found = _find_entity_def(request, entity_id)
    if not found:
        return _error_response("ENTITY_NOT_FOUND", "Entity not found or disabled", "entity_id", status=404)
    body = await _safe_json(request)
    data = body.get("record") if isinstance(body, dict) and "record" in body else body
    workflow = _find_entity_workflow(found[2], found[1].get("id"))
    errors, clean = _validate_record_payload(found[1], data, for_create=False, workflow=workflow)
    lookup_errors = _validate_lookup_fields(found[1], _registry_for_request(request), lambda module_id, manifest_hash: _get_snapshot(request, module_id, manifest_hash))
    errors.extend(lookup_errors)
    domain_errors = _enforce_lookup_domains(found[1], clean if isinstance(clean, dict) else {})
    errors.extend(domain_errors)
    if errors:
        _log_record_validation_errors(entity_id, data if isinstance(data, dict) else {}, errors, workflow)
        return _validation_response(errors, [])
    existing = generic_records.get(entity_id, record_id)
    if not existing:
        return _error_response("RECORD_NOT_FOUND", "Record not found", "record_id", status=404)
    before_record = existing.get("record") if isinstance(existing, dict) else None
    try:
        record = generic_records.update(entity_id, record_id, clean)
    except Exception as exc:
        constraint = _wrap_db_constraint_error(exc)
        if constraint:
            return _error_response(
                "RECORD_WRITE_FAILED",
                "Record update failed due to constraint",
                "record",
                detail=constraint.get("detail"),
                status=400,
            )
        raise
    _resp_cache_invalidate_record(entity_id, record_id)
    _resp_cache_invalidate_entity(entity_id)
    after_record = record.get("record") if isinstance(record, dict) else None
    if isinstance(after_record, dict) and isinstance(before_record, dict):
        activity_cfg = _activity_view_config(found[2], found[1].get("id"))
        if isinstance(activity_cfg, dict) and activity_cfg.get("show_changes", True) is not False:
            tracked_fields = activity_cfg.get("tracked_fields") if isinstance(activity_cfg.get("tracked_fields"), list) else None
            changes = _collect_activity_changes(found[1], before_record, after_record, tracked_fields=tracked_fields)
            if changes:
                try:
                    activity_store.add_change(
                        found[1].get("id"),
                        record_id,
                        changes,
                        actor=getattr(request.state, "user", None),
                    )
                except Exception:
                    pass
        changed = _changed_fields(before_record, after_record)
        _emit_triggers(
            request,
            found[0],
            found[2],
            "record.updated",
            {
                "entity_id": found[1].get("id"),
                "record_id": record_id,
                "changed_fields": changed,
                "user_id": (getattr(request.state, "actor", None) or {}).get("user_id"),
                "timestamp": _now(),
            },
            entity_id=found[1].get("id"),
        )
        status_field = (workflow or {}).get("status_field")
        if isinstance(status_field, str) and before_record.get(status_field) != after_record.get(status_field):
            _emit_triggers(
                request,
                found[0],
                found[2],
                "workflow.status_changed",
                {
                    "entity_id": found[1].get("id"),
                    "record_id": record_id,
                    "changed_fields": [status_field],
                    "from": before_record.get(status_field),
                    "to": after_record.get(status_field),
                    "user_id": (getattr(request.state, "actor", None) or {}).get("user_id"),
                    "timestamp": _now(),
                },
                entity_id=found[1].get("id"),
                status_field=status_field,
            )
    return _ok_response({"record": record["record"], "record_id": record["record_id"]})


@app.delete("/records/{entity_id}/{record_id}")
async def delete_generic_record(request: Request, entity_id: str, record_id: str) -> dict:
    entity_id = _normalize_entity_id(entity_id)
    found = _find_entity_def(request, entity_id)
    if not found:
        return _error_response("ENTITY_NOT_FOUND", "Entity not found or disabled", "entity_id", status=404)
    existing = generic_records.get(entity_id, record_id)
    if not existing:
        return _error_response("RECORD_NOT_FOUND", "Record not found", "record_id", status=404)
    generic_records.delete(entity_id, record_id)
    _resp_cache_invalidate_record(entity_id, record_id)
    _resp_cache_invalidate_entity(entity_id)
    return _ok_response({"deleted": True})


@app.get("/chatter/{entity_id}/{record_id}")
async def list_chatter(request: Request, entity_id: str, record_id: str, limit: int = 50) -> dict:
    entity_id = _normalize_entity_id(entity_id)
    found = _find_entity_def(request, entity_id)
    if not found:
        return _error_response("ENTITY_NOT_FOUND", "Entity not found or disabled", "entity_id", status=404)
    limit_cap = limit if isinstance(limit, int) and limit > 0 else 50
    cache_key = f"chatter:{get_org_id()}:{entity_id}:{record_id}:{limit_cap}"
    cached = _resp_cache_get(cache_key)
    if cached is not None:
        logger.info("cache_hit=chatter_list key=%s", cache_key)
        return cached
    items = chatter_store.list(entity_id, record_id, limit=limit_cap)
    response = _ok_response({"entries": items})
    _resp_cache_set(cache_key, response)
    logger.info("cache_miss=chatter_list key=%s", cache_key)
    return response


@app.get("/api/activity")
@app.get("/activity/events")
async def list_activity(
    request: Request,
    entity_id: str | None = None,
    record_id: str | None = None,
    limit: int = 50,
    cursor: str | None = None,
) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    if not isinstance(entity_id, str) or not entity_id:
        return _error_response("ACTIVITY_REQUIRED", "entity_id required", "entity_id", status=400)
    if not isinstance(record_id, str) or not record_id:
        return _error_response("ACTIVITY_REQUIRED", "record_id required", "record_id", status=400)
    normalized_entity = _normalize_entity_id(entity_id)
    found = _find_entity_def(request, normalized_entity)
    if not found:
        return _error_response("ENTITY_NOT_FOUND", "Entity not found or disabled", "entity_id", status=404)
    existing = generic_records.get(normalized_entity, record_id)
    if not existing:
        return _error_response("RECORD_NOT_FOUND", "Record not found", "record_id", status=404)
    limit_cap = max(1, min(int(limit or 50), 200))
    try:
        offset = max(0, int(cursor)) if cursor is not None else 0
    except Exception:
        return _error_response("ACTIVITY_CURSOR_INVALID", "cursor must be an integer offset", "cursor", status=400)
    rows = activity_store.list(normalized_entity, record_id, limit=min(limit_cap + offset + 1, 500))
    items = rows[offset : offset + limit_cap]
    next_cursor = str(offset + limit_cap) if len(rows) > offset + limit_cap else None
    return _ok_response({"items": items, "next_cursor": next_cursor})


@app.post("/api/activity/comment")
@app.post("/activity/comment")
async def add_activity_comment(request: Request) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    body = await _safe_json(request)
    if not isinstance(body, dict):
        return _error_response("INVALID_BODY", "Expected JSON object", None, status=400)
    entity_id = body.get("entity_id")
    record_id = body.get("record_id")
    text = body.get("body")
    if not isinstance(entity_id, str) or not entity_id:
        return _error_response("ACTIVITY_REQUIRED", "entity_id required", "entity_id", status=400)
    if not isinstance(record_id, str) or not record_id:
        return _error_response("ACTIVITY_REQUIRED", "record_id required", "record_id", status=400)
    if not isinstance(text, str) or not text.strip():
        return _error_response("COMMENT_REQUIRED", "body is required", "body", status=400)
    normalized_entity = _normalize_entity_id(entity_id)
    found = _find_entity_def(request, normalized_entity)
    if not found:
        return _error_response("ENTITY_NOT_FOUND", "Entity not found or disabled", "entity_id", status=404)
    existing = generic_records.get(normalized_entity, record_id)
    if not existing:
        return _error_response("RECORD_NOT_FOUND", "Record not found", "record_id", status=404)
    activity_cfg = _activity_view_config(found[2], found[1].get("id"))
    if isinstance(activity_cfg, dict) and activity_cfg.get("allow_comments") is False:
        return _error_response("ACTIVITY_COMMENTS_DISABLED", "Comments are disabled for this form", "activity.allow_comments", status=400)
    item = activity_store.add_comment(normalized_entity, record_id, text.strip(), actor=getattr(request.state, "user", None))
    return _ok_response({"item": item})


@app.post("/api/activity/attachment")
@app.post("/activity/attachment")
async def add_activity_attachment(
    request: Request,
    entity_id: str = Form(...),
    record_id: str = Form(...),
    file: UploadFile = File(...),
) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    if not entity_id or not record_id:
        return _error_response("ACTIVITY_REQUIRED", "entity_id and record_id required", None, status=400)
    normalized_entity = _normalize_entity_id(entity_id)
    found = _find_entity_def(request, normalized_entity)
    if not found:
        return _error_response("ENTITY_NOT_FOUND", "Entity not found or disabled", "entity_id", status=404)
    existing = generic_records.get(normalized_entity, record_id)
    if not existing:
        return _error_response("RECORD_NOT_FOUND", "Record not found", "record_id", status=404)
    activity_cfg = _activity_view_config(found[2], found[1].get("id"))
    if isinstance(activity_cfg, dict) and activity_cfg.get("allow_attachments") is False:
        return _error_response("ACTIVITY_ATTACHMENTS_DISABLED", "Attachments are disabled for this form", "activity.allow_attachments", status=400)
    data = await file.read()
    stored = store_bytes(get_org_id(), file.filename, data)
    attachment = attachment_store.create_attachment(
        {
            "filename": file.filename,
            "mime_type": file.content_type or "application/octet-stream",
            "size": stored["size"],
            "storage_key": stored["storage_key"],
            "sha256": stored["sha256"],
            "created_by": (actor or {}).get("user_id"),
            "source": "activity",
        }
    )
    attachment_store.link(
        {
            "attachment_id": attachment.get("id"),
            "entity_id": normalized_entity,
            "record_id": record_id,
            "purpose": "activity",
        }
    )
    item = activity_store.add_attachment(
        normalized_entity,
        record_id,
        attachment,
        actor=getattr(request.state, "user", None),
    )
    return _ok_response({"item": item, "attachment": attachment})


@app.post("/chatter/{entity_id}/{record_id}")
async def add_chatter(request: Request, entity_id: str, record_id: str) -> dict:
    entity_id = _normalize_entity_id(entity_id)
    found = _find_entity_def(request, entity_id)
    if not found:
        return _error_response("ENTITY_NOT_FOUND", "Entity not found or disabled", "entity_id", status=404)
    body = await _safe_json(request)
    text = body.get("body") if isinstance(body, dict) else None
    if not isinstance(text, str) or not text.strip():
        return _error_response("CHATTER_INVALID", "body is required", "body", status=400)
    actor = getattr(request.state, "user", None)
    entry = chatter_store.add(entity_id, record_id, "note", text.strip(), actor)
    _resp_cache_invalidate_record(entity_id, record_id)
    return _ok_response({"entry": entry})
    if len(registry_text) > 200_000 or len(target_text) > 200_000:
        return _error_response("AGENT_CONTEXT_TOO_LARGE", "prompt context too large", "context")


# ---- Access / Users / Roles ----


@app.get("/access/context")
async def access_context(request: Request) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    workspaces = actor.get("workspaces") or []
    if actor.get("platform_role") == "superadmin":
        workspaces = list_all_workspaces()
    return _ok_response(
        {
            "actor": {
                "user_id": actor.get("user_id"),
                "email": actor.get("email"),
                "workspace_id": actor.get("workspace_id"),
                "workspace_role": actor.get("workspace_role") or actor.get("role"),
                "platform_role": actor.get("platform_role") or "standard",
            },
            "workspaces": workspaces,
        }
    )


@app.get("/access/members")
async def access_members(request: Request) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    members = list_workspace_members(actor.get("workspace_id"))
    return _ok_response({"members": members})


@app.post("/access/members/invite")
async def invite_workspace_member(request: Request) -> dict:
    actor = _resolve_actor(request)
    denied = _require_capability(actor, "workspace.manage_members", "Admin role required")
    if denied:
        return denied
    body = await _safe_json(request)
    if not isinstance(body, dict):
        return _error_response("INVALID_BODY", "Expected JSON object", None, status=400)
    email = body.get("email")
    role = _normalize_workspace_role(body.get("role") or "member")
    if not isinstance(email, str) or "@" not in email:
        return _error_response("EMAIL_REQUIRED", "Valid email required", "email", status=400)
    if not role:
        return _error_response("ROLE_INVALID", "Invalid role", "role", status=400)
    redirect_to = body.get("redirect_to")
    try:
        invited = _supabase_invite_user(email.strip().lower(), redirect_to=redirect_to)
    except Exception as exc:
        return _error_response("INVITE_FAILED", str(exc), "email", status=400)
    invited_user = invited.get("user") if isinstance(invited, dict) else None
    invited_user_id = invited_user.get("id") if isinstance(invited_user, dict) else None
    if not isinstance(invited_user_id, str) or not invited_user_id:
        return _error_response("INVITE_FAILED", "Invite succeeded but user id missing", "email", status=400)
    member = add_workspace_member(actor.get("workspace_id"), invited_user_id, role)
    members = list_workspace_members(actor.get("workspace_id"))
    return _ok_response({"member": member, "members": members, "invited_email": email})


@app.patch("/access/members/{user_id}")
async def update_member_role(request: Request, user_id: str) -> dict:
    actor = _resolve_actor(request)
    denied = _require_capability(actor, "workspace.manage_members", "Admin role required")
    if denied:
        return denied
    body = await _safe_json(request)
    role = _normalize_workspace_role((body or {}).get("role"))
    if not role:
        return _error_response("ROLE_INVALID", "Invalid role", "role", status=400)
    workspace_id = actor.get("workspace_id")
    member = get_membership(user_id, workspace_id)
    if not member and actor.get("platform_role") != "superadmin":
        return _error_response("MEMBER_NOT_FOUND", "Member not found", "user_id", status=404)
    updated = update_workspace_member_role(workspace_id, user_id, role)
    if not updated:
        updated = add_workspace_member(workspace_id, user_id, role)
    members = list_workspace_members(workspace_id)
    return _ok_response({"member": updated, "members": members})


@app.delete("/access/members/{user_id}")
async def delete_member(request: Request, user_id: str) -> dict:
    actor = _resolve_actor(request)
    denied = _require_capability(actor, "workspace.manage_members", "Admin role required")
    if denied:
        return denied
    workspace_id = actor.get("workspace_id")
    if user_id == actor.get("user_id") and actor.get("platform_role") != "superadmin":
        return _error_response("FORBIDDEN", "You cannot remove yourself from this workspace", status=400)
    ok = remove_workspace_member(workspace_id, user_id)
    if not ok:
        return _error_response("MEMBER_NOT_FOUND", "Member not found", "user_id", status=404)
    members = list_workspace_members(workspace_id)
    return _ok_response({"ok": True, "members": members})


@app.patch("/access/platform-role/{user_id}")
async def update_platform_role(request: Request, user_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    if actor.get("platform_role") != "superadmin":
        return _error_response("FORBIDDEN", "Superadmin role required", status=403)
    body = await _safe_json(request)
    role = (body or {}).get("platform_role")
    if not isinstance(role, str) or role not in _PLATFORM_ROLES:
        return _error_response("ROLE_INVALID", "Invalid platform role", "platform_role", status=400)
    row = set_platform_role(user_id, role)
    return _ok_response({"user": row})


# ---- Phase 1: Ops / Jobs ----


@app.get("/ops/health")
async def ops_health(request: Request) -> dict:
    actor = _resolve_actor(request)
    denied = _require_admin(actor)
    if denied:
        return denied
    return _ok_response({"ok": True})


@app.get("/ops/jobs")
async def list_jobs(request: Request, status: str | None = None, job_type: str | None = None, limit: int = 200) -> dict:
    actor = _resolve_actor(request)
    denied = _require_admin(actor)
    if denied:
        return denied
    items = job_store.list(status=status, job_type=job_type, limit=min(limit, 500))
    return _ok_response({"jobs": items})


@app.get("/ops/jobs/{job_id}")
async def get_job(request: Request, job_id: str) -> dict:
    actor = _resolve_actor(request)
    denied = _require_admin(actor)
    if denied:
        return denied
    job = job_store.get(job_id)
    if not job:
        return _error_response("JOB_NOT_FOUND", "Job not found", "job_id", status=404)
    events = job_store.list_events(job_id)
    return _ok_response({"job": job, "events": events})


@app.post("/ops/jobs/{job_id}/retry")
async def retry_job(request: Request, job_id: str) -> dict:
    actor = _resolve_actor(request)
    denied = _require_admin(actor)
    if denied:
        return denied
    job = job_store.get(job_id)
    if not job:
        return _error_response("JOB_NOT_FOUND", "Job not found", "job_id", status=404)
    updated = job_store.update(job_id, {"status": "queued", "run_at": _now(), "last_error": None})
    return _ok_response({"job": updated})


@app.post("/ops/jobs/{job_id}/cancel")
async def cancel_job(request: Request, job_id: str) -> dict:
    actor = _resolve_actor(request)
    denied = _require_admin(actor)
    if denied:
        return denied
    job = job_store.get(job_id)
    if not job:
        return _error_response("JOB_NOT_FOUND", "Job not found", "job_id", status=404)
    updated = job_store.update(job_id, {"status": "dead", "last_error": "Cancelled"})
    return _ok_response({"job": updated})


# ---- Secrets + Connections (admin) ----


@app.post("/ops/secrets")
async def create_secret_endpoint(request: Request) -> dict:
    actor = _resolve_actor(request)
    denied = _require_admin(actor)
    if denied:
        return denied
    body = await _safe_json(request)
    value = body.get("value") if isinstance(body, dict) else None
    name = body.get("name") if isinstance(body, dict) else None
    if not value:
        return _error_response("SECRET_VALUE_REQUIRED", "value is required", "value", status=400)
    secret_id = create_secret(get_org_id(), name, value)
    return _ok_response({"secret_id": secret_id})


@app.post("/ops/connections")
async def create_connection_endpoint(request: Request) -> dict:
    actor = _resolve_actor(request)
    denied = _require_admin(actor)
    if denied:
        return denied
    body = await _safe_json(request)
    if not isinstance(body, dict):
        return _error_response("INVALID_BODY", "Expected JSON object", None, status=400)
    conn = connection_store.create(body)
    return _ok_response({"connection": conn})


@app.get("/ops/connections")
async def list_connections_endpoint(request: Request, connection_type: str | None = None) -> dict:
    actor = _resolve_actor(request)
    denied = _require_admin(actor)
    if denied:
        return denied
    items = connection_store.list(connection_type=connection_type)
    return _ok_response({"connections": items})


# ---- Notifications ----


@app.get("/notifications")
async def list_notifications(request: Request, unread_only: int = 0) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    items = notification_store.list(actor["user_id"], unread_only=bool(unread_only))
    return _ok_response({"notifications": items})


@app.get("/notifications/unread_count")
async def unread_notifications(request: Request) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    count = notification_store.unread_count(actor["user_id"])
    return _ok_response({"count": count})


@app.post("/notifications/{notification_id}/read")
async def read_notification(request: Request, notification_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    item = notification_store.mark_read(notification_id)
    if not item:
        return _error_response("NOTIFICATION_NOT_FOUND", "Notification not found", "notification_id", status=404)
    return _ok_response({"notification": item})


@app.post("/notifications/read_all")
async def read_all_notifications(request: Request) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    count = notification_store.mark_all_read(actor["user_id"])
    return _ok_response({"updated": count})


# ---- Email ----


@app.get("/templates/meta")
async def templates_meta(request: Request) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    org_id = actor.get("workspace_id") or "default"
    cache_key = f"templates_meta:{org_id}"
    cached = _resp_cache_get(cache_key)
    if cached is not None:
        logger.info("cache_hit=templates_meta key=%s", cache_key)
        return cached
    entities: list[dict] = []
    for mod in _get_registry_list(request):
        if not mod.get("enabled"):
            continue
        module_id = mod.get("module_id")
        manifest_hash = mod.get("current_hash")
        if not module_id or not manifest_hash:
            continue
        try:
            manifest = _get_snapshot(request, module_id, manifest_hash)
        except Exception:
            continue
        for ent in manifest.get("entities", []) if isinstance(manifest.get("entities"), list) else []:
            if not isinstance(ent, dict):
                continue
            ent_id = ent.get("id")
            if not isinstance(ent_id, str) or not ent_id:
                continue
            entities.append(
                {
                    "id": ent_id,
                    "label": ent.get("label") or ent.get("name") or ent_id,
                    "module_id": module_id,
                    "module_name": mod.get("name"),
                }
            )
    response = _ok_response({"entities": entities})
    _resp_cache_set(cache_key, response)
    logger.info("cache_miss=templates_meta key=%s", cache_key)
    return response


def _validation_payload(errors: list[dict], undefined: set[str], warnings: list[str], possible_undefined: set[str] | None = None) -> dict:
    return {
        "compiled_ok": not errors,
        "errors": errors,
        "undefined": sorted(undefined),
        "possible_undefined": sorted(possible_undefined or set()),
        "warnings": warnings,
        "validated_at": _now(),
    }


def _build_template_warnings(subject: str | None, body_html: str | None, body_text: str | None) -> list[str]:
    warnings: list[str] = []
    if subject is not None and not str(subject).strip():
        warnings.append("subject is empty")
    if body_html is not None and not str(body_html).strip():
        warnings.append("body_html is empty")
    if body_text is not None and not str(body_text).strip():
        warnings.append("body_text is empty")
    return warnings


def _html_to_text(html: str | None) -> str:
    if not html:
        return ""
    import re
    text = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", text).strip()


@app.get("/email/templates")
async def list_email_templates(request: Request) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    items = email_store.list_templates()
    return _ok_response({"templates": items})


@app.post("/email/templates")
async def create_email_template(request: Request) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    body = await _safe_json(request)
    if not isinstance(body, dict):
        return _error_response("INVALID_BODY", "Expected JSON object", None, status=400)
    template = email_store.create_template(body)
    return _ok_response({"template": template})


@app.get("/email/templates/{template_id}")
async def get_email_template(request: Request, template_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    template = email_store.get_template(template_id)
    if not template:
        return _error_response("TEMPLATE_NOT_FOUND", "Template not found", "template_id", status=404)
    return _ok_response({"template": template})


@app.post("/email/templates/{template_id}")
async def update_email_template(request: Request, template_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    body = await _safe_json(request)
    template = email_store.update_template(template_id, body or {})
    if not template:
        return _error_response("TEMPLATE_NOT_FOUND", "Template not found", "template_id", status=404)
    return _ok_response({"template": template})


@app.post("/email/templates/{template_id}/validate")
async def validate_email_template(request: Request, template_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    template = email_store.get_template(template_id)
    if not template:
        return _error_response("TEMPLATE_NOT_FOUND", "Template not found", "template_id", status=404)
    body = await _safe_json(request)
    sample = body.get("sample") if isinstance(body, dict) else None
    context = None
    if isinstance(sample, dict):
        entity_id = sample.get("entity_id")
        record_id = sample.get("record_id")
        if entity_id and record_id:
            record_context = generic_records.get(entity_id, record_id)
            if record_context:
                context = {"record": record_context.get("record") or {}, "entity_id": entity_id}
    subject = template.get("subject")
    body_html = template.get("body_html")
    body_text = template.get("body_text")
    errors, possible_undefined, actual_undefined = validate_templates(
        [
            ("subject", subject),
            ("body_html", body_html),
            ("body_text", body_text),
        ],
        context=context,
    )
    warnings = _build_template_warnings(subject, body_html, body_text)
    undefined = actual_undefined if actual_undefined else possible_undefined
    return _ok_response(_validation_payload(errors, undefined, warnings, possible_undefined))


@app.post("/email/templates/{template_id}/preview")
async def preview_email_template(request: Request, template_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    template = email_store.get_template(template_id)
    if not template:
        return _error_response("TEMPLATE_NOT_FOUND", "Template not found", "template_id", status=404)
    body = await _safe_json(request)
    if not isinstance(body, dict):
        return _error_response("INVALID_BODY", "Expected JSON object", None, status=400)
    sample = body.get("sample") or {}
    entity_id = sample.get("entity_id")
    record_id = sample.get("record_id")
    placeholder = bool(sample.get("placeholder"))
    if not entity_id:
        return _error_response("SAMPLE_REQUIRED", "sample.entity_id required", "sample", status=400)
    if not record_id:
        placeholder = True
    branding = _branding_context_for_org(get_org_id())
    if placeholder:
        registry = _registry_for_request(request)
        get_snapshot = lambda module_id, manifest_hash: _get_snapshot(request, module_id, manifest_hash)
        found = _find_entity_def_in_registry(registry, get_snapshot, entity_id)
        if not found:
            return _error_response("ENTITY_NOT_FOUND", "Entity not found", "entity_id", status=404)
        _, entity_def, _ = found
        fields = entity_def.get("fields") or []
        if isinstance(fields, dict):
            fields = [{"id": fid, **fdef} if isinstance(fdef, dict) else {"id": fid} for fid, fdef in fields.items()]
        record_placeholder: dict = {}
        for field in fields:
            field_id = field.get("id") if isinstance(field, dict) else None
            if isinstance(field_id, str) and field_id:
                record_placeholder[field_id] = f"{{{{ {field_id} }}}}"
        record_placeholder["id"] = "{{ id }}"
        context = {"record": record_placeholder, "entity_id": entity_id, **branding}
    else:
        record_context = generic_records.get(entity_id, record_id)
        if not record_context:
            return _error_response("RECORD_NOT_FOUND", "Record not found", "record_id", status=404)
        context = {"record": record_context.get("record") or {}, "entity_id": entity_id, **branding}
    try:
        rendered_html = render_template(template.get("body_html") or "", context, strict=True)
        rendered_text = render_template(template.get("body_text") or "", context, strict=False)
        rendered_subject = render_template(template.get("subject") or "", context, strict=True)
    except Exception as exc:
        return _error_response("TEMPLATE_RENDER_FAILED", str(exc), None, status=400)
    return _ok_response(
        {
            "rendered_html": rendered_html,
            "rendered_text": rendered_text,
            "rendered_subject": rendered_subject,
            "warnings": [],
            "logs": [],
        }
    )


@app.post("/email/templates/{template_id}/send_test")
async def send_test_email_template(request: Request, template_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    template = email_store.get_template(template_id)
    if not template:
        return _error_response("TEMPLATE_NOT_FOUND", "Template not found", "template_id", status=404)
    body = await _safe_json(request)
    if not isinstance(body, dict):
        return _error_response("INVALID_BODY", "Expected JSON object", None, status=400)
    to_email = body.get("to_email")
    if not isinstance(to_email, str) or not to_email:
        return _error_response("TO_EMAIL_REQUIRED", "to_email is required", "to_email", status=400)
    sample = body.get("sample") or {}
    entity_id = sample.get("entity_id")
    record_id = sample.get("record_id")
    if not (entity_id and record_id):
        return _error_response("SAMPLE_REQUIRED", "sample.entity_id and sample.record_id required", "sample", status=400)
    record_context = generic_records.get(entity_id, record_id)
    if not record_context:
        return _error_response("RECORD_NOT_FOUND", "Record not found", "record_id", status=404)
    connection = None
    if template.get("default_connection_id"):
        connection = connection_store.get(template.get("default_connection_id"))
    if not connection:
        connection = connection_store.get_default_email()
    if not connection:
        return _error_response("EMAIL_CONNECTION_MISSING", "Email connection not configured", "connection_id", status=400)
    branding = _branding_context_for_org(get_org_id())
    context = {"record": record_context.get("record") or {}, "entity_id": entity_id, **branding}
    try:
        subject = render_template(template.get("subject") or "", context, strict=True)
        body_html = render_template(template.get("body_html") or "", context, strict=True)
        body_text = render_template(template.get("body_text") or "", context, strict=False)
    except Exception as exc:
        return _error_response("TEMPLATE_RENDER_FAILED", str(exc), None, status=400)
    if not str(subject or "").strip():
        return _error_response("SUBJECT_REQUIRED", "subject is required", "subject", status=400)
    if not body_text and body_html:
        body_text = _html_to_text(body_html)
    outbox = email_store.create_outbox(
        {
            "to": [to_email],
            "cc": [],
            "bcc": [],
            "from_email": connection.get("config", {}).get("from_email"),
            "reply_to": None,
            "subject": subject,
            "body_html": body_html,
            "body_text": body_text,
            "status": "queued",
            "template_id": template_id,
        }
    )
    job = job_store.enqueue(
        {
            "type": "email.send",
            "payload": {"outbox_id": outbox.get("id"), "connection_id": connection.get("id")},
        }
    )
    return _ok_response({"outbox_id": outbox.get("id"), "status": outbox.get("status"), "job": job})


@app.get("/email/outbox")
async def list_email_outbox(request: Request, limit: int = 200, template_id: str | None = None) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    items = email_store.list_outbox(limit=min(limit, 500), template_id=template_id)
    return _ok_response({"outbox": items})


@app.get("/email/templates/{template_id}/history")
async def email_template_history(request: Request, template_id: str, limit: int = 100) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    template = email_store.get_template(template_id)
    if not template:
        return _error_response("TEMPLATE_NOT_FOUND", "Template not found", "template_id", status=404)
    items = email_store.list_outbox(limit=min(limit, 200), template_id=template_id)
    return _ok_response({"outbox": items})


@app.post("/email/send")
async def send_email(request: Request) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    body = await _safe_json(request)
    if not isinstance(body, dict):
        return _error_response("INVALID_BODY", "Expected JSON object", None, status=400)
    connection_id = body.get("connection_id")
    connection = connection_store.get(connection_id) if connection_id else None
    if not connection and template and template.get("default_connection_id"):
        connection = connection_store.get(template.get("default_connection_id"))
    if not connection:
        connection = connection_store.get_default_email()
    if not connection:
        return _error_response("EMAIL_CONNECTION_MISSING", "Email connection not configured", "connection_id", status=400)
    record_context = {}
    if body.get("entity_id") and body.get("record_id"):
        record_context = generic_records.get(body.get("entity_id"), body.get("record_id")) or {}
    template = None
    if body.get("template_id"):
        template = email_store.get_template(body.get("template_id"))
        if not template:
            return _error_response("TEMPLATE_NOT_FOUND", "Template not found", "template_id", status=404)
    subject = body.get("subject") or (template.get("subject") if template else None)
    if not subject:
        return _error_response("SUBJECT_REQUIRED", "subject is required", "subject", status=400)
    branding = _branding_context_for_org(get_org_id())
    context = {"record": record_context, **branding}
    body_html = body.get("body_html") or (template.get("body_html") if template else None)
    body_text = body.get("body_text") or (template.get("body_text") if template else None)
    if body_html:
        try:
            body_html = render_template(body_html, context, strict=True)
        except Exception as exc:
            return _error_response("EMAIL_TEMPLATE_RENDER_FAILED", str(exc), "body_html", status=400)
    if body_text:
        try:
            body_text = render_template(body_text, context, strict=True)
        except Exception as exc:
            return _error_response("EMAIL_TEMPLATE_RENDER_FAILED", str(exc), "body_text", status=400)
    if not body_text and body_html:
        body_text = _html_to_text(body_html)
    outbox = email_store.create_outbox(
        {
            "to": body.get("to") or [],
            "cc": body.get("cc") or [],
            "bcc": body.get("bcc") or [],
            "from_email": connection.get("config", {}).get("from_email"),
            "reply_to": body.get("reply_to"),
            "subject": subject,
            "body_html": body_html,
            "body_text": body_text,
            "status": "queued",
            "template_id": body.get("template_id"),
        }
    )
    job = job_store.enqueue(
        {
            "type": "email.send",
            "payload": {"outbox_id": outbox.get("id"), "connection_id": connection.get("id")},
        }
    )
    return _ok_response({"outbox": outbox, "job": job})


# ---- Documents ----


@app.get("/documents/templates")
async def list_doc_templates(request: Request) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    items = doc_template_store.list()
    return _ok_response({"templates": items})


@app.post("/documents/templates")
async def create_doc_template(request: Request) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    body = await _safe_json(request)
    if not isinstance(body, dict):
        return _error_response("INVALID_BODY", "Expected JSON object", None, status=400)
    template = doc_template_store.create(body)
    return _ok_response({"template": template})


@app.post("/documents/templates/{template_id}")
async def update_doc_template(request: Request, template_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    body = await _safe_json(request)
    template = doc_template_store.update(template_id, body or {})
    if not template:
        return _error_response("TEMPLATE_NOT_FOUND", "Template not found", "template_id", status=404)
    return _ok_response({"template": template})


@app.get("/documents/templates/{template_id}")
async def get_doc_template(request: Request, template_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    template = doc_template_store.get(template_id)
    if not template:
        return _error_response("TEMPLATE_NOT_FOUND", "Template not found", "template_id", status=404)
    return _ok_response({"template": template})


@app.post("/docs/templates/{template_id}/validate")
async def validate_doc_template(request: Request, template_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    template = doc_template_store.get(template_id)
    if not template:
        return _error_response("TEMPLATE_NOT_FOUND", "Template not found", "template_id", status=404)
    body = await _safe_json(request)
    sample = body.get("sample") if isinstance(body, dict) else None
    context = None
    if isinstance(sample, dict):
        entity_id = sample.get("entity_id")
        record_id = sample.get("record_id")
        if entity_id and record_id:
            record_context = generic_records.get(entity_id, record_id)
            if record_context:
                found = _find_entity_def(request, entity_id)
                entity_def = found[1] if found else None
                record_data = record_context.get("record") or {}
                context = {
                    "record": _enrich_template_record(record_data, entity_def),
                    "entity_id": entity_id,
                    **_branding_context_for_org(get_org_id()),
                }
    html = template.get("html")
    filename_pattern = template.get("filename_pattern") or template.get("name")
    header_html = template.get("header_html")
    footer_html = template.get("footer_html")
    errors, possible_undefined, actual_undefined = validate_templates(
        [
            ("filename_pattern", filename_pattern),
            ("html", html),
            ("header_html", header_html),
            ("footer_html", footer_html),
        ],
        context=context,
    )
    warnings: list[str] = []
    if filename_pattern is not None and not str(filename_pattern).strip():
        warnings.append("filename pattern is empty")
    if html is not None and not str(html).strip():
        warnings.append("html is empty")
    undefined = actual_undefined if actual_undefined else possible_undefined
    return _ok_response(_validation_payload(errors, undefined, warnings, possible_undefined))


@app.post("/docs/templates/{template_id}/preview")
async def preview_doc_template(request: Request, template_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    template = doc_template_store.get(template_id)
    if not template:
        return _error_response("TEMPLATE_NOT_FOUND", "Template not found", "template_id", status=404)
    body = await _safe_json(request)
    if not isinstance(body, dict):
        return _error_response("INVALID_BODY", "Expected JSON object", None, status=400)
    sample = body.get("sample") or {}
    entity_id = sample.get("entity_id")
    record_id = sample.get("record_id")
    placeholder = bool(sample.get("placeholder"))
    if not entity_id:
        return _error_response("SAMPLE_REQUIRED", "sample.entity_id required", "sample", status=400)
    if not record_id:
        placeholder = True
    if placeholder:
        registry = _registry_for_request(request)
        get_snapshot = lambda module_id, manifest_hash: _get_snapshot(request, module_id, manifest_hash)
        found = _find_entity_def_in_registry(registry, get_snapshot, entity_id)
        if not found:
            return _error_response("ENTITY_NOT_FOUND", "Entity not found", "entity_id", status=404)
        _, entity_def, _ = found
        fields = entity_def.get("fields") or []
        if isinstance(fields, dict):
            fields = [{"id": fid, **fdef} if isinstance(fdef, dict) else {"id": fid} for fid, fdef in fields.items()]
        record_placeholder: dict = {}
        for field in fields:
            field_id = field.get("id") if isinstance(field, dict) else None
            if isinstance(field_id, str) and field_id:
                record_placeholder[field_id] = f"{{{{ {field_id} }}}}"
        record_placeholder["id"] = "{{ id }}"
        context = {"record": record_placeholder, "entity_id": entity_id, **_branding_context_for_org(get_org_id())}
    else:
        record_context = generic_records.get(entity_id, record_id)
        if not record_context:
            return _error_response("RECORD_NOT_FOUND", "Record not found", "record_id", status=404)
        found = _find_entity_def(request, entity_id)
        entity_def = found[1] if found else None
        record_data = record_context.get("record") or {}
        context = {
            "record": _enrich_template_record(record_data, entity_def),
            "entity_id": entity_id,
            **_branding_context_for_org(get_org_id()),
        }
    try:
        html = render_template(template.get("html") or "", context, strict=True)
        filename_pattern = template.get("filename_pattern") or template.get("name") or "document"
        filename = render_template(filename_pattern, context, strict=True)
        header_html = template.get("header_html") or ""
        footer_html = template.get("footer_html") or ""
        if header_html:
            header_html = render_template(header_html, context, strict=True)
        if footer_html:
            footer_html = render_template(footer_html, context, strict=True)
    except Exception as exc:
        return _error_response("TEMPLATE_RENDER_FAILED", str(exc), None, status=400)
    margins = {
        "top": template.get("margin_top") or "12mm",
        "right": template.get("margin_right") or "12mm",
        "bottom": template.get("margin_bottom") or "12mm",
        "left": template.get("margin_left") or "12mm",
    }
    try:
        margins = normalize_margins(margins)
    except Exception as exc:
        return _error_response("MARGINS_INVALID", str(exc), "margins", status=400)
    paper_size = template.get("paper_size") or "A4"
    try:
        pdf_bytes = await anyio.to_thread.run_sync(
            render_pdf,
            html,
            paper_size,
            margins,
            header_html,
            footer_html,
        )
    except Exception as exc:
        return _error_response("PDF_RENDER_FAILED", str(exc), None, status=500)
    stored = store_bytes(get_org_id(), f"{filename}.pdf", pdf_bytes)
    attachment = attachment_store.create_attachment(
        {
            "filename": f"{filename}.pdf",
            "mime_type": "application/pdf",
            "size": stored["size"],
            "storage_key": stored["storage_key"],
            "sha256": stored["sha256"],
            "created_by": actor.get("user_id"),
            "source": "preview",
        }
    )
    return _ok_response(
        {
            "attachment_id": attachment.get("id"),
            "filename": attachment.get("filename"),
            "warnings": [],
            "logs": [],
        }
    )


@app.get("/docs/templates/{template_id}/history")
async def docs_template_history(request: Request, template_id: str, limit: int = 100) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    template = doc_template_store.get(template_id)
    if not template:
        return _error_response("TEMPLATE_NOT_FOUND", "Template not found", "template_id", status=404)
    purpose = f"template:{template_id}"
    links = attachment_store.list_links_by_purpose(purpose, limit=min(limit, 200))
    attachments = []
    for link in links:
        att = attachment_store.get_attachment(link.get("attachment_id"))
        if att:
            attachments.append(att)
    return _ok_response({"links": links, "attachments": attachments})


@app.get("/docs/templates/{template_id}/jobs")
async def docs_template_jobs(request: Request, template_id: str, limit: int = 100) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    template = doc_template_store.get(template_id)
    if not template:
        return _error_response("TEMPLATE_NOT_FOUND", "Template not found", "template_id", status=404)
    items = job_store.list_by_payload("doc.generate", "template_id", template_id, limit=min(limit, 200))
    return _ok_response({"jobs": items})


@app.post("/documents/generate")
async def generate_document(request: Request) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    body = await _safe_json(request)
    if not isinstance(body, dict):
        return _error_response("INVALID_BODY", "Expected JSON object", None, status=400)
    template_id = body.get("template_id")
    entity_id = body.get("entity_id")
    record_id = body.get("record_id")
    if not (template_id and entity_id and record_id):
        return _error_response("DOC_INPUT_REQUIRED", "template_id, entity_id, record_id required", None, status=400)
    job = job_store.enqueue(
        {
            "type": "doc.generate",
            "payload": {
                "template_id": template_id,
                "entity_id": entity_id,
                "record_id": record_id,
                "purpose": body.get("purpose") or "default",
            },
        }
    )
    return _ok_response({"job": job})


# ---- Automations (Phase 2) ----


def _validate_automation_payload(data: dict, for_update: bool = False) -> list[dict]:
    errors: list[dict] = []
    if not for_update or "name" in data:
        if not isinstance(data.get("name"), str) or not data.get("name"):
            errors.append(_issue("AUTOMATION_NAME_REQUIRED", "name is required", "name"))
    if not for_update or "trigger" in data:
        trigger = data.get("trigger")
        if not isinstance(trigger, dict):
            errors.append(_issue("AUTOMATION_TRIGGER_INVALID", "trigger must be object", "trigger"))
        else:
            if trigger.get("kind") != "event":
                errors.append(_issue("AUTOMATION_TRIGGER_INVALID", "trigger.kind must be 'event'", "trigger.kind"))
            event_types = trigger.get("event_types")
            if not isinstance(event_types, list) or not all(isinstance(e, str) for e in event_types):
                errors.append(_issue("AUTOMATION_TRIGGER_INVALID", "event_types must be list of strings", "trigger.event_types"))
            filters = trigger.get("filters", [])
            if filters is not None and not isinstance(filters, list):
                errors.append(_issue("AUTOMATION_TRIGGER_INVALID", "filters must be list", "trigger.filters"))
    if not for_update or "steps" in data:
        steps = data.get("steps")
        if not isinstance(steps, list) or not steps:
            errors.append(_issue("AUTOMATION_STEPS_REQUIRED", "steps must be non-empty list", "steps"))
        else:
            for idx, step in enumerate(steps):
                if not isinstance(step, dict):
                    errors.append(_issue("AUTOMATION_STEP_INVALID", "step must be object", f"steps[{idx}]"))
                    continue
                kind = step.get("kind")
                if kind not in {"action", "condition", "delay"}:
                    errors.append(_issue("AUTOMATION_STEP_INVALID", "unsupported step kind", f"steps[{idx}].kind"))
                if kind == "action" and not isinstance(step.get("action_id"), str):
                    errors.append(_issue("AUTOMATION_STEP_INVALID", "action_id required", f"steps[{idx}].action_id"))
                if kind == "condition" and not isinstance(step.get("expr"), dict):
                    errors.append(_issue("AUTOMATION_STEP_INVALID", "expr required", f"steps[{idx}].expr"))
                if kind == "delay":
                    if "seconds" not in step and "until" not in step:
                        errors.append(_issue("AUTOMATION_STEP_INVALID", "seconds or until required", f"steps[{idx}]"))
    return errors


@app.get("/automations")
async def list_automations(request: Request, status: str | None = None) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    items = automation_store.list(status=status)
    return _ok_response({"automations": items})


@app.post("/automations")
async def create_automation(request: Request) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    body = await _safe_json(request)
    if not isinstance(body, dict):
        return _error_response("INVALID_BODY", "Expected JSON object", None, status=400)
    errors = _validate_automation_payload(body)
    if errors:
        return _error_response("AUTOMATION_INVALID", "Invalid automation", None, detail={"errors": errors}, status=400)
    item = automation_store.create(
        {
            "name": body.get("name"),
            "description": body.get("description"),
            "status": body.get("status", "draft"),
            "trigger": body.get("trigger"),
            "steps": body.get("steps"),
        }
    )
    return _ok_response({"automation": item})


@app.get("/automations/{automation_id}")
async def get_automation(request: Request, automation_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    item = automation_store.get(automation_id)
    if not item:
        return _error_response("AUTOMATION_NOT_FOUND", "Automation not found", "automation_id", status=404)
    return _ok_response({"automation": item})


@app.put("/automations/{automation_id}")
async def update_automation(request: Request, automation_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    body = await _safe_json(request)
    if not isinstance(body, dict):
        return _error_response("INVALID_BODY", "Expected JSON object", None, status=400)
    errors = _validate_automation_payload(body, for_update=True)
    if errors:
        return _error_response("AUTOMATION_INVALID", "Invalid automation", None, detail={"errors": errors}, status=400)
    item = automation_store.update(automation_id, body)
    if not item:
        return _error_response("AUTOMATION_NOT_FOUND", "Automation not found", "automation_id", status=404)
    return _ok_response({"automation": item})


@app.post("/automations/{automation_id}/publish")
async def publish_automation(request: Request, automation_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    item = automation_store.update(
        automation_id,
        {"status": "published", "published_at": _now(), "published_by": (actor or {}).get("user_id")},
    )
    if not item:
        return _error_response("AUTOMATION_NOT_FOUND", "Automation not found", "automation_id", status=404)
    return _ok_response({"automation": item})


@app.post("/automations/{automation_id}/disable")
async def disable_automation(request: Request, automation_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    item = automation_store.update(automation_id, {"status": "disabled"})
    if not item:
        return _error_response("AUTOMATION_NOT_FOUND", "Automation not found", "automation_id", status=404)
    return _ok_response({"automation": item})


@app.delete("/automations/{automation_id}")
async def delete_automation(request: Request, automation_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    existing = automation_store.get(automation_id)
    if not existing:
        return _error_response("AUTOMATION_NOT_FOUND", "Automation not found", "automation_id", status=404)
    if existing.get("status") not in {"draft", "disabled"}:
        return _error_response("AUTOMATION_DELETE_FORBIDDEN", "Only draft/disabled automations can be deleted", "status", status=400)
    automation_store.delete(automation_id)
    return _ok_response({"deleted": True})


@app.get("/automations/{automation_id}/runs")
async def list_automation_runs(request: Request, automation_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    org_id = (actor or {}).get("workspace_id") or "default"
    cache_key = f"automation_runs:{org_id}:{automation_id}"
    cached = _resp_cache_get(cache_key)
    if cached is not None:
        logger.info("cache_hit=automation_runs key=%s", cache_key)
        return cached
    items = automation_store.list_runs(automation_id=automation_id)
    response = _ok_response({"runs": items})
    _resp_cache_set(cache_key, response)
    logger.info("cache_miss=automation_runs key=%s", cache_key)
    return response


@app.get("/automation-runs/{run_id}")
async def get_automation_run(request: Request, run_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    run = automation_store.get_run(run_id)
    if not run:
        return _error_response("AUTOMATION_RUN_NOT_FOUND", "Run not found", "run_id", status=404)
    steps = automation_store.list_step_runs(run_id)
    return _ok_response({"run": run, "steps": steps})


@app.post("/automation-runs/{run_id}/retry")
async def retry_automation_run(request: Request, run_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    run = automation_store.get_run(run_id)
    if not run:
        return _error_response("AUTOMATION_RUN_NOT_FOUND", "Run not found", "run_id", status=404)
    updated = automation_store.update_run(run_id, {"status": "queued", "last_error": None})
    job = job_store.enqueue({"type": "automation.run", "payload": {"run_id": run_id}})
    return _ok_response({"run": updated, "job": job})


@app.post("/automation-runs/{run_id}/cancel")
async def cancel_automation_run(request: Request, run_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    run = automation_store.get_run(run_id)
    if not run:
        return _error_response("AUTOMATION_RUN_NOT_FOUND", "Run not found", "run_id", status=404)
    updated = automation_store.update_run(run_id, {"status": "cancelled", "ended_at": _now()})
    return _ok_response({"run": updated})


# ---- Attachments ----


@app.post("/attachments/upload")
async def upload_attachment(request: Request, file: UploadFile = File(...)) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    data = await file.read()
    stored = store_bytes(get_org_id(), file.filename, data, mime_type=file.content_type or "application/octet-stream")
    attachment = attachment_store.create_attachment(
        {
            "filename": file.filename,
            "mime_type": file.content_type or "application/octet-stream",
            "size": stored["size"],
            "storage_key": stored["storage_key"],
            "sha256": stored["sha256"],
            "created_by": actor.get("user_id"),
        }
    )
    return _ok_response({"attachment": attachment})


@app.post("/prefs/ui/logo/upload")
async def upload_workspace_logo(request: Request, file: UploadFile = File(...)) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    if not using_supabase_storage():
        return _error_response(
            "SUPABASE_STORAGE_NOT_CONFIGURED",
            "Supabase storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
            None,
            status=400,
        )
    org_id = get_org_id()
    data = await file.read()
    stored = store_bytes(
        org_id,
        file.filename,
        data,
        mime_type=file.content_type or "application/octet-stream",
        bucket=branding_bucket(),
    )
    logo_url = public_url(branding_bucket(), stored["storage_key"])
    with get_conn() as conn:
        current = fetch_one(
            conn,
            "select theme, colors from workspace_ui_prefs where org_id=%s",
            [org_id],
            query_name="workspace_ui_prefs.current_for_logo",
        ) or {}
        execute(
            conn,
            """
            insert into workspace_ui_prefs (org_id, theme, colors, logo_url, updated_at)
            values (%s, %s, %s, %s, %s)
            on conflict (org_id)
            do update set theme=excluded.theme, colors=excluded.colors, logo_url=excluded.logo_url, updated_at=excluded.updated_at
            """,
            [org_id, current.get("theme"), json.dumps(current.get("colors")) if current.get("colors") is not None else None, logo_url, _now()],
            query_name="workspace_ui_prefs.upsert_logo",
        )
    return _ok_response({"logo_url": logo_url})


@app.post("/ops/attachments/cleanup")
async def cleanup_preview_attachments(request: Request) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    admin = _require_admin(actor)
    if admin:
        return admin
    body = await _safe_json(request)
    source = "preview"
    hours = 24
    limit = 200
    if isinstance(body, dict):
        source = body.get("source") or source
        hours = body.get("older_than_hours") or hours
        limit = body.get("limit") or limit
    job = job_store.enqueue(
        {
            "type": "attachments.cleanup",
            "payload": {"source": source, "older_than_hours": hours, "limit": limit},
        }
    )
    return _ok_response({"job": job})


@app.get("/attachments/{attachment_id}/download")
async def download_attachment(request: Request, attachment_id: str):
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    attachment = attachment_store.get_attachment(attachment_id)
    if not attachment:
        return _error_response("ATTACHMENT_NOT_FOUND", "Attachment not found", "attachment_id", status=404)
    storage_key = attachment.get("storage_key")
    try:
        data = read_bytes(get_org_id(), storage_key)
    except FileNotFoundError:
        return _error_response("ATTACHMENT_MISSING", "Attachment file missing", "storage_key", status=404)
    except RuntimeError:
        path = resolve_path(get_org_id(), storage_key)
        if not path.exists():
            return _error_response("ATTACHMENT_MISSING", "Attachment file missing", "storage_key", status=404)
        from fastapi.responses import FileResponse

        return FileResponse(path, media_type=attachment.get("mime_type"), filename=attachment.get("filename"))
    headers = {"Content-Disposition": f'attachment; filename="{attachment.get("filename") or "attachment"}"'}
    return Response(content=data, media_type=attachment.get("mime_type") or "application/octet-stream", headers=headers)


@app.post("/attachments/link")
async def link_attachment(request: Request) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    body = await _safe_json(request)
    if not isinstance(body, dict):
        return _error_response("INVALID_BODY", "Expected JSON object", None, status=400)
    if not (body.get("attachment_id") and body.get("entity_id") and body.get("record_id")):
        return _error_response("ATTACHMENT_LINK_REQUIRED", "attachment_id, entity_id, record_id required", None, status=400)
    link = attachment_store.link(body)
    try:
        attachment = attachment_store.get_attachment(body.get("attachment_id"))
        if attachment:
            activity_store.add_attachment(
                _normalize_entity_id(body.get("entity_id")),
                body.get("record_id"),
                attachment,
                actor=getattr(request.state, "user", None),
            )
    except Exception:
        pass
    return _ok_response({"link": link})


@app.get("/records/{entity_id}/{record_id}/attachments")
async def list_record_attachments(request: Request, entity_id: str, record_id: str) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    links = attachment_store.list_links(entity_id, record_id)
    attachments = []
    for link in links:
        att = attachment_store.get_attachment(link.get("attachment_id"))
        if att:
            attachments.append(att)
    return _ok_response({"links": links, "attachments": attachments})


# ---- System actions (Phase 1) ----


@app.post("/system/notify")
async def system_notify(request: Request) -> dict:
    actor = _resolve_actor(request)
    if isinstance(actor, JSONResponse):
        return actor
    body = await _safe_json(request)
    if not isinstance(body, dict):
        return _error_response("INVALID_BODY", "Expected JSON object", None, status=400)
    if not body.get("recipient_user_id"):
        return _error_response("RECIPIENT_REQUIRED", "recipient_user_id required", "recipient_user_id", status=400)
    item = notification_store.create(body)
    return _ok_response({"notification": item})


@app.post("/system/send_email")
async def system_send_email(request: Request) -> dict:
    return await send_email(request)


@app.post("/system/generate_document")
async def system_generate_document(request: Request) -> dict:
    return await generate_document(request)
