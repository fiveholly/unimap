Inscription lists for the collections in `api/holdings.py`, one `<slug>.json` per collection
(a JSON array of inscription ids). `scripts/fetch_collections.py` downloads them; they are
not checked in. Without a list, that collection's pet simply never shows.
