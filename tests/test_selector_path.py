import os
import sys
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if SRC not in sys.path:
    sys.path.insert(0, SRC)

from octo.selector_path import (
    PointerResolveError,
    SelectorNotFound,
    SelectorNotUnique,
    SelectorTypeError,
    resolve_selector_path,
)


class TestSelectorPath(unittest.TestCase):
    def test_resolves_nested_selectors(self) -> None:
        doc = {
            "entities": [
                {
                    "id": "entity.job",
                    "fields": [
                        {"id": "job.title"},
                        {"id": "job.status"},
                        {"id": "job.priority"},
                        {"id": "job.owner"},
                    ],
                }
            ]
        }
        path = "/entities/@[id=entity.job]/fields/@[id=job.status]"
        self.assertEqual(resolve_selector_path(doc, path), "/entities/0/fields/1")

    def test_selector_not_found(self) -> None:
        doc = {"entities": [{"id": "entity.job"}]}
        path = "/entities/@[id=missing]"
        with self.assertRaises(SelectorNotFound):
            resolve_selector_path(doc, path)

    def test_selector_not_unique(self) -> None:
        doc = {"entities": [{"id": "dup"}, {"id": "dup"}]}
        path = "/entities/@[id=dup]"
        with self.assertRaises(SelectorNotUnique):
            resolve_selector_path(doc, path)

    def test_selector_on_non_list(self) -> None:
        doc = {"entities": {"id": "entity.job"}}
        path = "/entities/@[id=entity.job]"
        with self.assertRaises(SelectorTypeError):
            resolve_selector_path(doc, path)

    def test_missing_key(self) -> None:
        doc = {"entities": []}
        path = "/missing"
        with self.assertRaises(PointerResolveError):
            resolve_selector_path(doc, path)

    def test_rfc6901_decoding(self) -> None:
        doc = {"a/b": {"~key": 1}}
        path = "/a~1b/~0key"
        self.assertEqual(resolve_selector_path(doc, path), "/a~1b/~0key")


if __name__ == "__main__":
    unittest.main()
