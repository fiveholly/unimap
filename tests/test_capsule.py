"""时间胶囊 and 私信 against a real Postgres (TEST_PGURL, as in test_social.py; its tables are dropped
and recreated)."""

import base64
import hashlib
import os
import time
import unittest

from tests import test_social as base
from tests.test_social import ALICE, BOB, CAROL, PGURL


def b64url(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


@unittest.skipUnless(PGURL, "TEST_PGURL not set")
class CapsuleApi(unittest.TestCase):
    setUpClass = classmethod(base.SocialApi.setUpClass.__func__)
    login = classmethod(base.SocialApi.login.__func__)
    h = base.SocialApi.h

    def setUp(self):
        from api import capsule

        self.capsule = capsule
        capsule.fetch_block_time = lambda height: None  # no bitcoind here; tests put times in social.block_times
        os.environ["CAPSULE_MIN_LEAD"] = "0"

    def sql(self, query, args=()):
        with self.conn.cursor() as cur:
            cur.execute(query, args)
            return cur.fetchall() if cur.description else None

    def tip(self):
        return self.sql("select max(block_height) from bitmap_block_hashes;")[0][0]

    def mine(self, n=1, times=None):
        """Index n more blocks, with header times if given."""
        start = self.tip() + 1
        for i in range(n):
            self.sql("insert into bitmap_block_hashes (block_height, block_hash) values (%s, %s);", (start + i, f"h{start + i}"))
            if times:
                self.sql("insert into social.block_times (block_height, block_time) values (%s, %s);", (start + i, times[i]))
        return list(range(start, start + n))

    def seal(self, wallet=ALICE, open_in=3600, line=None, tag=None, recipient="18 岁的小满", tamper=False, **override):
        signed_at = int(time.time())
        ciphertext = base64.b64encode(os.urandom(12 + 16 + 40)).decode()
        key = b64url(os.urandom(32))
        fingerprint = hashlib.sha256(base64.b64decode(ciphertext)).hexdigest()
        open_at = signed_at + open_in
        message = self.capsule.capsule_message(recipient, open_at, fingerprint, line, tag, signed_at)
        body = {
            "recipient": recipient,
            "ciphertext": ciphertext,
            "key": key,
            "open_at": open_at,
            "line": line,
            "tag": tag,
            "signed_at": signed_at,
            "signature": wallet.sign(message),
            **override,
        }
        if tamper:
            body["ciphertext"] = base64.b64encode(os.urandom(68)).decode()
        r = self.client.post("/v1/capsules", json=body, headers=self.h(wallet))
        return r, key, fingerprint

    def open_at(self, capsule_id, unix):
        self.sql("update social.capsules set open_at = to_timestamp(%s) where id = %s;", (unix, capsule_id))

    # --- sealing ---

    def test_seal_checks(self):
        os.environ["CAPSULE_MIN_LEAD"] = "86400"
        self.assertEqual(self.seal(open_in=3600)[0].status_code, 400)  # a day ahead at least
        r, key, fingerprint = self.seal(open_in=2 * 86400)
        self.assertEqual(r.status_code, 201, r.text)
        os.environ["CAPSULE_MIN_LEAD"] = "0"
        self.assertEqual(self.seal(tamper=True)[0].status_code, 401)  # the signature names the ciphertext's hash
        self.assertEqual(self.seal(tag="birth")[0].status_code, 400)  # a tag goes with a public line
        self.assertEqual(self.seal(line="hi", tag="party")[0].status_code, 400)
        self.assertEqual(self.seal(key="short")[0].status_code, 400)
        self.assertEqual(self.seal(recipient="a\nb")[0].status_code, 400)
        self.assertEqual(self.client.post("/v1/capsules", json={}).status_code, 401)
        self.assertEqual(self.client.get("/v1/capsules/rules").json()["min_lead_seconds"], 0)

    def test_sealed_capsule_keeps_its_key(self):
        r, key, fingerprint = self.seal(open_in=3600)
        self.assertEqual(r.status_code, 201, r.text)
        c = r.json()
        self.assertEqual((c["status"], c["key"], c["fingerprint"], c["sealed_height"]), ("sealed", None, fingerprint, self.tip()))
        self.assertTrue(c["mine"])
        self.assertIn(f"sha256: {fingerprint}", c["signed_message"])
        self.assertIn(c["blocks_left"], (6, 7))
        seen = self.client.get(f"/v1/capsules/{c['id']}").json()
        self.assertEqual((seen["status"], seen["key"], seen["mine"]), ("sealed", None, False))
        self.assertEqual(self.client.get("/v1/capsules/nope").status_code, 404)
        mine = self.client.get("/v1/capsules/mine", headers=self.h(ALICE)).json()["capsules"]
        self.assertIn(c["id"], [x["id"] for x in mine])
        self.assertNotIn("ciphertext", mine[0])
        self.assertNotIn(c["id"], [x["id"] for x in self.client.get("/v1/capsules/mine", headers=self.h(BOB)).json()["capsules"]])

    def test_opens_at_first_block_past_open_at(self):
        r, key, _ = self.seal(open_in=60)
        c = r.json()
        now = int(time.time())
        # Header times run a little out of order: the third block is the first at or past open_at.
        heights = self.mine(5, times=[now - 500, now - 400, now - 90, now - 300, now - 50])
        self.open_at(c["id"], now - 200)
        seen = self.client.get(f"/v1/capsules/{c['id']}").json()
        self.assertEqual((seen["status"], seen["open_height"], seen["key"], seen["blocks_left"]), ("open", heights[2], key, None))
        # Settled once found.
        self.sql("update social.block_times set block_time = 0 where block_height = %s;", (heights[2],))
        self.assertEqual(self.client.get(f"/v1/capsules/{c['id']}").json()["open_height"], heights[2])

    def test_waits_for_a_block_past_open_at(self):
        r, key, _ = self.seal(open_in=60)
        c = r.json()
        now = int(time.time())
        self.mine(1, times=[now - 100])
        self.open_at(c["id"], now - 50)  # open_at has passed, but no block since
        self.assertEqual(self.client.get(f"/v1/capsules/{c['id']}").json()["status"], "sealed")
        [h] = self.mine(1, times=[now])
        seen = self.client.get(f"/v1/capsules/{c['id']}").json()
        self.assertEqual((seen["status"], seen["open_height"], seen["key"]), ("open", h, key))

    def test_opens_on_the_next_block_without_block_times(self):
        self.mine(1)  # a tip with no header time: there is no bitcoind to ask
        r, key, _ = self.seal(open_in=60)
        c = r.json()
        self.open_at(c["id"], int(time.time()) - 10)
        due = self.tip()
        self.assertEqual(self.client.get(f"/v1/capsules/{c['id']}").json()["status"], "sealed")
        self.assertEqual(self.sql("select due_tip from social.capsules where id = %s;", (c["id"],))[0][0], due)
        self.mine(1)
        seen = self.client.get(f"/v1/capsules/{c['id']}").json()
        self.assertEqual((seen["status"], seen["open_height"], seen["key"]), ("open", due + 1, key))

    def test_first_block_at(self):
        times = {10: 100, 11: 200, 12: 290, 13: 280, 14: 400, 15: 500}

        def fake(height):
            return times.get(height)

        from api.db import cursor

        self.capsule.fetch_block_time = fake
        self.sql("delete from social.block_times where block_height between 10 and 15;")
        with cursor() as cur:
            self.assertEqual(self.capsule.first_block_at(cur, 285, 10, 15), 12)
            self.assertEqual(self.capsule.first_block_at(cur, 300, 10, 15), 14)
            self.assertIsNone(self.capsule.first_block_at(cur, 600, 10, 15))
            self.assertEqual(self.capsule.first_block_at(cur, 50, 10, 15), 10)
            cur.connection.rollback()

    # --- 同块人 ---

    def test_peers(self):
        height = self.mine(1)[0]
        a = self.seal(ALICE, line="女儿出生。", tag="birth")[0].json()
        b = self.seal(BOB, line="今天离职，开始做自己的事。", tag="start")[0].json()
        self.seal(CAROL)  # not public: counted on the block, never listed
        self.mine(3)
        c = self.seal(CAROL, line="三块之后")[0].json()
        r = self.client.get(f"/v1/capsules/peers/{height}", headers=self.h(BOB)).json()
        self.assertEqual(r["counts"]["block"], 2)
        self.assertEqual(r["counts"]["hour"], 3)
        self.assertGreaterEqual(r["counts"]["day"], 3)
        self.assertEqual((r["sealed_here"], r["births_here"]), (3, 1))
        self.assertEqual([p["line"] for p in r["peers"]], ["今天离职，开始做自己的事。", "女儿出生。"])  # yours first
        me, other = r["peers"]
        self.assertEqual((me["mine"], me["capsule_id"], other["mine"]), (True, b["id"], False))
        self.assertNotIn("capsule_id", other)
        text = str(r)
        self.assertNotIn(a["id"], text)
        self.assertNotIn("小满", text)
        hour = self.client.get(f"/v1/capsules/peers/{height}?scope=hour").json()
        self.assertIn("三块之后", [p["line"] for p in hour["peers"]])
        self.assertEqual(self.client.get(f"/v1/capsules/peers/{height}?scope=year").status_code, 400)
        self.assertEqual(self.client.get(f"/v1/capsules/peers/{self.tip() + 5}").status_code, 404)
        # Report someone's line; take your own down.
        ref = other["ref"]
        self.assertEqual(self.client.post(f"/v1/capsules/lines/{ref}/report", json={"reason": "spam"}, headers=self.h(BOB)).status_code, 200)
        self.assertEqual(self.client.post(f"/v1/capsules/lines/{ref}/report", json={"reason": "spam"}, headers=self.h(ALICE)).status_code, 400)
        self.assertEqual(self.client.delete(f"/v1/capsules/{b['id']}/line", headers=self.h(ALICE)).status_code, 404)
        self.assertEqual(self.client.delete(f"/v1/capsules/{b['id']}/line", headers=self.h(BOB)).status_code, 200)
        r = self.client.get(f"/v1/capsules/peers/{height}").json()
        self.assertEqual([p["line"] for p in r["peers"]], ["女儿出生。"])
        self.assertEqual(self.client.get(f"/v1/capsules/{c['id']}").json()["line"], "三块之后")

    # --- 私信 ---

    def test_dms(self):
        r = self.client.post(f"/v1/dms/{BOB.address}", json={"body": "恭喜！明年这一天来这块报个到？"}, headers=self.h(ALICE))
        self.assertEqual(r.status_code, 201, r.text)
        self.client.post(f"/v1/dms/{BOB.address}", json={"body": "还有一句"}, headers=self.h(ALICE))
        self.assertEqual(self.client.post(f"/v1/dms/{ALICE.address}", json={"body": "me"}, headers=self.h(ALICE)).status_code, 400)
        self.assertEqual(self.client.post("/v1/dms/notanaddress", json={"body": "x"}, headers=self.h(ALICE)).status_code, 400)
        convos = self.client.get("/v1/dms", headers=self.h(BOB)).json()
        mine = [c for c in convos["conversations"] if c["peer"] == ALICE.address][0]
        self.assertEqual((mine["unread"], mine["last"]["body"], mine["last"]["from_me"]), (2, "还有一句", False))
        # Two messages, one notification until it's read.
        notes = [n for n in self.client.get("/v1/notifications", headers=self.h(BOB)).json()["notifications"] if n["kind"] == "dm" and n["actor"] == ALICE.address]
        self.assertEqual([(n["actor"], n["snippet"]) for n in notes], [(ALICE.address, "恭喜！明年这一天来这块报个到？")])
        t = self.client.get(f"/v1/dms/{ALICE.address}", headers=self.h(BOB)).json()
        self.assertEqual([m["body"] for m in t["messages"]], ["恭喜！明年这一天来这块报个到？", "还有一句"])
        self.assertTrue(t["can_send"])
        convos = self.client.get("/v1/dms", headers=self.h(BOB)).json()["conversations"]
        self.assertEqual([c["unread"] for c in convos if c["peer"] == ALICE.address], [0])
        self.assertTrue(all(m["read"] for m in self.client.get(f"/v1/dms/{BOB.address}", headers=self.h(ALICE)).json()["messages"]))

    def test_dm_strangers_block_and_report(self):
        self.assertEqual(self.client.put("/v1/me/dm-settings", json={"strangers": False}, headers=self.h(CAROL)).status_code, 200)
        self.assertFalse(self.client.get("/v1/me/dm-settings", headers=self.h(CAROL)).json()["strangers"])
        self.assertEqual(self.client.post(f"/v1/dms/{CAROL.address}", json={"body": "hi"}, headers=self.h(BOB)).status_code, 403)
        self.assertEqual(self.client.get(f"/v1/dms/{CAROL.address}", headers=self.h(BOB)).json()["why_not"], "strangers_off")
        # Someone Carol wrote to can write back.
        self.assertEqual(self.client.post(f"/v1/dms/{BOB.address}", json={"body": "hello bob"}, headers=self.h(CAROL)).status_code, 201)
        r = self.client.post(f"/v1/dms/{CAROL.address}", json={"body": "buy my airdrop"}, headers=self.h(BOB))
        self.assertEqual(r.status_code, 201, r.text)
        msg = r.json()["id"]
        # Muting (api/notify.py) blocks messages too.
        self.assertEqual(self.client.put(f"/v1/me/mutes/{BOB.address}", headers=self.h(CAROL)).status_code, 200)
        self.assertEqual(self.client.post(f"/v1/dms/{CAROL.address}", json={"body": "again"}, headers=self.h(BOB)).status_code, 403)
        self.assertTrue(self.client.get(f"/v1/dms/{BOB.address}", headers=self.h(CAROL)).json()["blocked_by_me"])
        self.client.delete(f"/v1/me/mutes/{BOB.address}", headers=self.h(CAROL))
        # Only the recipient reports; an admin then removes it.
        self.assertEqual(self.client.post(f"/v1/dms/messages/{msg}/report", json={"reason": "scam"}, headers=self.h(BOB)).status_code, 404)
        self.assertEqual(self.client.post(f"/v1/dms/messages/{msg}/report", json={"reason": "scam"}, headers=self.h(CAROL)).status_code, 200)
        os.environ["ADMIN_ADDRESSES"] = ALICE.address
        try:
            reports = self.client.get("/v1/admin/item-reports", headers=self.h(ALICE)).json()["reports"]
            self.assertIn(("dm", str(msg), "buy my airdrop"), [(x["kind"], x["item_id"], x["text"]) for x in reports])
            r = self.client.post(f"/v1/admin/item-reports/dm/{msg}", json={"action": "remove"}, headers=self.h(ALICE))
            self.assertEqual(r.status_code, 200, r.text)
        finally:
            os.environ.pop("ADMIN_ADDRESSES")
        last = self.client.get(f"/v1/dms/{BOB.address}", headers=self.h(CAROL)).json()["messages"][-1]
        self.assertEqual((last["removed"], last["body"]), (True, None))
        self.client.put("/v1/me/dm-settings", json={"strangers": True}, headers=self.h(CAROL))
