"""unimap API: land (indexer data) and social.

Run: uvicorn api.app:app   (DB settings from .env, as for parcel_index)
Social tables: psql -f api/social.sql
"""

import os
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from api import agent, auth, billing, capsule, dms, events, gift, game, market, holdings, land, listings, metrics, moderation, newcomer, nostr, notify, opening, parks, pets, polls, recruit, search, seasons, shop, social, style, tenants, tips, tour, wallets, xlink

WRITES = ("POST", "PUT", "PATCH", "DELETE")
AUTH_PATHS = ("/v1/auth/nonce", "/v1/auth/login")
LOCAL = ("127.0.0.1", "::1")


def client_ip(scope):
    """The caller's IP. Behind Caddy (a request from this machine) it is the last hop of
    X-Forwarded-For, which Caddy sets; uvicorn's --proxy-headers has usually done this already."""
    host = (scope.get("client") or ("", 0))[0]
    if host in LOCAL:
        forwarded = dict(scope.get("headers") or []).get(b"x-forwarded-for")
        if forwarded:
            return forwarded.decode("latin-1").split(",")[-1].strip()
    return host


class RateLimit:
    """Per-IP token buckets for writes: RATE_LIMIT_WRITES a minute for any POST, PUT, PATCH or
    DELETE (default 60), and RATE_LIMIT_AUTH a minute for asking for a sign-in nonce and signing
    in (default 20, so 10 sign-ins). 0 turns one off. Too many gets 429. The buckets live in each
    process, and the API runs 2 uvicorn workers, so in practice an IP gets up to twice these.
    A write with a valid X-API-Key (api/billing.py) counts against the key instead, at its tier's limit."""

    MAX_KEYS = 50_000

    def __init__(self, app):
        self.app = app
        self.buckets = {}  # (kind, ip) -> (tokens, last time)

    def take(self, kind, ip, per_minute):
        now = time.monotonic()
        tokens, last = self.buckets.get((kind, ip), (per_minute, now))
        tokens = min(per_minute, tokens + (now - last) * per_minute / 60)
        if len(self.buckets) > self.MAX_KEYS:
            self.buckets.clear()  # many IPs at once; start over rather than grow without bound
        if tokens < 1:
            self.buckets[(kind, ip)] = (tokens, now)
            return False
        self.buckets[(kind, ip)] = (tokens - 1, now)
        return True

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["method"] in WRITES:
            auth_call = scope["method"] == "POST" and scope["path"] in AUTH_PATHS
            kind = "auth" if auth_call else "writes"
            per_minute = int(os.getenv("RATE_LIMIT_AUTH" if auth_call else "RATE_LIMIT_WRITES") or (20 if auth_call else 60))
            who = client_ip(scope)
            key = None if auth_call or per_minute <= 0 else dict(scope.get("headers") or []).get(b"x-api-key")
            tier = key and await run_in_threadpool(billing.key_tier, key.decode("latin-1"))
            if tier:
                kind, who, per_minute = "key", key, billing.key_writes(tier)
            if per_minute > 0 and not self.take(kind, who, per_minute):
                response = JSONResponse({"detail": "too many requests, slow down"}, status_code=429, headers={"Retry-After": "60"})
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


app = FastAPI(title="unimap API")
app.add_middleware(RateLimit)
origins = [o for o in (os.getenv("API_CORS_ORIGINS") or "").split(",") if o]
if origins:
    app.add_middleware(
        CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["Authorization", "Content-Type"]
    )
app.include_router(land.router)
app.include_router(auth.router)
app.include_router(social.router)
for extra in (billing, gift, capsule, dms, recruit, polls, style, parks, holdings, pets, notify, xlink, wallets, search, moderation, listings, tips, game, seasons, events, market, agent, shop, metrics, nostr, tour, tenants, opening, newcomer):
    app.include_router(extra.router)
