from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from app.db import execute, fetch_all, fetch_one, get_conn
from app.records_validation import normalize_entity_id as _normalize_entity_id
from app.stores_db import _is_undefined_table, _now, get_org_id

ALLOWED_SCOPE_TYPES = {"global", "entity", "workspace"}
ALLOWED_RESET_POLICIES = {"never", "yearly", "monthly"}
ALLOWED_ASSIGN_ON = {"create", "save", "confirm", "issue", "custom"}
ALLOWED_TOKENS = {"YYYY", "YY", "MM", "DD", "SEQ", "ENTITY", "WORKSPACE", "MODEL"}
_TOKEN_RE = re.compile(r"\{([A-Z]+)(?::(\d+))?\}")


class SequenceError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        path: str | None = None,
        detail: dict | None = None,
        status: int = 400,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.path = path
        self.detail = detail
        self.status = status


def _normalize_status_values(values: Any) -> list[str]:
    out: list[str] = []
    for item in values if isinstance(values, list) else []:
        if not isinstance(item, str):
            continue
        normalized = item.strip()
        if normalized and normalized not in out:
            out.append(normalized)
    return out


def _display_code(value: Any, fallback: str) -> str:
    if isinstance(value, str):
        cleaned = re.sub(r"[^A-Za-z0-9]+", "", value).upper()
        if cleaned:
            return cleaned[:24]
    return fallback


def _scope_key_value(value: Any, fallback: str) -> str:
    if isinstance(value, str):
        slug = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
        if slug:
            return slug[:64]
    return fallback


def validate_pattern(pattern: str) -> None:
    if not isinstance(pattern, str) or not pattern.strip():
        raise SequenceError("SEQUENCE_PATTERN_REQUIRED", "Pattern is required.", path="pattern")
    text = pattern.strip()
    has_seq = False
    idx = 0
    while idx < len(text):
        char = text[idx]
        if char == "{":
            match = _TOKEN_RE.match(text, idx)
            if not match:
                raise SequenceError("SEQUENCE_PATTERN_INVALID", "Pattern contains invalid token syntax.", path="pattern")
            token = match.group(1)
            padding = match.group(2)
            if token not in ALLOWED_TOKENS:
                raise SequenceError("SEQUENCE_PATTERN_TOKEN_INVALID", f"Unsupported token: {token}", path="pattern")
            if padding is not None:
                if token != "SEQ":
                    raise SequenceError("SEQUENCE_PATTERN_PADDING_INVALID", "Only {SEQ:n} tokens may include padding.", path="pattern")
                try:
                    pad_value = int(padding)
                except Exception:
                    raise SequenceError("SEQUENCE_PATTERN_PADDING_INVALID", "Sequence padding must be a number.", path="pattern") from None
                if pad_value < 1 or pad_value > 12:
                    raise SequenceError("SEQUENCE_PATTERN_PADDING_INVALID", "Sequence padding must be between 1 and 12.", path="pattern")
            has_seq = has_seq or token == "SEQ"
            idx = match.end()
            continue
        if char == "}":
            raise SequenceError("SEQUENCE_PATTERN_INVALID", "Pattern contains an unmatched closing brace.", path="pattern")
        idx += 1
    if not has_seq:
        raise SequenceError("SEQUENCE_PATTERN_SEQ_REQUIRED", "Pattern must contain a {SEQ} token.", path="pattern")


