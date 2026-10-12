"""暂住居民: a way to move in today.

Handing over a parcel needs the owner to inscribe it and send it on chain, which takes a while
(api/recruit.py). Meanwhile the owner can let someone who applied stay as a tenant: from then on
they post top-level posts and vote in the district like a resident (api/roles.py). The stay lasts
while the owner who allowed it holds the district; either side can end it. Once a parcel of the
district reaches them they are a resident, and the stay no longer matters. Tenants don't count
towards prosperity's residents, which are parcels on chain.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api import notify, roles
from api.auth import current_address
from api.db import cursor

router = APIRouter()

MAX_TENANTS = 20  # per district


def tenants(cur, bitmap_number):
    """The district's tenants, as [{address, since}], newest first."""
    cur.execute(
        "select t.address, t.created_at from social.tenants t join bitmaps b on b.bitmap_number = t.bitmap_number "
        "join inscription_owners o on o.inscription_id = b.inscription_id and o.address = t.owner "
        "where t.bitmap_number = %s order by t.created_at desc;",
        (bitmap_number,),
    )
    return [{"address": a, "since": since.isoformat()} for a, since in cur.fetchall()]


class Let(BaseModel):
    address: str


@router.get("/v1/districts/{bitmap_number}/tenants")
def list_tenants(bitmap_number: int):
    with cursor() as cur:
        return {"tenants": tenants(cur, bitmap_number), "max": MAX_TENANTS}


@router.post("/v1/districts/{bitmap_number}/tenants", status_code=201)
def let_in(bitmap_number: int, req: Let, address: str = Depends(current_address)):
    """The owner lets someone who applied stay. Their application is done with."""
    with cursor() as cur:
        roles.require_owner(cur, bitmap_number, address)
        cur.execute(
            "select 1 from social.applications where bitmap_number = %s and address = %s;", (bitmap_number, req.address)
        )
        if cur.fetchone() is None:
            raise HTTPException(404, "they haven't applied here")
        role, _ = roles.role_in(cur, req.address, bitmap_number)
        if role != roles.VISITOR:
            raise HTTPException(409, "they already live here")
        # Stays from a previous owner are over; make room by clearing them out first.
        cur.execute("delete from social.tenants where bitmap_number = %s and owner <> %s;", (bitmap_number, address))
        if len(tenants(cur, bitmap_number)) >= MAX_TENANTS:
            raise HTTPException(409, f"at most {MAX_TENANTS} tenants a district")
        cur.execute(
            "insert into social.tenants (bitmap_number, address, owner) values (%s, %s, %s);",
            (bitmap_number, req.address, address),
        )
        cur.execute("delete from social.applications where bitmap_number = %s and address = %s;", (bitmap_number, req.address))
        notify.notify(cur, req.address, "tenant", address, bitmap_number)
        return {"tenants": tenants(cur, bitmap_number), "max": MAX_TENANTS}


@router.delete("/v1/districts/{bitmap_number}/tenants/{tenant}")
def end_stay(bitmap_number: int, tenant: str, address: str = Depends(current_address)):
    """The owner asks a tenant to leave, or the tenant leaves."""
    with cursor() as cur:
        if address != tenant:
            roles.require_owner(cur, bitmap_number, address)
        cur.execute("delete from social.tenants where bitmap_number = %s and address = %s;", (bitmap_number, tenant))
        return {"tenants": tenants(cur, bitmap_number), "max": MAX_TENANTS}
