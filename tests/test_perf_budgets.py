import os
import sys
import unittest
import uuid
from datetime import datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

os.environ.setdefault("OCTO_DISABLE_AUTH", "1")

from fastapi.testclient import TestClient

import app.main as main


def _percentile(values, pct):
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = int(round((pct / 100.0) * (len(ordered) - 1)))
    return ordered[idx]


def _run(client, path, count):
    results = []
    for _ in range(count):
        res = client.get(path)
        ms = float(res.headers.get("X-Req-MS", "0") or 0)
        db_ms = float(res.headers.get("X-DB-MS", "0") or 0)
        wire_ms = float(res.headers.get("X-DB-Wire-MS", "0") or 0)
        decode_ms = float(res.headers.get("X-DB-Decode-MS", "0") or 0)
        queries = int(res.headers.get("X-Queries", "0") or 0)
        size = len(res.content or b"")
        results.append(
            {
                "ms": ms,
                "db_ms": db_ms,
                "wire_ms": wire_ms,
                "decode_ms": decode_ms,
                "queries": queries,
                "size": size,
                "status": res.status_code,
                "path": path,
            }
        )
    return results


def _write_baseline(label, p50, p95):
    if os.getenv("PERF_WRITE_BASELINE", "") != "1":
        return
    path = os.getenv("PERF_BASELINE_PATH", "PERF_BASELINE.md")
    stamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%SZ")
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(f"\n[perf] {stamp} {label} p50={p50:.1f} p95={p95:.1f}\n")
    except Exception:
        return


class TestPerfBudgets(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        module_id = f"perf_budget_{uuid.uuid4().hex[:8]}"
        cls.module_id = module_id
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": module_id, "name": "Perf Budget"},
            "app": {"home": "page:contacts.list_page", "nav": []},
            "entities": [
                {
                    "id": "entity.contact",
                    "display_field": "contact.name",
                    "fields": [
                        {"id": "contact.name", "type": "string", "required": True},
                        {"id": "contact.email", "type": "string"},
                    ],
                }
            ],
            "views": [
                {
                    "id": "contacts.list",
                    "kind": "list",
                    "entity": "entity.contact",
                    "columns": [
                        {"field_id": "contact.name"},
                        {"field_id": "contact.email"},
                    ],
                },
                {
                    "id": "contacts.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "sections": [
                        {"title": "Main", "fields": ["contact.name", "contact.email"]},
                    ],
                },
            ],
            "pages": [
                {"id": "contacts.list_page", "title": "Contacts", "content": [{"kind": "view", "target": "view:contacts.list"}]},
                {"id": "contacts.form_page", "title": "Contact", "content": [{"kind": "view", "target": "view:contacts.form"}]},
            ],
            "actions": [],
            "workflows": [],
        }
        main.store.init_module(module_id, manifest, actor={"id": "test"})
        main.registry.register(module_id, "Perf Budget", actor=None)
        main.registry.set_enabled(module_id, True, actor=None, reason="perf-test")
        main._cache_invalidate("registry_list")

        record = main.generic_records.create(
            "entity.contact", {"contact.name": "Ada Lovelace", "contact.email": "ada@example.com"}
        )
        cls.record_id = record.get("record_id") or (record.get("record") or {}).get("id")

    def test_perf_budgets(self):
        client = TestClient(main.app)
        list_path = f"/page/bootstrap?module_id={self.module_id}&page_id=contacts.list_page"
        record_path = f"/records/entity.contact/{self.record_id}"
        notif_path = "/notifications/unread_count"

        # Warmup
        client.get(list_path)
        client.get(record_path)
        client.get(notif_path)

        list_results = _run(client, list_path, 20)
        record_results = _run(client, record_path, 20)
        notif_results = _run(client, notif_path, 20)

        def summarize(label, results, p95_env, q_env, size_env):
            if not results:
                return
            p50 = _percentile([r["ms"] for r in results], 50)
            p95 = _percentile([r["ms"] for r in results], 95)
            max_q = max((r["queries"] for r in results), default=0)
            max_size = max((r["size"] for r in results), default=0)
            _write_baseline(label, p50, p95)
            p95_budget = float(os.getenv(p95_env, "1200"))
            q_budget = int(os.getenv(q_env, "10"))
            size_budget = int(os.getenv(size_env, "150000"))
            if p95 > p95_budget or max_q > q_budget or max_size > size_budget:
                offenders = sorted(results, key=lambda r: r["ms"], reverse=True)[:5]
                print(f"Slow requests ({label}, top 5):")
                for r in offenders:
                    print(r)
                self.fail(
                    f"{label} budget failed: p50={p50:.1f} p95={p95:.1f} (budget {p95_budget}), "
                    f"max_q={max_q} (budget {q_budget}), max_size={max_size} (budget {size_budget})"
                )

        # Ensure perf headers are present in dev
        if list_results and list_results[0]["ms"] == 0:
            self.skipTest("Perf headers missing. Set APP_ENV=dev for X-Req-MS headers.")

        summarize("bootstrap_list", list_results, "PERF_P95_MS_BOOTSTRAP_LIST", "PERF_MAX_QUERIES_BOOTSTRAP_LIST", "PERF_MAX_BYTES_BOOTSTRAP_LIST")
        summarize("record_get", record_results, "PERF_P95_MS_RECORD_GET", "PERF_MAX_QUERIES_RECORD_GET", "PERF_MAX_BYTES_RECORD_GET")
        summarize("notifications_unread", notif_results, "PERF_P95_MS_NOTIF_UNREAD", "PERF_MAX_QUERIES_NOTIF_UNREAD", "PERF_MAX_BYTES_NOTIF_UNREAD")


if __name__ == "__main__":
    unittest.main()
