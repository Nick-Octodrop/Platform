import os
import sys
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

os.environ["USE_DB"] = "0"
os.environ["OCTO_DISABLE_AUTH"] = "1"
os.environ["SUPABASE_URL"] = "http://localhost"

from app.stores import MemoryJobStore
from app.email import render_template
from app.secrets import resolve_secret
from app import main
from fastapi.testclient import TestClient


class TestPhase1Jobs(unittest.TestCase):
    def test_job_claim_order_and_idempotency(self) -> None:
        store = MemoryJobStore()
        a = store.enqueue({"type": "email.send", "workspace_id": "w1", "priority": 0, "idempotency_key": "k1"})
        b = store.enqueue({"type": "email.send", "workspace_id": "w1", "priority": 5})
        c = store.enqueue({"type": "doc.generate", "workspace_id": "w1", "priority": 1})
        a2 = store.enqueue({"type": "email.send", "workspace_id": "w1", "priority": 0, "idempotency_key": "k1"})
        self.assertEqual(a["id"], a2["id"])
        claimed = store.claim_batch(2, "worker")
        self.assertEqual(claimed[0]["id"], b["id"])
        self.assertEqual(claimed[1]["id"], c["id"])

    def test_template_render(self) -> None:
        out = render_template("Hello {{record.name}}", {"record": {"name": "Ada"}}, strict=True)
        self.assertEqual(out, "Hello Ada")

    def test_secret_env_fallback(self) -> None:
        os.environ["APP_ENV"] = "dev"
        os.environ["POSTMARK_API_TOKEN"] = "tok_test"
        value = resolve_secret(None, "default", env_key="POSTMARK_API_TOKEN")
        self.assertEqual(value, "tok_test")

    def test_document_job_enqueue(self) -> None:
        client = TestClient(main.app)
        res = client.post(
            "/documents/generate",
            json={"template_id": "t1", "entity_id": "entity.contact", "record_id": "r1"},
        )
        self.assertEqual(res.status_code, 200)
        payload = res.json()
        self.assertTrue(payload.get("ok"))
        self.assertEqual(payload["job"]["type"], "doc.generate")
