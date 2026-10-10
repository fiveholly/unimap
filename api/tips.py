"""闪电打赏: tips in sats on a post (to its author) or a district (to its owner), paid over
Lightning straight to the recipient's own wallet. unimap never holds the money: it asks the
recipient's Lightning address for an invoice (LNURL-pay, LUD-06/16), shows it to the tipper,
and asks the address's verify URL (LUD-21) whether it was paid. Only confirmed tips count
towards totals, the weekly board and prosperity.

A wallet group (api/wallets.py) has one Lightning address, kept under its main address.

Lightning addresses point at servers anyone can run, so every URL we fetch is https, not
redirected, and on a public IP (no requests to the VPS's own network).
"""

import ipaddress
import json
import re
import socket
from urllib.parse import urlencode, urlsplit

import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import events, notify, wallets
from api.auth import current_address
from api.db import cursor

router = APIRouter()

MIN_SATS = 1
MAX_SATS = 1_000_000
MAX_COMMENT = 200
TIPS_PER_10_MINUTES = 20  # invoices one address may ask for; each one is a request to someone's server
EXPIRE_MINUTES = 60  # a pending tip stops being checked after this
CHECK_SECONDS = 2  # verify URLs are asked at most this often per tip
MAX_BODY = 64 * 1024
ADDRESS = re.compile(r"^([a-z0-9._+-]{1,64})@([a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+)$")


class LnurlError(Exception):
    pass


def _public(host):
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except OSError:
        return False
    return bool(infos) and all(ipaddress.ip_address(i[4][0]).is_global for i in infos)


def _get(url, params=None):
    """GET a JSON document from a Lightning service, refusing anything but https on a public host."""
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname or not _public(parts.hostname):
        raise LnurlError("the Lightning service's URL isn't a public https address")
    try:
        r = requests.get(url, params=params, timeout=10, allow_redirects=False, stream=True,
                         headers={"Accept": "application/json"})
        body = r.raw.read(MAX_BODY + 1, decode_content=True)
    except requests.RequestException as e:
        raise LnurlError(f"couldn't reach the Lightning service: {e.__class__.__name__}") from e
    if len(body) > MAX_BODY:
        raise LnurlError("the Lightning service's answer is too long")
    try:
        js = json.loads(body)
    except ValueError as e:
        raise LnurlError("the Lightning service didn't answer with JSON") from e
    if not isinstance(js, dict):
        raise LnurlError("the Lightning service didn't answer with JSON")
    if str(js.get("status", "")).upper() == "ERROR":
        raise LnurlError(f"the Lightning service said: {str(js.get('reason', ''))[:200]}")
    return js


def normalize(lightning_address):
    a = (lightning_address or "").strip().lower()
    if not ADDRESS.match(a):
        raise HTTPException(400, "a Lightning address looks like name@wallet.com")
    return a


def pay_request(lightning_address):
    """The LNURL-pay parameters of a Lightning address (LUD-16)."""
    name, domain = ADDRESS.match(lightning_address).groups()
    js = _get(f"https://{domain}/.well-known/lnurlp/{name}")
    if js.get("tag") != "payRequest" or not isinstance(js.get("callback"), str):
        raise LnurlError("this isn't a Lightning address that can receive payments")
    return js


_UNIT = {"": 10**11, "m": 10**8, "u": 10**5, "n": 10**2}  # msat per unit of the amount in an invoice


def invoice_msat(invoice):
    """The amount a BOLT11 invoice asks for, in millisatoshis, or None if it names none."""
    m = re.match(r"^ln(?:bc|tb|bcrt|tbs)(\d+)([munp]?)1[02-9ac-hj-np-z]+$", invoice.lower())
    if not m:
        return None
    amount, unit = int(m.group(1)), m.group(2)
    return amount // 10 if unit == "p" else amount * _UNIT[unit]


def ask_invoice(lightning_address, amount_sats, comment):
    """(invoice, verify url or None) for amount_sats from the address's wallet."""
    p = pay_request(lightning_address)
    msat = amount_sats * 1000
    if not (int(p.get("minSendable", 1)) <= msat <= int(p.get("maxSendable", msat))):
        raise LnurlError(
            f"this wallet takes {int(p.get('minSendable', 1000)) // 1000} to {int(p.get('maxSendable', 0)) // 1000} sats"
        )
    params = {"amount": msat}
    allowed = int(p.get("commentAllowed") or 0)
    if comment and allowed:
        params["comment"] = comment[:allowed]
    callback = p["callback"]
    js = _get(callback + ("&" if "?" in callback else "?") + urlencode(params))
    invoice = js.get("pr")
    if not isinstance(invoice, str) or invoice_msat(invoice) != msat:
        raise LnurlError("the wallet's invoice doesn't ask for the amount you chose")
    verify = js.get("verify") if isinstance(js.get("verify"), str) else None
    return invoice, verify


