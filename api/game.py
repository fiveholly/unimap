"""区块节拍: every new Bitcoin block makes something happen in the city, decided by the block's
hash, by rules anyone can check with a block explorer and a SHA-256 tool.

- Every block H draws a treasure: one parcel out of all parcels inscribed before H. Its owner
  has CLAIM_BLOCKS blocks to open it for a badge. The badge's rarity comes from the trailing
  zeros of H's hash.
- Every ROUND-th block R draws the lucky district out of all districts inscribed before R. It is
  lucky until R + ROUND - 1: it glows on the map, gets a prosperity bonus, its owner gets a
  badge, and anyone who checks in there during the round gets a visitor badge. That is the free
  way in for people who hold no land.

A draw is SHA-256 of the text "<block hash>:treasure" (or ":lucky"), read as a number, modulo
the number of candidates; candidates are in district number order (parcels: district, then
transaction index). Draws are stored the first time anyone asks, and redone if a reorg
replaces the block.
"""

import hashlib

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from api import notify, wallets
from api.auth import current_address, optional_address
from api.db import cursor

router = APIRouter()

ROUND = 144  # blocks a lucky district lasts, about a day
CLAIM_BLOCKS = 144  # blocks a treasure stays open
RECENT = 20  # draws shown on the game page
# Trailing zero hex digits of the block hash -> rarity: 1 in 16 blocks is rare, 1 in 256 epic, 1 in 4096 legendary.
RARITIES = ("common", "rare", "epic", "legendary")
LOCK = 0x756E696D  # advisory lock id: one API process draws at a time
RULES = {"round": ROUND, "claim_blocks": CLAIM_BLOCKS, "rarities": RARITIES}


def pick(block_hash, salt, count):
    """The index this block draws out of count candidates, or None when there are none."""
    if count <= 0:
        return None
    return int(hashlib.sha256(f"{block_hash}:{salt}".encode()).hexdigest(), 16) % count


def rarity(block_hash):
    zeros = len(block_hash) - len(block_hash.rstrip("0"))
    return RARITIES[min(zeros, len(RARITIES) - 1)]


def top(cur):
    """The newest block both the parcel and the district indexes have caught up to, or None."""
    cur.execute("select (select max(block_height) from parcel_block_hashes), (select max(block_height) from bitmap_block_hashes);")
    parcel, bitmap = cur.fetchone()
    if parcel is None or bitmap is None:
        return None
    return min(parcel, bitmap + 1)


def _draw(cur, height, block_hash):
    cur.execute("select count(*) from parcels where block_height < %s;", (height,))
    parcels = cur.fetchone()[0]
    k = pick(block_hash, "treasure", parcels)
    treasure = (None, None)
    if k is not None:
        cur.execute(
            "select bitmap_number, tx_index from parcels where block_height < %s order by bitmap_number, tx_index offset %s limit 1;",
            (height, k),
        )
        treasure = cur.fetchone()
    lucky, districts = None, None
    if height % ROUND == 0:
        cur.execute("select count(*) from bitmaps where block_height < %s;", (height,))
        districts = cur.fetchone()[0]
        k = pick(block_hash, "lucky", districts)
        if k is not None:
            cur.execute(
                "select bitmap_number from bitmaps where block_height < %s order by bitmap_number offset %s limit 1;", (height, k)
            )
            lucky = cur.fetchone()[0]
    cur.execute(
        "insert into social.block_draws (height, block_hash, treasure_bitmap, treasure_tx, treasure_of, rarity, lucky_bitmap, lucky_of) "
        "values (%s, %s, %s, %s, %s, %s, %s, %s) on conflict do nothing;",
        (height, block_hash, *treasure, parcels, rarity(block_hash), lucky, districts),
    )
    if cur.rowcount == 0:
        return
    if treasure[0] is not None:
        cur.execute(
            "select o.address from parcels p join inscription_owners o on o.inscription_id = p.inscription_id "
            "where p.bitmap_number = %s and p.tx_index = %s;",
            treasure,
        )
        row = cur.fetchone()
        if row:
            notify.notify(cur, row[0], "treasure", "", treasure[0], block_height=height)
    if lucky is not None:
        cur.execute(
            "select o.address from bitmaps b join inscription_owners o on o.inscription_id = b.inscription_id where b.bitmap_number = %s;",
            (lucky,),
        )
        row = cur.fetchone()
        if row and row[0]:
            cur.execute(
                "insert into social.badges (address, kind, height, bitmap_number, rarity) values (%s, 'lucky', %s, %s, 'rare') "
                "on conflict do nothing;",
                (row[0], height, lucky),
            )
            notify.notify(cur, row[0], "lucky", "", lucky, block_height=height)


