"""平台收费: the hooks for what unimap may charge for one day. All of it is off until switched on.

- Payments (`/v1/billing/*`): one flow for every paid product. A product sells only while
  BILLING_PRICE_<PRODUCT>_SATS is set and unimap has a Lightning address to be paid at
  (PLATFORM_LIGHTNING_ADDRESS, else AGENT_LIGHTNING_ADDRESS). The invoice comes from that
  address's wallet and is confirmed by its LUD-21 verify URL, as with tips (api/tips.py); once
  paid, the product's on_settled hook delivers it. The agent's own payments (api/agent.py) came
  first and stay where they are; they could move here as a product later.
- Entitlements: what an address may use (a premium style option, say), granted free, paid, by a
  sponsor or by an admin, for good or until a date, and counted across linked wallets.
- Promotions (推广): districts shown in a labelled slot on the home page, put up by an admin.
- API keys: for a future paid data API. A valid X-API-Key gets its tier's write limit instead of
  the per-IP one (api/app.py). Reads stay free and need no key.
- Revenue: what was paid to unimap, by product and month, for admins.
"""

import hashlib
import os
import re
import secrets
import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import roles, tips, wallets
from api.auth import current_address, normalize_address
from api.db import cursor
from api.moderation import require_admin

router = APIRouter()

PAY_PER_10_MINUTES = 5  # invoices one wallet group may ask for, as for the agent
SOURCES = ("free", "paid", "sponsor", "admin")
SLOTS = ("home",)
PROMOTION_DAYS = 7  # how long an approved promotion runs unless the admin says otherwise
KEY_CACHE_SECONDS = 60  # a revoked key may keep its limit this long in the other API worker
ITEM = re.compile(r"^[a-z0-9_-]{1,40}(:[a-z0-9_.-]{1,60})?$")


def pay_to():
    return (os.getenv("PLATFORM_LIGHTNING_ADDRESS") or os.getenv("AGENT_LIGHTNING_ADDRESS") or "").strip().lower() or None


def price(product):
    """Sats the product sells for now; 0 when it isn't for sale."""
    if product not in PRODUCTS or not pay_to() or (product == "style" and not cosmetics()):
        return 0  # premium styles are free while BILLING_COSMETICS is off, so not sold either
    try:
        return max(0, int(os.getenv(f"BILLING_PRICE_{product.upper()}_SATS") or 0))
    except ValueError:
        return 0


def cosmetics():
    """True when premium style options (api/style.py PREMIUM) need an entitlement."""
    return os.getenv("BILLING_COSMETICS") == "1"


# --- entitlements -----------------------------------------------------------------------------


def has(cur, address, item):
    """True if address, or a wallet linked to it, holds item and it hasn't expired."""
    cur.execute(
        "select 1 from social.entitlements where owner = any(%s) and item = %s and (expires_at is null or expires_at > now()) limit 1;",
        (wallets.group(cur, address), item),
    )
    return cur.fetchone() is not None


def grant(cur, address, item, source, ref=None, days=None):
    cur.execute(
        "insert into social.entitlements (owner, item, ref, source, expires_at) values "
        "(%s, %s, %s, %s, case when %s::int is null then null else now() + make_interval(days => %s::int) end) returning id;",
        (wallets.main_of(cur, address), item, ref, source, days, days),
    )
    return cur.fetchone()[0]


def _entitlements(cur, where, args):
    cur.execute(
        "select id, owner, item, ref, source, granted_at, expires_at from social.entitlements "
        f"where {where} and (expires_at is null or expires_at > now()) order by granted_at desc limit 200;",
        args,
    )
    return [{"id": i, "owner": o, "item": it, "ref": r, "source": s, "granted_at": g.isoformat(),
             "expires_at": e.isoformat() if e else None} for i, o, it, r, s, g, e in cur.fetchall()]


@router.get("/v1/me/entitlements")
def my_entitlements(address: str = Depends(current_address)):
    with cursor() as cur:
        return {"entitlements": _entitlements(cur, "owner = any(%s)", (wallets.group(cur, address),))}


class GrantBody(BaseModel):
    address: str = Field(max_length=100)
    item: str = Field(max_length=100)
    ref: str | None = Field(default=None, max_length=100)
    source: str = "admin"
    days: int | None = Field(default=None, ge=1, le=3650)  # none: for good


@router.get("/v1/admin/entitlements")
def entitlements(address: str, _: str = Depends(require_admin)):
    with cursor() as cur:
        return {"entitlements": _entitlements(cur, "owner = any(%s)", (wallets.group(cur, normalize_address(address)),))}


