"""Who someone is in a district, read live from the indexer tables."""

from fastapi import HTTPException

OWNER, RESIDENT, VISITOR = "owner", "resident", "visitor"


def _first(row):
    """First column of a row from a plain or a dict cursor."""
    if row is None:
        return None
    return next(iter(row.values())) if isinstance(row, dict) else row[0]


def district_owner(cur, bitmap_number):
    """Address holding the district inscription, or None (unclaimed or not tracked yet)."""
    cur.execute(
        "select o.address from bitmaps b join inscription_owners o on o.inscription_id = b.inscription_id "
        "where b.bitmap_number = %s;",
        (bitmap_number,),
    )
    return _first(cur.fetchone())


def require_owner(cur, bitmap_number, address):
    if district_owner(cur, bitmap_number) != address:
        raise HTTPException(403, "only the district owner can do this")


def role_in(cur, address, bitmap_number):
    """(role, parcel tx_index or None) of address in the district."""
    if address is not None and district_owner(cur, bitmap_number) == address:
        return OWNER, None
    cur.execute(
        "select p.tx_index from parcels p join inscription_owners o on o.inscription_id = p.inscription_id "
        "where p.bitmap_number = %s and o.address = %s order by p.tx_index limit 1;",
        (bitmap_number, address),
    )
    tx_index = _first(cur.fetchone())
    if tx_index is not None:
        return RESIDENT, tx_index
    return VISITOR, None


def holdings(cur, address):
    cur.execute(
        "select b.bitmap_number from inscription_owners o join bitmaps b on b.inscription_id = o.inscription_id "
        "where o.address = %s order by b.bitmap_number;",
        (address,),
    )
    districts = [_first(r) for r in cur.fetchall()]
    cur.execute(
        "select p.bitmap_number, p.tx_index from inscription_owners o join parcels p on p.inscription_id = o.inscription_id "
        "where o.address = %s order by p.bitmap_number, p.tx_index;",
        (address,),
    )
    parcels = [dict(zip(("bitmap_number", "tx_index"), r.values() if isinstance(r, dict) else r)) for r in cur.fetchall()]
    return districts, parcels
