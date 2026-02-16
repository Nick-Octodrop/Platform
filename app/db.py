"""DB helper for Supabase Postgres."""

from __future__ import annotations

import os
import time
from contextlib import contextmanager
import contextvars
from typing import Any, Iterable

import psycopg2
import psycopg2.extras
from psycopg2.pool import SimpleConnectionPool
import threading
import logging


def get_db_url() -> str:
    url = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("SUPABASE_DB_URL or DATABASE_URL is required when USE_DB=1")
    return url


_POOL: SimpleConnectionPool | None = None
_DB_MS = 0.0
_DB_LOCK = threading.Lock()
_logger = logging.getLogger("octo.db")
_query_logger = logging.getLogger("octo.db.query")
_ACTIVE_CONN: contextvars.ContextVar[Any | None] = contextvars.ContextVar("octo_db_active_conn", default=None)
_DB_STATS: contextvars.ContextVar[dict] = contextvars.ContextVar("octo_db_stats", default=None)
_DB_QUERY_LOG: contextvars.ContextVar[list] = contextvars.ContextVar("octo_db_query_log", default=None)
_APP_ENV = os.getenv("APP_ENV", os.getenv("ENV", "dev")).strip().lower() or "dev"
_IS_DEV = _APP_ENV == "dev"
_SLOW_MS = float(os.getenv("OCTO_QUERY_SLOW_MS", "200"))
_LOG_ALL = os.getenv("OCTO_QUERY_LOG", "").strip() == "1"
_EXPLAIN_SLOW = _IS_DEV and os.getenv("OCTO_QUERY_EXPLAIN", "").strip() == "1"


def _redact_params(params: Iterable[Any] | None) -> list[Any] | None:
    if params is None:
        return None
    redacted: list[Any] = []
    for val in params:
        if isinstance(val, (bytes, bytearray)):
            redacted.append(f"<bytes:{len(val)}>")
        elif isinstance(val, str) and len(val) > 80:
            redacted.append(f"{val[:40]}…{val[-10:]}")
        else:
            redacted.append(val)
    return redacted


def _should_explain(sql: str) -> bool:
    head = sql.lstrip().lower()
    return head.startswith("select") or head.startswith("with")


def _log_query(
    *,
    query_name: str | None,
    sql: str,
    params: Iterable[Any] | None,
    elapsed_ms: float,
    rowcount: int | None,
    wire_ms: float | None = None,
    decode_ms: float | None = None,
) -> None:
    log = get_db_query_log()
    log.append(query_name or "unnamed")
    _DB_QUERY_LOG.set(log)
    if not query_name and not _LOG_ALL and elapsed_ms < _SLOW_MS:
        return
    message = {
        "query": query_name or "unnamed",
        "ms": round(elapsed_ms, 2),
        "wire_ms": round(wire_ms or 0.0, 2),
        "decode_ms": round(decode_ms or 0.0, 2),
        "rowcount": rowcount,
        "params": _redact_params(params),
    }
    if elapsed_ms >= _SLOW_MS:
        _query_logger.warning("db_slow_query=%s", message)
    else:
        _query_logger.info("db_query=%s", message)


def init_pool(minconn: int | None = None, maxconn: int | None = None) -> None:
    global _POOL
    if _POOL is None:
        if minconn is None:
            minconn = int(os.getenv("OCTO_DB_POOL_MIN", "1"))
        if maxconn is None:
            maxconn = int(os.getenv("OCTO_DB_POOL_MAX", "10"))
        _POOL = SimpleConnectionPool(minconn, maxconn, dsn=get_db_url())


def reset_db_ms() -> None:
    global _DB_MS
    with _DB_LOCK:
        _DB_MS = 0.0
    _DB_STATS.set({"queries": 0, "acquire_ms": 0.0, "execute_ms": 0.0, "wire_ms": 0.0, "decode_ms": 0.0, "total_ms": 0.0})
    _DB_QUERY_LOG.set([])


def get_db_stats() -> dict:
    stats = _DB_STATS.get()
    if not isinstance(stats, dict):
        return {"queries": 0, "acquire_ms": 0.0, "execute_ms": 0.0, "wire_ms": 0.0, "decode_ms": 0.0, "total_ms": 0.0}
    return stats


def get_db_query_log() -> list:
    log = _DB_QUERY_LOG.get()
    if not isinstance(log, list):
        return []
    return log


def add_db_ms(delta: float) -> None:
    global _DB_MS
    with _DB_LOCK:
        _DB_MS += delta
    stats = get_db_stats()
    stats["total_ms"] = stats.get("total_ms", 0.0) + delta
    stats["queries"] = stats.get("queries", 0) + 1
    _DB_STATS.set(stats)


