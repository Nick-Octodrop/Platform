import os
import sys
import unittest
import uuid
import json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

USE_DB = os.getenv("USE_DB", "0") == "1"
DB_URL = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")

if USE_DB and DB_URL:
    from app.db import get_conn, reset_db_ms, get_db_stats, execute
    from app.stores_db import DbGenericRecordStore, _now, get_org_id


class TestPerfDbQueryBudget(unittest.TestCase):
    @unittest.skipUnless(USE_DB and DB_URL, "DB perf test requires USE_DB=1 and DATABASE_URL/SUPABASE_DB_URL")
    def test_list_page_keyset_and_columns(self):
        store = DbGenericRecordStore()
        entity_id = f"entity.perf_{uuid.uuid4().hex[:6]}"
        org_id = get_org_id()

        try:
            with get_conn() as conn:
                for i in range(3):
                    record_id = str(uuid.uuid4())
                    data = {"contact.name": f"Name {i}", "contact.email": f"n{i}@example.com", "id": record_id}
                    execute(
                        conn,
                        """
                        insert into records_generic (tenant_id, entity_id, id, data, created_at, updated_at)
                        values (%s,%s,%s,%s,%s,%s)
                        """,
                        [org_id, entity_id, record_id, json.dumps(data), _now(), _now()],
                    )
        except Exception as exc:
            self.skipTest(f"records_generic not available: {exc}")

        reset_db_ms()
        items, next_cursor = store.list_page(entity_id, limit=1, fields=["contact.name"])
        stats = get_db_stats()
        self.assertEqual(stats.get("queries"), 1)
        self.assertEqual(len(items), 1)
        record = items[0]["record"]
        self.assertIn("contact.name", record)
        self.assertNotIn("contact.email", record)
        self.assertIn("id", record)
        self.assertTrue(next_cursor)

        reset_db_ms()
        items2, _ = store.list_page(entity_id, limit=1, cursor=next_cursor, fields=["contact.name"])
        stats2 = get_db_stats()
        self.assertEqual(stats2.get("queries"), 1)
        self.assertNotEqual(items2[0]["record_id"], items[0]["record_id"])


if __name__ == "__main__":
    unittest.main()
