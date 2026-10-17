"""礼物 (api/gift.py): the gift's scripts and address, and the gate on unimap's backup half, against a
real Postgres (TEST_PGURL, as in test_social.py; its tables are dropped and recreated)."""

import base64
import hashlib
import os
import time
import unittest

from coincurve import PrivateKey

from api import gift
from tests import test_social as base
from tests.test_social import BOB, PGURL, Wallet

# The same vectors as web/lib/gift.test.ts: the recipient's key is 0x01 * 32, the sender's 0x02 * 32.
RECIPIENT = PrivateKey(b"\x01" * 32).public_key_xonly.format()
SENDER = PrivateKey(b"\x02" * 32).public_key_xonly.format()
H = 900_000
WITH_REFUND = "tb1p4srk47vjl9a0v4ew6uf7p6ehtqypn8yex5drmp3nv3d0hj6kul0qplhgsh"
NO_REFUND = "tb1pqxuqm6tl9ahdr6pu00w67cj3ynt7c65rkct9un6q2y9tueenhzwqqx4cd7"
REAL_FETCH_TIP = gift.fetch_tip  # setUp replaces it; test_min_of_two_sources wants the real one
TLOCK = "-----BEGIN AGE ENCRYPTED FILE-----\nYWdlLWVuY3J5cHRpb24ub3JnL3YxCg==\n-----END AGE ENCRYPTED FILE-----\n"


