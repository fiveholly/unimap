"""私信: one-to-one messages between addresses, first for 同块人 (api/capsule.py) to say hello.

Signed in with the wallet like every other write (a bearer token from api/auth.py); a banned
address can't send. Whoever someone muted for themselves (social.notify_mutes, api/notify.py) can't
message them either, and anyone can turn off messages from strangers: addresses they never wrote
to. A recipient can report a message (api/moderation.py); only then does an admin see it.
A new message is told as a notification, one at a time per sender until it is read.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import bip322, moderation, notify
from api.auth import current_address, normalize_address
from api.db import cursor

router = APIRouter()

MAX_BODY = 1000
PER_MINUTE = 20
NEW_PEERS_PER_DAY = 30  # conversations an address may start in a day
PAGE = 50


def _peer(address, peer):
    peer = normalize_address(peer)
    try:
        bip322.script_pubkey(peer)
    except ValueError:
        raise HTTPException(400, "not an address")
    if peer == address:
        raise HTTPException(400, "that's you")
    return peer


def _message(row, me):
    i, sender, body, at, read_at, removed = row
    return {
        "id": i,
        "from_me": sender == me,
        "body": None if removed else body,
        "removed": removed,
        "created_at": at.isoformat(),
        "read": read_at is not None,
    }


def strangers_on(cur, address):
    cur.execute("select strangers from social.dm_settings where address = %s;", (address,))
    row = cur.fetchone()
    return True if row is None else row[0]


def wrote_to(cur, sender, recipient):
    cur.execute("select 1 from social.dms where sender = %s and recipient = %s limit 1;", (sender, recipient))
    return cur.fetchone() is not None


def blocked(cur, address, by):
    """True if by muted address (api/notify.py's mutes): nothing from address reaches by."""
    cur.execute("select 1 from social.notify_mutes where address = %s and muted = %s;", (by, address))
    return cur.fetchone() is not None


def can_send(cur, sender, recipient):
    """None if sender may write to recipient now, else why not."""
    if blocked(cur, sender, recipient):
        return "blocked"
    if not strangers_on(cur, recipient) and not wrote_to(cur, recipient, sender):
        return "strangers_off"
    return None


@router.get("/v1/dms")
def conversations(address: str = Depends(current_address)):
    """Everyone the address has written to or heard from, latest first, with the last message and how many are unread."""
    with cursor() as cur:
        cur.execute(
            "select distinct on (peer) peer, id, sender, body, created_at, read_at, removed_at is not null from ("
            "  select case when sender = %(a)s then recipient else sender end as peer, * from social.dms "
            "  where sender = %(a)s or recipient = %(a)s"
            ") m order by peer, id desc;",
            {"a": address},
        )
        last = cur.fetchall()
        cur.execute(
            "select sender, count(*) from social.dms where recipient = %s and read_at is null and removed_at is null group by sender;",
            (address,),
        )
        unread = dict(cur.fetchall())
    rows = [{"peer": r[0], "last": _message(r[1:], address), "unread": unread.get(r[0], 0)} for r in last]
    rows.sort(key=lambda c: c["last"]["id"], reverse=True)
    return {"conversations": rows, "unread": sum(unread.values())}


@router.get("/v1/dms/unread")
def unread(address: str = Depends(current_address)):
    with cursor() as cur:
        cur.execute("select count(*) from social.dms where recipient = %s and read_at is null and removed_at is null;", (address,))
        return {"unread": cur.fetchone()[0]}


@router.get("/v1/dms/{peer}")
def thread(peer: str, before: int | None = None, address: str = Depends(current_address)):
    """The messages with peer, oldest first (PAGE before before); reading them marks them read."""
    peer = _peer(address, peer)
    with cursor() as cur:
        cur.execute(
            "select id, sender, body, created_at, read_at, removed_at is not null from social.dms "
            "where ((sender = %(a)s and recipient = %(p)s) or (sender = %(p)s and recipient = %(a)s)) "
            "and (%(before)s::int8 is null or id < %(before)s) order by id desc limit %(n)s;",
            {"a": address, "p": peer, "before": before, "n": PAGE},
        )
        rows = cur.fetchall()[::-1]
        cur.execute(
            "update social.dms set read_at = now() where recipient = %s and sender = %s and read_at is null;", (address, peer)
        )
        cur.execute(
            "update social.notifications set read_at = now() where address = %s and kind = 'dm' and actor = %s and read_at is null;",
            (address, peer),
        )
        why_not = can_send(cur, address, peer)
        i_blocked = blocked(cur, peer, address)
    return {
        "peer": peer,
        "messages": [_message(r, address) for r in rows],
        "more": len(rows) == PAGE,
        "can_send": why_not is None,
        "why_not": why_not,  # blocked | strangers_off
        "blocked_by_me": i_blocked,
    }


class NewMessage(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_BODY)


@router.post("/v1/dms/{peer}", status_code=201)
def send(peer: str, req: NewMessage, address: str = Depends(moderation.writer_address)):
    peer = _peer(address, peer)
    body = req.body.strip()
    if not body:
        raise HTTPException(400, "say something")
    with cursor() as cur:
        why_not = can_send(cur, address, peer)
        if why_not == "blocked":
            raise HTTPException(403, "they don't take messages from you")
        if why_not == "strangers_off":
            raise HTTPException(403, "they only take messages from people they wrote to")
        cur.execute("select count(*) from social.dms where sender = %s and created_at > now() - interval '1 minute';", (address,))
        if cur.fetchone()[0] >= PER_MINUTE:
            raise HTTPException(429, "slow down")
        if not wrote_to(cur, address, peer) and not wrote_to(cur, peer, address):
            cur.execute(
                "select count(*) from (select recipient, min(created_at) as first from social.dms where sender = %(a)s "
                "group by recipient) f where f.first > now() - interval '1 day' "
                "and not exists (select 1 from social.dms e where e.sender = f.recipient and e.recipient = %(a)s);",
                {"a": address},
            )
            if cur.fetchone()[0] >= NEW_PEERS_PER_DAY:
                raise HTTPException(429, "too many new conversations today")
        cur.execute(
            "insert into social.dms (sender, recipient, body) values (%s, %s, %s) "
            "returning id, sender, body, created_at, read_at, removed_at is not null;",
            (address, peer, body),
        )
        row = cur.fetchone()
        # One notification per sender until it is read: a burst of messages is one line in the bell.
        cur.execute(
            "select 1 from social.notifications where address = %s and kind = 'dm' and actor = %s and read_at is null;", (peer, address)
        )
        if cur.fetchone() is None:
            notify.notify(cur, peer, "dm", address, 0, dm_id=row[0])
    return _message(row, address)


class Settings(BaseModel):
    strangers: bool


@router.get("/v1/me/dm-settings")
def get_settings(address: str = Depends(current_address)):
    with cursor() as cur:
        return {"strangers": strangers_on(cur, address)}


@router.put("/v1/me/dm-settings")
def put_settings(req: Settings, address: str = Depends(current_address)):
    """strangers false: only people this address wrote to can message it."""
    with cursor() as cur:
        cur.execute(
            "insert into social.dm_settings (address, strangers) values (%s, %s) "
            "on conflict (address) do update set strangers = excluded.strangers;",
            (address, req.strangers),
        )
    return {"strangers": req.strangers}


class ReportBody(BaseModel):
    reason: str
    note: str = Field(default="", max_length=500)


@router.post("/v1/dms/messages/{message_id}/report")
def report(message_id: int, req: ReportBody, address: str = Depends(current_address)):
    """Only the recipient can report a message, and the report shows it to the site admins."""
    with cursor() as cur:
        cur.execute("select 1 from social.dms where id = %s and recipient = %s and removed_at is null;", (message_id, address))
        if cur.fetchone() is None:
            raise HTTPException(404, "no such message to you")
        moderation.report_item(cur, "dm", message_id, address, req.reason, req.note)
    return {"ok": True}