def settled(verify_url):
    """True / False from a LUD-21 verify URL."""
    return bool(_get(verify_url).get("settled"))


# Tests swap these for fakes.
lnurl = type("Lnurl", (), {"pay_request": staticmethod(pay_request), "ask_invoice": staticmethod(ask_invoice),
                          "settled": staticmethod(settled)})


def lightning_of(cur, address):
    """The Lightning address of address's wallet group, or None."""
    if not address:
        return None
    cur.execute("select lightning_address from social.lightning_addresses where address = %s;",
                (wallets.main_of(cur, address),))
    row = cur.fetchone()
    return row[0] if row else None


# --- the recipient's Lightning address ----------------------------------------------------


class LightningBody(BaseModel):
    lightning_address: str = Field(max_length=200)


@router.get("/v1/me/lightning")
def my_lightning(address: str = Depends(current_address)):
    with cursor() as cur:
        return {"lightning_address": lightning_of(cur, address)}


@router.put("/v1/me/lightning")
def set_lightning(req: LightningBody, address: str = Depends(current_address)):
    """Set where tips to this wallet group go; checked against the address's server first."""
    a = normalize(req.lightning_address)
    try:
        lnurl.pay_request(a)
    except LnurlError as e:
        raise HTTPException(400, str(e)) from e
    with cursor() as cur:
        cur.execute(
            "insert into social.lightning_addresses (address, lightning_address) values (%s, %s) "
            "on conflict (address) do update set lightning_address = excluded.lightning_address, updated_at = now();",
            (wallets.main_of(cur, address), a),
        )
    return {"lightning_address": a}


@router.delete("/v1/me/lightning")
def clear_lightning(address: str = Depends(current_address)):
    with cursor() as cur:
        cur.execute("delete from social.lightning_addresses where address = %s;", (wallets.main_of(cur, address),))
    return {"lightning_address": None}


# --- tipping -------------------------------------------------------------------------------


class TipBody(BaseModel):
    post_id: int | None = None
    bitmap_number: int | None = None  # with no post: a tip to the district's owner
    event_id: int | None = None  # with place: the host paying a prize of a 街区活动 (api/events.py)
    place: int | None = None
    amount_sats: int = Field(ge=MIN_SATS, le=MAX_SATS)
    comment: str = Field(default="", max_length=MAX_COMMENT)


