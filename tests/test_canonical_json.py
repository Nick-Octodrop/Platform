import os
import sys
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if SRC not in sys.path:
    sys.path.insert(0, SRC)

from octo.canonical_json import CanonicalJsonTypeError, canonical_dumps


class TestCanonicalJson(unittest.TestCase):
    def test_key_ordering_is_deterministic(self) -> None:
        a = {"b": 1, "a": 2}
        b = {"a": 2, "b": 1}
        self.assertEqual(canonical_dumps(a), canonical_dumps(b))

    def test_nested_dict_ordering(self) -> None:
        obj = {"b": 1, "a": {"d": 4, "c": 3}}
        expected = '{"a":{"c":3,"d":4},"b":1}'
        self.assertEqual(canonical_dumps(obj), expected)

    def test_list_order_preserved(self) -> None:
        obj = {"list": [2, 1, 3]}
        expected = '{"list":[2,1,3]}'
        self.assertEqual(canonical_dumps(obj), expected)

    def test_non_ascii_preserved(self) -> None:
        obj = {"name": "café"}
        out = canonical_dumps(obj)
        self.assertIn("café", out)
        self.assertNotIn("\\u", out)

    def test_unsupported_type_raises(self) -> None:
        obj = {"bad": {1, 2, 3}}
        with self.assertRaises(CanonicalJsonTypeError):
            canonical_dumps(obj)

    def test_reject_nan(self) -> None:
        obj = {"bad": float("nan")}
        with self.assertRaises(ValueError):
            canonical_dumps(obj)

    def test_reject_pos_inf(self) -> None:
        obj = {"bad": float("inf")}
        with self.assertRaises(ValueError):
            canonical_dumps(obj)

    def test_reject_neg_inf(self) -> None:
        obj = {"bad": float("-inf")}
        with self.assertRaises(ValueError):
            canonical_dumps(obj)

    def test_numeric_distinction(self) -> None:
        a = {"n": 1}
        b = {"n": 1.0}
        self.assertNotEqual(canonical_dumps(a), canonical_dumps(b))


if __name__ == "__main__":
    unittest.main()