def b64url(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


class GiftScripts(unittest.TestCase):
    def test_leaf_scripts(self):
        # 3-byte CScriptNum of 900000 (0x0dbba0), OP_CLTV OP_DROP, a 32-byte push, OP_CHECKSIG.
        self.assertEqual(gift.lock_leaf(H, RECIPIENT).hex(), "03a0bb0db17520" + RECIPIENT.hex() + "ac")
        two = gift.leaves(H, RECIPIENT, SENDER, True)
        self.assertEqual(len(two), 2)
        self.assertEqual(two[1], gift.lock_leaf(H + 262_800, SENDER))
        self.assertEqual(gift.leaves(H, RECIPIENT, SENDER, False), [gift.lock_leaf(H, RECIPIENT)])

    def test_script_num(self):
        self.assertEqual(gift.script_num(0), b"\x00")
        self.assertEqual(gift.script_num(16), b"\x60")
        self.assertEqual(gift.script_num(17), b"\x01\x11")
        self.assertEqual(gift.script_num(128), b"\x02\x80\x00")  # the sign bit needs a byte of its own
        self.assertEqual(gift.script_num(1_162_800), b"\x03\x30\xbe\x11")

    def test_address_vectors(self):
        self.assertEqual(gift.taproot_address("signet", H, RECIPIENT, SENDER, True), WITH_REFUND)
        self.assertEqual(gift.taproot_address("signet", H, RECIPIENT, SENDER, True), WITH_REFUND)  # deterministic
        self.assertEqual(gift.taproot_address("signet", H, RECIPIENT, None, False), NO_REFUND)
        self.assertNotEqual(gift.taproot_address("signet", H + 1, RECIPIENT, SENDER, True), WITH_REFUND)
        self.assertNotEqual(gift.taproot_address("signet", H, SENDER, RECIPIENT, True), WITH_REFUND)

    def test_nums_has_no_key_path(self):
        # The internal key is BIP-341's H point: lift_x(sha256(G uncompressed)).
        g = bytes.fromhex(
            "0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
            "483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8"
        )
        self.assertEqual(hashlib.sha256(g).digest(), gift.NUMS)

    def test_web_sweep_verifies(self):
        """A sweep built and signed by web/lib/gift.ts (buildSweep, the 礼物钥匙 0x01 * 32) is a valid
        BIP-341 script-path spend of leaf 1 of WITH_REFUND, checked here from scratch."""
        import struct

        from api import btc
        from api.bip322 import _varint, sha256, tagged_hash
        from coincurve import PublicKeyXOnly

        raw = bytes.fromhex(
            "0200000000010122222222222222222222222222222222222222222222222222222222222222220000000000feffffff016c8501000000"
            "0000225120ac076af992f97af6572ed713e0eb375808199c99351a3d8633645afbcb56e7de03404e20fe88f6eb899517f0330e79e05d0c2c"
            "576339118ed1d5e68b9cd276a171c9221419f3968a3ab87081580e9f8adc5e1a5115f87ed06d66d6b1633e5d1aaa082803a0bb0db1752"
            "01b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078fac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f"
            "28ec96d547bfee9ace803ac001ce9e821c4838cde58a17a2045b0981f7fddf1b8a9a10abcb482169e0cecff1a0bb0d00"
        )
        tx = btc.Tx.parse(raw)
        spk = btc.address_script(WITH_REFUND, "signet")
        self.assertEqual((tx.locktime, tx.inputs[0].sequence), (H, 0xFFFFFFFE))
        sig, script, cb = tx.inputs[0].witness
        self.assertEqual(script, gift.lock_leaf(H, RECIPIENT))
        self.assertEqual(cb[1:33], gift.NUMS)
        # The control block's path (the refund leaf's hash) and the leaf rebuild the output key.
        self.assertEqual(gift.merkle_root([script, gift.lock_leaf(H + 262_800, SENDER)]), tagged_hash("TapBranch", b"".join(sorted([gift.leaf_hash(script), cb[33:65]]))))
        msg = b"\x00" + struct.pack("<i", tx.version) + struct.pack("<I", tx.locktime)
        msg += sha256(tx.inputs[0]._prevout()) + sha256(struct.pack("<q", 100_000)) + sha256(_varint(len(spk)) + spk)
        msg += sha256(struct.pack("<I", tx.inputs[0].sequence)) + sha256(b"".join(o.serialize() for o in tx.outputs))
        msg += b"\x02" + struct.pack("<I", 0) + gift.leaf_hash(script) + b"\x00" + b"\xff\xff\xff\xff"
        self.assertTrue(PublicKeyXOnly(RECIPIENT).verify(sig, tagged_hash("TapSighash", b"\x00" + msg)))

    def test_keys(self):
        self.assertEqual(gift.xonly("02" + RECIPIENT.hex(), "k"), RECIPIENT)
        self.assertEqual(gift.xonly(RECIPIENT.hex().upper(), "k"), RECIPIENT)
        for bad in ("", "00" * 32, "zz" * 32, "04" + RECIPIENT.hex()):
            with self.assertRaises(Exception):
                gift.xonly(bad, "k")


@unittest.skipUnless(PGURL, "TEST_PGURL not set")
class GiftApi(unittest.TestCase):
    setUpClass = classmethod(base.SocialApi.setUpClass.__func__)
    login = classmethod(base.SocialApi.login.__func__)
    h = base.SocialApi.h

    def setUp(self):
        from api import capsule

        self.capsule = capsule
        capsule.fetch_block_time = lambda height: None
        self.chain = {"tip": 200_000, "txs": {}}
        old_tip, old_tx = gift.fetch_tip, gift.fetch_tx
        gift.fetch_tip = lambda net: self.chain["tip"]
        gift.fetch_tx = lambda net, txid: self.chain["txs"].get(txid)
        gift._tip_cache.update(at=0.0, tip=None)
        os.environ.update(CAPSULE_MIN_LEAD="0", GIFT_NETWORK="signet")

        def undo():
            gift.fetch_tip, gift.fetch_tx = old_tip, old_tx
            gift._tip_cache.update(at=0.0, tip=None)
            os.environ.pop("GIFT_NETWORK", None)

        self.addCleanup(undo)

    def wallet(self, seed):
        w = Wallet(seed)
        self.tokens[w.address] = self.login(w)
        return w

    def gift_body(self, height=None, refund=True, **override):
        height = self.chain["tip"] + 144 if height is None else height
        body = {
            "network": "signet",
            "sats": 100_000,
            "height": height,
            "refund": refund,
            "recipient_key": RECIPIENT.hex(),
            "sender_key": SENDER.hex() if refund else None,
            "bearer": True,
            "address": gift.taproot_address("signet", height, RECIPIENT, SENDER if refund else None, refund),
            "drand_round": 12_345_678,
            "tlock": TLOCK,
        }
        body.update(override)
        return body

    def seal(self, wallet, g, sign_gift=None, **override):
        """Seal a capsule carrying gift g; the wallet signs the gift line for sign_gift (default g)."""
        signed_at = int(time.time())
        ciphertext = base64.b64encode(os.urandom(12 + 16 + 40)).decode()
        half = b64url(os.urandom(32))
        fingerprint = hashlib.sha256(base64.b64decode(ciphertext)).hexdigest()
        open_at = signed_at + 3600
        line_for = sign_gift if sign_gift is not None else g
        message = self.capsule.capsule_message("小满", open_at, fingerprint, None, None, signed_at, line_for)
        body = {"recipient": "小满", "ciphertext": ciphertext, "key": half, "open_at": open_at, "signed_at": signed_at,
                "signature": wallet.sign(message), "gift": g, **override}
        return self.client.post("/v1/capsules", json=body, headers=self.h(wallet)), half

    def test_rules(self):
        r = self.client.get("/v1/capsules/rules").json()["gift"]
        self.assertEqual((r["network"], r["min_sats"], r["refund_blocks"], r["tip"]), ("signet", 50_000, 262_800, 200_000))
        self.assertEqual(r["tiers"], [50_000, 100_000, 200_000, 300_000, 500_000])
        for off in ("", "mainnet", "bitcoin"):
            os.environ["GIFT_NETWORK"] = off
            self.assertIsNone(self.client.get("/v1/capsules/rules").json()["gift"])

    def test_backup_half_only_from_h(self):
        w = self.wallet(60)
        g = self.gift_body()
        r, half = self.seal(w, g)
        self.assertEqual(r.status_code, 201, r.text)
        c = r.json()
        self.assertEqual(c["key"], None)
        self.assertEqual((c["gift"]["sats"], c["gift"]["height"], c["gift"]["funded"]), (100_000, g["height"], False))
        self.assertIn(gift.gift_line(g), self.client.get(f"/v1/capsules/{c['id']}").json()["signed_message"])
        seen = self.client.get(f"/v1/capsules/{c['id']}/gift").json()
        self.assertEqual((seen["address"], seen["unlocked"], seen["refund_height"]), (g["address"], False, g["height"] + 262_800))
        self.assertNotIn(half, str(seen))
        backup = lambda: self.client.get(f"/v1/capsules/{c['id']}/gift/backup")
        self.assertEqual(backup().status_code, 403)
        self.chain["tip"] = g["height"] - 1
        self.assertEqual(backup().status_code, 403)
        # The capsule's own time passing changes nothing: a gift's half never rides in its view.
        self.sql("update social.capsules set open_at = now() - interval '1 hour' where id = %s;", (c["id"],))
        self.client.get(f"/v1/capsules/{c['id']}")  # no block times here: it opens on the next block
        self.mine(1)
        opened = self.client.get(f"/v1/capsules/{c['id']}").json()
        self.assertEqual((opened["status"], opened["key"]), ("open", None))
        self.chain["tip"] = g["height"]
        r = backup()
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()["half"], r.json()["tip"]), (half, g["height"]))

    def test_release_needs_a_fresh_tip(self):
        w = self.wallet(61)
        g = self.gift_body()
        c = self.seal(w, g)[0].json()
        self.chain["tip"] = g["height"] + 5
        self.client.get("/v1/capsules/rules")  # the cached tip is now past H
        self.chain["tip"] = None  # and then no source answers
        self.assertEqual(self.client.get(f"/v1/capsules/{c['id']}/gift/backup").status_code, 503)
        self.chain["tip"] = g["height"] - 3  # a source that says it's early wins over the cache
        self.assertEqual(self.client.get(f"/v1/capsules/{c['id']}/gift/backup").status_code, 403)

    def test_min_of_two_sources(self):
        old_rpc, old_esp = gift._rpc_tip, gift._esplora_tip
        gift.fetch_tip = REAL_FETCH_TIP
        gift._rpc_tip, gift._esplora_tip = (lambda: 1000), (lambda net: 1200)
        try:
            self.assertEqual(gift.fetch_tip("signet"), 1000)
            gift._rpc_tip = lambda: None
            self.assertEqual(gift.fetch_tip("signet"), 1200)
            gift._esplora_tip = lambda net: None
            self.assertIsNone(gift.fetch_tip("signet"))
        finally:
            gift._rpc_tip, gift._esplora_tip = old_rpc, old_esp

    def test_gift_checks(self):
        w = self.wallet(62)
        tip = self.chain["tip"]
        bad = [
            self.gift_body(address=WITH_REFUND),  # an address for another H
            self.gift_body(height=tip),  # H must be ahead of the tip
            self.gift_body(height=tip - 100),
            self.gift_body(network="testnet"),
            self.gift_body(sats=49_999),
            self.gift_body(sats=50_000_000),
            self.gift_body(sender_key=None),  # a refund needs the sender's key
            self.gift_body(sender_key=RECIPIENT.hex()),
            self.gift_body(recipient_key="00" * 32),
            self.gift_body(tlock="not age"),
        ]
        for g in bad:
            r = self.seal(w, g)[0]
            self.assertEqual(r.status_code, 400, (g, r.text))
        # The sender's signature must cover the gift line: one signed without it doesn't seal.
        g = self.gift_body()
        self.assertEqual(self.seal(w, g, sign_gift={})[0].status_code, 401)
        # The address is rebuilt from the keys and H: claiming the refund-less one with refund on fails.
        self.assertEqual(self.seal(w, self.gift_body(address=gift.taproot_address("signet", tip + 144, RECIPIENT, None, False)))[0].status_code, 400)
        self.chain["tip"] = None
        gift._tip_cache.update(at=0.0, tip=None)
        self.assertEqual(self.seal(w, self.gift_body(height=tip + 144))[0].status_code, 503)
        self.chain["tip"] = tip
        os.environ["GIFT_NETWORK"] = "mainnet"
        self.assertEqual(self.seal(w, self.gift_body())[0].status_code, 403)
        os.environ["GIFT_NETWORK"] = "signet"
        ok = self.seal(w, self.gift_body(refund=False))[0]
        self.assertEqual(ok.status_code, 201, ok.text)
        self.assertEqual(self.sql("select count(*) from social.capsule_gifts g join social.capsules c on c.id = g.capsule_id where c.author = %s;", (w.address,))[0][0], 1)

    def test_first_letter_may_carry_a_gift(self):
        # With billing on and a gift network, letters are inscribed (api/capsule.py onchain()), and
        # the 首封 has no service fee, gift or not; it is still one per wallet group.
        os.environ.update(BILLING_PRICE_CAPSULE_SATS="2000", PLATFORM_LIGHTNING_ADDRESS="pay@unimap.test")
        self.addCleanup(lambda: [os.environ.pop(k, None) for k in ("BILLING_PRICE_CAPSULE_SATS", "PLATFORM_LIGHTNING_ADDRESS")])
        w = self.wallet(63)
        r = self.seal(w, self.gift_body(), tier="free")[0]
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual((r.json()["tier"], r.json()["status"], r.json()["onchain"], r.json()["chain"]), ("free", "sealed", True, None))
        self.assertEqual(self.seal(w, self.gift_body(), tier="free")[0].status_code, 409)

    def test_funding_txids(self):
        w = self.wallet(64)
        g = self.gift_body()
        c = self.seal(w, g)[0].json()
        commit, reveal = "a" * 64, "b" * 64
        post = lambda who, body: self.client.post(f"/v1/capsules/{c['id']}/gift/txs", json=body, headers=self.h(who))
        self.assertEqual(post(BOB, {"commit_txid": commit, "reveal_txid": reveal}).status_code, 404)
        self.assertEqual(post(w, {"commit_txid": "xyz", "reveal_txid": reveal}).status_code, 422)
        # The explorer can't see it yet: kept, not verified.
        r = post(w, {"commit_txid": commit, "reveal_txid": reveal})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()["funded"], r.json()["verified"], r.json()["inscription_id"]), (True, False, f"{reveal}i0"))
        # A reveal that pays somewhere else is turned away.
        self.chain["txs"]["c" * 64] = {"vin": [{"txid": commit}], "vout": [{"scriptpubkey_address": NO_REFUND, "value": 100_000}]}
        self.assertEqual(post(w, {"commit_txid": commit, "reveal_txid": "c" * 64}).status_code, 400)
        self.chain["txs"]["d" * 64] = {"vin": [{"txid": commit}], "vout": [{"scriptpubkey_address": g["address"], "value": 99_999}]}
        self.assertEqual(post(w, {"commit_txid": commit, "reveal_txid": "d" * 64}).status_code, 400)
        self.chain["txs"][reveal] = {"vin": [{"txid": commit}], "vout": [{"scriptpubkey_address": g["address"], "value": 100_000}]}
        r = post(w, {"commit_txid": commit, "reveal_txid": reveal})
        self.assertEqual(r.json()["verified"], True)
        self.assertEqual(post(w, {"commit_txid": commit, "reveal_txid": "e" * 64}).status_code, 409)  # verified: settled
        self.assertEqual(self.client.get(f"/v1/capsules/{c['id']}").json()["gift"]["funded"], True)

    def sql(self, query, args=()):
        with self.conn.cursor() as cur:
            cur.execute(query, args)
            return cur.fetchall() if cur.description else None

    def mine(self, n=1):
        start = self.sql("select max(block_height) from bitmap_block_hashes;")[0][0] + 1
        for i in range(n):
            self.sql("insert into bitmap_block_hashes (block_height, block_hash) values (%s, %s);", (start + i, f"g{start + i}"))


