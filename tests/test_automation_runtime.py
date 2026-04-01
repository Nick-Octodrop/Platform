import unittest

from app.stores import MemoryAutomationStore, MemoryJobStore
from app.worker import _run_automation


class TestAutomationRuntime(unittest.TestCase):
    def test_delay_reschedules(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Delay Test",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"]},
                "steps": [{"id": "delay1", "kind": "delay", "seconds": 60}],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "record.created",
                "trigger_payload": {"record_id": "r1"},
            }
        )
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "queued")
        jobs = job_store.list("default")
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["type"], "automation.run")

    def test_idempotency_skips_duplicate(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Idem Test",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"]},
                "steps": [{"id": "noop1", "kind": "action", "action_id": "system.noop"}],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "record.created",
                "trigger_payload": {"record_id": "r1"},
            }
        )
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        first_runs = store.list_step_runs(run["id"])
        self.assertEqual(len(first_runs), 1)
        store.update_run(run["id"], {"status": "running", "current_step_index": 0})
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        second_runs = store.list_step_runs(run["id"])
        self.assertEqual(len(second_runs), 1)

    def test_retry_policy_reschedules(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Retry Test",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"]},
                "steps": [
                    {
                        "id": "fail1",
                        "kind": "action",
                        "action_id": "system.fail",
                        "retry_policy": {"max_attempts": 2, "backoff_seconds": 1},
                    }
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "record.created",
                "trigger_payload": {"record_id": "r1"},
            }
        )
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "queued")
        jobs = job_store.list("default")
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["type"], "automation.run")

    def test_step_outputs_available_to_following_conditions(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Context Test",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"]},
                "steps": [
                    {"id": "noop1", "kind": "action", "action_id": "system.noop"},
                    {
                        "id": "check1",
                        "kind": "condition",
                        "expr": {
                            "op": "eq",
                            "left": {"var": "steps.noop1.ok"},
                            "right": {"literal": True},
                        },
                        "stop_on_false": True,
                    },
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "record.created",
                "trigger_payload": {"record_id": "r1"},
            }
        )
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "succeeded")
        step_runs = store.list_step_runs(run["id"])
        self.assertEqual(len(step_runs), 2)
        self.assertEqual(step_runs[1]["status"], "succeeded")

    def test_foreach_repeats_action_over_list(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Loop Test",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"]},
                "steps": [
                    {
                        "id": "loop1",
                        "kind": "foreach",
                        "over": {"var": "trigger.record_ids"},
                        "item_name": "row_id",
                        "action_id": "system.noop",
                        "store_as": "loop_result",
                    },
                    {
                        "id": "check_loop",
                        "kind": "condition",
                        "expr": {
                            "op": "eq",
                            "left": {"var": "vars.loop_result.count"},
                            "right": {"literal": 3},
                        },
                        "stop_on_false": True,
                    },
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "record.created",
                "trigger_payload": {"record_ids": ["r1", "r2", "r3"]},
            }
        )
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "succeeded")
        step_runs = store.list_step_runs(run["id"])
        self.assertEqual(step_runs[0]["output"]["count"], 3)

    def test_condition_executes_then_branch_steps(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Nested Condition Test",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"]},
                "steps": [
                    {
                        "id": "cond1",
                        "kind": "condition",
                        "expr": {
                            "op": "eq",
                            "left": {"var": "trigger.status"},
                            "right": {"literal": "active"},
                        },
                        "then_steps": [
                            {"id": "nested_noop", "kind": "action", "action_id": "system.noop", "store_as": "nested_result"},
                        ],
                    },
                    {
                        "id": "check_nested",
                        "kind": "condition",
                        "expr": {
                            "op": "eq",
                            "left": {"var": "vars.nested_result.ok"},
                            "right": {"literal": True},
                        },
                        "stop_on_false": True,
                    },
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "record.created",
                "trigger_payload": {"record_id": "r1", "status": "active"},
            }
        )
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "succeeded")
        step_runs = store.list_step_runs(run["id"])
        self.assertTrue(any(item.get("step_id") == "cond1.then.nested_noop" for item in step_runs))

    def test_foreach_executes_nested_steps(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Nested Loop Test",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"]},
                "steps": [
                    {
                        "id": "loop_nested",
                        "kind": "foreach",
                        "over": {"var": "trigger.record_ids"},
                        "item_name": "row_id",
                        "steps": [
                            {"id": "child_noop", "kind": "action", "action_id": "system.noop"},
                        ],
                        "store_as": "loop_result",
                    },
                    {
                        "id": "check_loop",
                        "kind": "condition",
                        "expr": {
                            "op": "eq",
                            "left": {"var": "vars.loop_result.count"},
                            "right": {"literal": 2},
                        },
                        "stop_on_false": True,
                    },
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "record.created",
                "trigger_payload": {"record_ids": ["r1", "r2"]},
            }
        )
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "succeeded")
        step_runs = store.list_step_runs(run["id"])
        self.assertTrue(any(item.get("step_id") == "loop_nested.loop_1.child_noop" for item in step_runs))
        self.assertTrue(any(item.get("step_id") == "loop_nested.loop_2.child_noop" for item in step_runs))


if __name__ == "__main__":
    unittest.main()
