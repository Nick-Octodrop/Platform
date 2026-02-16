"""Patch preview validation and dry-run simulation (preview mode only)."""

from __future__ import annotations

import copy
from typing import Any, Dict, List, Tuple

from octo.manifest_hash import manifest_hash
from octo.selector_path import (
    PointerResolveError,
    SelectorNotFound,
    SelectorNotUnique,
    SelectorPathError,
    SelectorTypeError,
    resolve_selector_path,
)


Issue = Dict[str, Any]
Rfc6902Op = Dict[str, Any]
DiffSummary = Dict[str, Any]


_ALLOWED_OPS = {"add", "remove", "replace", "move", "copy", "test", "add_field"}


def _issue(
    code: str,
    message: str,
    op_index: int | None = None,
    path: str | None = None,
    resolved_path: str | None = None,
) -> Issue:
    return {
        "code": code,
        "message": message,
        "op_index": op_index,
        "path": path,
        "resolved_path": resolved_path,
    }


def _decode_segment(segment: str) -> str:
    return segment.replace("~1", "/").replace("~0", "~")


def _parse_pointer(pointer: str) -> List[str]:
    if pointer == "":
        return []
    segments = pointer.split("/")
    if segments and segments[0] == "":
        segments = segments[1:]
    return [_decode_segment(seg) for seg in segments]


def _contains_numeric_segment(path: str) -> bool:
    if path == "":
        return False
    segments = path.split("/")
    if segments and segments[0] == "":
        segments = segments[1:]
    for seg in segments:
        if seg.startswith("@[id=") and seg.endswith("]"):
            continue
        if _decode_segment(seg).isdigit():
            return True
    return False


def _resolve_path(
    doc: Any, raw_path: str, op_index: int, errors: List[Issue]
) -> str | None:
    if "@[id=" not in raw_path:
        return raw_path
    try:
        return resolve_selector_path(doc, raw_path)
    except SelectorNotFound as exc:
        errors.append(
            _issue(
                "SELECTOR_NOT_FOUND",
                str(exc),
                op_index=op_index,
                path=raw_path,
                resolved_path=exc.pointer_so_far,
            )
        )
    except SelectorNotUnique as exc:
        errors.append(
            _issue(
                "SELECTOR_NOT_UNIQUE",
                str(exc),
                op_index=op_index,
                path=raw_path,
                resolved_path=exc.pointer_so_far,
            )
        )
    except SelectorTypeError as exc:
        errors.append(
            _issue(
                "SELECTOR_TYPE_ERROR",
                str(exc),
                op_index=op_index,
                path=raw_path,
                resolved_path=exc.pointer_so_far,
            )
        )
    except PointerResolveError as exc:
        errors.append(
            _issue(
                "POINTER_RESOLVE_ERROR",
                str(exc),
                op_index=op_index,
                path=raw_path,
                resolved_path=exc.pointer_so_far,
            )
        )
    except SelectorPathError as exc:
        errors.append(
            _issue(
                "SELECTOR_PATH_ERROR",
                str(exc),
                op_index=op_index,
                path=raw_path,
                resolved_path=exc.pointer_so_far,
            )
        )
    return None


def _get_container_and_token(doc: Any, pointer: str) -> Tuple[Any, str]:
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


def _apply_test(doc: Any, path: str, value: Any) -> None:
    existing = _get_value(doc, path)
    if existing != value:
        raise ValueError("Test operation failed")


def _apply_move(doc: Any, from_path: str, path: str) -> None:
    value = _get_value(doc, from_path)
    _apply_remove(doc, from_path)
    _apply_add(doc, path, value)


def _apply_copy(doc: Any, from_path: str, path: str) -> None:
    value = copy.deepcopy(_get_value(doc, from_path))
    _apply_add(doc, path, value)


