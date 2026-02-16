import os
import sys
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

from expression_eval import (
    ExprVarResolveError,
    ExpressionDepthError,
    ExpressionEvalError,
    ExpressionSchemaError,
    ExprTypeError,
    eval_expression,
)


class TestExpressionEval(unittest.TestCase):
    def setUp(self) -> None:
        self.ctx = {"job": {"id": "j1"}, "x": None}

    def test_literal_and_nan_rejection(self) -> None:
        self.assertEqual(eval_expression({"literal": {"a": 1}}, self.ctx), {"a": 1})
        with self.assertRaises(ExprTypeError):
            eval_expression({"literal": float("nan")}, self.ctx)

    def test_var_resolution(self) -> None:
        self.assertEqual(eval_expression({"var": "job.id"}, self.ctx), "j1")
        with self.assertRaises(ExprVarResolveError):
            eval_expression({"var": "job.missing"}, self.ctx)

    def test_coalesce(self) -> None:
        expr = {
            "expr": "coalesce",
            "args": [
                {"var": "x"},
                {"literal": 0},
            ],
        }
        self.assertEqual(eval_expression(expr, self.ctx), 0)

    def test_case(self) -> None:
        expr = {
            "expr": "case",
            "cases": [
                {
                    "when": {"op": "eq", "left": {"literal": 1}, "right": {"literal": 2}},
                    "then": {"literal": "no"},
                },
                {
                    "when": {"op": "eq", "left": {"literal": 1}, "right": {"literal": 1}},
                    "then": {"literal": "yes"},
                },
            ],
            "else": {"literal": "fallback"},
        }
        self.assertEqual(eval_expression(expr, self.ctx), "yes")

    def test_case_else_none(self) -> None:
        expr = {
            "expr": "case",
            "cases": [
                {
                    "when": {"op": "eq", "left": {"literal": 1}, "right": {"literal": 2}},
                    "then": {"literal": "no"},
                }
            ],
        }
        self.assertIsNone(eval_expression(expr, self.ctx))

    def test_case_condition_error_wrapped(self) -> None:
        expr = {
            "expr": "case",
            "cases": [
                {
                    "when": {"op": "eq", "left": {"var": "missing"}, "right": {"literal": 1}},
                    "then": {"literal": "no"},
                }
            ],
        }
        with self.assertRaises(ExpressionEvalError) as ctx:
            eval_expression(expr, self.ctx)
        self.assertEqual(ctx.exception.code, "EXPR_CONDITION_ERROR")

    def test_depth_limit(self) -> None:
        expr = {"expr": "coalesce", "args": [{"expr": "coalesce", "args": [{"literal": 1}]}]}
        with self.assertRaises(ExpressionDepthError):
            eval_expression(expr, self.ctx, depth_limit=1)

    def test_unknown_keys_rejected(self) -> None:
        with self.assertRaises(ExpressionSchemaError):
            eval_expression({"literal": 1, "extra": 2}, self.ctx)


if __name__ == "__main__":
    unittest.main()