def _target(cur, req, tipper):
    """(recipient, bitmap_number, post_id) for a tip."""
    if req.event_id is not None:
        recipient, n = events.prize_target(cur, req.event_id, req.place or 0, tipper, req.amount_sats)
        return recipient, n, None
    if req.post_id is not None:
        cur.execute("select author_address, bitmap_number from social.posts where id = %s and removed_at is null;",
                    (req.post_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(404, "no such post")
        return row[0], row[1], req.post_id
    if req.bitmap_number is None:
        raise HTTPException(400, "tip a post or a district")
    cur.execute(
        "select o.address from bitmaps b join inscription_owners o on o.inscription_id = b.inscription_id "
        "where b.bitmap_number = %s;",
        (req.bitmap_number,),
    )
    row = cur.fetchone()
    if row is None or not row[0]:
        raise HTTPException(404, "nobody holds this district")
    return row[0], req.bitmap_number, None


@router.post("/v1/tips")
def create_tip(req: TipBody, address: str = Depends(current_address)):
    """Ask the recipient's wallet for an invoice. Returns it with the tip's id to check on."""
    with cursor() as cur:
        recipient, n, post_id = _target(cur, req, address)
        if wallets.main_of(cur, recipient) == wallets.main_of(cur, address):
            raise HTTPException(400, "you can't tip yourself")
        to = lightning_of(cur, recipient)
        if to is None:
            raise HTTPException(409, "this person hasn't set up a Lightning address yet")
        cur.execute(
            "select count(*) from social.tips where tipper = %s and created_at > now() - interval '10 minutes';",
            (address,),
        )
        if cur.fetchone()[0] >= TIPS_PER_10_MINUTES:
            raise HTTPException(429, "too many tips at once, try again in a few minutes")
    comment = req.comment.strip()
    try:
        invoice, verify = lnurl.ask_invoice(to, req.amount_sats, comment)
    except LnurlError as e:
        raise HTTPException(502, str(e)) from e
    with cursor() as cur:
        cur.execute(
            "insert into social.tips (tipper, recipient, bitmap_number, post_id, amount_sats, comment, invoice, verify_url, "
            "event_id, event_place) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id;",
            (address, recipient, n, post_id, req.amount_sats, comment, invoice, verify, req.event_id,
             req.place if req.event_id is not None else None),
        )
        tip_id = cur.fetchone()[0]
    return {"id": tip_id, "invoice": invoice, "amount_sats": req.amount_sats, "verifiable": verify is not None,
            "status": "pending"}


@router.get("/v1/tips/top")
def top(days: int = 7):
    """打赏榜: the posts and districts that got the most sats in confirmed tips lately."""
    from api.social import POST_COLUMNS, _post

    days = max(1, min(days, 90))
    with cursor(dict_rows=True) as cur:
        cur.execute(
            "select post_id, sum(amount_sats) as sats, count(distinct tipper) as tippers from social.tips "
            "where status = 'settled' and post_id is not null and settled_at > now() - make_interval(days => %s) "
            "group by post_id order by sum(amount_sats) desc, post_id limit 20;",
            (days,),
        )
        post_rows = cur.fetchall()
        posts = {}
        if post_rows:
            cur.execute(f"select {POST_COLUMNS} from social.posts p where p.id = any(%(ids)s) and p.removed_at is null;",
                        {"ids": [r["post_id"] for r in post_rows], "me": None})
            posts = {r["id"]: _post(r) for r in cur.fetchall()}
        cur.execute(
            "select bitmap_number, sum(amount_sats) as sats, count(distinct tipper) as tippers from social.tips "
            "where status = 'settled' and event_id is null and settled_at > now() - make_interval(days => %s) "
            "group by bitmap_number order by sum(amount_sats) desc, bitmap_number limit 20;",
            (days,),
        )
        districts = [dict(r) for r in cur.fetchall()]
        cur.execute("select block_height, zone from block_zones where block_height = any(%s);",
                    ([d["bitmap_number"] for d in districts],))
        zones = {r["block_height"]: r["zone"] for r in cur.fetchall()}
    return {
        "days": days,
        "posts": [{"post": posts[r["post_id"]], "sats": r["sats"], "tippers": r["tippers"]}
                  for r in post_rows if r["post_id"] in posts][:10],
        "districts": [{"bitmap_number": d["bitmap_number"], "name": f"{d['bitmap_number']}.bitmap",
                       "zone": zones.get(d["bitmap_number"]),
                       "sats": d["sats"], "tippers": d["tippers"]} for d in districts][:10],
    }


@router.get("/v1/tips/{tip_id}")
def tip_status(tip_id: int, address: str = Depends(current_address)):
    """Where a tip stands; while pending, asks the recipient's wallet whether it was paid."""
    with cursor() as cur:
        cur.execute(
            "select tipper, recipient, bitmap_number, post_id, verify_url, status, "
            "created_at < now() - make_interval(mins => %s), "
            "checked_at is null or checked_at < now() - make_interval(secs => %s) "
            "from social.tips where id = %s;",
            (EXPIRE_MINUTES, CHECK_SECONDS, tip_id),
        )
        row = cur.fetchone()
        if row is None or row[0] != address:
            raise HTTPException(404, "no such tip")
        tipper, recipient, n, post_id, verify, status, old, due = row
        if status != "pending" or verify is None or not due:
            return {"id": tip_id, "status": status, "verifiable": verify is not None}
        if old:
            cur.execute("update social.tips set status = 'expired' where id = %s;", (tip_id,))
            return {"id": tip_id, "status": "expired", "verifiable": True}
        cur.execute("update social.tips set checked_at = now() where id = %s;", (tip_id,))
    try:
        paid = lnurl.settled(verify)
    except LnurlError:
        paid = False
    if not paid:
        return {"id": tip_id, "status": "pending", "verifiable": True}
    with cursor() as cur:
        cur.execute(
            "update social.tips set status = 'settled', settled_at = now() where id = %s and status = 'pending' "
            "returning id;",
            (tip_id,),
        )
        if cur.fetchone():
            notify.notify(cur, recipient, "tip", tipper, n, post_id, tip_id=tip_id)
    return {"id": tip_id, "status": "settled", "verifiable": True}


def district_tips(cur, n):
    """{sats30, tippers30} in confirmed tips on district n and its posts, last 30 days."""
    cur.execute(
        "select coalesce(sum(amount_sats), 0), count(distinct tipper) from social.tips "
        "where status = 'settled' and event_id is null and bitmap_number = %s and settled_at > now() - interval '30 days';",
        (n,),
    )
    sats, tippers = cur.fetchone()
    return {"sats30": int(sats), "tippers30": tippers}