def add_db_acquire_ms(delta: float) -> None:
    stats = get_db_stats()
    stats["acquire_ms"] = stats.get("acquire_ms", 0.0) + delta
    _DB_STATS.set(stats)


def add_db_wire_ms(delta: float) -> None:
    stats = get_db_stats()
    stats["wire_ms"] = stats.get("wire_ms", 0.0) + delta
    stats["execute_ms"] = stats.get("execute_ms", 0.0) + delta
    _DB_STATS.set(stats)


def add_db_decode_ms(delta: float) -> None:
    stats = get_db_stats()
    stats["decode_ms"] = stats.get("decode_ms", 0.0) + delta
    _DB_STATS.set(stats)


def get_db_ms() -> float:
    with _DB_LOCK:
        return _DB_MS


def _get_pool() -> SimpleConnectionPool:
    if _POOL is None:
        init_pool()
    return _POOL


def set_active_conn(conn) -> None:
    _ACTIVE_CONN.set(conn)


def clear_active_conn() -> None:
    _ACTIVE_CONN.set(None)


def get_active_conn():
    return _ACTIVE_CONN.get()


@contextmanager
def get_conn():
    active = get_active_conn()
    if active is not None:
        yield active
        return
    pool = _get_pool()
    acquire_start = time.perf_counter()
    conn = pool.getconn()
    acquire_ms = (time.perf_counter() - acquire_start) * 1000
    add_db_acquire_ms(acquire_ms)
    _logger.info("db_conn borrowed")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)
        _logger.info("db_conn returned")


def fetch_one(conn, sql: str, params: Iterable[Any] | None = None, query_name: str | None = None) -> dict | None:
    start = time.perf_counter()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        exec_start = time.perf_counter()
        cur.execute(sql, params or [])
        wire_ms = (time.perf_counter() - exec_start) * 1000
        decode_start = time.perf_counter()
        row = cur.fetchone()
        decode_ms = (time.perf_counter() - decode_start) * 1000
        result = dict(row) if row else None
        rowcount = cur.rowcount
    elapsed_ms = (time.perf_counter() - start) * 1000
    add_db_ms(elapsed_ms)
    add_db_wire_ms(wire_ms)
    add_db_decode_ms(decode_ms)
    _log_query(
        query_name=query_name,
        sql=sql,
        params=params,
        elapsed_ms=elapsed_ms,
        rowcount=rowcount,
        wire_ms=wire_ms,
        decode_ms=decode_ms,
    )
    if _EXPLAIN_SLOW and elapsed_ms >= _SLOW_MS and _should_explain(sql):
        with conn.cursor() as cur:
            cur.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) " + sql, params or [])
            plan = "\n".join(r[0] for r in cur.fetchall())
            _query_logger.warning("db_query_explain=%s\n%s", query_name or "unnamed", plan)
    return result


def fetch_all(conn, sql: str, params: Iterable[Any] | None = None, query_name: str | None = None) -> list[dict]:
    start = time.perf_counter()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        exec_start = time.perf_counter()
        cur.execute(sql, params or [])
        wire_ms = (time.perf_counter() - exec_start) * 1000
        decode_start = time.perf_counter()
        rows = cur.fetchall()
        result = [dict(r) for r in rows]
        decode_ms = (time.perf_counter() - decode_start) * 1000
        rowcount = cur.rowcount
    elapsed_ms = (time.perf_counter() - start) * 1000
    add_db_ms(elapsed_ms)
    add_db_wire_ms(wire_ms)
    add_db_decode_ms(decode_ms)
    _log_query(
        query_name=query_name,
        sql=sql,
        params=params,
        elapsed_ms=elapsed_ms,
        rowcount=rowcount,
        wire_ms=wire_ms,
        decode_ms=decode_ms,
    )
    if _EXPLAIN_SLOW and elapsed_ms >= _SLOW_MS and _should_explain(sql):
        with conn.cursor() as cur:
            cur.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) " + sql, params or [])
            plan = "\n".join(r[0] for r in cur.fetchall())
            _query_logger.warning("db_query_explain=%s\n%s", query_name or "unnamed", plan)
    return result


def execute(conn, sql: str, params: Iterable[Any] | None = None, query_name: str | None = None) -> int:
    start = time.perf_counter()
    with conn.cursor() as cur:
        exec_start = time.perf_counter()
        cur.execute(sql, params or [])
        wire_ms = (time.perf_counter() - exec_start) * 1000
        rowcount = cur.rowcount
    elapsed_ms = (time.perf_counter() - start) * 1000
    add_db_ms(elapsed_ms)
    add_db_wire_ms(wire_ms)
    _log_query(
        query_name=query_name,
        sql=sql,
        params=params,
        elapsed_ms=elapsed_ms,
        rowcount=rowcount,
        wire_ms=wire_ms,
        decode_ms=0.0,
    )
    return rowcount
