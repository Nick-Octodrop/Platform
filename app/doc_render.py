from __future__ import annotations

import base64
import mimetypes
import multiprocessing as mp
import os
import queue
import signal
from typing import Any
import logging
import re
import threading
import time
import traceback
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from app.email import render_template

_MARGIN_RE = re.compile(r"^(\d+(\.\d+)?)(mm|cm|in|px)$")
_IMG_SRC_RE = re.compile(r"(<img\b[^>]*?\bsrc\s*=\s*)(['\"])([^'\"]+)(\2)", re.IGNORECASE)
_CSS_URL_RE = re.compile(r"(url\(\s*)(['\"]?)(https?://[^'\"\)\s]+)(['\"]?)(\s*\))", re.IGNORECASE)
_MAX_INLINE_ASSET_BYTES = 256 * 1024
_MAX_INLINE_BACKGROUND_ASSET_BYTES = 128 * 1024
logger = logging.getLogger("octo.doc_render")
_PLAYWRIGHT_LOCK = threading.Lock()
_PLAYWRIGHT_MANAGER = None
_PLAYWRIGHT_BROWSER = None
_ASSET_CACHE_LOCK = threading.Lock()
_ASSET_DATA_URI_CACHE: dict[str, tuple[float, str, int]] = {}
_ASSET_CACHE_TTL_SECONDS = 10 * 60
_ASSET_CACHE_MAX_ITEMS = 128
_WARM_RENDERER_LOCK = threading.Lock()
_WARM_RENDERER_PROCESS = None
_WARM_RENDERER_REQUEST_QUEUE = None
_WARM_RENDERER_RESULT_QUEUE = None
_WARM_RENDERER_REQUEST_COUNT = 0


def _launch_chromium(manager: Any) -> Any:
    try:
        return manager.chromium.launch(
            headless=True,
            args=[
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no-sandbox",
                "--disable-setuid-sandbox",
            ],
        )
    except PlaywrightError as exc:
        message = str(exc)
        if "Host system is missing dependencies" in message or "install-deps" in message:
            raise RuntimeError(
                "Document renderer system dependencies are missing. Run "
                "`python -m playwright install --with-deps chromium` in the backend/worker image "
                "or `python -m playwright install-deps chromium` on this host, then restart the worker."
            ) from exc
        if "Executable doesn't exist" in message or "playwright install" in message:
            raise RuntimeError(
                "Document renderer is not installed. Run `python -m playwright install chromium` "
                "in this backend/worker environment, then restart the worker."
            ) from exc
        raise RuntimeError(f"Document renderer failed to launch: {message}") from exc


def _get_shared_browser():
    global _PLAYWRIGHT_MANAGER, _PLAYWRIGHT_BROWSER
    with _PLAYWRIGHT_LOCK:
        if _PLAYWRIGHT_MANAGER is None:
            logger.info("doc_render:init_playwright")
            _PLAYWRIGHT_MANAGER = sync_playwright().start()
        if _PLAYWRIGHT_BROWSER is None or not _PLAYWRIGHT_BROWSER.is_connected():
            logger.info("doc_render:launch_shared_browser")
            _PLAYWRIGHT_BROWSER = _launch_chromium(_PLAYWRIGHT_MANAGER)
        return _PLAYWRIGHT_BROWSER


def _render_pdf_isolated_enabled() -> bool:
    raw = os.getenv("DOC_RENDER_ISOLATED") or os.getenv("DOC_PDF_ISOLATED") or "1"
    return str(raw).strip().lower() not in {"0", "false", "no", "off"}


def _render_pdf_warm_enabled() -> bool:
    raw = os.getenv("DOC_RENDER_WARM") or os.getenv("DOC_PDF_WARM") or "1"
    return str(raw).strip().lower() not in {"0", "false", "no", "off"}


def _render_pdf_process_timeout_seconds() -> float:
    raw = (
        os.getenv("DOC_PDF_TIMEOUT_SECONDS")
        or os.getenv("DOC_RENDER_PROCESS_TIMEOUT_SECONDS")
        or os.getenv("DOC_RENDER_TIMEOUT_SECONDS")
        or "120"
    )
    try:
        value = float(raw)
    except (TypeError, ValueError):
        value = 120.0
    return max(5.0, value)


