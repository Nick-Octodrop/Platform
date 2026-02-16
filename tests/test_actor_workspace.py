import os
import sys
import json
import unittest
from types import SimpleNamespace

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

os.environ.setdefault("USE_DB", "0")
os.environ.setdefault("OCTO_DISABLE_AUTH", "1")
os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_JWT_AUD", "authenticated")

try:
    import fastapi  # noqa: F401
except ImportError:
    fastapi = None

if fastapi is not None:
    import app.main as main


class DummyRequest:
    def __init__(self, user, headers=None):
        self.state = SimpleNamespace(user=user)
        self.headers = headers or {}


def _json_body(response):
    return json.loads(response.body.decode("utf-8"))


if fastapi is None:
    class TestActorWorkspace(unittest.TestCase):
        def test_fastapi_missing(self):
            self.skipTest("fastapi not installed")
else:
    class TestActorWorkspace(unittest.TestCase):
        def setUp(self):
            self._use_db = main.USE_DB
            self._list_memberships = main.list_memberships
            self._get_membership = main.get_membership
            self._create_workspace_for_user = main.create_workspace_for_user

        def tearDown(self):
            main.USE_DB = self._use_db
            main.list_memberships = self._list_memberships
            main.get_membership = self._get_membership
            main.create_workspace_for_user = self._create_workspace_for_user

        def test_requires_workspace_header_for_multiple_memberships(self):
            main.USE_DB = True
            main.list_memberships = lambda user_id: [
                {"workspace_id": "w1", "role": "member"},
                {"workspace_id": "w2", "role": "member"},
            ]
            main.get_membership = lambda user_id, workspace_id: None
            request = DummyRequest({"id": "u1", "email": "u@example.com"})
            response = main._resolve_actor(request)
            self.assertEqual(response.status_code, 400)
            body = _json_body(response)
            self.assertEqual(body["errors"][0]["code"], "WORKSPACE_REQUIRED")

        def test_workspace_header_forbidden_when_not_member(self):
            main.USE_DB = True
            main.list_memberships = lambda user_id: [{"workspace_id": "w1", "role": "member"}]
            main.get_membership = lambda user_id, workspace_id: None
            request = DummyRequest({"id": "u1", "email": "u@example.com"}, headers={"X-Workspace-Id": "w2"})
            response = main._resolve_actor(request)
            self.assertEqual(response.status_code, 403)
            body = _json_body(response)
            self.assertEqual(body["errors"][0]["code"], "WORKSPACE_FORBIDDEN")

        def test_bootstrap_workspace_when_none_exist(self):
            main.USE_DB = True
            main.list_memberships = lambda user_id: []
            main.get_membership = lambda user_id, workspace_id: None
            main.create_workspace_for_user = lambda user: "w-new"
            request = DummyRequest({"id": "u1", "email": "u@example.com"})
            actor = main._resolve_actor(request)
            self.assertEqual(actor["workspace_id"], "w-new")
            self.assertEqual(actor["role"], "owner")


if __name__ == "__main__":
    unittest.main()