@router.post("/v1/admin/entitlements")
def admin_grant(req: GrantBody, _: str = Depends(require_admin)):
    if req.source not in SOURCES or not ITEM.match(req.item):
        raise HTTPException(400, f"source is one of {', '.join(SOURCES)}; item looks like style:gold")
    with cursor() as cur:
        return {"id": grant(cur, normalize_address(req.address), req.item, req.source, req.ref, req.days)}


@router.delete("/v1/admin/entitlements/{entitlement_id}")
def admin_revoke(entitlement_id: int, _: str = Depends(require_admin)):
    with cursor() as cur:
        cur.execute("delete from social.entitlements where id = %s;", (entitlement_id,))
    return {"ok": True}


# --- products -----------------------------------------------------------------------------------


def _check_style(cur, address, ref):
    from api import style  # style imports this module

    if ref not in style.PREMIUM:
        raise HTTPException(404, "that isn't a premium style option")
    if has(cur, address, f"style:{ref}"):
        raise HTTPException(409, "you have this one already")


def _grant_style(cur, p):
    grant(cur, p["payer"], f"style:{p['ref']}", "paid", ref=str(p["id"]))


def _check_promotion(cur, address, ref):
    if not ref.isdigit():
        raise HTTPException(400, "ref is the district's number")
    roles.require_owner(cur, int(ref), address)


def _queue_promotion(cur, p):
    """A paid promotion waits for an admin to approve it (and pick when it runs), so nothing goes
    on the home page unseen; an admin who turns it down refunds by hand."""
    cur.execute("insert into social.promotions (bitmap_number, slot, created_by, payment_id) values (%s, 'home', %s, %s);",
                (int(p["ref"]), p["payer"], p["id"]))


def _check_capsule(cur, address, ref):
    from api import capsule  # capsule imports this module

    capsule.check_pending(cur, address, ref)


def _seal_capsule(cur, p):
    from api import capsule

    capsule.seal_paid(cur, p)


# product key: (check(cur, address, ref) before an invoice is made, on_settled(cur, payment) once paid)
PRODUCTS = {
    "style": (_check_style, _grant_style),  # a premium style option for good; ref is the option
    "promotion": (_check_promotion, _queue_promotion),  # a slot on the home page; ref is the district
    "capsule": (_check_capsule, _seal_capsule),  # 时间胶囊 · 封存; ref is the capsule waiting to be paid
}


@router.get("/v1/billing/products")
def products():
    """What is for sale now. Nothing, unless a price is set."""
    return {"products": [{"product": k, "amount_sats": price(k)} for k in PRODUCTS if price(k)], "cosmetics": cosmetics()}


class PayBody(BaseModel):
    product: str = Field(max_length=40)
    ref: str = Field(default="", max_length=100)


def _payment(row):
    pid, product, ref, amount, status = row
    return {"id": pid, "product": product, "ref": ref, "amount_sats": amount, "status": status, "verifiable": True}


def invoice(address, product, ref=""):
    """An invoice from unimap's Lightning wallet for a product, after its check hook; the payment
    as /v1/billing/pay returns it. Products that make their own invoice (api/capsule.py) call this."""
    if product not in PRODUCTS:
        raise HTTPException(404, "no such product")
    amount = price(product)
    if not amount:
        raise HTTPException(409, "not offered on this server")
    ref = ref.strip()
    with cursor() as cur:
        PRODUCTS[product][0](cur, address, ref)
        payer = wallets.main_of(cur, address)
        cur.execute("select count(*) from social.payments where payer = %s and created_at > now() - interval '10 minutes';", (payer,))
        if cur.fetchone()[0] >= PAY_PER_10_MINUTES:
            raise HTTPException(429, "too many invoices at once, try again in a few minutes")
    try:
        bolt11, verify = tips.lnurl.ask_invoice(pay_to(), amount, f"unimap {product} {ref}".strip())
    except tips.LnurlError as e:
        raise HTTPException(502, str(e)) from e
    if verify is None:
        raise HTTPException(502, "unimap's Lightning wallet can't confirm payments; tell the site's admin")
    with cursor() as cur:
        cur.execute(
            "insert into social.payments (payer, product, ref, amount_sats, invoice, verify_url) values (%s, %s, %s, %s, %s, %s) returning id;",
            (payer, product, ref, amount, bolt11, verify),
        )
        return {**_payment((cur.fetchone()[0], product, ref, amount, "pending")), "invoice": bolt11}


@router.post("/v1/billing/pay")
def pay(req: PayBody, address: str = Depends(current_address)):
    """An invoice from unimap's Lightning wallet for a product."""
    return invoice(address, req.product, req.ref)