def _warm_renderer_max_jobs() -> int:
    raw = os.getenv("DOC_RENDER_WARM_MAX_JOBS") or os.getenv("DOC_PDF_WARM_MAX_JOBS") or "10"
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = 10
    return max(1, value)


def render_html(template_html: str, context: dict[str, Any]) -> str:
    return render_template(template_html or "", context, strict=True)


def _fetch_asset_as_data_uri(url: str, *, max_bytes: int = _MAX_INLINE_ASSET_BYTES) -> str:
    now = time.time()
    with _ASSET_CACHE_LOCK:
        cached = _ASSET_DATA_URI_CACHE.get(url)
        cached_size = cached[2] if cached and len(cached) >= 3 else 0
        if cached and cached_size <= max_bytes and now - cached[0] <= _ASSET_CACHE_TTL_SECONDS:
            return cached[1]
    request = Request(url, headers={"User-Agent": "Octodrop/1.0"})
    with urlopen(request, timeout=5) as response:
        payload = response.read(max_bytes + 1)
        if len(payload) > max_bytes:
            raise ValueError(f"asset too large to inline ({len(payload)} bytes > {max_bytes} bytes)")
        content_type = ""
        headers = getattr(response, "headers", None)
        if headers is not None:
            try:
                content_type = headers.get_content_type()
            except Exception:
                content_type = str(headers.get("Content-Type") or "").split(";", 1)[0].strip()
        if not content_type:
            content_type = mimetypes.guess_type(url)[0] or "application/octet-stream"
        encoded = base64.b64encode(payload).decode("ascii")
        data_uri = f"data:{content_type};base64,{encoded}"
        with _ASSET_CACHE_LOCK:
            if len(_ASSET_DATA_URI_CACHE) >= _ASSET_CACHE_MAX_ITEMS:
                _ASSET_DATA_URI_CACHE.clear()
            _ASSET_DATA_URI_CACHE[url] = (now, data_uri, len(payload))
        return data_uri


def _inline_header_footer_assets(template_html: str | None) -> str | None:
    if not isinstance(template_html, str) or not template_html.strip():
        return template_html

    def _replace(match: re.Match[str]) -> str:
        prefix = match.group(1)
        quote = match.group(2)
        source = (match.group(3) or "").strip()
        parsed = urlparse(source)
        if not source or source.startswith("data:") or parsed.scheme not in {"http", "https"}:
            return match.group(0)
        try:
            inlined = _fetch_asset_as_data_uri(source, max_bytes=_MAX_INLINE_ASSET_BYTES)
        except Exception as exc:
            logger.warning("doc_render:inline_asset_failed url=%s error=%s", source, exc)
            return match.group(0)
        return f"{prefix}{quote}{inlined}{quote}"

    def _replace_css_url(match: re.Match[str]) -> str:
        prefix = match.group(1)
        source = (match.group(3) or "").strip()
        suffix = match.group(5)
        try:
            inlined = _fetch_asset_as_data_uri(source, max_bytes=_MAX_INLINE_BACKGROUND_ASSET_BYTES)
        except Exception as exc:
            logger.warning("doc_render:inline_asset_failed url=%s error=%s", source, exc)
            return match.group(0)
        return f"{prefix}'{inlined}'{suffix}"

    with_inlined_images = _IMG_SRC_RE.sub(_replace, template_html)
    return _CSS_URL_RE.sub(_replace_css_url, with_inlined_images)


def _block_unresolved_external_requests(page: Any) -> None:
    if not hasattr(page, "route"):
        return

    def _handler(route: Any) -> None:
        try:
            url = str(getattr(getattr(route, "request", None), "url", "") or "")
            parsed = urlparse(url)
            if parsed.scheme in {"http", "https"}:
                route.abort()
                return
            route.continue_()
        except Exception:
            try:
                route.abort()
            except Exception:
                return

    try:
        page.route("**/*", _handler)
    except Exception as exc:
        logger.warning("doc_render:route_setup_failed error=%s", exc)


