"""In-app notifications (通知): someone replied to your post, liked it, posted in or followed
your district, applied to live there, or tipped you sats (api/tips.py); or a block put a
treasure on your parcel or made your district the lucky one (api/game.py), or your district
won a crown at the end of a season (api/seasons.py), you won a prize in a district event (api/events.py), or someone bought what you listed, made you an offer, or took yours (api/market.py), or bought something in your shop (api/shop.py); or your district's agent has drafts for you to look at or posted on its own, or saw a listing you asked it to watch for (api/agent.py). Each is written in
the same transaction as the action, for the address it concerns, and never for your own actions.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from api.auth import current_address
from api.db import cursor

router = APIRouter()

KINDS = ("reply", "like", "post", "follow", "apply", "tip", "treasure", "lucky", "crown", "event_win", "sold", "offer", "offer_accepted", "agent_draft", "agent_posted", "agent_alert", "shop_sold")
PAGE = 30


def notify(cur, address, kind, actor, bitmap_number, post_id=None, tip_id=None, block_height=None, order_id=None):
    """Tell address that actor did kind. A like or follow repeated after an undo isn't told twice."""
    assert kind in KINDS
    if not address or address == actor:
        return
    cur.execute(
        "insert into social.notifications (address, kind, actor, bitmap_number, post_id, tip_id, block_height, order_id) "
        "values (%s, %s, %s, %s, %s, %s, %s, %s) on conflict do nothing;",
        (address, kind, actor, bitmap_number, post_id, tip_id, block_height, order_id),
    )


def _unread(cur, address):
    cur.execute("select count(*) from social.notifications where address = %s and read_at is null;", (address,))
    return cur.fetchone()[0]


@router.get("/v1/notifications")
def notifications(before: int | None = None, address: str = Depends(current_address)):
    """Newest first, PAGE at a time; each with the post it is about, if any."""
    with cursor() as cur:
        cur.execute(
            "select n.id, n.kind, n.actor, n.bitmap_number, n.post_id, n.created_at, n.read_at is not null, "
            "case when p.removed_at is null then left(p.body, 140) end, t.amount_sats, t.comment, n.block_height, d.treasure_tx, d.rarity, ag.tx_index, si.title, so.amount_sats "
            "from social.notifications n left join social.posts p on p.id = n.post_id "
            "left join social.tips t on t.id = n.tip_id "
            "left join social.block_draws d on d.height = n.block_height and n.kind = 'treasure' "
            "left join social.agents ag on ag.agent_key = n.actor and n.kind like 'agent%%' "
            "left join social.shop_orders so on so.id = n.order_id left join social.shop_items si on si.id = so.item_id "
            "where n.address = %s and (%s::int8 is null or n.id < %s) order by n.id desc limit %s;",
            (address, before, before, PAGE),
        )
        rows = [
            {
                "id": i,
                "kind": kind,
                "actor": actor,
                "bitmap_number": n,
                "post_id": post_id,
                "created_at": at.isoformat(),
                "read": read,
                "snippet": snippet,
                **({"amount_sats": sats, "comment": comment} if kind == "tip" else {}),
                **({"block_height": height} if kind in ("treasure", "lucky", "crown", "event_win", "sold") else {}),
                **({"tx_index": tx, "rarity": rare} if kind == "treasure" else {}),
                **({"agent_parcel": agent_tx} if kind.startswith("agent") else {}),  # set when it's a parcel's agent
                **({"title": title, "amount_sats": paid} if kind == "shop_sold" else {}),
            }
            for i, kind, actor, n, post_id, at, read, snippet, sats, comment, height, tx, rare, agent_tx, title, paid in cur.fetchall()
        ]
        return {"notifications": rows, "unread": _unread(cur, address)}


@router.get("/v1/notifications/unread")
def unread(address: str = Depends(current_address)):
    with cursor() as cur:
        return {"unread": _unread(cur, address)}


class ReadBody(BaseModel):
    up_to: int | None = None  # mark read up to this id; all if left out


@router.post("/v1/notifications/read")
def mark_read(req: ReadBody, address: str = Depends(current_address)):
    with cursor() as cur:
        cur.execute(
            "update social.notifications set read_at = now() where address = %s and read_at is null "
            "and (%s::int8 is null or id <= %s);",
            (address, req.up_to, req.up_to),
        )
        return {"unread": _unread(cur, address)}
