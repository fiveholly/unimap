"""美元价: what a sat costs in US dollars, and what a mainnet block takes in fees, for showing costs.

The write page of a 时间胶囊 (api/capsule.py rules) shows every cost in dollars first: the network
fee, the service fee, what a photo adds, the total. Both figures are mainnet's, from mempool.space
(PRICE_URL, default https://mempool.space/api; "off" turns this off): /v1/prices for BTC/USD and
/v1/fees/recommended for the fee rate. On the test networks the coins are worthless, so the page
shows what the same letter would cost on mainnet, and says so. Asked from the server, so the
browser's CSP stays as it is; kept for CACHE_SECONDS, and after a failure the last answer is kept
(or none, and the page shows sats alone). Never used to decide what anyone pays.
"""

import logging
import os
import time

import requests

log = logging.getLogger(__name__)

CACHE_SECONDS = 300
RETRY_SECONDS = 60  # after a failure, ask again no sooner than this
DEFAULT_URL = "https://mempool.space/api"

_cache = {"at": 0.0, "tried": 0.0, "value": None}


def base_url():
    url = (os.getenv("PRICE_URL") or "").strip()
    if url.lower() == "off":
        return None
    return (url or DEFAULT_URL).rstrip("/")


def fetch(url):
    """{btc_usd, fee_rate} from mempool.space's API at url, or None. Tests replace this."""
    try:
        p = requests.get(f"{url}/v1/prices", timeout=4)
        p.raise_for_status()
        usd = float(p.json()["USD"])
        fee = None
        try:
            f = requests.get(f"{url}/v1/fees/recommended", timeout=4)
            f.raise_for_status()
            fee = int(f.json().get("halfHourFee") or f.json().get("fastestFee") or 0) or None
        except (requests.RequestException, ValueError, KeyError, TypeError):
            log.warning("prices: %s gave no fee rate", url)
        return {"btc_usd": usd, "fee_rate": fee} if usd > 0 else None
    except (requests.RequestException, ValueError, KeyError, TypeError):
        log.warning("prices: %s gave no BTC/USD price", url)
        return None


def usd():
    """{btc_usd, fee_rate (sat/vB, mainnet; None if unknown), at} kept for CACHE_SECONDS; None
    while no price has ever been had (or PRICE_URL is off)."""
    url = base_url()
    if url is None:
        return None
    now = time.time()
    fresh = _cache["value"] is not None and now - _cache["at"] < CACHE_SECONDS
    if not fresh and now - _cache["tried"] >= RETRY_SECONDS:
        _cache["tried"] = now
        got = fetch(url)
        if got is not None:
            _cache.update(at=now, value={**got, "at": int(now)})
    return _cache["value"]
