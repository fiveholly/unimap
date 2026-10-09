"""Postgres access for the API (settings from .env, as for parcel_index)."""

import os
from contextlib import contextmanager

import psycopg2.extras
import psycopg2.pool
from dotenv import find_dotenv, load_dotenv

load_dotenv(find_dotenv(usecwd=True))

_pool = None


def _get_pool():
    global _pool
    if _pool is None:
        _pool = psycopg2.pool.ThreadedConnectionPool(
            1,
            int(os.getenv("API_DB_POOL") or "8"),
            host=os.getenv("DB_HOST") or "localhost",
            port=int(os.getenv("DB_PORT") or "5432"),
            database=os.getenv("DB_DATABASE") or "postgres",
            user=os.getenv("DB_USER") or "postgres",
            password=os.getenv("DB_PASSWD"),
        )
    return _pool


@contextmanager
def cursor(dict_rows=False):
    """A cursor in its own transaction: committed on success, rolled back on error."""
    pool = _get_pool()
    conn = pool.getconn()
    try:
        factory = psycopg2.extras.RealDictCursor if dict_rows else None
        with conn:
            with conn.cursor(cursor_factory=factory) as cur:
                yield cur
    finally:
        pool.putconn(conn)
