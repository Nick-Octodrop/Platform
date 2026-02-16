import os
import sys
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

from workflow_plan import plan_workflow_step


class TestWorkflowPlan(unittest.TestCase):
    def setUp(self) -> None:
        self.workflow = {
            "id": "workflow.job",
            "initial_state": "new",
            "states": [{"id": "new", "label": None}, {"id": "done", "label": None}],
            "transitions": [
                {
                    "id": "t1",
                    "from": "new",
                    "to": "done",
                    "label": None,
                    "guard": {"op": "eq", "left": {"var": "job.status"}, "right": {"literal": "ok"}},
                    "actions": ["action.close"],
                    "emits": [{"name": "job.closed", "payload": {"ok": True}}],
                }
            ],
        }
        self.ctx = {
            "actor": {"id": "u1", "roles": ["admin"]},
            "module_id": "job_management",
            "manifest_hash": "sha256:abcd",
            "vars": {"job": {"status": "ok"}},
        }

    def test_invalid_workflow_structure(self) -> None:
        bad = {"id": "w", "initial_state": "x", "states": [], "transitions": [{"id": "t", "from": "x", "to": "y"}]}
        result = plan_workflow_step(bad, "x", self.ctx)
        self.assertFalse(result["ok"])

    def test_guard_true_selects_transition(self) -> None:
        result = plan_workflow_step(self.workflow, "new", self.ctx)
        self.assertTrue(result["ok"])
        self.assertEqual(result["plan"]["chosen_transition_id"], "t1")

    def test_guard_false_no_transition(self) -> None:
        self.ctx["vars"]["job"]["status"] = "no"
        result = plan_workflow_step(self.workflow, "new", self.ctx)
        self.assertTrue(result["ok"])
        self.assertIsNone(result["plan"]["chosen_transition_id"])

    def test_multiple_transitions_warning(self) -> None:
        wf = {
            "id": "w",
            "initial_state": "s",
            "states": [{"id": "s", "label": None}, {"id": "t", "label": None}],
            "transitions": [
                {"id": "b", "from": "s", "to": "t", "guard": None, "actions": []},
                {"id": "a", "from": "s", "to": "t", "guard": None, "actions": []},
            ],
        }
        result = plan_workflow_step(wf, "s", self.ctx)
        self.assertTrue(result["ok"])
        self.assertEqual(result["plan"]["chosen_transition_id"], "a")
        self.assertEqual(result["warnings"][0]["code"], "WORKFLOW_MULTIPLE_TRANSITIONS")

    def test_guard_error(self) -> None:
        wf = {
            "id": "w",
            "initial_state": "s",
            "states": [{"id": "s", "label": None}, {"id": "t", "label": None}],
            "transitions": [
                {"id": "t1", "from": "s", "to": "t", "guard": {"op": "eq", "left": {"var": "missing"}, "right": {"literal": 1}}}
            ],
        }
        result = plan_workflow_step(wf, "s", self.ctx)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errors"][0]["code"], "WORKFLOW_GUARD_ERROR")

    def test_deterministic_output(self) -> None:
        result1 = plan_workflow_step(self.workflow, "new", self.ctx)
        result2 = plan_workflow_step(self.workflow, "new", self.ctx)
        self.assertEqual(result1["plan"], result2["plan"])


if __name__ == "__main__":
    unittest.main()
