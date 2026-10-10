"""Search (搜索): one box for a district number, a park's name, an address or an X handle.

GET /v1/search?q= answers with up to a few of each kind; the header shows them as you type.
An address matches from its start (at least MIN_ADDRESS characters, so a few letters don't
list half the city); park names and X handles match anywhere, ignoring case.
"""

import re

from fastapi import APIRouter, Query

from api import land, parks, xlink
from api.db import cursor

router = APIRouter()

LIMIT = 5
MIN_ADDRESS = 6
DISTRICTS_SHOWN = 6  # per person: the first few they hold, and how many in all


def _like(q):
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _people(cur, addresses):
    """[{address, x, districts, count}] for addresses that hold at least one district."""
    if not addresses:
        return []
    cur.execute(
        "select o.address, array_agg(b.bitmap_number order by b.bitmap_number) from inscription_owners o "
        "join bitmaps b on b.inscription_id = o.inscription_id where o.address = any(%s) group by o.address;",
        (list(addresses),),
    )
    held = dict(cur.fetchall())
    out = []
    for a in addresses:
        x = xlink.of(cur, a)
        if a in held or x:
            ns = held.get(a, [])
            out.append({"address": a, "x": x, "districts": ns[:DISTRICTS_SHOWN], "count": len(ns)})
    return out[:LIMIT]


@router.get("/v1/search")
def search(q: str = Query("", max_length=100)):
    q = q.strip()
    out = {"districts": [], "parks": [], "people": []}
    if not q:
        return out
    with cursor() as cur:
        m = re.fullmatch(r"#?(\d{1,7})(\.bitmap)?", q, re.IGNORECASE)
        if m:
            tip = land._heights(cur)["bitmap"]
            if tip is not None and int(m.group(1)) <= tip:
                out["districts"].append(int(m.group(1)))
        cur.execute(
            "select id from social.parks where name ilike %s escape '\\' order by length(name), id limit %s;",
            (f"%{_like(q)}%", LIMIT * 3),
        )
        ids = [r[0] for r in cur.fetchall()]
        if ids:
            live = parks._live(cur, "p.id = any(%s)", (ids,))
            out["parks"] = [
                {"id": p["id"], "name": p["name"], "members": len(p["members"]), "first": p["members"][0]}
                for p in (live[i] for i in ids if i in live)
            ][:LIMIT]
        addresses = []
        handle = q.lstrip("@")
        if handle and re.fullmatch(r"\w{1,15}", handle):
            cur.execute(
                "select address from social.x_accounts where username ilike %s escape '\\' "
                "order by lower(username) <> lower(%s), length(username), address limit %s;",
                (f"%{_like(handle)}%", handle, LIMIT),
            )
            addresses += [r[0] for r in cur.fetchall()]
        if len(q) >= MIN_ADDRESS and re.fullmatch(r"[A-Za-z0-9]+", q) and not m:
            cur.execute(
                "select distinct address from inscription_owners where address like %s order by address limit %s;",
                (_like(q.lower() if q[:3].lower() in ("bc1", "tb1") or q[:5].lower() == "bcrt1" else q) + "%", LIMIT),
            )
            addresses += [r[0] for r in cur.fetchall() if r[0] not in addresses]
        out["people"] = _people(cur, addresses)
    return out
