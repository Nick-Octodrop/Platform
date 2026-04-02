from __future__ import annotations

import json
import time
import uuid
from typing import Any

from app.db import execute, fetch_all, fetch_one, get_conn

_POLICY_CACHE_TTL_S = 15.0
_POLICY_CACHE: dict[str, dict[str, Any]] = {}

_RESOURCE_TYPES = {"module", "entity", "field", "action"}
_ACCESS_LEVELS_BY_RESOURCE = {
    "module": {"visible", "hidden"},
    "entity": {"none", "read", "write"},
    "field": {"hidden", "read", "write"},
    "action": {"hidden", "run"},
}


def _cache_key(workspace_id: str, user_id: str) -> str:
    return f"{workspace_id}:{user_id}"


def invalidate_access_policy_cache(workspace_id: str | None = None, user_id: str | None = None) -> None:
    if isinstance(workspace_id, str) and workspace_id and isinstance(user_id, str) and user_id:
        _POLICY_CACHE.pop(_cache_key(workspace_id, user_id), None)
        return
    if isinstance(workspace_id, str) and workspace_id:
        prefix = f"{workspace_id}:"
        for key in list(_POLICY_CACHE.keys()):
            if key.startswith(prefix):
                _POLICY_CACHE.pop(key, None)
        return
    _POLICY_CACHE.clear()


def normalize_policy_rule(resource_type: Any, access_level: Any) -> tuple[str | None, str | None]:
    normalized_type = str(resource_type or "").strip().lower()
    if normalized_type not in _RESOURCE_TYPES:
        return None, None
    normalized_access = str(access_level or "").strip().lower()
    if normalized_access not in _ACCESS_LEVELS_BY_RESOURCE.get(normalized_type, set()):
        return normalized_type, None
    return normalized_type, normalized_access


def list_workspace_access_profiles(workspace_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = fetch_all(
            conn,
            """
            select
              p.id,
              p.org_id,
              p.profile_key,
              p.name,
              p.description,
              p.created_at,
              p.updated_at,
              coalesce(rule_counts.rule_count, 0)::int as rule_count,
              coalesce(assign_counts.assignment_count, 0)::int as assignment_count
            from workspace_access_profiles p
            left join (
              select profile_id, count(*) as rule_count
              from workspace_access_policy_rules
              where org_id=%s
              group by profile_id
            ) rule_counts on rule_counts.profile_id = p.id
            left join (
              select profile_id, count(*) as assignment_count
              from workspace_access_profile_assignments
              where org_id=%s
              group by profile_id
            ) assign_counts on assign_counts.profile_id = p.id
            where p.org_id=%s
            order by lower(p.name) asc, p.created_at asc
            """,
            [workspace_id, workspace_id, workspace_id],
            query_name="workspace_access_profiles.list",
        )
        return rows or []


def get_workspace_access_profile(workspace_id: str, profile_id: str) -> dict | None:
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            select id, org_id, profile_key, name, description, created_at, updated_at
            from workspace_access_profiles
            where org_id=%s and id=%s
            """,
            [workspace_id, profile_id],
            query_name="workspace_access_profiles.get",
        )
        return row


def create_workspace_access_profile(workspace_id: str, name: str, description: str | None = None, profile_key: str | None = None) -> dict:
    profile_id = str(uuid.uuid4())
    clean_name = (name or "").strip()
    clean_description = (description or "").strip() or None
    clean_key = (profile_key or "").strip().lower() or None
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            insert into workspace_access_profiles (id, org_id, profile_key, name, description, created_at, updated_at)
            values (%s, %s, %s, %s, %s, now(), now())
            returning id, org_id, profile_key, name, description, created_at, updated_at
            """,
            [profile_id, workspace_id, clean_key, clean_name, clean_description],
            query_name="workspace_access_profiles.insert",
        )
        invalidate_access_policy_cache(workspace_id)
        return row or {
            "id": profile_id,
            "org_id": workspace_id,
            "profile_key": clean_key,
            "name": clean_name,
            "description": clean_description,
        }