def _normalize_definition_payload(payload: dict, *, partial: bool = False) -> dict:
    if not isinstance(payload, dict):
        raise SequenceError("INVALID_BODY", "Expected JSON object.", path="body")
    out: dict[str, Any] = {}

    def _require_str(key: str, label: str) -> None:
        if key not in payload and partial:
            return
        value = payload.get(key)
        if not isinstance(value, str) or not value.strip():
            raise SequenceError("FIELD_REQUIRED", f"{label} is required.", path=key)
        out[key] = value.strip()

    _require_str("code", "Code")
    _require_str("name", "Name")
    _require_str("target_entity_id", "Target entity")
    _require_str("number_field_id", "Number field")
    if "description" in payload:
        value = payload.get("description")
        out["description"] = value.strip() if isinstance(value, str) else None
    if "pattern" in payload or not partial:
        pattern = payload.get("pattern")
        if not isinstance(pattern, str) or not pattern.strip():
            raise SequenceError("FIELD_REQUIRED", "Pattern is required.", path="pattern")
        pattern = pattern.strip()
        validate_pattern(pattern)
        out["pattern"] = pattern
    if "scope_type" in payload or not partial:
        scope_type = payload.get("scope_type", "global")
        if not isinstance(scope_type, str) or scope_type not in ALLOWED_SCOPE_TYPES:
            raise SequenceError("FIELD_INVALID", "Scope type is invalid.", path="scope_type")
        out["scope_type"] = scope_type
    if "scope_field_id" in payload or not partial:
        scope_field_id = payload.get("scope_field_id")
        out["scope_field_id"] = scope_field_id.strip() if isinstance(scope_field_id, str) and scope_field_id.strip() else None
    if "reset_policy" in payload or not partial:
        reset_policy = payload.get("reset_policy", "never")
        if not isinstance(reset_policy, str) or reset_policy not in ALLOWED_RESET_POLICIES:
            raise SequenceError("FIELD_INVALID", "Reset policy is invalid.", path="reset_policy")
        out["reset_policy"] = reset_policy
    if "assign_on" in payload or not partial:
        assign_on = payload.get("assign_on", "create")
        if not isinstance(assign_on, str) or assign_on not in ALLOWED_ASSIGN_ON:
            raise SequenceError("FIELD_INVALID", "Assign-on event is invalid.", path="assign_on")
        out["assign_on"] = assign_on
    if "trigger_status_values" in payload or not partial:
        out["trigger_status_values"] = _normalize_status_values(payload.get("trigger_status_values") or [])
    if "is_active" in payload or not partial:
        out["is_active"] = bool(payload.get("is_active", True))
    if "lock_after_assignment" in payload or not partial:
        out["lock_after_assignment"] = bool(payload.get("lock_after_assignment", True))
    if "allow_admin_override" in payload or not partial:
        out["allow_admin_override"] = bool(payload.get("allow_admin_override", False))
    if "notes" in payload:
        value = payload.get("notes")
        out["notes"] = value.strip() if isinstance(value, str) else None
    if "sort_order" in payload or not partial:
        sort_order = payload.get("sort_order", 100)
        try:
            out["sort_order"] = int(sort_order)
        except Exception:
            raise SequenceError("FIELD_INVALID", "Sort order must be a number.", path="sort_order") from None

    scope_type = out.get("scope_type") if "scope_type" in out else payload.get("scope_type")
    scope_field_id = out.get("scope_field_id") if "scope_field_id" in out else payload.get("scope_field_id")
    assign_on = out.get("assign_on") if "assign_on" in out else payload.get("assign_on")
    trigger_status_values = out.get("trigger_status_values") if "trigger_status_values" in out else _normalize_status_values(payload.get("trigger_status_values") or [])

    if scope_type == "entity" and (not isinstance(scope_field_id, str) or not scope_field_id.strip()):
        raise SequenceError("FIELD_REQUIRED", "Entity-scoped sequences require a scope field.", path="scope_field_id")
    if assign_on in {"confirm", "issue"} and not trigger_status_values and not partial:
        raise SequenceError("FIELD_REQUIRED", "Choose at least one trigger status for confirm/issue numbering.", path="trigger_status_values")
    return out


def _deserialize_definition(row: dict | None) -> dict | None:
    if not isinstance(row, dict):
        return None
    item = dict(row)
    item["target_entity_id"] = _normalize_entity_id(item.get("target_entity_id"))
    item["trigger_status_values"] = _normalize_status_values(item.pop("trigger_status_values_json", None))
    try:
        item["assignment_count"] = int(item.get("assignment_count") or 0)
    except Exception:
        item["assignment_count"] = 0
    return item


