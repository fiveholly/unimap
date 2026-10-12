"""Nostr: link a Nostr key to an address, post to Nostr too, and send tips as zaps.

Nostr is an open social protocol many Bitcoin people use. Everything here is signed in the
person's browser by a Nostr extension (NIP-07: Alby, nos2x and the like); unimap never sees a
Nostr private key and never talks to relays itself.

- 绑定: the extension signs a short-lived event (kind 22242, as in NIP-42, which relays don't
  keep) saying which address it links to. A wallet group (api/wallets.py) has one key, kept
  under its main address, like its Lightning address.
- 同步到 Nostr: after a post is up, the browser signs a note (kind 1) with the post's text and
  its link, sends it to relays and tells us its id, so the post can link to it. We check the
  note is the author's linked key and carries the post.
- Zap (NIP-57): a tip to someone who linked a key, through a Lightning address that takes zaps,
  carries a zap request (kind 9734) signed by the tipper's extension. The recipient's wallet
  publishes the receipt, so the tip shows on Nostr as well.
"""

import hashlib
import json
import re
import time

from coincurve import PublicKeyXOnly
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api import wallets
from api.auth import current_address
from api.db import cursor

router = APIRouter()

LINK_KIND = 22242
NOTE_KIND = 1
ZAP_REQUEST_KIND = 9734
LINK_SECONDS = 600  # a link event must be this fresh
MAX_EVENT = 16 * 1024
HEX64 = re.compile(r"^[0-9a-f]{64}$")
HEX128 = re.compile(r"^[0-9a-f]{128}$")


def link_text(address):
    """What the link event says; the extension shows it to the person before signing."""
    return f"unimap: link this Nostr key to {address}"


def event_id(ev):
    """NIP-01: sha256 of the event's canonical serialization."""
    data = [0, ev["pubkey"], ev["created_at"], ev["kind"], ev["tags"], ev["content"]]
    return hashlib.sha256(json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def valid(ev):
    """True if ev is a well-formed event whose id and BIP-340 signature check out."""
    try:
        if not (isinstance(ev, dict) and HEX64.match(ev["pubkey"]) and HEX64.match(ev["id"]) and HEX128.match(ev["sig"])):
            return False
        if not (isinstance(ev["created_at"], int) and isinstance(ev["kind"], int) and isinstance(ev["content"], str)):
            return False
        if not (isinstance(ev["tags"], list) and all(isinstance(t, list) and all(isinstance(x, str) for x in t) for t in ev["tags"])):
            return False
        if len(json.dumps(ev)) > MAX_EVENT or event_id(ev) != ev["id"]:
            return False
        return PublicKeyXOnly(bytes.fromhex(ev["pubkey"])).verify(bytes.fromhex(ev["sig"]), bytes.fromhex(ev["id"]))
    except (KeyError, TypeError, ValueError):
        return False


def tag(ev, name):
    """The first value of ev's tag called name, or None."""
    return next((t[1] for t in ev["tags"] if len(t) > 1 and t[0] == name), None)


def require(ev, kind):
    if not valid(ev):
        raise HTTPException(400, "this Nostr event isn't signed correctly")
    if ev["kind"] != kind:
        raise HTTPException(400, f"expected a kind {kind} Nostr event")
    return ev


def of(cur, address):
    """The Nostr public key (hex) linked to address's wallet group, or None."""
    if not address:
        return None
    cur.execute("select pubkey from social.nostr_keys where address = %s;", (wallets.main_of(cur, address),))
    row = cur.fetchone()
    return row[0] if row else None


class EventBody(BaseModel):
    event: dict


@router.get("/v1/me/nostr")
def my_nostr(address: str = Depends(current_address)):
    with cursor() as cur:
        return {"pubkey": of(cur, address)}


@router.put("/v1/me/nostr")
def link(req: EventBody, address: str = Depends(current_address)):
    ev = require(req.event, LINK_KIND)
    if ev["content"] != link_text(address):
        raise HTTPException(400, "the signed text doesn't name this address")
    if abs(time.time() - ev["created_at"]) > LINK_SECONDS:
        raise HTTPException(400, "this signature is too old, sign again")
    with cursor() as cur:
        main = wallets.main_of(cur, address)
        cur.execute("select address from social.nostr_keys where pubkey = %s and address <> %s;", (ev["pubkey"], main))
        if cur.fetchone():
            raise HTTPException(409, "this Nostr key is already linked to another address")
        cur.execute(
            "insert into social.nostr_keys (address, pubkey) values (%s, %s) "
            "on conflict (address) do update set pubkey = excluded.pubkey, linked_at = now();",
            (main, ev["pubkey"]),
        )
    return {"pubkey": ev["pubkey"]}


@router.delete("/v1/me/nostr")
def unlink(address: str = Depends(current_address)):
    with cursor() as cur:
        cur.execute("delete from social.nostr_keys where address = %s;", (wallets.main_of(cur, address),))
    return {"pubkey": None}


@router.post("/v1/posts/{post_id}/nostr")
def mirrored(post_id: int, req: EventBody, address: str = Depends(current_address)):
    """Record the Nostr note the author published for this post."""
    ev = require(req.event, NOTE_KIND)
    with cursor() as cur:
        cur.execute("select author_address, body from social.posts where id = %s and removed_at is null and agent_id is null;", (post_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(404, "no such post")
        author, body = row
        if wallets.main_of(cur, author) != wallets.main_of(cur, address):
            raise HTTPException(403, "only the author can post this to Nostr")
        if ev["pubkey"] != of(cur, address):
            raise HTTPException(400, "sign with the Nostr key linked to this address")
        if body.strip() not in ev["content"] or not re.search(rf"https?://\S+/post/{post_id}(?!\d)", ev["content"]):
            raise HTTPException(400, "the note should carry the post's text and its link")
        cur.execute("update social.posts set nostr_event_id = %s where id = %s;", (ev["id"], post_id))
    return {"nostr_event_id": ev["id"]}


def zap_request(ev, recipient_pubkey, amount_msat, note_id):
    """Check a NIP-57 zap request for a tip; returns it as the JSON the wallet's callback takes."""
    require(ev, ZAP_REQUEST_KIND)
    if tag(ev, "p") != recipient_pubkey:
        raise HTTPException(400, "the zap request isn't for this person's Nostr key")
    amount = tag(ev, "amount")
    if amount is not None and amount != str(amount_msat):
        raise HTTPException(400, "the zap request's amount isn't the tip's")
    e = tag(ev, "e")
    if e is not None and e != note_id:
        raise HTTPException(400, "the zap request names a different note")
    if not any(t and t[0] == "relays" and len(t) > 1 for t in ev["tags"]):
        raise HTTPException(400, "the zap request should name relays for the receipt")
    return json.dumps(ev, separators=(",", ":"), ensure_ascii=False)