def ensure(cur):
    """Draw every block in the open window that isn't drawn yet, or whose hash a reorg changed."""
    tip = top(cur)
    if tip is None:
        return None
    cur.execute("select pg_try_advisory_xact_lock(%s);", (LOCK,))
    if not cur.fetchone()[0]:
        return tip  # another request is drawing; what's stored will do
    lo = max(0, tip - max(CLAIM_BLOCKS, ROUND) + 1)
    cur.execute(
        "select h.block_height, h.block_hash, d.block_hash from parcel_block_hashes h "
        "left join social.block_draws d on d.height = h.block_height where h.block_height between %s and %s;",
        (lo, tip),
    )
    for height, block_hash, drawn in sorted(cur.fetchall()):
        if drawn == block_hash:
            continue
        if drawn is not None:
            cur.execute("delete from social.block_draws where height = %s;", (height,))
        _draw(cur, height, block_hash)
    return tip


def ensure_soon(cur, tasks: BackgroundTasks):
    """For pages that only read draws: if the newest block isn't drawn yet, draw it after responding."""
    tip = top(cur)
    if tip is None:
        return
    cur.execute(
        "select exists(select 1 from social.block_draws where height = %s), "
        "exists(select 1 from social.seasons where number = %s and winners is not null);",
        (tip, tip // 2016 - 1),  # the season just ended (api/seasons.py)
    )
    drawn, frozen = cur.fetchone()
    if not drawn or (not frozen and tip >= 2016):
        tasks.add_task(_ensure_now)


def _ensure_now():
    from api import seasons  # seasons imports game

    with cursor() as cur:
        tip = ensure(cur)
        if tip is not None:
            seasons.freeze(cur, tip)


def lucky_now(cur):
    """(district, round start) lucky right now, or (None, None)."""
    tip = top(cur)
    if tip is None:
        return None, None
    cur.execute(
        "select lucky_bitmap, height from social.block_draws where lucky_bitmap is not null and height <= %s and height > %s "
        "order by height desc limit 1;",
        (tip, tip - ROUND),
    )
    row = cur.fetchone()
    return (row[0], row[1]) if row else (None, None)


def _open_treasures(cur, tip, where="true", args=()):
    cur.execute(
        "select d.height, d.block_hash, d.treasure_bitmap, d.treasure_tx, d.rarity from social.block_draws d "
        "where d.treasure_bitmap is not null and d.height <= %s and d.height > %s "
        "and not exists (select 1 from social.badges b where b.kind = 'treasure' and b.height = d.height) "
        f"and {where} order by d.height desc;",
        (tip, tip - CLAIM_BLOCKS, *args),
    )
    return cur.fetchall()


def in_range(cur, lo, hi):
    """{bitmap_number: {"lucky": bool, "treasure": rarity or None}} for districts lo..hi with something on."""
    tip = top(cur)
    out = {}
    if tip is None:
        return out
    lucky, _ = lucky_now(cur)
    if lucky is not None and lo <= lucky <= hi:
        out[lucky] = {"lucky": True, "treasure": None}
    for _, _, n, _, rare in _open_treasures(cur, tip, "d.treasure_bitmap between %s and %s", (lo, hi)):
        cell = out.setdefault(n, {"lucky": False, "treasure": None})
        if cell["treasure"] is None or RARITIES.index(rare) > RARITIES.index(cell["treasure"]):
            cell["treasure"] = rare
    return out


def _group(cur, address):
    return set(wallets.group(cur, address)) if address else set()


def district_view(cur, n, viewer):
    """The lucky round and open treasures in district n, for its page."""
    tip = top(cur)
    if tip is None:
        return {"lucky": None, "treasures": []}
    lucky, start = lucky_now(cur)
    mine = _group(cur, viewer)
    treasures = []
    for height, block_hash, _, tx, rare in _open_treasures(cur, tip, "d.treasure_bitmap = %s", (n,)):
        cur.execute(
            "select o.address from parcels p join inscription_owners o on o.inscription_id = p.inscription_id "
            "where p.bitmap_number = %s and p.tx_index = %s;",
            (n, tx),
        )
        row = cur.fetchone()
        treasures.append(
            {
                "height": height,
                "block_hash": block_hash,
                "tx_index": tx,
                "rarity": rare,
                "closes_at": height + CLAIM_BLOCKS - 1,
                "claimable": bool(row and row[0] in mine),
            }
        )
    visited = False
    if lucky == n and viewer:
        cur.execute(
            "select 1 from social.badges where kind = 'lucky_visit' and height = %s and address = %s;", (start, viewer)
        )
        visited = cur.fetchone() is not None
    return {
        "lucky": {"since": start, "until": start + ROUND - 1, "visited": visited} if lucky == n else None,
        "treasures": treasures,
    }


def on_checkin(cur, address, n):
    """Checking in at the lucky district during its round earns the visitor badge. Returns badges won."""
    lucky, start = lucky_now(cur)
    if lucky != n:
        return []
    cur.execute(
        "insert into social.badges (address, kind, height, bitmap_number, rarity) values (%s, 'lucky_visit', %s, %s, 'common') "
        "on conflict do nothing returning kind, height, bitmap_number, rarity;",
        (address, start, n),
    )
    return [dict(zip(("kind", "height", "bitmap_number", "rarity"), r)) for r in cur.fetchall()]


def badges_of(cur, address):
    cur.execute(
        "select kind, height, bitmap_number, tx_index, rarity, created_at from social.badges where address = %s order by id desc limit 200;",
        (address,),
    )
    return [
        {"kind": k, "height": h, "bitmap_number": n, "tx_index": tx, "rarity": r, "created_at": at.isoformat()}
        for k, h, n, tx, r, at in cur.fetchall()
    ]


@router.get("/v1/game")
def game(viewer: str | None = Depends(optional_address)):
    """The lucky district now, the latest blocks' treasures, and the rules, for the game page."""
    from api import seasons  # seasons imports game

    with cursor() as cur:
        tip = ensure(cur)
        if tip is None:
            return {"tip": None, "round": None, "draws": [], "rules": RULES}
        seasons.freeze(cur, tip)
        lucky, start = lucky_now(cur)
        round_ = None
        if start is not None:
            cur.execute(
                "select d.block_hash, d.lucky_of, o.address from social.block_draws d "
                "join bitmaps b on b.bitmap_number = d.lucky_bitmap "
                "left join inscription_owners o on o.inscription_id = b.inscription_id where d.height = %s;",
                (start,),
            )
            block_hash, of, owner = cur.fetchone()
            round_ = {
                "since": start,
                "until": start + ROUND - 1,
                "block_hash": block_hash,
                "candidates": of,
                "index": pick(block_hash, "lucky", of),
                "bitmap_number": lucky,
                "owner": owner,
            }
        cur.execute(
            "select d.height, d.block_hash, d.treasure_bitmap, d.treasure_tx, d.treasure_of, d.rarity, b.address "
            "from social.block_draws d left join social.badges b on b.kind = 'treasure' and b.height = d.height "
            "where d.height <= %s order by d.height desc limit %s;",
            (tip, RECENT),
        )
        draws = [
            {
                "height": h,
                "block_hash": bh,
                "bitmap_number": n,
                "tx_index": tx,
                "candidates": of,
                "index": pick(bh, "treasure", of),
                "rarity": r,
                "opened_by": by,
                "open": by is None and n is not None and h > tip - CLAIM_BLOCKS,
            }
            for h, bh, n, tx, of, r, by in cur.fetchall()
        ]
        badges = badges_of(cur, viewer) if viewer else None
    return {"tip": tip, "round": round_, "draws": draws, "badges": badges, "rules": RULES}



@router.post("/v1/game/treasures/{height}/open")
def open_treasure(height: int, address: str = Depends(current_address)):
    """The parcel's owner (any wallet in their group) opens the treasure while it is open."""
    with cursor() as cur:
        tip = ensure(cur)
        cur.execute(
            "select d.treasure_bitmap, d.treasure_tx, d.rarity, o.address from social.block_draws d "
            "join parcels p on p.bitmap_number = d.treasure_bitmap and p.tx_index = d.treasure_tx "
            "left join inscription_owners o on o.inscription_id = p.inscription_id where d.height = %s;",
            (height,),
        )
        row = cur.fetchone()
        if row is None or tip is None:
            raise HTTPException(404, "no treasure at this block")
        n, tx, rare, owner = row
        if height <= tip - CLAIM_BLOCKS:
            raise HTTPException(410, "this treasure has closed")
        group = _group(cur, address)
        if owner not in group:
            raise HTTPException(403, "only the parcel's owner can open it")
        cur.execute(
            "insert into social.badges (address, kind, height, bitmap_number, tx_index, rarity) values (%s, 'treasure', %s, %s, %s, %s) "
            "on conflict do nothing;",
            (owner, height, n, tx, rare),
        )
        if cur.rowcount == 0:
            raise HTTPException(409, "already opened")
    return {"kind": "treasure", "height": height, "bitmap_number": n, "tx_index": tx, "rarity": rare}