def list_document_sequences(*, entity_id: str | None = None, active_only: bool = False) -> list[dict]:
    clauses = ["org_id=%s"]
    params: list[Any] = [get_org_id()]
    if isinstance(entity_id, str) and entity_id.strip():
        clauses.append("target_entity_id=%s")
        params.append(_normalize_entity_id(entity_id))
    if active_only:
        clauses.append("is_active=true")
    try:
        with get_conn() as conn:
            rows = fetch_all(
                conn,
                f"""
                select d.*,
                       coalesce(stats.assignment_count, 0) as assignment_count,
                       stats.last_assigned_at
                from document_sequence_definitions d
                left join (
                  select sequence_definition_id,
                         count(*) as assignment_count,
                         max(created_at) as last_assigned_at
                  from document_sequence_assignment_logs
                  where org_id=%s
                  group by sequence_definition_id
                ) stats on stats.sequence_definition_id = d.id
                where {' and '.join(f'd.{clause}' for clause in clauses)}
                order by d.sort_order asc, lower(d.name) asc, d.created_at asc
                """,
                [get_org_id(), *params],
                query_name="document_sequences.list",
            )
            return [_deserialize_definition(row) for row in rows if isinstance(row, dict)]
    except Exception as exc:
        if _is_undefined_table(exc):
            try:
                with get_conn() as conn:
                    rows = fetch_all(
                        conn,
                        f"""
                        select *
                        from document_sequence_definitions
                        where {' and '.join(clauses)}
                        order by sort_order asc, lower(name) asc, created_at asc
                        """,
                        params,
                        query_name="document_sequences.list_fallback",
                    )
                    return [_deserialize_definition(row) for row in rows if isinstance(row, dict)]
            except Exception as inner_exc:
                if _is_undefined_table(inner_exc):
                    return []
                raise
        raise


def get_document_sequence(sequence_id: str) -> dict | None:
    try:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                select d.*,
                       coalesce(stats.assignment_count, 0) as assignment_count,
                       stats.last_assigned_at
                from document_sequence_definitions d
                left join (
                  select sequence_definition_id,
                         count(*) as assignment_count,
                         max(created_at) as last_assigned_at
                  from document_sequence_assignment_logs
                  where org_id=%s
                  group by sequence_definition_id
                ) stats on stats.sequence_definition_id = d.id
                where d.org_id=%s and d.id=%s
                """,
                [get_org_id(), get_org_id(), sequence_id],
                query_name="document_sequences.get",
            )
            return _deserialize_definition(row)
    except Exception as exc:
        if _is_undefined_table(exc):
            try:
                with get_conn() as conn:
                    row = fetch_one(
                        conn,
                        """
                        select *
                        from document_sequence_definitions
                        where org_id=%s and id=%s
                        """,
                        [get_org_id(), sequence_id],
                        query_name="document_sequences.get_fallback",
                    )
                    return _deserialize_definition(row)
            except Exception as inner_exc:
                if _is_undefined_table(inner_exc):
                    return None
                raise
        raise


def create_document_sequence(payload: dict, *, actor: dict | None = None) -> dict:
    data = _normalize_definition_payload(payload, partial=False)
    sequence_id = str(uuid.uuid4())
    try:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                insert into document_sequence_definitions (
                  id, org_id, code, name, target_entity_id, number_field_id, description, is_active,
                  pattern, scope_type, scope_field_id, reset_policy, assign_on, trigger_status_values_json,
                  lock_after_assignment, allow_admin_override, notes, sort_order, created_by, updated_by, created_at, updated_at
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now(), now())
                returning *
                """,
                [
                    sequence_id,
                    get_org_id(),
                    data["code"],
                    data["name"],
                    data["target_entity_id"],
                    data["number_field_id"],
                    data.get("description"),
                    data.get("is_active", True),
                    data["pattern"],
                    data.get("scope_type", "global"),
                    data.get("scope_field_id"),
                    data.get("reset_policy", "never"),
                    data.get("assign_on", "create"),
                    json.dumps(data.get("trigger_status_values") or []),
                    data.get("lock_after_assignment", True),
                    data.get("allow_admin_override", False),
                    data.get("notes"),
                    data.get("sort_order", 100),
                    actor.get("user_id") if isinstance(actor, dict) else None,
                    actor.get("user_id") if isinstance(actor, dict) else None,
                ],
                query_name="document_sequences.create",
            )
            return _deserialize_definition(row)
    except Exception as exc:
        if getattr(getattr(exc, "diag", None), "constraint_name", None):
            raise SequenceError("SEQUENCE_SAVE_FAILED", "Sequence save failed due to a database constraint.", path="sequence", detail={"constraint": exc.diag.constraint_name}) from exc
        raise


