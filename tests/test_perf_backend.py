import os
import sys
import time
import unittest
import uuid

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

USE_DB_ENV = os.getenv("USE_DB", "").strip()
os.environ["OCTO_DISABLE_AUTH"] = "1"
os.environ["SUPABASE_URL"] = "http://localhost"

from fastapi.testclient import TestClient

import app.main as main


def _percentile(values, pct):
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = int(round((pct / 100.0) * (len(ordered) - 1)))
    return ordered[idx]


def _run_requests(client, path, count):
    results = []
    for _ in range(count):
        res = client.get(path)
        ms = float(res.headers.get("X-Req-MS", "0") or 0)
        queries = int(res.headers.get("X-Queries", "0") or 0)
        size = len(res.content or b"")
        results.append({"ms": ms, "queries": queries, "size": size, "status": res.status_code, "path": path})
    return results


def _write_perf_log(path, payload):
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(payload + "\n")
    except Exception:
        return


class TestPerfBackend(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db_url = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
        if USE_DB_ENV == "1" and not db_url:
            raise unittest.SkipTest("USE_DB=1 but no SUPABASE_DB_URL/DATABASE_URL provided")

        module_id = f"perf_test_{uuid.uuid4().hex[:8]}"
        cls.module_id = module_id
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": module_id, "name": "Perf Test"},
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
        main.registry.register(module_id, "Perf Test", actor=None)
        main.registry.set_enabled(module_id, True, actor=None, reason="perf-test")
        main._cache_invalidate("registry_list")

        record = main.generic_records.create(
            "entity.contact", {"contact.name": "Ada Lovelace", "contact.email": "ada@example.com"}
        )
        cls.record_id = record.get("id")

    def test_page_bootstrap_perf(self):
        client = TestClient(main.app)
        list_path = f"/page/bootstrap?module_id={self.module_id}&page_id=contacts.list_page"
        form_path = f"/page/bootstrap?module_id={self.module_id}&page_id=contacts.form_page&record_id={self.record_id}"
        log_path = os.getenv("PERF_LOG_PATH", "perf_results.log")

        # Warm up
        client.get(list_path)
        client.get(form_path)

        list_results = _run_requests(client, list_path, 20)
        form_results = _run_requests(client, form_path, 20)

        list_p50 = _percentile([r["ms"] for r in list_results], 50)
        list_p95 = _percentile([r["ms"] for r in list_results], 95)
        form_p50 = _percentile([r["ms"] for r in form_results], 50)
        form_p95 = _percentile([r["ms"] for r in form_results], 95)

        list_p95_budget = float(os.getenv("PERF_P95_MS_BOOTSTRAP_LIST", "250"))
        list_q_budget = int(os.getenv("PERF_MAX_QUERIES_BOOTSTRAP_LIST", "10"))
        form_p95_budget = float(os.getenv("PERF_P95_MS_BOOTSTRAP_FORM", "300"))
        form_q_budget = int(os.getenv("PERF_MAX_QUERIES_BOOTSTRAP_FORM", "12"))

        list_max_q = max((r["queries"] for r in list_results), default=0)
        form_max_q = max((r["queries"] for r in form_results), default=0)

        _write_perf_log(
            log_path,
            f"bootstrap_list p50={list_p50:.1f} p95={list_p95:.1f} max_q={list_max_q} "
            f"budget_p95={list_p95_budget} budget_q={list_q_budget}",
        )
        _write_perf_log(
            log_path,
            f"bootstrap_form p50={form_p50:.1f} p95={form_p95:.1f} max_q={form_max_q} "
            f"budget_p95={form_p95_budget} budget_q={form_q_budget}",
        )

        if list_p95 > list_p95_budget or list_max_q > list_q_budget:
            offenders = sorted(list_results, key=lambda r: r["ms"], reverse=True)[:5]
            print("Slow requests (list, top 5):")
            for r in offenders:
                print(r)
                _write_perf_log(log_path, f"list_offender {r}")
            self.fail(
                f"List bootstrap perf budget failed: p50={list_p50:.1f}ms p95={list_p95:.1f}ms (budget {list_p95_budget}ms), "
                f"max_queries={list_max_q} (budget {list_q_budget})"
            )

        if form_p95 > form_p95_budget or form_max_q > form_q_budget:
            offenders = sorted(form_results, key=lambda r: r["ms"], reverse=True)[:5]
            print("Slow requests (form, top 5):")
            for r in offenders:
                print(r)
                _write_perf_log(log_path, f"form_offender {r}")
            self.fail(
                f"Form bootstrap perf budget failed: p50={form_p50:.1f}ms p95={form_p95:.1f}ms (budget {form_p95_budget}ms), "
                f"max_queries={form_max_q} (budget {form_q_budget})"
            )


if __name__ == "__main__":
    unittest.main()
