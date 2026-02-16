"""Supabase JWT auth middleware."""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, Optional

import httpx
import re
from jose import jwt
from jose.exceptions import JWTError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


_JWKS_CACHE: Dict[str, Any] = {"keys": None, "fetched_at": 0.0, "ttl": 600.0}
_LOCAL_ORIGIN_RE = re.compile(r"^http://(localhost|127\.0\.0\.1):\d+$")


def _attach_local_cors(request: Request, response: JSONResponse) -> JSONResponse:
    origin = request.headers.get("origin")
    if origin and _LOCAL_ORIGIN_RE.match(origin):
        response.headers.setdefault("Access-Control-Allow-Origin", origin)
        response.headers.setdefault("Access-Control-Allow-Credentials", "true")
        response.headers.setdefault("Access-Control-Allow-Headers", "*")
        response.headers.setdefault("Access-Control-Allow-Methods", "*")
        response.headers.setdefault("Vary", "Origin")
    return response


def _fetch_jwks(jwks_url: str, force: bool = False) -> dict:
    now = time.time()
    if not force and _JWKS_CACHE["keys"] and now - _JWKS_CACHE["fetched_at"] < _JWKS_CACHE["ttl"]:
        return _JWKS_CACHE["keys"]
    resp = httpx.get(jwks_url, timeout=10.0)
    resp.raise_for_status()
    data = resp.json()
    _JWKS_CACHE["keys"] = data
    _JWKS_CACHE["fetched_at"] = now
    return data


def _get_bearer_token(request: Request) -> Optional[str]:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    return auth.split(" ", 1)[1].strip() or None


def _verify_jwt(token: str, jwks_url: str, issuer: str, audience: Optional[str]) -> dict:
    jwks = _fetch_jwks(jwks_url)
    headers = jwt.get_unverified_header(token)
    kid = headers.get("kid")
    key = None
    for jwk in jwks.get("keys", []):
        if jwk.get("kid") == kid:
            key = jwk
            break
    if key is None:
        jwks = _fetch_jwks(jwks_url, force=True)
        for jwk in jwks.get("keys", []):
            if jwk.get("kid") == kid:
                key = jwk
                break
    if key is None:
        raise JWTError("Unknown kid")

    options = {"verify_aud": audience is not None}
    return jwt.decode(token, key, algorithms=[headers.get("alg", "RS256")], issuer=issuer, audience=audience, options=options)


class SupabaseAuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, supabase_url: str, audience: Optional[str] = None) -> None:
        super().__init__(app)
        self._supabase_url = supabase_url.rstrip("/")
        self._audience = audience
        self._jwks_url = f"{self._supabase_url}/auth/v1/.well-known/jwks.json"
        self._issuer = f"{self._supabase_url}/auth/v1"

    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        if os.getenv("OCTO_DISABLE_AUTH", "").strip().lower() in ("1", "true", "yes"):
            return await call_next(request)
        if request.method == "OPTIONS":
            return await call_next(request)
        if request.url.path in {"/health"}:
            return await call_next(request)

        token = _get_bearer_token(request)
        if not token:
            logger = logging.getLogger("octo.auth")
            logger.warning("auth_missing_token path=%s", request.url.path)
            return _attach_local_cors(
                request,
                JSONResponse(
                {
                    "ok": False,
                    "errors": [
                        {
                            "code": "AUTH_MISSING_TOKEN",
                            "message": "Missing bearer token",
                            "path": "Authorization",
                            "detail": None,
                        }
                    ],
                    "warnings": [],
                },
                status_code=401,
                ),
            )

        try:
            claims = _verify_jwt(token, self._jwks_url, self._issuer, self._audience)
        except Exception as exc:
            logger = logging.getLogger("octo.auth")
            logger.warning(
                "auth_invalid_token path=%s issuer=%s audience=%s error=%s",
                request.url.path,
                self._issuer,
                self._audience,
                exc,
            )
            return _attach_local_cors(
                request,
                JSONResponse(
                {
                    "ok": False,
                    "errors": [
                        {
                            "code": "AUTH_INVALID_TOKEN",
                            "message": "Invalid bearer token",
                            "path": "Authorization",
                            "detail": {"error": str(exc)},
                        }
                    ],
                    "warnings": [],
                },
                status_code=401,
                ),
            )

        request.state.user = {
            "id": claims.get("sub"),
            "email": claims.get("email"),
            "role": claims.get("role"),
            "claims": claims,
        }
        request.state.auth_ms = (time.perf_counter() - start) * 1000
        return await call_next(request)
