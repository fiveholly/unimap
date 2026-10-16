"""时间胶囊 (time capsules): a letter for the future, sealed on unimap.

The browser encrypts the letter with AES-GCM under a random key and sends the ciphertext and the
key. The sender's wallet signs capsule_message(...), which names the ciphertext's sha256, so the
letter can be checked without trusting this server. unimap keeps the key in escrow and hands it out
only once the capsule is open; the sender also gets the key once, as the spare key for the
recipient (in the share link's #fragment, which never reaches a server), so the recipient can
always read it early. Keys are always "两份都留": there is no choice to make.

When it opens: at the first block whose header time is at or past open_at. Block times come from
bitcoind and are kept in social.block_times; a binary search finds the block, then the dozen blocks
before it are checked, since header times may run a little out of order. With no bitcoind to ask
(a test server), it opens at the first block indexed after open_at was seen to have passed
(due_tip), which is the same block whenever someone looks in time and at most a block or two
late otherwise. Opening is worked out when a capsule is read, and by sweep() once a block.

open_at must be at least CAPSULE_MIN_LEAD seconds ahead (default a day); a demo or test server
sets it to a few minutes to try a whole seal and open.

同块人: the sender may add a public one-liner and a tag. Those (and the short address) are all that
is shown to others who sealed on the same block, within ±6 blocks or on the same UTC day; the
letter never is. The author can take the line down, and anyone can report it (api/moderation.py).

Tiers, while the product `capsule` sells (api/billing.py: BILLING_PRICE_CAPSULE_SATS and a
Lightning address). With billing off every capsule is tier 'open': everything free, no limits.
- free (免费体验): one per wallet group, text only, the default envelope, opening at most FREE_DAYS
  after sealing.
- paid (封存): any open_at up to MAX_YEARS, one photo, any envelope STYLE, and 「信打开了」 told to
  the sender (and the recipient, when the label is an address that has signed in here). It is
  stored 'pending' (not listed, not on 同块人, key escrowed) with an invoice from the billing flow;
  billing's on_settled hook (seal_paid) seals it at the tip of that moment. Unpaid ones are
  deleted once PENDING_MINUTES have passed and their invoices are no longer pending (sweep()).
The photo is encrypted in the browser under the letter's key; fingerprint is the sha256 of the
letter's bytes followed by the photo's, so a signature covers both (with no photo it is the letter's
alone, as before). The style is presentation only and isn't signed.

sweep() runs once per new block, from the background task that draws the block's treasure
(api/game.py ensure_soon, on the first map request after the tip moves): it opens and tells
capsules whose time has come, and clears unpaid ones. There is no other scheduler.
"""

import base64
import binascii
import hashlib
import logging
import math
import os
import secrets
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import billing, bip322, moderation, notify
from api.auth import current_address, normalize_address, optional_address
from api.db import cursor

router = APIRouter()
log = logging.getLogger(__name__)

BLOCK_SECONDS = 600
TAGS = ("birth", "wedding", "farewell", "start", "other")
MAX_RECIPIENT = 64  # a label, or a Bitcoin address (62 characters for taproot)
MAX_LINE = 80
MAX_CIPHERTEXT = 8200  # base64: a 2,000-character letter, its iv and tag
MAX_YEARS = 100
SIGNED_AT_SKEW = 600
PER_HOUR = 20
HOUR_BLOCKS = 6  # ±6 blocks: about an hour either side
LOOK_BACK = 12  # blocks before the binary search's answer that may still be first (times run out of order)
PEERS_PAGE = 100
TIERS = ("free", "paid")  # what a writer picks while billing is on; 'open' is the tier with billing off
STYLES = ("classic", "midnight", "celadon", "dusk")  # envelopes; classic is the free one
FREE_PER_WALLET = 1
FREE_DAYS = 366  # a free capsule opens within a year of sealing
MAX_PHOTO = 420_000  # base64: a ~300 KB image after the browser shrinks it, its iv and tag
PENDING_MINUTES = 60  # an unpaid capsule waits this long, as long as its invoice is checked (api/tips.py)
INSCRIBE_SATS = 20_000  # 刻上链, shown as coming soon; not sold


def min_lead():
    try:
        return max(0, int(os.getenv("CAPSULE_MIN_LEAD") or 86400))
    except ValueError:
        return 86400


