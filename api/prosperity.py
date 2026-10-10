"""Prosperity: how lively a district is, which decides how built-up it looks on the map.

Mirrors web/lib/prosperity.ts; keep the weights and thresholds in step. Residents and
followers count as they stand, everything else only over the last WINDOW_DAYS, so a
district that goes quiet falls back. Landmarks are always at the top level.
"""

import math
import time

from api import game
from parcel_index.zones import LANDMARKS

WEIGHTS = {
    "residents": 3,
    "posts30": 4,
    "replies30": 1.5,
    "followers": 0.5,
    "checkins30": 1,
    "neighbors30": 0.3,
    "tippers30": 2,
    "lucky": 30,  # 1 while it is the lucky district (api/game.py)
}
THRESHOLDS = (0, 25, 80, 200, 450)
TOP = len(THRESHOLDS)
WINDOW_DAYS = 30
NEIGHBOR_RADIUS = 5  # districts on each side whose posts count as neighbours'
RANKING_SIZE = 50
RANKING_TTL = 300  # seconds the ranking is cached


def empty_parts():
    return dict.fromkeys(WEIGHTS, 0)


def score_of(parts):
    return math.floor(sum(parts[k] * w for k, w in WEIGHTS.items()) + 0.5)


def level_of(score):
    level = 1
    while level < TOP and score >= THRESHOLDS[level]:
        level += 1
    return level


def prosperity(bitmap_number, parts):
    score = score_of(parts)
    level = TOP if bitmap_number in LANDMARKS else level_of(score)
    return {"score": score, "level": level, "parts": parts, "next": THRESHOLDS[level] if level < TOP else None}


def parts_for(cur, lo, hi):
    """{bitmap_number: parts} for the districts lo..hi with any activity; the rest are all zeros."""
    out = {}

    def add(rows, *keys):
        for n, *values in rows:
            if lo <= n <= hi:
                p = out.setdefault(n, empty_parts())
                for k, v in zip(keys, values):
                    p[k] = v

    cur.execute(
        "select bitmap_number, count(*) from parcels where bitmap_number between %s and %s group by 1;", (lo, hi)
    )
    add(cur.fetchall(), "residents")
    cur.execute(
        "select bitmap_number, count(*) from social.follows where bitmap_number between %s and %s group by 1;",
        (lo, hi),
    )
    add(cur.fetchall(), "followers")
    cur.execute(
        "select bitmap_number, count(*) from social.checkins "
        "where bitmap_number between %s and %s and day > (now() at time zone 'utc')::date - %s group by 1;",
        (lo, hi, WINDOW_DAYS),
    )
    add(cur.fetchall(), "checkins30")
    # People who tipped sats here (confirmed), each counted once, so a district can't buy its level
    # with many small tips from one wallet.
    cur.execute(
        "select bitmap_number, count(distinct tipper) from social.tips where status = 'settled' "
        "and settled_at > now() - make_interval(days => %s) and bitmap_number between %s and %s group by 1;",
        (WINDOW_DAYS, lo, hi),
    )
    add(cur.fetchall(), "tippers30")
    lucky, _ = game.lucky_now(cur)
    if lucky is not None:
        add([(lucky, 1)], "lucky")
    cur.execute(
        "select bitmap_number, count(*) filter (where reply_to is null), count(*) filter (where reply_to is not null) "
        "from social.posts where removed_at is null and created_at > now() - make_interval(days => %s) "
        "and bitmap_number between %s and %s group by 1;",
        (WINDOW_DAYS, lo - NEIGHBOR_RADIUS, hi + NEIGHBOR_RADIUS),
    )
    rows = cur.fetchall()
    posts = {n: top + replies for n, top, replies in rows}
    add(rows, "posts30", "replies30")
    for n in sorted(posts):
        for m in range(max(lo, n - NEIGHBOR_RADIUS), min(hi, n + NEIGHBOR_RADIUS) + 1):
            if m != n:
                out.setdefault(m, empty_parts())["neighbors30"] += posts[n]
    return out


def levels(cur, lo, hi):
    """{bitmap_number: level} for lo..hi, every block included."""
    parts = parts_for(cur, lo, hi)
    return {n: prosperity(n, parts.get(n) or empty_parts())["level"] for n in range(lo, hi + 1)}


def of(cur, bitmap_number):
    parts = parts_for(cur, bitmap_number, bitmap_number)
    return prosperity(bitmap_number, parts.get(bitmap_number) or empty_parts())


_ranking = (0.0, None)


def ranking(cur):
    """The liveliest claimed districts, landmarks aside. Cached for RANKING_TTL seconds."""
    global _ranking
    at, rows = _ranking
    if rows is not None and time.monotonic() - at < RANKING_TTL:
        return rows
    cur.execute("select max(bitmap_number) from bitmaps;")
    hi = cur.fetchone()[0]
    if hi is None:
        return []
    scored = [(n, prosperity(n, p)) for n, p in parts_for(cur, 0, hi).items() if n not in LANDMARKS]
    scored.sort(key=lambda x: (-x[1]["score"], x[0]))
    numbers = [n for n, _ in scored[: RANKING_SIZE * 2]]
    cur.execute(
        "select b.bitmap_number, o.address from bitmaps b "
        "left join inscription_owners o on o.inscription_id = b.inscription_id where b.bitmap_number = any(%s);",
        (numbers,),
    )
    owners = dict(cur.fetchall())
    cur.execute("select block_height, zone from block_zones where block_height = any(%s);", (numbers,))
    zones = dict(cur.fetchall())
    rows = [
        {
            "bitmap_number": n,
            "name": f"{n}.bitmap",
            "zone": zones.get(n),
            "owner": owners.get(n),
            "score": p["score"],
            "level": p["level"],
        }
        for n, p in scored[: RANKING_SIZE * 2]
        if n in owners
    ][:RANKING_SIZE]
    _ranking = (time.monotonic(), rows)
    return rows
