import os
import sys
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

from action_plan import plan_action


class TestActionPlan(unittest.TestCase):
    def setUp(self) -> None:
        self.ctx = {
            "actor": {"id": "u1", "roles": ["manager"]},
            "module_id": "job_management",
            "now": None,
            "vars": {"job": {"id": "j1", "status": "open"}, "x": 1},
        }

    def test_role_denial(self) -> None:
        action = {
            "id": "action.assign",
            "type": "update_record",
            "params_schema": None,
            "permissions": {"roles": ["admin"]},
            "effect": {
                "record_ref": {"entity": "entity.job", "id": {"var": "job.id"}},
                "changes": {"job.status": {"literal": "closed"}},
            },
        }
        result = plan_action(action, {}, self.ctx)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errors"][0]["code"], "ACTION_FORBIDDEN_ROLE")

    def test_condition_denial(self) -> None:
        action = {
            "id": "action.assign",
            "type": "update_record",
            "params_schema": None,
            "permissions": {
                "condition": {"op": "eq", "left": {"var": "x"}, "right": {"literal": 2}}
            },
            "effect": {
                "record_ref": {"entity": "entity.job", "id": {"var": "job.id"}},
                "changes": {"job.status": {"literal": "closed"}},
            },
        }
        result = plan_action(action, {}, self.ctx)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errors"][0]["code"], "ACTION_FORBIDDEN_CONDITION")

    def test_condition_invalid_var(self) -> None:
        action = {
            "id": "action.assign",
            "type": "update_record",
            "params_schema": None,
            "permissions": {
                "condition": {"op": "exists", "left": {"var": "missing"}}
            },
            "effect": {
                "record_ref": {"entity": "entity.job", "id": {"var": "job.id"}},
                "changes": {"job.status": {"literal": "closed"}},
            },
        }
        result = plan_action(action, {}, self.ctx)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errors"][0]["code"], "CONDITION_INVALID")

    def test_params_schema_required_and_types(self) -> None:
        action = {
            "id": "action.create",
            "type": "create_record",
            "params_schema": {
                "type": "object",
                "required": ["title"],
                "properties": {"title": {"type": "string"}},
                "additionalProperties": False,
            },
            "effect": {
                "entity": "entity.job",
                "values": {"job.title": {"var": "title"}},
            },
        }
        result = plan_action(action, {}, self.ctx)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errors"][0]["code"], "PARAMS_REQUIRED_MISSING")

        result = plan_action(action, {"title": 123}, self.ctx)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errors"][0]["code"], "PARAMS_TYPE_INVALID")

        result = plan_action(action, {"title": "t", "extra": 1}, self.ctx)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errors"][0]["code"], "PARAMS_ADDITIONAL_FORBIDDEN")

    def test_update_record_plan(self) -> None:
        action = {
            "id": "action.update",
            "type": "update_record",
            "params_schema": None,
            "effect": {
                "record_ref": {"entity": "entity.job", "id": {"var": "job.id"}},
                "changes": {"job.status": {"literal": "closed"}},
            },
        }
        result = plan_action(action, {}, self.ctx)
        self.assertTrue(result["ok"])
        step = result["plan"]["steps"][0]
        self.assertEqual(step["kind"], "update_record")

    def test_create_record_plan(self) -> None:
        action = {
            "id": "action.create",
            "type": "create_record",
            "params_schema": None,
            "effect": {
                "entity": "entity.job",
                "values": {"job.title": {"literal": "x"}},
                "returns": {"as": "created", "fields": ["job.id"]},
            },
        }
        result = plan_action(action, {}, self.ctx)
        self.assertTrue(result["ok"])
        step = result["plan"]["steps"][0]
        self.assertEqual(step["kind"], "create_record")

    def test_call_action_plan(self) -> None:
        action = {
            "id": "action.call",
            "type": "call_action",
            "params_schema": None,
            "effect": {
                "action_ref": "docs.action.generate",
                "params": {"id": {"var": "job.id"}},
                "returns": {"as": "result"},
            },
        }
        result = plan_action(action, {}, self.ctx)
        self.assertTrue(result["ok"])
        step = result["plan"]["steps"][0]
        self.assertEqual(step["kind"], "call_action")

    def test_publish_event_plan(self) -> None:
        action = {
            "id": "action.publish",
            "type": "publish_event",
            "params_schema": None,
            "effect": {
                "name": "job.created",
                "payload": {"job_id": {"var": "job.id"}},
            },
        }
        result = plan_action(action, {}, self.ctx)
        self.assertTrue(result["ok"])
        step = result["plan"]["steps"][0]
        self.assertEqual(step["kind"], "publish_event")

    def test_run_query_plan(self) -> None:
        action = {
            "id": "action.query",
            "type": "run_query",
            "params_schema": None,
            "effect": {
                "query_ref": "job.query.tasks",
                "params": {"job_id": {"var": "job.id"}},
                "returns": {"as": "tasks"},
            },
        }
        result = plan_action(action, {}, self.ctx)
        self.assertTrue(result["ok"])
        step = result["plan"]["steps"][0]
        self.assertEqual(step["kind"], "run_query")

    def test_invalid_action_type(self) -> None:
        action = {
            "id": "action.bad",
            "type": "destroy_world",
            "params_schema": None,
            "effect": {},
        }
        result = plan_action(action, {}, self.ctx)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errors"][0]["code"], "ACTION_TYPE_INVALID")


if __name__ == "__main__":
    unittest.main()
