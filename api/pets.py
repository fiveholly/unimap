"""养宠物: the pets a wallet holds (api/holdings.py) live on 我的土地, and their owner can feed
them and give them names.

A collection's pet looks like one of the inscriptions the wallet holds (its "face", the first
one unless the owner picks another); a rune's pet, which has no picture of its own, is drawn.
A pet is there while the wallet group holds its asset (tier above 0); its care is kept under the
group's main address, so linking or unlinking a wallet doesn't reset it, and selling the asset
and buying it back finds the pet as it was. Feeding is free and only for fun: once every
FEED_HOURS, each feed adds affection, more on a streak of days in a row, and affection decides
the pet's level. A pet left alone gets hungry but never leaves. Mirrors web/lib/demo.ts.
"""

import math
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import holdings, wallets
from api.auth import current_address
from api.db import cursor

router = APIRouter()

FEED_HOURS = 6
AFFECTION = 10  # per feed, plus a day for each day of the streak, up to STREAK_BONUS
STREAK_BONUS = 7
LEVEL_STEP = 30  # affection for level L + 1 is LEVEL_STEP * L ** 2
MAX_LEVEL = 10
MOODS = ((FEED_HOURS, "full"), (24, "ok"), (72, "hungry"))  # hours since fed; later is "starving"


def level(affection):
    return min(MAX_LEVEL, 1 + math.isqrt(affection // LEVEL_STEP))


def mood(fed_at, now):
    if fed_at is None:
        return "hungry"
    hours = (now - fed_at).total_seconds() / 3600
    return next((m for h, m in MOODS if hours < h), "starving")


def _care(cur, main):
    cur.execute("select asset, name, affection, fed_at, streak, last_day, face from social.pet_care where address = %s;", (main,))
    return {r[0]: r[1:] for r in cur.fetchall()}


def _view(asset, amount, care, items, now):
    name, affection, fed_at, streak, last_day, face = care or (None, 0, None, 0, None, None)
    lvl = level(affection)
    # A streak only lasts while the next feed comes the next day at the latest.
    if last_day is not None and last_day < now.date() - timedelta(days=1):
        streak = 0
    return {
        **holdings._view(asset, amount),
        "name": name,
        "affection": affection,
        "level": lvl,
        "next_level_at": LEVEL_STEP * lvl**2 if lvl < MAX_LEVEL else None,
        "streak": streak,
        "fed_at": fed_at.isoformat() if fed_at else None,
        "can_feed_at": (fed_at + timedelta(hours=FEED_HOURS)).isoformat() if fed_at else None,
        "mood": mood(fed_at, now),
        "items": items,
        "face": face if face in items else (items[0] if items else None),
    }


def pets(cur, address, now=None):
    """The pets address's wallet group has, with their care: [{asset, tier, amount, name, ...}]."""
    now = now or datetime.now(timezone.utc)
    held = holdings._amounts(cur, [address]).get(address, {})
    care = _care(cur, wallets.main_of(cur, address))
    items = holdings.held_items(cur, address)
    return [_view(a, held[a], care.get(a), items.get(a, []), now) for a in holdings.ASSETS if holdings.tier(a, held.get(a, 0)) > 0]


def _refresh_unchecked(address):
    """Ask the provider about any of the group's wallets it was never asked about."""
    with cursor() as cur:
        addresses = wallets.group(cur, address)
        cur.execute("select address from social.holdings_checked where address = any(%s);", (addresses,))
        checked = {r[0] for r in cur.fetchall()}
    for a in addresses:
        if a not in checked:
            holdings.refresh(a)


def _pet(cur, address, asset):
    if asset not in holdings.ASSETS:
        raise HTTPException(404, "no such pet")
    pet = next((p for p in pets(cur, address) if p["asset"] == asset), None)
    if pet is None:
        raise HTTPException(404, "your wallets don't hold this pet")
    return pet


@router.get("/v1/me/pets")
def my_pets(address: str = Depends(current_address)):
    _refresh_unchecked(address)
    with cursor() as cur:
        return {"pets": pets(cur, address), "feed_hours": FEED_HOURS}


@router.post("/v1/me/pets/{asset}/feed")
def feed(asset: str, address: str = Depends(current_address)):
    now = datetime.now(timezone.utc)
    with cursor() as cur:
        _pet(cur, address, asset)
        main = wallets.main_of(cur, address)
        cur.execute(
            "select affection, fed_at, streak, last_day from social.pet_care where address = %s and asset = %s for update;",
            (main, asset),
        )
        row = cur.fetchone()
        affection, fed_at, streak, last_day = row or (0, None, 0, None)
        if fed_at is not None and now < fed_at + timedelta(hours=FEED_HOURS):
            raise HTTPException(409, "it's still full; feed it again later")
        today = now.date()
        streak = streak if last_day == today else streak + 1 if last_day == today - timedelta(days=1) else 1
        affection += AFFECTION + min(streak - 1, STREAK_BONUS)
        cur.execute(
            "insert into social.pet_care (address, asset, affection, fed_at, streak, last_day) values (%s, %s, %s, %s, %s, %s) "
            "on conflict (address, asset) do update set affection = excluded.affection, fed_at = excluded.fed_at, "
            "streak = excluded.streak, last_day = excluded.last_day;",
            (main, asset, affection, now, streak, today),
        )
        return _pet(cur, address, asset)


class PetBody(BaseModel):
    name: str | None = Field(default=None, max_length=20)  # empty or null: no name
    face: str | None = None  # one of the pet's items


@router.put("/v1/me/pets/{asset}")
def update(asset: str, req: PetBody, address: str = Depends(current_address)):
    """Name the pet, or pick which of its inscriptions it looks like; fields left out stay."""
    with cursor() as cur:
        pet = _pet(cur, address, asset)
        main = wallets.main_of(cur, address)
        cur.execute("insert into social.pet_care (address, asset) values (%s, %s) on conflict do nothing;", (main, asset))
        if "name" in req.model_fields_set:
            name = (req.name or "").strip() or None
            cur.execute("update social.pet_care set name = %s where address = %s and asset = %s;", (name, main, asset))
        if "face" in req.model_fields_set:
            if req.face not in pet["items"]:
                raise HTTPException(400, "pick one of the inscriptions this pet has")
            cur.execute("update social.pet_care set face = %s where address = %s and asset = %s;", (req.face, main, asset))
        return _pet(cur, address, asset)