def update_document_sequence(sequence_id: str, payload: dict, *, actor: dict | None = None) -> dict | None:
    existing = get_document_sequence(sequence_id)
    if not existing:
        return None
    merged = dict(existing)
    merged.update(payload or {})
    data = _normalize_definition_payload(merged, partial=False)
    try:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                """
                update document_sequence_definitions
                set code=%s,
                    name=%s,
                    target_entity_id=%s,
                    number_field_id=%s,
                    description=%s,
                    is_active=%s,
                    pattern=%s,
                    scope_type=%s,
                    scope_field_id=%s,
                    reset_policy=%s,
                    assign_on=%s,
                    trigger_status_values_json=%s,
                    lock_after_assignment=%s,
                    allow_admin_override=%s,
                    notes=%s,
                    sort_order=%s,
                    updated_by=%s,
                    updated_at=now()
                where org_id=%s and id=%s
                returning *
                """,
                [
                    data["code"],
                    data["name"],
                    data["target_entity_id"],
                    data["number_field_id"],
                    data.get("description"),
                    data.get("is_active", True),
                    data["pattern"],
                    data.get("scope_type", "global"),
                    data.get("scope_field_id"),
                    data.get("reset_policy", "never"),
                    data.get("assign_on", "create"),
                    json.dumps(data.get("trigger_status_values") or []),
                    data.get("lock_after_assignment", True),
                    data.get("allow_admin_override", False),
                    data.get("notes"),
                    data.get("sort_order", 100),
                    actor.get("user_id") if isinstance(actor, dict) else None,
                    get_org_id(),
                    sequence_id,
                ],
                query_name="document_sequences.update",
            )
            return _deserialize_definition(row)
    except Exception as exc:
        if getattr(getattr(exc, "diag", None), "constraint_name", None):
            raise SequenceError("SEQUENCE_SAVE_FAILED", "Sequence save failed due to a database constraint.", path="sequence", detail={"constraint": exc.diag.constraint_name}) from exc
        raise


def delete_document_sequence(sequence_id: str) -> bool:
    try:
        with get_conn() as conn:
            execute(
                conn,
                "delete from document_sequence_definitions where org_id=%s and id=%s",
                [get_org_id(), sequence_id],
                query_name="document_sequences.delete",
            )
            return True
    except Exception as exc:
        if _is_undefined_table(exc):
            return False
        raise


def _workspace_code(context: dict | None) -> str:
    workspace_name = None
    if isinstance(context, dict):
        workspace_name = context.get("workspace_name")
        if not isinstance(workspace_name, str):
            workspace_name = context.get("workspace_id")
    return _display_code(workspace_name, "WORKSPACE")


def _model_code(definition: dict) -> str:
    target_entity_id = definition.get("target_entity_id")
    if isinstance(target_entity_id, str):
        return _display_code(target_entity_id.split(".")[-1], "MODEL")
    return "MODEL"


def _scope_value_for_definition(definition: dict, record: dict | None, context: dict | None, *, allow_placeholder: bool) -> tuple[str, str]:
    scope_type = definition.get("scope_type") or "global"
    if scope_type == "global":
        return "global", "GLOBAL"
    if scope_type == "workspace":
        workspace_name = None
        workspace_id = get_org_id()
        if isinstance(context, dict):
            workspace_id = context.get("workspace_id") or workspace_id
            workspace_name = context.get("workspace_name")
        display = _display_code(workspace_name or workspace_id, "WORKSPACE")
        scope_key = f"workspace:{_scope_key_value(workspace_name or workspace_id, 'workspace')}"
        return scope_key, display
    scope_field_id = definition.get("scope_field_id")
    scope_value = record.get(scope_field_id) if isinstance(record, dict) and isinstance(scope_field_id, str) else None
    if scope_value in (None, ""):
        if allow_placeholder:
            return "entity:preview", "ENTITY"
        raise SequenceError("SEQUENCE_SCOPE_REQUIRED", "Entity-scoped numbering requires a scope field value.", path=str(scope_field_id or "scope_field_id"))
    return f"entity:{_scope_key_value(scope_value, 'entity')}", _display_code(scope_value, "ENTITY")


def _counter_bucket(definition: dict, dt: datetime) -> tuple[int | None, int | None]:
    reset_policy = definition.get("reset_policy") or "never"
    if reset_policy == "yearly":
        return dt.year, None
    if reset_policy == "monthly":
        return dt.year, dt.month
    return None, None


