"""unimap parcel indexer.

Runs beside OPI's bitmap_index on the same Postgres database. For each block it
reads the block's new text inscriptions from OPI's ord db_reader, keeps the
valid parcels (parcel_index/rules.py) and writes them with an OPI-style
cumulative event hash.

Run: python3 -m parcel_index.indexer   (settings from .env, see .env_sample)
"""

import os
import sys
import time
import traceback

import psycopg2
from dotenv import find_dotenv, load_dotenv

from parcel_index import rules
from parcel_index.sources import Bitcoind, OrdReader

FIRST_INSCRIPTION_HEIGHTS = {
    "mainnet": 767430,
    "testnet": 2413343,
    "testnet4": 0,
    "signet": 112402,
    "regtest": 0,
}
REORG_LOOKBACK = 10


def connect():
    return psycopg2.connect(
        host=os.getenv("DB_HOST") or "localhost",
        port=int(os.getenv("DB_PORT") or "5432"),
        database=os.getenv("DB_DATABASE") or "postgres",
        user=os.getenv("DB_USER") or "postgres",
        password=os.getenv("DB_PASSWD"),
    )


class ParcelIndexer:
    def __init__(self, conn, ord_reader, bitcoind, first_height):
        self.conn = conn
        self.ord = ord_reader
        self.btc = bitcoind
        self.first_height = first_height

    # --- reads -----------------------------------------------------------

    def _one(self, sql, args=()):
        with self.conn.cursor() as cur:
            cur.execute(sql, args)
            row = cur.fetchone()
            return None if row is None else row[0]

    def next_height(self):
        last = self._one("select max(block_height) from parcel_block_hashes;")
        return self.first_height if last is None else last + 1

    def bitmap_indexed_height(self):
        # Parcels for block h need districts up to h, including any inscribed in h.
        return self._one("select max(block_height) from bitmap_block_hashes;")

    def district_of(self, bitmap_number):
        return self._one(
            "select inscription_id from bitmaps where bitmap_number = %s;", (bitmap_number,)
        )

    def is_taken(self, bitmap_number, tx_index):
        return (
            self._one(
                "select 1 from parcels where bitmap_number = %s and tx_index = %s;",
                (bitmap_number, tx_index),
            )
            is not None
        )

    def tx_count_of(self, block_height):
        cached = self._one("select tx_count from block_meta where block_height = %s;", (block_height,))
        if cached is not None:
            return cached
        block_hash = self.btc.block_hash(block_height)
        count = self.btc.tx_count(block_hash)
        with self.conn.cursor() as cur:
            cur.execute(
                "insert into block_meta (block_height, block_hash, tx_count) values (%s, %s, %s) "
                "on conflict (block_height) do nothing;",
                (block_height, block_hash, count),
            )
        return count

    # --- writes ----------------------------------------------------------

    def index_block(self, height):
        block_hash = self.btc.block_hash(height)
        inscriptions = self.ord.block_text_inscriptions(height)
        accepted = rules.select_parcels(
            inscriptions,
            parent_of=self.ord.parent_id,
            district_of=self.district_of,
            tx_count_of=self.tx_count_of,
            is_taken=self.is_taken,
        )
        events = []
        with self.conn.cursor() as cur:
            for p in accepted:
                cur.execute(
                    "insert into parcels (inscription_id, inscription_number, tx_index, bitmap_number, "
                    "district_inscription_id, block_height) values (%s, %s, %s, %s, %s, %s);",
                    (
                        p.inscription_id,
                        p.inscription_number,
                        p.claim.tx_index,
                        p.claim.block_height,
                        p.district_inscription_id,
                        height,
                    ),
                )
                events.append(rules.event_str(p.inscription_id, p.claim))
            block_event_hash = rules.block_event_hash(events)
            cur.execute(
                "select cumulative_event_hash from parcel_cumulative_event_hashes where block_height = %s;",
                (height - 1,),
            )
            row = cur.fetchone()
            cumulative = rules.cumulative_hash(None if row is None else row[0], block_event_hash)
            cur.execute(
                "insert into parcel_cumulative_event_hashes (block_height, block_event_hash, cumulative_event_hash) "
                "values (%s, %s, %s);",
                (height, block_event_hash, cumulative),
            )
            cur.execute(
                "insert into parcel_block_hashes (block_height, block_hash) values (%s, %s);",
                (height, block_hash),
            )
        self.conn.commit()
        for p in accepted:
            print(f"parcel {p.claim.tx_index}.{p.claim.block_height}.bitmap -> {p.inscription_id}")
        return accepted

    def rollback_to(self, height):
        with self.conn.cursor() as cur:
            for table in ("parcels", "parcel_cumulative_event_hashes", "parcel_block_hashes"):
                cur.execute(f"delete from {table} where block_height > %s;", (height,))
        self.conn.commit()

    def find_reorg_height(self):
        """None when the tip matches the chain, else the last height that still matches."""
        with self.conn.cursor() as cur:
            cur.execute(
                "select block_height, block_hash from parcel_block_hashes order by block_height desc limit %s;",
                (REORG_LOOKBACK,),
            )
            rows = cur.fetchall()
        if not rows or self.btc.block_hash(rows[0][0]) == rows[0][1]:
            return None
        for height, block_hash in rows[1:]:
            if self.btc.block_hash(height) == block_hash:
                return height
        raise RuntimeError(f"reorg deeper than {REORG_LOOKBACK} blocks")

    def step(self):
        """Index at most one block. Returns False when there is nothing to do."""
        reorg = self.find_reorg_height()
        if reorg is not None:
            print(f"reorg detected, rolling back to {reorg}")
            self.rollback_to(reorg)
        height = self.next_height()
        ready = min(self.ord.latest_block_height() or -1, self.bitmap_indexed_height() or -1)
        if height > ready:
            return False
        self.index_block(height)
        return True


def main():
    load_dotenv(find_dotenv(usecwd=True))
    network = os.getenv("NETWORK_TYPE") or "mainnet"
    indexer = ParcelIndexer(
        connect(),
        OrdReader(os.getenv("DB_READER_API_URL") or "http://localhost:11030/"),
        Bitcoind(
            os.getenv("BITCOIN_RPC_URL") or "http://localhost:8332/",
            os.getenv("BITCOIN_RPC_USER"),
            os.getenv("BITCOIN_RPC_PASSWD"),
        ),
        FIRST_INSCRIPTION_HEIGHTS[network],
    )
    once = "--once" in sys.argv  # exit when caught up (used by tests)
    while True:
        try:
            if not indexer.step():
                if once:
                    return
                time.sleep(5)
        except Exception:
            traceback.print_exc()
            indexer.conn.rollback()
            if once:
                sys.exit(1)
            time.sleep(10)


if __name__ == "__main__":
    main()