class Prices(unittest.TestCase):
    """api/prices.py: mainnet's BTC/USD and fee rate, cached, and nothing at all when it can't be had."""

    def test_cache_and_failure(self):
        from api import prices

        calls = []
        old = prices.fetch
        self.addCleanup(lambda: (setattr(prices, "fetch", old), prices._cache.update(at=0.0, tried=0.0, value=None), os.environ.update(PRICE_URL="off")))
        prices._cache.update(at=0.0, tried=0.0, value=None)
        os.environ["PRICE_URL"] = "https://prices.test/api"
        prices.fetch = lambda url: calls.append(url) or None
        self.assertIsNone(prices.usd())  # no price ever: none
        self.assertIsNone(prices.usd())  # and not asked again within a minute
        self.assertEqual(calls, ["https://prices.test/api"])
        prices._cache["tried"] = 0.0
        prices.fetch = lambda url: calls.append(url) or {"btc_usd": 65_000.0, "fee_rate": 4}
        got = prices.usd()
        self.assertEqual((got["btc_usd"], got["fee_rate"]), (65_000.0, 4))
        prices._cache.update(at=0.0, tried=0.0)
        prices.fetch = lambda url: None  # stale and the source is down: the last answer stays
        self.assertEqual(prices.usd()["btc_usd"], 65_000.0)
        os.environ["PRICE_URL"] = "off"
        self.assertIsNone(prices.usd())


