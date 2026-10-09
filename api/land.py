"""Land API: districts, parcels and who holds them."""

import os

from fastapi import APIRouter, HTTPException

from api.db import cursor
from parcel_index.sources import Bitcoind

router = APIRouter()
MAX_RANGE = 1000


def _bitcoind():
    return Bitcoind(
        os.getenv("BITCOIN_RPC_URL") or "http://localhost:8332/",
        os.getenv("BITCOIN_RPC_USER"),
        os.getenv("BITCOIN_RPC_PASSWD"),
    )


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


@router.get("/v1/land")
def land_range(start: int, end: int):
    """Map tiles for blocks start..end (inclusive): claimed or not, owner, parcel and post counts."""
    if end < start or end - start + 1 > MAX_RANGE:
        raise HTTPException(400, f"range must cover 1 to {MAX_RANGE} blocks")
    with cursor() as cur:
        tip = _heights(cur)["bitmap"]
        if tip is None:
            return {"tip": None, "tiles": []}
        end = min(end, tip)
        cur.execute(
            "select b.bitmap_number, o.address, "
            "(select count(*) from parcels p where p.bitmap_number = b.bitmap_number), "
            "(select count(*) from social.posts s where s.bitmap_number = b.bitmap_number and s.removed_at is null) "
            "from bitmaps b left join inscription_owners o on o.inscription_id = b.inscription_id "
            "where b.bitmap_number between %s and %s;",
            (start, end),
        )
        claimed = {n: (owner, parcels, posts) for n, owner, parcels, posts in cur.fetchall()}
    tiles = []
    for n in range(max(start, 0), end + 1):
        owner, parcels, posts = claimed.get(n, (None, 0, 0))
        tiles.append({"bitmap_number": n, "claimed": n in claimed, "owner": owner, "parcels": parcels, "posts": posts})
    return {"tip": tip, "tiles": tiles}


@router.get("/v1/land/{bitmap_number}/txs")
def land_txs(bitmap_number: int):
    """Output value of every transaction in the block (sats), for the Mondrian layout.
    Transaction i is parcel i."""
    with cursor() as cur:
        tip = _heights(cur)["bitmap"]
        if bitmap_number < 0 or tip is None or bitmap_number > tip:
            raise HTTPException(404, "no such block yet")
        cur.execute("select block_hash, tx_values from block_tx_values where block_height = %s;", (bitmap_number,))
        row = cur.fetchone()
    btc = _bitcoind()
    block_hash = btc.block_hash(bitmap_number)
    if row is not None and row[0] == block_hash:
        return {"bitmap_number": bitmap_number, "tx_values": row[1]}
    values = btc.tx_values(block_hash)
    with cursor() as cur:
        cur.execute(
            "insert into block_tx_values (block_height, block_hash, tx_values) values (%s, %s, %s) "
            "on conflict (block_height) do update set block_hash = excluded.block_hash, tx_values = excluded.tx_values;",
            (bitmap_number, block_hash, values),
        )
    return {"bitmap_number": bitmap_number, "tx_values": values}


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