def update_workspace_access_profile(workspace_id: str, profile_id: str, *, name: str | None = None, description: str | None = None, profile_key: str | None = None) -> dict | None:
    fields: list[str] = []
    params: list[Any] = []
    if name is not None:
        fields.append("name=%s")
        params.append((name or "").strip())
    if description is not None:
        fields.append("description=%s")
        params.append((description or "").strip() or None)
    if profile_key is not None:
        fields.append("profile_key=%s")
        params.append((profile_key or "").strip().lower() or None)
    if not fields:
        return get_workspace_access_profile(workspace_id, profile_id)
    fields.append("updated_at=now()")
    params.extend([workspace_id, profile_id])
    with get_conn() as conn:
        row = fetch_one(
            conn,
            f"""
            update workspace_access_profiles
            set {", ".join(fields)}
            where org_id=%s and id=%s
            returning id, org_id, profile_key, name, description, created_at, updated_at
            """,
            params,
            query_name="workspace_access_profiles.update",
        )
        if row:
            invalidate_access_policy_cache(workspace_id)
        return row


def delete_workspace_access_profile(workspace_id: str, profile_id: str) -> bool:
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            delete from workspace_access_profiles
            where org_id=%s and id=%s
            returning id
            """,
            [workspace_id, profile_id],
            query_name="workspace_access_profiles.delete",
        )
        if row:
            invalidate_access_policy_cache(workspace_id)
        return bool(row)


def list_workspace_access_rules(workspace_id: str, profile_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = fetch_all(
            conn,
            """
            select id, org_id, profile_id, resource_type, resource_id, access_level, priority, condition_json, created_at, updated_at
            from workspace_access_policy_rules
            where org_id=%s and profile_id=%s
            order by priority asc, created_at asc, id asc
            """,
            [workspace_id, profile_id],
            query_name="workspace_access_policy_rules.list",
        )
        out = rows or []
        for row in out:
            raw = row.get("condition_json")
            if isinstance(raw, str) and raw.strip():
                try:
                    row["condition_json"] = json.loads(raw)
                except Exception:
                    row["condition_json"] = None
        return out


def create_workspace_access_rule(
    workspace_id: str,
    profile_id: str,
    *,
    resource_type: str,
    resource_id: str,
    access_level: str,
    priority: int = 100,
    condition_json: dict | None = None,
) -> dict:
    rule_id = str(uuid.uuid4())
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            insert into workspace_access_policy_rules (
              id, org_id, profile_id, resource_type, resource_id, access_level, priority, condition_json, created_at, updated_at
            )
            values (%s, %s, %s, %s, %s, %s, %s, %s, now(), now())
            returning id, org_id, profile_id, resource_type, resource_id, access_level, priority, condition_json, created_at, updated_at
            """,
            [rule_id, workspace_id, profile_id, resource_type, resource_id, access_level, int(priority or 100), json.dumps(condition_json) if isinstance(condition_json, dict) else None],
            query_name="workspace_access_policy_rules.insert",
        )
        invalidate_access_policy_cache(workspace_id)
        return row or {
            "id": rule_id,
            "org_id": workspace_id,
            "profile_id": profile_id,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "access_level": access_level,
            "priority": int(priority or 100),
            "condition_json": condition_json if isinstance(condition_json, dict) else None,
        }


def update_workspace_access_rule(
    workspace_id: str,
    profile_id: str,
    rule_id: str,
    *,
    resource_type: str | None = None,
    resource_id: str | None = None,
    access_level: str | None = None,
    priority: int | None = None,
    condition_json: dict | None = None,
) -> dict | None:
    fields: list[str] = []
    params: list[Any] = []
    if resource_type is not None:
        fields.append("resource_type=%s")
        params.append(resource_type)
    if resource_id is not None:
        fields.append("resource_id=%s")
        params.append(resource_id)
    if access_level is not None:
        fields.append("access_level=%s")
        params.append(access_level)
    if priority is not None:
        fields.append("priority=%s")
        params.append(int(priority))
    if condition_json is not None:
        fields.append("condition_json=%s")
        params.append(json.dumps(condition_json))
    if not fields:
        rows = list_workspace_access_rules(workspace_id, profile_id)
        for row in rows:
            if row.get("id") == rule_id:
                return row
        return None
    fields.append("updated_at=now()")
    params.extend([workspace_id, profile_id, rule_id])
    with get_conn() as conn:
        row = fetch_one(
            conn,
            f"""
            update workspace_access_policy_rules
            set {", ".join(fields)}
            where org_id=%s and profile_id=%s and id=%s
            returning id, org_id, profile_id, resource_type, resource_id, access_level, priority, condition_json, created_at, updated_at
            """,
            params,
            query_name="workspace_access_policy_rules.update",
        )
        if row:
            raw = row.get("condition_json")
            if isinstance(raw, str) and raw.strip():
                try:
                    row["condition_json"] = json.loads(raw)
                except Exception:
                    row["condition_json"] = None
            invalidate_access_policy_cache(workspace_id)
        return row


