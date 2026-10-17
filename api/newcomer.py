"""新手任务: three first things for someone new, and the 新居民 badge for doing them.

1. birthday: find the block of your birthday (or any day) on the home page. Nothing on the server
   shows it happened, so the browser reports it (POST /v1/me/newcomer/birthday); a visitor who
   used it before signing in reports it on sign-in, from what the browser kept.
2. checkin: check in at any district. Verified: a row in social.checkins.
3. capsule: seal a time capsule. Verified: a sealed (not pending) row in social.capsules.

Steps 2 and 3 count for any wallet in the address's group (api/wallets.py), as the free capsule
does. All three done earns the badge (kind 'newcomer', height 0, so one per address; its
bitmap_number is the district of the first check-in). check() is idempotent and runs on every
read, after each check-in and when a capsule is sealed, so the badge comes whichever step is last.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api import wallets
from api.auth import current_address
from api.db import cursor

router = APIRouter()

STEPS = ("birthday", "checkin", "capsule")
KIND = "newcomer"
RARITY = "common"


def steps(cur, address):
    """{step: done} for address, from what is stored."""
    group = wallets.group(cur, address)
    cur.execute(
        "select "
        "exists(select 1 from social.newcomers where address = any(%(g)s) and birthday_at is not null), "
        "exists(select 1 from social.checkins where address = any(%(g)s)), "
        "exists(select 1 from social.capsules where author = any(%(g)s) and status = 'sealed');",
        {"g": group},
    )
    return dict(zip(STEPS, cur.fetchone()))


def _badge(row):
    return {"kind": KIND, "height": 0, "bitmap_number": row[1], "tx_index": None, "rarity": RARITY, "created_at": row[2].isoformat()}


def check(cur, address):
    """(steps, badge or None, new): the badge is awarded here, once, when all steps are done."""
    done = steps(cur, address)
    cur.execute("select id, bitmap_number, created_at from social.badges where kind = %s and height = 0 and address = %s;", (KIND, address))
    row = cur.fetchone()
    new = False
    if row is None and all(done.values()):
        cur.execute(
            "select bitmap_number from social.checkins where address = any(%s) order by day, bitmap_number limit 1;",
            (wallets.group(cur, address),),
        )
        first = cur.fetchone()[0]
        cur.execute(
            "insert into social.badges (address, kind, height, bitmap_number, rarity) values (%s, %s, 0, %s, %s) "
            "on conflict do nothing returning id, bitmap_number, created_at;",
            (address, KIND, first, RARITY),
        )
        row = cur.fetchone()
        new = row is not None
    return done, (_badge(row) if row else None), new


def on_activity(cur, address):
    """After a check-in or a sealed capsule: [the badge] when that finished the task, else []."""
    _, badge, new = check(cur, address)
    return [badge] if new else []


def view(cur, address):
    done, badge, new = check(cur, address)
    return {"steps": done, "done": sum(done.values()), "of": len(STEPS), "badge": badge, "new": new}


@router.get("/v1/me/newcomer")
def progress(address: str = Depends(current_address)):
    """The signed-in address's 新手任务: each step, and the badge once all are done."""
    with cursor() as cur:
        return view(cur, address)


class Birthday(BaseModel):
    block: int | None = None  # the block the lookup found, kept for interest only


@router.post("/v1/me/newcomer/birthday")
def birthday(req: Birthday, address: str = Depends(current_address)):
    """Step 1, reported by the browser: the birthday lookup was used."""
    if req.block is not None and req.block < 0:
        raise HTTPException(400, "block is a block height")
    with cursor() as cur:
        cur.execute(
            "insert into social.newcomers (address, birthday_at, birthday_block) values (%s, now(), %s) "
            "on conflict (address) do update set birthday_at = coalesce(social.newcomers.birthday_at, excluded.birthday_at), "
            "birthday_block = coalesce(social.newcomers.birthday_block, excluded.birthday_block);",
            (address, req.block),
        )
        return view(cur, address)
