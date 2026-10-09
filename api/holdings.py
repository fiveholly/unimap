"""Wallet holdings on the map (藏品): a district's owner can show some of what their wallet
holds as pets living on the district, a dog for DOG•GO•TO•THE•MOON, a cat for a Quantum Cat.

ASSETS lists what can be shown and the amounts each tier starts at. Nothing shows until the
owner picks it (social.showcase), and a pick only counts while the address that made it still
holds the district, so a new owner's wallet is never shown without their say.

Balances come from a provider (Hiro's public Ordinals and Runes API by default; set
HOLDINGS_API_URL and HOLDINGS_API_KEY to change) and are cached in social.holdings for
REFRESH_HOURS; the map reads only the cache. Collections are lists of inscription ids in
api/collections/<slug>.json (scripts/fetch_collections.py downloads them). Mirrors
web/lib/pets.ts; keep the keys and tiers in step.
"""

import json
import logging
import os
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from pathlib import Path

import requests
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from api import roles
from api.auth import current_address
from api.db import cursor

log = logging.getLogger(__name__)
router = APIRouter()

ASSETS = {
    "dog": {"kind": "rune", "rune": "DOGGOTOTHEMOON", "tiers": (1, 1_000_000, 100_000_000)},
    "cat": {"kind": "collection", "collection": "quantum-cats", "tiers": (1, 3, 10)},
}
REFRESH_HOURS = 6
MIN_REFRESH_MINUTES = 10  # an owner's 刷新 can't ask the provider more often than this
COLLECTIONS_DIR = Path(os.getenv("HOLDINGS_COLLECTIONS_DIR") or Path(__file__).parent / "collections")
PAGE = 60
MAX_PAGES = 20  # inscriptions looked at per address: PAGE * MAX_PAGES


def tier(asset, amount):
    """0 (none) to 3 for an amount of the asset."""
    return sum(1 for t in ASSETS[asset]["tiers"] if amount >= t)


@lru_cache(maxsize=None)
def collection(slug):
    """Inscription ids in a collection, or an empty set if its list isn't installed."""
    path = COLLECTIONS_DIR / f"{slug}.json"
    try:
        items = json.loads(path.read_text())
    except (OSError, ValueError):
        log.warning("collection list %s missing or unreadable", path)
        return frozenset()
    return frozenset(x["id"] if isinstance(x, dict) else x for x in items)


class Hiro:
    """Hiro's Ordinals and Runes API (https://docs.hiro.so)."""

    def __init__(self, url=None, key=None):
        self.url = (url or os.getenv("HOLDINGS_API_URL") or "https://api.hiro.so").rstrip("/")
        self.headers = {"Accept": "application/json"}
        if key or os.getenv("HOLDINGS_API_KEY"):
            self.headers["x-api-key"] = key or os.getenv("HOLDINGS_API_KEY")

    def _pages(self, path, params=None):
        for page in range(MAX_PAGES):
            r = requests.get(
                self.url + path,
                params={**(params or {}), "limit": PAGE, "offset": page * PAGE},
                headers=self.headers,
                timeout=15,
            )
            r.raise_for_status()
            js = r.json()
            yield from js.get("results", [])
            if (page + 1) * PAGE >= js.get("total", 0):
                return

    def rune_balances(self, address):
        """{rune name without spacers: amount in whole units}."""
        out = {}
        for row in self._pages(f"/runes/v1/addresses/{address}/balances"):
            try:
                out[row["rune"]["name"].replace("•", "")] = Decimal(str(row["balance"]))
            except (KeyError, InvalidOperation):
                continue
        return out

    def inscription_ids(self, address):
        for row in self._pages("/ordinals/v1/inscriptions", {"address": address}):
            if "id" in row:
                yield row["id"]


provider = None  # tests put a fake here


def _provider():
    global provider
    if provider is None:
        provider = Hiro()
    return provider


def fetch(address):
    """{asset: amount} the address holds now, asking the provider."""
    p = _provider()
    out = {}
    runes = [a for a, spec in ASSETS.items() if spec["kind"] == "rune"]
    if runes:
        balances = p.rune_balances(address)
        for a in runes:
            out[a] = balances.get(ASSETS[a]["rune"], Decimal(0))
    collections = [a for a, spec in ASSETS.items() if spec["kind"] == "collection"]
    if collections:
        counts = dict.fromkeys(collections, 0)
        for inscription_id in p.inscription_ids(address):
            for a in collections:
                if inscription_id in collection(ASSETS[a]["collection"]):
                    counts[a] += 1
        out.update(counts)
    return out


def refresh(address, min_age_minutes=0):
    """Ask the provider for the address's holdings and cache them. Returns False if the cache
    is younger than min_age_minutes or the provider failed (the old cache stays)."""
    with cursor() as cur:
        cur.execute(
            "select checked_at > now() - make_interval(mins => %s) from social.holdings_checked where address = %s;",
            (min_age_minutes, address),
        )
        row = cur.fetchone()
        if min_age_minutes and row and row[0]:
            return False
    try:
        amounts = fetch(address)
        error = None
    except Exception as e:  # the provider is outside our control; keep serving the old cache
        log.warning("holdings for %s: %s", address, e)
        amounts, error = None, str(e)[:300]
    with cursor() as cur:
        if amounts is not None:
            cur.execute("delete from social.holdings where address = %s;", (address,))
            for asset, amount in amounts.items():
                if amount > 0:
                    cur.execute(
                        "insert into social.holdings (address, asset, amount) values (%s, %s, %s);",
                        (address, asset, amount),
                    )
        cur.execute(
            "insert into social.holdings_checked (address, checked_at, error) values (%s, now(), %s) "
            "on conflict (address) do update set checked_at = now(), error = excluded.error;",
            (address, error),
        )
    return amounts is not None


