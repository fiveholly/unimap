"""unimap zoning: which kind of neighbourhood each block is.

Stores a few numbers per block (block_stats) and, per halving epoch, the
percentiles the zones are cut at (zone_thresholds). The block_zones view in
db_init.sql turns those into a zone, so changing a rule is a view change, not a
re-index. Zones, first match wins:

  landmark     a block from LANDMARKS
  mountain     only the coinbase transaction
  cbd          total fees in the top 1% of its epoch
  commercial   total fees in the top 10% of its epoch
  data         at least 40% of its transactions carry a new inscription
  villa        few transactions (bottom 25% of its epoch) moving large amounts
               (average output per transaction above the 90th percentile)
  residential  everything else

Percentiles are over the blocks indexed so far, so zones of the current epoch
settle as it fills up. Fees come from bitcoind's getblockstats (needs an
unpruned node), inscription counts from upstream ord's /block endpoint.

Run: python3 -m parcel_index.zones   (settings from .env, see .env_sample)
"""

import os
import sys
import time
import traceback

from dotenv import find_dotenv, load_dotenv

from parcel_index.indexer import FIRST_INSCRIPTION_HEIGHTS, REORG_LOOKBACK, connect
from parcel_index.sources import Bitcoind, OrdServer

EPOCH_BLOCKS = 210_000
# Genesis, Bitcoin Pizza, the halvings, SegWit and Taproot activation, the first inscription.
# Keep in sync with block_zones in db_init.sql and web/lib/zones.ts.
LANDMARKS = (0, 57043, 210000, 420000, 481824, 630000, 709632, 767430, 840000)
# Recompute thresholds at least this often while catching up.
REFRESH_EVERY = 5000

THRESHOLDS_SQL = """
insert into zone_thresholds (epoch, fee_p90, fee_p99, txs_p25, avg_out_p90, block_count)
select %(epoch)s,
  percentile_disc(0.90) within group (order by total_fee),
  percentile_disc(0.99) within group (order by total_fee),
  percentile_disc(0.25) within group (order by tx_count),
  percentile_disc(0.90) within group (order by total_out / (tx_count - 1)) filter (where tx_count > 1),
  count(*)
from block_stats where block_height >= %(lo)s and block_height < %(hi)s
on conflict (epoch) do update set fee_p90 = excluded.fee_p90, fee_p99 = excluded.fee_p99,
  txs_p25 = excluded.txs_p25, avg_out_p90 = excluded.avg_out_p90, block_count = excluded.block_count;
"""


class ZoneIndexer:
    def __init__(self, conn, ord_server, bitcoind, first_inscription_height):
        self.conn = conn
        self.ord = ord_server
        self.btc = bitcoind
        self.first_inscription_height = first_inscription_height
        self.dirty = set()  # epochs whose thresholds are stale
        self.since_refresh = 0

    def _one(self, sql, args=()):
        with self.conn.cursor() as cur:
            cur.execute(sql, args)
            row = cur.fetchone()
            return None if row is None else row[0]

    def next_height(self):
        last = self._one("select max(block_height) from block_stats;")
        return 0 if last is None else last + 1

    def ready_height(self):
        tip = self.btc.block_count()
        ord_height = self.ord.block_height()
        if ord_height is None:
            return -1
        # Inscription counts need ord; earlier blocks have none to count.
        return min(tip, max(ord_height, self.first_inscription_height - 1))

    def index_block(self, height):
        block_hash = self.btc.block_hash(height)
        stats = self.btc.block_stats(block_hash)
        inscriptions = self.ord.block_inscription_count(height) if height >= self.first_inscription_height else 0
        with self.conn.cursor() as cur:
            cur.execute(
                "insert into block_stats (block_height, block_hash, tx_count, total_fee, total_out, inscriptions) "
                "values (%s, %s, %s, %s, %s, %s) on conflict (block_height) do update set "
                "block_hash = excluded.block_hash, tx_count = excluded.tx_count, total_fee = excluded.total_fee, "
                "total_out = excluded.total_out, inscriptions = excluded.inscriptions;",
                (height, block_hash, stats["txs"], stats["totalfee"], stats["total_out"], inscriptions),
            )
        self.conn.commit()
        self.dirty.add(height // EPOCH_BLOCKS)
        self.since_refresh += 1

    def refresh_thresholds(self):
        with self.conn.cursor() as cur:
            for epoch in sorted(self.dirty):
                lo = epoch * EPOCH_BLOCKS
                cur.execute(THRESHOLDS_SQL, {"epoch": epoch, "lo": lo, "hi": lo + EPOCH_BLOCKS})
        self.conn.commit()
        self.dirty.clear()
        self.since_refresh = 0

    def rollback_to(self, height):
        with self.conn.cursor() as cur:
            cur.execute("delete from block_stats where block_height > %s;", (height,))
        self.conn.commit()
        self.dirty.add(height // EPOCH_BLOCKS)

    def find_reorg_height(self):
        with self.conn.cursor() as cur:
            cur.execute(
                "select block_height, block_hash from block_stats order by block_height desc limit %s;",
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
            print(f"reorg detected, rolling back zones to {reorg}")
            self.rollback_to(reorg)
        height = self.next_height()
        if height > self.ready_height():
            if self.dirty:
                self.refresh_thresholds()
            return False
        self.index_block(height)
        if self.since_refresh >= REFRESH_EVERY:
            self.refresh_thresholds()
        return True


def main():
    load_dotenv(find_dotenv(usecwd=True))
    network = os.getenv("NETWORK_TYPE") or "mainnet"
    indexer = ZoneIndexer(
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