def _expand_add_field(
    manifest: Any, op: Dict[str, Any], op_index: int, errors: List[Issue]
) -> List[Rfc6902Op]:
    entity_id = op.get("entity_id")
    after_field_id = op.get("after_field_id")
    field = op.get("field")

    if not isinstance(entity_id, str) or not isinstance(after_field_id, str) or field is None:
        errors.append(
            _issue(
                "ADD_FIELD_INVALID",
                "add_field requires entity_id (str), after_field_id (str), and field",
                op_index=op_index,
            )
        )
        return []

    fields_selector = f"/entities/@[id={entity_id}]/fields"
    resolved_fields_path = _resolve_path(manifest, fields_selector, op_index, errors)
    if resolved_fields_path is None:
        return []

    after_selector = (
        f"/entities/@[id={entity_id}]/fields/@[id={after_field_id}]"
    )
    resolved_after_path = _resolve_path(manifest, after_selector, op_index, errors)
    if resolved_after_path is None:
        return []

    try:
        fields_list = _get_value(manifest, resolved_fields_path)
    except Exception as exc:  # pragma: no cover - defensive
        errors.append(
            _issue(
                "ADD_FIELD_INVALID",
                f"Cannot access fields list: {exc}",
                op_index=op_index,
                path=fields_selector,
                resolved_path=resolved_fields_path,
            )
        )
        return []

    if not isinstance(fields_list, list):
        errors.append(
            _issue(
                "ADD_FIELD_INVALID",
                "Fields target is not a list",
                op_index=op_index,
                path=fields_selector,
                resolved_path=resolved_fields_path,
            )
        )
        return []

    tokens = _parse_pointer(resolved_after_path)
    if not tokens or not tokens[-1].isdigit():
        errors.append(
            _issue(
                "ADD_FIELD_INVALID",
                "after_field_id did not resolve to an index",
                op_index=op_index,
                path=after_selector,
                resolved_path=resolved_after_path,
            )
        )
        return []

    insert_index = int(tokens[-1]) + 1
    resolved_insert_path = f"{resolved_fields_path}/{insert_index}"

    return [{"op": "add", "path": resolved_insert_path, "value": field}]


def _is_protected_path(pointer: str) -> bool:
    return pointer.startswith("/module/id") or pointer.startswith("/module/requires")


def _diff_summary(ops: List[Rfc6902Op]) -> DiffSummary:
    counts = {"add": 0, "remove": 0, "replace": 0, "move": 0, "copy": 0, "test": 0}
    touched = set()
    for op in ops:
        op_name = op["op"]
        if op_name in counts:
            counts[op_name] += 1
        if "path" in op:
            touched.add(op["path"])
        if op_name in {"move", "copy"} and "from" in op:
            touched.add(op["from"])
    return {"touched": sorted(touched), "counts": counts}


def _classify_impact(ops: List[Rfc6902Op]) -> str | None:
    for op in ops:
        if op["op"] == "remove":
            return "high"
        if op["op"] == "replace" and "/id" in op.get("path", ""):
            return "high"
    for op in ops:
        if op["op"] == "add":
            return "medium"
    if ops:
        return "low"
    return None