def normalize_margins(margins: dict | None) -> dict:
    if not isinstance(margins, dict):
        return {}
    normalized: dict = {}
    for key in ("top", "right", "bottom", "left"):
        value = str(margins.get(key) or "").strip()
        if not value:
            continue
        match = _MARGIN_RE.match(value)
        if not match:
            raise ValueError(f"Invalid margin value: {value}")
        num = float(match.group(1))
        unit = match.group(3)
        mm_val = num
        if unit == "cm":
            mm_val = num * 10.0
        elif unit == "in":
            mm_val = num * 25.4
        elif unit == "px":
            mm_val = num * 0.264583
        if mm_val < 0 or mm_val > 100:
            raise ValueError(f"Margin out of range: {value}")
        normalized[key] = value
    return normalized


def _render_pdf_with_playwright(
    html: str,
    paper_size: str | None = None,
    margins: dict | None = None,
    header_html: str | None = None,
    footer_html: str | None = None,
    *,
    shared_browser: bool = True,
    cleanup: bool = True,
) -> bytes:
    started_at = time.perf_counter()
    margin_left = (margins or {}).get("left", "0")
    margin_right = (margins or {}).get("right", "0")
    wrapped_html = _inline_header_footer_assets(html) or ""
    wrapped_header = _inline_header_footer_assets(header_html)
    wrapped_footer = _inline_header_footer_assets(footer_html)
    if header_html:
        wrapped_header = (
            f'<div style="width:100%;box-sizing:border-box;padding-left:{margin_left};padding-right:{margin_right};">'
            f"{wrapped_header or ''}"
            "</div>"
        )
    if footer_html:
        wrapped_footer = (
            f'<div style="width:100%;box-sizing:border-box;padding-left:{margin_left};padding-right:{margin_right};">'
            f"{wrapped_footer or ''}"
            "</div>"
        )
    logger.info(
        "doc_render:start html_chars=%s wrapped_html_chars=%s header_chars=%s footer_chars=%s paper_size=%s",
        len(html or ""),
        len(wrapped_html or ""),
        len(wrapped_header or ""),
        len(wrapped_footer or ""),
        paper_size or "",
    )
    context = None
    browser = None
    manager = None
    try:
        if shared_browser:
            browser = _get_shared_browser()
        else:
            logger.info("doc_render:init_playwright")
            manager = sync_playwright().start()
            logger.info("doc_render:launch_browser")
            browser = _launch_chromium(manager)
        context = browser.new_context()
        logger.info("doc_render:context_created")
        page = context.new_page()
        logger.info("doc_render:page_created")
        _block_unresolved_external_requests(page)
        page.set_default_timeout(15000)
        page.set_content(wrapped_html, wait_until="domcontentloaded", timeout=15000)
        logger.info("doc_render:content_set")
        try:
            page.wait_for_load_state("load", timeout=2000)
            logger.info("doc_render:load_state_complete")
        except PlaywrightTimeoutError:
            logger.info("doc_render:load_state_timeout")
        pdf_args: dict = {}
        if paper_size:
            pdf_args["format"] = paper_size
        if margins:
            pdf_args["margin"] = margins
        pdf_args["print_background"] = True
        if header_html or footer_html:
            pdf_args["display_header_footer"] = True
            pdf_args["header_template"] = wrapped_header or "<span></span>"
            pdf_args["footer_template"] = wrapped_footer or "<span></span>"
        logger.info("doc_render:pdf_start")
        pdf_bytes = page.pdf(**pdf_args)
        logger.info(
            "doc_render:pdf_complete bytes=%s total_ms=%.1f",
            len(pdf_bytes or b""),
            (time.perf_counter() - started_at) * 1000.0,
        )
        return pdf_bytes
    finally:
        if cleanup:
            if context is not None:
                try:
                    context.close()
                except Exception:
                    pass
            if not shared_browser and browser is not None:
                try:
                    browser.close()
                except Exception:
                    pass
            if manager is not None:
                try:
                    manager.stop()
                except Exception:
                    pass


def _render_pdf_child(
    result_queue: Any,
    html: str,
    paper_size: str | None,
    margins: dict | None,
    header_html: str | None,
    footer_html: str | None,
) -> None:
    global _PLAYWRIGHT_BROWSER, _PLAYWRIGHT_MANAGER
    _PLAYWRIGHT_BROWSER = None
    _PLAYWRIGHT_MANAGER = None
    try:
        if hasattr(os, "setsid"):
            os.setsid()
    except Exception:
        pass
    try:
        pdf_bytes = _render_pdf_with_playwright(
            html,
            paper_size=paper_size,
            margins=margins,
            header_html=header_html,
            footer_html=footer_html,
            shared_browser=False,
            cleanup=False,
        )
        result_queue.put({"ok": True, "pdf": pdf_bytes})
    except BaseException as exc:
        result_queue.put(
            {
                "ok": False,
                "error_type": type(exc).__name__,
                "error": str(exc) or type(exc).__name__,
                "traceback": traceback.format_exc(),
            }
        )


