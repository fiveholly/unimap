"""Linking an X (Twitter) account to an address (绑定 X).

The owner of an address signs in to X with OAuth 2.0 (authorization code with PKCE) and we
keep the X account it came back with: its id, @username, display name and picture. Nothing
else is kept, not even the access token, and we never post for anyone. The account then
shows next to the address: on districts it owns and on its posts, with a link to the profile.

Set X_CLIENT_ID (and X_CLIENT_SECRET for a confidential "Web App" client) from the X developer
portal, and register X_REDIRECT_URL there; it defaults to https://$DOMAIN/x/callback, the web
page that hands the code back to POST /v1/x/link/finish.
"""

import base64
import hashlib
import logging
import os
import secrets
import urllib.parse
from datetime import datetime, timedelta, timezone

import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth import current_address
from api.db import cursor

log = logging.getLogger(__name__)
router = APIRouter()

AUTHORIZE_URL = "https://x.com/i/oauth2/authorize"
SCOPES = "users.read tweet.read"  # users.read needs tweet.read; both only read
STATE_TTL = timedelta(minutes=10)


def settings():
    client_id = os.getenv("X_CLIENT_ID") or ""
    redirect = os.getenv("X_REDIRECT_URL") or (f"https://{os.getenv('DOMAIN')}/x/callback" if os.getenv("DOMAIN") else "")
    return client_id, os.getenv("X_CLIENT_SECRET") or "", redirect


class XApi:
    """X API v2 (https://docs.x.com): trades a code for a token, then asks who signed in."""

    def __init__(self, url=None):
        self.url = (url or os.getenv("X_API_URL") or "https://api.x.com").rstrip("/")

    def user(self, code, verifier, client_id, secret, redirect):
        """{id, username, name, profile_image_url} of the account that signed in."""
        auth = (client_id, secret) if secret else None
        r = requests.post(
            self.url + "/2/oauth2/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect,
                "code_verifier": verifier,
                **({} if secret else {"client_id": client_id}),
            },
            auth=auth,
            timeout=15,
        )
        r.raise_for_status()
        token = r.json()["access_token"]
        try:
            r = requests.get(
                self.url + "/2/users/me",
                params={"user.fields": "profile_image_url"},
                headers={"Authorization": f"Bearer {token}"},
                timeout=15,
            )
            r.raise_for_status()
            return r.json()["data"]
        finally:
            # We only needed to know who it was; give the token back.
            try:
                requests.post(
                    self.url + "/2/oauth2/revoke",
                    data={"token": token, "token_type_hint": "access_token", **({} if secret else {"client_id": client_id})},
                    auth=auth,
                    timeout=10,
                )
            except requests.RequestException:
                pass


provider = None  # tests put a fake here


def _provider():
    global provider
    if provider is None:
        provider = XApi()
    return provider


def _challenge(verifier):
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


def view(row):
    """{username, name, avatar_url, url} for an x_accounts row of (username, name, avatar_url)."""
    if not row or not row[0]:
        return None
    username, name, avatar = row
    return {"username": username, "name": name, "avatar_url": avatar, "url": f"https://x.com/{username}"}


def of(cur, address):
    if not address:
        return None
    cur.execute("select username, name, avatar_url from social.x_accounts where address = %s;", (address,))
    return view(cur.fetchone())


def handles(cur, addresses):
    """{address: username} for whichever of addresses have linked X."""
    addresses = [a for a in set(addresses) if a]
    if not addresses:
        return {}
    cur.execute("select address, username from social.x_accounts where address = any(%s);", (addresses,))
    return dict(cur.fetchall())


@router.get("/v1/x/link")
def linked(address: str = Depends(current_address)):
    client_id, _, redirect = settings()
    with cursor() as cur:
        return {"available": bool(client_id and redirect), "x": of(cur, address)}


@router.post("/v1/x/link/start")
def start(address: str = Depends(current_address)):
    """Where to send the browser to sign in to X."""
    client_id, _, redirect = settings()
    if not client_id or not redirect:
        raise HTTPException(503, "linking X isn't set up on this server")
    state, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(48)
    with cursor() as cur:
        cur.execute("delete from social.x_link_states where expires_at < now();")
        cur.execute(
            "insert into social.x_link_states (state, address, verifier, expires_at) values (%s, %s, %s, %s);",
            (state, address, verifier, datetime.now(timezone.utc) + STATE_TTL),
        )
    query = urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect,
            "scope": SCOPES,
            "state": state,
            "code_challenge": _challenge(verifier),
            "code_challenge_method": "S256",
        },
        quote_via=urllib.parse.quote,
    )
    return {"url": f"{AUTHORIZE_URL}?{query}"}


class Finish(BaseModel):
    code: str
    state: str


@router.post("/v1/x/link/finish")
def finish(req: Finish, address: str = Depends(current_address)):
    """The code X sent back to the callback page: link the account that signed in."""
    client_id, secret, redirect = settings()
    with cursor() as cur:
        # Spend the state first, so a code can't be tried twice.
        cur.execute(
            "delete from social.x_link_states where state = %s and address = %s and expires_at > now() returning verifier;",
            (req.state, address),
        )
        row = cur.fetchone()
    if row is None:
        raise HTTPException(400, "this X sign-in expired or was started by another address; try again")
    try:
        user = _provider().user(req.code, row[0], client_id, secret, redirect)
    except Exception as e:  # X is outside our control
        log.warning("x link for %s: %s", address, e)
        raise HTTPException(502, "X didn't confirm the sign-in; try again")
    with cursor() as cur:
        cur.execute(
            "insert into social.x_accounts (address, x_user_id, username, name, avatar_url) values (%s, %s, %s, %s, %s) "
            "on conflict (address) do update set x_user_id = excluded.x_user_id, username = excluded.username, "
            "name = excluded.name, avatar_url = excluded.avatar_url, linked_at = now();",
            (address, str(user["id"]), user["username"], user.get("name") or user["username"], user.get("profile_image_url")),
        )
        return {"x": of(cur, address)}


@router.delete("/v1/x/link")
def unlink(address: str = Depends(current_address)):
    with cursor() as cur:
        cur.execute("delete from social.x_accounts where address = %s;", (address,))
    return {"x": None}
