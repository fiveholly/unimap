"""Recruiting residents (招募居民).

A district owner posts a notice saying who they're looking for and which plots are on offer;
signed-in visitors apply with a short note and the owner sees the list. Handing over a plot
still happens on chain: the owner inscribes the parcel and sends it to the new resident, who
becomes a resident as soon as the indexer sees it. A notice lapses when the district is sold.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import parks, roles
from api.auth import current_address
from api.db import cursor

router = APIRouter()

MAX_OFFERED = 50
LIST_SIZE = 50

ACTIVE = (
    "from social.recruitments r join bitmaps b on b.bitmap_number = r.bitmap_number "
    "join inscription_owners o on o.inscription_id = b.inscription_id and o.address = r.created_by "
)


def _open_plots(cur, bitmap_number, plots):
    """The plots in the list nobody has claimed yet."""
    cur.execute("select tx_index from parcels where bitmap_number = %s and tx_index = any(%s);", (bitmap_number, plots))
    taken = {r[0] for r in cur.fetchall()}
    return [i for i in plots if i not in taken]


def get(cur, bitmap_number, viewer=None):
    """The district's live notice, or None."""
    cur.execute(
        "select r.message, r.parcels, r.updated_at, "
        "(select count(*) from social.applications a where a.bitmap_number = r.bitmap_number), "
        "exists(select 1 from social.applications a where a.bitmap_number = r.bitmap_number and a.address = %s) "
        + ACTIVE
        + "where r.bitmap_number = %s;",
        (viewer, bitmap_number),
    )
    row = cur.fetchone()
    if row is None:
        return None
    message, plots, updated_at, applications, applied = row
    return {
        "message": message,
        "parcels": _open_plots(cur, bitmap_number, plots),
        "updated_at": updated_at.isoformat(),
        "applications": applications,
        "applied": applied,
    }


@router.get("/v1/recruiting")
def recruiting():
    """Districts looking for residents, newest notice first."""
    with cursor() as cur:
        cur.execute(
            "select r.bitmap_number, r.message, r.parcels, r.updated_at, r.created_by "
            + ACTIVE
            + "order by r.updated_at desc limit %s;",
            (LIST_SIZE,),
        )
        rows = cur.fetchall()
        numbers = [r[0] for r in rows]
        cur.execute("select block_height, zone from block_zones where block_height = any(%s);", (numbers,))
        zones = dict(cur.fetchall())
        out = []
        for n, message, plots, updated_at, owner in rows:
            levels, _ = parks.scored(cur, n, n)
            out.append(
                {
                    "bitmap_number": n,
                    "name": f"{n}.bitmap",
                    "zone": zones.get(n),
                    "owner": owner,
                    "level": levels[n],
                    "message": message,
                    "parcels": _open_plots(cur, n, plots),
                    "updated_at": updated_at.isoformat(),
                }
            )
    return {"districts": out}


class Notice(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    parcels: list[int] = Field(default_factory=list, max_length=MAX_OFFERED)


@router.put("/v1/districts/{bitmap_number}/recruit")
def set_notice(bitmap_number: int, req: Notice, address: str = Depends(current_address)):
    plots = sorted(set(req.parcels))
    with cursor() as cur:
        roles.require_owner(cur, bitmap_number, address)
        cur.execute("select tx_count from block_zones where block_height = %s;", (bitmap_number,))
        row = cur.fetchone()
        if any(i < 0 or (row and row[0] is not None and i >= row[0]) for i in plots):
            raise HTTPException(400, "no such plot in this block")
        if len(_open_plots(cur, bitmap_number, plots)) != len(plots):
            raise HTTPException(400, "some of these plots are already claimed")
        # Applications were made to the previous owner's notice; a new owner starts afresh.
        cur.execute("select created_by from social.recruitments where bitmap_number = %s;", (bitmap_number,))
        before = cur.fetchone()
        if before and before[0] != address:
            cur.execute("delete from social.applications where bitmap_number = %s;", (bitmap_number,))
        cur.execute(
            "insert into social.recruitments (bitmap_number, message, parcels, created_by) values (%s, %s, %s, %s) "
            "on conflict (bitmap_number) do update set message = excluded.message, parcels = excluded.parcels, "
            "created_by = excluded.created_by, updated_at = now();",
            (bitmap_number, req.message.strip(), plots, address),
        )
        return get(cur, bitmap_number, address)


@router.delete("/v1/districts/{bitmap_number}/recruit")
def end_notice(bitmap_number: int, address: str = Depends(current_address)):
    with cursor() as cur:
        roles.require_owner(cur, bitmap_number, address)
        cur.execute("delete from social.recruitments where bitmap_number = %s;", (bitmap_number,))
        cur.execute("delete from social.applications where bitmap_number = %s;", (bitmap_number,))
    return {"ok": True}


class Application(BaseModel):
    note: str = Field(default="", max_length=200)


@router.put("/v1/districts/{bitmap_number}/application")
def apply(bitmap_number: int, req: Application, address: str = Depends(current_address)):
    with cursor() as cur:
        if get(cur, bitmap_number) is None:
            raise HTTPException(404, "this district isn't recruiting")
        role, _ = roles.role_in(cur, address, bitmap_number)
        if role != roles.VISITOR:
            raise HTTPException(400, "you already live here")
        cur.execute(
            "insert into social.applications (bitmap_number, address, note) values (%s, %s, %s) "
            "on conflict (bitmap_number, address) do update set note = excluded.note;",
            (bitmap_number, address, req.note.strip()),
        )
    return {"ok": True}


@router.delete("/v1/districts/{bitmap_number}/application")
def withdraw(bitmap_number: int, address: str = Depends(current_address)):
    with cursor() as cur:
        cur.execute("delete from social.applications where bitmap_number = %s and address = %s;", (bitmap_number, address))
    return {"ok": True}


@router.get("/v1/districts/{bitmap_number}/applications")
def applications(bitmap_number: int, address: str = Depends(current_address)):
    """Who has applied, newest first. Owner only."""
    with cursor() as cur:
        roles.require_owner(cur, bitmap_number, address)
        cur.execute(
            "select address, note, created_at from social.applications where bitmap_number = %s order by created_at desc;",
            (bitmap_number,),
        )
        return {
            "applications": [
                {"address": a, "note": note, "created_at": t.isoformat()} for a, note, t in cur.fetchall()
            ]
        }