def preview_patch(manifest: Any, patch: Any) -> Dict[str, Any]:
    errors: List[Issue] = []
    warnings: List[Issue] = []
    resolved_ops: List[Rfc6902Op] = []

    if not isinstance(patch, dict):
        errors.append(
            _issue("PATCH_NOT_OBJECT", "Patch must be a JSON object")
        )
        return {
            "ok": False,
            "errors": errors,
            "warnings": warnings,
            "impact": None,
            "resolved_ops": [],
            "diff_summary": _diff_summary([]),
        }

    required_fields = [
        "patch_id",
        "target_module_id",
        "target_manifest_hash",
        "mode",
        "reason",
        "operations",
    ]
    for field in required_fields:
        if field not in patch:
            errors.append(
                _issue(
                    "PATCH_MISSING_FIELD",
                    f"Missing required field: {field}",
                )
            )

    if errors:
        return {
            "ok": False,
            "errors": errors,
            "warnings": warnings,
            "impact": None,
            "resolved_ops": [],
            "diff_summary": _diff_summary([]),
        }

    if patch.get("mode") != "preview":
        errors.append(
            _issue("PATCH_MODE_NOT_PREVIEW", "mode must be 'preview'")
        )
        return {
            "ok": False,
            "errors": errors,
            "warnings": warnings,
            "impact": None,
            "resolved_ops": [],
            "diff_summary": _diff_summary([]),
        }

    operations = patch.get("operations")
    if not isinstance(operations, list):
        errors.append(
            _issue("PATCH_OPS_NOT_LIST", "operations must be a list")
        )
        return {
            "ok": False,
            "errors": errors,
            "warnings": warnings,
            "impact": None,
            "resolved_ops": [],
            "diff_summary": _diff_summary([]),
        }

    current_hash = manifest_hash(manifest)
    if patch.get("target_manifest_hash") != current_hash:
        errors.append(
            _issue(
                "PATCH_HASH_MISMATCH",
                "target_manifest_hash does not match current manifest",
            )
        )
        return {
            "ok": False,
            "errors": errors,
            "warnings": warnings,
            "impact": None,
            "resolved_ops": [],
            "diff_summary": _diff_summary([]),
        }

    for idx, op in enumerate(operations):
        if not isinstance(op, dict):
            errors.append(
                _issue(
                    "OP_NOT_OBJECT",
                    "Operation must be an object",
                    op_index=idx,
                )
            )
            continue

        op_name = op.get("op")
        if op_name not in _ALLOWED_OPS:
            errors.append(
                _issue(
                    "OP_UNSUPPORTED",
                    f"Unsupported op: {op_name}",
                    op_index=idx,
                )
            )
            continue

        if op_name == "add_field":
            resolved_ops.extend(_expand_add_field(manifest, op, idx, errors))
            continue

        path = op.get("path")
        from_path = op.get("from")

        if op_name in {"add", "replace", "test"}:
            if path is None or "value" not in op:
                errors.append(
                    _issue(
                        "OP_MISSING_FIELD",
                        "op requires path and value",
                        op_index=idx,
                    )
                )
                continue
        if op_name == "remove":
            if path is None:
                errors.append(
                    _issue(
                        "OP_MISSING_FIELD",
                        "op requires path",
                        op_index=idx,
                    )
                )
                continue
        if op_name in {"move", "copy"}:
            if path is None or from_path is None:
                errors.append(
                    _issue(
                        "OP_MISSING_FIELD",
                        "op requires path and from",
                        op_index=idx,
                    )
                )
                continue

        if isinstance(path, str) and _contains_numeric_segment(path):
            errors.append(
                _issue(
                    "OP_NUMERIC_INDEX_PATH",
                    "Numeric index segments are not allowed in incoming paths",
                    op_index=idx,
                    path=path,
                )
            )
            continue
        if isinstance(from_path, str) and _contains_numeric_segment(from_path):
            errors.append(
                _issue(
                    "OP_NUMERIC_INDEX_PATH",
                    "Numeric index segments are not allowed in incoming from paths",
                    op_index=idx,
                    path=from_path,
                )
            )
            continue

        resolved_path = None
        resolved_from = None
        if isinstance(path, str):
            resolved_path = _resolve_path(manifest, path, idx, errors)
        if op_name in {"move", "copy"} and isinstance(from_path, str):
            resolved_from = _resolve_path(manifest, from_path, idx, errors)

        if (path is not None and resolved_path is None) or (
            op_name in {"move", "copy"} and from_path is not None and resolved_from is None
        ):
            continue

        if resolved_path and _is_protected_path(resolved_path):
            errors.append(
                _issue(
                    "PROTECTED_PATH",
                    "Operation targets protected path",
                    op_index=idx,
                    path=path,
                    resolved_path=resolved_path,
                )
            )
            continue
        if resolved_from and _is_protected_path(resolved_from):
            errors.append(
                _issue(
                    "PROTECTED_PATH",
                    "Operation sources protected path",
                    op_index=idx,
                    path=from_path,
                    resolved_path=resolved_from,
                )
            )
            continue

        normalized: Rfc6902Op = {"op": op_name}
        if op_name in {"add", "replace", "test"}:
            normalized.update({"path": resolved_path, "value": op["value"]})
        elif op_name == "remove":
            normalized.update({"path": resolved_path})
        elif op_name in {"move", "copy"}:
            normalized.update({"from": resolved_from, "path": resolved_path})

        resolved_ops.append(normalized)

    if errors:
        return {
            "ok": False,
            "errors": errors,
            "warnings": warnings,
            "impact": None,
            "resolved_ops": resolved_ops,
            "diff_summary": _diff_summary(resolved_ops),
        }

    simulated = copy.deepcopy(manifest)
    for idx, op in enumerate(resolved_ops):
        try:
            if op["op"] == "add":
                _apply_add(simulated, op["path"], op["value"])
            elif op["op"] == "remove":
                _apply_remove(simulated, op["path"])
            elif op["op"] == "replace":
                _apply_replace(simulated, op["path"], op["value"])
            elif op["op"] == "test":
                _apply_test(simulated, op["path"], op["value"])
            elif op["op"] == "move":
                _apply_move(simulated, op["from"], op["path"])
            elif op["op"] == "copy":
                _apply_copy(simulated, op["from"], op["path"])
        except Exception as exc:
            errors.append(
                _issue(
                    "SIMULATION_ERROR",
                    f"Simulation failed: {exc}",
                    op_index=idx,
                    path=op.get("path"),
                    resolved_path=op.get("path"),
                )
            )

    ok = not errors
    return {
        "ok": ok,
        "errors": errors,
        "warnings": warnings,
        "impact": _classify_impact(resolved_ops) if ok else None,
        "resolved_ops": resolved_ops,
        "diff_summary": _diff_summary(resolved_ops),
    }
