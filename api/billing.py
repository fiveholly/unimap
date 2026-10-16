"""平台收费: the hooks for what unimap may charge for one day. All of it is off until switched on.

- Payments (`/v1/billing/*`): one flow for every paid product. A product sells while
  BILLING_PRICE_<PRODUCT>_SATS is set and unimap can be paid at least one way (METHODS):
  - onchain (the default): bitcoin sent from the buyer's wallet straight to PLATFORM_BTC_ADDRESS.
    The browser asks the connected wallet to send it and posts the txid; a pasted txid works too.
    bitcoind (BITCOIN_RPC_URL, with txindex) is asked for the transaction, which must pay that
    address at least the price. One seen in the mempool counts (0-conf): for a few thousand sats
    that is worth the risk of a double spend, and the buyer doesn't wait for a block. A txid pays
    for one payment only.
  - lightning: an invoice from unimap's Lightning address (PLATFORM_LIGHTNING_ADDRESS, else
    AGENT_LIGHTNING_ADDRESS), confirmed by its LUD-21 verify URL, as with tips (api/tips.py).
  Once paid either way, the product's on_settled hook delivers it. The agent's own payments
  (api/agent.py) came first and stay where they are; they could move here as a product later.
- Entitlements: what an address may use (a premium style option, say), granted free, paid, by a
  sponsor or by an admin, for good or until a date, and counted across linked wallets.
- Promotions (推广): districts shown in a labelled slot on the home page, put up by an admin.
- API keys: for a future paid data API. A valid X-API-Key gets its tier's write limit instead of
  the per-IP one (api/app.py). Reads stay free and need no key.
- Revenue: what was paid to unimap, by product and month, for admins.
"""

import functools
import hashlib
import logging
import os
import re
import secrets
import time
from datetime import datetime

import psycopg2.errors
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import btc, roles, tips, wallets
from api.auth import current_address, normalize_address
from api.db import cursor
from api.moderation import require_admin

router = APIRouter()
log = logging.getLogger(__name__)

PAY_PER_10_MINUTES = 5  # invoices one wallet group may ask for, as for the agent
SOURCES = ("free", "paid", "sponsor", "admin")
SLOTS = ("home",)
PROMOTION_DAYS = 7  # how long an approved promotion runs unless the admin says otherwise
KEY_CACHE_SECONDS = 60  # a revoked key may keep its limit this long in the other API worker
ITEM = re.compile(r"^[a-z0-9_-]{1,40}(:[a-z0-9_.-]{1,60})?$")
METHODS = ("onchain", "lightning")  # in the order they are offered; the first one on is the default
CHAIN_NETWORKS = ("mainnet", "testnet", "regtest")  # what PLATFORM_BTC_ADDRESS may be on (signet: as testnet)


def pay_to():
    """The Lightning address unimap is paid at, or None."""
    return (os.getenv("PLATFORM_LIGHTNING_ADDRESS") or os.getenv("AGENT_LIGHTNING_ADDRESS") or "").strip().lower() or None


@functools.lru_cache(maxsize=16)
def address_script(address):
    """scriptPubKey of a P2TR, P2WPKH or P2SH address on any of CHAIN_NETWORKS, or None."""
    for net in CHAIN_NETWORKS:
        try:
            return btc.address_script(address, net)
        except btc.BadTx:
            continue
    log.warning("PLATFORM_BTC_ADDRESS %r isn't a P2TR, P2WPKH or P2SH address; on-chain payments are off", address)
    return None


def chain_to():
    """The Bitcoin address unimap is paid at on-chain (PLATFORM_BTC_ADDRESS), or None."""
    a = normalize_address(os.getenv("PLATFORM_BTC_ADDRESS") or "")
    return a if a and address_script(a) else None


def methods():
    """The ways unimap can be paid now, default first."""
    on = {"onchain": chain_to(), "lightning": pay_to()}
    return [m for m in METHODS if on[m]]


def price(product):
    """Sats the product sells for now; 0 when it isn't for sale."""
    if product not in PRODUCTS or not methods() or (product == "style" and not cosmetics()):
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
    return {"products": [{"product": k, "amount_sats": price(k)} for k in PRODUCTS if price(k)], "cosmetics": cosmetics(),
            "methods": methods()}


