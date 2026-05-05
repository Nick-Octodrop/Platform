import unittest

from app.computed_fields import recompute_record


class ComputedFieldTests(unittest.TestCase):
    def test_compound_parent_aggregate_uses_scoped_fetch_and_filters_rows(self):
        entity_def = {
            "id": "entity.parent",
            "fields": [
                {
                    "id": "parent.open_total",
                    "type": "number",
                    "compute": {
                        "aggregate": {
                            "op": "sum",
                            "entity": "entity.child",
                            "field": "child.amount",
                            "where": {
                                "op": "and",
                                "conditions": [
                                    {
                                        "op": "eq",
                                        "field": "child.parent_id",
                                        "value": {"ref": "$parent.id"},
                                    },
                                    {
                                        "op": "eq",
                                        "field": "child.status",
                                        "value": "open",
                                    },
                                ],
                            },
                        }
                    },
                }
            ],
        }
        scoped_rows = [
            {"id": "c1", "child.parent_id": "p1", "child.status": "open", "child.amount": 10},
            {"id": "c2", "child.parent_id": "p1", "child.status": "closed", "child.amount": 20},
        ]
        calls = []

        def fetch_records(entity_id, field_id=None, value=None):
            calls.append((entity_id, field_id, value))
            if field_id is None:
                raise AssertionError("aggregate should not full-scan child records")
            self.assertEqual(entity_id, "entity.child")
            self.assertEqual(field_id, "child.parent_id")
            self.assertEqual(value, "p1")
            return scoped_rows

        record = recompute_record(entity_def, {"id": "p1"}, fetch_records)

        self.assertEqual(record["parent.open_total"], 10)
        self.assertGreaterEqual(len(calls), 1)
        self.assertTrue(all(call == ("entity.child", "child.parent_id", "p1") for call in calls))


if __name__ == "__main__":
    unittest.main()
