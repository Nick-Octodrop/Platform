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


def invalidate_membership_cache(user_id: str | None = None) -> None:
    if user_id:
        _MEMBERSHIP_CACHE.pop(user_id, None)
        return
    _MEMBERSHIP_CACHE.clear()


def get_platform_role(user_id: str) -> str:
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            select platform_role
            from user_platform_roles
            where user_id=%s
            """,
            [user_id],
            query_name="user_platform_roles.get",
        )
        role = (row or {}).get("platform_role")
        if isinstance(role, str) and role:
            return role
    return "standard"


def set_platform_role(user_id: str, platform_role: str) -> dict:
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            insert into user_platform_roles (user_id, platform_role, created_at, updated_at)
            values (%s, %s, now(), now())
            on conflict (user_id)
            do update set platform_role=excluded.platform_role, updated_at=now()
            returning user_id, platform_role, created_at, updated_at
            """,
            [user_id, platform_role],
            query_name="user_platform_roles.upsert",
        )
        return row or {"user_id": user_id, "platform_role": platform_role}


def list_user_workspaces(user_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = fetch_all(
            conn,
            """
            select
              wm.workspace_id,
              wm.role,
              w.name as workspace_name,
              w.owner_user_id,
              wm.created_at as member_since
            from workspace_members wm
            join workspaces w on w.id = wm.workspace_id
            where wm.user_id=%s
            order by lower(w.name) asc
            """,
            [user_id],
            query_name="workspace_members.list_user_workspaces",
        )
        return rows or []


def list_all_workspaces() -> list[dict]:
    with get_conn() as conn:
        rows = fetch_all(
            conn,
            """
            select
              w.id as workspace_id,
              w.name as workspace_name,
              w.owner_user_id,
              w.created_at,
              (
                select count(*)
                from workspace_members wm
                where wm.workspace_id=w.id
              )::int as member_count
            from workspaces w
            order by lower(w.name) asc
            """,
            [],
            query_name="workspaces.list_all",
        )
        return rows or []


def workspace_exists(workspace_id: str) -> bool:
    with get_conn() as conn:
        row = fetch_one(
            conn,
            "select id from workspaces where id=%s",
            [workspace_id],
            query_name="workspaces.exists",
        )
        return bool(row)


def list_workspace_members(workspace_id: str) -> list[dict]:
    with get_conn() as conn:
        try:
            rows = fetch_all(
                conn,
                """
                select
                  wm.workspace_id,
                  wm.user_id,
                  wm.role,
                  u.email,
                  coalesce(
                    nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
                    nullif(trim(u.raw_user_meta_data->>'name'), '')
                  ) as name
                from workspace_members wm
                left join auth.users u on u.id::text = wm.user_id
                where wm.workspace_id=%s
                order by wm.created_at asc
                """,
                [workspace_id],
                query_name="workspace_members.list_by_workspace",
            )
            return rows or []
        except Exception:
            # Fallback for environments without auth.users access.
            rows = fetch_all(
                conn,
                """
                select workspace_id, user_id, role
                from workspace_members
                where workspace_id=%s
                order by created_at asc
                """,
                [workspace_id],
                query_name="workspace_members.list_by_workspace_fallback",
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
            [workspace_id, user_id, "admin"],
            query_name="workspace_members.insert_owner",
        )
        invalidate_membership_cache(user_id)
        return workspace_id


def add_workspace_member(workspace_id: str, user_id: str, role: str) -> dict:
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            insert into workspace_members (workspace_id, user_id, role, created_at)
            values (%s, %s, %s, now())
            on conflict (workspace_id, user_id)
            do update set role=excluded.role
            returning workspace_id, user_id, role, created_at
            """,
            [workspace_id, user_id, role],
            query_name="workspace_members.upsert",
        )
        invalidate_membership_cache(user_id)
        return row or {"workspace_id": workspace_id, "user_id": user_id, "role": role}


def update_workspace_member_role(workspace_id: str, user_id: str, role: str) -> dict | None:
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            update workspace_members
            set role=%s
            where workspace_id=%s and user_id=%s
            returning workspace_id, user_id, role, created_at
            """,
            [role, workspace_id, user_id],
            query_name="workspace_members.update_role",
        )
        if row:
            invalidate_membership_cache(user_id)
        return row


def remove_workspace_member(workspace_id: str, user_id: str) -> bool:
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            delete from workspace_members
            where workspace_id=%s and user_id=%s
            returning user_id
            """,
            [workspace_id, user_id],
            query_name="workspace_members.delete",
        )
        if row:
            invalidate_membership_cache(user_id)
        return bool(row)


def create_workspace_invite(workspace_id: str, email: str, role: str, invited_by_user_id: str | None = None) -> dict:
    normalized_email = email.strip().lower()
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            insert into workspace_invites (workspace_id, email, role, invited_by_user_id, status, created_at)
            values (%s, %s, %s, %s, 'pending', now())
            returning *
            """,
            [workspace_id, normalized_email, role, invited_by_user_id],
            query_name="workspace_invites.insert",
        )
        return row or {
            "workspace_id": workspace_id,
            "email": normalized_email,
            "role": role,
            "status": "pending",
        }


def claim_workspace_invites_for_email(user_id: str, email: str) -> list[dict]:
    normalized_email = email.strip().lower()
    with get_conn() as conn:
        invites = fetch_all(
            conn,
            """
            select id, workspace_id, role
            from workspace_invites
            where lower(email)=lower(%s) and status='pending'
            order by created_at asc
            """,
            [normalized_email],
            query_name="workspace_invites.list_pending_by_email",
        ) or []
        claimed = []
        for invite in invites:
            workspace_id = invite.get("workspace_id")
            role = invite.get("role") or "member"
            member_row = fetch_one(
                conn,
                """
                insert into workspace_members (workspace_id, user_id, role, created_at)
                values (%s, %s, %s, now())
                on conflict (workspace_id, user_id)
                do update set role=excluded.role
                returning workspace_id, user_id, role, created_at
                """,
                [workspace_id, user_id, role],
                query_name="workspace_members.upsert_from_invite",
            )
            execute(
                conn,
                """
                update workspace_invites
                set status='accepted', accepted_at=now()
                where id=%s
                """,
                [invite.get("id")],
                query_name="workspace_invites.mark_accepted",
            )
            if member_row:
                claimed.append(member_row)
        if claimed:
            invalidate_membership_cache(user_id)
        return claimed
