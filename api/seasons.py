"""难度调整赛季: Bitcoin retargets its mining difficulty every 2016 blocks (about two weeks), and
the city's seasons follow it. A season ranks districts by what happened in them since its first
block: posts, replies, check-ins and the people who tipped there. When it ends, the top PODIUM
are frozen as its winners: their owners get a crown badge, and the districts wear a crown on the
map through the next season. A prize pool (GAME_SEASON_POOL_SATS) is shown when the project puts
one up; it is paid by the project over Lightning, not by unimap's code.
"""

import datetime as dt
import os

from fastapi import APIRouter
from psycopg2.extras import Json

from api import game, notify
from api.db import cursor
from parcel_index.zones import LANDMARKS

router = APIRouter()

SEASON = 2016
PODIUM = 3
STANDINGS = 10
WEIGHTS = {"posts": 4, "replies": 1.5, "checkins": 1, "tippers": 2}
CROWN_RARITY = ("legendary", "epic", "rare")  # 1st, 2nd, 3rd
POOL_SPLIT = (50, 30, 20)  # percent of the pool for 1st, 2nd, 3rd
BLOCK_SECONDS = 600


def bounds(n):
    return n * SEASON, (n + 1) * SEASON - 1


def pool_sats():
    try:
        return max(0, int(os.getenv("GAME_SEASON_POOL_SATS") or 0))
    except ValueError:
        return 0


def _block_time(height):
    """The block's timestamp from bitcoind, or None if it can't be asked."""
    from api import land  # land imports game; import here so seasons stays importable on its own

    try:
        btc = land._bitcoind()
        return dt.datetime.fromtimestamp(btc.block_time(btc.block_hash(height)), dt.timezone.utc)
    except Exception:
        return None


def start_time(cur, n, tip):
    """When season n began: its first block's time, kept once known; estimated at ten minutes a block until then."""
    cur.execute("select start_time from social.seasons where number = %s;", (n,))
    row = cur.fetchone()
    if row:
        return row[0]
    start = bounds(n)[0]
    if start > tip:
        return None
    exact = _block_time(start)
    if exact is not None:
        cur.execute("insert into social.seasons (number, start_time) values (%s, %s) on conflict do nothing;", (n, exact))
        return exact
    return dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=(tip - start) * BLOCK_SECONDS)


def scores(cur, since, until):
    """[(bitmap_number, score, parts)] of claimed districts with activity in [since, until), best first."""
    out = {}

    def add(rows, key):
        for n, v in rows:
            out.setdefault(n, dict.fromkeys(WEIGHTS, 0))[key] = v

    cur.execute(
        "select bitmap_number, count(*) filter (where reply_to is null), count(*) filter (where reply_to is not null) "
        "from social.posts where removed_at is null and created_at >= %s and created_at < %s group by 1;",
        (since, until),
    )
    rows = cur.fetchall()
    add([(n, a) for n, a, _ in rows], "posts")
    add([(n, b) for n, _, b in rows], "replies")
    cur.execute(
        "select bitmap_number, count(*) from social.checkins "
        "where day >= (%s at time zone 'utc')::date and day < (%s at time zone 'utc')::date group by 1;",
        (since, until),
    )
    add(cur.fetchall(), "checkins")
    cur.execute(
        "select bitmap_number, count(distinct tipper) from social.tips where status = 'settled' "
        "and settled_at >= %s and settled_at < %s group by 1;",
        (since, until),
    )
    add(cur.fetchall(), "tippers")
    cur.execute("select bitmap_number from bitmaps where bitmap_number = any(%s);", (list(out),))
    claimed = {r[0] for r in cur.fetchall()}
    ranked = [
        (n, round(sum(p[k] * w for k, w in WEIGHTS.items()), 1), p)
        for n, p in out.items()
        if n in claimed and n not in LANDMARKS
    ]
    ranked.sort(key=lambda r: (-r[1], r[0]))
    return [r for r in ranked if r[1] > 0]


def _owners(cur, numbers):
    cur.execute(
        "select b.bitmap_number, o.address from bitmaps b left join inscription_owners o on o.inscription_id = b.inscription_id "
        "where b.bitmap_number = any(%s);",
        (list(numbers),),
    )
    return dict(cur.fetchall())


def freeze(cur, tip):
    """Once a season is over, keep its winners and crown them. Only the season just ended is frozen;
    seasons before unimap began have nothing to rank."""
    n = tip // SEASON - 1
    if n < 0:
        return
    cur.execute("select winners from social.seasons where number = %s;", (n,))
    row = cur.fetchone()
    if row and row[0] is not None:
        return
    since, until = start_time(cur, n, tip), start_time(cur, n + 1, tip)
    if since is None or until is None:
        return
    top = scores(cur, since, until)[:PODIUM]
    owners = _owners(cur, [n_ for n_, _, _ in top])
    winners = [{"bitmap_number": b, "owner": owners.get(b), "score": s} for b, s, _ in top]
    cur.execute(
        "insert into social.seasons (number, start_time, winners, frozen_at) values (%s, %s, %s, now()) "
        "on conflict (number) do update set winners = excluded.winners, frozen_at = excluded.frozen_at "
        "where social.seasons.winners is null;",
        (n, since, Json(winners)),
    )
    if cur.rowcount == 0:
        return
    start = bounds(n)[0]
    for rank, w in enumerate(winners):
        if not w["owner"]:
            continue
        cur.execute(
            "insert into social.badges (address, kind, height, bitmap_number, rarity) values (%s, 'crown', %s, %s, %s) on conflict do nothing;",
            (w["owner"], start, w["bitmap_number"], CROWN_RARITY[rank]),
        )
        notify.notify(cur, w["owner"], "crown", "", w["bitmap_number"], block_height=start)


def crowns(cur, tip):
    """{bitmap_number: rank (1-3)} wearing the last season's crowns."""
    cur.execute("select winners from social.seasons where number = %s;", (tip // SEASON - 1,))
    row = cur.fetchone()
    return {w["bitmap_number"]: i + 1 for i, w in enumerate((row[0] if row else None) or [])}


@router.get("/v1/season")
def season():
    """This season's standings so far, the last season's crowned winners, and the prize pool."""
    with cursor() as cur:
        tip = game.ensure(cur)
        if tip is None:
            return {"number": None}
        freeze(cur, tip)
        n = tip // SEASON
        since_h, until_h = bounds(n)
        since = start_time(cur, n, tip)
        top = scores(cur, since, dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=1))[:STANDINGS]
        owners = _owners(cur, [b for b, _, _ in top])
        cur.execute("select winners from social.seasons where number = %s;", (n - 1,))
        row = cur.fetchone()
        last = (row[0] if row else None) or []
    pool = pool_sats()
    return {
        "number": n,
        "since": since_h,
        "until": until_h,
        "tip": tip,
        "started_at": since.isoformat(),
        "standings": [{"bitmap_number": b, "owner": owners.get(b), "score": s, "parts": p} for b, s, p in top],
        "last": {"number": n - 1, "winners": last} if n > 0 else None,
        "weights": WEIGHTS,
        "pool_sats": pool,
        "pool_split": [pool * x // 100 for x in POOL_SPLIT] if pool else [],
    }
