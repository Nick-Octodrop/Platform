"""Module dependency helpers for manifest validation and install-time resolution."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple


Issue = Dict[str, Any]

_MODULE_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")
_SEMVER_RE = re.compile(r"^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(?:[-+][0-9A-Za-z.-]+)?$")
_CONSTRAINT_TERM_RE = re.compile(r"^(>=|<=|>|<|==|=)\s*(.+)$")


def _issue(code: str, message: str, path: str | None = None, detail: dict | None = None) -> Issue:
    return {"code": code, "message": message, "path": path, "detail": detail}


def _normalize_module_id(module_id: Any) -> str | None:
    if not isinstance(module_id, str):
        return None
    value = module_id.strip()
    if not value:
        return None
    return value


def _parse_semver(value: Any) -> tuple[int, int, int] | None:
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    match = _SEMVER_RE.match(raw)
    if not match:
        return None
    major = int(match.group(1))
    minor = int(match.group(2) or 0)
    patch = int(match.group(3) or 0)
    return (major, minor, patch)


def _compare_versions(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    if a < b:
        return -1
    if a > b:
        return 1
    return 0


def _parse_constraint_terms(constraint: str) -> list[tuple[str, tuple[int, int, int]]] | None:
    terms: list[tuple[str, tuple[int, int, int]]] = []
    for part in [p.strip() for p in constraint.split(",") if p.strip()]:
        match = _CONSTRAINT_TERM_RE.match(part)
        if not match:
            return None
        op = match.group(1)
        ver = _parse_semver(match.group(2))
        if ver is None:
            return None
        terms.append((op, ver))
    return terms or None


def version_satisfies_constraint(version: Any, constraint: Any) -> bool:
    if constraint is None:
        return True
    if not isinstance(constraint, str) or not constraint.strip():
        return False
    parsed_version = _parse_semver(version)
    if parsed_version is None:
        return False
    terms = _parse_constraint_terms(constraint.strip())
    if terms is None:
        return False
    for op, rhs in terms:
        cmp_val = _compare_versions(parsed_version, rhs)
        ok = (
            (op in {"=", "=="} and cmp_val == 0)
            or (op == ">" and cmp_val > 0)
            or (op == "<" and cmp_val < 0)
            or (op == ">=" and cmp_val >= 0)
            or (op == "<=" and cmp_val <= 0)
        )
        if not ok:
            return False
    return True


def _manifest_depends_on(manifest: dict) -> dict | None:
    if not isinstance(manifest, dict):
        return None
    depends_on = manifest.get("depends_on")
    return depends_on if isinstance(depends_on, dict) else None


def normalize_depends_on(manifest: dict) -> dict:
    depends_on = _manifest_depends_on(manifest) or {}
    required = depends_on.get("required")
    optional = depends_on.get("optional")
    out_required: list[dict] = []
    out_optional: list[dict] = []
    if isinstance(required, list):
        for item in required:
            if not isinstance(item, dict):
                continue
            dep_module = _normalize_module_id(item.get("module"))
            if not dep_module:
                continue
            out_required.append({"module": dep_module, "version": item.get("version") if isinstance(item.get("version"), str) else None})
    if isinstance(optional, list):
        for item in optional:
            if not isinstance(item, dict):
                continue
            dep_module = _normalize_module_id(item.get("module"))
            if not dep_module:
                continue
            out_optional.append({"module": dep_module, "version": item.get("version") if isinstance(item.get("version"), str) else None})
    return {"required": out_required, "optional": out_optional}


def validate_depends_on_shape(manifest: dict, module_id: str | None) -> list[Issue]:
    errors: list[Issue] = []
    depends_on = manifest.get("depends_on")
    if depends_on is None:
        return errors
    if not isinstance(depends_on, dict):
        errors.append(_issue("MANIFEST_DEPENDS_ON_INVALID", "depends_on must be an object", "depends_on"))
        return errors

    allowed_top = {"required", "optional"}
    for key in depends_on.keys():
        if key not in allowed_top:
            errors.append(_issue("MANIFEST_UNKNOWN_KEY", f"Unknown key: {key}", f"depends_on.{key}"))

    declared: dict[str, str] = {}

    def _validate_list(name: str) -> None:
        items = depends_on.get(name)
        if items is None:
            return
        if not isinstance(items, list):
            errors.append(_issue("MANIFEST_DEPENDS_ON_INVALID", f"depends_on.{name} must be a list", f"depends_on.{name}"))
            return
        for idx, item in enumerate(items):
            path = f"depends_on.{name}[{idx}]"
            if not isinstance(item, dict):
                errors.append(_issue("MANIFEST_DEPENDS_ON_INVALID", "dependency item must be an object", path))
                continue
            allowed_item = {"module", "version"}
            for key in item.keys():
                if key not in allowed_item:
                    errors.append(_issue("MANIFEST_UNKNOWN_KEY", f"Unknown key: {key}", f"{path}.{key}"))
            dep_module = _normalize_module_id(item.get("module"))
            if dep_module is None:
                errors.append(_issue("MANIFEST_DEPENDS_ON_INVALID", "dependency.module is required", f"{path}.module"))
                continue
            if not _MODULE_ID_RE.match(dep_module):
                errors.append(_issue("MANIFEST_DEPENDS_ON_INVALID", "dependency.module contains invalid characters", f"{path}.module"))
            if module_id and dep_module == module_id:
                errors.append(_issue("MANIFEST_DEPENDS_ON_SELF", "module cannot depend on itself", f"{path}.module"))
            prev = declared.get(dep_module)
            if prev:
                errors.append(
                    _issue(
                        "MANIFEST_DEPENDS_ON_DUPLICATE",
                        "duplicate dependency.module declaration",
                        f"{path}.module",
                        {"module": dep_module, "first_seen_in": prev},
                    )
                )
            else:
                declared[dep_module] = f"depends_on.{name}"
            version = item.get("version")
            if version is not None:
                if not isinstance(version, str) or not version.strip():
                    errors.append(_issue("MANIFEST_DEPENDS_ON_INVALID", "dependency.version must be a non-empty string", f"{path}.version"))
                elif _parse_constraint_terms(version.strip()) is None:
                    errors.append(_issue("MANIFEST_DEPENDS_ON_INVALID_VERSION", "dependency.version must be a valid semver constraint", f"{path}.version"))

    _validate_list("required")
    _validate_list("optional")
    return errors


def dependency_edges(manifest: dict) -> list[str]:
    deps = normalize_depends_on(manifest)
    required = deps.get("required") or []
    out: list[str] = []
    for item in required:
        dep_module = item.get("module")
        if isinstance(dep_module, str) and dep_module not in out:
            out.append(dep_module)
    return out


def build_dependency_graph(manifests_by_module: dict[str, dict], module_ids: list[str] | None = None) -> dict[str, list[str]]:
    selected = sorted(set(module_ids or manifests_by_module.keys()))
    graph: dict[str, list[str]] = {}
    present = set(manifests_by_module.keys())
    for module_id in selected:
        manifest = manifests_by_module.get(module_id) or {}
        deps = []
        for dep in dependency_edges(manifest):
            if dep in present:
                deps.append(dep)
        graph[module_id] = sorted(set(deps))
    return graph


def find_cycle(graph: dict[str, list[str]]) -> list[str] | None:
    visited: set[str] = set()
    visiting: set[str] = set()
    stack: list[str] = []

    def _dfs(node: str) -> list[str] | None:
        visited.add(node)
        visiting.add(node)
        stack.append(node)
        for dep in graph.get(node, []):
            if dep not in visited:
                cycle = _dfs(dep)
                if cycle:
                    return cycle
            elif dep in visiting:
                try:
                    start = stack.index(dep)
                except ValueError:
                    start = 0
                return stack[start:] + [dep]
        stack.pop()
        visiting.remove(node)
        return None

    for node in sorted(graph.keys()):
        if node not in visited:
            cycle = _dfs(node)
            if cycle:
                return cycle
    return None


def topological_install_order(graph: dict[str, list[str]]) -> list[str]:
    indegree: dict[str, int] = {node: 0 for node in graph.keys()}
    dependents: dict[str, list[str]] = {node: [] for node in graph.keys()}
    for node, deps in graph.items():
        for dep in deps:
            if dep not in indegree:
                indegree[dep] = 0
                dependents[dep] = []
            indegree[node] += 1
            dependents[dep].append(node)
    ready = sorted([node for node, degree in indegree.items() if degree == 0])
    out: list[str] = []
    while ready:
        node = ready.pop(0)
        out.append(node)
        for dep in sorted(dependents.get(node, [])):
            indegree[dep] -= 1
            if indegree[dep] == 0:
                ready.append(dep)
                ready.sort()
    if len(out) != len(indegree):
        return []
    return [node for node in out if node in graph]


def build_reverse_dependents(graph: dict[str, list[str]]) -> dict[str, list[str]]:
    reverse: dict[str, list[str]] = {node: [] for node in graph.keys()}
    for module_id, deps in graph.items():
        for dep in deps:
            reverse.setdefault(dep, [])
            reverse[dep].append(module_id)
    for key in list(reverse.keys()):
        reverse[key] = sorted(set(reverse[key]))
    return reverse


def validate_required_dependencies(
    module_id: str,
    manifest: dict,
    available_versions: dict[str, str | None],
    available_enabled: dict[str, bool] | None = None,
    require_enabled: bool = False,
) -> list[Issue]:
    errors: list[Issue] = []
    deps = normalize_depends_on(manifest).get("required") or []
    for idx, dep in enumerate(deps):
        dep_module = dep.get("module")
        if not isinstance(dep_module, str):
            continue
        if dep_module not in available_versions:
            errors.append(
                _issue(
                    "MODULE_DEPENDENCY_MISSING",
                    "required dependency is not installed",
                    f"depends_on.required[{idx}].module",
                    {"module": dep_module, "required_by": module_id},
                )
            )
            continue
        if require_enabled and available_enabled is not None and not bool(available_enabled.get(dep_module)):
            errors.append(
                _issue(
                    "MODULE_DEPENDENCY_DISABLED",
                    "required dependency is installed but disabled",
                    f"depends_on.required[{idx}].module",
                    {"module": dep_module, "required_by": module_id},
                )
            )
        constraint = dep.get("version")
        if isinstance(constraint, str) and constraint.strip():
            actual = available_versions.get(dep_module)
            if not version_satisfies_constraint(actual, constraint):
                errors.append(
                    _issue(
                        "MODULE_DEPENDENCY_VERSION_MISMATCH",
                        "required dependency version does not satisfy constraint",
                        f"depends_on.required[{idx}].version",
                        {
                            "module": dep_module,
                            "required_by": module_id,
                            "constraint": constraint,
                            "actual_version": actual,
                        },
                    )
                )
    return errors


def module_version_from_manifest(manifest: dict) -> str | None:
    if not isinstance(manifest, dict):
        return None
    module = manifest.get("module")
    if not isinstance(module, dict):
        return None
    version = module.get("version")
    if isinstance(version, str) and version.strip():
        return version.strip()
    return None


def module_key_from_manifest(manifest: dict) -> str | None:
    if not isinstance(manifest, dict):
        return None
    module = manifest.get("module")
    if not isinstance(module, dict):
        return None
    # vNext: stable key separate from runtime module.id.
    key = module.get("key")
    if isinstance(key, str) and key.strip():
        return key.strip()
    module_id = module.get("id")
    if isinstance(module_id, str) and module_id.strip():
        return module_id.strip()
    return None


def _normalize_entity_id(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    eid = value.strip()
    return eid if eid.startswith("entity.") else f"entity.{eid}"


def collect_external_entity_references(manifest: dict) -> list[dict]:
    if not isinstance(manifest, dict):
        return []
    refs: list[dict] = []
    entities = manifest.get("entities")
    if isinstance(entities, list):
        for eidx, entity in enumerate(entities):
            fields = entity.get("fields") if isinstance(entity, dict) else None
            if not isinstance(fields, list):
                continue
            for fidx, field in enumerate(fields):
                if not isinstance(field, dict) or field.get("type") != "lookup":
                    continue
                target = _normalize_entity_id(field.get("entity"))
                if target:
                    refs.append({"entity_id": target, "path": f"entities[{eidx}].fields[{fidx}].entity"})
    transformations = manifest.get("transformations")
    if isinstance(transformations, list):
        for tidx, transformation in enumerate(transformations):
            if not isinstance(transformation, dict):
                continue
            for key in ("source_entity_id", "target_entity_id"):
                target = _normalize_entity_id(transformation.get(key))
                if target:
                    refs.append({"entity_id": target, "path": f"transformations[{tidx}].{key}"})
            child_mappings = transformation.get("child_mappings")
            if isinstance(child_mappings, list):
                for cidx, child in enumerate(child_mappings):
                    if not isinstance(child, dict):
                        continue
                    for key in ("source_entity_id", "target_entity_id"):
                        target = _normalize_entity_id(child.get(key))
                        if target:
                            refs.append({"entity_id": target, "path": f"transformations[{tidx}].child_mappings[{cidx}].{key}"})
    interfaces = manifest.get("interfaces")
    if isinstance(interfaces, dict):
        for key in ("schedulable", "documentable", "dashboardable"):
            items = interfaces.get(key)
            if not isinstance(items, list):
                continue
            for idx, item in enumerate(items):
                if not isinstance(item, dict):
                    continue
                target = _normalize_entity_id(item.get("entity_id"))
                if target:
                    refs.append({"entity_id": target, "path": f"interfaces.{key}[{idx}].entity_id"})
    seen: set[tuple[str, str]] = set()
    unique: list[dict] = []
    for ref in refs:
        marker = (ref["entity_id"], ref["path"])
        if marker in seen:
            continue
        seen.add(marker)
        unique.append(ref)
    return unique
