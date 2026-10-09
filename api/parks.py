"""Parks (园区): districts one address holds that touch on the map, joined under one name.

The map (web/components/CityMap.tsx) lays blocks out in quarters of SIDE x SIDE separated
by streets, so a park lies inside one quarter and its members are joined edge to edge.
Members score together: every district in a park is drawn at the level of the park's total
score. A member counts only while the park's owner still holds it, so selling a district
takes it out of the park; a park left with fewer than two members is not shown.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import prosperity
from api.auth import current_address
from api.db import cursor

router = APIRouter()

SIDE = 8
PER_Q = SIDE * SIDE
MIN_MEMBERS = 2


def neighbours(n):
    q, i = divmod(n, PER_Q)
    v, u = divmod(i, SIDE)
    for du, dv in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        if 0 <= u + du < SIDE and 0 <= v + dv < SIDE:
            yield q * PER_Q + (v + dv) * SIDE + u + du


def connected(members):
    members = set(members)
    if not members or len({n // PER_Q for n in members}) != 1:
        return False
    seen, todo = set(), [min(members)]
    while todo:
        n = todo.pop()
        if n in seen:
            continue
        seen.add(n)
        todo += [m for m in neighbours(n) if m in members]
    return seen == members


def _live(cur, where, args):
    """{park_id: park} with only the members its owner still holds, for parks matching where."""
    cur.execute(
        "select p.id, p.name, p.owner_address, m.bitmap_number, o.address from social.parks p "
        "join social.park_members m on m.park_id = p.id "
        "left join bitmaps b on b.bitmap_number = m.bitmap_number "
        "left join inscription_owners o on o.inscription_id = b.inscription_id "
        f"where {where} order by m.bitmap_number;",
        args,
    )
    parks = {}
    for pid, name, owner, n, holder in cur.fetchall():
        park = parks.setdefault(pid, {"id": pid, "name": name, "owner": owner, "members": []})
        if holder == owner:
            park["members"].append(n)
    return {pid: p for pid, p in parks.items() if len(p["members"]) >= MIN_MEMBERS}


def in_range(cur, lo, hi):
    return _live(
        cur,
        "p.id in (select park_id from social.park_members where bitmap_number between %s and %s)",
        (lo, hi),
    )


def scored(cur, lo, hi):
    """Prosperity for lo..hi with parks applied: ({n: level}, {n: park}), every park with its
    total score and level."""
    qlo, qhi = lo - lo % PER_Q, hi - hi % PER_Q + PER_Q - 1
    parts = prosperity.parts_for(cur, qlo, qhi)
    own = {n: prosperity.prosperity(n, parts.get(n) or prosperity.empty_parts()) for n in range(qlo, qhi + 1)}
    parks = in_range(cur, lo, hi)
    park_of = {}
    for park in parks.values():
        park["score"] = sum(own[n]["score"] for n in park["members"])
        park["level"] = prosperity.level_of(park["score"])
        for n in park["members"]:
            park_of[n] = park
    levels = {n: max(own[n]["level"], park_of[n]["level"] if n in park_of else 0) for n in range(lo, hi + 1)}
    return levels, park_of


class ParkBody(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    members: list[int] = Field(min_length=MIN_MEMBERS, max_length=PER_Q)


def _check(cur, req, address, park_id=None):
    members = sorted(set(req.members))
    if len(members) < MIN_MEMBERS or not connected(members):
        raise HTTPException(400, "a park is two or more districts joined edge to edge in one quarter")
    cur.execute(
        "select b.bitmap_number from bitmaps b join inscription_owners o on o.inscription_id = b.inscription_id "
        "where b.bitmap_number = any(%s) and o.address = %s;",
        (members, address),
    )
    if len(cur.fetchall()) != len(members):
        raise HTTPException(403, "you must hold every district in the park")
    taken = [
        n for p in _live(cur, "m.bitmap_number = any(%s)", (members,)).values() if p["id"] != park_id for n in p["members"]
    ]
    if set(taken) & set(members):
        raise HTTPException(409, "some of these districts are already in a park")
    # Rows left over from parks whose owner no longer holds the district are free to take.
    cur.execute("delete from social.park_members where bitmap_number = any(%s);", (members,))
    return members


def _add(cur, park_id, members):
    cur.execute(
        "insert into social.park_members (bitmap_number, park_id) select unnest(%s::int4[]), %s;", (members, park_id)
    )


def get(cur, park_id):
    parks = _live(cur, "p.id = %s", (park_id,))
    if park_id not in parks:
        return None
    park = parks[park_id]
    lo, hi = park["members"][0], park["members"][-1]
    _, park_of = scored(cur, lo, hi)
    return park_of[lo]


@router.get("/v1/parks/{park_id}")
def park(park_id: int):
    with cursor() as cur:
        found = get(cur, park_id)
    if found is None:
        raise HTTPException(404, "no such park")
    return found


@router.post("/v1/parks", status_code=201)
def create_park(req: ParkBody, address: str = Depends(current_address)):
    with cursor() as cur:
        members = _check(cur, req, address)
        cur.execute(
            "insert into social.parks (name, owner_address) values (%s, %s) returning id;", (req.name.strip(), address)
        )
        park_id = cur.fetchone()[0]
        _add(cur, park_id, members)
        return get(cur, park_id)


def _own_park(cur, park_id, address):
    cur.execute("select owner_address from social.parks where id = %s;", (park_id,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "no such park")
    if row[0] != address:
        raise HTTPException(403, "only the park's owner can do this")


@router.put("/v1/parks/{park_id}")
def update_park(park_id: int, req: ParkBody, address: str = Depends(current_address)):
    with cursor() as cur:
        _own_park(cur, park_id, address)
        cur.execute("delete from social.park_members where park_id = %s;", (park_id,))
        members = _check(cur, req, address, park_id)
        cur.execute("update social.parks set name = %s where id = %s;", (req.name.strip(), park_id))
        _add(cur, park_id, members)
        return get(cur, park_id)


@router.delete("/v1/parks/{park_id}")
def delete_park(park_id: int, address: str = Depends(current_address)):
    with cursor() as cur:
        _own_park(cur, park_id, address)
        cur.execute("delete from social.park_members where park_id = %s;", (park_id,))
        cur.execute("delete from social.parks where id = %s;", (park_id,))
    return {"ok": True}
