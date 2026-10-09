"""Social API against a real Postgres. Set TEST_PGURL to an empty, throwaway
database (its tables are dropped and recreated), e.g.
TEST_PGURL=postgresql://postgres:postgres@localhost/unimap_test"""

import base64
import os
import time
import unittest
import urllib.parse

from coincurve import PrivateKey

from api import bip322
from tests.test_bip322 import bech32_address

PGURL = os.getenv("TEST_PGURL")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The OPI bitmap_index tables the API reads (subset of OPI's db_init.sql).
OPI_TABLES = """
CREATE TABLE public.bitmap_block_hashes (id bigserial PRIMARY KEY, block_height int4 NOT NULL UNIQUE, block_hash text NOT NULL);
CREATE TABLE public.bitmaps (id bigserial PRIMARY KEY, inscription_id text NOT NULL, inscription_number int4 NOT NULL,
  bitmap_number int4 NOT NULL UNIQUE, block_height int4 NOT NULL);
"""


class Wallet:
    def __init__(self, seed):
        self.key = PrivateKey(bytes([seed]) * 32)
        h = bip322.hash160(self.key.public_key.format(compressed=True))
        self.address = bech32_address("bcrt", 0, h)

    def sign(self, message):
        sig = self.key.sign_recoverable(bip322.legacy_message_hash(message.encode()), hasher=None)
        return base64.b64encode(bytes([39 + sig[64]]) + sig[:64]).decode()


ALICE, BOB, CAROL = Wallet(1), Wallet(2), Wallet(3)
DISTRICT, OTHER = 100, 105


@unittest.skipUnless(PGURL, "TEST_PGURL not set")
class SocialApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg2

        u = urllib.parse.urlparse(PGURL)
        os.environ.update(
            DB_HOST=u.hostname or "localhost",
            DB_PORT=str(u.port or 5432),
            DB_DATABASE=u.path.lstrip("/"),
            DB_USER=u.username or "postgres",
            DB_PASSWD=u.password or "",
        )
        cls.conn = psycopg2.connect(PGURL)
        cls.conn.autocommit = True
        with cls.conn.cursor() as cur:
            cur.execute("drop schema if exists social cascade; drop schema public cascade; create schema public;")
            cur.execute(OPI_TABLES)
            for path in ("parcel_index/db_init.sql", "api/social.sql"):
                with open(os.path.join(ROOT, path)) as f:
                    cur.execute(f.read())
            cur.execute(
                "insert into bitmaps (inscription_id, inscription_number, bitmap_number, block_height) values "
                "('d100i0', 1, 100, 200), ('d105i0', 2, 105, 201), ('d999i0', 3, 999, 1000);"
                "insert into parcels (inscription_id, inscription_number, tx_index, bitmap_number, "
                "district_inscription_id, block_height) values ('p1i0', 4, 1, 100, 'd100i0', 202);"
                "insert into inscription_owners (inscription_id, created_height, outpoint, address, updated_height) values "
                f"('d100i0', 200, 'a:0', '{ALICE.address}', 200), ('d105i0', 201, 'b:0', '{CAROL.address}', 201), "
                f"('d999i0', 1000, 'c:0', 'bcrt1qsomeoneelse', 1000), ('p1i0', 202, 'd:0', '{BOB.address}', 202);"
                "insert into land_events (block_height, block_time, kind, inscription_id, bitmap_number, to_address) "
                f"values (200, {int(time.time()) - 3600}, 'district_claimed', 'd100i0', 100, '{ALICE.address}');"
            )
        from fastapi.testclient import TestClient

        from api import social
        from api.app import app

        cls.social = social
        social.POSTS_PER_MINUTE = 1000  # test_rate_limit lowers it
        cls.client = TestClient(app)
        cls.tokens = {w.address: cls.login(w) for w in (ALICE, BOB, CAROL)}

    @classmethod
    def login(cls, wallet):
        r = cls.client.post("/v1/auth/nonce", json={"address": wallet.address})
        assert r.status_code == 200, r.text
        n = r.json()
        r = cls.client.post(
            "/v1/auth/login", json={"address": wallet.address, "nonce": n["nonce"], "signature": wallet.sign(n["message"])}
        )
        assert r.status_code == 200, r.text
        return r.json()["token"]

    def h(self, wallet):
        return {"Authorization": f"Bearer {self.tokens[wallet.address]}"}

    def post(self, wallet, body, district=DISTRICT, reply_to=None, as_bitmap=None, tamper=False, media=()):
        from api.social import post_message

        signed_at = int(time.time())
        message = post_message(district, reply_to, as_bitmap, signed_at, list(media), body)
        payload = {
            "body": body + ("!" if tamper else ""),
            "media": list(media),
            "reply_to": reply_to,
            "as_bitmap": as_bitmap,
            "signed_at": signed_at,
            "signature": wallet.sign(message),
        }
        return self.client.post(f"/v1/districts/{district}/posts", json=payload, headers=self.h(wallet))

    # --- auth ---

    def test_login_rejects_reuse_and_bad_signatures(self):
        n = self.client.post("/v1/auth/nonce", json={"address": ALICE.address}).json()
        bad = self.client.post(
            "/v1/auth/login", json={"address": ALICE.address, "nonce": n["nonce"], "signature": BOB.sign(n["message"])}
        )
        self.assertEqual(bad.status_code, 401)
        # The nonce is spent even by a failed attempt.
        again = self.client.post(
            "/v1/auth/login", json={"address": ALICE.address, "nonce": n["nonce"], "signature": ALICE.sign(n["message"])}
        )
        self.assertEqual(again.status_code, 401)
        self.assertEqual(self.client.get("/v1/me").status_code, 401)
        me = self.client.get("/v1/me", headers=self.h(BOB)).json()
        self.assertEqual(me["parcels"], [{"bitmap_number": 100, "tx_index": 1}])

    # --- posting rules ---

    def test_roles(self):
        owner = self.post(ALICE, "welcome to 100")
        self.assertEqual(owner.status_code, 201, owner.text)
        self.assertEqual(owner.json()["author"]["role"], "owner")
        resident = self.post(BOB, "resident here")
        self.assertEqual(resident.status_code, 201, resident.text)
        self.assertEqual((resident.json()["author"]["role"], resident.json()["author"]["parcel"]), ("resident", 1))
        self.assertEqual(self.post(CAROL, "visitor top-level").status_code, 403)
        reply = self.post(CAROL, "nice block", reply_to=owner.json()["id"])
        self.assertEqual(reply.status_code, 201, reply.text)
        self.assertEqual(reply.json()["author"]["role"], "visitor")
        replies = self.client.get(f"/v1/posts/{owner.json()['id']}/replies").json()["replies"]
        self.assertEqual([r["body"] for r in replies], ["nice block"])
        self.assertEqual(self.post(CAROL, "reply to a reply", reply_to=reply.json()["id"]).status_code, 400)

    def test_signature_must_match_post(self):
        self.assertEqual(self.post(ALICE, "hello", tamper=True).status_code, 401)
        r = self.post(ALICE, "with a picture", media=["https://img.example/a.png"])
        self.assertEqual(r.status_code, 201, r.text)
        self.assertIn("media: https://img.example/a.png", r.json()["signed_message"])

    def test_post_as_district(self):
        self.assertEqual(self.post(CAROL, "as my district", district=DISTRICT, as_bitmap=999).status_code, 403)
        top = self.post(ALICE, "top for as-test").json()["id"]
        r = self.post(CAROL, "as 105", reply_to=top, as_bitmap=OTHER)
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(r.json()["author"]["as_bitmap"], OTHER)

    def test_rate_limit(self):
        self.social.POSTS_PER_MINUTE = 0
        try:
            self.assertEqual(self.post(BOB, "too fast").status_code, 429)
        finally:
            self.social.POSTS_PER_MINUTE = 1000

    # --- moderation ---

    def test_visitor_replies_toggle_and_mute(self):
        top = self.post(ALICE, "top for moderation").json()["id"]
        r = self.client.put(f"/v1/districts/{DISTRICT}/profile", json={"visitor_comments_on": False}, headers=self.h(ALICE))
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.post(CAROL, "can I?", reply_to=top).status_code, 403)
        self.client.put(f"/v1/districts/{DISTRICT}/profile", json={"visitor_comments_on": True}, headers=self.h(ALICE))
        self.assertEqual(self.client.put(f"/v1/districts/{DISTRICT}/profile", json={"bio": "x"}, headers=self.h(BOB)).status_code, 403)

        self.assertEqual(self.client.put(f"/v1/districts/{DISTRICT}/mutes/{CAROL.address}", headers=self.h(ALICE)).status_code, 200)
        self.assertEqual(self.post(CAROL, "muted?", reply_to=top).status_code, 403)
        self.assertEqual(self.client.put(f"/v1/districts/{DISTRICT}/mutes/{ALICE.address}", headers=self.h(BOB)).status_code, 403)
        self.client.delete(f"/v1/districts/{DISTRICT}/mutes/{CAROL.address}", headers=self.h(ALICE))
        self.assertEqual(self.post(CAROL, "back", reply_to=top).status_code, 201)

    def test_remove_and_pin(self):
        bob_post = self.post(BOB, "remove me").json()["id"]
        alice_post = self.post(ALICE, "pin me").json()["id"]
        self.assertEqual(self.client.delete(f"/v1/posts/{alice_post}", headers=self.h(BOB)).status_code, 403)
        self.assertEqual(self.client.delete(f"/v1/posts/{bob_post}", headers=self.h(ALICE)).status_code, 200)
        removed = self.client.get(f"/v1/posts/{bob_post}").json()
        self.assertTrue(removed["removed"])
        self.assertIsNone(removed["body"])
        self.assertEqual(
            self.client.put(f"/v1/districts/{DISTRICT}/pin", json={"post_id": alice_post}, headers=self.h(ALICE)).status_code, 200
        )
        page = self.client.get(f"/v1/districts/{DISTRICT}", headers=self.h(CAROL)).json()
        self.assertEqual(page["pinned_post"]["id"], alice_post)
        self.assertEqual(page["owner"], ALICE.address)
        self.assertEqual(page["viewer"]["role"], "visitor")
        ids = [p["id"] for p in self.client.get(f"/v1/districts/{DISTRICT}/posts").json()["posts"]]
        self.assertIn(alice_post, ids)
        self.assertNotIn(bob_post, ids)

    # --- follows, likes, feed, neighbors ---

    def test_follow_like_feed_neighbors(self):
        pid = self.post(ALICE, "feed me").json()["id"]
        self.assertEqual(self.client.put(f"/v1/districts/{DISTRICT}/follow", headers=self.h(CAROL)).status_code, 200)
        for _ in range(2):  # idempotent
            self.assertEqual(self.client.put(f"/v1/posts/{pid}/like", headers=self.h(CAROL)).status_code, 200)
        post = self.client.get(f"/v1/posts/{pid}", headers=self.h(CAROL)).json()
        self.assertEqual((post["like_count"], post["liked_by_me"]), (1, True))
        items = self.client.get("/v1/feed", headers=self.h(CAROL)).json()["items"]
        kinds = {i["type"] for i in items}
        self.assertEqual(kinds, {"post", "event"})
        self.assertEqual(items[-1]["event"]["kind"], "district_claimed")
        near = self.client.get(f"/v1/districts/{OTHER}/neighbors").json()["posts"]
        self.assertTrue(near and all(p["bitmap_number"] == DISTRICT for p in near))

    # --- land changes hands ---

    def test_owner_change_moves_admin_rights(self):
        old = self.post(ALICE, "before the sale").json()["id"]
        with self.conn.cursor() as cur:
            cur.execute("update inscription_owners set address = %s where inscription_id = 'd105i0';", (ALICE.address,))
        try:
            self.assertEqual(self.client.put(f"/v1/districts/{OTHER}/profile", json={"bio": "mine now"}, headers=self.h(ALICE)).status_code, 200)
            self.assertEqual(self.client.put(f"/v1/districts/{OTHER}/profile", json={"bio": "no"}, headers=self.h(CAROL)).status_code, 403)
        finally:
            with self.conn.cursor() as cur:
                cur.execute("update inscription_owners set address = %s where inscription_id = 'd105i0';", (CAROL.address,))
        self.assertEqual(self.client.get(f"/v1/posts/{old}").json()["author"]["role"], "owner")


if __name__ == "__main__":
    unittest.main()