def refresh(payment_id, address=None, force=False):
    """Where a payment stands; while pending, asks the wallet whether it was paid (at most every
    CHECK_SECONDS unless force), once more just before it expires, and runs on_settled once paid.
    With address, only a payment of its wallet group; None if there is no such payment."""
    with cursor() as cur:
        cur.execute(
            "select payer, product, ref, amount_sats, status, verify_url, created_at < now() - make_interval(mins => %s), "
            "checked_at is null or checked_at < now() - make_interval(secs => %s) from social.payments where id = %s;",
            (tips.EXPIRE_MINUTES, tips.CHECK_SECONDS, payment_id),
        )
        row = cur.fetchone()
        if row is None or (address is not None and row[0] not in wallets.group(cur, address)):
            return None
        payer, product, ref, amount, status, verify, old, due = row
        if status != "pending" or not (due or force):
            return _payment((payment_id, product, ref, amount, status))
        cur.execute("update social.payments set checked_at = now() where id = %s;", (payment_id,))
    try:
        paid = tips.lnurl.settled(verify)
    except tips.LnurlError:
        paid = False
    if not paid:
        if old:
            with cursor() as cur:
                cur.execute("update social.payments set status = 'expired' where id = %s and status = 'pending';", (payment_id,))
            return _payment((payment_id, product, ref, amount, "expired"))
        return _payment((payment_id, product, ref, amount, "pending"))
    settle(payment_id)
    return _payment((payment_id, product, ref, amount, "settled"))


def settle(payment_id):
    """Mark a pending payment paid and deliver its product (on_settled), once."""
    with cursor() as cur:
        cur.execute(
            "update social.payments set status = 'settled', settled_at = now() where id = %s and status = 'pending' "
            "returning id, payer, product, ref, amount_sats;",
            (payment_id,),
        )
        row = cur.fetchone()
        if row and row[2] in PRODUCTS:
            PRODUCTS[row[2]][1](cur, dict(zip(("id", "payer", "product", "ref", "amount_sats"), row)))


@router.get("/v1/billing/payments/{payment_id}")
def payment_status(payment_id: int, address: str = Depends(current_address)):
    """Where a payment stands; while pending, asks the wallet whether it was paid, once more just before it expires."""
    out = refresh(payment_id, address)
    if out is None:
        raise HTTPException(404, "no such payment")
    return out


# --- promotions ---------------------------------------------------------------------------------


PROMOTION_COLUMNS = "id, bitmap_number, slot, starts_at, ends_at, note, created_by, payment_id"


def _promotion(row):
    pid, n, slot, starts_at, ends_at, note, created_by, payment_id = row
    return {"id": pid, "bitmap_number": n, "name": f"{n}.bitmap", "slot": slot, "note": note,
            "starts_at": starts_at.isoformat() if starts_at else None, "ends_at": ends_at.isoformat() if ends_at else None,
            "created_by": created_by, "payment_id": payment_id}


@router.get("/v1/promotions")
def promotions(slot: str = "home"):
    """The promotions running now in a slot; none unless an admin put one up."""
    with cursor() as cur:
        cur.execute(
            "select bitmap_number, note, ends_at from social.promotions where slot = %s and starts_at <= now() "
            "and (ends_at is null or ends_at > now()) order by starts_at, id limit 5;",
            (slot,),
        )
        return {"promotions": [{"bitmap_number": n, "name": f"{n}.bitmap", "note": note, "ends_at": e.isoformat() if e else None}
                               for n, note, e in cur.fetchall()]}


class PromotionBody(BaseModel):
    bitmap_number: int = Field(ge=0)
    slot: str = "home"
    starts_at: datetime | None = None  # none: now
    ends_at: datetime | None = None  # none: PROMOTION_DAYS after it starts
    note: str = Field(default="", max_length=140)


class ApproveBody(BaseModel):
    days: int = Field(default=PROMOTION_DAYS, ge=1, le=365)


@router.get("/v1/admin/promotions")
def admin_promotions(_: str = Depends(require_admin)):
    """Every promotion not yet over, waiting ones (paid, not approved) first."""
    with cursor() as cur:
        cur.execute(f"select {PROMOTION_COLUMNS} from social.promotions where ends_at is null or ends_at > now() "
                    "order by starts_at nulls first, id;")
        return {"promotions": [_promotion(r) for r in cur.fetchall()]}


@router.post("/v1/admin/promotions")
def create_promotion(req: PromotionBody, admin: str = Depends(require_admin)):
    if req.slot not in SLOTS:
        raise HTTPException(400, f"slot is one of {', '.join(SLOTS)}")
    with cursor() as cur:
        cur.execute(
            "insert into social.promotions (bitmap_number, slot, starts_at, ends_at, note, created_by) values "
            "(%s, %s, coalesce(%s, now()), coalesce(%s, coalesce(%s, now()) + make_interval(days => %s)), %s, %s) "
            f"returning {PROMOTION_COLUMNS};",
            (req.bitmap_number, req.slot, req.starts_at, req.ends_at, req.starts_at, PROMOTION_DAYS, req.note.strip(), admin),
        )
        return _promotion(cur.fetchone())


