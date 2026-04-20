import os
import sys
import unittest
from unittest.mock import patch

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
SRC = os.path.join(ROOT, "src")
if SRC not in sys.path:
    sys.path.insert(0, SRC)

import app.doc_render as doc_render


class _FakeHeaders:
    def __init__(self, content_type: str) -> None:
        self._content_type = content_type

    def get_content_type(self) -> str:
        return self._content_type


class _FakeResponse:
    def __init__(self, payload: bytes, content_type: str) -> None:
        self._payload = payload
        self.headers = _FakeHeaders(content_type)

    def read(self, _size: int = -1) -> bytes:
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class _FakePage:
    def __init__(self) -> None:
        self.pdf_args = None

    def set_default_timeout(self, _timeout: int) -> None:
        return None

    def set_content(self, _html: str, wait_until: str = "", timeout: int = 0) -> None:
        return None

    def wait_for_load_state(self, _state: str, timeout: int = 0) -> None:
        return None

    def pdf(self, **kwargs) -> bytes:
        self.pdf_args = kwargs
        return b"%PDF-1.4\nfake\n%%EOF"


class _FakeContext:
    def __init__(self, page: _FakePage) -> None:
        self._page = page
        self.closed = False

    def new_page(self) -> _FakePage:
        return self._page

    def close(self) -> None:
        self.closed = True


class _FakeBrowser:
    def __init__(self, context: _FakeContext) -> None:
        self._context = context

    def new_context(self) -> _FakeContext:
        return self._context


class TestDocRender(unittest.TestCase):
    def test_inline_header_footer_assets_rewrites_http_images_to_data_uri(self) -> None:
        html = "<div><img src='https://example.com/logo.png' alt='Logo' /></div>"
        with patch.object(
            doc_render,
            "urlopen",
            lambda request, timeout=5: _FakeResponse(b"png-bytes", "image/png"),
        ):
            result = doc_render._inline_header_footer_assets(html)
        self.assertIsInstance(result, str)
        self.assertIn("data:image/png;base64,", result)
        self.assertNotIn("https://example.com/logo.png", result)

    def test_render_pdf_inlines_header_and_footer_images_before_pdf_generation(self) -> None:
        page = _FakePage()
        context = _FakeContext(page)
        browser = _FakeBrowser(context)
        with (
            patch.object(doc_render, "_get_shared_browser", lambda: browser),
            patch.object(doc_render, "_fetch_asset_as_data_uri", lambda url: "data:image/png;base64,QUJD"),
        ):
            pdf_bytes = doc_render.render_pdf(
                "<html><body><p>Invoice</p></body></html>",
                paper_size="A4",
                margins={"left": "12mm", "right": "12mm"},
                header_html="<div><img src='https://example.com/logo.png' alt='Logo' /></div>",
                footer_html="<div><img src='https://example.com/footer.png' alt='Footer' /></div>",
            )
        self.assertEqual(pdf_bytes, b"%PDF-1.4\nfake\n%%EOF")
        self.assertTrue(context.closed)
        self.assertIsInstance(page.pdf_args, dict)
        self.assertTrue(page.pdf_args.get("display_header_footer"))
        self.assertIn("data:image/png;base64,QUJD", page.pdf_args.get("header_template", ""))
        self.assertIn("data:image/png;base64,QUJD", page.pdf_args.get("footer_template", ""))
        self.assertNotIn("https://example.com/logo.png", page.pdf_args.get("header_template", ""))
        self.assertNotIn("https://example.com/footer.png", page.pdf_args.get("footer_template", ""))


if __name__ == "__main__":
    unittest.main()
