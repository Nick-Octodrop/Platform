from __future__ import annotations

import io
import logging
from pathlib import Path

from app.attachments import store_bytes

logger = logging.getLogger("octo.attachment_thumbnails")


def is_pdf_attachment(filename: str | None, mime_type: str | None) -> bool:
    mime = str(mime_type or "").split(";", 1)[0].strip().lower()
    if mime == "application/pdf":
        return True
    return Path(str(filename or "")).suffix.lower() == ".pdf"


def render_pdf_thumbnail(pdf_bytes: bytes | bytearray, *, width: int = 794) -> bytes:
    try:
        import pypdfium2 as pdfium
        from PIL import Image
    except Exception as exc:
        raise RuntimeError("PDF thumbnail rendering requires pypdfium2 and Pillow") from exc

    document = None
    page = None
    bitmap = None
    try:
        document = pdfium.PdfDocument(bytes(pdf_bytes or b""))
        if len(document) <= 0:
            raise ValueError("PDF has no pages")
        page = document[0]
        page_width, _page_height = page.get_size()
        scale = max(0.5, min(3.0, float(width) / max(float(page_width or width), 1.0)))
        bitmap = page.render(scale=scale, rotation=0)
        image = bitmap.to_pil()
        if image.mode not in {"RGB", "RGBA"}:
            image = image.convert("RGB")
        if image.mode == "RGBA":
            background = Image.new("RGB", image.size, "white")
            background.paste(image, mask=image.getchannel("A"))
            image = background
        output = io.BytesIO()
        image.save(output, format="PNG", optimize=True)
        return output.getvalue()
    finally:
        for item in (bitmap, page, document):
            close = getattr(item, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    pass


def build_pdf_thumbnail_payload(org_id: str, filename: str | None, pdf_bytes: bytes | bytearray) -> dict:
    thumbnail_bytes = render_pdf_thumbnail(pdf_bytes)
    stored = store_bytes(org_id, f"{Path(str(filename or 'document')).stem or 'document'}.thumbnail.png", thumbnail_bytes, mime_type="image/png")
    return {
        "thumbnail_storage_key": stored.get("storage_key"),
        "thumbnail_mime_type": "image/png",
        "thumbnail_size": stored.get("size"),
        "thumbnail_sha256": stored.get("sha256"),
        "thumbnail_bucket": stored.get("bucket"),
    }


def maybe_build_pdf_thumbnail_payload(
    org_id: str,
    filename: str | None,
    mime_type: str | None,
    data: bytes | bytearray,
) -> dict:
    if not is_pdf_attachment(filename, mime_type):
        return {}
    try:
        return build_pdf_thumbnail_payload(org_id, filename, data)
    except Exception as exc:
        logger.warning("pdf_thumbnail_generate_failed filename=%s error=%s", filename or "", exc)
        return {}

