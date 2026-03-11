import os
import sys
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

from app.module_dependencies import (
    build_dependency_graph,
    build_reverse_dependents,
    find_cycle,
    module_key_from_manifest,
    normalize_depends_on,
    topological_install_order,
    validate_depends_on_shape,
    validate_required_dependencies,
)


def _manifest(module_id: str, version: str = "1.0.0", depends_on: dict | None = None) -> dict:
    payload = {
        "manifest_version": "1.3",
        "module": {"id": module_id, "name": module_id, "version": version},
        "entities": [{"id": f"entity.{module_id}", "fields": [{"id": f"{module_id}.name", "type": "string"}]}],
        "views": [{"id": f"{module_id}.list", "entity": f"entity.{module_id}", "kind": "list", "columns": [{"field_id": f"{module_id}.name"}]}],
    }
    if depends_on is not None:
        payload["depends_on"] = depends_on
    return payload


class TestModuleDependencies(unittest.TestCase):
    def test_valid_required_dependency(self):
        manifest = _manifest("sales", depends_on={"required": [{"module": "contacts", "version": ">=1.0.0"}]})
        shape_errors = validate_depends_on_shape(manifest, "sales")
        self.assertEqual(shape_errors, [])
        dep_errors = validate_required_dependencies(
            "sales",
            manifest,
            available_versions={"contacts": "1.2.0"},
            available_enabled={"contacts": True},
            require_enabled=True,
        )
        self.assertEqual(dep_errors, [])

    def test_valid_optional_dependency(self):
        manifest = _manifest("sales", depends_on={"optional": [{"module": "crm", "version": ">=1.0.0"}]})
        shape_errors = validate_depends_on_shape(manifest, "sales")
        self.assertEqual(shape_errors, [])
        dep_errors = validate_required_dependencies("sales", manifest, available_versions={}, available_enabled={}, require_enabled=True)
        self.assertEqual(dep_errors, [])
        normalized = normalize_depends_on(manifest)
        self.assertEqual(len(normalized["optional"]), 1)

    def test_missing_required_dependency(self):
        manifest = _manifest("sales", depends_on={"required": [{"module": "contacts", "version": ">=1.0.0"}]})
        dep_errors = validate_required_dependencies("sales", manifest, available_versions={}, available_enabled={}, require_enabled=False)
        self.assertTrue(any(err["code"] == "MODULE_DEPENDENCY_MISSING" for err in dep_errors))

    def test_duplicate_dependency(self):
        manifest = _manifest(
            "sales",
            depends_on={
                "required": [{"module": "contacts"}, {"module": "contacts"}],
                "optional": [{"module": "crm"}, {"module": "contacts"}],
            },
        )
        shape_errors = validate_depends_on_shape(manifest, "sales")
        self.assertTrue(any(err["code"] == "MANIFEST_DEPENDS_ON_DUPLICATE" for err in shape_errors))

    def test_self_dependency(self):
        manifest = _manifest("sales", depends_on={"required": [{"module": "sales"}]})
        shape_errors = validate_depends_on_shape(manifest, "sales")
        self.assertTrue(any(err["code"] == "MANIFEST_DEPENDS_ON_SELF" for err in shape_errors))

    def test_circular_dependency(self):
        manifests = {
            "a": _manifest("a", depends_on={"required": [{"module": "b"}]}),
            "b": _manifest("b", depends_on={"required": [{"module": "c"}]}),
            "c": _manifest("c", depends_on={"required": [{"module": "a"}]}),
        }
        graph = build_dependency_graph(manifests)
        cycle = find_cycle(graph)
        self.assertIsNotNone(cycle)
        self.assertTrue("a" in cycle and "b" in cycle and "c" in cycle)

    def test_version_mismatch(self):
        manifest = _manifest("sales", depends_on={"required": [{"module": "contacts", "version": ">=2.0.0"}]})
        dep_errors = validate_required_dependencies(
            "sales",
            manifest,
            available_versions={"contacts": "1.5.0"},
            available_enabled={"contacts": True},
            require_enabled=False,
        )
        self.assertTrue(any(err["code"] == "MODULE_DEPENDENCY_VERSION_MISMATCH" for err in dep_errors))

    def test_deterministic_install_order(self):
        manifests = {
            "sales": _manifest("sales", depends_on={"required": [{"module": "contacts"}, {"module": "crm"}]}),
            "crm": _manifest("crm", depends_on={"required": [{"module": "contacts"}]}),
            "contacts": _manifest("contacts"),
        }
        graph = build_dependency_graph(manifests)
        order = topological_install_order(graph)
        self.assertEqual(order, ["contacts", "crm", "sales"])

    def test_reverse_dependency_lookup(self):
        manifests = {
            "sales": _manifest("sales", depends_on={"required": [{"module": "contacts"}]}),
            "jobs": _manifest("jobs", depends_on={"required": [{"module": "contacts"}]}),
            "contacts": _manifest("contacts"),
        }
        graph = build_dependency_graph(manifests)
        reverse = build_reverse_dependents(graph)
        self.assertEqual(reverse.get("contacts"), ["jobs", "sales"])

    def test_module_key_from_manifest_prefers_key(self):
        manifest = _manifest("module_abcd")
        manifest["module"]["key"] = "contacts"
        self.assertEqual(module_key_from_manifest(manifest), "contacts")

    def test_module_key_from_manifest_falls_back_to_id(self):
        manifest = _manifest("contacts")
        self.assertEqual(module_key_from_manifest(manifest), "contacts")


if __name__ == "__main__":
    unittest.main()