def inscribe_sats():
    try:
        return max(0, int(os.getenv("CAPSULE_INSCRIBE_SATS") or INSCRIBE_SATS))
    except ValueError:
        return INSCRIBE_SATS


def selling():
    """True while 封存 is for sale, and so the free tier has limits."""
    return billing.price("capsule") > 0


def _group(cur, address):
    """wallets.group, for a cursor of either kind of row: address's wallet group, main first."""
    cur.execute(
        "with m as (select coalesce((select main_address from social.wallet_links where address = %s), %s) as a) "
        "select a, 0 as o from m union all select l.address, 1 from social.wallet_links l, m where l.main_address = m.a order by o;",
        (address, address),
    )
    return [r["a"] if isinstance(r, dict) else r[0] for r in cur.fetchall()]


def free_used(cur, address):
    """Free capsules sealed by address's wallet group."""
    cur.execute("select count(*) as n from social.capsules where author = any(%s) and tier = 'free';", (_group(cur, address),))
    row = cur.fetchone()
    return row["n"] if isinstance(row, dict) else row[0]


def iso(unix):
    return datetime.fromtimestamp(unix, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def capsule_message(recipient, open_at, fingerprint, line, tag, signed_at):
    """The exact text the wallet signs to seal a capsule. Must match capsuleMessage in web/lib/capsule.ts."""
    return "\n".join(
        [
            "unimap time capsule",
            f"to: {recipient}",
            f"open-at: {iso(open_at)}",
            f"sha256: {fingerprint}",
            f"public: {line if line else 'none'}",
            f"tag: {tag if tag else 'none'}",
            f"time: {signed_at}",
        ]
    )


# --- block times -------------------------------------------------------------------------

_down_until = 0.0


def fetch_block_time(height):
    """The block's header time from bitcoind (unix seconds), or None if it can't be asked.
    After a failure it isn't asked again for a minute. Tests replace this."""
    global _down_until
    if time.monotonic() < _down_until:
        return None
    from api import land

    try:
        btc = land._bitcoind()
        return int(btc.block_time(btc.block_hash(height)))
    except Exception:
        _down_until = time.monotonic() + 60
        return None


class NoTimes(Exception):
    pass


def block_time(cur, height):
    cur.execute("select block_time from social.block_times where block_height = %s;", (height,))
    row = cur.fetchone()
    if row:
        return row["block_time"] if isinstance(row, dict) else row[0]
    t = fetch_block_time(height)
    if t is None:
        raise NoTimes()
    cur.execute("insert into social.block_times (block_height, block_time) values (%s, %s) on conflict do nothing;", (height, t))
    return t


def first_block_at(cur, when, lo, hi):
    """The first block in lo..hi whose time is at or past when (unix seconds), or None if none is yet.
    Raises NoTimes when block times can't be had."""
    if lo > hi or block_time(cur, hi) < when:
        return None
    a, b = lo, hi
    while a < b:
        mid = (a + b) // 2
        if block_time(cur, mid) >= when:
            b = mid
        else:
            a = mid + 1
    for h in range(max(lo, a - LOOK_BACK), a):
        if block_time(cur, h) >= when:
            return h
    return a


def tip(cur):
    cur.execute("select max(block_height) as tip from bitmap_block_hashes;")
    row = cur.fetchone()
    return row["tip"] if isinstance(row, dict) else row[0]


def check_open(cur, row, tip_height, now=None):
    """The capsule's opening block, working it out (and saving it) if it has come; None while sealed."""
    if row["open_height"] is not None:
        return row["open_height"]
    now = time.time() if now is None else now
    when = int(row["open_at"].timestamp())
    if now < when or tip_height is None:
        return None
    try:
        block_time(cur, tip_height)  # whether block times can be had at all
        h = first_block_at(cur, when, row["sealed_height"] + 1, tip_height)
    except NoTimes:
        # No block times: the next block after open_at was first seen to have passed.
        if row["due_tip"] is None:
            cur.execute("update social.capsules set due_tip = %s where id = %s and due_tip is null;", (tip_height, row["id"]))
            row["due_tip"] = tip_height
            return None
        h = row["due_tip"] + 1 if tip_height > row["due_tip"] else None
    if h is not None:
        cur.execute("update social.capsules set open_height = %s where id = %s;", (h, row["id"]))
        row["open_height"] = h
    return h


def blocks_left(open_at, now=None):
    """Blocks still to come before open_at, at ten minutes a block; at least 1 while sealed."""
    now = time.time() if now is None else now
    return max(1, math.ceil((open_at - now) / BLOCK_SECONDS))


COLUMNS = (
    "id, ref, author, recipient, ciphertext, fingerprint, escrow_key, open_at, sealed_height, sealed_at, "
    "line, tag, line_removed_by, signed_message, signature, due_tip, open_height, tier, status, photo, style, notified_at"
)


def tell(cur, row):
    """「你的信打开了」, once, to the sender and to the recipient if the label is an address seen here.
    The free tier isn't told."""
    if row["tier"] == "free" or row["notified_at"] is not None or row["open_height"] is None:
        return
    cur.execute("update social.capsules set notified_at = now() where id = %s and notified_at is null returning 1;", (row["id"],))
    if cur.fetchone() is None:
        return
    row["notified_at"] = datetime.now(timezone.utc)
    notify.notify(cur, row["author"], "capsule_open", "", 0, block_height=row["open_height"], capsule_id=row["id"])
    to = normalize_address(row["recipient"])
    if to != row["author"] and " " not in to and len(to) >= 14:
        cur.execute("select 1 from social.sessions where address = %s limit 1;", (to,))
        if cur.fetchone() is not None:
            notify.notify(cur, to, "capsule_open", row["author"], 0, block_height=row["open_height"], capsule_id=row["id"])


def view(cur, row, viewer, tip_height, full=True):
    pending = row["status"] == "pending"
    opened = None if pending else check_open(cur, row, tip_height)
    if opened is not None:
        tell(cur, row)
    open_at = int(row["open_at"].timestamp())
    out = {
        "id": row["id"],
        "author": row["author"],
        "recipient": row["recipient"],
        "fingerprint": row["fingerprint"],
        "open_at": row["open_at"].isoformat(),
        "sealed_height": row["sealed_height"],
        "sealed_at": row["sealed_at"].isoformat(),
        "status": "pending" if pending else "open" if opened is not None else "sealed",
        "tip": tip_height,
        "blocks_left": None if opened is not None else blocks_left(open_at),
        "tier": row["tier"],
        "style": row["style"],
        "has_photo": row["photo"] is not None,
        "open_height": opened,
        "key": row["escrow_key"] if opened is not None else None,  # held back until it opens
        "line": row["line"],
        "tag": row["tag"],
        "mine": viewer is not None and viewer == row["author"],
    }
    if full:
        out.update(ciphertext=row["ciphertext"], photo=row["photo"], signed_message=row["signed_message"], signature=row["signature"])
    return out


# --- routes --------------------------------------------------------------------------------


@router.get("/v1/capsules/rules")
def rules(viewer: str | None = Depends(optional_address)):
    """What the write page needs: how far ahead open_at must be, the tags, the tip, and the tiers:
    whether 封存 sells (its price is in /v1/billing/products) and whether the viewer's wallet still
    has its free capsule (null when not signed in)."""
    with cursor() as cur:
        on = selling()
        return {
            "min_lead_seconds": min_lead(),
            "block_seconds": BLOCK_SECONDS,
            "tags": list(TAGS),
            "tip": tip(cur),
            "billing": on,
            "free_left": (not on or free_used(cur, viewer) < FREE_PER_WALLET) if viewer else None,
            "free_days": FREE_DAYS,
            "max_years": MAX_YEARS,
            "styles": list(STYLES),
            "max_photo_chars": MAX_PHOTO,
            "inscribe_sats": inscribe_sats(),
        }


class NewCapsule(BaseModel):
    recipient: str = Field(min_length=1, max_length=MAX_RECIPIENT)
    ciphertext: str = Field(min_length=1, max_length=MAX_CIPHERTEXT)
    key: str = Field(min_length=1, max_length=100)
    open_at: int  # unix seconds
    line: str | None = Field(default=None, max_length=MAX_LINE)
    tag: str | None = None
    signed_at: int
    signature: str = Field(max_length=2000)
    tier: str | None = None  # free | paid, while billing is on; left out: free
    photo: str | None = Field(default=None, max_length=MAX_PHOTO)  # base64 of iv || AES-GCM, under the same key
    style: str | None = None  # one of STYLES; left out: classic


def _b64(s, urlsafe=False):
    try:
        pad = "=" * (-len(s) % 4)
        return (base64.urlsafe_b64decode if urlsafe else base64.b64decode)(s + pad if urlsafe else s)
    except (binascii.Error, ValueError):
        return None


@router.post("/v1/capsules", status_code=201)
def seal(req: NewCapsule, address: str = Depends(moderation.writer_address)):
    recipient = req.recipient.strip()
    line = (req.line or "").strip() or None
    if not recipient or any(c in recipient + (line or "") for c in "\r\n"):
        raise HTTPException(400, "recipient and line are one line each")
    if req.tag is not None and req.tag not in TAGS:
        raise HTTPException(400, f"tag is one of {', '.join(TAGS)}")
    if line is None and req.tag is not None:
        raise HTTPException(400, "a tag goes with a public line")
    raw = _b64(req.ciphertext)
    if raw is None or len(raw) < 12 + 16 + 1:
        raise HTTPException(400, "ciphertext must be base64 of iv and AES-GCM ciphertext")
    photo = _b64(req.photo) if req.photo else b""
    if photo is None or (req.photo and len(photo) < 12 + 16 + 1):
        raise HTTPException(400, "photo must be base64 of iv and AES-GCM ciphertext")
    style = req.style or "classic"
    if style not in STYLES:
        raise HTTPException(400, f"style is one of {', '.join(STYLES)}")
    tier = (req.tier or "free") if selling() else "open"
    if tier not in TIERS + ("open",):
        raise HTTPException(400, f"tier is one of {', '.join(TIERS)}")
    if tier == "free" and (req.photo or style != "classic"):
        raise HTTPException(403, "a photo and the envelope styles come with 封存, the paid tier")
    key = _b64(req.key, urlsafe=True)
    if key is None or len(key) != 32:
        raise HTTPException(400, "key must be a 256-bit AES key, base64url")
    now = time.time()
    if abs(now - req.signed_at) > SIGNED_AT_SKEW:
        raise HTTPException(400, "signed_at too far from server time")
    if req.open_at < now + min_lead():
        raise HTTPException(400, f"open_at must be at least {min_lead()} seconds from now")
    if req.open_at > now + MAX_YEARS * 366 * 86400:
        raise HTTPException(400, f"open_at must be within {MAX_YEARS} years")
    if tier == "free" and req.open_at > now + FREE_DAYS * 86400:
        raise HTTPException(400, "a free capsule opens within a year; 封存 (paid) can wait up to 100 years")
    fingerprint = hashlib.sha256(raw + photo).hexdigest()
    message = capsule_message(recipient, req.open_at, fingerprint, line, req.tag, req.signed_at)
    try:
        if not bip322.verify(address, message, req.signature):
            raise HTTPException(401, "bad capsule signature")
    except bip322.Unsupported as e:
        raise HTTPException(400, str(e))
    with cursor(dict_rows=True) as cur:
        height = tip(cur)
        if height is None:
            raise HTTPException(503, "no blocks indexed yet")
        cur.execute(
            "select count(*) as n from social.capsules where author = %s and sealed_at > now() - interval '1 hour';", (address,)
        )
        if cur.fetchone()["n"] >= PER_HOUR:
            raise HTTPException(429, "slow down")
        expire_pending(cur)
        if tier == "free":
            # One at a time per wallet group, so two tabs can't both take the free one.
            cur.execute("select pg_advisory_xact_lock(hashtext('capsule-free:' || %s));", (_group(cur, address)[0],))
            if free_used(cur, address) >= FREE_PER_WALLET:
                raise HTTPException(409, "this wallet has used its free capsule; 封存 is the paid tier")
        cur.execute(
            f"insert into social.capsules (id, ref, author, recipient, ciphertext, fingerprint, escrow_key, open_at, "
            "sealed_height, line, tag, signed_message, signature, tier, status, photo, style) "
            "values (%s, %s, %s, %s, %s, %s, %s, to_timestamp(%s), %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            f"on conflict (signature) do nothing returning {COLUMNS};",
            (
                secrets.token_urlsafe(9),
                secrets.token_hex(8),
                address,
                recipient,
                req.ciphertext,
                fingerprint,
                req.key,
                req.open_at,
                height,
                line,
                req.tag if line else None,
                message,
                req.signature,
                tier,
                "pending" if tier == "paid" else "sealed",
                req.photo or None,
                style,
            ),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(409, "this signature was already used")
        out = view(cur, row, address, height)
    if tier != "paid":
        return out
    try:
        payment = billing.invoice(address, "capsule", row["id"])
    except HTTPException:
        with cursor() as cur:
            cur.execute("delete from social.capsules where id = %s and status = 'pending';", (row["id"],))
        raise
    return {**out, "payment": payment}


# --- 封存: the paid tier -----------------------------------------------------------------------


def check_pending(cur, address, capsule_id):
    """billing's check for product capsule: a capsule of address's wallet group waiting to be paid."""
    cur.execute(
        "select author, status, sealed_at < now() - make_interval(mins => %s) from social.capsules where id = %s;",
        (PENDING_MINUTES, capsule_id),
    )
    row = cur.fetchone()
    if row is None or row[0] not in _group(cur, address):
        raise HTTPException(404, "no such capsule of yours")
    if row[1] != "pending":
        raise HTTPException(409, "this capsule is sealed already")
    if row[2]:
        raise HTTPException(410, "this capsule waited too long for payment; write it again")


def seal_paid(cur, p):
    """billing's on_settled for product capsule: seal it on the block of this moment."""
    cur.execute(
        "update social.capsules set status = 'sealed', "
        "sealed_height = coalesce((select max(block_height) from bitmap_block_hashes), sealed_height), "
        "sealed_at = now(), payment_id = %s where id = %s and status = 'pending' returning 1;",
        (p["id"], p["ref"]),
    )
    if cur.fetchone() is None:
        cur.execute("select 1 from social.capsules where id = %s;", (p["ref"],))
        if cur.fetchone() is None:
            log.warning("payment %s settled for capsule %s, which is gone; refund by hand", p["id"], p["ref"])


def expire_pending(cur):
    """Delete capsules left unpaid past PENDING_MINUTES whose invoices are no longer pending."""
    cur.execute(
        "delete from social.capsules c where c.status = 'pending' and c.sealed_at < now() - make_interval(mins => %s) "
        "and not exists (select 1 from social.payments p where p.product = 'capsule' and p.ref = c.id "
        "and p.status in ('pending', 'settled'));",
        (PENDING_MINUTES,),
    )


_swept = None


def sweep_due(tip_height):
    """True the first time this process sees tip_height, so sweep() runs once a block."""
    global _swept
    if tip_height is None or tip_height == _swept:
        return False
    _swept = tip_height
    return True


def sweep():
    """Once a block: open and tell capsules whose time has come (all but the free tier), and clear
    unpaid ones, asking the wallet one last time about invoices nobody looked at. A background
    task: a failure is logged and tried again next block."""
    try:
        _sweep()
    except Exception:
        log.exception("capsule sweep")


def _sweep():
    with cursor(dict_rows=True) as cur:
        height = tip(cur)
        cur.execute(
            f"select {COLUMNS} from social.capsules where status = 'sealed' and tier <> 'free' and notified_at is null "
            "and open_at <= now() order by open_at limit 200;"
        )
        for row in cur.fetchall():
            if check_open(cur, row, height) is not None:
                tell(cur, row)
        cur.execute(
            "select p.id from social.capsules c join social.payments p on p.product = 'capsule' and p.ref = c.id "
            "and p.status = 'pending' where c.status = 'pending' and c.sealed_at < now() - make_interval(mins => %s) limit 50;",
            (PENDING_MINUTES,),
        )
        stale = [r["id"] for r in cur.fetchall()]
    for payment_id in stale:
        try:
            billing.refresh(payment_id, force=True)
        except Exception:
            log.exception("capsule payment %s", payment_id)
    with cursor() as cur:
        expire_pending(cur)


@router.get("/v1/capsules/mine")
def mine(address: str = Depends(current_address)):
    with cursor(dict_rows=True) as cur:
        height = tip(cur)
        cur.execute(
            f"select {COLUMNS} from social.capsules where author = %s and status = 'sealed' order by sealed_at desc limit 200;", (address,)
        )
        return {"capsules": [view(cur, r, address, height, full=False) for r in cur.fetchall()]}


@router.get("/v1/capsules/{capsule_id}")
def get_capsule(capsule_id: str, viewer: str | None = Depends(optional_address)):
    """Anyone with the link sees the envelope; the key comes with it once the capsule is open."""
    with cursor(dict_rows=True) as cur:
        cur.execute(f"select {COLUMNS} from social.capsules where id = %s;", (capsule_id,))
        row = cur.fetchone()
        if row is None or (row["status"] == "pending" and (viewer is None or row["author"] not in _group(cur, viewer))):
            raise HTTPException(404, "no such capsule")  # an unpaid one is its author's alone
        return view(cur, row, viewer, tip(cur))


@router.delete("/v1/capsules/{capsule_id}/line")
def remove_line(capsule_id: str, address: str = Depends(current_address)):
    """The author takes the public line down; the capsule itself stays sealed."""
    with cursor() as cur:
        cur.execute(
            "update social.capsules set line = null, tag = null, line_removed_by = %s where id = %s and author = %s returning 1;",
            (address, capsule_id, address),
        )
        if cur.fetchone() is None:
            raise HTTPException(404, "no such capsule of yours")
    return {"ok": True}


def _day_of(cur, height, tip_height):
    """The UTC day block height was mined: its header time if known, else when the first capsule on
    it was sealed, else ten minutes a block back from now."""
    try:
        return datetime.fromtimestamp(block_time(cur, height), timezone.utc).date()
    except NoTimes:
        pass
    cur.execute("select min(sealed_at) as first from social.capsules where sealed_height = %s and status = 'sealed';", (height,))
    row = cur.fetchone()
    first = row["first"] if isinstance(row, dict) else row[0]
    if first is not None:
        return first.astimezone(timezone.utc).date()
    return datetime.fromtimestamp(time.time() - (tip_height - height) * BLOCK_SECONDS, timezone.utc).date()


SCOPES = {
    "block": "c.sealed_height = %(h)s",
    "hour": "c.sealed_height between %(h)s - %(r)s and %(h)s + %(r)s",
    "day": "(c.sealed_at at time zone 'utc')::date = %(day)s",
}


@router.get("/v1/capsules/peers/{height}")
def peers(height: int, scope: str = "block", viewer: str | None = Depends(optional_address)):
    """同块人: the public lines of capsules sealed on this block, within ±6 blocks, or on the same
    UTC day, with counts for all three. Never the letter, the recipient or the link."""
    if scope not in SCOPES:
        raise HTTPException(400, "scope is block, hour or day")
    with cursor(dict_rows=True) as cur:
        tip_height = tip(cur)
        if tip_height is None or height < 0 or height > tip_height:
            raise HTTPException(404, "no such block yet")
        args = {"h": height, "r": HOUR_BLOCKS, "day": _day_of(cur, height, tip_height), "me": viewer}
        public = "c.line is not null and c.status = 'sealed'"
        counts = {}
        for name, where in SCOPES.items():
            cur.execute(f"select count(*) as n from social.capsules c where {public} and {where};", args)
            counts[name] = cur.fetchone()["n"]
        cur.execute(
            "select count(*) as n, count(*) filter (where c.tag = 'birth' and c.line is not null) as births "
            "from social.capsules c where c.sealed_height = %(h)s and c.status = 'sealed';",
            args,
        )
        here = cur.fetchone()
        cur.execute(
            f"select c.id, c.ref, c.author, c.line, c.tag, c.sealed_at, c.sealed_height from social.capsules c "
            f"where {public} and {SCOPES[scope]} order by (c.author = %(me)s) desc, c.sealed_at limit {PEERS_PAGE};",
            args,
        )
        rows = cur.fetchall()
    return {
        "height": height,
        "tip": tip_height,
        "day": args["day"].isoformat(),
        "scope": scope,
        "counts": counts,
        "sealed_here": here["n"],  # every capsule on the block, public or not
        "births_here": here["births"],
        "peers": [
            {
                "ref": r["ref"],
                "address": r["author"],
                "line": r["line"],
                "tag": r["tag"],
                "sealed_at": r["sealed_at"].isoformat(),
                "sealed_height": r["sealed_height"],
                "mine": viewer is not None and r["author"] == viewer,
                **({"capsule_id": r["id"]} if viewer is not None and r["author"] == viewer else {}),
            }
            for r in rows
        ],
    }


class ReportBody(BaseModel):
    reason: str
    note: str = Field(default="", max_length=500)


@router.post("/v1/capsules/lines/{ref}/report")
def report_line(ref: str, req: ReportBody, address: str = Depends(current_address)):
    with cursor() as cur:
        cur.execute("select author from social.capsules where ref = %s and line is not null;", (ref,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(404, "no such line")
        if row[0] == address:
            raise HTTPException(400, "you can't report your own line")
        moderation.report_item(cur, "capsule", ref, address, req.reason, req.note)
    return {"ok": True}
