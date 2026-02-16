import os
import sys
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

from condition_eval import (
    ConditionDepthError,
    ConditionSchemaError,
    TypeErrorInCondition,
    VarResolveError,
    eval_condition,
)


class TestConditionEval(unittest.TestCase):
    def setUp(self) -> None:
        self.ctx = {
            "job": {"id": "j1", "status": "open", "count": 3},
            "text": "hello world",
            "nums": [1, 2, 3],
            "items": [
                {"status": "ok"},
                {"status": "fail"},
            ],
        }

    def test_and_or_not_empty(self) -> None:
        self.assertTrue(eval_condition({"op": "and", "children": []}, self.ctx))
        self.assertFalse(eval_condition({"op": "or", "children": []}, self.ctx))
        self.assertTrue(
            eval_condition(
                {"op": "not", "children": [{"op": "eq", "left": {"literal": 1}, "right": {"literal": 2}}]},
                self.ctx,
            )
        )

    def test_eq_neq(self) -> None:
        cond = {"op": "eq", "left": {"literal": 1}, "right": {"literal": 1}}
        self.assertTrue(eval_condition(cond, self.ctx))
        cond = {"op": "neq", "left": {"literal": 1}, "right": {"literal": 2}}
        self.assertTrue(eval_condition(cond, self.ctx))

    def test_gt_gte_lt_lte(self) -> None:
        self.assertTrue(
            eval_condition(
                {"op": "gt", "left": {"literal": 2}, "right": {"literal": 1}},
                self.ctx,
            )
        )
        self.assertTrue(
            eval_condition(
                {"op": "gte", "left": {"literal": 2}, "right": {"literal": 2}},
                self.ctx,
            )
        )
        self.assertTrue(
            eval_condition(
                {"op": "lt", "left": {"literal": 1}, "right": {"literal": 2}},
                self.ctx,
            )
        )
        self.assertTrue(
            eval_condition(
                {"op": "lte", "left": {"literal": 2}, "right": {"literal": 2}},
                self.ctx,
            )
        )

    def test_contains(self) -> None:
        cond = {
            "op": "contains",
            "left": {"var": "text"},
            "right": {"literal": "world"},
        }
        self.assertTrue(eval_condition(cond, self.ctx))
        cond = {
            "op": "contains",
            "left": {"var": "nums"},
            "right": {"literal": 2},
        }
        self.assertTrue(eval_condition(cond, self.ctx))

    def test_in_not_in(self) -> None:
        cond = {
            "op": "in",
            "left": {"literal": 2},
            "right": {"array": [{"literal": 1}, {"literal": 2}]},
        }
        self.assertTrue(eval_condition(cond, self.ctx))
        cond = {
            "op": "not_in",
            "left": {"literal": 3},
            "right": {"array": [{"literal": 1}, {"literal": 2}]},
        }
        self.assertTrue(eval_condition(cond, self.ctx))

    def test_exists_not_exists(self) -> None:
        self.assertTrue(
            eval_condition(
                {"op": "exists", "left": {"var": "job.id"}},
                self.ctx,
            )
        )
        self.assertTrue(
            eval_condition(
                {"op": "not_exists", "left": {"var": "missing"}},
                self.ctx,
            )
        )

    def test_all_any(self) -> None:
        cond = {
            "op": "any",
            "over": {"var": "items"},
            "where": {
                "op": "eq",
                "left": {"var": "item.status"},
                "right": {"literal": "fail"},
            },
        }
        self.assertTrue(eval_condition(cond, self.ctx))
        cond = {
            "op": "all",
            "over": {"var": "items"},
            "where": {
                "op": "eq",
                "left": {"var": "item.status"},
                "right": {"literal": "ok"},
            },
        }
        self.assertFalse(eval_condition(cond, self.ctx))

    def test_depth_limit(self) -> None:
        cond = {"op": "not", "children": [{"op": "not", "children": [{"op": "not", "children": [{"op": "eq", "left": {"literal": 1}, "right": {"literal": 1}}]}]}]}
        with self.assertRaises(ConditionDepthError):
            eval_condition(cond, self.ctx, depth_limit=2)

    def test_var_resolution(self) -> None:
        cond = {"op": "eq", "left": {"var": "job.status"}, "right": {"literal": "open"}}
        self.assertTrue(eval_condition(cond, self.ctx))
        cond = {"op": "eq", "left": {"var": "missing"}, "right": {"literal": 1}}
        with self.assertRaises(VarResolveError):
            eval_condition(cond, self.ctx)

    def test_type_errors(self) -> None:
        cond = {"op": "gt", "left": {"literal": "a"}, "right": {"literal": "b"}}
        with self.assertRaises(TypeErrorInCondition):
            eval_condition(cond, self.ctx)
        cond = {"op": "in", "left": {"literal": 1}, "right": {"literal": 2}}
        with self.assertRaises(TypeErrorInCondition):
            eval_condition(cond, self.ctx)

    def test_contains_type_error(self) -> None:
        cond = {"op": "contains", "left": {"literal": 1}, "right": {"literal": 1}}
        with self.assertRaises(TypeErrorInCondition):
            eval_condition(cond, self.ctx)

    def test_schema_errors(self) -> None:
        with self.assertRaises(ConditionSchemaError):
            eval_condition({"op": "and"}, self.ctx)


if __name__ == "__main__":
    unittest.main()