def format_document_number(pattern: str, sequence_value: int, *, dt: datetime, entity_code: str, workspace_code: str, model_code: str) -> str:
    validate_pattern(pattern)

    def _replace(match: re.Match[str]) -> str:
        token = match.group(1)
        padding = match.group(2)
        if token == "YYYY":
            return f"{dt.year:04d}"
        if token == "YY":
            return f"{dt.year % 100:02d}"
        if token == "MM":
            return f"{dt.month:02d}"
        if token == "DD":
            return f"{dt.day:02d}"
        if token == "SEQ":
            if padding:
                return str(sequence_value).zfill(int(padding))
            return str(sequence_value)
        if token == "ENTITY":
            return entity_code
        if token == "WORKSPACE":
            return workspace_code
        if token == "MODEL":
            return model_code
        return match.group(0)

    return _TOKEN_RE.sub(_replace, pattern)


def preview_document_number(definition_like: dict, *, context: dict | None = None) -> dict:
    merged = _normalize_definition_payload(definition_like, partial=False)
    sequence_id = definition_like.get("id") if isinstance(definition_like, dict) else None
    preview_record = context.get("record") if isinstance(context, dict) and isinstance(context.get("record"), dict) else {}
    dt = context.get("now") if isinstance(context, dict) and isinstance(context.get("now"), datetime) else datetime.now(timezone.utc)
    scope_key, entity_code = _scope_value_for_definition(merged, preview_record, context or {}, allow_placeholder=True)
    bucket_year, bucket_month = _counter_bucket(merged, dt)
    current_value = 0
    if isinstance(sequence_id, str) and sequence_id:
        try:
            with get_conn() as conn:
                row = fetch_one(
                    conn,
                    """
                    select current_value
                    from document_sequence_counters
                    where org_id=%s and sequence_definition_id=%s and scope_key=%s
                      and bucket_year is not distinct from %s
                      and bucket_month is not distinct from %s
                    """,
                    [get_org_id(), sequence_id, scope_key, bucket_year, bucket_month],
                    query_name="document_sequences.preview_counter",
                )
                current_value = int(row.get("current_value") or 0) if row else 0
        except Exception as exc:
            if not _is_undefined_table(exc):
                raise
    next_value = current_value + 1
    preview = format_document_number(
        merged["pattern"],
        next_value,
        dt=dt,
        entity_code=entity_code,
        workspace_code=_workspace_code(context or {}),
        model_code=_model_code(merged),
    )
    return {
        "preview": preview,
        "sequence_value": next_value,
        "scope_key": scope_key,
        "bucket_year": bucket_year,
        "bucket_month": bucket_month,
    }


