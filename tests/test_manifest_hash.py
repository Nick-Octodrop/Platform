import os
import sys
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if SRC not in sys.path:
    sys.path.insert(0, SRC)

from octo.manifest_hash import manifest_hash


class TestManifestHash(unittest.TestCase):
    def test_hash_deterministic_with_key_order(self) -> None:
        a = {"b": 1, "a": 2}
        b = {"a": 2, "b": 1}
        self.assertEqual(manifest_hash(a), manifest_hash(b))

    def test_hash_differs_for_different_content(self) -> None:
        a = {"a": 1}
        b = {"a": 2}
        self.assertNotEqual(manifest_hash(a), manifest_hash(b))

    def test_hash_format(self) -> None:
        obj = {"a": 1}
        h = manifest_hash(obj)
        self.assertTrue(h.startswith("sha256:"))
        self.assertEqual(len(h), len("sha256:") + 64)

    def test_hash_rejects_nan(self) -> None:
        obj = {"bad": float("nan")}
        with self.assertRaises(ValueError):
            manifest_hash(obj)

    def test_hash_rejects_pos_inf(self) -> None:
        obj = {"bad": float("inf")}
        with self.assertRaises(ValueError):
            manifest_hash(obj)

    def test_hash_rejects_neg_inf(self) -> None:
        obj = {"bad": float("-inf")}
        with self.assertRaises(ValueError):
            manifest_hash(obj)

    def test_hash_numeric_distinction(self) -> None:
        a = {"n": 1}
        b = {"n": 1.0}
        self.assertNotEqual(manifest_hash(a), manifest_hash(b))


if __name__ == "__main__":
    unittest.main()
