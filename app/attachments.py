from __future__ import annotations

import hashlib
import os
from pathlib import Path
from urllib.parse import quote

import httpx


def _supabase_url() -> str:
    return (os.getenv("SUPABASE_URL") or "").strip().rstrip("/")


def _supabase_service_role_key() -> str:
    return (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()


def _supabase_enabled() -> bool:
    return bool(_supabase_url() and _supabase_service_role_key())


def using_supabase_storage() -> bool:
    return _supabase_enabled()


def attachments_bucket() -> str:
    return (os.getenv("SUPABASE_STORAGE_BUCKET_ATTACHMENTS") or "attachments").strip()


def branding_bucket() -> str:
    return (os.getenv("SUPABASE_STORAGE_BUCKET_BRANDING") or "branding").strip()


def _storage_root() -> Path:
    root = os.getenv("OCTO_STORAGE_DIR", "storage")
    return Path(root)


def _supabase_headers(content_type: str | None = None) -> dict:
    headers = {
        "Authorization": f"Bearer {_supabase_service_role_key()}",
        "apikey": _supabase_service_role_key(),
        "x-upsert": "true",
    }
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def _supabase_upload(bucket: str, storage_key: str, data: bytes, mime_type: str | None = None) -> None:
    path = quote(storage_key, safe="/")
    url = f"{_supabase_url()}/storage/v1/object/{bucket}/{path}"
    with httpx.Client(timeout=30.0) as client:
        res = client.post(url, headers=_supabase_headers(mime_type), content=data)
        if res.status_code >= 400:
            raise RuntimeError(f"supabase_upload_failed:{res.status_code}:{res.text}")


def _supabase_download(bucket: str, storage_key: str) -> bytes:
    path = quote(storage_key, safe="/")
    url = f"{_supabase_url()}/storage/v1/object/{bucket}/{path}"
    with httpx.Client(timeout=30.0) as client:
        res = client.get(url, headers=_supabase_headers())
        if res.status_code >= 400:
            raise FileNotFoundError(f"supabase_download_failed:{res.status_code}")
        return res.content


def _supabase_delete(bucket: str, storage_key: str) -> bool:
    path = quote(storage_key, safe="/")
    url = f"{_supabase_url()}/storage/v1/object/{bucket}/{path}"
    with httpx.Client(timeout=30.0) as client:
        res = client.delete(url, headers=_supabase_headers())
        # 404s are fine during cleanup.
        return res.status_code < 500


def public_url(bucket: str, storage_key: str) -> str:
    path = quote(storage_key, safe="/")
    return f"{_supabase_url()}/storage/v1/object/public/{bucket}/{path}"


def store_bytes(org_id: str, filename: str, data: bytes, mime_type: str | None = None, bucket: str | None = None) -> dict:
    digest = hashlib.sha256(data).hexdigest()
    safe_name = filename.replace("..", "_").replace("/", "_")
    storage_key = f"{org_id}/{digest}_{safe_name}"
    selected_bucket = (bucket or attachments_bucket()).strip()
    if _supabase_enabled():
        _supabase_upload(selected_bucket, storage_key, data, mime_type=mime_type)
        path = None
    else:
        folder = _storage_root() / org_id
        folder.mkdir(parents=True, exist_ok=True)
        local_key = f"{digest}_{safe_name}"
        path_obj = folder / local_key
        path_obj.write_bytes(data)
        storage_key = local_key
        path = str(path_obj)
    return {
        "storage_key": storage_key,
        "sha256": digest,
        "size": len(data),
        "path": path,
        "bucket": selected_bucket,
    }


def resolve_path(org_id: str, storage_key: str) -> Path:
    if _supabase_enabled():
        raise RuntimeError("resolve_path is unavailable when using Supabase storage")
    return _storage_root() / org_id / storage_key


def read_bytes(org_id: str, storage_key: str, bucket: str | None = None) -> bytes:
    selected_bucket = (bucket or attachments_bucket()).strip()
    if _supabase_enabled():
        return _supabase_download(selected_bucket, storage_key)
    path = resolve_path(org_id, storage_key)
    return path.read_bytes()


def delete_storage(org_id: str, storage_key: str, bucket: str | None = None) -> bool:
    selected_bucket = (bucket or attachments_bucket()).strip()
    try:
        if _supabase_enabled():
            return _supabase_delete(selected_bucket, storage_key)
        path = resolve_path(org_id, storage_key)
        if path.exists():
            path.unlink()
        return True
    except Exception:
        return False
