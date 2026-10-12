"""养宠物: the pets a wallet holds (api/holdings.py) live on 我的土地, and their owner can feed
them and give them names.

A pet looks like its asset's official logo (web/lib/pets.ts PET_LOGOS), or, for a collection,
like one of the inscriptions the wallet holds if the owner picks one (its "face").
A pet is there while the wallet group holds its asset (tier above 0); its care is kept under the
group's main address, so linking or unlinking a wallet doesn't reset it, and selling the asset
and buying it back finds the pet as it was. Feeding is free and only for fun: once every
FEED_HOURS, each feed adds affection, more on a streak of days in a row, and affection decides
the pet's level. A pet left alone gets hungry but never leaves. Pets stay private unless their
owner shows them on their public page (public_pets). Anyone else can pat a pet they can see, on
its owner's page or a district it is shown on, once a day (PAT_AFFECTION each, up to PAT_CAP a
pet a day from everyone), and its owner hears about it. Mirrors web/lib/demo.ts.
"""

import math
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import holdings, notify, wallets
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
    cur.execute("select asset, name, affection, fed_at, streak, last_day, face, public from social.pet_care where address = %s;", (main,))
    return {r[0]: r[1:] for r in cur.fetchall()}


def _view(asset, amount, care, items, now):
    name, affection, fed_at, streak, last_day, face, public = care or (None, 0, None, 0, None, None, False)
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
        "face": face if face in items else None,
        "public": public,
    }


def pets(cur, address, now=None):
    """The pets address's wallet group has, with their care: [{asset, tier, amount, name, ...}]."""
    now = now or datetime.now(timezone.utc)
    held = holdings._amounts(cur, [address]).get(address, {})
    care = _care(cur, wallets.main_of(cur, address))
    items = holdings.held_items(cur, address)
    return [_view(a, held[a], care.get(a), items.get(a, []), now) for a in holdings.ASSETS if holdings.tier(a, held.get(a, 0)) > 0]


PUBLIC_FIELDS = ("asset", "tier", "amount", "name", "level", "mood", "face")
PAT_AFFECTION = 2
PAT_CAP = 10  # affection a pet gets from pats in a day, from everyone together


def pats(cur, address, viewer, day=None):
    """{asset: {"pats": n, "patted": bool}}: today's pats on address's pets, and whether viewer gave one."""
    day = day or datetime.now(timezone.utc).date()
    me = wallets.main_of(cur, viewer) if viewer else None
    cur.execute(
        "select asset, count(*), bool_or(patter = %s) from social.pet_pats where day = %s and owner = %s group by 1;",
        (me, day, wallets.main_of(cur, address)),
    )
    return {a: {"pats": n, "patted": bool(mine)} for a, n, mine in cur.fetchall()}


def public_pets(cur, address, viewer=None):
    """The pets address's owner chose to show on their page, without the care details."""
    today = pats(cur, address, viewer)
    return [
        {**{k: p[k] for k in PUBLIC_FIELDS}, **today.get(p["asset"], {"pats": 0, "patted": False})}
        for p in pets(cur, address)
        if p["public"]
    ]


def _shown_on_district(cur, address, asset):
    """Whether address shows asset on a district it holds (api/holdings.py)."""
    cur.execute(
        "select 1 from social.showcase s join bitmaps b on b.bitmap_number = s.bitmap_number "
        "join inscription_owners o on o.inscription_id = b.inscription_id "
        "where s.updated_by = %s and o.address = %s and %s = any(s.assets) limit 1;",
        (address, address, asset),
    )
    return cur.fetchone() is not None