class PayBody(BaseModel):
    product: str = Field(max_length=40)
    ref: str = Field(default="", max_length=100)
    method: str | None = Field(default=None, max_length=20)  # one of METHODS; left out: the default


PAYMENT_COLUMNS = "id, product, ref, amount_sats, status, method, pay_address, txid"


def _payment(row, invoice=None):
    pid, product, ref, amount, status, method, address, txid = row
    out = {"id": pid, "product": product, "ref": ref, "amount_sats": amount, "status": status, "verifiable": True, "method": method}
    if method == "onchain":
        out.update(address=address, txid=txid)
    elif invoice:
        out["invoice"] = invoice
    return out


def invoice(address, product, ref="", method=None):
    """A payment for a product, after its check hook, as /v1/billing/pay returns it: on-chain, to
    PLATFORM_BTC_ADDRESS (the default while it is set), or an invoice from unimap's Lightning
    wallet. Products that start their own payment (api/capsule.py) call this."""
    if product not in PRODUCTS:
        raise HTTPException(404, "no such product")
    if method is not None and method not in METHODS:
        raise HTTPException(400, f"method is one of {', '.join(METHODS)}")
    amount, offered = price(product), methods()
    if not amount:
        raise HTTPException(409, "not offered on this server")
    method = method or offered[0]
    if method not in offered:
        raise HTTPException(409, f"paying by {method} isn't offered on this server")
    ref = ref.strip()
    with cursor() as cur:
        PRODUCTS[product][0](cur, address, ref)
        payer = wallets.main_of(cur, address)
        cur.execute("select count(*) from social.payments where payer = %s and created_at > now() - interval '10 minutes';", (payer,))
        if cur.fetchone()[0] >= PAY_PER_10_MINUTES:
            raise HTTPException(429, "too many payments at once, try again in a few minutes")
    if method == "onchain":
        with cursor() as cur:
            cur.execute(
                "insert into social.payments (payer, product, ref, amount_sats, method, pay_address) values (%s, %s, %s, %s, 'onchain', %s) "
                f"returning {PAYMENT_COLUMNS};",
                (payer, product, ref, amount, chain_to()),
            )
            return _payment(cur.fetchone())
    try:
        bolt11, verify = tips.lnurl.ask_invoice(pay_to(), amount, f"unimap {product} {ref}".strip())
    except tips.LnurlError as e:
        raise HTTPException(502, str(e)) from e
    if verify is None:
        raise HTTPException(502, "unimap's Lightning wallet can't confirm payments; tell the site's admin")
    with cursor() as cur:
        cur.execute(
            "insert into social.payments (payer, product, ref, amount_sats, invoice, verify_url, method) "
            f"values (%s, %s, %s, %s, %s, %s, 'lightning') returning {PAYMENT_COLUMNS};",
            (payer, product, ref, amount, bolt11, verify),
        )
        return _payment(cur.fetchone(), invoice=bolt11)


@router.post("/v1/billing/pay")
def pay(req: PayBody, address: str = Depends(current_address)):
    """A payment for a product: an address and amount to send on-chain, or a Lightning invoice."""
    return invoice(address, req.product, req.ref, req.method)


# --- on-chain payments ----------------------------------------------------------------------------


class Chain:
    """bitcoind, behind one object so tests can replace it."""

    def transaction(self, txid):
        from api.land import _bitcoind  # land imports style, which imports this module

        return _bitcoind().transaction(txid)


chain = Chain()


def check_tx(txid, address, amount):
    """(state, why) of a transaction meant to pay amount to address: "paid" once bitcoind has it,
    in the mempool or a block, with outputs to address of at least amount; "unseen" while bitcoind
    doesn't know it (or can't be asked), so it is looked for again; "wrong" when it pays too
    little or not to address."""
    try:
        tx = chain.transaction(txid)
    except Exception as e:  # bitcoind down or busy: look again on the next check
        log.warning("on-chain payment %s: %s", txid, e)
        return "unseen", "bitcoind can't be asked right now"
    if not tx:
        return "unseen", "this transaction hasn't reached unimap's node yet"
    spk = address_script(address)
    paid = [round(o["value"] * 100_000_000) for o in tx.get("vout", []) if spk and o.get("scriptPubKey", {}).get("hex") == spk.hex()]
    if not paid:
        return "wrong", f"this transaction doesn't pay {address}"
    if sum(paid) < amount:
        return "wrong", f"this transaction pays {sum(paid)} sats to {address}; {amount} are needed"
    return "paid", None