def _terminate_render_process(process: Any) -> None:
    if not process.is_alive():
        return
    if os.name != "nt" and hasattr(os, "killpg"):
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        except Exception:
            pass
        process.join(5)
    if process.is_alive():
        process.terminate()
        process.join(5)
    if process.is_alive() and hasattr(process, "kill"):
        process.kill()
        process.join(5)


def _warm_renderer_child(request_queue: Any, result_queue: Any, max_jobs: int) -> None:
    global _PLAYWRIGHT_BROWSER, _PLAYWRIGHT_MANAGER
    _PLAYWRIGHT_BROWSER = None
    _PLAYWRIGHT_MANAGER = None
    try:
        if hasattr(os, "setsid"):
            os.setsid()
    except Exception:
        pass
    jobs_completed = 0
    try:
        logger.info("doc_render:warm_start max_jobs=%s", max_jobs)
        logger.info("doc_render:init_playwright")
        _PLAYWRIGHT_MANAGER = sync_playwright().start()
        logger.info("doc_render:launch_warm_browser")
        _PLAYWRIGHT_BROWSER = _launch_chromium(_PLAYWRIGHT_MANAGER)
        result_queue.put({"kind": "ready"})
        while jobs_completed < max_jobs:
            request = request_queue.get()
            if not isinstance(request, dict):
                continue
            if request.get("kind") == "stop":
                break
            request_id = str(request.get("id") or "")
            if not request_id:
                continue
            try:
                pdf_bytes = _render_pdf_with_playwright(
                    str(request.get("html") or ""),
                    paper_size=request.get("paper_size"),
                    margins=request.get("margins") if isinstance(request.get("margins"), dict) else None,
                    header_html=request.get("header_html"),
                    footer_html=request.get("footer_html"),
                    shared_browser=True,
                    cleanup=False,
                )
                result_queue.put({"kind": "result", "id": request_id, "ok": True, "pdf": pdf_bytes})
            except BaseException as exc:
                result_queue.put(
                    {
                        "kind": "result",
                        "id": request_id,
                        "ok": False,
                        "error_type": type(exc).__name__,
                        "error": str(exc) or type(exc).__name__,
                        "traceback": traceback.format_exc(),
                    }
                )
            jobs_completed += 1
        logger.info("doc_render:warm_exit jobs_completed=%s", jobs_completed)
    except BaseException as exc:
        try:
            result_queue.put(
                {
                    "kind": "fatal",
                    "ok": False,
                    "error_type": type(exc).__name__,
                    "error": str(exc) or type(exc).__name__,
                    "traceback": traceback.format_exc(),
                }
            )
        except Exception:
            pass


def _start_warm_renderer_locked() -> None:
    global _WARM_RENDERER_PROCESS, _WARM_RENDERER_REQUEST_QUEUE, _WARM_RENDERER_RESULT_QUEUE, _WARM_RENDERER_REQUEST_COUNT
    if _WARM_RENDERER_PROCESS is not None and _WARM_RENDERER_PROCESS.is_alive():
        return
    start_method = "fork" if "fork" in mp.get_all_start_methods() else "spawn"
    ctx = mp.get_context(start_method)
    _WARM_RENDERER_REQUEST_QUEUE = ctx.Queue(maxsize=1)
    _WARM_RENDERER_RESULT_QUEUE = ctx.Queue(maxsize=8)
    _WARM_RENDERER_PROCESS = ctx.Process(
        target=_warm_renderer_child,
        args=(_WARM_RENDERER_REQUEST_QUEUE, _WARM_RENDERER_RESULT_QUEUE, _warm_renderer_max_jobs()),
        daemon=True,
    )
    _WARM_RENDERER_REQUEST_COUNT = 0
    logger.info("doc_render:warm_process_start start_method=%s", start_method)
    _WARM_RENDERER_PROCESS.start()


