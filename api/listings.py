"""在售: districts listed for sale on a marketplace, marked on the map with their price.

Listings come from Magic Eden's Ordinals API by default (LISTINGS_API_URL, LISTINGS_API_KEY,
LISTINGS_COLLECTION to change) and are kept in social.listings, replaced as a whole on each
refresh. A refresh runs in the background when a map read finds the copy older than
REFRESH_MINUTES; the first process to claim the try (social.listings_checked) does it.

A listing counts only while its seller still holds the district by our own index: a listing
left behind after the inscription moved is not shown. If the marketplace hasn't answered for
STALE_HOURS, nothing is shown rather than old prices.
"""

import logging
import os
from datetime import datetime

import requests
from fastapi import APIRouter

from api.db import cursor

log = logging.getLogger(__name__)
router = APIRouter()

REFRESH_MINUTES = 10
STALE_HOURS = 6
PAGE = 100
MAX_PAGES = 100  # listings looked at per refresh: PAGE * MAX_PAGES, cheapest first


class MagicEden:
    """Magic Eden's Ordinals API (https://docs.magiceden.io), the bitmap collection."""

    market = "magiceden"

    def __init__(self, url=None, key=None, collection=None):
        self.url = (url or os.getenv("LISTINGS_API_URL") or "https://api-mainnet.magiceden.dev").rstrip("/")
        self.collection = collection or os.getenv("LISTINGS_COLLECTION") or "bitmap"
        self.headers = {"Accept": "application/json"}
        if key or os.getenv("LISTINGS_API_KEY"):
            self.headers["Authorization"] = f"Bearer {key or os.getenv('LISTINGS_API_KEY')}"

    @staticmethod
    def item_url(inscription_id):
        return f"https://magiceden.io/ordinals/item-details/{inscription_id}"

    def listed(self):
        """(inscription_id, price_sats, seller, listed_at or None) for every listed item."""
        for page in range(MAX_PAGES):
            r = requests.get(
                self.url + "/v2/ord/btc/tokens",
                params={
                    "collectionSymbol": self.collection,
                    "showAll": "false",
                    "sortBy": "priceAsc",
                    "limit": PAGE,
                    "offset": page * PAGE,
                },
                headers=self.headers,
                timeout=20,
            )
            r.raise_for_status()
            tokens = r.json().get("tokens", [])
            for tok in tokens:
                price = tok.get("listedPrice")
                if not tok.get("listed") or not tok.get("id") or not tok.get("owner") or not price:
                    continue
                yield tok["id"], int(price), tok["owner"], _time(tok.get("listedAt"))
            if len(tokens) < PAGE:
                return


def _time(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


provider = None  # tests put a fake here


def _provider():
    global provider
    if provider is None:
        provider = MagicEden()
    return provider


def stale(cur):
    """True when nobody has tried the marketplace in the last REFRESH_MINUTES."""
    cur.execute(
        "select 1 from social.listings_checked where market = %s and checked_at > now() - make_interval(mins => %s);",
        (_provider().market, REFRESH_MINUTES),
    )
    return cur.fetchone() is None


def _claim(market, force):
    """Mark a try as started; False if another process tried within REFRESH_MINUTES."""
    with cursor() as cur:
        cur.execute(
            "insert into social.listings_checked (market, checked_at) values (%s, now()) "
            "on conflict (market) do update set checked_at = now() "
            "where %s or social.listings_checked.checked_at <= now() - make_interval(mins => %s) "
            "returning 1;",
            (market, force, REFRESH_MINUTES),
        )
        return cur.fetchone() is not None


def refresh(force=False):
    """Fetch every listing and replace the stored ones. Returns False if someone tried within
    REFRESH_MINUTES or the marketplace failed (the old copy stays, and ages out after STALE_HOURS)."""
    p = _provider()
    if not _claim(p.market, force):
        return False
    try:
        rows = {}
        for inscription_id, price, seller, listed_at in p.listed():
            rows.setdefault(inscription_id, (inscription_id, price, seller, p.market, listed_at))
    except Exception as e:  # any provider trouble: keep the old copy
        log.warning("listings from %s failed: %s", p.market, e)
        return False
    with cursor() as cur:
        cur.execute("delete from social.listings where market = %s;", (p.market,))
        if rows:
            cur.executemany(
                "insert into social.listings (inscription_id, price_sats, seller, market, listed_at) "
                "values (%s, %s, %s, %s, %s);",
                list(rows.values()),
            )
        cur.execute("update social.listings_checked set ok_at = now() where market = %s;", (p.market,))
    return True


# Listings of districts whose seller still holds them, from a marketplace heard from lately.
# Live listings from the marketplace and from unimap's own market (api/market.py) alike, as
# (bitmap_number, market, inscription_id, price_sats, listed_at, listing_id). Districts only.
_LIVE = (
    "from (select b.bitmap_number, l.market, l.inscription_id, l.price_sats, l.listed_at, null::int8 as listing_id "
    "from social.listings l join bitmaps b on b.inscription_id = l.inscription_id "
    "join inscription_owners o on o.inscription_id = l.inscription_id and o.address = l.seller "
    "join social.listings_checked c on c.market = l.market "
    "and c.ok_at > now() - make_interval(hours => %(stale)s) "
    "union all select m.bitmap_number, 'unimap', m.inscription_id, m.price_sats, m.created_at, m.id "
    "from social.market_listings m join inscription_owners o on o.inscription_id = m.inscription_id and o.outpoint = m.outpoint "
    "where %(own)s and m.status = 'active' and m.tx_index is null) l "
)


def _sale(market, inscription_id, price, listed_at, listing_id=None):
    return {
        "price_sats": price,
        "market": market,
        "url": _provider().item_url(inscription_id) if market == _provider().market else None,
        "listed_at": listed_at.isoformat() if listed_at else None,
        **({"listing_id": listing_id} if listing_id is not None else {}),
    }


def _args(**kw):
    from api import market  # market imports land, which imports this module

    return {"stale": STALE_HOURS, "own": market.network() is not None, **kw}


def in_range(cur, lo, hi):
    """{bitmap_number: price in sats} for districts lo..hi listed for sale."""
    cur.execute(
        "select l.bitmap_number, min(l.price_sats) " + _LIVE + "where l.bitmap_number between %(lo)s and %(hi)s "
        "group by l.bitmap_number;",
        _args(lo=lo, hi=hi),
    )
    return dict(cur.fetchall())


def of(cur, n):
    """The cheapest live listing of district n, or None."""
    cur.execute(
        "select l.market, l.inscription_id, l.price_sats, l.listed_at, l.listing_id " + _LIVE + "where l.bitmap_number = %(n)s "
        "order by l.price_sats, l.market = 'unimap' desc limit 1;",
        _args(n=n),
    )
    row = cur.fetchone()
    return _sale(*row) if row else None


@router.get("/v1/listings")
def listings(limit: int = 50):
    """Districts for sale, cheapest first."""
    limit = max(1, min(limit, 200))
    with cursor() as cur:
        cur.execute(
            "select l.bitmap_number, l.market, l.inscription_id, l.price_sats, l.listed_at, l.listing_id "
            + _LIVE
            + "order by l.price_sats, l.bitmap_number limit %(limit)s;",
            _args(limit=limit),
        )
        return {"listings": [{"bitmap_number": n, **_sale(*rest)} for n, *rest in cur.fetchall()]}
