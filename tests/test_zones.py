"""Zoning rules (parcel_index/zones.py, block_zones in db_init.sql) against a
real Postgres. Set TEST_PGURL to a throwaway database (its public schema is
dropped and recreated)."""

import os
import unittest

from parcel_index.zones import EPOCH_BLOCKS, ZoneIndexer

PGURL = os.getenv("TEST_PGURL")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class FakeBitcoind:
    def __init__(self, blocks):
        self.blocks = blocks  # height -> (txs, fee, out)

    def block_count(self):
        return max(self.blocks)

    def block_hash(self, height):
        return f"h{height}"

    def block_stats(self, block_hash):
        txs, fee, out = self.blocks[int(block_hash[1:])]
        return {"txs": txs, "totalfee": fee, "total_out": out}


class FakeOrd:
    def __init__(self, inscriptions):
        self.inscriptions = inscriptions

    def block_height(self):
        return 10**9

    def block_inscription_count(self, height):
        return self.inscriptions.get(height, 0)


@unittest.skipUnless(PGURL, "TEST_PGURL not set")
class Zones(unittest.TestCase):
    def test_zones(self):
        import psycopg2

        conn = psycopg2.connect(PGURL)
        with conn.cursor() as cur:
            cur.execute("drop schema if exists social cascade; drop schema public cascade; create schema public;")
            cur.execute(open(os.path.join(ROOT, "parcel_index/db_init.sql")).read())
        conn.commit()

        # 200 ordinary blocks: 100 txs, fees 1000..200000, 1 BTC moved per tx.
        blocks = {h: (100, 1000 * (h + 1), 100 * 99 * 10**8 // 100) for h in range(1, 201)}
        blocks[0] = (1, 0, 0)  # genesis: a landmark, though coinbase-only
        blocks[201] = (1, 0, 0)  # coinbase only
        blocks[202] = (3, 500, 2 * 50 * 10**8)  # few txs, 50 BTC each
        blocks[203] = (100, 2000, 99 * 10**8)  # mostly inscriptions
        idx = ZoneIndexer(conn, FakeOrd({203: 60}), FakeBitcoind(blocks), 0)
        while idx.step():
            pass
        self.assertEqual(idx.next_height(), 204)

        with conn.cursor() as cur:
            cur.execute("select block_height, zone from block_zones;")
            zones = dict(cur.fetchall())
            cur.execute("select epoch, block_count from zone_thresholds;")
            self.assertEqual(cur.fetchall(), [(0, 204)])
        self.assertEqual(zones[0], "landmark")
        self.assertEqual(zones[201], "mountain")
        self.assertEqual(zones[200], "cbd")  # highest fee
        self.assertEqual(zones[190], "commercial")
        self.assertEqual(zones[203], "data")
        self.assertEqual(zones[202], "villa")
        self.assertEqual(zones[50], "residential")

        # A reorg replaces the stats of the changed blocks.
        idx.btc.block_hash = lambda h: f"h{h}" if h < 202 else f"x{h}"
        idx.btc.block_stats = lambda bh: dict(zip(("txs", "totalfee", "total_out"), blocks[int(bh[1:])]))
        idx.step()
        with conn.cursor() as cur:
            cur.execute("select block_hash from block_stats where block_height = 202;")
            self.assertEqual(cur.fetchone()[0], "x202")
        self.assertEqual(EPOCH_BLOCKS, 210_000)
        conn.close()


if __name__ == "__main__":
    unittest.main()
