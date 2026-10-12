"""每日巡城: every day (UTC) the city names STOPS districts to visit, so people who hold no land
have something to do each day and lively districts get visitors. Checking in at a stop
(POST /v1/districts/{n}/checkin) counts as visiting it; visiting all of them earns that day's
tour badge, rarer the longer the run of days in a row (STREAKS).

The stops are picked the first time anyone asks on a day and kept for the day: ACTIVE of them
out of the districts with a top-level post in the last week, the rest out of every inscribed
district, each by SHA-256 of "<day>:tour:<i>" as a number modulo the candidates (in district
number order), skipping repeats. When fewer districts are active, the rest come from everywhere.
"""

import hashlib
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends

from api import wallets
from api.auth import optional_address
from api.db import cursor

router = APIRouter()

STOPS = 3
ACTIVE = 2  # of the stops, picked from districts posted in this last week
ACTIVE_DAYS = 7
# Days in a row with the tour done -> the day's badge: from 3 days rare, 7 epic, 30 legendary.
STREAKS = ((30, "legendary"), (7, "epic"), (3, "rare"), (1, "common"))
EPOCH = date(1970, 1, 1)
RULES = {"stops": STOPS, "active": ACTIVE, "active_days": ACTIVE_DAYS, "streaks": [list(s) for s in STREAKS]}


def today():
    return datetime.now(timezone.utc).date()


def day_number(day):
    """The badge's height: days since 1970-01-01, as a tour badge has no block of its own."""
    return (day - EPOCH).days


def _pick(cur, day, salt_from, pool_sql, args, want, taken):
    cur.execute(f"select count(*) from ({pool_sql}) p;", args)
    count = cur.fetchone()[0]
    picked = []
    i = salt_from
    # Repeats are skipped, so a small pool runs out instead of looping for ever.
    for _ in range(want * 8):
        if len(picked) == want or count - len(taken) - len(picked) <= 0:
            break
        k = int(hashlib.sha256(f"{day.isoformat()}:tour:{i}".encode()).hexdigest(), 16) % count
        i += 1
        cur.execute(f"select bitmap_number from ({pool_sql}) p order by bitmap_number offset %s limit 1;", (*args, k))
        n = cur.fetchone()[0]
        if n not in taken and n not in picked:
            picked.append(n)
    return picked, i


def stops(cur, day=None):
    """Today's stops, picked and stored the first time they are asked for."""
    day = day or today()
    cur.execute("select stops from social.tour_days where day = %s;", (day,))
    row = cur.fetchone()
    if row:
        return list(row[0])
    active = (
        "select distinct p.bitmap_number from social.posts p join bitmaps b on b.bitmap_number = p.bitmap_number "
        "where p.reply_to is null and p.removed_at is null and p.created_at > now() - make_interval(days => %s)"
    )
    picked, i = _pick(cur, day, 0, active, (ACTIVE_DAYS,), ACTIVE, [])
    rest, _ = _pick(cur, day, i, "select bitmap_number from bitmaps", (), STOPS - len(picked), picked)
    picked += rest
    cur.execute("insert into social.tour_days (day, stops) values (%s, %s) on conflict do nothing;", (day, picked))
    if cur.rowcount == 0:  # another request stored the day first
        cur.execute("select stops from social.tour_days where day = %s;", (day,))
        return list(cur.fetchone()[0])
    return picked


def _visited(cur, addresses, day, at):
    cur.execute(
        "select distinct bitmap_number from social.checkins where day = %s and address = any(%s) and bitmap_number = any(%s);",
        (day, addresses, at),
    )
    return {r[0] for r in cur.fetchall()}


def streak(cur, address, day):
    """Days in a row up to day (or up to yesterday, when day isn't done yet) with the tour done."""
    cur.execute("select height from social.badges where kind = 'tour' and address = %s order by height desc limit 400;", (address,))
    done = [r[0] for r in cur.fetchall()]
    d = day_number(day)
    if d not in done:
        d -= 1
    run = 0
    for h in done:
        if h > d:
            continue
        if h != d - run:
            break
        run += 1
    return run


def rarity(run):
    return next(r for days, r in STREAKS if run >= days)


def view(cur, viewer, day=None):
    day = day or today()
    at = stops(cur, day)
    seen = _visited(cur, wallets.group(cur, viewer), day, at) if viewer else set()
    out = {
        "day": day.isoformat(),
        "stops": [{"bitmap_number": n, "visited": n in seen} for n in at],
        "rules": RULES,
    }
    if viewer:
        out["done"] = bool(at) and seen >= set(at)
        out["streak"] = streak(cur, viewer, day)
    return out


def on_checkin(cur, address, n):
    """After a check-in at n: the tour badge when that was the day's last stop. Returns badges won."""
    day = today()
    at = stops(cur, day)
    if n not in at or _visited(cur, wallets.group(cur, address), day, at) != set(at):
        return []
    run = streak(cur, address, day) + 1
    cur.execute(
        "insert into social.badges (address, kind, height, bitmap_number, rarity) values (%s, 'tour', %s, %s, %s) "
        "on conflict do nothing returning kind, height, bitmap_number, rarity;",
        (address, day_number(day), n, rarity(run)),
    )
    return [{**dict(zip(("kind", "height", "bitmap_number", "rarity"), r)), "streak": run} for r in cur.fetchall()]


@router.get("/v1/tour")
def tour(viewer: str | None = Depends(optional_address)):
    with cursor() as cur:
        return view(cur, viewer)