@router.post("/v1/admin/promotions/{promotion_id}/approve")
def approve_promotion(promotion_id: int, req: ApproveBody, _: str = Depends(require_admin)):
    """Start a paid promotion that was waiting, from now for req.days."""
    with cursor() as cur:
        cur.execute(
            "update social.promotions set starts_at = now(), ends_at = now() + make_interval(days => %s) "
            f"where id = %s and starts_at is null returning {PROMOTION_COLUMNS};",
            (req.days, promotion_id),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(404, "no promotion waiting with that id")
        return _promotion(row)


@router.delete("/v1/admin/promotions/{promotion_id}")
def delete_promotion(promotion_id: int, _: str = Depends(require_admin)):
    with cursor() as cur:
        cur.execute("delete from social.promotions where id = %s;", (promotion_id,))
    return {"ok": True}


# --- API keys -----------------------------------------------------------------------------------


_keys = {}  # sha256 of a key -> (tier or None, when looked up)


def _hash(key):
    return hashlib.sha256(key.encode()).hexdigest()


def key_tier(key):
    """The tier of a valid, unrevoked API key, or None. Looked up at most once a minute per key."""
    if not key or len(key) > 100:
        return None
    h, now = _hash(key), time.monotonic()
    hit = _keys.get(h)
    if hit and now - hit[1] < KEY_CACHE_SECONDS:
        return hit[0]
    with cursor() as cur:
        cur.execute("select tier from social.api_keys where key_hash = %s and revoked_at is null;", (h,))
        row = cur.fetchone()
    if len(_keys) > 10_000:
        _keys.clear()
    _keys[h] = (row[0] if row else None, now)
    return _keys[h][0]


def key_writes(tier):
    """Writes a minute for a key of this tier: RATE_LIMIT_KEY_WRITES_<TIER>, else RATE_LIMIT_KEY_WRITES, else 600."""
    for name in (f"RATE_LIMIT_KEY_WRITES_{tier.upper()}", "RATE_LIMIT_KEY_WRITES"):
        try:
            if os.getenv(name):
                return int(os.environ[name])
        except ValueError:
            pass
    return 600


class KeyBody(BaseModel):
    tier: str = Field(default="basic", pattern=r"^[a-z0-9_]{1,20}$")
    owner: str = Field(default="", max_length=200)
    note: str = Field(default="", max_length=200)


@router.get("/v1/admin/api-keys")
def api_keys(_: str = Depends(require_admin)):
    with cursor() as cur:
        cur.execute("select id, owner, tier, note, created_at, revoked_at from social.api_keys order by id desc limit 200;")
        return {"keys": [{"id": i, "owner": o, "tier": t, "note": n, "created_at": c.isoformat(), "revoked_at": r.isoformat() if r else None}
                         for i, o, t, n, c, r in cur.fetchall()]}


@router.post("/v1/admin/api-keys")
def issue_key(req: KeyBody, _: str = Depends(require_admin)):
    """A new key, shown this once: only its hash is kept."""
    key = "um_" + secrets.token_urlsafe(32)
    with cursor() as cur:
        cur.execute("insert into social.api_keys (key_hash, owner, tier, note) values (%s, %s, %s, %s) returning id;",
                    (_hash(key), req.owner.strip(), req.tier, req.note.strip()))
        return {"id": cur.fetchone()[0], "key": key, "tier": req.tier}


@router.delete("/v1/admin/api-keys/{key_id}")
def revoke_key(key_id: int, _: str = Depends(require_admin)):
    with cursor() as cur:
        cur.execute("update social.api_keys set revoked_at = coalesce(revoked_at, now()) where id = %s;", (key_id,))
    _keys.clear()
    return {"ok": True}


# --- revenue ------------------------------------------------------------------------------------


@router.get("/v1/admin/revenue")
def revenue(_: str = Depends(require_admin)):
    """Confirmed payments to unimap by month and product, newest month first; the agent's included."""
    with cursor() as cur:
        cur.execute(
            "select to_char(date_trunc('month', settled_at), 'YYYY-MM'), product, count(*), sum(amount_sats) from ("
            "select product, settled_at, amount_sats from social.payments where status = 'settled' union all "
            "select 'agent', settled_at, amount_sats from social.agent_payments where status = 'settled') t "
            "group by 1, 2 order by 1 desc, 2;"
        )
        rows = [{"month": m, "product": p, "payments": c, "sats": int(s)} for m, p, c, s in cur.fetchall()]
    return {
        "months": rows,
        "total_sats": sum(r["sats"] for r in rows),
        "note": "trade fees (MARKET_FEE_BPS) are paid on-chain to MARKET_FEE_ADDRESS inside each trade and aren't counted here",
    }
