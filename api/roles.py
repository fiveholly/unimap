"""Who someone is in a district, read live from the indexer tables."""

from fastapi import HTTPException

OWNER, RESIDENT, TENANT, VISITOR = "owner", "resident", "tenant", "visitor"


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


def parcel_holder(cur, bitmap_number, tx_index):
    """Address holding parcel tx_index of the district, or None."""
    cur.execute(
        "select o.address from parcels p join inscription_owners o on o.inscription_id = p.inscription_id "
        "where p.bitmap_number = %s and p.tx_index = %s;",
        (bitmap_number, tx_index),
    )
    return _first(cur.fetchone())


def parcel_holders(cur, bitmap_number):
    """{tx_index: address} for the district's claimed parcels."""
    cur.execute(
        "select p.tx_index, o.address from parcels p join inscription_owners o on o.inscription_id = p.inscription_id "
        "where p.bitmap_number = %s and o.address is not null;",
        (bitmap_number,),
    )
    return {r[0]: r[1] for r in ((tuple(x.values()) if isinstance(x, dict) else x) for x in cur.fetchall())}


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
    if address is not None and is_tenant(cur, address, bitmap_number):
        return TENANT, None
    return VISITOR, None


def is_tenant(cur, address, bitmap_number):
    """暂住居民 (api/tenants.py): let in by the owner who still holds the district."""
    cur.execute(
        "select 1 from social.tenants t join bitmaps b on b.bitmap_number = t.bitmap_number "
        "join inscription_owners o on o.inscription_id = b.inscription_id and o.address = t.owner "
        "where t.bitmap_number = %s and t.address = %s;",
        (bitmap_number, address),
    )
    return cur.fetchone() is not None


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