def stale(cur, address):
    cur.execute(
        "select checked_at < now() - make_interval(hours => %s) from social.holdings_checked where address = %s;",
        (REFRESH_HOURS, address),
    )
    row = cur.fetchone()
    return row is None or row[0]


def _amounts(cur, addresses):
    cur.execute("select address, asset, amount from social.holdings where address = any(%s);", (list(addresses),))
    out = {}
    for address, asset, amount in cur.fetchall():
        out.setdefault(address, {})[asset] = amount
    return out


def _choices(cur, lo, hi, owners):
    """{n: [asset]} picked for districts lo..hi by the address that holds them now."""
    cur.execute(
        "select bitmap_number, assets, updated_by from social.showcase where bitmap_number between %s and %s;",
        (lo, hi),
    )
    return {n: [a for a in assets if a in ASSETS] for n, assets, by in cur.fetchall() if by and owners.get(n) == by}


def _view(asset, amount):
    return {"asset": asset, "tier": tier(asset, amount), "amount": str(amount.normalize() if isinstance(amount, Decimal) else amount)}


def chosen(cur, n, owner):
    return bool(owner) and bool(_choices(cur, n, n, {n: owner}).get(n))


def in_range(cur, lo, hi, owners):
    """{n: ["dog:2", ...]} for map tiles: what each district shows, with its tier."""
    choices = _choices(cur, lo, hi, owners)
    amounts = _amounts(cur, {owners[n] for n in choices})
    out = {}
    for n, assets in choices.items():
        held = amounts.get(owners[n], {})
        pets = [f"{a}:{tier(a, held[a])}" for a in assets if tier(a, held.get(a, 0)) > 0]
        if pets:
            out[n] = pets
    return out


def shown(cur, n, owner):
    """What district n shows, for its page: [{asset, tier, amount}]."""
    if owner is None:
        return []
    assets = _choices(cur, n, n, {n: owner}).get(n, [])
    held = _amounts(cur, [owner]).get(owner, {})
    return [_view(a, held[a]) for a in assets if tier(a, held.get(a, 0)) > 0]


def _owner_view(cur, n, owner):
    held = _amounts(cur, [owner]).get(owner, {})
    cur.execute("select checked_at, error from social.holdings_checked where address = %s;", (owner,))
    checked = cur.fetchone()
    return {
        "chosen": _choices(cur, n, n, {n: owner}).get(n, []),
        "held": [_view(a, held.get(a, 0)) for a in ASSETS],
        "checked_at": checked[0].isoformat() if checked else None,
        "error": checked[1] if checked else None,
        "shown": shown(cur, n, owner),
    }


@router.get("/v1/districts/{bitmap_number}/showcase")
def showcase(bitmap_number: int, tasks: BackgroundTasks, address: str = Depends(current_address)):
    """The owner's view: what their wallet holds and what they chose to show."""
    with cursor() as cur:
        roles.require_owner(cur, bitmap_number, address)
        cur.execute("select 1 from social.holdings_checked where address = %s;", (address,))
        first = cur.fetchone() is None
        old = not first and stale(cur, address)
    if first:
        refresh(address)  # the first look waits, so the owner sees their holdings at once
    elif old:
        tasks.add_task(refresh, address)
    with cursor() as cur:
        return _owner_view(cur, bitmap_number, address)


class ShowcaseBody(BaseModel):
    assets: list[str] = Field(default_factory=list, max_length=len(ASSETS))


@router.put("/v1/districts/{bitmap_number}/showcase")
def set_showcase(bitmap_number: int, req: ShowcaseBody, address: str = Depends(current_address)):
    if any(a not in ASSETS for a in req.assets) or len(set(req.assets)) != len(req.assets):
        raise HTTPException(400, f"assets are some of {', '.join(ASSETS)}")
    with cursor() as cur:
        roles.require_owner(cur, bitmap_number, address)
        cur.execute(
            "insert into social.showcase (bitmap_number, assets, updated_by) values (%s, %s, %s) "
            "on conflict (bitmap_number) do update set assets = excluded.assets, updated_by = excluded.updated_by, "
            "updated_at = now();",
            (bitmap_number, req.assets, address),
        )
        return _owner_view(cur, bitmap_number, address)


@router.post("/v1/districts/{bitmap_number}/showcase/refresh")
def refresh_showcase(bitmap_number: int, address: str = Depends(current_address)):
    with cursor() as cur:
        roles.require_owner(cur, bitmap_number, address)
    refresh(address, MIN_REFRESH_MINUTES)
    with cursor() as cur:
        return _owner_view(cur, bitmap_number, address)
