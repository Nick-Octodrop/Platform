from __future__ import annotations

from typing import Any

import os
import time

from app.db import execute, fetch_all, fetch_one, get_conn

_MEMBERSHIP_CACHE: dict[str, dict] = {}
_MEMBERSHIP_TTL_S = float(os.getenv("OCTO_MEMBERSHIP_CACHE_TTL", "30"))


def list_memberships(user_id: str) -> list[dict]:
    now = time.time()
    cached = _MEMBERSHIP_CACHE.get(user_id)
    if cached and now - cached["ts"] < _MEMBERSHIP_TTL_S:
        return cached["value"]
    with get_conn() as conn:
        rows = fetch_all(
            conn,
            """
            select workspace_id, role
            from workspace_members
            where user_id=%s
            """,
            [user_id],
            query_name="workspace_members.list_by_user",
        )
        value = rows or []
        _MEMBERSHIP_CACHE[user_id] = {"value": value, "ts": now}
        return value


def list_workspace_members(workspace_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = fetch_all(
            conn,
            """
            select workspace_id, user_id, role
            from workspace_members
            where workspace_id=%s
            order by created_at asc
            """,
            [workspace_id],
            query_name="workspace_members.list_by_workspace",
        )
        return rows or []


def get_membership(user_id: str, workspace_id: str) -> dict | None:
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            select workspace_id, role
            from workspace_members
            where user_id=%s and workspace_id=%s
            """,
            [user_id, workspace_id],
            query_name="workspace_members.get",
        )
        return row


def create_workspace_for_user(user: dict[str, Any], name: str | None = None) -> str:
    user_id = user.get("id")
    if not user_id:
        raise RuntimeError("user_id required")
    workspace_name = name or (user.get("email") and f"{user.get('email')}'s Workspace") or "Workspace"
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            insert into workspaces (name, owner_user_id)
            values (%s, %s)
            returning id
            """,
            [workspace_name, user_id],
            query_name="workspaces.insert",
        )
        workspace_id = row.get("id")
        execute(
            conn,
            """
            insert into workspace_members (workspace_id, user_id, role)
            values (%s, %s, %s)
            """,
            [workspace_id, user_id, "owner"],
            query_name="workspace_members.insert_owner",
        )
        return workspace_id