def _stop_warm_renderer_locked() -> None:
    global _WARM_RENDERER_PROCESS, _WARM_RENDERER_REQUEST_QUEUE, _WARM_RENDERER_RESULT_QUEUE, _WARM_RENDERER_REQUEST_COUNT
    process = _WARM_RENDERER_PROCESS
    request_queue = _WARM_RENDERER_REQUEST_QUEUE
    if process is not None and process.is_alive():
        try:
            if request_queue is not None:
                request_queue.put_nowait({"kind": "stop"})
        except Exception:
            pass
        process.join(1)
        if process.is_alive():
            _terminate_render_process(process)
    _WARM_RENDERER_PROCESS = None
    _WARM_RENDERER_REQUEST_QUEUE = None
    _WARM_RENDERER_RESULT_QUEUE = None
    _WARM_RENDERER_REQUEST_COUNT = 0


def prewarm_pdf_renderer(*, wait: bool = False) -> None:
    if not _render_pdf_warm_enabled():
        return
    timeout_seconds = min(45.0, _render_pdf_process_timeout_seconds())
    with _WARM_RENDERER_LOCK:
        _start_warm_renderer_locked()
        if not wait or _WARM_RENDERER_RESULT_QUEUE is None:
            return
        deadline = time.perf_counter() + timeout_seconds
        while time.perf_counter() < deadline:
            try:
                message = _WARM_RENDERER_RESULT_QUEUE.get(timeout=0.25)
            except queue.Empty:
                if _WARM_RENDERER_PROCESS is None or not _WARM_RENDERER_PROCESS.is_alive():
                    raise RuntimeError("Warm PDF renderer exited during prewarm")
                continue
            if isinstance(message, dict) and message.get("kind") == "ready":
                logger.info("doc_render:warm_ready")
                return
            if isinstance(message, dict) and message.get("kind") == "fatal":
                raise RuntimeError(f"Warm PDF renderer failed to start: {message.get('error') or 'unknown error'}")
        raise TimeoutError(f"Warm PDF renderer did not become ready within {timeout_seconds:g} seconds")


def _render_pdf_with_warm_process(
    html: str,
    paper_size: str | None = None,
    margins: dict | None = None,
    header_html: str | None = None,
    footer_html: str | None = None,
) -> bytes:
    global _WARM_RENDERER_REQUEST_COUNT
    timeout_seconds = _render_pdf_process_timeout_seconds()
    request_id = f"{os.getpid()}-{time.time_ns()}"
    request = {
        "kind": "render",
        "id": request_id,
        "html": html,
        "paper_size": paper_size,
        "margins": margins,
        "header_html": header_html,
        "footer_html": footer_html,
    }
    started_at = time.perf_counter()
    with _WARM_RENDERER_LOCK:
        _start_warm_renderer_locked()
        if _WARM_RENDERER_PROCESS is None or _WARM_RENDERER_REQUEST_QUEUE is None or _WARM_RENDERER_RESULT_QUEUE is None:
            raise RuntimeError("Warm PDF renderer did not start")
        _WARM_RENDERER_REQUEST_QUEUE.put(request, timeout=2)
        _WARM_RENDERER_REQUEST_COUNT += 1
        deadline = time.perf_counter() + timeout_seconds
        while True:
            remaining = deadline - time.perf_counter()
            if remaining <= 0:
                logger.error("doc_render:warm_timeout pid=%s timeout_seconds=%s", _WARM_RENDERER_PROCESS.pid, timeout_seconds)
                _stop_warm_renderer_locked()
                raise TimeoutError(f"Warm PDF render timed out after {timeout_seconds:g} seconds")
            try:
                message = _WARM_RENDERER_RESULT_QUEUE.get(timeout=min(0.25, max(0.01, remaining)))
            except queue.Empty:
                if not _WARM_RENDERER_PROCESS.is_alive():
                    _stop_warm_renderer_locked()
                    raise RuntimeError("Warm PDF renderer exited without a result")
                continue
            if not isinstance(message, dict):
                continue
            if message.get("kind") == "ready":
                logger.info("doc_render:warm_ready")
                continue
            if message.get("kind") == "fatal":
                _stop_warm_renderer_locked()
                raise RuntimeError(f"Warm PDF renderer failed: {message.get('error') or 'unknown error'}")
            if message.get("kind") != "result" or message.get("id") != request_id:
                continue
            if not message.get("ok"):
                logger.error(
                    "doc_render:warm_failed type=%s error=%s traceback=%s",
                    message.get("error_type"),
                    message.get("error"),
                    message.get("traceback"),
                )
                _stop_warm_renderer_locked()
                raise RuntimeError(f"Warm PDF render failed: {message.get('error') or 'unknown error'}")
            pdf_bytes = message.get("pdf")
            if not isinstance(pdf_bytes, (bytes, bytearray)):
                _stop_warm_renderer_locked()
                raise RuntimeError("Warm PDF render returned invalid output")
            logger.info(
                "doc_render:warm_complete bytes=%s total_ms=%.1f",
                len(pdf_bytes),
                (time.perf_counter() - started_at) * 1000.0,
            )
            if _WARM_RENDERER_REQUEST_COUNT >= _warm_renderer_max_jobs():
                logger.info("doc_render:warm_restart_after_jobs count=%s", _WARM_RENDERER_REQUEST_COUNT)
                _stop_warm_renderer_locked()
            return bytes(pdf_bytes)


