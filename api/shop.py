"""店铺: a district's owner, or a resident for their parcel, can sell digital goods there (a file
link, a code, a piece of writing). The buyer pays over Lightning straight to the seller's own
wallet, the same way as a tip (api/tips.py): unimap asks the seller's Lightning address for an
invoice and its LUD-21 verify URL for whether it was paid, and never holds the money. What was
bought (the item's content) is shown to the buyer only once the payment is confirmed, so a
seller's wallet must support LUD-21 to sell here.

An item belongs to the place it was listed in. It stays up only while the seller still holds
that place; when the district or parcel changes hands, it can't be bought any more. Physical
goods aren't sold here yet: shipping and refunds are a different business.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import moderation, notify, tips, wallets
from api.auth import current_address, optional_address
from api.db import cursor

router = APIRouter()

MAX_TITLE = 80
MAX_DESCRIPTION = 1000
MAX_CONTENT = 4000
MAX_ITEMS = 20  # per place
MAX_PRICE = tips.MAX_SATS
ORDERS_PER_10_MINUTES = 10

COLUMNS = "i.id, i.bitmap_number, i.tx_index, i.seller, i.title, i.description, i.price_sats, i.stock, i.active, i.created_at, " \
    "(select count(*) from social.shop_orders o where o.item_id = i.id and o.status = 'settled') as sold"
KEYS = ("id", "bitmap_number", "tx_index", "seller", "title", "description", "price_sats", "stock", "active", "created_at", "sold")


def _holder(cur, n, tx_index):
    from api import agent  # the district's owner, or the parcel's holder

    return agent.holder(cur, n, tx_index)


def _item(row, live):
    i = dict(zip(KEYS, row.values() if isinstance(row, dict) else row))
    i["created_at"] = i["created_at"].isoformat()
    i["left"] = None if i["stock"] is None else max(0, i["stock"] - i["sold"])
    i["on_sale"] = bool(i["active"] and live and i["left"] != 0)
    return i


def items(cur, n, viewer=None, everything=False):
    """The shop of district n: what is on sale there now, each with the viewer's own purchases.
    With everything, the items no longer on sale too (for their sellers)."""
    cur.execute(f"select {COLUMNS} from social.shop_items i where i.bitmap_number = %s order by i.id;", (n,))
    rows = cur.fetchall()
    holders, out = {}, []
    for r in rows:
        key, seller = (r["tx_index"], r["seller"]) if isinstance(r, dict) else (r[2], r[3])
        if key not in holders:
            holders[key] = _holder(cur, n, key)
        i = _item(r, holders[key] == seller)
        mine = viewer is not None and i["seller"] == viewer
        if not (i["on_sale"] or (everything and mine)):
            continue
        i["mine"] = mine
        out.append(i)
    if viewer is not None and out:
        cur.execute(
            "select o.id, o.item_id, i.content, o.settled_at from social.shop_orders o join social.shop_items i on i.id = o.item_id "
            "where o.buyer = %s and o.status = 'settled' and o.item_id = any(%s) order by o.id;",
            (viewer, [i["id"] for i in out]),
        )
        bought = {}
        for oid, item_id, content, at in cur.fetchall():
            bought.setdefault(item_id, []).append({"order_id": oid, "content": content, "at": at.isoformat()})
        for i in out:
            i["bought"] = bought.get(i["id"], [])
    return out


@router.get("/v1/districts/{bitmap_number}/shop")
def shop(bitmap_number: int, viewer: str | None = Depends(optional_address)):
    """Items on sale in the district, by its owner and its residents. A seller also sees their items taken down."""
    with cursor() as cur:
        return {"items": items(cur, bitmap_number, viewer, everything=True)}


class ItemBody(BaseModel):
    parcel: int | None = None  # sell as the holder of this parcel; the district's owner leaves it out
    title: str = Field(min_length=1, max_length=MAX_TITLE)
    description: str = Field(default="", max_length=MAX_DESCRIPTION)
    price_sats: int = Field(ge=tips.MIN_SATS, le=MAX_PRICE)
    content: str = Field(min_length=1, max_length=MAX_CONTENT)  # what the buyer gets once paid
    stock: int | None = Field(default=None, ge=1, le=100_000)  # None: no limit


def _check_seller(cur, n, tx_index, address):
    if _holder(cur, n, tx_index) != address:
        raise HTTPException(403, "only the district owner can sell here" if tx_index is None else f"only the holder of parcel #{tx_index} can sell here")
    if moderation.banned(cur, address):
        raise HTTPException(403, "this address is banned")
    cur.execute("select 1 from social.mutes where bitmap_number = %s and address = %s;", (n, address))
    if cur.fetchone() is not None:
        raise HTTPException(403, "muted in this district")
    if tips.lightning_of(cur, address) is None:
        raise HTTPException(409, "set a Lightning address first, so buyers can pay you")


@router.post("/v1/districts/{bitmap_number}/shop", status_code=201)
def add_item(bitmap_number: int, req: ItemBody, address: str = Depends(current_address)):
    with cursor() as cur:
        _check_seller(cur, bitmap_number, req.parcel, address)
        cur.execute("select count(*) from social.shop_items where bitmap_number = %s and tx_index is not distinct from %s "
                    "and seller = %s and active;", (bitmap_number, req.parcel, address))
        if cur.fetchone()[0] >= MAX_ITEMS:
            raise HTTPException(429, f"at most {MAX_ITEMS} items on sale at once here")
        cur.execute(
            "insert into social.shop_items (bitmap_number, tx_index, seller, title, description, price_sats, content, stock) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s) returning id;",
            (bitmap_number, req.parcel, address, req.title.strip(), req.description.strip(), req.price_sats, req.content.strip(), req.stock),
        )
        item_id = cur.fetchone()[0]
        return _mine(cur, item_id, address)


def _mine(cur, item_id, address):
    cur.execute(f"select {COLUMNS}, i.content from social.shop_items i where i.id = %s;", (item_id,))
    row = cur.fetchone()
    if row is None or row[3] != address:
        raise HTTPException(404, "no such item")
    i = _item(row[:-1], _holder(cur, row[1], row[2]) == address)
    return {**i, "mine": True, "content": row[-1]}


class ItemEdit(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=MAX_TITLE)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION)
    price_sats: int | None = Field(default=None, ge=tips.MIN_SATS, le=MAX_PRICE)
    content: str | None = Field(default=None, min_length=1, max_length=MAX_CONTENT)
    stock: int | None = Field(default=None, ge=1, le=100_000)
    unlimited: bool = False  # clear the stock limit
    active: bool | None = None


@router.get("/v1/shop/items/{item_id}")
def my_item(item_id: int, address: str = Depends(current_address)):
    """For its seller: the item with what buyers get."""
    with cursor() as cur:
        return _mine(cur, item_id, address)


@router.put("/v1/shop/items/{item_id}")
def edit_item(item_id: int, req: ItemEdit, address: str = Depends(current_address)):
    with cursor() as cur:
        before = _mine(cur, item_id, address)
        if req.active:
            _check_seller(cur, before["bitmap_number"], before["tx_index"], address)
        sets, args = [], []
        for k in ("title", "description", "price_sats", "content", "active"):
            v = getattr(req, k)
            if v is not None:
                sets.append(f"{k} = %s")
                args.append(v.strip() if isinstance(v, str) else v)
        if req.unlimited or req.stock is not None:
            sets.append("stock = %s")
            args.append(None if req.unlimited else req.stock)
        if sets:
            cur.execute(f"update social.shop_items set {', '.join(sets)}, updated_at = now() where id = %s;", (*args, item_id))
        return _mine(cur, item_id, address)


@router.delete("/v1/shop/items/{item_id}")
def remove_item(item_id: int, address: str = Depends(current_address)):
    """Take an item down. Who already bought it keeps what they bought."""
    with cursor() as cur:
        _mine(cur, item_id, address)
        cur.execute("update social.shop_items set active = false, updated_at = now() where id = %s;", (item_id,))
    return {"ok": True}


@router.post("/v1/shop/items/{item_id}/buy")
def buy(item_id: int, address: str = Depends(current_address)):
    """An invoice from the seller's wallet for the item's price, with the order's id to check on."""
    with cursor() as cur:
        cur.execute(f"select {COLUMNS} from social.shop_items i where i.id = %s;", (item_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(404, "no such item")
        i = _item(row, _holder(cur, row[1], row[2]) == row[3])
        if not i["on_sale"]:
            raise HTTPException(409, "sold out" if i["left"] == 0 else "this item isn't on sale any more")
        if wallets.main_of(cur, i["seller"]) == wallets.main_of(cur, address):
            raise HTTPException(400, "you can't buy your own item")
        to = tips.lightning_of(cur, i["seller"])
        if to is None:
            raise HTTPException(409, "the seller hasn't set up a Lightning address")
        cur.execute("select count(*) from social.shop_orders where buyer = %s and created_at > now() - interval '10 minutes';", (address,))
        if cur.fetchone()[0] >= ORDERS_PER_10_MINUTES:
            raise HTTPException(429, "too many orders at once, try again in a few minutes")
    try:
        invoice, verify = tips.lnurl.ask_invoice(to, i["price_sats"], f"unimap {i['bitmap_number']}.bitmap: {i['title']}")
    except tips.LnurlError as e:
        raise HTTPException(502, str(e)) from e
    if verify is None:
        raise HTTPException(502, "the seller's wallet can't confirm payments, so the shop can't deliver; ask them to use one that can")
    with cursor() as cur:
        cur.execute(
            "insert into social.shop_orders (item_id, buyer, seller, amount_sats, invoice, verify_url) values (%s, %s, %s, %s, %s, %s) "
            "returning id;",
            (item_id, address, i["seller"], i["price_sats"], invoice, verify),
        )
        return {"id": cur.fetchone()[0], "invoice": invoice, "amount_sats": i["price_sats"], "verifiable": True, "status": "pending"}


@router.get("/v1/shop/orders/{order_id}")
def order_status(order_id: int, address: str = Depends(current_address)):
    """Where an order stands; while pending, asks the seller's wallet whether it was paid. Once paid, what was bought."""
    with cursor() as cur:
        cur.execute(
            "select o.buyer, o.seller, o.item_id, i.bitmap_number, o.verify_url, o.status, "
            "o.created_at < now() - make_interval(mins => %s), "
            "o.checked_at is null or o.checked_at < now() - make_interval(secs => %s) "
            "from social.shop_orders o join social.shop_items i on i.id = o.item_id where o.id = %s;",
            (tips.EXPIRE_MINUTES, tips.CHECK_SECONDS, order_id),
        )
        row = cur.fetchone()
        if row is None or row[0] != address:
            raise HTTPException(404, "no such order")
        buyer, seller, item_id, n, verify, status, old, due = row
        if status == "pending" and due and old:
            cur.execute("update social.shop_orders set status = 'expired' where id = %s;", (order_id,))
            status = "expired"
        elif status == "pending" and due:
            cur.execute("update social.shop_orders set checked_at = now() where id = %s;", (order_id,))
    if status == "pending" and due:
        try:
            paid = tips.lnurl.settled(verify)
        except tips.LnurlError:
            paid = False
        if paid:
            with cursor() as cur:
                cur.execute("update social.shop_orders set status = 'settled', settled_at = now() where id = %s and status = 'pending' "
                            "returning id;", (order_id,))
                if cur.fetchone():
                    notify.notify(cur, seller, "shop_sold", buyer, n, order_id=order_id)
            status = "settled"
    out = {"id": order_id, "item_id": item_id, "status": status, "verifiable": True}
    if status == "settled":
        with cursor() as cur:
            cur.execute("select content from social.shop_items where id = %s;", (item_id,))
            out["content"] = cur.fetchone()[0]
    return out


@router.get("/v1/me/shop")
def my_shop(address: str = Depends(current_address)):
    """What this address bought, newest first, and what it sold."""
    with cursor() as cur:
        cur.execute(
            "select o.id, o.item_id, i.bitmap_number, i.title, o.amount_sats, i.content, o.settled_at from social.shop_orders o "
            "join social.shop_items i on i.id = o.item_id where o.buyer = %s and o.status = 'settled' order by o.id desc limit 100;",
            (address,),
        )
        bought = [{"order_id": a, "item_id": b, "bitmap_number": c, "title": d, "amount_sats": e, "content": f, "at": g.isoformat()}
                  for a, b, c, d, e, f, g in cur.fetchall()]
        cur.execute(
            "select o.id, o.item_id, i.bitmap_number, i.title, o.amount_sats, o.buyer, o.settled_at from social.shop_orders o "
            "join social.shop_items i on i.id = o.item_id where o.seller = %s and o.status = 'settled' order by o.id desc limit 100;",
            (address,),
        )
        sold = [{"order_id": a, "item_id": b, "bitmap_number": c, "title": d, "amount_sats": e, "buyer": f, "at": g.isoformat()}
                for a, b, c, d, e, f, g in cur.fetchall()]
    return {"bought": bought, "sold": sold}
