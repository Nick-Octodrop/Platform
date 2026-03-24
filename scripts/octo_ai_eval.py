#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
import time
import traceback
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _read_simple_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def _ensure_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def _plan_from_body(body: dict[str, Any]) -> dict[str, Any]:
    plan = body.get("plan")
    return plan if isinstance(plan, dict) else {}


def _candidate_op_names(plan: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for op in plan.get("candidate_operations") if isinstance(plan.get("candidate_operations"), list) else []:
        if isinstance(op, dict) and isinstance(op.get("op"), str):
            out.append(op.get("op"))
    return out


def _required_questions(plan: dict[str, Any]) -> list[str]:
    return [item for item in (plan.get("required_questions") or []) if isinstance(item, str) and item.strip()]


def _affected_module_ids(plan: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for artifact in plan.get("affected_artifacts") if isinstance(plan.get("affected_artifacts"), list) else []:
        if not isinstance(artifact, dict) or artifact.get("artifact_type") != "module":
            continue
        stable_id = artifact.get("artifact_key") if isinstance(artifact.get("artifact_key"), str) else None
        if not (isinstance(stable_id, str) and stable_id.strip()):
            stable_id = artifact.get("artifact_id") if isinstance(artifact.get("artifact_id"), str) else None
        if isinstance(stable_id, str) and stable_id.strip():
            out.append(stable_id.strip())
    return out


def _first_validation_manifest(body: dict[str, Any]) -> dict[str, Any]:
    validation = body.get("validation") if isinstance(body.get("validation"), dict) else {}
    results = validation.get("results") if isinstance(validation.get("results"), list) else []
    first = results[0] if results and isinstance(results[0], dict) else {}
    manifest = first.get("manifest") if isinstance(first.get("manifest"), dict) else {}
    return manifest


def _plan_manifests(plan: dict[str, Any]) -> list[dict[str, Any]]:
    manifests: list[dict[str, Any]] = []
    for op in plan.get("candidate_operations") if isinstance(plan.get("candidate_operations"), list) else []:
        if not isinstance(op, dict):
            continue
        manifest = op.get("manifest") if isinstance(op.get("manifest"), dict) else None
        if isinstance(manifest, dict):
            manifests.append(manifest)
    return manifests


def _manifest_field_labels(manifest: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    for entity in manifest.get("entities") if isinstance(manifest.get("entities"), list) else []:
        if not isinstance(entity, dict):
            continue
        for field in entity.get("fields") if isinstance(entity.get("fields"), list) else []:
            label = field.get("label") if isinstance(field, dict) and isinstance(field.get("label"), str) else None
            if isinstance(label, str) and label:
                labels.append(label)
    return labels


def _manifest_action_labels(manifest: dict[str, Any]) -> list[str]:
    return [
        action.get("label")
        for action in (manifest.get("actions") if isinstance(manifest.get("actions"), list) else [])
        if isinstance(action, dict) and isinstance(action.get("label"), str) and action.get("label")
    ]


def _manifest_workflow_state_labels(manifest: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    for workflow in manifest.get("workflows") if isinstance(manifest.get("workflows"), list) else []:
        if not isinstance(workflow, dict):
            continue
        for state in workflow.get("states") if isinstance(workflow.get("states"), list) else []:
            label = state.get("label") if isinstance(state, dict) and isinstance(state.get("label"), str) else None
            if isinstance(label, str) and label:
                labels.append(label)
    return labels


def _manifest_transition_labels(manifest: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    for workflow in manifest.get("workflows") if isinstance(manifest.get("workflows"), list) else []:
        if not isinstance(workflow, dict):
            continue
        for transition in workflow.get("transitions") if isinstance(workflow.get("transitions"), list) else []:
            label = transition.get("label") if isinstance(transition, dict) and isinstance(transition.get("label"), str) else None
            if isinstance(label, str) and label:
                labels.append(label)
    return labels


def _manifest_view_kinds(manifest: dict[str, Any]) -> list[str]:
    return [
        view.get("kind")
        for view in (manifest.get("views") if isinstance(manifest.get("views"), list) else [])
        if isinstance(view, dict) and isinstance(view.get("kind"), str) and view.get("kind")
    ]


def _manifest_page_titles(manifest: dict[str, Any]) -> list[str]:
    return [
        page.get("title")
        for page in (manifest.get("pages") if isinstance(manifest.get("pages"), list) else [])
        if isinstance(page, dict) and isinstance(page.get("title"), str) and page.get("title")
    ]


def _manifest_interface_names(manifest: dict[str, Any]) -> list[str]:
    interfaces = manifest.get("interfaces") if isinstance(manifest.get("interfaces"), dict) else {}
    return [key for key, value in interfaces.items() if isinstance(key, str) and isinstance(value, list) and value]


def _manifest_actions_by_id(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for action in (manifest.get("actions") if isinstance(manifest.get("actions"), list) else []):
        if not isinstance(action, dict):
            continue
        action_id = action.get("id")
        if isinstance(action_id, str) and action_id:
            out[action_id] = action
    return out


def _manifest_form_views(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        view
        for view in (manifest.get("views") if isinstance(manifest.get("views"), list) else [])
        if isinstance(view, dict) and view.get("kind") == "form"
    ]


def _manifest_secondary_action_labels(manifest: dict[str, Any]) -> list[str]:
    actions_by_id = _manifest_actions_by_id(manifest)
    labels: list[str] = []
    for view in _manifest_form_views(manifest):
        header = view.get("header") if isinstance(view.get("header"), dict) else {}
        secondary_actions = header.get("secondary_actions") if isinstance(header.get("secondary_actions"), list) else []
        for item in secondary_actions:
            if not isinstance(item, dict):
                continue
            action_id = item.get("action_id") if isinstance(item.get("action_id"), str) else None
            action = actions_by_id.get(action_id or "")
            label = action.get("label") if isinstance(action, dict) and isinstance(action.get("label"), str) else None
            if isinstance(label, str) and label:
                labels.append(label)
    return labels


def _manifest_has_statusbar(manifest: dict[str, Any]) -> bool:
    for view in _manifest_form_views(manifest):
        header = view.get("header") if isinstance(view.get("header"), dict) else {}
        statusbar = header.get("statusbar") if isinstance(header.get("statusbar"), dict) else {}
        field_id = statusbar.get("field_id") if isinstance(statusbar.get("field_id"), str) else None
        if isinstance(field_id, str) and field_id:
            return True
    return False


def _manifest_condition_count(manifest: dict[str, Any]) -> int:
    count = 0
    for entity in (manifest.get("entities") if isinstance(manifest.get("entities"), list) else []):
        if not isinstance(entity, dict):
            continue
        for field in (entity.get("fields") if isinstance(entity.get("fields"), list) else []):
            if not isinstance(field, dict):
                continue
            for key in ("required_when", "visible_when", "enabled_when"):
                if isinstance(field.get(key), dict):
                    count += 1
    for action in (manifest.get("actions") if isinstance(manifest.get("actions"), list) else []):
        if not isinstance(action, dict):
            continue
        for key in ("visible_when", "enabled_when"):
            if isinstance(action.get(key), dict):
                count += 1
    return count


def _manifest_trigger_count(manifest: dict[str, Any]) -> int:
    return len([item for item in (manifest.get("triggers") if isinstance(manifest.get("triggers"), list) else []) if isinstance(item, dict)])


def _manifest_transformation_count(manifest: dict[str, Any]) -> int:
    return len([item for item in (manifest.get("transformations") if isinstance(manifest.get("transformations"), list) else []) if isinstance(item, dict)])


def _manifest_relation_count(manifest: dict[str, Any]) -> int:
    return len([item for item in (manifest.get("relations") if isinstance(manifest.get("relations"), list) else []) if isinstance(item, dict)])


def _manifest_dependency_count(manifest: dict[str, Any]) -> int:
    depends_on = manifest.get("depends_on") if isinstance(manifest.get("depends_on"), dict) else {}
    required = depends_on.get("required") if isinstance(depends_on.get("required"), list) else []
    optional = depends_on.get("optional") if isinstance(depends_on.get("optional"), list) else []
    return len([item for item in required if isinstance(item, dict)]) + len([item for item in optional if isinstance(item, dict)])


def _manifest_useful_field_count(manifest: dict[str, Any]) -> int:
    count = 0
    for entity in (manifest.get("entities") if isinstance(manifest.get("entities"), list) else []):
        if not isinstance(entity, dict):
            continue
        for field in (entity.get("fields") if isinstance(entity.get("fields"), list) else []):
            field_id = field.get("id") if isinstance(field, dict) else None
            if not isinstance(field_id, str):
                continue
            if field_id.endswith(".id") or field_id.endswith(".created_at"):
                continue
            count += 1
    return count


def _normalized_haystack(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip()).lower()


def _assert_preview_expectations(preview_text: str, expect: dict[str, Any], manifest: dict[str, Any] | None = None) -> None:
    haystack = _normalized_haystack(preview_text)
    if not haystack:
        raise EvalFailure("preview expectations were provided but no assistant preview text was available")

    field_labels = _manifest_field_labels(manifest or {})
    action_labels = _manifest_action_labels(manifest or {})
    state_labels = _manifest_workflow_state_labels(manifest or {})
    view_kinds = _manifest_view_kinds(manifest or {})
    interface_names = _manifest_interface_names(manifest or {})

    for needle in _ensure_list(expect.get("text_contains")):
        if isinstance(needle, str) and _normalized_haystack(needle) not in haystack:
            raise EvalFailure(f"preview missing expected text {needle!r}")
    for needle in _ensure_list(expect.get("text_not_contains")):
        if isinstance(needle, str) and _normalized_haystack(needle) in haystack:
            raise EvalFailure(f"preview unexpectedly contained {needle!r}")

    for label in _ensure_list(expect.get("field_labels_include")):
        if isinstance(label, str) and _normalized_haystack(label) not in haystack:
            raise EvalFailure(f"preview missing field label {label!r}")
        if manifest is not None and isinstance(label, str) and label not in field_labels:
            raise EvalFailure(f"preview expected field label {label!r}, but manifest did not contain it")
    for label in _ensure_list(expect.get("action_labels_include")):
        if isinstance(label, str) and _normalized_haystack(label) not in haystack:
            raise EvalFailure(f"preview missing action label {label!r}")
        if manifest is not None and isinstance(label, str) and label not in action_labels:
            raise EvalFailure(f"preview expected action label {label!r}, but manifest did not contain it")
    for label in _ensure_list(expect.get("workflow_state_labels_include")):
        if isinstance(label, str) and _normalized_haystack(label) not in haystack:
            raise EvalFailure(f"preview missing workflow state label {label!r}")
        if manifest is not None and isinstance(label, str) and label not in state_labels:
            raise EvalFailure(f"preview expected workflow state label {label!r}, but manifest did not contain it")
    for kind in _ensure_list(expect.get("view_kinds_include")):
        if isinstance(kind, str) and _normalized_haystack(kind) not in haystack:
            raise EvalFailure(f"preview missing view kind {kind!r}")
        if manifest is not None and isinstance(kind, str) and kind not in view_kinds:
            raise EvalFailure(f"preview expected view kind {kind!r}, but manifest did not contain it")
    for interface_name in _ensure_list(expect.get("interfaces_include")):
        if isinstance(interface_name, str) and _normalized_haystack(interface_name) not in haystack:
            raise EvalFailure(f"preview missing interface name {interface_name!r}")
        if manifest is not None and isinstance(interface_name, str) and interface_name not in interface_names:
            raise EvalFailure(f"preview expected interface {interface_name!r}, but manifest did not contain it")


def _assert_manifest_expectations(manifest: dict[str, Any], expect: dict[str, Any]) -> None:
    if not manifest:
        raise EvalFailure("manifest expectations were provided but no manifest was available in the response")

    field_labels = _manifest_field_labels(manifest)
    action_labels = _manifest_action_labels(manifest)
    secondary_action_labels = _manifest_secondary_action_labels(manifest)
    state_labels = _manifest_workflow_state_labels(manifest)
    transition_labels = _manifest_transition_labels(manifest)
    view_kinds = _manifest_view_kinds(manifest)
    page_titles = _manifest_page_titles(manifest)
    interface_names = _manifest_interface_names(manifest)
    entity_count = len([item for item in (manifest.get("entities") or []) if isinstance(item, dict)])
    useful_field_count = _manifest_useful_field_count(manifest)
    condition_count = _manifest_condition_count(manifest)
    has_statusbar = _manifest_has_statusbar(manifest)
    trigger_count = _manifest_trigger_count(manifest)
    transformation_count = _manifest_transformation_count(manifest)
    relation_count = _manifest_relation_count(manifest)
    dependency_count = _manifest_dependency_count(manifest)

    if "min_entity_count" in expect and entity_count < int(expect.get("min_entity_count") or 0):
        raise EvalFailure(f"manifest entity count {entity_count} below minimum {expect.get('min_entity_count')}")
    if "min_useful_field_count" in expect and useful_field_count < int(expect.get("min_useful_field_count") or 0):
        raise EvalFailure(f"manifest useful field count {useful_field_count} below minimum {expect.get('min_useful_field_count')}")
    if "min_action_count" in expect and len(action_labels) < int(expect.get("min_action_count") or 0):
        raise EvalFailure(f"manifest action count {len(action_labels)} below minimum {expect.get('min_action_count')}")
    if "min_workflow_state_count" in expect and len(state_labels) < int(expect.get("min_workflow_state_count") or 0):
        raise EvalFailure(f"manifest workflow state count {len(state_labels)} below minimum {expect.get('min_workflow_state_count')}")
    if "min_condition_count" in expect and condition_count < int(expect.get("min_condition_count") or 0):
        raise EvalFailure(f"manifest condition count {condition_count} below minimum {expect.get('min_condition_count')}")
    if "min_trigger_count" in expect and trigger_count < int(expect.get("min_trigger_count") or 0):
        raise EvalFailure(f"manifest trigger count {trigger_count} below minimum {expect.get('min_trigger_count')}")
    if "min_transformation_count" in expect and transformation_count < int(expect.get("min_transformation_count") or 0):
        raise EvalFailure(f"manifest transformation count {transformation_count} below minimum {expect.get('min_transformation_count')}")
    if "min_relation_count" in expect and relation_count < int(expect.get("min_relation_count") or 0):
        raise EvalFailure(f"manifest relation count {relation_count} below minimum {expect.get('min_relation_count')}")
    if "min_dependency_count" in expect and dependency_count < int(expect.get("min_dependency_count") or 0):
        raise EvalFailure(f"manifest dependency count {dependency_count} below minimum {expect.get('min_dependency_count')}")
    if "statusbar_required" in expect and bool(expect.get("statusbar_required")) != has_statusbar:
        raise EvalFailure(f"expected statusbar_required={bool(expect.get('statusbar_required'))}, got {has_statusbar}")

    for needle in _ensure_list(expect.get("field_labels_include")):
        if isinstance(needle, str) and needle not in field_labels:
            raise EvalFailure(f"manifest missing field label {needle!r}; got {field_labels}")
    for needle in _ensure_list(expect.get("action_labels_include")):
        if isinstance(needle, str) and needle not in action_labels:
            raise EvalFailure(f"manifest missing action label {needle!r}; got {action_labels}")
    for needle in _ensure_list(expect.get("secondary_action_labels_include")):
        if isinstance(needle, str) and needle not in secondary_action_labels:
            raise EvalFailure(f"manifest missing secondary action label {needle!r}; got {secondary_action_labels}")
    for needle in _ensure_list(expect.get("workflow_state_labels_include")):
        if isinstance(needle, str) and needle not in state_labels:
            raise EvalFailure(f"manifest missing workflow state label {needle!r}; got {state_labels}")
    for needle in _ensure_list(expect.get("transition_labels_include")):
        if isinstance(needle, str) and needle not in transition_labels:
            raise EvalFailure(f"manifest missing workflow transition label {needle!r}; got {transition_labels}")
    for needle in _ensure_list(expect.get("view_kinds_include")):
        if isinstance(needle, str) and needle not in view_kinds:
            raise EvalFailure(f"manifest missing view kind {needle!r}; got {view_kinds}")
    for needle in _ensure_list(expect.get("page_titles_include")):
        if isinstance(needle, str) and needle not in page_titles:
            raise EvalFailure(f"manifest missing page title {needle!r}; got {page_titles}")
    for needle in _ensure_list(expect.get("interfaces_include")):
        if isinstance(needle, str) and needle not in interface_names:
            raise EvalFailure(f"manifest missing interface {needle!r}; got {interface_names}")


def _step_label(step: dict[str, Any]) -> str:
    if isinstance(step.get("answer_if_question"), dict):
        return "answer_if_question"
    if isinstance(step.get("chat"), str):
        return "chat"
    if "answer" in step:
        return "answer"
    if bool(step.get("generate_patchset")):
        return "generate_patchset"
    if bool(step.get("validate_patchset")):
        return "validate_patchset"
    if bool(step.get("apply_patchset")):
        return "apply_patchset"
    if bool(step.get("fetch_session")):
        return "fetch_session"
    return "unknown"


class EvalFailure(Exception):
    pass


def _response_errors(response: dict[str, Any]) -> list[dict[str, Any]]:
    body = response.get("body") if isinstance(response.get("body"), dict) else {}
    errors = body.get("errors")
    return [item for item in errors if isinstance(item, dict)] if isinstance(errors, list) else []


def _is_session_not_found_response(response: dict[str, Any]) -> bool:
    status_code = int(response.get("status_code") or 0)
    if status_code != 404:
        return False
    return any(error.get("code") == "AI_SESSION_NOT_FOUND" for error in _response_errors(response))


class BaseClient:
    def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        raise NotImplementedError

    def close(self) -> None:
        return None


class InProcessClient(BaseClient):
    def __init__(self) -> None:
        os.environ.setdefault("USE_DB", "0")
        os.environ.setdefault("OCTO_DISABLE_AUTH", "1")
        os.environ.setdefault("SUPABASE_URL", "http://localhost")
        from fastapi.testclient import TestClient
        import app.main as main

        # In local eval mode, bypass auth noise and exercise planner/apply behavior as an admin actor.
        def _eval_actor(_request: Any) -> dict[str, Any]:
            return {
                "user_id": "eval-user",
                "email": "eval@example.com",
                "role": "admin",
                "workspace_role": "admin",
                "platform_role": "superadmin",
                "workspace_id": "default",
                "workspaces": [{"workspace_id": "default", "role": "admin", "workspace_name": "Default"}],
                "claims": {},
            }

        main._resolve_actor = _eval_actor
        main._octo_ai_seed_in_memory_baseline_modules()
        self._client = TestClient(main.app)

    def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        response = self._client.request(method.upper(), path, json=body)
        try:
            payload = response.json()
        except Exception:
            payload = {"ok": False, "errors": [{"message": response.text}]}
        return {"status_code": response.status_code, "body": payload}

    def close(self) -> None:
        self._client.close()


class RemoteClient(BaseClient):
    def __init__(
        self,
        base_url: str,
        auth_token: str | None = None,
        workspace_id: str | None = None,
        refresh_token: str | None = None,
        supabase_url: str | None = None,
        supabase_anon_key: str | None = None,
        email: str | None = None,
        password: str | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.auth_token = auth_token.strip() if isinstance(auth_token, str) and auth_token.strip() else None
        self.workspace_id = workspace_id.strip() if isinstance(workspace_id, str) and workspace_id.strip() else None
        self.refresh_token = refresh_token.strip() if isinstance(refresh_token, str) and refresh_token.strip() else None
        self.supabase_url = supabase_url.rstrip("/") if isinstance(supabase_url, str) and supabase_url.strip() else None
        self.supabase_anon_key = supabase_anon_key.strip() if isinstance(supabase_anon_key, str) and supabase_anon_key.strip() else None
        self.email = email.strip() if isinstance(email, str) and email.strip() else None
        self.password = password if isinstance(password, str) and password else None
        if not self.auth_token and self.email and self.password:
            self._sign_in_with_password()

    def _do_request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        if self.workspace_id:
            headers["X-Workspace-Id"] = self.workspace_id
        data = json.dumps(body or {}).encode("utf-8")
        req = urllib.request.Request(f"{self.base_url}{path}", data=data, headers=headers, method=method.upper())
        transient_errors = (urllib.error.URLError, ConnectionResetError, TimeoutError, OSError)
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                with urllib.request.urlopen(req, timeout=60) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                    return {"status_code": response.status, "body": payload}
            except urllib.error.HTTPError as exc:
                raw = exc.read().decode("utf-8")
                try:
                    payload = json.loads(raw)
                except Exception:
                    payload = {"ok": False, "errors": [{"message": raw}]}
                return {"status_code": exc.code, "body": payload}
            except transient_errors as exc:
                last_error = exc
                message = str(exc).lower()
                transient = "10054" in message or "connection reset" in message or "forcibly closed" in message or isinstance(exc, TimeoutError)
                if not transient or attempt >= 1:
                    raise
                time.sleep(0.25)
        if last_error is not None:
            raise last_error
        raise RuntimeError("request failed without a response")

    def _looks_like_expired_auth(self, response: dict[str, Any]) -> bool:
        body = response.get("body") if isinstance(response.get("body"), dict) else {}
        errors = body.get("errors") if isinstance(body.get("errors"), list) else []
        first = errors[0] if errors and isinstance(errors[0], dict) else {}
        code = first.get("code")
        detail = first.get("detail") if isinstance(first.get("detail"), dict) else {}
        message = str(first.get("message") or "")
        detail_error = str(detail.get("error") or "")
        haystack = f"{message} {detail_error}".lower()
        return code == "AUTH_INVALID_TOKEN" and "expired" in haystack

    def _refresh_access_token(self) -> bool:
        if not (self.refresh_token and self.supabase_url and self.supabase_anon_key):
            return False
        headers = {
            "Content-Type": "application/json",
            "apikey": self.supabase_anon_key,
            "Authorization": f"Bearer {self.supabase_anon_key}",
        }
        data = json.dumps({"refresh_token": self.refresh_token}).encode("utf-8")
        req = urllib.request.Request(
            f"{self.supabase_url}/auth/v1/token?grant_type=refresh_token",
            data=data,
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception:
            return False
        access_token = payload.get("access_token")
        refresh_token = payload.get("refresh_token")
        if isinstance(access_token, str) and access_token.strip():
            self.auth_token = access_token.strip()
        else:
            return False
        if isinstance(refresh_token, str) and refresh_token.strip():
            self.refresh_token = refresh_token.strip()
        return True

    def _sign_in_with_password(self) -> bool:
        if not (self.email and self.password and self.supabase_url and self.supabase_anon_key):
            return False
        headers = {
            "Content-Type": "application/json",
            "apikey": self.supabase_anon_key,
            "Authorization": f"Bearer {self.supabase_anon_key}",
        }
        data = json.dumps({"email": self.email, "password": self.password}).encode("utf-8")
        req = urllib.request.Request(
            f"{self.supabase_url}/auth/v1/token?grant_type=password",
            data=data,
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception:
            return False
        access_token = payload.get("access_token")
        refresh_token = payload.get("refresh_token")
        if not isinstance(access_token, str) or not access_token.strip():
            return False
        self.auth_token = access_token.strip()
        if isinstance(refresh_token, str) and refresh_token.strip():
            self.refresh_token = refresh_token.strip()
        return True

    def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        response = self._do_request(method, path, body)
        if self._looks_like_expired_auth(response):
            if self._refresh_access_token() or self._sign_in_with_password():
                return self._do_request(method, path, body)
        return response


def _assert_step(step: dict[str, Any], response: dict[str, Any], state: dict[str, Any]) -> None:
    expect = step.get("expect") if isinstance(step.get("expect"), dict) else {}
    body = response.get("body") if isinstance(response.get("body"), dict) else {}
    status_code = int(response.get("status_code") or 0)
    actual_ok = 200 <= status_code < 300 and bool(body.get("ok"))
    expected_ok = expect.get("ok", True)
    if actual_ok != expected_ok:
        raise EvalFailure(f"expected ok={expected_ok}, got ok={actual_ok} status={status_code}")

    assistant_text = body.get("assistant_text") if isinstance(body.get("assistant_text"), str) else ""
    latest_preview_text = state.get("latest_assistant_text") if isinstance(state.get("latest_assistant_text"), str) else assistant_text
    plan = _plan_from_body(body)
    validation_manifest = _first_validation_manifest(body)
    plan_manifests = _plan_manifests(plan)
    question_meta = plan.get("required_question_meta") if isinstance(plan.get("required_question_meta"), dict) else {}
    candidate_ops = _candidate_op_names(plan)
    affected_modules = _affected_module_ids(plan)
    questions = _required_questions(plan)

    for needle in _ensure_list(expect.get("assistant_text_contains")):
        if isinstance(needle, str) and needle not in assistant_text:
            raise EvalFailure(f"assistant_text missing expected text: {needle!r}")
    for needle in _ensure_list(expect.get("assistant_text_not_contains")):
        if isinstance(needle, str) and needle in assistant_text:
            raise EvalFailure(f"assistant_text unexpectedly contained text: {needle!r}")
    for op_name in _ensure_list(expect.get("candidate_ops_include")):
        if isinstance(op_name, str) and op_name not in candidate_ops:
            raise EvalFailure(f"candidate_operations missing op {op_name!r}; got {candidate_ops}")
    for op_name in _ensure_list(expect.get("candidate_ops_exclude")):
        if isinstance(op_name, str) and op_name in candidate_ops:
            raise EvalFailure(f"candidate_operations unexpectedly contained {op_name!r}")
    for module_id in _ensure_list(expect.get("affected_modules_include")):
        if isinstance(module_id, str) and module_id not in affected_modules:
            raise EvalFailure(f"affected modules missing {module_id!r}; got {affected_modules}")
    if "question_required" in expect:
        want_question = bool(expect.get("question_required"))
        has_question = bool(questions)
        if want_question != has_question:
            raise EvalFailure(f"expected question_required={want_question}, got {has_question}")
    for needle in _ensure_list(expect.get("required_question_contains")):
        if isinstance(needle, str) and not any(needle in question for question in questions):
            raise EvalFailure(f"required_questions missing text {needle!r}; got {questions}")
    if isinstance(expect.get("question_id"), str):
        actual_question_id = question_meta.get("id")
        if actual_question_id != expect.get("question_id"):
            raise EvalFailure(f"expected question_id={expect.get('question_id')!r}, got {actual_question_id!r}")
    if "validation_ok" in expect:
        validation = body.get("validation") if isinstance(body.get("validation"), dict) else {}
        actual_validation_ok = bool(validation.get("ok"))
        if actual_validation_ok != bool(expect.get("validation_ok")):
            raise EvalFailure(f"expected validation_ok={expect.get('validation_ok')}, got {actual_validation_ok}")
    if isinstance(expect.get("patchset_status"), str):
        patchset = body.get("patchset") if isinstance(body.get("patchset"), dict) else {}
        actual_status = patchset.get("status")
        if actual_status != expect.get("patchset_status"):
            raise EvalFailure(f"expected patchset_status={expect.get('patchset_status')!r}, got {actual_status!r}")
    if isinstance(expect.get("session_status"), str):
        session = state.get("session_snapshot") if isinstance(state.get("session_snapshot"), dict) else {}
        actual_status = session.get("status")
        if actual_status != expect.get("session_status"):
            raise EvalFailure(f"expected session_status={expect.get('session_status')!r}, got {actual_status!r}")
    manifest_expect = expect.get("manifest_expect") if isinstance(expect.get("manifest_expect"), dict) else None
    manifest = validation_manifest or (plan_manifests[0] if plan_manifests else {})
    if manifest_expect:
        _assert_manifest_expectations(manifest, manifest_expect)
    preview_expect = expect.get("preview_expect") if isinstance(expect.get("preview_expect"), dict) else None
    if preview_expect:
        _assert_preview_expectations(latest_preview_text, preview_expect, manifest=manifest if manifest else None)


def _run_step(client: BaseClient, session_id: str, state: dict[str, Any], step: dict[str, Any]) -> dict[str, Any]:
    if isinstance(step.get("answer_if_question"), dict):
        answer_if = step.get("answer_if_question") or {}
        active_plan = state.get("latest_plan") if isinstance(state.get("latest_plan"), dict) else {}
        active_meta = active_plan.get("required_question_meta") if isinstance(active_plan.get("required_question_meta"), dict) else {}
        active_question_id = active_meta.get("id") if isinstance(active_meta.get("id"), str) else None
        expected_question_id = answer_if.get("question_id") if isinstance(answer_if.get("question_id"), str) else None
        if not expected_question_id or active_question_id != expected_question_id:
            return {
                "status_code": 200,
                "body": {
                    "ok": True,
                    "skipped": True,
                    "reason": "question_not_active",
                    "active_question_id": active_question_id,
                    "expected_question_id": expected_question_id,
                    "plan": active_plan,
                },
            }
        payload = {}
        if isinstance(answer_if.get("action"), str) and answer_if.get("action").strip():
            payload["action"] = answer_if.get("action").strip()
        else:
            payload["action"] = "custom"
        if isinstance(answer_if.get("text"), str):
            payload["text"] = answer_if.get("text")
        if isinstance(answer_if.get("hints"), dict):
            payload["hints"] = answer_if.get("hints")
        response = client.request("POST", f"/octo-ai/sessions/{session_id}/questions/answer", payload)
    elif isinstance(step.get("chat"), str):
        response = client.request("POST", f"/octo-ai/sessions/{session_id}/chat", {"message": step.get("chat")})
    elif "answer" in step:
        answer = step.get("answer")
        if isinstance(answer, str):
            payload = {"action": "custom", "text": answer}
        elif isinstance(answer, dict):
            payload = dict(answer)
        else:
            raise EvalFailure("answer step must be a string or object")
        response = client.request("POST", f"/octo-ai/sessions/{session_id}/questions/answer", payload)
    elif bool(step.get("generate_patchset")):
        payload = step.get("payload") if isinstance(step.get("payload"), dict) else {}
        if not payload and isinstance(state.get("latest_actionable_plan"), dict):
            ops = state["latest_actionable_plan"].get("candidate_operations")
            if isinstance(ops, list) and ops:
                payload = {"operations": ops}
        response = client.request("POST", f"/octo-ai/sessions/{session_id}/patchsets/generate", payload)
    elif bool(step.get("validate_patchset")):
        patchset_id = state.get("patchset_id")
        if not isinstance(patchset_id, str) or not patchset_id:
            raise EvalFailure("validate_patchset step requires a patchset_id from a previous step")
        response = client.request("POST", f"/octo-ai/patchsets/{patchset_id}/validate", {})
    elif bool(step.get("apply_patchset")):
        patchset_id = state.get("patchset_id")
        if not isinstance(patchset_id, str) or not patchset_id:
            raise EvalFailure("apply_patchset step requires a patchset_id from a previous step")
        payload = step.get("payload") if isinstance(step.get("payload"), dict) else {"approved": True}
        response = client.request("POST", f"/octo-ai/patchsets/{patchset_id}/apply", payload)
    elif bool(step.get("fetch_session")):
        response = client.request("GET", f"/octo-ai/sessions/{session_id}", {})
    else:
        raise EvalFailure(f"Unsupported step: {step}")

    body = response.get("body") if isinstance(response.get("body"), dict) else {}
    plan = body.get("plan") if isinstance(body.get("plan"), dict) else None
    if isinstance(plan, dict):
        state["latest_plan"] = plan
        if _candidate_op_names(plan):
            state["latest_actionable_plan"] = plan
    if isinstance(body.get("patchset"), dict) and isinstance(body["patchset"].get("id"), str):
        state["patchset_id"] = body["patchset"]["id"]
    if isinstance(body.get("session"), dict):
        state["session_snapshot"] = body.get("session")
    assistant_text = body.get("assistant_text") if isinstance(body.get("assistant_text"), str) else None
    if isinstance(assistant_text, str) and assistant_text.strip():
        state["latest_assistant_text"] = assistant_text
    return response


def _create_session_for_scenario(client: BaseClient, name: str, session_payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], str]:
    session_create = client.request("POST", "/octo-ai/sessions", session_payload)
    create_body = session_create.get("body") if isinstance(session_create.get("body"), dict) else {}
    if not (200 <= int(session_create.get("status_code") or 0) < 300 and create_body.get("ok")):
        raise EvalFailure(f"failed to create session for scenario {name}: {create_body}")
    session = create_body.get("session") if isinstance(create_body.get("session"), dict) else {}
    session_id = session.get("id")
    if not isinstance(session_id, str) or not session_id:
        raise EvalFailure(f"scenario {name} did not return a session id")
    return session_create, session, session_id


def _replay_session(
    client: BaseClient,
    name: str,
    session_payload: dict[str, Any],
    prior_steps: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any], str]:
    _session_create, session, session_id = _create_session_for_scenario(client, name, session_payload)
    state: dict[str, Any] = {"session_id": session_id, "session_snapshot": session}
    for step in prior_steps:
        response = _run_step(client, session_id, state, step)
        _assert_step(step, response, state)
    return state, session, session_id


def _run_scenario(client: BaseClient, scenario: dict[str, Any], output_dir: Path, fail_fast: bool) -> dict[str, Any]:
    name = str(scenario.get("name") or "unnamed_scenario")
    session_payload = scenario.get("session") if isinstance(scenario.get("session"), dict) else {}
    session_create, session, session_id = _create_session_for_scenario(client, name, session_payload)

    state: dict[str, Any] = {"session_id": session_id, "session_snapshot": session}
    steps_out: list[dict[str, Any]] = []
    session_recoveries: list[dict[str, Any]] = []
    used_session_recovery = False
    failed = False
    error_text = None
    failure_stage = None
    started_at = time.time()

    try:
        for idx, step in enumerate(scenario.get("steps") if isinstance(scenario.get("steps"), list) else [], start=1):
            step_started = time.time()
            response = None
            try:
                response = _run_step(client, session_id, state, step)
                if bool(step.get("fetch_session")):
                    body = response.get("body") if isinstance(response.get("body"), dict) else {}
                    if isinstance(body.get("session"), dict):
                        state["session_snapshot"] = body.get("session")
                _assert_step(step, response, state)
                step_record = {
                    "index": idx,
                    "step": _step_label(step),
                    "input": step,
                    "response": response,
                    "status": "passed",
                    "duration_ms": round((time.time() - step_started) * 1000, 2),
                }
            except Exception as exc:
                if response and _is_session_not_found_response(response) and not used_session_recovery:
                    try:
                        replay_steps = [record["input"] for record in steps_out if record.get("status") == "passed"]
                        prior_session_id = session_id
                        state, _session, session_id = _replay_session(client, name, session_payload, replay_steps)
                        used_session_recovery = True
                        session_recoveries.append(
                            {
                                "step_index": idx,
                                "step": _step_label(step),
                                "from_session_id": prior_session_id,
                                "to_session_id": session_id,
                            }
                        )
                        response = _run_step(client, session_id, state, step)
                        if bool(step.get("fetch_session")):
                            body = response.get("body") if isinstance(response.get("body"), dict) else {}
                            if isinstance(body.get("session"), dict):
                                state["session_snapshot"] = body.get("session")
                        _assert_step(step, response, state)
                        step_record = {
                            "index": idx,
                            "step": _step_label(step),
                            "input": step,
                            "response": response,
                            "status": "passed",
                            "duration_ms": round((time.time() - step_started) * 1000, 2),
                        }
                        steps_out.append(step_record)
                        continue
                    except Exception:
                        pass
                failed = True
                error_text = str(exc)
                failure_stage = failure_stage or _step_label(step)
                step_record = {
                    "index": idx,
                    "step": _step_label(step),
                    "input": step,
                    "response": response,
                    "status": "failed",
                    "duration_ms": round((time.time() - step_started) * 1000, 2),
                    "error": str(exc),
                    "traceback": traceback.format_exc(),
                }
                steps_out.append(step_record)
                if fail_fast:
                    break
                continue
            steps_out.append(step_record)
    finally:
        final_session = client.request("GET", f"/octo-ai/sessions/{session_id}", {})
        cleanup_requested = scenario.get("cleanup_session", True)
        cleanup_response = None
        if cleanup_requested:
            cleanup_response = client.request("DELETE", f"/octo-ai/sessions/{session_id}", {})
        scenario_report = {
            "name": name,
            "status": "failed" if failed else "passed",
            "passed": not failed,
            "failure_stage": failure_stage,
            "failure_reason": error_text,
            "session_id": session_id,
            "patchset_id": state.get("patchset_id"),
            "duration_ms": round((time.time() - started_at) * 1000, 2),
            "error": error_text,
            "session_create": session_create,
            "session_recoveries": session_recoveries,
            "final_session": final_session,
            "cleanup_response": cleanup_response,
            "steps": steps_out,
        }
        _write_json(output_dir / f"{name}.json", scenario_report)
    return scenario_report


def run_suite(
    client: BaseClient,
    suite: list[dict[str, Any]],
    output_dir: Path,
    repeat: int = 1,
    delay_seconds: float = 0.0,
    fail_fast: bool = False,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    iterations: list[dict[str, Any]] = []
    started = time.time()
    total_failures = 0
    for iteration in range(1, repeat + 1):
        run_dir = output_dir / f"iteration_{iteration:03d}"
        run_dir.mkdir(parents=True, exist_ok=True)
        scenario_results: list[dict[str, Any]] = []
        for scenario in suite:
            result = _run_scenario(client, scenario, run_dir, fail_fast=fail_fast)
            scenario_results.append(result)
            if result.get("status") != "passed":
                total_failures += 1
                if fail_fast:
                    break
        iterations.append(
            {
                "iteration": iteration,
                "scenario_count": len(scenario_results),
                "failed": sum(1 for item in scenario_results if item.get("status") != "passed"),
                "passed": sum(1 for item in scenario_results if item.get("status") == "passed"),
                "scenarios": scenario_results,
            }
        )
        if fail_fast and total_failures:
            break
        if delay_seconds > 0 and iteration < repeat:
            time.sleep(delay_seconds)
    summary = {
        "started_at": _utc_stamp(),
        "repeat": repeat,
        "iterations": iterations,
        "scenario_total": sum(item.get("scenario_count", 0) for item in iterations),
        "scenario_successes": sum(item.get("passed", 0) for item in iterations),
        "scenario_failures": total_failures,
        "duration_ms": round((time.time() - started) * 1000, 2),
    }
    _write_json(output_dir / "summary.json", summary)
    return summary


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Replay Octo AI scenarios and capture regression reports.")
    parser.add_argument("--scenario-file", required=True, help="Path to a JSON scenario suite.")
    parser.add_argument("--output-dir", default="", help="Directory for JSON reports. Defaults under storage/octo_ai_eval.")
    parser.add_argument("--base-url", default="", help="Run against a live API base URL instead of in-process app.")
    parser.add_argument("--auth-token", default=os.environ.get("OCTO_AI_EVAL_TOKEN", ""), help="Bearer token for --base-url mode.")
    parser.add_argument("--refresh-token", default=os.environ.get("OCTO_AI_EVAL_REFRESH_TOKEN", ""), help="Supabase refresh token for auto-renewing expired bearer tokens.")
    parser.add_argument("--email", default=os.environ.get("OCTO_AI_EVAL_EMAIL", ""), help="Supabase login email for password-grant auth.")
    parser.add_argument("--password", default=os.environ.get("OCTO_AI_EVAL_PASSWORD", ""), help="Supabase login password for password-grant auth.")
    parser.add_argument("--supabase-url", default=os.environ.get("OCTO_AI_EVAL_SUPABASE_URL", ""), help="Supabase project URL for refresh-token mode.")
    parser.add_argument("--supabase-anon-key", default=os.environ.get("OCTO_AI_EVAL_SUPABASE_ANON_KEY", ""), help="Supabase anon key for refresh-token mode.")
    parser.add_argument("--workspace-id", default=os.environ.get("OCTO_AI_EVAL_WORKSPACE_ID", ""), help="Optional X-Workspace-Id for --base-url mode.")
    parser.add_argument("--repeat", type=int, default=1, help="Repeat the full suite this many times.")
    parser.add_argument("--delay-seconds", type=float, default=0.0, help="Delay between iterations.")
    parser.add_argument("--fail-fast", action="store_true", help="Stop after the first failed scenario.")
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    scenario_path = Path(args.scenario_file).resolve()
    suite = _read_json(scenario_path)
    if not isinstance(suite, list) or not suite:
        print("Scenario file must contain a non-empty JSON array.", file=sys.stderr)
        return 2

    output_dir = Path(args.output_dir).resolve() if args.output_dir else (ROOT / "storage" / "octo_ai_eval" / _utc_stamp())
    client: BaseClient
    if args.base_url:
        web_env = _read_simple_env(ROOT / "web" / ".env")
        supabase_url = args.supabase_url or web_env.get("VITE_SUPABASE_URL") or ""
        supabase_anon_key = args.supabase_anon_key or web_env.get("VITE_SUPABASE_ANON_KEY") or ""
        client = RemoteClient(
            args.base_url,
            auth_token=args.auth_token,
            workspace_id=args.workspace_id,
            refresh_token=args.refresh_token,
            supabase_url=supabase_url,
            supabase_anon_key=supabase_anon_key,
            email=args.email,
            password=args.password,
        )
    else:
        client = InProcessClient()
    try:
        summary = run_suite(
            client,
            suite,
            output_dir=output_dir,
            repeat=max(int(args.repeat), 1),
            delay_seconds=max(float(args.delay_seconds), 0.0),
            fail_fast=bool(args.fail_fast),
        )
    finally:
        client.close()

    print(f"Wrote Octo AI eval report to {output_dir}")
    print(json.dumps({"scenario_failures": summary.get("scenario_failures"), "repeat": summary.get("repeat")}, indent=2))
    return 1 if summary.get("scenario_failures") else 0


if __name__ == "__main__":
    raise SystemExit(main())
