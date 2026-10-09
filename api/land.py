"""Land API: districts, parcels and who holds them."""

from fastapi import APIRouter, HTTPException

from api.db import cursor

router = APIRouter()


def _owner(outpoint, address, value):
    if outpoint is None:
        return None  # owner tracker hasn't reached this inscription yet
    return {"address": address, "outpoint": outpoint, "output_value": value}


def _heights(cur):
    cur.execute(
        "select (select max(block_height) from bitmap_block_hashes), "
        "(select max(block_height) from parcel_block_hashes), "
        "(select max(block_height) from owner_block_hashes);"
    )
    bitmap, parcel, owner = cur.fetchone()
    return {"bitmap": bitmap, "parcel": parcel, "owner": owner}


PARCEL_SELECT = (
    "select p.tx_index, p.bitmap_number, p.inscription_id, p.inscription_number, p.block_height, "
    "o.outpoint, o.address, o.output_value "
    "from parcels p left join inscription_owners o on o.inscription_id = p.inscription_id "
)


def _parcel(row):
    tx_index, bitmap_number, inscription_id, number, height, *owner = row
    return {
        "name": f"{tx_index}.{bitmap_number}.bitmap",
        "bitmap_number": bitmap_number,
        "tx_index": tx_index,
        "inscription_id": inscription_id,
        "inscription_number": number,
        "inscribed_height": height,
        "owner": _owner(*owner),
    }


@router.get("/v1/status")
def status():
    with cursor() as cur:
        return {"indexed_height": _heights(cur)}


@router.get("/v1/land/{bitmap_number}")
def land(bitmap_number: int):
    with cursor() as cur:
        heights = _heights(cur)
        if bitmap_number < 0 or heights["bitmap"] is None or bitmap_number > heights["bitmap"]:
            raise HTTPException(404, "no such block yet")
        cur.execute("select tx_count from block_meta where block_height = %s;", (bitmap_number,))
        row = cur.fetchone()
        tx_count = None if row is None else row[0]
        cur.execute(
            "select b.inscription_id, b.inscription_number, b.block_height, o.outpoint, o.address, o.output_value "
            "from bitmaps b left join inscription_owners o on o.inscription_id = b.inscription_id "
            "where b.bitmap_number = %s;",
            (bitmap_number,),
        )
        row = cur.fetchone()
        result = {"name": f"{bitmap_number}.bitmap", "bitmap_number": bitmap_number, "tx_count": tx_count}
        if row is None:
            return {**result, "claimed": False, "district": None, "parcels": []}
        inscription_id, number, height, *owner = row
        cur.execute(PARCEL_SELECT + "where p.bitmap_number = %s order by p.tx_index;", (bitmap_number,))
        parcels = [_parcel(r) for r in cur.fetchall()]
        return {
            **result,
            "claimed": True,
            "district": {
                "inscription_id": inscription_id,
                "inscription_number": number,
                "inscribed_height": height,
                "owner": _owner(*owner),
            },
            "parcels": parcels,
        }


@router.get("/v1/land/{bitmap_number}/parcels/{tx_index}")
def parcel(bitmap_number: int, tx_index: int):
    with cursor() as cur:
        cur.execute(PARCEL_SELECT + "where p.bitmap_number = %s and p.tx_index = %s;", (bitmap_number, tx_index))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(404, "parcel not claimed")
        return _parcel(row)


@router.get("/v1/addresses/{address}/land")
def address_land(address: str):
    with cursor() as cur:
        cur.execute(
            "select b.bitmap_number, b.inscription_id, b.inscription_number, b.block_height "
            "from inscription_owners o join bitmaps b on b.inscription_id = o.inscription_id "
            "where o.address = %s order by b.bitmap_number;",
            (address,),
        )
        districts = [
            {
                "name": f"{n}.bitmap",
                "bitmap_number": n,
                "inscription_id": i,
                "inscription_number": num,
                "inscribed_height": h,
            }
            for n, i, num, h in cur.fetchall()
        ]
        cur.execute(
            PARCEL_SELECT + "where o.address = %s order by p.bitmap_number, p.tx_index;",
            (address,),
        )
        parcels = [_parcel(r) for r in cur.fetchall()]
        return {"address": address, "districts": districts, "parcels": parcels}


def _event(row):
    id_, height, block_time, kind, inscription_id, bitmap_number, tx_index, from_address, to_address = row
    return {
        "id": id_,
        "kind": kind,
        "block_height": height,
        "block_time": block_time,
        "inscription_id": inscription_id,
        "bitmap_number": bitmap_number,
        "tx_index": tx_index,
        "from_address": from_address,
        "to_address": to_address,
    }


EVENT_SELECT = (
    "select id, block_height, block_time, kind, inscription_id, bitmap_number, tx_index, from_address, to_address "
    "from land_events "
)


@router.get("/v1/land/{bitmap_number}/events")
def land_events(bitmap_number: int, before_id: int | None = None, limit: int = 20):
    """Claims and transfers of the district and its parcels, newest first."""
    limit = max(1, min(limit, 100))
    with cursor() as cur:
        cur.execute(
            EVENT_SELECT + "where bitmap_number = %s and (%s::int8 is null or id < %s) order by id desc limit %s;",
            (bitmap_number, before_id, before_id, limit),
        )
        return {"events": [_event(r) for r in cur.fetchall()]}
