"""Linking wallets together (关联钱包): one person often keeps land and collections in
different addresses. While signed in with one address, they sign a message with another to
prove they hold it too; the two then form a group, and the pets a district can show count
what the whole group holds.

A group has a main address (the one signed in when the first link was made) and the
addresses linked to it. An address belongs to one group at most; to move it, unlink it first.
Linking says nothing about land: roles, posting and admin rights stay with each address.
"""

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from api import bip322
from api.auth import NONCE_TTL, current_address, normalize_address
from api.db import cursor

router = APIRouter()

MAX_LINKED = 10  # addresses besides the main one


def link_message(main, address, nonce, expires_at):
    return (
        "Link this wallet on unimap\n"
        f"address: {address}\n"
        f"to: {main}\n"
        f"nonce: {nonce}\n"
        f"expires: {expires_at.strftime('%Y-%m-%dT%H:%M:%SZ')}"
    )


def main_of(cur, address):
    cur.execute("select main_address from social.wallet_links where address = %s;", (address,))
    row = cur.fetchone()
    return row[0] if row else address


def group(cur, address):
    """The addresses in address's group, main first; just [address] when it is linked to none."""
    main = main_of(cur, address)
    cur.execute("select address from social.wallet_links where main_address = %s order by linked_at, address;", (main,))
    return [main] + [r[0] for r in cur.fetchall()]


def groups(cur, addresses):
    """{address: [addresses in its group]} for many addresses at once."""
    cur.execute(
        "with a(address) as (select unnest(%s::text[])), "
        "g as (select a.address, coalesce(l.main_address, a.address) as main from a "
        "left join social.wallet_links l on l.address = a.address) "
        "select g.address, g.main, l.address from g left join social.wallet_links l on l.main_address = g.main;",
        (list(addresses),),
    )
    out = {}
    for address, main, member in cur.fetchall():
        out.setdefault(address, [main])
        if member:
            out[address].append(member)
    return out


def view(cur, address):
    members = group(cur, address)
    return [{"address": a, "main": i == 0, "me": a == address} for i, a in enumerate(members)]


class NonceRequest(BaseModel):
    address: str


class LinkRequest(BaseModel):
    address: str
    nonce: str
    signature: str


def _linkable(cur, me, other):
    if other == me or other in group(cur, me):
        raise HTTPException(409, "already in your wallets")
    if main_of(cur, other) != other:
        raise HTTPException(409, "that wallet is linked elsewhere; unlink it there first")
    cur.execute("select 1 from social.wallet_links where main_address = %s limit 1;", (other,))
    if cur.fetchone():
        raise HTTPException(409, "that wallet has wallets of its own linked; unlink them there first")
    if len(group(cur, me)) > MAX_LINKED:
        raise HTTPException(400, f"at most {MAX_LINKED} linked wallets")


@router.get("/v1/me/wallets")
def wallets(address: str = Depends(current_address)):
    with cursor() as cur:
        return {"wallets": view(cur, address)}


@router.post("/v1/me/wallets/nonce")
def nonce(req: NonceRequest, address: str = Depends(current_address)):
    """The message the other wallet signs. It names both addresses, so it can't sign anyone in."""
    other = normalize_address(req.address)
    try:
        bip322.script_pubkey(other)
    except ValueError as e:
        raise HTTPException(400, f"unsupported address: {e}")
    value = secrets.token_hex(16)
    expires_at = datetime.now(timezone.utc).replace(microsecond=0) + NONCE_TTL
    with cursor() as cur:
        _linkable(cur, address, other)
        message = link_message(main_of(cur, address), other, value, expires_at)
        cur.execute("delete from social.login_nonces where expires_at < now();")
        cur.execute(
            "insert into social.login_nonces (nonce, address, message, expires_at) values (%s, %s, %s, %s);",
            (value, other, message, expires_at),
        )
    return {"nonce": value, "message": message, "expires_at": expires_at.isoformat()}


@router.post("/v1/me/wallets")
def link(req: LinkRequest, tasks: BackgroundTasks, address: str = Depends(current_address)):
    from api import holdings

    other = normalize_address(req.address)
    with cursor() as cur:
        cur.execute(
            "update social.login_nonces set used_at = now() where nonce = %s and address = %s and used_at is null "
            "and expires_at > now() and message like 'Link this wallet on unimap%%' returning message;",
            (req.nonce, other),
        )
        row = cur.fetchone()
    if row is None:
        raise HTTPException(401, "unknown, used or expired nonce")
    try:
        ok = bip322.verify(other, row[0], req.signature)
    except bip322.Unsupported as e:
        raise HTTPException(400, str(e))
    if not ok:
        raise HTTPException(401, "bad signature")
    with cursor() as cur:
        main = main_of(cur, address)
        if f"\nto: {main}\n" not in row[0]:
            raise HTTPException(409, "your wallets changed; try again")
        _linkable(cur, address, other)
        cur.execute("insert into social.wallet_links (address, main_address) values (%s, %s);", (other, main))
        result = {"wallets": view(cur, address)}
    tasks.add_task(holdings.refresh, other, holdings.MIN_REFRESH_MINUTES)
    return result


@router.delete("/v1/me/wallets/{other}")
def unlink(other: str, address: str = Depends(current_address)):
    """Takes a linked wallet out of the group; any member can, the main address stays."""
    other = normalize_address(other)
    with cursor() as cur:
        members = group(cur, address)
        if other not in members[1:]:
            raise HTTPException(404, "not one of your linked wallets")
        cur.execute("delete from social.wallet_links where address = %s;", (other,))
        return {"wallets": view(cur, address)}