TB_ADDRESS = gift.taproot_address("signet", H, RECIPIENT, None, False)  # any signet address will do


@unittest.skipUnless(PGURL, "TEST_PGURL not set")
class LetterApi(unittest.TestCase):
    """上链的信: with 封存 selling and a gift network, every letter is inscribed (api/capsule.py onchain())."""

    setUpClass = classmethod(base.SocialApi.setUpClass.__func__)
    login = classmethod(base.SocialApi.login.__func__)
    h = base.SocialApi.h
    wallet, sql, mine = GiftApi.wallet, GiftApi.sql, GiftApi.mine

    def setUp(self):
        GiftApi.setUp(self)
        from api import tips

        class Fake:
            paid, made = set(), []

            @staticmethod
            def ask_invoice(address, sats, comment):
                Fake.made.append((address, sats, comment))
                return f"lnbc{sats * 10}n1letter{len(Fake.made)}", f"https://wallet.test/l/{len(Fake.made)}"

            @staticmethod
            def settled(url):
                return url in Fake.paid

        old = tips.lnurl
        tips.lnurl = self.fake = Fake
        os.environ.update(BILLING_PRICE_CAPSULE_SATS="2000", PLATFORM_LIGHTNING_ADDRESS="pay@unimap.test")

        def undo():
            tips.lnurl = old
            for k in ("BILLING_PRICE_CAPSULE_SATS", "PLATFORM_LIGHTNING_ADDRESS"):
                os.environ.pop(k, None)

        self.addCleanup(undo)

    def letter(self, **override):
        return {"network": "signet", "height": self.chain["tip"] + 144, "drand_round": 12_345_678, "tlock": TLOCK, "address": None, **override}

    def seal(self, wallet, letter, tier="free", photo_bytes=0, open_in=3600, sign_letter=None, **override):
        """Seal a capsule whose letter is inscribed as letter; the wallet signs letter's line (or sign_letter's)."""
        signed_at = int(time.time())
        ciphertext = base64.b64encode(os.urandom(12 + 16 + 40)).decode()
        photo = base64.b64encode(os.urandom(12 + 16 + photo_bytes)).decode() if photo_bytes else None
        half = b64url(os.urandom(32))
        fingerprint = hashlib.sha256(base64.b64decode(ciphertext) + (base64.b64decode(photo) if photo else b"")).hexdigest()
        open_at = signed_at + open_in
        signed = letter if sign_letter is None else sign_letter
        message = self.capsule.capsule_message("小满", open_at, fingerprint, None, None, signed_at, None, signed or None)
        body = {"recipient": "小满", "ciphertext": ciphertext, "key": half, "open_at": open_at, "signed_at": signed_at,
                "signature": wallet.sign(message), "tier": tier, "chain": letter, "photo": photo, **override}
        return self.client.post("/v1/capsules", json=body, headers=self.h(wallet)), half

    def test_rules(self):
        w = self.wallet(70)
        r = self.client.get("/v1/capsules/rules", headers=self.h(w)).json()
        self.assertEqual((r["onchain"], r["free_left"], r["postage_sats"], r["max_chain_photo_bytes"], r["usd"]), (True, True, 546, 50_000, None))
        os.environ.pop("GIFT_NETWORK")
        self.assertFalse(self.client.get("/v1/capsules/rules").json()["onchain"])  # no gift network: as before
        os.environ["GIFT_NETWORK"] = "signet"
        os.environ.pop("BILLING_PRICE_CAPSULE_SATS")
        self.assertFalse(self.client.get("/v1/capsules/rules").json()["onchain"])  # billing off: tier open

    def test_first_letter(self):
        w = self.wallet(71)
        # No centralized letter, free or paid: it is inscribed, or it is a gift's.
        self.assertEqual(self.seal(w, None)[0].status_code, 400)
        self.assertEqual(self.seal(w, None, tier="paid")[0].status_code, 400)
        # Text only and the default envelope, but any time up to a hundred years.
        self.assertEqual(self.seal(w, self.letter(), photo_bytes=1000)[0].status_code, 403)
        self.assertEqual(self.seal(w, self.letter(), style="dusk")[0].status_code, 403)
        # The signature covers the letter's line.
        self.assertEqual(self.seal(w, self.letter(), sign_letter={})[0].status_code, 401)
        # Its facts are checked as a gift's are.
        for bad in (self.letter(network="testnet"), self.letter(height=self.chain["tip"]), self.letter(tlock="nope"),
                    self.letter(address="bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"), self.letter(address="not an address")):
            self.assertEqual(self.seal(w, bad)[0].status_code, 400, bad)
        r, half = self.seal(w, self.letter(address=TB_ADDRESS.upper()), open_in=30 * 365 * 86400)
        self.assertEqual(r.status_code, 201, r.text)
        c = r.json()
        self.assertEqual((c["tier"], c["status"], c["onchain"], c["key"], c["half"], c["gift"]), ("free", "sealed", True, None, None, None))
        self.assertEqual((c["chain"]["address"], c["chain"]["sats"], c["chain"]["inscribed"], c["chain"]["tlock"]), (TB_ADDRESS, 546, False, TLOCK))
        self.assertIn(gift.letter_line(self.letter()), self.client.get(f"/v1/capsules/{c['id']}").json()["signed_message"])
        self.assertFalse("payment" in c)  # no service fee
        # One per wallet group.
        self.assertEqual(self.seal(w, self.letter())[0].status_code, 409)
        self.assertFalse(self.client.get("/v1/capsules/rules", headers=self.h(w)).json()["free_left"])
        # Without a gift network nothing is inscribed: the old tiers, and chain is refused.
        os.environ.pop("GIFT_NETWORK")
        self.assertEqual(self.seal(self.wallet(72), self.letter())[0].status_code, 403)
        os.environ["GIFT_NETWORK"] = "signet"

    def test_half_comes_out_when_it_opens(self):
        w = self.wallet(73)
        r, half = self.seal(w, self.letter())
        c = r.json()
        self.sql("update social.capsules set open_at = now() - interval '1 hour' where id = %s;", (c["id"],))
        self.client.get(f"/v1/capsules/{c['id']}")  # no block times here: it opens on the next block
        self.mine(1)
        opened = self.client.get(f"/v1/capsules/{c['id']}").json()
        self.assertEqual((opened["status"], opened["key"], opened["half"]), ("open", None, half))
        self.assertEqual(self.sql("select notified_at from social.capsules where id = %s;", (c["id"],))[0][0], None)  # a 首封 isn't told

    def test_paid_letter(self):
        w = self.wallet(74)
        self.seal(w, self.letter())  # the first letter, used
        self.assertEqual(self.seal(w, self.letter(), tier="paid", photo_bytes=50_001)[0].status_code, 400)  # 50 KB at most
        r = self.seal(w, self.letter(), tier="paid", photo_bytes=50_000, style="celadon", open_in=80 * 365 * 86400)[0]
        self.assertEqual(r.status_code, 201, r.text)
        c = r.json()
        self.assertEqual((c["status"], c["tier"], c["has_photo"], c["onchain"], c["payment"]["amount_sats"]), ("pending", "paid", True, True, 2000))
        txs = lambda: self.client.post(f"/v1/capsules/{c['id']}/chain/txs", json={"commit_txid": "a" * 64, "reveal_txid": "b" * 64}, headers=self.h(w))
        self.assertEqual(txs().status_code, 402)  # the service fee comes first
        self.fake.paid.add(f"https://wallet.test/l/{len(self.fake.made)}")
        self.assertEqual(self.client.get(f"/v1/billing/payments/{c['payment']['id']}", headers=self.h(w)).json()["status"], "settled")
        self.assertEqual(self.client.get(f"/v1/capsules/{c['id']}").json()["status"], "sealed")
        self.assertEqual(self.client.post(f"/v1/capsules/{c['id']}/chain/txs", json={"commit_txid": "a" * 64, "reveal_txid": "b" * 64}, headers=self.h(BOB)).status_code, 404)
        # The explorer can't see it yet: kept, not verified. One with no output is turned away; any address will do without one.
        r = txs()
        self.assertEqual((r.status_code, r.json()["inscribed"], r.json()["verified"], r.json()["inscription_id"]), (200, True, False, "b" * 64 + "i0"))
        self.chain["txs"]["c" * 64] = {"vin": [{"txid": "a" * 64}], "vout": [{"scriptpubkey_address": TB_ADDRESS, "value": 545}]}
        self.assertEqual(self.client.post(f"/v1/capsules/{c['id']}/chain/txs", json={"commit_txid": "a" * 64, "reveal_txid": "c" * 64}, headers=self.h(w)).status_code, 400)
        self.chain["txs"]["b" * 64] = {"vin": [{"txid": "a" * 64}], "vout": [{"scriptpubkey_address": TB_ADDRESS, "value": 546}]}
        self.assertEqual(txs().json()["verified"], True)
        self.assertEqual(self.client.post(f"/v1/capsules/{c['id']}/chain/txs", json={"commit_txid": "a" * 64, "reveal_txid": "d" * 64}, headers=self.h(w)).status_code, 409)

    def test_letter_to_an_address_must_pay_it(self):
        w = self.wallet(75)
        c = self.seal(w, self.letter(address=TB_ADDRESS))[0].json()
        other = gift.taproot_address("signet", H + 1, RECIPIENT, None, False)
        self.chain["txs"]["e" * 64] = {"vin": [{"txid": "a" * 64}], "vout": [{"scriptpubkey_address": other, "value": 546}]}
        r = self.client.post(f"/v1/capsules/{c['id']}/chain/txs", json={"commit_txid": "a" * 64, "reveal_txid": "e" * 64}, headers=self.h(w))
        self.assertEqual(r.status_code, 400)