def delete_workspace_access_rule(workspace_id: str, profile_id: str, rule_id: str) -> bool:
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            delete from workspace_access_policy_rules
            where org_id=%s and profile_id=%s and id=%s
            returning id
            """,
            [workspace_id, profile_id, rule_id],
            query_name="workspace_access_policy_rules.delete",
        )
        if row:
            invalidate_access_policy_cache(workspace_id)
        return bool(row)


def list_workspace_user_access_profiles(workspace_id: str, user_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = fetch_all(
            conn,
            """
            select
              p.id,
              p.org_id,
              p.profile_key,
              p.name,
              p.description,
              p.created_at,
              p.updated_at
            from workspace_access_profile_assignments a
            join workspace_access_profiles p on p.id = a.profile_id and p.org_id = a.org_id
            where a.org_id=%s and a.user_id=%s
            order by lower(p.name) asc, p.created_at asc
            """,
            [workspace_id, user_id],
            query_name="workspace_access_profile_assignments.list_by_user",
        )
        return rows or []


def list_workspace_access_assignments(workspace_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = fetch_all(
            conn,
            """
            select
              a.user_id,
              p.id as profile_id,
              p.profile_key,
              p.name,
              p.description
            from workspace_access_profile_assignments a
            join workspace_access_profiles p on p.id = a.profile_id and p.org_id = a.org_id
            where a.org_id=%s
            order by a.user_id asc, lower(p.name) asc
            """,
            [workspace_id],
            query_name="workspace_access_profile_assignments.list_by_workspace",
        )
        return rows or []


def replace_workspace_user_access_profiles(workspace_id: str, user_id: str, profile_ids: list[str]) -> list[dict]:
    clean_ids = sorted({str(item).strip() for item in (profile_ids or []) if isinstance(item, str) and str(item).strip()})
    with get_conn() as conn:
        valid_rows = fetch_all(
            conn,
            """
            select id
            from workspace_access_profiles
            where org_id=%s and id = any(%s)
            """,
            [workspace_id, clean_ids or [""]],
            query_name="workspace_access_profiles.validate_for_assignment",
        ) if clean_ids else []
        valid_ids = {row.get("id") for row in (valid_rows or []) if isinstance(row.get("id"), str)}
        if clean_ids and valid_ids != set(clean_ids):
            missing = sorted(set(clean_ids) - valid_ids)
            raise ValueError(f"Unknown access profiles: {', '.join(missing)}")
        if clean_ids:
            execute(
                conn,
                """
                delete from workspace_access_profile_assignments
                where org_id=%s and user_id=%s and profile_id <> all(%s)
                """,
                [workspace_id, user_id, clean_ids],
                query_name="workspace_access_profile_assignments.delete_missing",
            )
        else:
            execute(
                conn,
                """
                delete from workspace_access_profile_assignments
                where org_id=%s and user_id=%s
                """,
                [workspace_id, user_id],
                query_name="workspace_access_profile_assignments.delete_all",
            )
        if clean_ids:
            for profile_id in clean_ids:
                execute(
                    conn,
                    """
                    insert into workspace_access_profile_assignments (org_id, profile_id, user_id, created_at, updated_at)
                    values (%s, %s, %s, now(), now())
                    on conflict (org_id, profile_id, user_id)
                    do update set updated_at=excluded.updated_at
                    """,
                    [workspace_id, profile_id, user_id],
                    query_name="workspace_access_profile_assignments.upsert",
                )
        invalidate_access_policy_cache(workspace_id, user_id)
    return list_workspace_user_access_profiles(workspace_id, user_id)


def _combine_module_access(levels: list[str]) -> str | None:
    if "hidden" in levels:
        return "hidden"
    if "visible" in levels:
        return "visible"
    return None


def _combine_entity_access(levels: list[str]) -> str | None:
    if "none" in levels:
        return "none"
    if "read" in levels:
        return "read"
    if "write" in levels:
        return "write"
    return None


def _combine_field_access(levels: list[str]) -> str | None:
    if "hidden" in levels:
        return "hidden"
    if "read" in levels:
        return "read"
    if "write" in levels:
        return "write"
    return None


def _combine_action_access(levels: list[str]) -> str | None:
    if "hidden" in levels:
        return "hidden"
    if "run" in levels:
        return "run"
    return None


def compile_workspace_user_access_policy(workspace_id: str | None, user_id: str | None) -> dict:
    if not isinstance(workspace_id, str) or not workspace_id or not isinstance(user_id, str) or not user_id:
        return {
            "profile_ids": [],
            "profiles": [],
            "module_access": {},
            "entity_access": {},
            "entity_scope_rules": {},
            "field_access": {},
            "action_access": {},
        }
    key = _cache_key(workspace_id, user_id)
    now = time.time()
    cached = _POLICY_CACHE.get(key)
    if cached and now - float(cached.get("ts") or 0.0) < _POLICY_CACHE_TTL_S:
        return cached["value"]
    profiles = list_workspace_user_access_profiles(workspace_id, user_id)
    profile_ids = [row.get("id") for row in profiles if isinstance(row.get("id"), str)]
    module_levels: dict[str, list[str]] = {}
    entity_levels: dict[str, list[str]] = {}
    entity_scope_rules: dict[str, list[dict[str, Any]]] = {}
    field_levels: dict[str, list[str]] = {}
    action_levels: dict[str, list[str]] = {}
    if profile_ids:
        with get_conn() as conn:
            rules = fetch_all(
                conn,
                """
                select resource_type, resource_id, access_level, condition_json
                from workspace_access_policy_rules
                where org_id=%s and profile_id = any(%s)
                order by priority asc, created_at asc, id asc
                """,
                [workspace_id, profile_ids],
                query_name="workspace_access_policy_rules.list_for_user",
            ) or []
        for rule in rules:
            resource_type = rule.get("resource_type")
            resource_id = rule.get("resource_id")
            access_level = rule.get("access_level")
            if not isinstance(resource_type, str) or not isinstance(resource_id, str) or not isinstance(access_level, str):
                continue
            condition_json = rule.get("condition_json")
            bucket = None
            if resource_type == "module":
                bucket = module_levels
            elif resource_type == "entity":
                if isinstance(condition_json, str) and condition_json.strip():
                    try:
                        condition_json = json.loads(condition_json)
                    except Exception:
                        condition_json = None
                if isinstance(condition_json, dict):
                    entity_scope_rules.setdefault(resource_id, []).append({"access_level": access_level, "condition": condition_json})
                    continue
                bucket = entity_levels
            elif resource_type == "field":
                bucket = field_levels
            elif resource_type == "action":
                bucket = action_levels
            if bucket is None:
                continue
            bucket.setdefault(resource_id, []).append(access_level)
    compiled = {
        "profile_ids": profile_ids,
        "profiles": profiles,
        "module_access": {key: value for key, value in ((rid, _combine_module_access(levels)) for rid, levels in module_levels.items()) if value},
        "entity_access": {key: value for key, value in ((rid, _combine_entity_access(levels)) for rid, levels in entity_levels.items()) if value},
        "entity_scope_rules": entity_scope_rules,
        "field_access": {key: value for key, value in ((rid, _combine_field_access(levels)) for rid, levels in field_levels.items()) if value},
        "action_access": {key: value for key, value in ((rid, _combine_action_access(levels)) for rid, levels in action_levels.items()) if value},
    }
    _POLICY_CACHE[key] = {"value": compiled, "ts": now}
    return compiled