def _render_pdf_in_subprocess(
    html: str,
    paper_size: str | None = None,
    margins: dict | None = None,
    header_html: str | None = None,
    footer_html: str | None = None,
) -> bytes:
    timeout_seconds = _render_pdf_process_timeout_seconds()
    start_method = "fork" if "fork" in mp.get_all_start_methods() else "spawn"
    ctx = mp.get_context(start_method)
    result_queue = ctx.Queue(maxsize=1)
    process = ctx.Process(
        target=_render_pdf_child,
        args=(result_queue, html, paper_size, margins, header_html, footer_html),
        daemon=True,
    )
    started_at = time.perf_counter()
    logger.info("doc_render:subprocess_start timeout_seconds=%s start_method=%s", timeout_seconds, start_method)
    process.start()
    deadline = time.perf_counter() + timeout_seconds
    result = None
    while result is None:
        remaining = deadline - time.perf_counter()
        if remaining <= 0:
            break
        try:
            result = result_queue.get(timeout=min(0.25, max(0.01, remaining)))
            break
        except queue.Empty:
            if not process.is_alive():
                try:
                    result = result_queue.get(timeout=2)
                    break
                except queue.Empty:
                    raise RuntimeError(f"Document PDF render process exited without a result (exitcode={process.exitcode})")
    if result is None:
        logger.error("doc_render:subprocess_timeout pid=%s timeout_seconds=%s", process.pid, timeout_seconds)
        _terminate_render_process(process)
        raise TimeoutError(f"Document PDF render timed out after {timeout_seconds:g} seconds")
    if process.is_alive():
        _terminate_render_process(process)
    if not isinstance(result, dict) or not result.get("ok"):
        logger.error("doc_render:subprocess_failed type=%s error=%s traceback=%s", result.get("error_type"), result.get("error"), result.get("traceback"))
        raise RuntimeError(f"Document PDF render failed: {result.get('error') or 'unknown error'}")
    pdf_bytes = result.get("pdf")
    if not isinstance(pdf_bytes, (bytes, bytearray)):
        raise RuntimeError("Document PDF render returned invalid output")
    logger.info(
        "doc_render:subprocess_complete bytes=%s total_ms=%.1f",
        len(pdf_bytes),
        (time.perf_counter() - started_at) * 1000.0,
    )
    return bytes(pdf_bytes)


def render_pdf(
    html: str,
    paper_size: str | None = None,
    margins: dict | None = None,
    header_html: str | None = None,
    footer_html: str | None = None,
) -> bytes:
    if _render_pdf_warm_enabled():
        try:
            return _render_pdf_with_warm_process(
                html,
                paper_size=paper_size,
                margins=margins,
                header_html=header_html,
                footer_html=footer_html,
            )
        except Exception as exc:
            logger.warning("doc_render:warm_fallback error=%s", exc)
    if _render_pdf_isolated_enabled():
        return _render_pdf_in_subprocess(
            html,
            paper_size=paper_size,
            margins=margins,
            header_html=header_html,
            footer_html=footer_html,
        )
    return _render_pdf_with_playwright(
        html,
        paper_size=paper_size,
        margins=margins,
        header_html=header_html,
        footer_html=footer_html,
        shared_browser=True,
    )