def assign_document_number(definition: dict, record_id: str, record: dict, *, actor: dict | None = None, event_label: str | None = None) -> str:
    if not isinstance(definition, dict):
        raise SequenceError("SEQUENCE_NOT_FOUND", "Sequence definition not found.", status=404)
    if definition.get("is_active") is False:
        raise SequenceError("SEQUENCE_INACTIVE", "Sequence definition is inactive.", path="sequence_id")
    number_field_id = definition.get("number_field_id")
    if not isinstance(number_field_id, str) or not number_field_id:
        raise SequenceError("SEQUENCE_INVALID", "Number field is required.", path="number_field_id")
    existing_number = record.get(number_field_id) if isinstance(record, dict) else None
    if isinstance(existing_number, str) and existing_number.strip():
        return existing_number.strip()
    now_dt = datetime.now(timezone.utc)
    scope_key, entity_code = _scope_value_for_definition(
        definition,
        record if isinstance(record, dict) else {},
        {
            "workspace_id": actor.get("workspace_id") if isinstance(actor, dict) else get_org_id(),
            "workspace_name": next(
                (
                    item.get("workspace_name")
                    for item in (actor.get("workspaces") or [])
                    if isinstance(item, dict) and item.get("workspace_id") == (actor.get("workspace_id") if isinstance(actor, dict) else get_org_id())
                ),
                None,
            )
            if isinstance(actor, dict)
            else None,
        },
        allow_placeholder=False,
    )
    bucket_year, bucket_month = _counter_bucket(definition, now_dt)
    sequence_id = definition.get("id")
    if not isinstance(sequence_id, str) or not sequence_id:
        raise SequenceError("SEQUENCE_INVALID", "Sequence id is required.", path="id")

    try:
        with get_conn() as conn:
            existing_log = fetch_one(
                conn,
                """
                select assigned_number
                from document_sequence_assignment_logs
                where org_id=%s and sequence_definition_id=%s and target_record_id=%s
                """,
                [get_org_id(), sequence_id, record_id],
                query_name="document_sequences.assignment_existing",
            )
            if existing_log and isinstance(existing_log.get("assigned_number"), str):
                return existing_log["assigned_number"]

            counter = fetch_one(
                conn,
                """
                select id, current_value
                from document_sequence_counters
                where org_id=%s and sequence_definition_id=%s and scope_key=%s
                  and bucket_year is not distinct from %s
                  and bucket_month is not distinct from %s
                for update
                """,
                [get_org_id(), sequence_id, scope_key, bucket_year, bucket_month],
                query_name="document_sequences.counter_lock",
            )
            if counter:
                next_value = int(counter.get("current_value") or 0) + 1
                execute(
                    conn,
                    """
                    update document_sequence_counters
                    set current_value=%s, updated_at=%s
                    where id=%s
                    """,
                    [next_value, _now(), counter.get("id")],
                    query_name="document_sequences.counter_update",
                )
            else:
                next_value = 1
                execute(
                    conn,
                    """
                    insert into document_sequence_counters (
                      id, org_id, sequence_definition_id, scope_key, bucket_year, bucket_month, current_value, created_at, updated_at
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    [str(uuid.uuid4()), get_org_id(), sequence_id, scope_key, bucket_year, bucket_month, next_value, _now(), _now()],
                    query_name="document_sequences.counter_insert",
                )

            assigned_number = format_document_number(
                definition["pattern"],
                next_value,
                dt=now_dt,
                entity_code=entity_code,
                workspace_code=_workspace_code(
                    {
                        "workspace_id": actor.get("workspace_id") if isinstance(actor, dict) else get_org_id(),
                        "workspace_name": next(
                            (
                                item.get("workspace_name")
                                for item in (actor.get("workspaces") or [])
                                if isinstance(item, dict) and item.get("workspace_id") == (actor.get("workspace_id") if isinstance(actor, dict) else get_org_id())
                            ),
                            None,
                        )
                        if isinstance(actor, dict)
                        else None,
                    }
                ),
                model_code=_model_code(definition),
            )

            try:
                execute(
                    conn,
                    """
                    insert into document_sequence_assignment_logs (
                      id, org_id, sequence_definition_id, target_entity_id, target_record_id, number_field_id,
                      assigned_number, assigned_on_event, scope_key, bucket_year, bucket_month, counter_value,
                      assigned_by, created_at
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    [
                        str(uuid.uuid4()),
                        get_org_id(),
                        sequence_id,
                        definition.get("target_entity_id"),
                        record_id,
                        number_field_id,
                        assigned_number,
                        event_label or definition.get("assign_on") or "create",
                        scope_key,
                        bucket_year,
                        bucket_month,
                        next_value,
                        actor.get("user_id") if isinstance(actor, dict) else None,
                        _now(),
                    ],
                    query_name="document_sequences.assignment_insert",
                )
            except Exception as exc:
                constraint = getattr(getattr(exc, "diag", None), "constraint_name", None)
                if constraint == "document_sequence_assignment_logs_org_record_idx":
                    existing_log = fetch_one(
                        conn,
                        """
                        select assigned_number
                        from document_sequence_assignment_logs
                        where org_id=%s and sequence_definition_id=%s and target_record_id=%s
                        """,
                        [get_org_id(), sequence_id, record_id],
                        query_name="document_sequences.assignment_existing_retry",
                    )
                    if existing_log and isinstance(existing_log.get("assigned_number"), str):
                        return existing_log["assigned_number"]
                raise
            return assigned_number
    except SequenceError:
        raise
    except Exception as exc:
        if _is_undefined_table(exc):
            raise SequenceError("SEQUENCE_TABLES_MISSING", "Document numbering tables are not installed yet.", path="sequence", status=500) from exc
        raise
