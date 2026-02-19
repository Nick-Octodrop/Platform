"""Manifest validation for product layer (v0 contract)."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from app.manifest_normalize import normalize_manifest


Issue = Dict[str, Any]


ALLOWED_FIELD_TYPES = {"string", "text", "number", "bool", "date", "datetime", "enum", "uuid", "lookup", "tags", "attachments"}
ALLOWED_V1_TOP_KEYS = {
    "manifest_version",
    "module",
    "entities",
    "views",
    "relations",
    "workflows",
    "actions",
    "triggers",
    "queries",
    "interfaces",
    "app",
    "pages",
    "modals",
}
ALLOWED_V1_APP_KEYS = {"home", "nav", "defaults"}
ALLOWED_V1_NAV_GROUP_KEYS = {"group", "items"}
ALLOWED_V1_NAV_ITEM_KEYS = {"label", "to"}
ALLOWED_V1_PAGE_KEYS = {"id", "title", "layout", "header", "content", "breadcrumbs"}
ALLOWED_V1_PAGE_HEADER_KEYS = {"actions", "variant"}
ALLOWED_V1_PAGE_ACTION_KEYS = {"kind", "label", "target", "action_id", "enabled_when", "visible_when", "confirm", "modal_id"}
ALLOWED_V1_BLOCK_KEYS = {
    "kind",
    "target",
    "content",
    "items",
    "columns",
    "gap",
    "tabs",
    "style",
    "default_tab",
    "text",
    "entity_id",
    "record_ref",
    "variant",
    "title",
    "actions",
    "align",
    "field_id",
    "mode",
    "record_id_query",
    "modes",
    "default_mode",
    "default_group_by",
    "default_filter_id",
    "record_domain",
    "view",
    "create_defaults",
    "create_modal",
}
ALLOWED_V1_ACTION_KINDS = {"navigate", "open_form", "refresh", "create_record", "update_record", "bulk_update"}
ALLOWED_V1_TRIGGER_KEYS = {"id", "event", "entity_id", "action_id", "status_field"}
ALLOWED_V1_TRIGGER_EVENTS = {"record.created", "record.updated", "action.clicked", "workflow.status_changed"}
ALLOWED_V1_STACK_KEYS = {"kind", "gap", "content"}
ALLOWED_V1_GRID_KEYS = {"kind", "columns", "gap", "items"}
ALLOWED_V1_GRID_ITEM_KEYS = {"span", "content"}
ALLOWED_V1_TABS_KEYS = {"kind", "style", "tabs", "default_tab"}
ALLOWED_V1_TAB_KEYS = {"id", "label", "content"}
ALLOWED_V1_TEXT_KEYS = {"kind", "text"}
ALLOWED_V1_CHATTER_KEYS = {"kind", "entity_id", "record_ref"}
ALLOWED_V1_CONTAINER_KEYS = {"kind", "variant", "title", "content"}
ALLOWED_V1_TOOLBAR_KEYS = {"kind", "align", "actions"}
ALLOWED_V1_STATUSBAR_KEYS = {"kind", "entity_id", "record_ref", "field_id", "mode"}
ALLOWED_V1_RECORD_KEYS = {"kind", "entity_id", "record_id_query", "content"}
ALLOWED_V1_VIEW_MODES_KEYS = {"kind", "entity_id", "modes", "default_mode", "default_group_by", "default_filter_id", "record_domain"}
ALLOWED_V1_RELATED_LIST_KEYS = {"kind", "entity_id", "target", "view", "record_domain", "create_defaults", "create_modal"}
ALLOWED_V1_VIEW_MODE_ITEM_KEYS = {"mode", "target", "default_group_by"}
MAX_BLOCK_DEPTH = 6
MAX_CONDITION_DEPTH = 6
ALLOWED_WORKFLOW_KEYS = {"id", "entity", "status_field", "states", "transitions", "required_fields_by_state"}
ALLOWED_WORKFLOW_STATE_KEYS = {"id", "label", "order", "required_fields"}
ALLOWED_WORKFLOW_TRANSITION_KEYS = {"from", "to", "label"}
ALLOWED_CONDITION_OPS = {"eq", "neq", "gt", "gte", "lt", "lte", "in", "contains", "exists", "and", "or", "not"}
ALLOWED_CONDITION_KEYS = {"op", "field", "value", "left", "right", "conditions", "condition"}
ALLOWED_V1_ACTION_KEYS = {"id", "kind", "label", "target", "entity_id", "defaults", "patch", "enabled_when", "visible_when", "confirm", "modal_id"}
ALLOWED_V1_VIEW_HEADER_KEYS = {"title_field", "primary_actions", "secondary_actions", "search", "filters", "bulk_actions", "save_mode", "open_record_target", "auto_save", "auto_save_debounce_ms", "statusbar", "tabs"}
ALLOWED_V1_VIEW_HEADER_ACTION_KEYS = {"action_id", "kind", "label", "target", "enabled_when", "visible_when", "confirm", "modal_id"}
ALLOWED_V1_MODAL_KEYS = {"id", "title", "description", "entity_id", "fields", "defaults", "actions"}
ALLOWED_V1_MODAL_ACTION_KEYS = {
    "action_id",
    "kind",
    "label",
    "target",
    "entity_id",
    "defaults",
    "patch",
    "enabled_when",
    "visible_when",
    "confirm",
    "close_on_success",
    "variant",
}
ALLOWED_V1_VIEW_HEADER_SEARCH_KEYS = {"enabled", "placeholder", "fields"}
ALLOWED_V1_VIEW_HEADER_FILTER_KEYS = {"id", "label", "domain"}
ALLOWED_V1_VIEW_ACTIVITY_KEYS = {"enabled", "mode", "tab_label", "allow_comments", "allow_attachments", "show_changes", "tracked_fields"}
ALLOWED_V1_VIEW_CARD_KEYS = {"title_field", "subtitle_fields", "badge_fields"}
ALLOWED_V1_VIEW_GRAPH_KEYS = {"default"}
ALLOWED_V1_GRAPH_DEFAULT_KEYS = {"type", "group_by", "measure"}


def _issue(code: str, message: str, path: str | None = None, detail: dict | None = None) -> Issue:
    return {"code": code, "message": message, "path": path, "detail": detail}


def _get(obj: dict, key: str, default=None):
    return obj.get(key, default) if isinstance(obj, dict) else default


def _field_ids(entity: dict) -> set[str]:
    fields = _get(entity, "fields", [])
    return {f.get("id") for f in fields if isinstance(f, dict) and isinstance(f.get("id"), str)}


def _reject_unknown_keys(errors: list[Issue], obj: dict, allowed: set[str], path: str) -> None:
    if not isinstance(obj, dict):
        return
    for key in obj.keys():
        if key not in allowed:
            errors.append(_issue("MANIFEST_UNKNOWN_KEY", f"Unknown key: {key}", f"{path}.{key}"))


def _parse_target(target: str) -> tuple[str, str] | None:
    if not isinstance(target, str):
        return None
    if target.startswith("page:"):
        return ("page", target[5:])
    if target.startswith("view:"):
        return ("view", target[5:])
    return None


def _parse_view_target(target: str) -> str | None:
    if not isinstance(target, str):
        return None
    if target.startswith("page:"):
        return None
    if target.startswith("view:"):
        return target[5:]
    return target


def _validate_condition_operand(value: Any, path: str, errors: list[Issue]) -> None:
    if isinstance(value, dict):
        keys = set(value.keys())
        if keys != {"ref"}:
            errors.append(_issue("MANIFEST_CONDITION_OPERAND_INVALID", "operand must be a ref object", path))
            return
        if not isinstance(value.get("ref"), str):
            errors.append(_issue("MANIFEST_CONDITION_REF_INVALID", "ref must be a string", f"{path}.ref"))


def _validate_condition(condition: Any, path: str, errors: list[Issue], depth: int = 0) -> None:
    if depth > MAX_CONDITION_DEPTH:
        errors.append(_issue("MANIFEST_CONDITION_DEPTH", "condition is nested too deeply", path))
        return
    if not isinstance(condition, dict):
        errors.append(_issue("MANIFEST_CONDITION_INVALID", "condition must be an object", path))
        return
    _reject_unknown_keys(errors, condition, ALLOWED_CONDITION_KEYS, path)
    op = _get(condition, "op")
    if op not in ALLOWED_CONDITION_OPS:
        errors.append(_issue("MANIFEST_CONDITION_OP_INVALID", "condition.op must be allowlisted", f"{path}.op"))
        return
    if op in {"and", "or"}:
        items = _get(condition, "conditions", [])
        if not isinstance(items, list) or len(items) == 0:
            errors.append(_issue("MANIFEST_CONDITION_LIST_INVALID", "conditions must be a non-empty list", f"{path}.conditions"))
            return
        for idx, item in enumerate(items):
            _validate_condition(item, f"{path}.conditions[{idx}]", errors, depth + 1)
        return
    if op == "not":
        inner = _get(condition, "condition")
        if inner is None:
            errors.append(_issue("MANIFEST_CONDITION_INVALID", "not requires condition", f"{path}.condition"))
            return
        _validate_condition(inner, f"{path}.condition", errors, depth + 1)
        return

    if "left" in condition or "right" in condition:
        if "left" not in condition or "right" not in condition:
            errors.append(_issue("MANIFEST_CONDITION_INVALID", "left and right are required together", path))
            return
        _validate_condition_operand(_get(condition, "left"), f"{path}.left", errors)
        _validate_condition_operand(_get(condition, "right"), f"{path}.right", errors)
        return

    field = _get(condition, "field")
    if not isinstance(field, str) or not field:
        errors.append(_issue("MANIFEST_CONDITION_FIELD_INVALID", "condition.field must be a string", f"{path}.field"))
    if op != "exists" and "value" not in condition:
        errors.append(_issue("MANIFEST_CONDITION_VALUE_INVALID", "condition.value is required", f"{path}.value"))


def _validate_view_header_actions(
    actions: Any,
    path: str,
    errors: list[Issue],
    action_by_id: dict,
    is_v12: bool,
    allow_inline: bool,
) -> None:
    if actions is None:
        return
    if not isinstance(actions, list):
        errors.append(_issue("MANIFEST_VIEW_HEADER_ACTIONS_INVALID", "actions must be a list", path))
        return
    for aidx, action in enumerate(actions):
        apath = f"{path}[{aidx}]"
        if not isinstance(action, dict):
            errors.append(_issue("MANIFEST_VIEW_HEADER_ACTION_INVALID", "action must be an object", apath))
            continue
        _reject_unknown_keys(errors, action, ALLOWED_V1_VIEW_HEADER_ACTION_KEYS, apath)
        action_id = _get(action, "action_id")
        kind = _get(action, "kind")
        if action_id:
            if not isinstance(action_id, str):
                errors.append(_issue("MANIFEST_VIEW_HEADER_ACTION_INVALID", "action_id must be string", f"{apath}.action_id"))
            elif action_id not in action_by_id:
                errors.append(_issue("MANIFEST_VIEW_HEADER_ACTION_UNKNOWN", "action_id not found", f"{apath}.action_id"))
        elif kind:
            if not allow_inline or kind not in {"navigate", "open_form", "refresh"}:
                errors.append(_issue("MANIFEST_VIEW_HEADER_ACTION_INVALID", "inline actions must be navigate/open_form/refresh", f"{apath}.kind"))
            if kind == "navigate":
                target = _get(action, "target")
                parsed = _parse_target(target) if isinstance(target, str) else None
                if not parsed:
                    errors.append(_issue("MANIFEST_TARGET_INVALID", "navigate target must be page:<id> or view:<id>", f"{apath}.target"))
            if kind == "open_form":
                target = _get(action, "target")
                if not isinstance(target, str) or target.startswith("page:") or target.startswith("view:"):
                    errors.append(_issue("MANIFEST_ACTION_INVALID", "open_form target must be a view id", f"{apath}.target"))
            if kind == "refresh" and _get(action, "target") is not None:
                errors.append(_issue("MANIFEST_ACTION_INVALID", "refresh must not include target", f"{apath}.target"))
        else:
            errors.append(_issue("MANIFEST_VIEW_HEADER_ACTION_INVALID", "action_id or kind required", apath))

        visible_when = _get(action, "visible_when")
        if visible_when is not None:
            if not is_v12:
                errors.append(_issue("MANIFEST_ACTION_CONDITION_INVALID", "visible_when requires manifest_version >= 1.2", f"{apath}.visible_when"))
            else:
                _validate_condition(visible_when, f"{apath}.visible_when", errors)
        enabled_when = _get(action, "enabled_when")
        if enabled_when is not None:
            if not is_v12:
                errors.append(_issue("MANIFEST_ACTION_CONDITION_INVALID", "enabled_when requires manifest_version >= 1.2", f"{apath}.enabled_when"))
            else:
                _validate_condition(enabled_when, f"{apath}.enabled_when", errors)
        confirm = _get(action, "confirm")
        if confirm is not None and not isinstance(confirm, dict):
            errors.append(_issue("MANIFEST_ACTION_CONFIRM_INVALID", "confirm must be object", f"{apath}.confirm"))


def _is_v11(manifest_version: str) -> bool:
    try:
        return float(manifest_version.split(".")[0] + "." + manifest_version.split(".")[1]) >= 1.1
    except Exception:
        return manifest_version.startswith("1.1")


def _is_v12(manifest_version: str) -> bool:
    try:
        return float(manifest_version.split(".")[0] + "." + manifest_version.split(".")[1]) >= 1.2
    except Exception:
        return manifest_version.startswith("1.2")


def _is_v13(manifest_version: str) -> bool:
    try:
        return float(manifest_version.split(".")[0] + "." + manifest_version.split(".")[1]) >= 1.3
    except Exception:
        return manifest_version.startswith("1.3")


def _validate_blocks(
    blocks: list,
    path: str,
    view_ids: set[str],
    entity_by_id: dict[str, dict],
    action_by_id: dict[str, dict],
    errors: list[Issue],
    allow_layout: bool,
    allow_chatter: bool,
    allow_v13: bool,
    record_entity: str | None,
    depth: int = 0,
) -> None:
    if depth > MAX_BLOCK_DEPTH:
        errors.append(_issue("MANIFEST_BLOCK_DEPTH", "content blocks are nested too deeply", path))
        return
    if not isinstance(blocks, list):
        errors.append(_issue("MANIFEST_PAGE_CONTENT_INVALID", "page.content must be a list", path))
        return
    for bidx, block in enumerate(blocks):
        bpath = f"{path}[{bidx}]"
        if not isinstance(block, dict):
            errors.append(_issue("MANIFEST_BLOCK_INVALID", "page block must be an object", bpath))
            continue
        _reject_unknown_keys(errors, block, ALLOWED_V1_BLOCK_KEYS, bpath)
        kind = _get(block, "kind")
        if kind == "view":
            target = _get(block, "target")
            target_id = _parse_view_target(target)
            if not target_id:
                errors.append(_issue("MANIFEST_TARGET_INVALID", "block target must be a view id or view:<id>", f"{bpath}.target"))
                continue
            if target_id not in view_ids:
                errors.append(_issue("MANIFEST_TARGET_UNKNOWN", "page block view not found", f"{bpath}.target"))
        elif kind == "stack":
            if not allow_layout:
                errors.append(_issue("MANIFEST_BLOCK_KIND_INVALID", "stack blocks require manifest_version >= 1.1", f"{bpath}.kind"))
                continue
            _reject_unknown_keys(errors, block, ALLOWED_V1_STACK_KEYS, bpath)
            content = _get(block, "content", [])
            _validate_blocks(content, f"{bpath}.content", view_ids, entity_by_id, action_by_id, errors, allow_layout, allow_chatter, allow_v13, record_entity, depth + 1)
        elif kind == "grid":
            if not allow_layout:
                errors.append(_issue("MANIFEST_BLOCK_KIND_INVALID", "grid blocks require manifest_version >= 1.1", f"{bpath}.kind"))
                continue
            _reject_unknown_keys(errors, block, ALLOWED_V1_GRID_KEYS, bpath)
            columns = _get(block, "columns")
            if columns != 12:
                errors.append(_issue("MANIFEST_GRID_COLUMNS_INVALID", "grid.columns must be 12", f"{bpath}.columns"))
            items = _get(block, "items", [])
            if not isinstance(items, list) or len(items) == 0:
                errors.append(_issue("MANIFEST_GRID_ITEMS_INVALID", "grid.items must be a non-empty list", f"{bpath}.items"))
                continue
            for iidx, item in enumerate(items):
                ipath = f"{bpath}.items[{iidx}]"
                if not isinstance(item, dict):
                    errors.append(_issue("MANIFEST_GRID_ITEM_INVALID", "grid item must be an object", ipath))
                    continue
                _reject_unknown_keys(errors, item, ALLOWED_V1_GRID_ITEM_KEYS, ipath)
                span = _get(item, "span")
                if not isinstance(span, int) or span < 1 or span > 12:
                    errors.append(_issue("MANIFEST_GRID_SPAN_INVALID", "grid item span must be 1..12", f"{ipath}.span"))
                content = _get(item, "content", [])
                _validate_blocks(content, f"{ipath}.content", view_ids, entity_by_id, action_by_id, errors, allow_layout, allow_chatter, allow_v13, record_entity, depth + 1)
        elif kind == "tabs":
            if not allow_layout:
                errors.append(_issue("MANIFEST_BLOCK_KIND_INVALID", "tabs blocks require manifest_version >= 1.1", f"{bpath}.kind"))
                continue
            _reject_unknown_keys(errors, block, ALLOWED_V1_TABS_KEYS, bpath)
            tabs = _get(block, "tabs", [])
            if not isinstance(tabs, list) or len(tabs) == 0:
                errors.append(_issue("MANIFEST_TABS_INVALID", "tabs must be a non-empty list", f"{bpath}.tabs"))
                continue
            tab_ids = []
            for tidx, tab in enumerate(tabs):
                tpath = f"{bpath}.tabs[{tidx}]"
                if not isinstance(tab, dict):
                    errors.append(_issue("MANIFEST_TAB_INVALID", "tab must be an object", tpath))
                    continue
                _reject_unknown_keys(errors, tab, ALLOWED_V1_TAB_KEYS, tpath)
                tid = _get(tab, "id")
                if not isinstance(tid, str) or not tid:
                    errors.append(_issue("MANIFEST_TAB_ID_INVALID", "tab.id is required", f"{tpath}.id"))
                else:
                    tab_ids.append(tid)
                content = _get(tab, "content", [])
                _validate_blocks(content, f"{tpath}.content", view_ids, entity_by_id, action_by_id, errors, allow_layout, allow_chatter, allow_v13, record_entity, depth + 1)
            if len(tab_ids) != len(set(tab_ids)):
                errors.append(_issue("MANIFEST_TAB_ID_DUPLICATE", "tab ids must be unique", f"{bpath}.tabs"))
            default_tab = _get(block, "default_tab")
            if default_tab and default_tab not in tab_ids:
                errors.append(_issue("MANIFEST_TAB_DEFAULT_INVALID", "default_tab must match a tab id", f"{bpath}.default_tab"))
        elif kind == "text":
            if not allow_layout:
                errors.append(_issue("MANIFEST_BLOCK_KIND_INVALID", "text blocks require manifest_version >= 1.1", f"{bpath}.kind"))
                continue
            _reject_unknown_keys(errors, block, ALLOWED_V1_TEXT_KEYS, bpath)
            text = _get(block, "text")
            if not isinstance(text, str):
                errors.append(_issue("MANIFEST_TEXT_INVALID", "text block requires string text", f"{bpath}.text"))
        elif kind == "container":
            if not allow_v13:
                errors.append(_issue("MANIFEST_BLOCK_KIND_INVALID", "container blocks require manifest_version >= 1.3", f"{bpath}.kind"))
                continue
            _reject_unknown_keys(errors, block, ALLOWED_V1_CONTAINER_KEYS, bpath)
            content = _get(block, "content", [])
            _validate_blocks(content, f"{bpath}.content", view_ids, entity_by_id, action_by_id, errors, allow_layout, allow_chatter, allow_v13, record_entity, depth + 1)
        elif kind == "toolbar":
            if not allow_v13:
                errors.append(_issue("MANIFEST_BLOCK_KIND_INVALID", "toolbar blocks require manifest_version >= 1.3", f"{bpath}.kind"))
                continue
            _reject_unknown_keys(errors, block, ALLOWED_V1_TOOLBAR_KEYS, bpath)
            actions = _get(block, "actions", [])
            if not isinstance(actions, list) or len(actions) == 0:
                errors.append(_issue("MANIFEST_TOOLBAR_ACTIONS_INVALID", "toolbar.actions must be a non-empty list", f"{bpath}.actions"))
            elif isinstance(actions, list):
                for aidx, action in enumerate(actions):
                    apath = f"{bpath}.actions[{aidx}]"
                    if not isinstance(action, dict):
                        errors.append(_issue("MANIFEST_TOOLBAR_ACTION_INVALID", "action must be object", apath))
                        continue
                    action_id = _get(action, "action_id")
                    if not isinstance(action_id, str) or action_id not in action_by_id:
                        errors.append(_issue("MANIFEST_TOOLBAR_ACTION_INVALID", "action_id not found", f"{apath}.action_id"))
        elif kind == "statusbar":
            if not allow_v13:
                errors.append(_issue("MANIFEST_BLOCK_KIND_INVALID", "statusbar blocks require manifest_version >= 1.3", f"{bpath}.kind"))
                continue
            _reject_unknown_keys(errors, block, ALLOWED_V1_STATUSBAR_KEYS, bpath)
            entity_id = _get(block, "entity_id") or record_entity
            record_ref = _get(block, "record_ref") or ("$record.id" if record_entity else None)
            field_id = _get(block, "field_id")
            if not isinstance(entity_id, str) or not entity_id:
                errors.append(_issue("MANIFEST_STATUSBAR_ENTITY_INVALID", "statusbar.entity_id is required", f"{bpath}.entity_id"))
            if not isinstance(record_ref, str) or not record_ref:
                errors.append(_issue("MANIFEST_STATUSBAR_RECORD_REF_INVALID", "statusbar.record_ref is required", f"{bpath}.record_ref"))
            if not isinstance(field_id, str) or not field_id:
                errors.append(_issue("MANIFEST_STATUSBAR_FIELD_INVALID", "statusbar.field_id is required", f"{bpath}.field_id"))
            elif isinstance(entity_id, str):
                entity_obj = entity_by_id.get(entity_id) or entity_by_id.get(f"entity.{entity_id}")
                if entity_obj:
                    field = next((f for f in _get(entity_obj, "fields", []) if isinstance(f, dict) and f.get("id") == field_id), None)
                    if not field:
                        errors.append(_issue("MANIFEST_STATUSBAR_FIELD_INVALID", "statusbar.field_id not found on entity", f"{bpath}.field_id"))
                    elif field.get("type") != "enum":
                        errors.append(_issue("MANIFEST_STATUSBAR_FIELD_INVALID", "statusbar.field_id must be enum field", f"{bpath}.field_id"))
        elif kind == "record":
            if not allow_v13:
                errors.append(_issue("MANIFEST_BLOCK_KIND_INVALID", "record blocks require manifest_version >= 1.3", f"{bpath}.kind"))
                continue
            _reject_unknown_keys(errors, block, ALLOWED_V1_RECORD_KEYS, bpath)
            entity_id = _get(block, "entity_id")
            record_id_query = _get(block, "record_id_query")
            if not isinstance(entity_id, str) or not entity_id:
                errors.append(_issue("MANIFEST_RECORD_ENTITY_INVALID", "record.entity_id is required", f"{bpath}.entity_id"))
            if not isinstance(record_id_query, str) or not record_id_query:
                errors.append(_issue("MANIFEST_RECORD_QUERY_INVALID", "record.record_id_query is required", f"{bpath}.record_id_query"))
            content = _get(block, "content", [])
            _validate_blocks(content, f"{bpath}.content", view_ids, entity_by_id, action_by_id, errors, allow_layout, allow_chatter, allow_v13, entity_id, depth + 1)
        elif kind == "view_modes":
            if not allow_v13:
                errors.append(_issue("MANIFEST_BLOCK_KIND_INVALID", "view_modes blocks require manifest_version >= 1.3", f"{bpath}.kind"))
                continue
            _reject_unknown_keys(errors, block, ALLOWED_V1_VIEW_MODES_KEYS, bpath)
            entity_id = _get(block, "entity_id")
            if not isinstance(entity_id, str) or not entity_id:
                errors.append(_issue("MANIFEST_VIEW_MODES_ENTITY_INVALID", "view_modes.entity_id is required", f"{bpath}.entity_id"))
            elif entity_id not in entity_by_id and f"entity.{entity_id}" not in entity_by_id:
                errors.append(_issue("MANIFEST_VIEW_MODES_ENTITY_UNKNOWN", "view_modes.entity_id not found", f"{bpath}.entity_id"))
            modes = _get(block, "modes", [])
            if not isinstance(modes, list) or len(modes) == 0:
                errors.append(_issue("MANIFEST_VIEW_MODES_INVALID", "view_modes.modes must be a non-empty list", f"{bpath}.modes"))
                continue
            allowed_modes = {"list", "kanban", "graph", "pivot", "calendar"}
            mode_ids = []
            for midx, mode in enumerate(modes):
                mpath = f"{bpath}.modes[{midx}]"
                if not isinstance(mode, dict):
                    errors.append(_issue("MANIFEST_VIEW_MODE_INVALID", "view mode must be object", mpath))
                    continue
                _reject_unknown_keys(errors, mode, ALLOWED_V1_VIEW_MODE_ITEM_KEYS, mpath)
                mode_id = _get(mode, "mode")
                target = _get(mode, "target")
                if not isinstance(mode_id, str) or mode_id not in allowed_modes:
                    errors.append(_issue("MANIFEST_VIEW_MODE_INVALID", "mode must be list|kanban|graph|pivot|calendar", f"{mpath}.mode"))
                else:
                    mode_ids.append(mode_id)
                target_id = _parse_view_target(target)
                if not target_id:
                    errors.append(_issue("MANIFEST_TARGET_INVALID", "view_modes target must be a view id or view:<id>", f"{mpath}.target"))
                elif target_id not in view_ids:
                    errors.append(_issue("MANIFEST_TARGET_UNKNOWN", "view_modes target view not found", f"{mpath}.target"))
            default_mode = _get(block, "default_mode")
            if default_mode and default_mode not in mode_ids:
                errors.append(_issue("MANIFEST_VIEW_MODES_INVALID", "default_mode must match modes[].mode", f"{bpath}.default_mode"))
            record_domain = _get(block, "record_domain")
            if record_domain is not None:
                _validate_condition(record_domain, f"{bpath}.record_domain", errors)
        elif kind == "related_list":
            if not allow_v13:
                errors.append(_issue("MANIFEST_BLOCK_KIND_INVALID", "related_list blocks require manifest_version >= 1.3", f"{bpath}.kind"))
                continue
            _reject_unknown_keys(errors, block, ALLOWED_V1_RELATED_LIST_KEYS, bpath)
            entity_id = _get(block, "entity_id")
            if not isinstance(entity_id, str) or not entity_id:
                errors.append(_issue("MANIFEST_RELATED_LIST_ENTITY_INVALID", "related_list.entity_id is required", f"{bpath}.entity_id"))
            elif entity_id not in entity_by_id and f"entity.{entity_id}" not in entity_by_id:
                errors.append(_issue("MANIFEST_RELATED_LIST_ENTITY_UNKNOWN", "related_list.entity_id not found", f"{bpath}.entity_id"))
            target_id = _parse_view_target(_get(block, "target") or _get(block, "view"))
            if not target_id:
                errors.append(_issue("MANIFEST_TARGET_INVALID", "related_list target must be a view id or view:<id>", f"{bpath}.target"))
            elif target_id not in view_ids:
                errors.append(_issue("MANIFEST_TARGET_UNKNOWN", "related_list target view not found", f"{bpath}.target"))
            record_domain = _get(block, "record_domain")
            if record_domain is not None:
                _validate_condition(record_domain, f"{bpath}.record_domain", errors)
        elif kind == "chatter":
            if not allow_chatter:
                errors.append(_issue("MANIFEST_BLOCK_KIND_INVALID", "chatter blocks require manifest_version >= 1.2", f"{bpath}.kind"))
                continue
            _reject_unknown_keys(errors, block, ALLOWED_V1_CHATTER_KEYS, bpath)
            entity_id = _get(block, "entity_id") or record_entity
            record_ref = _get(block, "record_ref") or ("$record.id" if record_entity else None)
            if not isinstance(entity_id, str) or not entity_id:
                errors.append(_issue("MANIFEST_CHATTER_ENTITY_INVALID", "chatter.entity_id is required", f"{bpath}.entity_id"))
            if not isinstance(record_ref, str) or not record_ref:
                errors.append(_issue("MANIFEST_CHATTER_RECORD_REF_INVALID", "chatter.record_ref is required", f"{bpath}.record_ref"))
        else:
            errors.append(_issue("MANIFEST_BLOCK_KIND_INVALID", "unsupported block kind", f"{bpath}.kind"))


def _default_type_valid(field_type: str, value) -> bool:
    if field_type in {"string", "text"}:
        return isinstance(value, str)
    if field_type == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if field_type in {"bool", "boolean"}:
        return isinstance(value, bool)
    if field_type == "date":
        return isinstance(value, str)
    if field_type == "enum":
        return isinstance(value, str) or isinstance(value, (int, float)) or isinstance(value, bool)
    return False


def _enum_options_object_shape(options: list) -> bool:
    if not isinstance(options, list) or len(options) == 0:
        return False
    for opt in options:
        if not isinstance(opt, dict):
            return False
        if "value" not in opt or "label" not in opt:
            return False
    return True


def validate_manifest(manifest: dict, expected_module_id: str | None = None) -> tuple[list[Issue], list[Issue]]:
    errors: list[Issue] = []
    warnings: list[Issue] = []

    if not isinstance(manifest, dict):
        errors.append(_issue("MANIFEST_INVALID", "manifest must be an object", None))
        return errors, warnings

    module = _get(manifest, "module")
    module_id = _get(module, "id")
    manifest_version = _get(manifest, "manifest_version") or "0.x"
    if not isinstance(manifest_version, str):
        errors.append(_issue("MANIFEST_VERSION_INVALID", "manifest_version must be a string", "manifest_version"))
        manifest_version = "0.x"
    is_v1 = manifest_version.startswith("1")
    is_v11 = _is_v11(manifest_version)
    is_v12 = _is_v12(manifest_version)
    is_v13 = _is_v13(manifest_version)
    if not isinstance(module, dict):
        errors.append(_issue("MANIFEST_MODULE_MISSING", "module section is required", "module"))
    if not isinstance(module_id, str) or not module_id:
        errors.append(_issue("MANIFEST_MODULE_ID_INVALID", "module.id is required", "module.id"))
    if expected_module_id and module_id != expected_module_id:
        errors.append(
            _issue(
                "MANIFEST_MODULE_ID_MISMATCH",
                "module.id does not match target module_id",
                "module.id",
                {"expected": expected_module_id, "actual": module_id},
            )
        )

    if not is_v1:
        if "app" in manifest or "pages" in manifest:
            errors.append(
                _issue(
                    "MANIFEST_VERSION_REQUIRED",
                    "manifest_version is required for app/pages definitions",
                    "manifest_version",
                )
            )
    else:
        _reject_unknown_keys(errors, manifest, ALLOWED_V1_TOP_KEYS, "$")

    entities = _get(manifest, "entities", [])
    if not isinstance(entities, list):
        errors.append(_issue("MANIFEST_ENTITIES_INVALID", "entities must be a list", "entities"))
        entities = []

    entity_by_id: dict[str, dict] = {}
    for i, entity in enumerate(entities):
        path = f"entities[{i}]"
        if not isinstance(entity, dict):
            errors.append(_issue("MANIFEST_ENTITY_INVALID", "entity must be an object", path))
            continue
        entity_id = _get(entity, "id")
        if not isinstance(entity_id, str) or not entity_id:
            errors.append(_issue("MANIFEST_ENTITY_ID_INVALID", "entity.id is required", f"{path}.id"))
            continue
        entity_by_id[entity_id] = entity
        fields = _get(entity, "fields", [])
        if not isinstance(fields, list):
            errors.append(_issue("MANIFEST_FIELDS_INVALID", "entity.fields must be a list", f"{path}.fields"))
            continue
        for j, field in enumerate(fields):
            fpath = f"{path}.fields[{j}]"
            if not isinstance(field, dict):
                errors.append(_issue("MANIFEST_FIELD_INVALID", "field must be an object", fpath))
                continue
            field_id = _get(field, "id")
            if not isinstance(field_id, str) or not field_id:
                errors.append(_issue("MANIFEST_FIELD_ID_INVALID", "field.id is required", f"{fpath}.id"))
            ftype = _get(field, "type")
            if not isinstance(ftype, str) or ftype not in ALLOWED_FIELD_TYPES:
                errors.append(
                    _issue(
                        "MANIFEST_FIELD_TYPE_INVALID",
                        "field.type must be one of allowed types",
                        f"{fpath}.type",
                        {"allowed": sorted(ALLOWED_FIELD_TYPES)},
                    )
                )
            required = _get(field, "required")
            if required is not None and not isinstance(required, bool):
                warnings.append(_issue("MANIFEST_FIELD_REQUIRED_INVALID", "field.required should be boolean", f"{fpath}.required"))
            readonly = _get(field, "readonly")
            if readonly is not None and not isinstance(readonly, bool):
                warnings.append(_issue("MANIFEST_FIELD_READONLY_INVALID", "field.readonly should be boolean", f"{fpath}.readonly"))

            ui = _get(field, "ui")
            if ui is not None:
                if not is_v12:
                    errors.append(_issue("MANIFEST_FIELD_UI_INVALID", "field.ui requires manifest_version >= 1.2", f"{fpath}.ui"))
                    ui = None
                if not isinstance(ui, dict):
                    errors.append(_issue("MANIFEST_FIELD_UI_INVALID", "field.ui must be an object", f"{fpath}.ui"))
                else:
                    widget = _get(ui, "widget")
                    if widget is not None and not isinstance(widget, str):
                        errors.append(_issue("MANIFEST_FIELD_UI_INVALID", "field.ui.widget must be a string", f"{fpath}.ui.widget"))
                    if widget == "steps" and ftype != "enum":
                        errors.append(_issue("MANIFEST_FIELD_UI_INVALID", "steps widget requires enum field", f"{fpath}.ui.widget"))

            default = _get(field, "default")
            if default is not None:
                if not _default_type_valid(str(ftype), default):
                    errors.append(_issue("MANIFEST_FIELD_DEFAULT_INVALID", "field.default must match field.type", f"{fpath}.default"))
                if ftype == "enum":
                    options = _get(field, "options") or _get(field, "values")
                    if isinstance(options, list):
                        allowed = [opt.get("value") if isinstance(opt, dict) else opt for opt in options]
                        if default not in allowed:
                            errors.append(_issue("MANIFEST_FIELD_DEFAULT_INVALID", "field.default must be one of enum options", f"{fpath}.default"))
            if required and readonly and default is None and not _get(field, "system"):
                errors.append(_issue("MANIFEST_FIELD_REQUIRED_READONLY_INVALID", "readonly required fields must define default or be system", f"{fpath}.readonly"))
            if ftype == "enum":
                options = _get(field, "options") or _get(field, "values")
                if not isinstance(options, list) or len(options) == 0:
                    errors.append(_issue("MANIFEST_ENUM_VALUES_INVALID", "enum must define options", f"{fpath}.options"))
                elif not _enum_options_object_shape(options):
                    errors.append(_issue("MANIFEST_ENUM_OPTIONS_SHAPE_INVALID", "enum.options must be objects with value and label", f"{fpath}.options"))
            if ftype == "lookup":
                target = _get(field, "entity")
                display = _get(field, "display_field")
                if not isinstance(target, str) or not target:
                    errors.append(_issue("MANIFEST_LOOKUP_TARGET_MISSING", "lookup must declare target entity", f"{fpath}.entity"))
                if not isinstance(display, str) or not display:
                    errors.append(_issue("MANIFEST_LOOKUP_DISPLAY_MISSING", "lookup must declare display_field", f"{fpath}.display_field"))
                if isinstance(target, str):
                    target_full = target if target.startswith("entity.") else f"entity.{target}"
                    target_entity = entity_by_id.get(target_full) or entity_by_id.get(target)
                    if not target_entity:
                        warnings.append(_issue("MANIFEST_LOOKUP_TARGET_EXTERNAL", "lookup target entity not found in module (external ok)", f"{fpath}.entity"))
                    elif isinstance(display, str) and display not in _field_ids(target_entity):
                        errors.append(_issue("MANIFEST_LOOKUP_DISPLAY_UNKNOWN", "lookup display_field not found on target entity", f"{fpath}.display_field"))

            visible_when = _get(field, "visible_when")
            if visible_when is not None:
                if not is_v12:
                    errors.append(_issue("MANIFEST_FIELD_CONDITION_INVALID", "visible_when requires manifest_version >= 1.2", f"{fpath}.visible_when"))
                else:
                    _validate_condition(visible_when, f"{fpath}.visible_when", errors)
            disabled_when = _get(field, "disabled_when")
            if disabled_when is not None:
                if not is_v12:
                    errors.append(_issue("MANIFEST_FIELD_CONDITION_INVALID", "disabled_when requires manifest_version >= 1.2", f"{fpath}.disabled_when"))
                else:
                    _validate_condition(disabled_when, f"{fpath}.disabled_when", errors)
            required_when = _get(field, "required_when")
            if required_when is not None:
                if not is_v12:
                    errors.append(_issue("MANIFEST_FIELD_CONDITION_INVALID", "required_when requires manifest_version >= 1.2", f"{fpath}.required_when"))
                else:
                    _validate_condition(required_when, f"{fpath}.required_when", errors)
            domain = _get(field, "domain")
            if domain is not None:
                if not is_v12:
                    errors.append(_issue("MANIFEST_LOOKUP_DOMAIN_INVALID", "lookup domain requires manifest_version >= 1.2", f"{fpath}.domain"))
                else:
                    if ftype != "lookup":
                        errors.append(_issue("MANIFEST_LOOKUP_DOMAIN_INVALID", "domain is only valid on lookup fields", f"{fpath}.domain"))
                    _validate_condition(domain, f"{fpath}.domain", errors)

        display_field = _get(entity, "display_field")
        if display_field and display_field not in _field_ids(entity):
            errors.append(_issue("MANIFEST_DISPLAY_FIELD_INVALID", "display_field not found in fields", f"{path}.display_field"))

    actions = _get(manifest, "actions", [])
    action_by_id: dict[str, dict] = {}
    if actions is not None and not isinstance(actions, list):
        errors.append(_issue("MANIFEST_ACTIONS_INVALID", "actions must be a list", "actions"))
        actions = []
    if isinstance(actions, list):
        for aidx, action in enumerate(actions):
            apath = f"actions[{aidx}]"
            if not isinstance(action, dict):
                errors.append(_issue("MANIFEST_ACTION_INVALID", "action must be an object", apath))
                continue
            _reject_unknown_keys(errors, action, ALLOWED_V1_ACTION_KEYS, apath)
            action_id = _get(action, "id")
            if not isinstance(action_id, str) or not action_id:
                errors.append(_issue("MANIFEST_ACTION_ID_INVALID", "action.id is required", f"{apath}.id"))
                continue
            action_by_id[action_id] = action
            kind = _get(action, "kind")
            if kind not in ALLOWED_V1_ACTION_KINDS:
                errors.append(_issue("MANIFEST_ACTION_KIND_INVALID", "action.kind must be allowlisted", f"{apath}.kind"))
            label = _get(action, "label")
            if label is not None and not isinstance(label, str):
                errors.append(_issue("MANIFEST_ACTION_LABEL_INVALID", "action.label must be string", f"{apath}.label"))
            if kind == "navigate":
                target = _get(action, "target")
                parsed = _parse_target(target) if isinstance(target, str) else None
                if not parsed:
                    errors.append(_issue("MANIFEST_TARGET_INVALID", "navigate target must be page:<id> or view:<id>", f"{apath}.target"))
            if kind == "open_form":
                target = _get(action, "target")
                if not isinstance(target, str) or target.startswith("page:") or target.startswith("view:"):
                    errors.append(_issue("MANIFEST_ACTION_INVALID", "open_form target must be a view id", f"{apath}.target"))
            if kind in {"create_record", "update_record", "bulk_update"}:
                entity_id = _get(action, "entity_id")
                if not isinstance(entity_id, str) or not entity_id:
                    errors.append(_issue("MANIFEST_ACTION_INVALID", "action.entity_id is required", f"{apath}.entity_id"))
            if kind == "create_record":
                defaults = _get(action, "defaults")
                if defaults is not None and not isinstance(defaults, dict):
                    errors.append(_issue("MANIFEST_ACTION_INVALID", "create_record defaults must be object", f"{apath}.defaults"))
            if kind in {"update_record", "bulk_update"}:
                patch = _get(action, "patch")
                if patch is not None and not isinstance(patch, dict):
                    errors.append(_issue("MANIFEST_ACTION_INVALID", "update patch must be object", f"{apath}.patch"))
            if kind == "refresh" and _get(action, "target") is not None:
                errors.append(_issue("MANIFEST_ACTION_INVALID", "refresh must not include target", f"{apath}.target"))
            visible_when = _get(action, "visible_when")
            if visible_when is not None:
                if not is_v12:
                    errors.append(_issue("MANIFEST_ACTION_CONDITION_INVALID", "visible_when requires manifest_version >= 1.2", f"{apath}.visible_when"))
                else:
                    _validate_condition(visible_when, f"{apath}.visible_when", errors)
            enabled_when = _get(action, "enabled_when")
            if enabled_when is not None:
                if not is_v12:
                    errors.append(_issue("MANIFEST_ACTION_CONDITION_INVALID", "enabled_when requires manifest_version >= 1.2", f"{apath}.enabled_when"))
                else:
                    _validate_condition(enabled_when, f"{apath}.enabled_when", errors)
            confirm = _get(action, "confirm")
            if confirm is not None and not isinstance(confirm, dict):
                errors.append(_issue("MANIFEST_ACTION_CONFIRM_INVALID", "confirm must be object", f"{apath}.confirm"))

    modals = _get(manifest, "modals", [])
    modal_by_id: dict[str, dict] = {}
    if modals is not None and not isinstance(modals, list):
        errors.append(_issue("MANIFEST_MODALS_INVALID", "modals must be a list", "modals"))
        modals = []
    if isinstance(modals, list):
        for midx, modal in enumerate(modals):
            mpath = f"modals[{midx}]"
            if not isinstance(modal, dict):
                errors.append(_issue("MANIFEST_MODAL_INVALID", "modal must be an object", mpath))
                continue
            _reject_unknown_keys(errors, modal, ALLOWED_V1_MODAL_KEYS, mpath)
            modal_id = _get(modal, "id")
            if not isinstance(modal_id, str) or not modal_id:
                errors.append(_issue("MANIFEST_MODAL_ID_INVALID", "modal.id is required", f"{mpath}.id"))
                continue
            modal_by_id[modal_id] = modal
            if _get(modal, "title") is not None and not isinstance(_get(modal, "title"), str):
                errors.append(_issue("MANIFEST_MODAL_INVALID", "modal.title must be string", f"{mpath}.title"))
            if _get(modal, "description") is not None and not isinstance(_get(modal, "description"), str):
                errors.append(_issue("MANIFEST_MODAL_INVALID", "modal.description must be string", f"{mpath}.description"))
            fields = _get(modal, "fields")
            if fields is not None:
                if not isinstance(fields, list):
                    errors.append(_issue("MANIFEST_MODAL_INVALID", "modal.fields must be a list", f"{mpath}.fields"))
                else:
                    for fidx, field_id in enumerate(fields):
                        if not isinstance(field_id, str) or not field_id:
                            errors.append(_issue("MANIFEST_MODAL_INVALID", "modal.fields values must be field ids", f"{mpath}.fields[{fidx}]"))
            defaults = _get(modal, "defaults")
            if defaults is not None and not isinstance(defaults, dict):
                errors.append(_issue("MANIFEST_MODAL_INVALID", "modal.defaults must be object", f"{mpath}.defaults"))
            modal_actions = _get(modal, "actions")
            if modal_actions is not None:
                if not isinstance(modal_actions, list):
                    errors.append(_issue("MANIFEST_MODAL_INVALID", "modal.actions must be a list", f"{mpath}.actions"))
                else:
                    for aidx, action in enumerate(modal_actions):
                        apath = f"{mpath}.actions[{aidx}]"
                        if not isinstance(action, dict):
                            errors.append(_issue("MANIFEST_MODAL_ACTION_INVALID", "modal action must be an object", apath))
                            continue
                        _reject_unknown_keys(errors, action, ALLOWED_V1_MODAL_ACTION_KEYS, apath)
                        action_id = _get(action, "action_id")
                        kind = _get(action, "kind")
                        if action_id is None and kind is None:
                            errors.append(_issue("MANIFEST_MODAL_ACTION_INVALID", "modal action requires action_id or kind", apath))
                        if action_id is not None:
                            if not isinstance(action_id, str) or not action_id:
                                errors.append(_issue("MANIFEST_MODAL_ACTION_INVALID", "modal action_id must be string", f"{apath}.action_id"))
                            elif action_id not in action_by_id:
                                errors.append(_issue("MANIFEST_MODAL_ACTION_UNKNOWN", "modal action_id not found", f"{apath}.action_id"))
                        if kind is not None and kind not in ALLOWED_V1_ACTION_KINDS and kind != "close_modal":
                            errors.append(_issue("MANIFEST_MODAL_ACTION_INVALID", "modal action kind must be allowlisted", f"{apath}.kind"))
                        if _get(action, "close_on_success") is not None and not isinstance(_get(action, "close_on_success"), bool):
                            errors.append(_issue("MANIFEST_MODAL_ACTION_INVALID", "close_on_success must be boolean", f"{apath}.close_on_success"))

    triggers = _get(manifest, "triggers", [])
    if triggers is not None and not isinstance(triggers, list):
        errors.append(_issue("MANIFEST_TRIGGERS_INVALID", "triggers must be a list", "triggers"))
        triggers = []
    if isinstance(triggers, list):
        for tidx, trigger in enumerate(triggers):
            tpath = f"triggers[{tidx}]"
            if not isinstance(trigger, dict):
                errors.append(_issue("MANIFEST_TRIGGER_INVALID", "trigger must be an object", tpath))
                continue
            _reject_unknown_keys(errors, trigger, ALLOWED_V1_TRIGGER_KEYS, tpath)
            trigger_id = _get(trigger, "id")
            if not isinstance(trigger_id, str) or not trigger_id:
                errors.append(_issue("MANIFEST_TRIGGER_ID_INVALID", "trigger.id is required", f"{tpath}.id"))
            event = _get(trigger, "event")
            if event not in ALLOWED_V1_TRIGGER_EVENTS:
                errors.append(_issue("MANIFEST_TRIGGER_EVENT_INVALID", "trigger.event must be allowlisted", f"{tpath}.event"))
                continue
            if event in {"record.created", "record.updated", "workflow.status_changed"}:
                entity_id = _get(trigger, "entity_id")
                if not isinstance(entity_id, str) or not entity_id:
                    errors.append(_issue("MANIFEST_TRIGGER_ENTITY_INVALID", "trigger.entity_id is required", f"{tpath}.entity_id"))
                else:
                    full_entity_id = entity_id if entity_id.startswith("entity.") else f"entity.{entity_id}"
                    if full_entity_id not in entity_by_id and entity_id not in entity_by_id:
                        errors.append(_issue("MANIFEST_TRIGGER_ENTITY_UNKNOWN", "trigger.entity_id not found", f"{tpath}.entity_id"))
                status_field = _get(trigger, "status_field")
                if status_field is not None and not isinstance(status_field, str):
                    errors.append(_issue("MANIFEST_TRIGGER_FIELD_INVALID", "trigger.status_field must be string", f"{tpath}.status_field"))
            if event == "action.clicked":
                action_id = _get(trigger, "action_id")
                if not isinstance(action_id, str) or not action_id:
                    errors.append(_issue("MANIFEST_TRIGGER_ACTION_INVALID", "trigger.action_id is required", f"{tpath}.action_id"))
                elif action_id not in action_by_id:
                    errors.append(_issue("MANIFEST_TRIGGER_ACTION_UNKNOWN", "trigger.action_id not found", f"{tpath}.action_id"))

    views = _get(manifest, "views", [])
    workflows_by_entity: dict[str, dict] = {}
    workflows_list = _get(manifest, "workflows", [])
    if isinstance(workflows_list, list):
        for wf in workflows_list:
            if not isinstance(wf, dict):
                continue
            wf_entity = _get(wf, "entity")
            if isinstance(wf_entity, str):
                workflows_by_entity[wf_entity] = wf
    if not isinstance(views, list):
        errors.append(_issue("MANIFEST_VIEWS_INVALID", "views must be a list", "views"))
        views = []

    for i, view in enumerate(views):
        vpath = f"views[{i}]"
        if not isinstance(view, dict):
            errors.append(_issue("MANIFEST_VIEW_INVALID", "view must be an object", vpath))
            continue
        view_id = _get(view, "id")
        if not isinstance(view_id, str) or not view_id:
            errors.append(_issue("MANIFEST_VIEW_ID_INVALID", "view.id is required", f"{vpath}.id"))
        entity_id = _get(view, "entity") or _get(view, "entity_id") or _get(view, "entityId")
        if not isinstance(entity_id, str) or not entity_id:
            errors.append(_issue("MANIFEST_VIEW_ENTITY_INVALID", "view.entity is required", f"{vpath}.entity"))
            continue
        if entity_id.startswith("entity."):
            full_entity_id = entity_id
        else:
            full_entity_id = f"entity.{entity_id}"
        if full_entity_id not in entity_by_id and entity_id not in entity_by_id:
            errors.append(_issue("MANIFEST_VIEW_ENTITY_UNKNOWN", "view entity not found", f"{vpath}.entity"))
        entity_obj = entity_by_id.get(full_entity_id) or entity_by_id.get(entity_id)
        vtype = _get(view, "type") or _get(view, "kind")
        if vtype not in {"list", "form", "kanban", "graph", "calendar"}:
            errors.append(_issue("MANIFEST_VIEW_TYPE_INVALID", "view.type must be list, form, kanban, graph, or calendar", f"{vpath}.type"))

        open_record = _get(view, "open_record")
        if open_record is not None:
            if not isinstance(open_record, dict):
                errors.append(_issue("MANIFEST_VIEW_OPEN_RECORD_INVALID", "open_record must be an object", f"{vpath}.open_record"))
            else:
                target = _get(open_record, "to")
                if not isinstance(target, str) or not _parse_target(target):
                    errors.append(_issue("MANIFEST_VIEW_OPEN_RECORD_INVALID", "open_record.to must be page:<id> or view:<id>", f"{vpath}.open_record.to"))
                param = _get(open_record, "param")
                if param is not None and not isinstance(param, str):
                    errors.append(_issue("MANIFEST_VIEW_OPEN_RECORD_INVALID", "open_record.param must be string", f"{vpath}.open_record.param"))

        if vtype == "list" and "create_behavior" in view:
            create_behavior = _get(view, "create_behavior")
            if create_behavior not in {"open_form", "create_record"}:
                errors.append(
                    _issue(
                        "MANIFEST_VIEW_CREATE_BEHAVIOR_INVALID",
                        "create_behavior must be open_form or create_record",
                        f"{vpath}.create_behavior",
                    )
                )

        header = _get(view, "header")
        if header is not None:
            if not isinstance(header, dict):
                errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "view.header must be an object", f"{vpath}.header"))
            else:
                _reject_unknown_keys(errors, header, ALLOWED_V1_VIEW_HEADER_KEYS, f"{vpath}.header")
                title_field = _get(header, "title_field")
                if title_field is not None:
                    if not isinstance(title_field, str):
                        errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "title_field must be string", f"{vpath}.header.title_field"))
                    elif entity_obj and title_field not in _field_ids(entity_obj):
                        errors.append(_issue("MANIFEST_VIEW_FIELD_UNKNOWN", "title_field not found on entity", f"{vpath}.header.title_field"))
                save_mode = _get(header, "save_mode")
                if save_mode is not None:
                    if vtype != "form":
                        errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "save_mode only valid on form views", f"{vpath}.header.save_mode"))
                    elif save_mode not in {"top", "bottom", "both"}:
                        errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "save_mode must be top|bottom|both", f"{vpath}.header.save_mode"))
                auto_save = _get(header, "auto_save")
                if auto_save is not None:
                    if vtype != "form":
                        errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "auto_save only valid on form views", f"{vpath}.header.auto_save"))
                    elif not isinstance(auto_save, bool):
                        errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "auto_save must be boolean", f"{vpath}.header.auto_save"))
                debounce = _get(header, "auto_save_debounce_ms")
                if debounce is not None:
                    if vtype != "form":
                        errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "auto_save_debounce_ms only valid on form views", f"{vpath}.header.auto_save_debounce_ms"))
                    elif not isinstance(debounce, int) or debounce <= 0:
                        errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "auto_save_debounce_ms must be positive integer", f"{vpath}.header.auto_save_debounce_ms"))
                open_record_target = _get(header, "open_record_target")
                if open_record_target is not None:
                    if vtype != "list":
                        errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "open_record_target only valid on list views", f"{vpath}.header.open_record_target"))
                    elif not isinstance(open_record_target, str) or not _parse_target(open_record_target):
                        errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "open_record_target must be page:<id> or view:<id>", f"{vpath}.header.open_record_target"))

                statusbar = _get(header, "statusbar")
                if statusbar is not None:
                    if vtype != "form":
                        errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "statusbar only valid on form views", f"{vpath}.header.statusbar"))
                    elif not isinstance(statusbar, dict):
                        errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "statusbar must be object", f"{vpath}.header.statusbar"))
                    else:
                        field_id = _get(statusbar, "field_id")
                        if not isinstance(field_id, str):
                            errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "statusbar.field_id must be string", f"{vpath}.header.statusbar.field_id"))
                        elif entity_obj and field_id not in _field_ids(entity_obj):
                            errors.append(_issue("MANIFEST_VIEW_FIELD_UNKNOWN", "statusbar.field_id not found on entity", f"{vpath}.header.statusbar.field_id"))
                        elif entity_obj:
                            fields = _get(entity_obj, "fields", [])
                            if isinstance(fields, list):
                                for f in fields:
                                    if isinstance(f, dict) and f.get("id") == field_id:
                                        ftype = f.get("type")
                                        if ftype not in {"enum"}:
                                            errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "statusbar field must be enum", f"{vpath}.header.statusbar.field_id"))
                                        break
                        wf = workflows_by_entity.get(full_entity_id) or workflows_by_entity.get(entity_id)
                        if isinstance(wf, dict):
                            wf_status = _get(wf, "status_field")
                            if isinstance(wf_status, str) and field_id and wf_status != field_id:
                                errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "statusbar.field_id must match workflow status_field", f"{vpath}.header.statusbar.field_id"))

                tabs = _get(header, "tabs")
                if tabs is not None:
                    if vtype != "form":
                        errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "tabs only valid on form views", f"{vpath}.header.tabs"))
                    elif not isinstance(tabs, dict):
                        errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "tabs must be object", f"{vpath}.header.tabs"))
                    else:
                        style = _get(tabs, "style")
                        if style is not None and style not in {"boxed", "lifted", "bordered"}:
                            errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "tabs.style must be boxed|lifted|bordered", f"{vpath}.header.tabs.style"))
                        tabs_list = _get(tabs, "tabs")
                        if not isinstance(tabs_list, list) or not tabs_list:
                            errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "tabs.tabs must be a non-empty list", f"{vpath}.header.tabs.tabs"))
                        else:
                            section_ids = set()
                            sections = _get(view, "sections", [])
                            if isinstance(sections, list):
                                for s in sections:
                                    if isinstance(s, dict) and isinstance(s.get("id"), str):
                                        section_ids.add(s["id"])
                            seen = set()
                            referenced = set()
                            for tidx, tab in enumerate(tabs_list):
                                tpath = f"{vpath}.header.tabs.tabs[{tidx}]"
                                if not isinstance(tab, dict):
                                    errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "tab must be object", tpath))
                                    continue
                                tab_id = _get(tab, "id")
                                if not isinstance(tab_id, str) or not tab_id:
                                    errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "tab.id is required", f"{tpath}.id"))
                                elif tab_id in seen:
                                    errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "tab.id must be unique", f"{tpath}.id"))
                                else:
                                    seen.add(tab_id)
                                sections_ref = _get(tab, "sections")
                                if not isinstance(sections_ref, list) or not sections_ref:
                                    errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "tab.sections must be a non-empty list", f"{tpath}.sections"))
                                else:
                                    for sidx, sid in enumerate(sections_ref):
                                        if not isinstance(sid, str):
                                            errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "tab.sections must be list of strings", f"{tpath}.sections[{sidx}]"))
                                        elif sid not in section_ids:
                                            errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "tab.section not found", f"{tpath}.sections[{sidx}]"))
                                        else:
                                            referenced.add(sid)
                            default_tab = _get(tabs, "default_tab")
                            if default_tab is not None and default_tab not in seen:
                                errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "tabs.default_tab not found", f"{vpath}.header.tabs.default_tab"))
                            if section_ids and referenced and section_ids - referenced:
                                warnings.append(_issue("MANIFEST_VIEW_HEADER_WARNING", "sections not referenced by any tab", f"{vpath}.header.tabs"))

                _validate_view_header_actions(_get(header, "primary_actions"), f"{vpath}.header.primary_actions", errors, action_by_id, is_v12, True)
                _validate_view_header_actions(_get(header, "secondary_actions"), f"{vpath}.header.secondary_actions", errors, action_by_id, is_v12, True)
                bulk_actions = _get(header, "bulk_actions")
                if bulk_actions is not None and vtype != "list":
                    errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "bulk_actions only valid on list views", f"{vpath}.header.bulk_actions"))
                _validate_view_header_actions(bulk_actions, f"{vpath}.header.bulk_actions", errors, action_by_id, is_v12, False)

                search = _get(header, "search")
                if search is not None:
                    if not isinstance(search, dict):
                        errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "search must be object", f"{vpath}.header.search"))
                    else:
                        _reject_unknown_keys(errors, search, ALLOWED_V1_VIEW_HEADER_SEARCH_KEYS, f"{vpath}.header.search")
                        enabled = _get(search, "enabled")
                        if enabled is not None and not isinstance(enabled, bool):
                            errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "search.enabled must be boolean", f"{vpath}.header.search.enabled"))
                        fields = _get(search, "fields")
                        if enabled and not isinstance(fields, list):
                            errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "search.fields must be list", f"{vpath}.header.search.fields"))
                        if isinstance(fields, list) and entity_obj:
                            for fidx, fid in enumerate(fields):
                                if isinstance(fid, str) and fid not in _field_ids(entity_obj):
                                    errors.append(_issue("MANIFEST_VIEW_FIELD_UNKNOWN", "search field not found", f"{vpath}.header.search.fields[{fidx}]"))

                filters = _get(header, "filters")
                if filters is not None:
                    if not isinstance(filters, list):
                        errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "filters must be list", f"{vpath}.header.filters"))
                    else:
                        for fidx, flt in enumerate(filters):
                            fpath = f"{vpath}.header.filters[{fidx}]"
                            if not isinstance(flt, dict):
                                errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "filter must be object", fpath))
                                continue
                            _reject_unknown_keys(errors, flt, ALLOWED_V1_VIEW_HEADER_FILTER_KEYS, fpath)
                            fid = _get(flt, "id")
                            if not isinstance(fid, str) or not fid:
                                errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "filter.id is required", f"{fpath}.id"))
                            label = _get(flt, "label")
                            if label is not None and not isinstance(label, str):
                                errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "filter.label must be string", f"{fpath}.label"))
                            domain = _get(flt, "domain")
                            if domain is None:
                                errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "filter.domain is required", f"{fpath}.domain"))
                            else:
                                if not is_v12:
                                    errors.append(_issue("MANIFEST_VIEW_HEADER_INVALID", "filters require manifest_version >= 1.2", f"{fpath}.domain"))
                                else:
                                    _validate_condition(domain, f"{fpath}.domain", errors)

        activity = _get(view, "activity")
        if activity is not None:
            if vtype != "form":
                errors.append(_issue("MANIFEST_VIEW_ACTIVITY_INVALID", "activity only valid on form views", f"{vpath}.activity"))
            elif not isinstance(activity, dict):
                errors.append(_issue("MANIFEST_VIEW_ACTIVITY_INVALID", "activity must be an object", f"{vpath}.activity"))
            else:
                _reject_unknown_keys(errors, activity, ALLOWED_V1_VIEW_ACTIVITY_KEYS, f"{vpath}.activity")
                enabled = _get(activity, "enabled")
                if enabled is not None and not isinstance(enabled, bool):
                    errors.append(_issue("MANIFEST_VIEW_ACTIVITY_INVALID", "activity.enabled must be boolean", f"{vpath}.activity.enabled"))
                mode = _get(activity, "mode")
                if mode is not None and mode not in {"tab", "panel"}:
                    errors.append(_issue("MANIFEST_VIEW_ACTIVITY_INVALID", "activity.mode must be tab|panel", f"{vpath}.activity.mode"))
                tab_label = _get(activity, "tab_label")
                if tab_label is not None:
                    if not isinstance(tab_label, str):
                        errors.append(_issue("MANIFEST_VIEW_ACTIVITY_INVALID", "activity.tab_label must be string", f"{vpath}.activity.tab_label"))
                    elif not tab_label.strip():
                        errors.append(_issue("MANIFEST_VIEW_ACTIVITY_INVALID", "activity.tab_label must not be empty", f"{vpath}.activity.tab_label"))
                allow_comments = _get(activity, "allow_comments")
                if allow_comments is not None and not isinstance(allow_comments, bool):
                    errors.append(_issue("MANIFEST_VIEW_ACTIVITY_INVALID", "activity.allow_comments must be boolean", f"{vpath}.activity.allow_comments"))
                allow_attachments = _get(activity, "allow_attachments")
                if allow_attachments is not None and not isinstance(allow_attachments, bool):
                    errors.append(_issue("MANIFEST_VIEW_ACTIVITY_INVALID", "activity.allow_attachments must be boolean", f"{vpath}.activity.allow_attachments"))
                show_changes = _get(activity, "show_changes")
                if show_changes is not None and not isinstance(show_changes, bool):
                    errors.append(_issue("MANIFEST_VIEW_ACTIVITY_INVALID", "activity.show_changes must be boolean", f"{vpath}.activity.show_changes"))
                tracked_fields = _get(activity, "tracked_fields")
                if tracked_fields is not None:
                    if not isinstance(tracked_fields, list):
                        errors.append(_issue("MANIFEST_VIEW_ACTIVITY_INVALID", "activity.tracked_fields must be list", f"{vpath}.activity.tracked_fields"))
                    elif entity_obj:
                        valid_fields = _field_ids(entity_obj)
                        for fidx, fid in enumerate(tracked_fields):
                            if not isinstance(fid, str):
                                errors.append(_issue("MANIFEST_VIEW_ACTIVITY_INVALID", "tracked_fields items must be strings", f"{vpath}.activity.tracked_fields[{fidx}]"))
                            elif fid not in valid_fields:
                                errors.append(_issue("MANIFEST_VIEW_FIELD_UNKNOWN", "tracked_fields field not found on entity", f"{vpath}.activity.tracked_fields[{fidx}]"))

        if vtype == "list":
            columns = _get(view, "columns", [])
            if not isinstance(columns, list):
                errors.append(_issue("MANIFEST_VIEW_COLUMNS_INVALID", "list view columns must be a list", f"{vpath}.columns"))
            else:
                for cidx, col in enumerate(columns):
                    if not isinstance(col, dict):
                        continue
                    field_id = _get(col, "field_id")
                    if isinstance(field_id, str):
                        if entity_obj and field_id not in _field_ids(entity_obj):
                            errors.append(_issue("MANIFEST_VIEW_FIELD_UNKNOWN", "list view field not found", f"{vpath}.columns[{cidx}].field_id"))

        if vtype == "form":
            sections = _get(view, "sections", [])
            if not isinstance(sections, list):
                errors.append(_issue("MANIFEST_VIEW_SECTIONS_INVALID", "form view sections must be a list", f"{vpath}.sections"))
            else:
                for sidx, section in enumerate(sections):
                    fields = _get(section, "fields", [])
                    if isinstance(fields, list):
                        for fidx, fid in enumerate(fields):
                            if isinstance(fid, str):
                                entity_obj = entity_by_id.get(full_entity_id) or entity_by_id.get(entity_id)
                                if entity_obj and fid not in _field_ids(entity_obj):
                                    errors.append(
                                        _issue(
                                            "MANIFEST_VIEW_FIELD_UNKNOWN",
                                            "form view field not found",
                                            f"{vpath}.sections[{sidx}].fields[{fidx}]",
                                        )
                                    )
                    layout = _get(section, "layout")
                    if layout is not None:
                        if not is_v13:
                            errors.append(_issue("MANIFEST_VIEW_SECTION_LAYOUT_INVALID", "section.layout requires manifest_version >= 1.3", f"{vpath}.sections[{sidx}].layout"))
                        elif layout != "columns":
                            errors.append(_issue("MANIFEST_VIEW_SECTION_LAYOUT_INVALID", "section.layout must be 'columns'", f"{vpath}.sections[{sidx}].layout"))
                        columns = _get(section, "columns")
                        if layout == "columns":
                            if columns is not None and columns != 2:
                                errors.append(_issue("MANIFEST_VIEW_SECTION_LAYOUT_INVALID", "section.columns must be 2", f"{vpath}.sections[{sidx}].columns"))

        if vtype == "kanban":
            card = _get(view, "card")
            if not isinstance(card, dict):
                errors.append(_issue("MANIFEST_VIEW_KANBAN_INVALID", "kanban view requires card object", f"{vpath}.card"))
            else:
                _reject_unknown_keys(errors, card, ALLOWED_V1_VIEW_CARD_KEYS, f"{vpath}.card")
                title_field = _get(card, "title_field")
                if not isinstance(title_field, str) or not title_field:
                    errors.append(_issue("MANIFEST_VIEW_KANBAN_INVALID", "card.title_field is required", f"{vpath}.card.title_field"))
                elif entity_obj and title_field not in _field_ids(entity_obj):
                    errors.append(_issue("MANIFEST_VIEW_FIELD_UNKNOWN", "card.title_field not found", f"{vpath}.card.title_field"))
                subtitle_fields = _get(card, "subtitle_fields", [])
                if subtitle_fields is not None:
                    if not isinstance(subtitle_fields, list):
                        errors.append(_issue("MANIFEST_VIEW_KANBAN_INVALID", "card.subtitle_fields must be list", f"{vpath}.card.subtitle_fields"))
                    elif entity_obj:
                        for sidx, fid in enumerate(subtitle_fields):
                            if isinstance(fid, str) and fid not in _field_ids(entity_obj):
                                errors.append(_issue("MANIFEST_VIEW_FIELD_UNKNOWN", "card.subtitle_fields field not found", f"{vpath}.card.subtitle_fields[{sidx}]"))
                badge_fields = _get(card, "badge_fields", [])
                if badge_fields is not None:
                    if not isinstance(badge_fields, list):
                        errors.append(_issue("MANIFEST_VIEW_KANBAN_INVALID", "card.badge_fields must be list", f"{vpath}.card.badge_fields"))
                    elif entity_obj:
                        for bidx, fid in enumerate(badge_fields):
                            if isinstance(fid, str) and fid not in _field_ids(entity_obj):
                                errors.append(_issue("MANIFEST_VIEW_FIELD_UNKNOWN", "card.badge_fields field not found", f"{vpath}.card.badge_fields[{bidx}]"))

        if vtype == "graph":
            graph_def = _get(view, "default")
            if graph_def is not None:
                if not isinstance(graph_def, dict):
                    errors.append(_issue("MANIFEST_VIEW_GRAPH_INVALID", "graph.default must be object", f"{vpath}.default"))
                else:
                    _reject_unknown_keys(errors, graph_def, ALLOWED_V1_GRAPH_DEFAULT_KEYS, f"{vpath}.default")
                    gtype = _get(graph_def, "type")
                    if gtype is not None and gtype not in {"bar", "line", "pie"}:
                        errors.append(_issue("MANIFEST_VIEW_GRAPH_INVALID", "graph.default.type must be bar|line|pie", f"{vpath}.default.type"))
                    group_by = _get(graph_def, "group_by")
                    if group_by is not None and entity_obj and group_by not in _field_ids(entity_obj):
                        errors.append(_issue("MANIFEST_VIEW_FIELD_UNKNOWN", "graph.default.group_by not found", f"{vpath}.default.group_by"))
                    measure = _get(graph_def, "measure")
                    if measure is not None and isinstance(measure, str) and measure.startswith("sum:") and entity_obj:
                        mfield = measure.split(":", 1)[1]
                        if mfield and mfield not in _field_ids(entity_obj):
                            errors.append(_issue("MANIFEST_VIEW_FIELD_UNKNOWN", "graph.default.measure field not found", f"{vpath}.default.measure"))

        if vtype == "calendar":
            calendar = _get(view, "calendar")
            if calendar is not None and not isinstance(calendar, dict):
                errors.append(_issue("MANIFEST_VIEW_CALENDAR_INVALID", "calendar must be an object", f"{vpath}.calendar"))
                calendar = None
            date_start = _get(calendar, "date_start") if isinstance(calendar, dict) else _get(view, "date_start")
            date_end = _get(calendar, "date_end") if isinstance(calendar, dict) else _get(view, "date_end")
            title_field = _get(calendar, "title_field") if isinstance(calendar, dict) else _get(view, "title_field")
            all_day_field = _get(calendar, "all_day_field") if isinstance(calendar, dict) else _get(view, "all_day_field")
            color_field = _get(calendar, "color_field") if isinstance(calendar, dict) else _get(view, "color_field")
            default_scale = _get(calendar, "default_scale") if isinstance(calendar, dict) else _get(view, "default_scale")

            if not isinstance(date_start, str) or not date_start:
                errors.append(_issue("MANIFEST_VIEW_CALENDAR_INVALID", "calendar.date_start is required", f"{vpath}.calendar.date_start"))
            elif entity_obj and date_start not in _field_ids(entity_obj):
                errors.append(_issue("MANIFEST_VIEW_FIELD_UNKNOWN", "calendar.date_start field not found", f"{vpath}.calendar.date_start"))
            if date_end is not None:
                if not isinstance(date_end, str):
                    errors.append(_issue("MANIFEST_VIEW_CALENDAR_INVALID", "calendar.date_end must be string", f"{vpath}.calendar.date_end"))
                elif entity_obj and date_end not in _field_ids(entity_obj):
                    errors.append(_issue("MANIFEST_VIEW_FIELD_UNKNOWN", "calendar.date_end field not found", f"{vpath}.calendar.date_end"))
            if not isinstance(title_field, str) or not title_field:
                errors.append(_issue("MANIFEST_VIEW_CALENDAR_INVALID", "calendar.title_field is required", f"{vpath}.calendar.title_field"))
            elif entity_obj and title_field not in _field_ids(entity_obj):
                errors.append(_issue("MANIFEST_VIEW_FIELD_UNKNOWN", "calendar.title_field field not found", f"{vpath}.calendar.title_field"))
            if all_day_field is not None:
                if not isinstance(all_day_field, str):
                    errors.append(_issue("MANIFEST_VIEW_CALENDAR_INVALID", "calendar.all_day_field must be string", f"{vpath}.calendar.all_day_field"))
                elif entity_obj and all_day_field not in _field_ids(entity_obj):
                    errors.append(_issue("MANIFEST_VIEW_FIELD_UNKNOWN", "calendar.all_day_field field not found", f"{vpath}.calendar.all_day_field"))
            if color_field is not None:
                if not isinstance(color_field, str):
                    errors.append(_issue("MANIFEST_VIEW_CALENDAR_INVALID", "calendar.color_field must be string", f"{vpath}.calendar.color_field"))
                elif entity_obj and color_field not in _field_ids(entity_obj):
                    errors.append(_issue("MANIFEST_VIEW_FIELD_UNKNOWN", "calendar.color_field field not found", f"{vpath}.calendar.color_field"))
            if default_scale is not None and default_scale not in {"month", "week", "day", "year"}:
                errors.append(_issue("MANIFEST_VIEW_CALENDAR_INVALID", "calendar.default_scale must be month|week|day|year", f"{vpath}.calendar.default_scale"))

    view_ids = {v.get("id") for v in views if isinstance(v, dict) and isinstance(v.get("id"), str)}

    relations = _get(manifest, "relations", [])
    if relations and not isinstance(relations, list):
        errors.append(_issue("MANIFEST_RELATIONS_INVALID", "relations must be a list", "relations"))
        relations = []

    for ridx, rel in enumerate(relations):
        rpath = f"relations[{ridx}]"
        if not isinstance(rel, dict):
            errors.append(_issue("MANIFEST_RELATION_INVALID", "relation must be an object", rpath))
            continue
        source = _get(rel, "from")
        target = _get(rel, "to")
        label_field = _get(rel, "label_field")
        if not isinstance(source, str) or not isinstance(target, str):
            errors.append(_issue("MANIFEST_RELATION_INVALID", "relation from/to required", rpath))
            continue
        if label_field and not isinstance(label_field, str):
            warnings.append(_issue("MANIFEST_RELATION_LABEL_INVALID", "label_field should be string", f"{rpath}.label_field"))

    workflows = _get(manifest, "workflows", [])
    if workflows and not isinstance(workflows, list):
        errors.append(_issue("MANIFEST_WORKFLOWS_INVALID", "workflows must be a list", "workflows"))
        workflows = []

    if isinstance(workflows, list):
        for widx, workflow in enumerate(workflows):
            wpath = f"workflows[{widx}]"
            if not isinstance(workflow, dict):
                errors.append(_issue("MANIFEST_WORKFLOW_INVALID", "workflow must be an object", wpath))
                continue
            _reject_unknown_keys(errors, workflow, ALLOWED_WORKFLOW_KEYS, wpath)
            wid = _get(workflow, "id")
            if not isinstance(wid, str) or not wid:
                errors.append(_issue("MANIFEST_WORKFLOW_ID_INVALID", "workflow.id is required", f"{wpath}.id"))
            entity_id = _get(workflow, "entity")
            if not isinstance(entity_id, str) or not entity_id:
                errors.append(_issue("MANIFEST_WORKFLOW_ENTITY_INVALID", "workflow.entity is required", f"{wpath}.entity"))
                continue
            if entity_id.startswith("entity."):
                full_entity_id = entity_id
            else:
                full_entity_id = f"entity.{entity_id}"
            entity_obj = entity_by_id.get(full_entity_id) or entity_by_id.get(entity_id)
            if not entity_obj:
                errors.append(_issue("MANIFEST_WORKFLOW_ENTITY_UNKNOWN", "workflow entity not found", f"{wpath}.entity"))
                continue
            status_field = _get(workflow, "status_field")
            if not isinstance(status_field, str) or not status_field:
                errors.append(_issue("MANIFEST_WORKFLOW_STATUS_FIELD_INVALID", "workflow.status_field is required", f"{wpath}.status_field"))
            else:
                if status_field not in _field_ids(entity_obj):
                    errors.append(_issue("MANIFEST_WORKFLOW_STATUS_FIELD_UNKNOWN", "workflow.status_field not found on entity", f"{wpath}.status_field"))
                else:
                    field = next((f for f in _get(entity_obj, "fields", []) if isinstance(f, dict) and f.get("id") == status_field), None)
                    ftype = _get(field, "type")
                    if ftype not in {"enum", "string"}:
                        warnings.append(_issue("MANIFEST_WORKFLOW_STATUS_FIELD_TYPE", "workflow status_field should be enum or string", f"{wpath}.status_field"))

            states = _get(workflow, "states", [])
            if not isinstance(states, list) or len(states) == 0:
                errors.append(_issue("MANIFEST_WORKFLOW_STATES_INVALID", "workflow.states must be a non-empty list", f"{wpath}.states"))
                states = []
            state_ids = []
            for sidx, state in enumerate(states):
                spath = f"{wpath}.states[{sidx}]"
                if not isinstance(state, dict):
                    errors.append(_issue("MANIFEST_WORKFLOW_STATE_INVALID", "state must be an object", spath))
                    continue
                _reject_unknown_keys(errors, state, ALLOWED_WORKFLOW_STATE_KEYS, spath)
                sid = _get(state, "id")
                if not isinstance(sid, str) or not sid:
                    errors.append(_issue("MANIFEST_WORKFLOW_STATE_ID_INVALID", "state.id is required", f"{spath}.id"))
                else:
                    state_ids.append(sid)
                required_fields = _get(state, "required_fields")
                if required_fields is not None and not isinstance(required_fields, list):
                    errors.append(_issue("MANIFEST_WORKFLOW_REQUIRED_FIELDS_INVALID", "state.required_fields must be a list", f"{spath}.required_fields"))
                elif isinstance(required_fields, list):
                    for fidx, fid in enumerate(required_fields):
                        if isinstance(fid, str) and fid not in _field_ids(entity_obj):
                            errors.append(_issue("MANIFEST_WORKFLOW_REQUIRED_FIELD_UNKNOWN", "required field not found on entity", f"{spath}.required_fields[{fidx}]"))

            if len(state_ids) != len(set(state_ids)):
                errors.append(_issue("MANIFEST_WORKFLOW_STATE_DUPLICATE", "state.id values must be unique", f"{wpath}.states"))

            transitions = _get(workflow, "transitions", [])
            if transitions is not None and not isinstance(transitions, list):
                errors.append(_issue("MANIFEST_WORKFLOW_TRANSITIONS_INVALID", "workflow.transitions must be a list", f"{wpath}.transitions"))
                transitions = []
            for tidx, transition in enumerate(transitions or []):
                tpath = f"{wpath}.transitions[{tidx}]"
                if not isinstance(transition, dict):
                    errors.append(_issue("MANIFEST_WORKFLOW_TRANSITION_INVALID", "transition must be an object", tpath))
                    continue
                _reject_unknown_keys(errors, transition, ALLOWED_WORKFLOW_TRANSITION_KEYS, tpath)
                from_state = _get(transition, "from")
                to_state = _get(transition, "to")
                if not isinstance(from_state, str) or not isinstance(to_state, str):
                    errors.append(_issue("MANIFEST_WORKFLOW_TRANSITION_INVALID", "transition from/to required", tpath))
                    continue
                if from_state not in state_ids:
                    errors.append(_issue("MANIFEST_WORKFLOW_TRANSITION_UNKNOWN", "transition.from must reference a state", f"{tpath}.from"))
                if to_state not in state_ids:
                    errors.append(_issue("MANIFEST_WORKFLOW_TRANSITION_UNKNOWN", "transition.to must reference a state", f"{tpath}.to"))

            required_map = _get(workflow, "required_fields_by_state")
            if required_map is not None and not isinstance(required_map, dict):
                errors.append(_issue("MANIFEST_WORKFLOW_REQUIRED_MAP_INVALID", "required_fields_by_state must be a map", f"{wpath}.required_fields_by_state"))
            elif isinstance(required_map, dict):
                for key, fields in required_map.items():
                    if key not in state_ids:
                        errors.append(_issue("MANIFEST_WORKFLOW_REQUIRED_MAP_UNKNOWN", "required_fields_by_state key must be a state id", f"{wpath}.required_fields_by_state.{key}"))
                    if not isinstance(fields, list):
                        errors.append(_issue("MANIFEST_WORKFLOW_REQUIRED_MAP_INVALID", "required_fields_by_state values must be lists", f"{wpath}.required_fields_by_state.{key}"))
                        continue
                    for fidx, fid in enumerate(fields):
                        if isinstance(fid, str) and fid not in _field_ids(entity_obj):
                            errors.append(_issue("MANIFEST_WORKFLOW_REQUIRED_FIELD_UNKNOWN", "required field not found on entity", f"{wpath}.required_fields_by_state.{key}[{fidx}]"))

    if is_v1:
        app_def = _get(manifest, "app")
        pages = _get(manifest, "pages", [])

        if app_def is not None and not isinstance(app_def, dict):
            errors.append(_issue("MANIFEST_APP_INVALID", "app must be an object", "app"))
            app_def = None
        if app_def is not None:
            _reject_unknown_keys(errors, app_def, ALLOWED_V1_APP_KEYS, "app")
            home = _get(app_def, "home")
            if not isinstance(home, str) or not _parse_target(home):
                errors.append(_issue("MANIFEST_APP_HOME_INVALID", "app.home must be page:<id> or view:<id>", "app.home"))
            defaults = _get(app_def, "defaults")
            if defaults is not None:
                if not isinstance(defaults, dict):
                    errors.append(_issue("MANIFEST_APP_DEFAULTS_INVALID", "app.defaults must be an object", "app.defaults"))
                else:
                    entity_home_page = _get(defaults, "entity_home_page")
                    entity_form_page = _get(defaults, "entity_form_page")
                    if entity_home_page is not None and (not isinstance(entity_home_page, str) or not _parse_target(entity_home_page)):
                        errors.append(_issue("MANIFEST_APP_DEFAULTS_INVALID", "entity_home_page must be page:<id> or view:<id>", "app.defaults.entity_home_page"))
                    if entity_form_page is not None and (not isinstance(entity_form_page, str) or not _parse_target(entity_form_page)):
                        errors.append(_issue("MANIFEST_APP_DEFAULTS_INVALID", "entity_form_page must be page:<id> or view:<id>", "app.defaults.entity_form_page"))
                    entities_defaults = _get(defaults, "entities")
                    if entities_defaults is not None:
                        if not isinstance(entities_defaults, dict):
                            errors.append(_issue("MANIFEST_APP_DEFAULTS_INVALID", "defaults.entities must be an object", "app.defaults.entities"))
                        else:
                            page_ids = set()
                            if isinstance(pages, list):
                                for p in pages:
                                    if isinstance(p, dict) and isinstance(p.get("id"), str):
                                        page_ids.add(p["id"])
                            for ent_key, ent_defaults in entities_defaults.items():
                                epath = f"app.defaults.entities.{ent_key}"
                                if not isinstance(ent_defaults, dict):
                                    errors.append(_issue("MANIFEST_APP_DEFAULTS_INVALID", "entity defaults must be object", epath))
                                    continue
                                entity_home = _get(ent_defaults, "entity_home_page")
                                entity_form = _get(ent_defaults, "entity_form_page")
                                for name, value in (("entity_home_page", entity_home), ("entity_form_page", entity_form)):
                                    if value is None:
                                        continue
                                    parsed = _parse_target(value) if isinstance(value, str) else None
                                    if not parsed or parsed[0] != "page":
                                        errors.append(_issue("MANIFEST_APP_DEFAULTS_INVALID", f"{name} must be page:<id>", f"{epath}.{name}"))
                                        continue
                                    if parsed[1] not in page_ids:
                                        errors.append(_issue("MANIFEST_TARGET_UNKNOWN", f"{name} page not found", f"{epath}.{name}"))

            nav = _get(app_def, "nav", [])
            if nav is not None and not isinstance(nav, list):
                errors.append(_issue("MANIFEST_APP_NAV_INVALID", "app.nav must be a list", "app.nav"))
                nav = []
            if isinstance(nav, list):
                for gidx, group in enumerate(nav):
                    gpath = f"app.nav[{gidx}]"
                    if not isinstance(group, dict):
                        errors.append(_issue("MANIFEST_APP_NAV_INVALID", "nav group must be an object", gpath))
                        continue
                    _reject_unknown_keys(errors, group, ALLOWED_V1_NAV_GROUP_KEYS, gpath)
                    items = _get(group, "items", [])
                    if not isinstance(items, list):
                        errors.append(_issue("MANIFEST_APP_NAV_INVALID", "nav group items must be a list", f"{gpath}.items"))
                        continue
                    for iidx, item in enumerate(items):
                        ipath = f"{gpath}.items[{iidx}]"
                        if not isinstance(item, dict):
                            errors.append(_issue("MANIFEST_APP_NAV_INVALID", "nav item must be an object", ipath))
                            continue
                        _reject_unknown_keys(errors, item, ALLOWED_V1_NAV_ITEM_KEYS, ipath)
                        label = _get(item, "label")
                        if not isinstance(label, str) or not label:
                            errors.append(_issue("MANIFEST_APP_NAV_INVALID", "nav item label is required", f"{ipath}.label"))
                        target = _get(item, "to")
                        parsed = _parse_target(target) if isinstance(target, str) else None
                        if not parsed:
                            errors.append(_issue("MANIFEST_TARGET_INVALID", "nav item target must be page:<id> or view:<id>", f"{ipath}.to"))

        if pages is not None and not isinstance(pages, list):
            errors.append(_issue("MANIFEST_PAGES_INVALID", "pages must be a list", "pages"))
            pages = []

        page_by_id: dict[str, dict] = {}
        if isinstance(pages, list):
            for pidx, page in enumerate(pages):
                ppath = f"pages[{pidx}]"
                if not isinstance(page, dict):
                    errors.append(_issue("MANIFEST_PAGE_INVALID", "page must be an object", ppath))
                    continue
                _reject_unknown_keys(errors, page, ALLOWED_V1_PAGE_KEYS, ppath)
                page_id = _get(page, "id")
                if not isinstance(page_id, str) or not page_id:
                    errors.append(_issue("MANIFEST_PAGE_ID_INVALID", "page.id is required", f"{ppath}.id"))
                    continue
                page_by_id[page_id] = page
                layout = _get(page, "layout")
                if layout is not None and layout != "single":
                    errors.append(_issue("MANIFEST_PAGE_LAYOUT_INVALID", "page.layout must be 'single' when provided", f"{ppath}.layout"))
                header = _get(page, "header")
                if header is not None:
                    if not isinstance(header, dict):
                        errors.append(_issue("MANIFEST_PAGE_HEADER_INVALID", "page.header must be an object", f"{ppath}.header"))
                    else:
                        _reject_unknown_keys(errors, header, ALLOWED_V1_PAGE_HEADER_KEYS, f"{ppath}.header")
                        variant = _get(header, "variant")
                        if variant is not None and variant not in ("default", "none"):
                            errors.append(_issue("MANIFEST_PAGE_HEADER_INVALID", "page.header.variant must be default|none", f"{ppath}.header.variant"))
                        actions = _get(header, "actions", [])
                        if actions is not None and not isinstance(actions, list):
                            errors.append(_issue("MANIFEST_PAGE_ACTIONS_INVALID", "page.header.actions must be a list", f"{ppath}.header.actions"))
                        elif isinstance(actions, list):
                            for aidx, action in enumerate(actions):
                                apath = f"{ppath}.header.actions[{aidx}]"
                                if not isinstance(action, dict):
                                    errors.append(_issue("MANIFEST_PAGE_ACTION_INVALID", "action must be an object", apath))
                                    continue
                                _reject_unknown_keys(errors, action, ALLOWED_V1_PAGE_ACTION_KEYS, apath)
                                action_ref = _get(action, "action_id")
                                if action_ref is not None:
                                    if not is_v12:
                                        errors.append(_issue("MANIFEST_PAGE_ACTION_INVALID", "action_id requires manifest_version >= 1.2", f"{apath}.action_id"))
                                    elif not isinstance(action_ref, str) or action_ref not in action_by_id:
                                        errors.append(_issue("MANIFEST_PAGE_ACTION_INVALID", "action_id not found", f"{apath}.action_id"))
                                kind = _get(action, "kind")
                                if kind is not None:
                                    if not is_v12 and kind not in {"navigate", "open_form", "refresh"}:
                                        errors.append(_issue("MANIFEST_PAGE_ACTION_INVALID", "action.kind requires manifest_version >= 1.2", f"{apath}.kind"))
                                    if kind not in ALLOWED_V1_ACTION_KINDS:
                                        errors.append(_issue("MANIFEST_PAGE_ACTION_INVALID", "action.kind must be allowlisted", f"{apath}.kind"))
                                    target = _get(action, "target")
                                    if kind == "navigate":
                                        parsed = _parse_target(target) if isinstance(target, str) else None
                                        if not parsed:
                                            errors.append(_issue("MANIFEST_TARGET_INVALID", "navigate target must be page:<id> or view:<id>", f"{apath}.target"))
                                    if kind == "open_form":
                                        if not isinstance(target, str) or target.startswith("page:") or target.startswith("view:"):
                                            errors.append(_issue("MANIFEST_PAGE_ACTION_INVALID", "open_form target must be a view id", f"{apath}.target"))
                                    if kind == "refresh" and target is not None:
                                        errors.append(_issue("MANIFEST_PAGE_ACTION_INVALID", "refresh must not include target", f"{apath}.target"))
                                visible_when = _get(action, "visible_when")
                                if visible_when is not None:
                                    if not is_v12:
                                        errors.append(_issue("MANIFEST_PAGE_ACTION_INVALID", "visible_when requires manifest_version >= 1.2", f"{apath}.visible_when"))
                                    else:
                                        _validate_condition(visible_when, f"{apath}.visible_when", errors)
                                enabled_when = _get(action, "enabled_when")
                                if enabled_when is not None:
                                    if not is_v12:
                                        errors.append(_issue("MANIFEST_PAGE_ACTION_INVALID", "enabled_when requires manifest_version >= 1.2", f"{apath}.enabled_when"))
                                    else:
                                        _validate_condition(enabled_when, f"{apath}.enabled_when", errors)

                content = _get(page, "content", [])
                _validate_blocks(content, f"{ppath}.content", view_ids, entity_by_id, action_by_id, errors, allow_layout=is_v11, allow_chatter=is_v12, allow_v13=is_v13, record_entity=None)

        if app_def is not None:
            home = _get(app_def, "home")
            if isinstance(home, str):
                parsed = _parse_target(home)
                if parsed:
                    kind, ident = parsed
                    if kind == "page" and ident not in page_by_id:
                        errors.append(_issue("MANIFEST_TARGET_UNKNOWN", "app.home page not found", "app.home"))
                    if kind == "view" and ident not in view_ids:
                        errors.append(_issue("MANIFEST_TARGET_UNKNOWN", "app.home view not found", "app.home"))

            nav = _get(app_def, "nav", [])
            if isinstance(nav, list):
                for gidx, group in enumerate(nav):
                    if not isinstance(group, dict):
                        continue
                    items = _get(group, "items", [])
                    if not isinstance(items, list):
                        continue
                    for iidx, item in enumerate(items):
                        target = _get(item, "to")
                        parsed = _parse_target(target) if isinstance(target, str) else None
                        if not parsed:
                            continue
                        kind, ident = parsed
                        if kind == "page" and ident not in page_by_id:
                            errors.append(_issue("MANIFEST_TARGET_UNKNOWN", "nav target page not found", f"app.nav[{gidx}].items[{iidx}].to"))
                        if kind == "view" and ident not in view_ids:
                            errors.append(_issue("MANIFEST_TARGET_UNKNOWN", "nav target view not found", f"app.nav[{gidx}].items[{iidx}].to"))

        if isinstance(pages, list):
            for pidx, page in enumerate(pages):
                if not isinstance(page, dict):
                    continue
                header = _get(page, "header")
                if isinstance(header, dict):
                    actions = _get(header, "actions", [])
                    if isinstance(actions, list):
                        for aidx, action in enumerate(actions):
                            if not isinstance(action, dict):
                                continue
                            action_ref = _get(action, "action_id")
                            resolved = action_by_id.get(action_ref) if isinstance(action_ref, str) else None
                            kind = _get(resolved, "kind") if resolved else _get(action, "kind")
                            target = _get(resolved, "target") if resolved and _get(resolved, "target") is not None else _get(action, "target")
                            if kind == "navigate":
                                parsed = _parse_target(target) if isinstance(target, str) else None
                                if parsed:
                                    kind_name, ident = parsed
                                    if kind_name == "page" and ident not in page_by_id:
                                        errors.append(_issue("MANIFEST_TARGET_UNKNOWN", "navigate target page not found", f"pages[{pidx}].header.actions[{aidx}].target"))
                                    if kind_name == "view" and ident not in view_ids:
                                        errors.append(_issue("MANIFEST_TARGET_UNKNOWN", "navigate target view not found", f"pages[{pidx}].header.actions[{aidx}].target"))
                            if kind == "open_form":
                                if isinstance(target, str) and target not in view_ids:
                                    errors.append(_issue("MANIFEST_TARGET_UNKNOWN", "open_form target view not found", f"pages[{pidx}].header.actions[{aidx}].target"))

    return errors, warnings


def validate_manifest_raw(raw: dict, expected_module_id: str | None = None) -> tuple[dict, list[Issue], list[Issue]]:
    normalized = normalize_manifest(raw)
    errors, warnings = validate_manifest(normalized, expected_module_id=expected_module_id)
    return normalized, errors, warnings