class TxBody(BaseModel):
    txid: str = Field(pattern=r"^[0-9a-fA-F]{64}$")


@router.post("/v1/billing/payments/{payment_id}/tx")
def claim_tx(payment_id: int, req: TxBody, address: str = Depends(current_address)):
    """The transaction that pays an on-chain payment, from the wallet or pasted. Checked at once;
    while bitcoind hasn't seen it yet the payment stays pending and polling looks again. One that
    pays the wrong address or too little is turned down and not kept."""
    txid = req.txid.lower()
    with cursor() as cur:
        cur.execute("select payer, method, status, txid, pay_address, amount_sats from social.payments where id = %s;", (payment_id,))
        row = cur.fetchone()
        if row is None or row[0] not in wallets.group(cur, address):
            raise HTTPException(404, "no such payment")
        _, method, status, had, to, amount = row
        if method != "onchain":
            raise HTTPException(409, "this payment is over Lightning")
        if status == "settled" and had == txid:
            return refresh(payment_id, address)
        if status == "settled":
            raise HTTPException(409, "this payment is paid already")
        if status != "pending":
            raise HTTPException(410, "this payment expired; start again")
        cur.execute("select 1 from social.payments where txid = %s and id <> %s;", (txid, payment_id))
        if cur.fetchone():
            raise HTTPException(409, "this transaction already paid for something else")
    state, why = check_tx(txid, to, amount)
    if state == "wrong":
        raise HTTPException(400, why)
    try:
        with cursor() as cur:
            cur.execute("update social.payments set txid = %s, checked_at = now() where id = %s and status = 'pending';", (txid, payment_id))
    except psycopg2.errors.UniqueViolation as e:  # claimed by another payment a moment ago
        raise HTTPException(409, "this transaction already paid for something else") from e
    if state == "paid":
        settle(payment_id)
    return refresh(payment_id, address)


def refresh(payment_id, address=None, force=False):
    """Where a payment stands; while pending, asks whether it was paid (bitcoind for the claimed
    transaction, or the Lightning wallet; at most every CHECK_SECONDS unless force), once more just
    before it expires, and runs on_settled once paid. With address, only a payment of its wallet
    group; None if there is no such payment."""
    with cursor() as cur:
        cur.execute(
            f"select payer, {PAYMENT_COLUMNS}, verify_url, created_at < now() - make_interval(mins => %s), "
            "checked_at is null or checked_at < now() - make_interval(secs => %s) from social.payments where id = %s;",
            (tips.EXPIRE_MINUTES, tips.CHECK_SECONDS, payment_id),
        )
        row = cur.fetchone()
        if row is None or (address is not None and row[0] not in wallets.group(cur, address)):
            return None
        view, (verify, old, due) = list(row[1:9]), row[9:]
        amount, status, method, to, txid = view[3:]
        if status != "pending" or not (due or force):
            return _payment(view)
        cur.execute("update social.payments set checked_at = now() where id = %s;", (payment_id,))
    if method == "onchain":
        state = check_tx(txid, to, amount)[0] if txid else "unseen"
        if state == "wrong":  # replaced since it was claimed: free the txid so another can be given
            with cursor() as cur:
                cur.execute("update social.payments set txid = null where id = %s and status = 'pending';", (payment_id,))
            view[7] = None
        paid = state == "paid"
    else:
        try:
            paid = tips.lnurl.settled(verify)
        except tips.LnurlError:
            paid = False
    if not paid:
        if old:
            with cursor() as cur:
                cur.execute("update social.payments set status = 'expired' where id = %s and status = 'pending';", (payment_id,))
            view[4] = "expired"
        return _payment(view)
    settle(payment_id)
    view[4] = "settled"
    return _payment(view)


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
