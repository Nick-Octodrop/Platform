import os
import sys
import unittest
import uuid

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

os.environ["USE_DB"] = "0"
os.environ["OCTO_DISABLE_AUTH"] = "1"
os.environ["SUPABASE_URL"] = "http://localhost"

try:
    from fastapi.testclient import TestClient
    import app.main as main
    HAS_FASTAPI = True
except Exception:
    TestClient = None
    main = None
    HAS_FASTAPI = False


def _manifest(module_id: str, depends_on: dict | None = None) -> dict:
    entity_slug = module_id.replace("-", "_")
    payload = {
        "manifest_version": "1.3",
        "module": {"id": module_id, "name": module_id, "version": "1.0.0"},
        "entities": [
            {
                "id": f"entity.{entity_slug}",
                "display_field": f"{entity_slug}.name",
                "fields": [{"id": f"{entity_slug}.name", "type": "string"}],
            }
        ],
        "views": [
            {
                "id": f"{entity_slug}.list",
                "kind": "list",
                "entity": f"entity.{entity_slug}",
                "columns": [{"field_id": f"{entity_slug}.name"}],
            }
        ],
        "pages": [],
        "actions": [],
        "workflows": [],
    }
    if depends_on is not None:
        payload["depends_on"] = depends_on
    return payload


@unittest.skipUnless(HAS_FASTAPI, "fastapi not installed")
class TestModuleDisableDependencyProtection(unittest.TestCase):
    def _install_enabled(self, module_id: str, manifest: dict) -> None:
        main.store.init_module(module_id, manifest, actor={"id": "test"})
        main.registry.register(module_id, module_id, actor=None)
        main.registry.set_enabled(module_id, True, actor=None, reason="test")
        main._cache_invalidate("registry_list")

    def test_disable_blocked_when_enabled_dependents_exist(self):
        module_a = f"dep_a_{uuid.uuid4().hex[:8]}"
        module_b = f"dep_b_{uuid.uuid4().hex[:8]}"
        self._install_enabled(module_a, _manifest(module_a))
        self._install_enabled(module_b, _manifest(module_b, depends_on={"required": [{"module": module_a, "version": ">=1.0.0"}]}))

        client = TestClient(main.app)
        response = client.post(f"/modules/{module_a}/disable", json={"reason": "test"})
        body = response.json()

        self.assertFalse(body.get("ok"), body)
        error = body.get("error") or {}
        self.assertEqual(error.get("code"), "MODULE_DISABLE_BLOCKED_BY_DEPENDENTS", body)
        detail = error.get("detail") or {}
        enabled_dependents = detail.get("enabled_dependents") or []
        self.assertTrue(any(item.get("module_id") == module_b for item in enabled_dependents), body)

    def test_disable_allowed_after_dependent_disabled(self):
        module_a = f"dep2_a_{uuid.uuid4().hex[:8]}"
        module_b = f"dep2_b_{uuid.uuid4().hex[:8]}"
        self._install_enabled(module_a, _manifest(module_a))
        self._install_enabled(module_b, _manifest(module_b, depends_on={"required": [{"module": module_a}]}))

        client = TestClient(main.app)
        dep_disable = client.post(f"/modules/{module_b}/disable", json={"reason": "test"}).json()
        self.assertTrue(dep_disable.get("ok"), dep_disable)

        base_disable = client.post(f"/modules/{module_a}/disable", json={"reason": "test"}).json()
        self.assertTrue(base_disable.get("ok"), base_disable)

    def test_archive_blocked_when_enabled_dependents_exist(self):
        module_a = f"dep3_a_{uuid.uuid4().hex[:8]}"
        module_b = f"dep3_b_{uuid.uuid4().hex[:8]}"
        self._install_enabled(module_a, _manifest(module_a))
        self._install_enabled(module_b, _manifest(module_b, depends_on={"required": [{"module": module_a}]}))

        client = TestClient(main.app)
        response = client.delete(f"/modules/{module_a}?archive=true")
        body = response.json()
        self.assertFalse(body.get("ok"), body)
        error = body.get("error") or {}
        self.assertEqual(error.get("code"), "MODULE_DISABLE_BLOCKED_BY_DEPENDENTS", body)


if __name__ == "__main__":
    unittest.main()