def care_points(cur, lo, hi):
    """{n: points} for districts lo..hi whose owner shows pets there (api/holdings.py): each shown
    pet the owner still holds adds its level less one, so a pet fed for weeks helps its district
    a little (at most MAX_LEVEL - 1 a pet)."""
    cur.execute(
        "select s.bitmap_number, o.address from social.showcase s join bitmaps b on b.bitmap_number = s.bitmap_number "
        "join inscription_owners o on o.inscription_id = b.inscription_id where s.bitmap_number between %s and %s;",
        (lo, hi),
    )
    owners = dict(cur.fetchall())
    choices = holdings._choices(cur, lo, hi, owners)
    if not choices:
        return {}
    who = {owners[n] for n in choices}
    held = holdings._amounts(cur, who)
    main = {o: wallets.main_of(cur, o) for o in who}
    cur.execute("select address, asset, affection from social.pet_care where address = any(%s);", (list(set(main.values())),))
    affection = {(a, asset): x for a, asset, x in cur.fetchall()}
    out = {}
    for n, assets in choices.items():
        o = owners[n]
        points = sum(
            level(affection.get((main[o], a), 0)) - 1 for a in assets if holdings.tier(a, held.get(o, {}).get(a, 0)) > 0
        )
        if points:
            out[n] = points
    return out


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


@router.post("/v1/people/{address}/pets/{asset}/pat")
def pat(address: str, asset: str, viewer: str = Depends(current_address)):
    """Pat someone else's pet, where they show it, once a day."""
    now = datetime.now(timezone.utc)
    with cursor() as cur:
        owner, me = wallets.main_of(cur, address), wallets.main_of(cur, viewer)
        if owner == me:
            raise HTTPException(400, "that's your own pet; feed it instead")
        pet = next((p for p in pets(cur, address, now) if p["asset"] == asset), None)
        if pet is None or not (pet["public"] or _shown_on_district(cur, address, asset)):
            raise HTTPException(404, "no such pet to pat here")
        cur.execute(
            "insert into social.pet_pats (day, owner, asset, patter) values (%s, %s, %s, %s) on conflict do nothing;",
            (now.date(), owner, asset, me),
        )
        if cur.rowcount == 0:
            raise HTTPException(409, "you already patted it today")
        cur.execute("select count(*) from social.pet_pats where day = %s and owner = %s and asset = %s;", (now.date(), owner, asset))
        if (cur.fetchone()[0] - 1) * PAT_AFFECTION < PAT_CAP:
            cur.execute(
                "insert into social.pet_care (address, asset, affection) values (%s, %s, %s) "
                "on conflict (address, asset) do update set affection = social.pet_care.affection + excluded.affection;",
                (owner, asset, PAT_AFFECTION),
            )
        notify.notify(cur, owner, "pat", viewer, 0, block_height=(now.date() - date(1970, 1, 1)).days)
        return {**next(p for p in public_pets_any(cur, address, viewer) if p["asset"] == asset)}


def public_pets_any(cur, address, viewer):
    """Like public_pets, but every pet address holds, for the one just patted."""
    today = pats(cur, address, viewer)
    return [{**{k: p[k] for k in PUBLIC_FIELDS}, **today.get(p["asset"], {"pats": 0, "patted": False})} for p in pets(cur, address)]


class PetBody(BaseModel):
    name: str | None = Field(default=None, max_length=20)  # empty or null: no name
    face: str | None = None  # one of the pet's items, or null for its logo
    public: bool | None = None  # show it on the owner's public page


@router.put("/v1/me/pets/{asset}")
def update(asset: str, req: PetBody, address: str = Depends(current_address)):
    """Name the pet, or pick which of its inscriptions it looks like (or its logo); fields left out stay."""
    with cursor() as cur:
        pet = _pet(cur, address, asset)
        main = wallets.main_of(cur, address)
        cur.execute("insert into social.pet_care (address, asset) values (%s, %s) on conflict do nothing;", (main, asset))
        if "name" in req.model_fields_set:
            name = (req.name or "").strip() or None
            cur.execute("update social.pet_care set name = %s where address = %s and asset = %s;", (name, main, asset))
        if "face" in req.model_fields_set:  # null: back to the logo
            if req.face is not None and req.face not in pet["items"]:
                raise HTTPException(400, "pick one of the inscriptions this pet has")
            cur.execute("update social.pet_care set face = %s where address = %s and asset = %s;", (req.face, main, asset))
        if req.public is not None:
            cur.execute("update social.pet_care set public = %s where address = %s and asset = %s;", (req.public, main, asset))
        return _pet(cur, address, asset)
