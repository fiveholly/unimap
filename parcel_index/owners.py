"""unimap owner tracker.

Keeps inscription_owners pointing at the output that holds each district and
parcel inscription. Per block it adds the block's new districts and parcels,
then re-asks upstream ord about any tracked inscription whose output the block
spent. Claims and moves to a different address are logged in land_events.
Runs after bitmap_index and parcel_index have indexed the block.

ord answers with its current view, which may be ahead of the block being
processed while catching up. That is fine for owners: the stored output is then
unspent up to ord's height, so no earlier block can spend it. land_events is
only exact from the point the tracker runs at the tip: while catching up, a
claim records the address holding the inscription now, and moves in between
are not seen.

Run: python3 -m parcel_index.owners   (settings from .env, see .env_sample)
"""

import os
import sys
import time
import traceback

from dotenv import find_dotenv, load_dotenv

from parcel_index.indexer import FIRST_INSCRIPTION_HEIGHTS, REORG_LOOKBACK, connect
from parcel_index.sources import Bitcoind, OrdServer


class OwnerIndexer:
    def __init__(self, conn, ord_server, bitcoind, first_height):
        self.conn = conn
        self.ord = ord_server
        self.btc = bitcoind
        self.first_height = first_height

    def _one(self, sql, args=()):
        with self.conn.cursor() as cur:
            cur.execute(sql, args)
            row = cur.fetchone()
            return None if row is None else row[0]

    def next_height(self):
        last = self._one("select max(block_height) from owner_block_hashes;")
        return self.first_height if last is None else last + 1

    def ready_height(self):
        parcels = self._one("select max(block_height) from parcel_block_hashes;")
        ord_height = self.ord.block_height()
        if parcels is None or ord_height is None:
            return -1
        return min(parcels, ord_height)

    def _refresh(self, cur, inscription_id, created_height, height):
        """Store the inscription's current location; returns (old address, new address)."""
        loc = self.ord.location(inscription_id)
        if loc is None:
            raise RuntimeError(f"ord does not know inscription {inscription_id}")
        outpoint, address, value = loc
        cur.execute("select address from inscription_owners where inscription_id = %s;", (inscription_id,))
        row = cur.fetchone()
        cur.execute(
            "insert into inscription_owners (inscription_id, created_height, outpoint, address, output_value, updated_height) "
            "values (%s, %s, %s, %s, %s, %s) on conflict (inscription_id) do update set "
            "outpoint = excluded.outpoint, address = excluded.address, output_value = excluded.output_value, "
            "updated_height = excluded.updated_height;",
            (inscription_id, created_height, outpoint, address, value, height),
        )
        return (None if row is None else row[0]), address

    def index_block(self, height):
        block_hash = self.btc.block_hash(height)
        block_time, spent = self.btc.spent_outpoints(block_hash)
        with self.conn.cursor() as cur:
            # Rows from a replaced chain (reorg) for this height or later.
            cur.execute("delete from inscription_owners where created_height >= %s;", (height,))
            cur.execute("delete from land_events where block_height >= %s;", (height,))
            cur.execute(
                "select inscription_id, bitmap_number, null::int4 from bitmaps where block_height = %s "
                "union all select inscription_id, bitmap_number, tx_index from parcels where block_height = %s;",
                (height, height),
            )
            new = {row[0]: row[1:] for row in cur.fetchall()}
            moved = {}
            if spent:
                cur.execute(
                    "select o.inscription_id, o.created_height, coalesce(p.bitmap_number, b.bitmap_number), p.tx_index "
                    "from inscription_owners o "
                    "left join parcels p on p.inscription_id = o.inscription_id "
                    "left join bitmaps b on b.inscription_id = o.inscription_id "
                    "where o.outpoint = any(%s);",
                    (spent,),
                )
                for inscription_id, created, bitmap_number, tx_index in cur.fetchall():
                    if inscription_id not in new:
                        moved[inscription_id] = (created, bitmap_number, tx_index)

            def event(kind, inscription_id, bitmap_number, tx_index, old, addr):
                cur.execute(
                    "insert into land_events (block_height, block_time, kind, inscription_id, bitmap_number, "
                    "tx_index, from_address, to_address) values (%s, %s, %s, %s, %s, %s, %s, %s);",
                    (height, block_time, kind, inscription_id, bitmap_number, tx_index, old, addr),
                )

            for inscription_id, (bitmap_number, tx_index) in new.items():
                _, addr = self._refresh(cur, inscription_id, height, height)
                kind = "district_claimed" if tx_index is None else "parcel_claimed"
                event(kind, inscription_id, bitmap_number, tx_index, None, addr)
            for inscription_id, (created, bitmap_number, tx_index) in moved.items():
                old, addr = self._refresh(cur, inscription_id, created, height)
                if old != addr:
                    event("transfer", inscription_id, bitmap_number, tx_index, old, addr)
            cur.execute(
                "insert into owner_block_hashes (block_height, block_hash) values (%s, %s);",
                (height, block_hash),
            )
        self.conn.commit()
        return set(new) | set(moved)

    def rollback_to(self, height):
        with self.conn.cursor() as cur:
            cur.execute("delete from inscription_owners where created_height > %s;", (height,))
            cur.execute("delete from land_events where block_height > %s;", (height,))
            cur.execute(
                "select inscription_id, created_height from inscription_owners where updated_height > %s;",
                (height,),
            )
            for inscription_id, created in cur.fetchall():
                self._refresh(cur, inscription_id, created, height)
            cur.execute("delete from owner_block_hashes where block_height > %s;", (height,))
        self.conn.commit()

    def find_reorg_height(self):
        with self.conn.cursor() as cur:
            cur.execute(
                "select block_height, block_hash from owner_block_hashes order by block_height desc limit %s;",
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
        reorg = self.find_reorg_height()
        if reorg is not None:
            print(f"reorg detected, rolling back owners to {reorg}")
            self.rollback_to(reorg)
        height = self.next_height()
        if height > self.ready_height():
            return False
        self.index_block(height)
        return True


def main():
    load_dotenv(find_dotenv(usecwd=True))
    network = os.getenv("NETWORK_TYPE") or "mainnet"
    indexer = OwnerIndexer(
        connect(),
        OrdServer(os.getenv("ORD_API_URL") or "http://localhost:80/"),
        Bitcoind(
            os.getenv("BITCOIN_RPC_URL") or "http://localhost:8332/",
            os.getenv("BITCOIN_RPC_USER"),
            os.getenv("BITCOIN_RPC_PASSWD"),
        ),
        FIRST_INSCRIPTION_HEIGHTS[network],
    )
    once = "--once" in sys.argv
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
