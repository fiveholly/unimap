#!/usr/bin/env python3
"""Download the inscription lists api/holdings.py uses to tell which inscriptions belong to a
collection (a Quantum Cat, ...), into api/collections/<slug>.json.

The lists come from the community-kept ordinals-collections repository by default; pass
--source to use another place that serves <slug>/inscriptions.json. Each list is a JSON array
of inscription ids or of objects with an "id".

    python3 scripts/fetch_collections.py                 # every collection api/holdings.py uses
    python3 scripts/fetch_collections.py quantum-cats    # just these
"""

import argparse
import json
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api.holdings import ASSETS, COLLECTIONS_DIR  # noqa: E402

SOURCE = "https://raw.githubusercontent.com/ordinals-wallet/ordinals-collections/main/collections"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slugs", nargs="*", help="collections to fetch (default: all in api/holdings.py)")
    ap.add_argument("--source", default=SOURCE, help="base URL serving <slug>/inscriptions.json")
    args = ap.parse_args()
    slugs = args.slugs or sorted({a["collection"] for a in ASSETS.values() if a["kind"] == "collection"})
    COLLECTIONS_DIR.mkdir(parents=True, exist_ok=True)
    failed = False
    for slug in slugs:
        url = f"{args.source.rstrip('/')}/{slug}/inscriptions.json"
        try:
            r = requests.get(url, timeout=60)
            r.raise_for_status()
            items = r.json()
            ids = [x["id"] if isinstance(x, dict) else x for x in items]
            if not ids or not all(isinstance(i, str) and i.endswith(tuple(f"i{n}" for n in range(10))) for i in ids[:10]):
                raise ValueError("doesn't look like a list of inscription ids")
        except Exception as e:
            print(f"{slug}: {url}: {e}", file=sys.stderr)
            failed = True
            continue
        (COLLECTIONS_DIR / f"{slug}.json").write_text(json.dumps(ids))
        print(f"{slug}: {len(ids)} inscriptions")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
