"""Wallet login: the server issues a one-time message, the wallet signs it
(BIP-322 or legacy message signing), and the server hands back a bearer token."""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from api import bip322
from api.db import cursor

router = APIRouter()

NONCE_TTL = timedelta(minutes=10)
SESSION_TTL = timedelta(days=30)


def normalize_address(address):
    address = address.strip()
    if address[:3].lower() in ("bc1", "tb1") or address[:5].lower() == "bcrt1":
        return address.lower()
    return address


def login_message(address, nonce, expires_at):
    return (
        "Sign in to unimap\n"
        f"address: {address}\n"
        f"nonce: {nonce}\n"
        f"expires: {expires_at.strftime('%Y-%m-%dT%H:%M:%SZ')}"
    )


def _hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


class NonceRequest(BaseModel):
    address: str


class LoginRequest(BaseModel):
    address: str
    nonce: str
    signature: str


@router.post("/v1/auth/nonce")
def nonce(req: NonceRequest):
    address = normalize_address(req.address)
    try:
        bip322.script_pubkey(address)
    except ValueError as e:
        raise HTTPException(400, f"unsupported address: {e}")
    value = secrets.token_hex(16)
    expires_at = datetime.now(timezone.utc).replace(microsecond=0) + NONCE_TTL
    message = login_message(address, value, expires_at)
    with cursor() as cur:
        cur.execute("delete from social.login_nonces where expires_at < now();")
        cur.execute(
            "insert into social.login_nonces (nonce, address, message, expires_at) values (%s, %s, %s, %s);",
            (value, address, message, expires_at),
        )
    return {"nonce": value, "message": message, "expires_at": expires_at.isoformat()}


@router.post("/v1/auth/login")
def login(req: LoginRequest):
    address = normalize_address(req.address)
    # Spend the nonce first, in its own transaction, so a failed attempt can't be retried.
    with cursor() as cur:
        cur.execute(
            "update social.login_nonces set used_at = now() "
            "where nonce = %s and address = %s and used_at is null and expires_at > now() returning message;",
            (req.nonce, address),
        )
        row = cur.fetchone()
    if row is None:
        raise HTTPException(401, "unknown, used or expired nonce")
    try:
        ok = bip322.verify(address, row[0], req.signature)
    except bip322.Unsupported as e:
        raise HTTPException(400, str(e))
    if not ok:
        raise HTTPException(401, "bad signature")
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + SESSION_TTL
    with cursor() as cur:
        cur.execute(
            "insert into social.sessions (token_hash, address, expires_at) values (%s, %s, %s);",
            (_hash_token(token), address, expires_at),
        )
    return {"token": token, "address": address, "expires_at": expires_at.isoformat()}


def _session_address(authorization):
    if not authorization or not authorization.startswith("Bearer "):
        return None
    with cursor() as cur:
        cur.execute(
            "select address from social.sessions where token_hash = %s and expires_at > now();",
            (_hash_token(authorization[7:]),),
        )
        row = cur.fetchone()
    return None if row is None else row[0]


def optional_address(authorization: str | None = Header(default=None)):
    return _session_address(authorization)


def current_address(authorization: str | None = Header(default=None)):
    address = _session_address(authorization)
    if address is None:
        raise HTTPException(401, "sign in first")
    return address


@router.post("/v1/auth/logout")
def logout(authorization: str | None = Header(default=None), _: str = Depends(current_address)):
    with cursor() as cur:
        cur.execute("delete from social.sessions where token_hash = %s;", (_hash_token(authorization[7:]),))
    return {"ok": True}
