"""Social API against a real Postgres. Set TEST_PGURL to an empty, throwaway
database (its tables are dropped and recreated), e.g.
TEST_PGURL=postgresql://postgres:postgres@localhost/unimap_test"""

import base64
import json
import math
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
                "insert into bitmap_block_hashes (block_height, block_hash) values (1000, 'h1000');"
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

        from api import listings, social
        from api.app import app

        class NoListings:
            market = "magiceden"
            item_url = staticmethod(listings.MagicEden.item_url)

            def listed(self):
                return iter(())

        listings.provider = NoListings()  # map reads refresh listings in the background; keep them offline
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

    # --- prosperity and check-ins ---

    def test_checkin_and_prosperity(self):
        from api import prosperity

        prosperity.RANKING_TTL = 0
        before = self.client.get(f"/v1/districts/{DISTRICT}", headers=self.h(CAROL)).json()
        self.assertFalse(before["checked_in_today"])
        self.assertEqual(before["prosperity"]["parts"]["residents"], 1)
        self.assertEqual(self.client.post(f"/v1/districts/{DISTRICT}/checkin").status_code, 401)
        self.assertEqual(self.client.post(f"/v1/districts/{DISTRICT}/checkin", headers=self.h(CAROL)).status_code, 200)
        self.assertEqual(self.client.post(f"/v1/districts/{DISTRICT}/checkin", headers=self.h(CAROL)).status_code, 409)
        self.assertEqual(self.client.post("/v1/districts/5000/checkin", headers=self.h(CAROL)).status_code, 404)
        after = self.client.get(f"/v1/districts/{DISTRICT}", headers=self.h(CAROL)).json()
        self.assertTrue(after["checked_in_today"])
        self.assertEqual(after["prosperity"]["parts"]["checkins30"], before["prosperity"]["parts"]["checkins30"] + 1)

        # A post counts for its district and, as a neighbour's, for the districts around it.
        near = lambda: self.client.get(f"/v1/districts/{OTHER}").json()["prosperity"]["parts"]["neighbors30"]
        n0 = near()
        self.assertEqual(self.post(ALICE, "busy street").status_code, 201)
        self.assertEqual(near(), n0 + 1)
        p = self.client.get(f"/v1/districts/{DISTRICT}").json()["prosperity"]
        self.assertGreater(p["score"], 0)
        self.assertEqual(p["score"], math.floor(sum(p["parts"][k] * w for k, w in prosperity.WEIGHTS.items()) + 0.5))

        tiles = self.client.get(f"/v1/land?start={DISTRICT}&end={OTHER}").json()["tiles"]
        self.assertEqual(tiles[0]["level"], p["level"])
        self.assertTrue(all(1 <= t["level"] <= 5 for t in tiles))
        self.assertEqual(self.client.get("/v1/districts/0").json()["prosperity"]["level"], 5)  # a landmark
        ranks = self.client.get("/v1/rankings").json()["rankings"]
        self.assertEqual(ranks[0]["bitmap_number"], DISTRICT)
        self.assertEqual(ranks[0]["owner"], ALICE.address)
        self.assertEqual([r["score"] for r in ranks], sorted((r["score"] for r in ranks), reverse=True))

    # --- recruiting, polls, looks, parks ---

    def test_recruit_and_apply(self):
        r = self.client.put(f"/v1/districts/{DISTRICT}/recruit", json={"message": "找邻居", "parcels": [2, 3]}, headers=self.h(ALICE))
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["parcels"], [2, 3])
        bad = self.client.put(f"/v1/districts/{DISTRICT}/recruit", json={"message": "x", "parcels": [1]}, headers=self.h(ALICE))
        self.assertEqual(bad.status_code, 400)  # plot 1 is Bob's
        self.assertEqual(self.client.put(f"/v1/districts/{DISTRICT}/recruit", json={"message": "x"}, headers=self.h(CAROL)).status_code, 403)
        listed = self.client.get("/v1/recruiting").json()["districts"]
        self.assertEqual([d["bitmap_number"] for d in listed], [DISTRICT])
        self.assertEqual(self.client.put(f"/v1/districts/{DISTRICT}/application", json={"note": "hi"}, headers=self.h(BOB)).status_code, 400)
        self.assertEqual(self.client.put(f"/v1/districts/{DISTRICT}/application", json={"note": "我想住 #2"}, headers=self.h(CAROL)).status_code, 200)
        page = self.client.get(f"/v1/districts/{DISTRICT}", headers=self.h(CAROL)).json()
        self.assertEqual((page["recruit"]["applications"], page["recruit"]["applied"]), (1, True))
        self.assertEqual(self.client.get(f"/v1/districts/{DISTRICT}/applications", headers=self.h(CAROL)).status_code, 403)
        apps = self.client.get(f"/v1/districts/{DISTRICT}/applications", headers=self.h(ALICE)).json()["applications"]
        self.assertEqual([(a["address"], a["note"]) for a in apps], [(CAROL.address, "我想住 #2")])
        told = self.client.get("/v1/notifications", headers=self.h(ALICE)).json()["notifications"]
        self.assertIn(("apply", CAROL.address, DISTRICT), [(n["kind"], n["actor"], n["bitmap_number"]) for n in told])
        self.assertEqual(self.client.put(f"/v1/districts/{OTHER}/application", json={}, headers=self.h(ALICE)).status_code, 404)
        self.assertEqual(self.client.delete(f"/v1/districts/{DISTRICT}/recruit", headers=self.h(ALICE)).status_code, 200)
        self.assertIsNone(self.client.get(f"/v1/districts/{DISTRICT}").json()["recruit"])

    def test_polls(self):
        new = lambda w, **kw: self.client.post(f"/v1/districts/{DISTRICT}/polls", json={"question": "修个广场？", "options": ["好", "不好"], **kw}, headers=self.h(w))
        self.assertEqual(new(BOB).status_code, 403)
        self.assertEqual(new(ALICE, options=["好", "好"]).status_code, 400)
        poll = new(ALICE, days=3).json()
        vote = lambda w, o: self.client.put(f"/v1/polls/{poll['id']}/vote", json={"option": o}, headers=self.h(w))
        self.assertEqual(vote(CAROL, 0).status_code, 403)  # a visitor
        self.assertEqual(vote(BOB, 5).status_code, 400)
        self.assertEqual(vote(BOB, 0).json()["counts"], [1, 0])
        self.assertEqual(vote(BOB, 1).json()["counts"], [0, 1])  # changed their mind
        after = vote(ALICE, 1).json()
        self.assertEqual((after["counts"], after["total"], after["my_vote"]), ([0, 2], 2, 1))
        self.assertEqual(self.client.post(f"/v1/polls/{poll['id']}/close", headers=self.h(BOB)).status_code, 403)
        self.assertTrue(self.client.post(f"/v1/polls/{poll['id']}/close", headers=self.h(ALICE)).json()["closed"])
        self.assertEqual(vote(BOB, 0).status_code, 409)
        listed = self.client.get(f"/v1/districts/{DISTRICT}/polls").json()["polls"]
        self.assertEqual((listed[0]["id"], listed[0]["my_vote"]), (poll["id"], None))

    def test_style_unlocks_with_level(self):
        put = lambda w, body: self.client.put(f"/v1/districts/{OTHER}/style", json=body, headers=self.h(w))
        self.assertEqual(put(ALICE, {"color": "red"}).status_code, 403)  # not Alice's district
        self.assertEqual(put(CAROL, {"color": "pink"}).status_code, 400)
        self.assertEqual(put(CAROL, {"color": "red", "deco": ["statue"]}).status_code, 403)  # needs level 5
        self.assertEqual(put(CAROL, {"color": "red", "deco": ["flag"]}).status_code, 200)
        page = self.client.get(f"/v1/districts/{OTHER}").json()
        self.assertEqual(page["profile"]["style"], {"color": "red", "deco": ["flag"]})
        tile = self.client.get(f"/v1/land?start={OTHER}&end={OTHER}").json()["tiles"][0]
        self.assertEqual(tile["style"], {"color": "red", "deco": ["flag"]})
        from api import style

        self.assertEqual(style.visible({"color": "gold", "deco": ["flag", "statue"]}, 2), {"color": "orange", "deco": ["flag"]})

    def test_parks(self):
        from api import parks

        self.assertTrue(parks.connected([100, 101, 109]))
        self.assertFalse(parks.connected([100, 102]))
        self.assertFalse(parks.connected([127, 128]))  # consecutive, but in quarters that don't touch
        self.assertTrue(parks.connected([127, 1656]))  # face each other across a street
        self.assertTrue(parks.connected([120, 1536]))  # across the street the other way
        self.assertIsNone(parks.side(56, 0, 1))  # off the left edge of the map
        for n in (0, 127, 1600, 1663, 3100, 3135):
            for m in parks.neighbours(n):
                self.assertIn(n, set(parks.neighbours(m)))
        with self.conn.cursor() as cur:
            cur.execute(
                "insert into bitmaps (inscription_id, inscription_number, bitmap_number, block_height) values "
                "('d101i0', 10, 101, 300), ('d108i0', 11, 108, 301) on conflict do nothing;"
                "insert into inscription_owners (inscription_id, created_height, outpoint, address, updated_height) values "
                f"('d101i0', 300, 'e:0', '{ALICE.address}', 300), ('d108i0', 301, 'f:0', '{ALICE.address}', 301) "
                "on conflict do nothing;"
            )
        make = lambda w, members, name="减半园": self.client.post("/v1/parks", json={"name": name, "members": members}, headers=self.h(w))
        self.assertEqual(make(ALICE, [100, 101, 999]).status_code, 400)
        self.assertEqual(make(CAROL, [100, 101]).status_code, 403)
        park = make(ALICE, [100, 101, 108])
        self.assertEqual(park.status_code, 201, park.text)
        park = park.json()
        self.assertEqual(park["members"], [100, 101, 108])
        self.assertEqual(make(ALICE, [100, 101]).status_code, 409)
        page = self.client.get("/v1/districts/101").json()
        self.assertEqual(page["park"]["id"], park["id"])
        self.assertEqual(page["level"], park["level"])
        tiles = {t["bitmap_number"]: t for t in self.client.get("/v1/land?start=100&end=108").json()["tiles"]}
        self.assertEqual({n for n, t in tiles.items() if t["park"] == park["id"]}, {100, 101, 108})
        self.assertTrue(all(tiles[n]["level"] == park["level"] for n in (100, 101, 108)))
        # Selling a district takes it out; one left is no park.
        with self.conn.cursor() as cur:
            cur.execute("update inscription_owners set address = 'bcrt1qbuyer' where inscription_id in ('d101i0', 'd108i0');")
        try:
            self.assertEqual(self.client.get(f"/v1/parks/{park['id']}").status_code, 404)
            self.assertIsNone(self.client.get(f"/v1/districts/{DISTRICT}").json()["park"])
        finally:
            with self.conn.cursor() as cur:
                cur.execute(f"update inscription_owners set address = '{ALICE.address}' where inscription_id in ('d101i0', 'd108i0');")
        renamed = self.client.put(f"/v1/parks/{park['id']}", json={"name": "新名字", "members": [100, 108]}, headers=self.h(ALICE))
        self.assertEqual((renamed.status_code, renamed.json()["members"]), (200, [100, 108]))
        self.assertEqual(self.client.delete(f"/v1/parks/{park['id']}", headers=self.h(CAROL)).status_code, 403)
        self.assertEqual(self.client.delete(f"/v1/parks/{park['id']}", headers=self.h(ALICE)).status_code, 200)

    def test_notifications(self):
        with self.conn.cursor() as cur:
            cur.execute("delete from social.notifications;")
        inbox = lambda w: self.client.get("/v1/notifications", headers=self.h(w)).json()
        top = self.post(BOB, "a resident's post").json()
        self.post(CAROL, "a visitor's reply", reply_to=top["id"])
        self.post(BOB, "replying to my own post", reply_to=top["id"])
        for _ in range(2):  # like, undo, like again: told once
            self.client.put(f"/v1/posts/{top['id']}/like", headers=self.h(CAROL))
            self.client.delete(f"/v1/posts/{top['id']}/like", headers=self.h(CAROL))
        self.client.put(f"/v1/posts/{top['id']}/like", headers=self.h(BOB))  # your own like isn't news
        self.client.put(f"/v1/districts/{DISTRICT}/follow", headers=self.h(CAROL))
        alice, bob = inbox(ALICE), inbox(BOB)
        self.assertEqual([(n["kind"], n["actor"]) for n in alice["notifications"]], [("follow", CAROL.address), ("post", BOB.address)])
        self.assertEqual(alice["notifications"][1]["snippet"], "a resident's post")
        self.assertEqual([(n["kind"], n["actor"]) for n in bob["notifications"]], [("like", CAROL.address), ("reply", CAROL.address)])
        self.assertEqual((bob["unread"], inbox(CAROL)["unread"]), (2, 0))
        self.assertEqual(self.client.get("/v1/notifications", headers={}).status_code, 401)
        newest = bob["notifications"][0]["id"]
        self.assertEqual(self.client.post("/v1/notifications/read", json={"up_to": newest - 1}, headers=self.h(BOB)).json()["unread"], 1)
        self.assertEqual(self.client.post("/v1/notifications/read", json={}, headers=self.h(BOB)).json()["unread"], 0)
        self.assertTrue(all(n["read"] for n in inbox(BOB)["notifications"]))
        self.assertEqual(self.client.get("/v1/notifications/unread", headers=self.h(ALICE)).json()["unread"], 2)
        self.client.delete(f"/v1/districts/{DISTRICT}/follow", headers=self.h(CAROL))

    def test_x_link(self):
        from api import xlink

        class Fake:
            seen = []

            def user(self, code, verifier, client_id, secret, redirect):
                Fake.seen.append((code, verifier, client_id, redirect))
                if code == "bad":
                    raise RuntimeError("invalid_grant")
                return {"id": "42", "username": "alice_btc", "name": "Alice", "profile_image_url": "https://pbs.twimg.com/a.jpg"}

        def state_of(url):
            return urllib.parse.parse_qs(urllib.parse.urlparse(url).query)

        old_env = {k: os.environ.get(k) for k in ("X_CLIENT_ID", "X_REDIRECT_URL")}
        try:
            os.environ.pop("X_CLIENT_ID", None)
            self.assertFalse(self.client.get("/v1/x/link", headers=self.h(ALICE)).json()["available"])
            self.assertEqual(self.client.post("/v1/x/link/start", headers=self.h(ALICE)).status_code, 503)
            os.environ.update(X_CLIENT_ID="cid", X_REDIRECT_URL="https://unimap.test/x/callback")
            xlink.provider = Fake()
            self.assertEqual(self.client.post("/v1/x/link/start").status_code, 401)
            q = state_of(self.client.post("/v1/x/link/start", headers=self.h(ALICE)).json()["url"])
            self.assertEqual((q["client_id"], q["code_challenge_method"], q["redirect_uri"]), (["cid"], ["S256"], ["https://unimap.test/x/callback"]))
            state = q["state"][0]
            # The state belongs to the address that started, and works once.
            self.assertEqual(self.client.post("/v1/x/link/finish", json={"code": "c", "state": state}, headers=self.h(BOB)).status_code, 400)
            done = self.client.post("/v1/x/link/finish", json={"code": "c", "state": state}, headers=self.h(ALICE))
            self.assertEqual(done.status_code, 200, done.text)
            self.assertEqual(done.json()["x"]["username"], "alice_btc")
            code, verifier, _, _ = Fake.seen[-1]
            self.assertEqual(xlink._challenge(verifier), q["code_challenge"][0])
            self.assertEqual(self.client.post("/v1/x/link/finish", json={"code": "c", "state": state}, headers=self.h(ALICE)).status_code, 400)
            # X saying no keeps nothing.
            state2 = state_of(self.client.post("/v1/x/link/start", headers=self.h(BOB)).json()["url"])["state"][0]
            self.assertEqual(self.client.post("/v1/x/link/finish", json={"code": "bad", "state": state2}, headers=self.h(BOB)).status_code, 502)
            self.assertIsNone(self.client.get("/v1/me", headers=self.h(BOB)).json()["x"])
            # The handle shows on the owner's district, their posts and /v1/me.
            self.assertEqual(self.client.get("/v1/me", headers=self.h(ALICE)).json()["x"]["url"], "https://x.com/alice_btc")
            self.assertEqual(self.client.get(f"/v1/districts/{DISTRICT}").json()["owner_x"]["username"], "alice_btc")
            post = self.post(ALICE, "gm from X")
            self.assertEqual(post.json()["author"]["x"], "alice_btc")
            self.assertIsNone(self.post(BOB, "no X here", reply_to=post.json()["id"]).json()["author"]["x"])
            self.assertEqual(self.client.delete("/v1/x/link", headers=self.h(ALICE)).json(), {"x": None})
            self.assertIsNone(self.client.get(f"/v1/districts/{DISTRICT}").json()["owner_x"])
        finally:
            xlink.provider = None
            for k, v in old_env.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
            with self.conn.cursor() as cur:
                cur.execute("delete from social.x_accounts; delete from social.x_link_states;")

    def test_holdings_showcase(self):
        import tempfile
        from decimal import Decimal

        from api import holdings

        class Fake:
            calls = 0
            fail = False

            def rune_balances(self, address):
                Fake.calls += 1
                if Fake.fail:
                    raise RuntimeError("provider down")
                return {"DOGGOTOTHEMOON": Decimal("2500000.5"), "OTHERRUNE": Decimal(9)} if address == ALICE.address else {}

            def inscription_ids(self, address):
                return iter(["cat1i0", "cat2i0", "notacati0", "frog1i0"] if address == ALICE.address else [])

        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "quantum-cats.json"), "w") as f:
                f.write('["cat1i0", {"id": "cat2i0"}, "cat3i0"]')
            with open(os.path.join(d, "bitcoin-frogs.json"), "w") as f:
                f.write('["frog1i0", "frog2i0"]')
            old_dir, holdings.COLLECTIONS_DIR = holdings.COLLECTIONS_DIR, holdings.Path(d)
            holdings.collection.cache_clear()
            holdings.provider = Fake()
            try:
                self.assertEqual((holdings.tier("dog", 0), holdings.tier("dog", 1), holdings.tier("dog", 10**8)), (0, 1, 3))
                self.assertEqual(self.client.get(f"/v1/districts/{DISTRICT}/showcase", headers=self.h(CAROL)).status_code, 403)
                # Nothing shows before the owner picks it, though the first look fetches holdings.
                view = self.client.get(f"/v1/districts/{DISTRICT}/showcase", headers=self.h(ALICE)).json()
                held = {h["asset"]: (h["tier"], h["amount"]) for h in view["held"]}
                self.assertEqual(set(held), set(holdings.ASSETS))
                self.assertEqual((held["dog"], held["cat"], held["frog"], held["monkey"]), ((2, "2500000.5"), (1, "2"), (1, "1"), (0, "0")))
                self.assertEqual((view["chosen"], view["shown"]), ([], []))
                self.assertEqual(self.client.get(f"/v1/districts/{DISTRICT}").json()["pets"], [])
                bad = self.client.put(f"/v1/districts/{DISTRICT}/showcase", json={"assets": ["unicorn"]}, headers=self.h(ALICE))
                self.assertEqual(bad.status_code, 400)
                four = self.client.put(f"/v1/districts/{DISTRICT}/showcase", json={"assets": ["dog", "cat", "frog", "monkey"]}, headers=self.h(ALICE))
                self.assertEqual(four.status_code, 400)  # three at most
                put = self.client.put(f"/v1/districts/{DISTRICT}/showcase", json={"assets": ["dog", "cat"]}, headers=self.h(ALICE))
                self.assertEqual(put.status_code, 200, put.text)
                self.assertEqual([p["asset"] for p in put.json()["shown"]], ["dog", "cat"])
                self.assertEqual(self.client.get(f"/v1/districts/{DISTRICT}").json()["pets"][0], {"asset": "dog", "tier": 2, "amount": "2500000.5"})
                tiles = {t["bitmap_number"]: t for t in self.client.get(f"/v1/land?start={DISTRICT}&end={OTHER}").json()["tiles"]}
                self.assertEqual((tiles[DISTRICT]["pets"], tiles[OTHER]["pets"]), (["dog:2", "cat:1"], []))
                # 刷新 is rate limited; a provider failure keeps the old cache.
                calls = Fake.calls
                self.client.post(f"/v1/districts/{DISTRICT}/showcase/refresh", headers=self.h(ALICE))
                self.assertEqual(Fake.calls, calls)
                Fake.fail = True
                self.assertFalse(holdings.refresh(ALICE.address))
                self.assertEqual(tiles[DISTRICT]["pets"], self.client.get(f"/v1/land?start={DISTRICT}&end={DISTRICT}").json()["tiles"][0]["pets"])
                self.assertEqual(self.client.get(f"/v1/districts/{DISTRICT}/showcase", headers=self.h(ALICE)).json()["error"], "provider down")
                # A new owner's wallet stays private until they pick for themselves.
                with self.conn.cursor() as cur:
                    cur.execute("update inscription_owners set address = %s where inscription_id = 'd100i0';", (CAROL.address,))
                try:
                    self.assertEqual(self.client.get(f"/v1/districts/{DISTRICT}").json()["pets"], [])
                    self.assertEqual(self.client.get(f"/v1/land?start={DISTRICT}&end={DISTRICT}").json()["tiles"][0]["pets"], [])
                finally:
                    with self.conn.cursor() as cur:
                        cur.execute("update inscription_owners set address = %s where inscription_id = 'd100i0';", (ALICE.address,))
            finally:
                holdings.COLLECTIONS_DIR, holdings.provider = old_dir, None
                holdings.collection.cache_clear()
                with self.conn.cursor() as cur:
                    cur.execute("delete from social.showcase; delete from social.holdings; delete from social.holdings_checked;")

    def test_linked_wallets(self):
        from decimal import Decimal

        from api import holdings

        dave = Wallet(4)

        class Fake:
            def rune_balances(self, address):
                return {"DOGGOTOTHEMOON": Decimal(600000)} if address in (ALICE.address, dave.address) else {}

            def inscription_ids(self, address):
                return iter([])

        def link(me, other, sign_with=None):
            r = self.client.post("/v1/me/wallets/nonce", json={"address": other.address}, headers=self.h(me))
            if r.status_code != 200:
                return r
            n = r.json()
            self.assertIn(f"to: {me.address}", n["message"])
            body = {"address": other.address, "nonce": n["nonce"], "signature": (sign_with or other).sign(n["message"])}
            return self.client.post("/v1/me/wallets", json=body, headers=self.h(me))

        holdings.provider = Fake()
        try:
            self.assertEqual(self.client.get("/v1/me", headers=self.h(ALICE)).json()["wallets"], [{"address": ALICE.address, "main": True, "me": True}])
            # The other wallet has to sign, and the message can't be used to sign in as it.
            self.assertEqual(link(ALICE, dave, sign_with=CAROL).status_code, 401)
            r = self.client.post("/v1/me/wallets/nonce", json={"address": dave.address}, headers=self.h(ALICE)).json()
            login = self.client.post("/v1/auth/login", json={"address": dave.address, "nonce": r["nonce"], "signature": dave.sign(r["message"])})
            self.assertEqual(login.status_code, 401)
            r = link(ALICE, dave)
            self.assertEqual(r.status_code, 200, r.text)
            self.assertEqual([w["address"] for w in r.json()["wallets"]], [ALICE.address, dave.address])
            self.assertEqual(link(ALICE, dave).status_code, 409)
            self.assertEqual(link(CAROL, dave).status_code, 409)  # one group at most
            self.assertEqual(link(CAROL, ALICE).status_code, 409)
            # Pets count both wallets: 600k + 600k dogs reach the second tier.
            view = self.client.get(f"/v1/districts/{DISTRICT}/showcase", headers=self.h(ALICE)).json()
            self.assertEqual(view["wallets"], 2)
            self.assertEqual({h["asset"]: h["tier"] for h in view["held"]}["dog"], 2)
            self.client.put(f"/v1/districts/{DISTRICT}/showcase", json={"assets": ["dog"]}, headers=self.h(ALICE))
            self.assertEqual(self.client.get(f"/v1/land?start={DISTRICT}&end={DISTRICT}").json()["tiles"][0]["pets"], ["dog:2"])
            # Bob's wallet joins the group through Alice; Bob sees the same group from his side.
            self.assertEqual(link(ALICE, BOB).status_code, 200)
            bob = self.client.get("/v1/me/wallets", headers=self.h(BOB)).json()["wallets"]
            self.assertEqual([(w["address"], w["main"], w["me"]) for w in bob][0], (ALICE.address, True, False))
            self.assertEqual(self.client.delete(f"/v1/me/wallets/{ALICE.address}", headers=self.h(BOB)).status_code, 404)
            self.assertEqual(self.client.delete(f"/v1/me/wallets/{BOB.address}", headers=self.h(BOB)).status_code, 200)
            r = self.client.delete(f"/v1/me/wallets/{dave.address}", headers=self.h(ALICE))
            self.assertEqual(r.json()["wallets"], [{"address": ALICE.address, "main": True, "me": True}])
            self.assertEqual(self.client.get(f"/v1/land?start={DISTRICT}&end={DISTRICT}").json()["tiles"][0]["pets"], ["dog:1"])
        finally:
            holdings.provider = None
            with self.conn.cursor() as cur:
                cur.execute(
                    "delete from social.wallet_links; delete from social.showcase; delete from social.holdings; "
                    "delete from social.holdings_checked;"
                )

    def test_search(self):
        with self.conn.cursor() as cur:
            cur.execute(
                "insert into bitmaps (inscription_id, inscription_number, bitmap_number, block_height) values "
                "('d101i0', 10, 101, 300) on conflict do nothing;"
                "insert into inscription_owners (inscription_id, created_height, outpoint, address, updated_height) values "
                f"('d101i0', 300, 'e:0', '{ALICE.address}', 300) on conflict do nothing;"
                f"insert into social.parks (id, name, owner_address) values (900, '减半_Village', '{ALICE.address}');"
                "insert into social.park_members (bitmap_number, park_id) values (100, 900), (101, 900);"
                f"insert into social.x_accounts (address, x_user_id, username, name) values ('{CAROL.address}', '7', 'carol_btc', 'Carol');"
            )
        s = lambda q: self.client.get("/v1/search", params={"q": q}).json()
        try:
            self.assertEqual(s(""), {"districts": [], "parks": [], "people": []})
            self.assertEqual(s("105")["districts"], [105])
            self.assertEqual(s("105.bitmap")["districts"], [105])
            self.assertEqual(s("5000")["districts"], [])  # beyond the tip
            self.assertEqual(s("village")["parks"], [{"id": 900, "name": "减半_Village", "members": 2, "first": 100}])
            self.assertEqual(s("减半")["parks"][0]["id"], 900)
            self.assertEqual(s("%")["parks"], [])  # no wildcards
            carol = s("@Carol")["people"]
            self.assertEqual([(p["address"], p["x"]["username"], p["districts"]) for p in carol], [(CAROL.address, "carol_btc", [OTHER])])
            alice = s(ALICE.address[:12].upper())["people"]
            self.assertEqual([p["address"] for p in alice], [ALICE.address])
            self.assertTrue({100, 101} <= set(alice[0]["districts"]))  # test_parks may have given her 108 too
            self.assertEqual(alice[0]["count"], len(alice[0]["districts"]))
            self.assertEqual(s(ALICE.address[:4])["people"], [])  # too short for an address
            self.assertEqual(s("bcrt1qbuyer")["people"], [])  # holds no district, no X
        finally:
            with self.conn.cursor() as cur:
                cur.execute("delete from social.park_members where park_id = 900; delete from social.parks where id = 900; delete from social.x_accounts;")

    def test_person(self):
        r = self.post(BOB, "住在 100 号的一个地块上")
        self.assertEqual(r.status_code, 201, r.text)
        page = self.client.get(f"/v1/people/{BOB.address.upper()}").json()
        self.assertEqual(page["address"], BOB.address)
        self.assertEqual(page["parcels"], [{"bitmap_number": 100, "tx_index": 1}])
        self.assertEqual(page["districts"], [])
        self.assertGreaterEqual(page["post_count"], 1)
        self.assertEqual(page["posts"][0]["body"], "住在 100 号的一个地块上")
        self.assertTrue(all(p["author"]["address"] == BOB.address for p in page["posts"]))
        alice = self.client.get(f"/v1/people/{ALICE.address}").json()
        self.assertIn(100, [d["bitmap_number"] for d in alice["districts"]])
        self.assertTrue(all(d["level"] >= 0 for d in alice["districts"]))
        older = self.client.get(f"/v1/people/{BOB.address}?before_id={page['posts'][0]['id']}").json()["posts"]
        self.assertTrue(all(p["id"] < page["posts"][0]["id"] for p in older))
        nobody = self.client.get("/v1/people/bcrt1qnobody").json()
        self.assertEqual((nobody["districts"], nobody["posts"], nobody["post_count"]), ([], [], 0))

    def test_reports_and_bans(self):
        os.environ["ADMIN_ADDRESSES"] = CAROL.address.upper()
        try:
            post = self.post(BOB, "买币加我微信").json()
            report = lambda w, reason="spam", pid=post["id"]: self.client.post(
                f"/v1/posts/{pid}/report", json={"reason": reason, "note": "广告"}, headers=self.h(w)
            )
            self.assertEqual(report(BOB).status_code, 400)  # not your own
            self.assertEqual(report(ALICE, "nonsense").status_code, 400)
            self.assertEqual(report(ALICE).status_code, 200)
            self.assertEqual(report(ALICE, "scam").status_code, 200)  # again: updates, no second report
            self.assertEqual(report(CAROL).status_code, 200)
            self.assertEqual(self.client.get("/v1/admin/reports", headers=self.h(ALICE)).status_code, 403)
            self.assertTrue(self.client.get("/v1/me", headers=self.h(CAROL)).json()["admin"])
            self.assertFalse(self.client.get("/v1/me", headers=self.h(ALICE)).json()["admin"])
            queue = self.client.get("/v1/admin/reports", headers=self.h(CAROL)).json()["reports"]
            mine = [r for r in queue if r["post"]["id"] == post["id"]][0]
            self.assertEqual((mine["count"], sorted(r["reason"] for r in mine["reports"])), (2, ["scam", "spam"]))
            # Dismissing closes them; a new report reopens.
            self.client.post(f"/v1/admin/reports/{post['id']}", json={"action": "dismiss"}, headers=self.h(CAROL))
            queue = self.client.get("/v1/admin/reports", headers=self.h(CAROL)).json()["reports"]
            self.assertNotIn(post["id"], [r["post"]["id"] for r in queue])
            report(ALICE)
            r = self.client.post(f"/v1/admin/reports/{post['id']}", json={"action": "remove"}, headers=self.h(CAROL))
            self.assertEqual(r.status_code, 200)
            self.assertTrue(self.client.get(f"/v1/posts/{post['id']}").json()["removed"])
            # A banned address can't post anywhere until the ban is lifted.
            self.assertEqual(self.client.post("/v1/admin/bans", json={"address": CAROL.address}, headers=self.h(CAROL)).status_code, 400)
            self.assertEqual(self.client.post("/v1/admin/bans", json={"address": BOB.address, "days": 7}, headers=self.h(CAROL)).status_code, 200)
            self.assertTrue(self.client.get("/v1/me", headers=self.h(BOB)).json()["banned"])
            self.assertEqual(self.post(BOB, "我又来了").status_code, 403)
            self.assertEqual([b["address"] for b in self.client.get("/v1/admin/bans", headers=self.h(CAROL)).json()["bans"]], [BOB.address])
            self.client.delete(f"/v1/admin/bans/{BOB.address}", headers=self.h(CAROL))
            self.assertEqual(self.post(BOB, "好好说话").status_code, 201)
        finally:
            os.environ.pop("ADMIN_ADDRESSES", None)
            with self.conn.cursor() as cur:
                cur.execute("delete from social.reports; delete from social.bans;")

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

    def test_listings(self):
        from api import listings

        class Fake:
            market = "magiceden"
            item_url = staticmethod(listings.MagicEden.item_url)
            fail = False

            def listed(self):
                if Fake.fail:
                    raise RuntimeError("market down")
                return iter(
                    [
                        ("d100i0", 5_000_000, ALICE.address, None),  # listed by its holder
                        ("d105i0", 1_000, "bc1qsoldalready", None),  # left behind after the district moved
                        ("d999i0", 2_000_000, "bcrt1qsomeoneelse", None),
                        ("notabitmapi0", 10, "bc1qx", None),
                    ]
                )

        old = listings.provider
        listings.provider = Fake()
        try:
            self.assertTrue(listings.refresh(force=True))
            self.assertFalse(listings.refresh())  # tried just now
            tiles = {t["bitmap_number"]: t for t in self.client.get("/v1/land?start=100&end=105").json()["tiles"]}
            self.assertEqual((tiles[100]["sale"], tiles[105]["sale"], tiles[101]["sale"]), (5_000_000, None, None))
            sale = self.client.get("/v1/land/100").json()["district"]["sale"]
            self.assertEqual(sale["price_sats"], 5_000_000)
            self.assertEqual(sale["url"], "https://magiceden.io/ordinals/item-details/d100i0")
            self.assertIsNone(self.client.get("/v1/land/105").json()["district"]["sale"])
            self.assertEqual([x["bitmap_number"] for x in self.client.get("/v1/listings").json()["listings"]], [999, 100])
            # A failed refresh keeps the old copy, until it is STALE_HOURS old.
            Fake.fail = True
            self.assertFalse(listings.refresh(force=True))
            self.assertEqual(len(self.client.get("/v1/listings").json()["listings"]), 2)
            with self.conn.cursor() as cur:
                cur.execute("update social.listings_checked set ok_at = now() - interval '7 hours';")
            self.assertEqual(self.client.get("/v1/listings").json()["listings"], [])
            self.assertIsNone(self.client.get("/v1/land?start=100&end=100").json()["tiles"][0]["sale"])
        finally:
            listings.provider = old
            with self.conn.cursor() as cur:
                cur.execute("delete from social.listings; delete from social.listings_checked;")


    def test_magiceden_listings_parse(self):
        from unittest import mock

        from api import listings

        pages = [
            {"tokens": [{"id": f"i{k}i0", "listed": True, "listedPrice": 1000 + k, "owner": "bc1qa", "listedAt": "2026-10-01T12:00:00.000Z"} for k in range(100)]},
            {"tokens": [{"id": "x1i0", "listed": True, "listedPrice": 5, "owner": "bc1qb"}, {"id": "x2i0", "listed": False, "owner": "bc1qc"}]},
        ]
        calls = []

        def get(url, params, headers, timeout):
            calls.append((url, params, headers))
            r = mock.Mock()
            r.json.return_value = pages[len(calls) - 1]
            return r

        with mock.patch.object(listings.requests, "get", get):
            got = list(listings.MagicEden(url="https://me.test", key="k", collection="bitmap").listed())
        self.assertEqual(len(got), 101)
        self.assertEqual(got[0][:3], ("i0i0", 1000, "bc1qa"))
        self.assertEqual(got[0][3].year, 2026)
        self.assertEqual(got[-1], ("x1i0", 5, "bc1qb", None))
        self.assertEqual(calls[0][0], "https://me.test/v2/ord/btc/tokens")
        self.assertEqual((calls[0][1]["collectionSymbol"], calls[1][1]["offset"]), ("bitmap", 100))
        self.assertEqual(calls[0][2]["Authorization"], "Bearer k")

    def test_tips(self):
        from api import tips

        class Fake:
            paid = set()
            asked = []

            @staticmethod
            def pay_request(a):
                if a.startswith("broken"):
                    raise tips.LnurlError("this isn't a Lightning address that can receive payments")
                return {"tag": "payRequest", "callback": "https://wallet.test/cb"}

            @staticmethod
            def ask_invoice(a, sats, comment):
                Fake.asked.append((a, sats, comment))
                return f"lnbc{sats * 10}n1fake{len(Fake.asked)}", None if a.startswith("noverify") else f"https://wallet.test/v/{len(Fake.asked)}"

            @staticmethod
            def settled(url):
                return url in Fake.paid

        old = tips.lnurl
        tips.lnurl = Fake
        try:
            post = self.post(BOB, "a post worth tipping").json()
            tip = lambda w, **body: self.client.post("/v1/tips", json=body, headers=self.h(w))
            # Nobody gets tipped before they set a Lightning address.
            self.assertFalse(post["author"]["tippable"])
            self.assertEqual(tip(ALICE, post_id=post["id"], amount_sats=500).status_code, 409)
            self.assertEqual(self.client.put("/v1/me/lightning", json={"lightning_address": "not an address"}, headers=self.h(BOB)).status_code, 400)
            self.assertEqual(self.client.put("/v1/me/lightning", json={"lightning_address": "broken@wallet.test"}, headers=self.h(BOB)).status_code, 400)
            r = self.client.put("/v1/me/lightning", json={"lightning_address": " Bob@Wallet.test "}, headers=self.h(BOB))
            self.assertEqual(r.json()["lightning_address"], "bob@wallet.test")
            self.assertTrue(self.client.get(f"/v1/posts/{post['id']}").json()["author"]["tippable"])
            # No tipping yourself; amounts are bounded.
            self.assertEqual(tip(BOB, post_id=post["id"], amount_sats=500).status_code, 400)
            self.assertEqual(tip(ALICE, post_id=post["id"], amount_sats=0).status_code, 422)
            t = tip(ALICE, post_id=post["id"], amount_sats=500, comment=" nice ").json()
            self.assertEqual((t["invoice"], t["verifiable"], Fake.asked[-1]), ("lnbc5000n1fake1", True, ("bob@wallet.test", 500, "nice")))
            status = lambda w, i: self.client.get(f"/v1/tips/{i}", headers=self.h(w))
            self.assertEqual(status(ALICE, t["id"]).json()["status"], "pending")
            self.assertEqual(status(CAROL, t["id"]).status_code, 404)  # only the tipper checks
            self.assertEqual(self.client.get(f"/v1/posts/{post['id']}").json()["tips_sats"], 0)
            Fake.paid.add("https://wallet.test/v/1")
            with self.conn.cursor() as cur:
                cur.execute("update social.tips set checked_at = null;")
            self.assertEqual(status(ALICE, t["id"]).json()["status"], "settled")
            self.assertEqual(self.client.get(f"/v1/posts/{post['id']}").json()["tips_sats"], 500)
            n = self.client.get("/v1/notifications", headers=self.h(BOB)).json()["notifications"][0]
            self.assertEqual((n["kind"], n["actor"], n["amount_sats"], n["comment"]), ("tip", ALICE.address, 500, "nice"))
            # A second tip from the same person is told too, and the district counts tippers once.
            t2 = tip(ALICE, post_id=post["id"], amount_sats=100).json()
            Fake.paid.add("https://wallet.test/v/2")
            with self.conn.cursor() as cur:
                cur.execute("update social.tips set checked_at = null;")
            self.assertEqual(status(ALICE, t2["id"]).json()["status"], "settled")
            kinds = [x["kind"] for x in self.client.get("/v1/notifications", headers=self.h(BOB)).json()["notifications"]]
            self.assertEqual(kinds[:2], ["tip", "tip"])
            d = self.client.get(f"/v1/districts/{DISTRICT}").json()
            self.assertEqual((d["tips"], d["prosperity"]["parts"]["tippers30"]), ({"sats30": 600, "tippers30": 1}, 1))
            top = self.client.get("/v1/tips/top").json()
            self.assertEqual((top["posts"][0]["post"]["id"], top["posts"][0]["sats"], top["districts"][0]["bitmap_number"]), (post["id"], 600, DISTRICT))
            # Tipping a district goes to its owner; their wallet has no verify URL, so it can't settle.
            self.client.put("/v1/me/lightning", json={"lightning_address": "noverify@wallet.test"}, headers=self.h(ALICE))
            self.assertTrue(self.client.get(f"/v1/districts/{DISTRICT}").json()["owner_tippable"])
            t3 = tip(CAROL, bitmap_number=DISTRICT, amount_sats=2100).json()
            self.assertFalse(t3["verifiable"])
            self.assertEqual(status(CAROL, t3["id"]).json()["status"], "pending")
            self.assertEqual(self.client.delete("/v1/me/lightning", headers=self.h(ALICE)).json(), {"lightning_address": None})
            self.assertEqual(tip(CAROL, bitmap_number=DISTRICT, amount_sats=2100).status_code, 409)
        finally:
            tips.lnurl = old
            with self.conn.cursor() as cur:
                cur.execute("delete from social.tips; delete from social.lightning_addresses; delete from social.notifications where kind = 'tip';")

    def test_game(self):
        import hashlib

        from api import game

        dave = Wallet(9)
        self.tokens[dave.address] = self.login(dave)
        # A round starts at block 864 (a multiple of 144); choose its hash so district 100 (Alice's) is drawn.
        start = 864
        lucky_hash = next(f"{i:064x}" for i in range(1, 99) if int(hashlib.sha256(f"{i:064x}:lucky".encode()).hexdigest(), 16) % 2 == 0)
        hashes = {h: f"{h:061x}abc" for h in range(858, 1002)}
        hashes[start] = lucky_hash
        hashes[1001] = "00000000000000000001" + "7" * 41 + "000"  # three trailing zeros: legendary
        with self.conn.cursor() as cur:
            cur.execute("insert into parcel_block_hashes (block_height, block_hash) select * from unnest(%s::int[], %s::text[]);", (list(hashes), list(hashes.values())))
        try:
            g = self.client.get("/v1/game").json()
            self.assertEqual(g["tip"], 1001)  # the district index is at 1000, so draws stop at 1001
            r = g["round"]
            self.assertEqual((r["since"], r["until"], r["bitmap_number"], r["candidates"], r["index"], r["owner"]), (864, 1007, 100, 2, 0, ALICE.address))
            d = g["draws"][0]
            self.assertEqual((d["height"], d["bitmap_number"], d["tx_index"], d["candidates"], d["rarity"], d["open"]), (1001, 100, 1, 1, "legendary", True))
            self.assertEqual(game.rarity("ab0"), "rare")
            self.assertEqual(game.rarity("a" + "0" * 9), "legendary")
            # The lucky district's owner gets a badge and a notification; the treasure's owner a notification.
            self.assertIn({"kind": "lucky", "height": 864, "bitmap_number": 100}, [{k: b[k] for k in ("kind", "height", "bitmap_number")} for b in self.client.get(f"/v1/people/{ALICE.address}").json()["badges"]])
            n = self.client.get("/v1/notifications", headers=self.h(BOB)).json()["notifications"][0]
            self.assertEqual((n["kind"], n["bitmap_number"], n["block_height"], n["tx_index"], n["rarity"]), ("treasure", 100, 1001, 1, "legendary"))
            n = next(x for x in self.client.get("/v1/notifications", headers=self.h(ALICE)).json()["notifications"] if x["kind"] == "lucky")
            self.assertEqual(n["block_height"], 864)
            # On the map and the district page.
            tiles = {t["bitmap_number"]: t for t in self.client.get("/v1/land?start=100&end=105").json()["tiles"]}
            self.assertEqual((tiles[100]["lucky"], tiles[100]["treasure"], tiles[105]["lucky"], tiles[105]["treasure"]), (True, "legendary", False, None))
            page = self.client.get("/v1/districts/100", headers=self.h(BOB)).json()["game"]
            self.assertEqual((page["lucky"]["since"], page["treasures"][0]["height"], page["treasures"][0]["claimable"]), (864, 1001, True))
            self.assertFalse(self.client.get("/v1/districts/100", headers=self.h(CAROL)).json()["game"]["treasures"][0]["claimable"])
            self.assertEqual(self.client.get("/v1/districts/100").json()["prosperity"]["parts"]["lucky"], 1)
            # Only the parcel's owner opens it, once, while it is open.
            opened = lambda w, h: self.client.post(f"/v1/game/treasures/{h}/open", headers=self.h(w))
            self.assertEqual(opened(CAROL, 1001).status_code, 403)
            self.assertEqual(opened(BOB, 1001).json()["rarity"], "legendary")
            self.assertEqual(opened(BOB, 1001).status_code, 409)
            self.assertEqual(opened(BOB, 700).status_code, 404)
            with self.conn.cursor() as cur:
                cur.execute("insert into social.block_draws (height, block_hash, treasure_bitmap, treasure_tx, treasure_of, rarity) values (850, 'x', 100, 1, 1, 'common');")
            self.assertEqual(opened(BOB, 850).status_code, 410)
            self.assertEqual(self.client.get("/v1/game").json()["draws"][0]["opened_by"], BOB.address)
            # Anyone who checks in at the lucky district during its round gets the visitor badge; elsewhere, nothing.
            self.assertEqual(self.client.post(f"/v1/districts/{OTHER}/checkin", headers=self.h(dave)).json()["badges"], [])
            won = self.client.post("/v1/districts/100/checkin", headers=self.h(dave)).json()["badges"]
            self.assertEqual(won, [{"kind": "lucky_visit", "height": 864, "bitmap_number": 100, "rarity": "common"}])
            self.assertTrue(self.client.get("/v1/districts/100", headers=self.h(dave)).json()["game"]["lucky"]["visited"])
            # A reorg that replaces a block redraws it.
            with self.conn.cursor() as cur:
                cur.execute("update parcel_block_hashes set block_hash = %s where block_height = 1000;", ("f" * 64,))
            self.assertEqual(next(x for x in self.client.get("/v1/game").json()["draws"] if x["height"] == 1000)["block_hash"], "f" * 64)
        finally:
            with self.conn.cursor() as cur:
                cur.execute(
                    "delete from parcel_block_hashes; delete from social.block_draws; delete from social.badges; "
                    "delete from social.notifications where kind in ('treasure', 'lucky'); delete from social.checkins where address = %s;",
                    (dave.address,),
                )


    def test_seasons(self):
        from api import seasons

        hashes = {h: f"{h:061x}def" for h in range(1958, 2102)}
        with self.conn.cursor() as cur:
            cur.execute("insert into bitmap_block_hashes (block_height, block_hash) values (2100, 'h2100');")
            cur.execute("insert into parcel_block_hashes (block_height, block_hash) select * from unnest(%s::int[], %s::text[]);", (list(hashes), list(hashes.values())))
            # Season 0 (blocks 0-2015) began about 2101 blocks ago and ended 85 blocks ago (no bitcoind here, so ten minutes a block).
            cur.execute(
                "insert into social.posts (bitmap_number, author_address, author_role, body, signed_message, signature, created_at) values "
                "(100, %s, 'owner', 'old', 'm', 'season-s1', now() - interval '2 days'), (100, %s, 'resident', 'old', 'm', 'season-s2', now() - interval '3 days') returning id;",
                (ALICE.address, BOB.address),
            )
            old_posts = [r[0] for r in cur.fetchall()]
            cur.execute("insert into social.checkins (address, bitmap_number, day) values (%s, 105, (now() at time zone 'utc')::date - 3);", (BOB.address,))
        try:
            r = self.client.get("/v1/season").json()
            self.assertEqual((r["number"], r["since"], r["until"], r["tip"]), (1, 2016, 4031, 2101))
            self.assertEqual([(w["bitmap_number"], w["owner"], w["score"]) for w in r["last"]["winners"]], [(100, ALICE.address, 8), (105, CAROL.address, 1)])
            self.assertEqual(r["pool_sats"], 0)
            # Winners' owners get a crown badge and a notification; the districts wear crowns on the map and their pages.
            badge = next(b for b in self.client.get(f"/v1/people/{ALICE.address}").json()["badges"] if b["kind"] == "crown")
            self.assertEqual((badge["height"], badge["bitmap_number"], badge["rarity"]), (0, 100, "legendary"))
            n = next(x for x in self.client.get("/v1/notifications", headers=self.h(CAROL)).json()["notifications"] if x["kind"] == "crown")
            self.assertEqual((n["bitmap_number"], n["block_height"]), (105, 0))
            tiles = {t["bitmap_number"]: t for t in self.client.get("/v1/land?start=100&end=105").json()["tiles"]}
            self.assertEqual((tiles[100]["crown"], tiles[105]["crown"], tiles[101]["crown"]), (1, 2, None))
            self.assertEqual(self.client.get("/v1/districts/105").json()["game"]["crown"], {"rank": 2, "season": 0})
            # Frozen once: later activity in that window doesn't change the winners.
            with self.conn.cursor() as cur:
                cur.execute("insert into social.checkins (address, bitmap_number, day) select %s, 105, (now() at time zone 'utc')::date - d from generate_series(4, 12) d;", (CAROL.address,))
            self.assertEqual(self.client.get("/v1/season").json()["last"]["winners"][0]["bitmap_number"], 100)
            os.environ["GAME_SEASON_POOL_SATS"] = "100000"
            self.assertEqual(self.client.get("/v1/season").json()["pool_split"], [50000, 30000, 20000])
            self.assertEqual(seasons.bounds(455), (917280, 919295))
        finally:
            os.environ.pop("GAME_SEASON_POOL_SATS", None)
            with self.conn.cursor() as cur:
                cur.execute(
                    "delete from bitmap_block_hashes where block_height = 2100; delete from parcel_block_hashes; delete from social.block_draws; "
                    "delete from social.badges; delete from social.seasons; delete from social.notifications where kind in ('treasure', 'lucky', 'crown'); "
                    "delete from social.posts where id = any(%s); delete from social.checkins where bitmap_number = 105 and day < (now() at time zone 'utc')::date - 2;",
                    (old_posts,),
                )


    def test_events(self):
        from api import tips

        class Fake:
            paid = set()
            pay_request = staticmethod(lambda a: {"tag": "payRequest"})
            ask_invoice = staticmethod(lambda a, sats, comment: (f"lnbc{sats * 10}n1prize", f"https://wallet.test/p/{sats}"))
            settled = staticmethod(lambda url: url in Fake.paid)

        hashes = {h: f"{h:061x}def" for h in range(1958, 2102)}
        with self.conn.cursor() as cur:
            cur.execute("insert into bitmap_block_hashes (block_height, block_hash) values (2100, 'h2100');")
            cur.execute("insert into parcel_block_hashes (block_height, block_hash) select * from unnest(%s::int[], %s::text[]);", (list(hashes), list(hashes.values())))
            # Season 0 ended about 85 blocks ago (ten minutes a block). ALICE ran an event in it for the most posts.
            cur.execute(
                "insert into social.events (bitmap_number, season, host, metric, prizes, note) values (100, 0, %s, 'posts', '{1000,500}', 'most posts') returning id;",
                (ALICE.address,),
            )
            old = cur.fetchone()[0]
            cur.execute(
                "insert into social.posts (bitmap_number, author_address, author_role, body, signed_message, signature, created_at) values "
                "(100, %s, 'resident', 'a', 'm', 'event-1', now() - interval '2 days'), (100, %s, 'resident', 'b', 'm', 'event-2', now() - interval '3 days'), "
                "(100, %s, 'visitor', 'c', 'm', 'event-3', now() - interval '3 days'), (100, %s, 'owner', 'd', 'm', 'event-4', now() - interval '2 days'), "
                "(100, %s, 'owner', 'e', 'm', 'event-5', now() - interval '3 days') returning id;",
                (BOB.address, BOB.address, CAROL.address, ALICE.address, ALICE.address),
            )
            posts = [r[0] for r in cur.fetchall()]
        saved, tips.lnurl = tips.lnurl, Fake
        try:
            # The season is over: the winners are frozen (the host doesn't count) and told.
            evs = self.client.get("/v1/districts/100/events").json()
            self.assertEqual(evs["season"], 1)
            ev = evs["events"][0]
            self.assertEqual((ev["id"], ev["status"], ev["since"], ev["until"], ev["total_sats"]), (old, "ended", 0, 2015, 1500))
            self.assertEqual([(w["place"], w["address"], w["score"], w["prize_sats"], w["paid"]) for w in ev["winners"]],
                             [(1, BOB.address, 2, 1000, None), (2, CAROL.address, 1, 500, None)])
            n = next(x for x in self.client.get("/v1/notifications", headers=self.h(BOB)).json()["notifications"] if x["kind"] == "event_win")
            self.assertEqual((n["actor"], n["bitmap_number"], n["block_height"]), (ALICE.address, 100, 0))
            # Only the host pays a prize, and in full; the winner gets it like a tip, and the event shows it paid.
            self.client.put("/v1/me/lightning", json={"lightning_address": "bob@wallet.test"}, headers=self.h(BOB))
            pay = lambda w, **body: self.client.post("/v1/tips", json={"event_id": old, **body}, headers=self.h(w))
            self.assertEqual(pay(CAROL, place=1, amount_sats=1000).status_code, 403)
            self.assertEqual(pay(ALICE, place=1, amount_sats=999).status_code, 400)
            self.assertEqual(pay(ALICE, place=3, amount_sats=1000).status_code, 404)
            self.assertEqual(pay(ALICE, place=2, amount_sats=500).status_code, 409)  # CAROL has no Lightning address
            t = pay(ALICE, place=1, amount_sats=1000).json()
            self.assertEqual(self.client.get("/v1/districts/100/events").json()["events"][0]["winners"][0]["paid"], "pending")
            Fake.paid.add("https://wallet.test/p/1000")
            self.assertEqual(self.client.get(f"/v1/tips/{t['id']}", headers=self.h(ALICE)).json()["status"], "settled")
            self.assertEqual(self.client.get("/v1/districts/100/events").json()["events"][0]["winners"][0]["paid"], "settled")
            self.assertEqual(self.client.get("/v1/districts/100").json()["tips"]["sats30"], 0)  # a prize isn't a tip to the district
            # The owner puts one up for this season: one a season, prizes don't grow down the podium, others can't.
            make = lambda w, **body: self.client.post("/v1/districts/100/events", json=body, headers=self.h(w))
            self.assertEqual(make(BOB, metric="checkins", prizes=[300]).status_code, 403)
            self.assertEqual(make(ALICE, metric="likes", prizes=[300]).status_code, 400)
            self.assertEqual(make(ALICE, metric="checkins", prizes=[100, 500]).status_code, 400)
            self.assertEqual(make(ALICE, metric="checkins", prizes=[50]).status_code, 400)
            now = make(ALICE, metric="checkins", prizes=[300], note=" come by ").json()
            self.assertEqual((now["season"], now["status"], now["note"]), (1, "running", "come by"))
            self.assertEqual(make(ALICE, metric="posts", prizes=[300]).status_code, 409)
            with self.conn.cursor() as cur:
                cur.execute("insert into social.checkins (address, bitmap_number, day) values (%s, 100, (now() at time zone 'utc')::date) on conflict do nothing;", (CAROL.address,))
            running = next(e for e in self.client.get("/v1/events").json()["events"] if e["id"] == now["id"])
            self.assertIn({"address": CAROL.address, "score": 1}, running["standings"])
            self.assertNotIn(ALICE.address, [x["address"] for x in running["standings"]])
            # Called off only before it starts.
            self.assertEqual(self.client.delete(f"/v1/events/{now['id']}", headers=self.h(ALICE)).status_code, 409)
            nxt = make(ALICE, metric="replies", prizes=[2000, 1000, 500], next_season=True).json()
            self.assertEqual((nxt["season"], nxt["status"], nxt["since"]), (2, "upcoming", 4032))
            self.assertEqual(self.client.delete(f"/v1/events/{nxt['id']}", headers=self.h(BOB)).status_code, 403)
            self.assertEqual(self.client.delete(f"/v1/events/{nxt['id']}", headers=self.h(ALICE)).json()["status"], "cancelled")
            self.assertEqual(make(ALICE, metric="replies", prizes=[2000], next_season=True).status_code, 201)
        finally:
            tips.lnurl = saved
            with self.conn.cursor() as cur:
                cur.execute(
                    "delete from bitmap_block_hashes where block_height = 2100; delete from parcel_block_hashes; delete from social.block_draws; "
                    "delete from social.badges; delete from social.seasons; delete from social.events; delete from social.tips; delete from social.lightning_addresses; "
                    "delete from social.notifications where kind in ('treasure', 'lucky', 'crown', 'event_win', 'tip'); "
                    "delete from social.posts where id = any(%s);",
                    (posts,),
                )

    def test_market(self):
        from api import btc, market
        from tests.test_market import FakeChain, SegwitKey, TaprootKey, txid

        seller, buyer, buyer_tr, parcel_buyer = SegwitKey(1), SegwitKey(2), TaprootKey(20), TaprootKey(21)
        self.assertEqual((seller.address(), buyer.address()), (ALICE.address, BOB.address))  # the test wallets' own keys
        fake = FakeChain()
        district_out, parcel_out = f"{txid(0xd100)}:0", f"{txid(0x9001)}:1"
        fake.add(district_out, 546, btc.address_script(ALICE.address, "regtest"), ["d100i0"])
        fake.add(parcel_out, 10_000, btc.address_script(BOB.address, "regtest"), ["p1i0"])
        old_chain, market.chain = market.chain, fake
        with self.conn.cursor() as cur:
            cur.execute("update inscription_owners set outpoint = %s where inscription_id = 'd100i0';", (district_out,))
            cur.execute("update inscription_owners set outpoint = %s where inscription_id = 'p1i0';", (parcel_out,))
        post = lambda w, path, body=None: self.client.post(path, json=body or {}, headers=self.h(w))
        try:
            self.assertFalse(self.client.get("/v1/market").json()["open"])
            self.assertEqual(post(ALICE, "/v1/market/listings/prepare", {"bitmap_number": 100, "price_sats": 50_000, "pay_to": ALICE.address}).status_code, 404)
            os.environ["MARKET_NETWORK"] = "regtest"
            self.assertEqual(self.client.get("/v1/market").json(), {"open": True, "network": "regtest", "fee_bps": 0, "dummy_sats": 600})
            os.environ["MARKET_NETWORK"] = "mainnet"
            self.assertFalse(self.client.get("/v1/market").json()["open"])  # not before the audit
            os.environ.update(MARKET_NETWORK="regtest", MARKET_FEE_BPS="100", MARKET_FEE_ADDRESS=TaprootKey(30).address())

            # Selling: only the holder; the wallet signs input 0 with SIGHASH_SINGLE|ANYONECANPAY.
            ask = {"bitmap_number": 100, "price_sats": 50_000, "pay_to": ALICE.address}
            self.assertEqual(post(BOB, "/v1/market/listings/prepare", ask).status_code, 403)
            self.assertEqual(post(ALICE, "/v1/market/listings/prepare", {**ask, "pay_to": TaprootKey(3).address("tb")}).status_code, 400)
            prep = post(ALICE, "/v1/market/listings/prepare", ask).json()
            self.assertEqual((prep["sign_inputs"], prep["sighash"], prep["postage_sats"]), ([0], 0x83, 546))
            p = btc.Psbt.parse(prep["psbt"])
            self.assertEqual(p.get(0, btc.IN_SIGHASH_TYPE), b"\x83\x00\x00\x00")
            spent = [p.witness_utxo(0)]
            wrong = btc.Psbt.parse(prep["psbt"])
            seller.sign(wrong, 0, spent, btc.SIGHASH_ALL)
            self.assertEqual(post(ALICE, "/v1/market/listings", {"psbt": wrong.b64(), "bitmap_number": 100}).status_code, 400)
            seller.sign(p, 0, spent, btc.SINGLE_ACP)
            cheap = btc.Psbt.parse(p.b64())
            cheap.tx.outputs[0] = btc.TxOut(5_000, cheap.tx.outputs[0].script_pubkey)  # someone lowering the price after signing
            self.assertEqual(post(ALICE, "/v1/market/listings", {"psbt": cheap.b64(), "bitmap_number": 100}).status_code, 400)
            listing = post(ALICE, "/v1/market/listings", {"psbt": p.b64(), "bitmap_number": 100})
            self.assertEqual(listing.status_code, 201, listing.text)
            listing = listing.json()
            self.assertEqual((listing["status"], listing["price_sats"], listing["seller"]), ("active", 50_000, ALICE.address))
            self.assertEqual([x["id"] for x in self.client.get("/v1/market/listings").json()["listings"]], [listing["id"]])
            sale = self.client.get("/v1/land/100").json()["district"]["sale"]
            self.assertEqual((sale["market"], sale["price_sats"], sale["listing_id"]), ("unimap", 50_000, listing["id"]))
            self.assertEqual(self.client.get("/v1/land?start=100&end=100").json()["tiles"][0]["sale"], 50_000)

            # Buying needs two dummies first; the dummy-making transaction pays the buyer only.
            ask_buy = {"payment_address": BOB.address, "receive_address": buyer_tr.address()}
            self.assertEqual(post(ALICE, f"/v1/market/listings/{listing['id']}/quote", ask_buy).status_code, 400)  # your own
            self.assertEqual(post(BOB, f"/v1/market/listings/{listing['id']}/quote", {**ask_buy, "receive_address": BOB.address}).status_code, 400)
            fake.add(f"{txid(0xb0b)}:0", 200_000, btc.address_script(BOB.address, "regtest"))
            r = post(BOB, f"/v1/market/listings/{listing['id']}/quote", ask_buy)
            self.assertEqual(r.status_code, 409)
            self.assertIn("need_dummies", r.json()["detail"])
            d = post(BOB, "/v1/market/dummies", ask_buy).json()
            dp = btc.Psbt.parse(d["psbt"])
            self.assertEqual([o.value for o in dp.tx.outputs[:2]], [600, 600])
            for i in d["sign_inputs"]:
                buyer.sign(dp, i, [dp.witness_utxo(j) for j in range(len(dp.tx.inputs))])
            self.assertEqual(post(BOB, "/v1/market/dummies/broadcast", {"psbt": dp.b64()}).status_code, 200)

            # The quote: dummies, the seller's input at 2, coins; outputs A+B, the inscription, the seller, the fee, new dummies, change.
            q = post(BOB, f"/v1/market/listings/{listing['id']}/quote", ask_buy).json()
            qp = btc.Psbt.parse(q["psbt"])
            outs = [(o.value, o.script_pubkey) for o in qp.tx.outputs]
            bob_spk, tr_spk = btc.address_script(BOB.address, "regtest"), btc.address_script(buyer_tr.address(), "regtest")
            self.assertEqual(outs[:4], [(1200, bob_spk), (546, tr_spk), (50_000, btc.address_script(ALICE.address, "regtest")), (500, btc.address_script(os.environ["MARKET_FEE_ADDRESS"], "regtest"))])
            self.assertEqual(outs[4:6], [(600, bob_spk), (600, bob_spk)])
            self.assertEqual(q["sign_inputs"], [0, 1, 3])
            self.assertEqual(q["total_sats"], 50_000 + 500 + q["network_fee_sats"])
            spent = [qp.witness_utxo(i) for i in range(len(qp.tx.inputs))]
            # A buyer wallet changing the transaction, or signing so outputs can change, is turned away.
            bent = btc.Psbt.parse(q["psbt"])
            bent.tx.outputs[1] = btc.TxOut(546, bob_spk)
            self.assertEqual(post(BOB, f"/v1/market/quotes/{q['quote_id']}/submit", {"psbt": bent.b64()}).status_code, 400)
            loose = btc.Psbt.parse(q["psbt"])
            for i in q["sign_inputs"]:
                buyer.sign(loose, i, spent, btc.SIGHASH_NONE)
            self.assertEqual(post(BOB, f"/v1/market/quotes/{q['quote_id']}/submit", {"psbt": loose.b64()}).status_code, 400)
            for i in q["sign_inputs"]:
                buyer.sign(qp, i, spent)
            self.assertEqual(post(CAROL, f"/v1/market/quotes/{q['quote_id']}/submit", {"psbt": qp.b64()}).status_code, 404)
            r = post(BOB, f"/v1/market/quotes/{q['quote_id']}/submit", {"psbt": qp.b64()})
            self.assertEqual(r.status_code, 200, r.text)
            sale = fake.sent[-1]
            self.assertEqual(r.json()["txid"], sale.txid)
            # The district went to the buyer's taproot address, the price to the seller, nothing anywhere else.
            self.assertEqual(fake.utxos[f"{sale.txid}:1"][1:], [tr_spk, ["d100i0"]])
            self.assertEqual(fake.utxos[f"{sale.txid}:2"][:2], [50_000, btc.address_script(ALICE.address, "regtest")])
            self.assertEqual(sum(len(u[2]) for u in fake.utxos.values()), 2)
            self.assertEqual(self.client.get(f"/v1/market/listings/{listing['id']}").json()["status"], "sold")
            self.assertEqual(post(BOB, f"/v1/market/quotes/{q['quote_id']}/submit", {"psbt": qp.b64()}).status_code, 409)
            n = self.client.get("/v1/notifications", headers=self.h(ALICE)).json()["notifications"][0]
            self.assertEqual((n["kind"], n["actor"], n["bitmap_number"]), ("sold", BOB.address, 100))

            # A parcel, bought from a taproot wallet: its inputs carry the internal key, and it signs with SIGHASH_DEFAULT.
            prep = post(BOB, "/v1/market/listings/prepare", {"bitmap_number": 100, "tx_index": 1, "price_sats": 20_000, "pay_to": BOB.address}).json()
            p = btc.Psbt.parse(prep["psbt"])
            buyer.sign(p, 0, [p.witness_utxo(0)], btc.SINGLE_ACP)
            parcel = post(BOB, "/v1/market/listings", {"psbt": p.b64(), "bitmap_number": 100, "tx_index": 1}).json()
            # Someone looking for a place to live finds it city-wide, and on the district's call for residents.
            found = self.client.get("/v1/market/parcels").json()["parcels"]
            self.assertEqual([(x["id"], x["tx_index"], x["recruiting"]) for x in found], [(parcel["id"], 1, False)])
            self.assertIn("level", found[0])
            self.assertIn("residents", found[0])
            self.assertEqual(self.client.put("/v1/districts/100/recruit", json={"message": "来住"}, headers=self.h(ALICE)).status_code, 200)
            try:
                self.assertTrue(self.client.get("/v1/market/parcels").json()["parcels"][0]["recruiting"])
                self.assertEqual(self.client.get("/v1/districts/100").json()["recruit"]["for_sale"], [{"listing_id": parcel["id"], "tx_index": 1, "price_sats": 20_000, "seller": BOB.address}])
                self.assertEqual(self.client.get("/v1/recruiting").json()["districts"][0]["for_sale"][0]["listing_id"], parcel["id"])
            finally:
                self.client.delete("/v1/districts/100/recruit", headers=self.h(ALICE))
            tr_spk = btc.address_script(parcel_buyer.address(), "regtest")
            for k, v in enumerate((700, 800, 90_000)):
                fake.add(f"{txid(0xca0 + k)}:0", v, tr_spk)
            ask_tr = {"payment_address": parcel_buyer.address(), "payment_public_key": parcel_buyer.internal.hex(), "receive_address": parcel_buyer.address(), "fee_rate": 5}
            q = post(CAROL, f"/v1/market/listings/{parcel['id']}/quote", ask_tr).json()
            qp = btc.Psbt.parse(q["psbt"])
            self.assertEqual(qp.get(0, btc.IN_TAP_INTERNAL_KEY), parcel_buyer.internal)
            spent = [qp.witness_utxo(i) for i in range(len(qp.tx.inputs))]
            for i in q["sign_inputs"]:
                parcel_buyer.sign(qp, i, spent)
            r = post(CAROL, f"/v1/market/quotes/{q['quote_id']}/submit", {"psbt": qp.b64()})
            self.assertEqual(r.status_code, 200, r.text)
            sale = fake.sent[-1]
            self.assertEqual(fake.utxos[f"{sale.txid}:1"][1:], [tr_spk, ["p1i0"]])
            self.assertGreaterEqual(sale.vsize() * 5, q["network_fee_sats"] - 60)  # the estimate is close to what was signed
            self.assertLessEqual(sale.vsize() * 5, q["network_fee_sats"] + 60)

            # A listing whose inscription moved by other means is gone; the seller can take a live one down.
            with self.conn.cursor() as cur:
                cur.execute("update inscription_owners set outpoint = %s, address = %s where inscription_id = 'd100i0';", (f"{fake.sent[0].txid}:9", ALICE.address))
            self.assertEqual(self.client.get("/v1/market/listings").json()["listings"], [])
        finally:
            market.chain = old_chain
            for k in ("MARKET_NETWORK", "MARKET_FEE_BPS", "MARKET_FEE_ADDRESS"):
                os.environ.pop(k, None)
            with self.conn.cursor() as cur:
                cur.execute(
                    "update inscription_owners set outpoint = 'a:0', address = %s where inscription_id = 'd100i0'; "
                    "update inscription_owners set outpoint = 'd:0' where inscription_id = 'p1i0'; "
                    "delete from social.market_quotes; delete from social.market_listings; delete from social.notifications where kind = 'sold';",
                    (ALICE.address,),
                )

    def test_offers(self):
        from api import btc, market
        from tests.test_market import FakeChain, SegwitKey, TaprootKey, txid

        holder, bob, carol, bob_tr, carol_tr = SegwitKey(1), SegwitKey(2), SegwitKey(3), TaprootKey(22), TaprootKey(23)
        spk = lambda a: btc.address_script(a, "regtest")
        fake = FakeChain()
        district_out, parcel_out = f"{txid(0xd101)}:0", f"{txid(0x9002)}:0"
        fake.add(district_out, 546, spk(ALICE.address), ["d100i0"])
        fake.add(parcel_out, 1_000, spk(BOB.address), ["p1i0"])
        for k, (who, value) in enumerate([(BOB, 600), (BOB, 600), (BOB, 100_000), (CAROL, 600), (CAROL, 700), (CAROL, 80_000)]):
            fake.add(f"{txid(0xc000 + k)}:0", value, spk(who.address))
        old_chain, market.chain = market.chain, fake
        with self.conn.cursor() as cur:
            cur.execute("update inscription_owners set outpoint = %s where inscription_id = 'd100i0';", (district_out,))
            cur.execute("update inscription_owners set outpoint = %s where inscription_id = 'p1i0';", (parcel_out,))
        post = lambda w, path, body=None: self.client.post(path, json=body or {}, headers=self.h(w))
        ask = {"bitmap_number": 100, "price_sats": 30_000, "payment_address": BOB.address, "receive_address": bob_tr.address()}
        try:
            self.assertEqual(post(BOB, "/v1/market/offers/prepare", ask).status_code, 404)  # the market is off
            os.environ["MARKET_NETWORK"] = "regtest"
            self.assertEqual(post(ALICE, "/v1/market/offers/prepare", {**ask, "payment_address": ALICE.address}).status_code, 400)  # already hers

            # The buyer signs the whole purchase but the holder's input, paying the holder's address.
            prep = post(BOB, "/v1/market/offers/prepare", ask).json()
            p = btc.Psbt.parse(prep["psbt"])
            self.assertEqual(prep["sign_inputs"], [0, 1, 3])
            self.assertEqual(p.tx.inputs[2].outpoint, district_out)
            self.assertEqual(p.witness_utxo(2), btc.TxOut(546, spk(ALICE.address)))
            self.assertEqual([(o.value, o.script_pubkey) for o in p.tx.outputs[:3]], [(1200, spk(BOB.address)), (546, spk(bob_tr.address())), (30_000, spk(ALICE.address))])
            spent = [p.witness_utxo(i) for i in range(len(p.tx.inputs))]
            loose = btc.Psbt.parse(prep["psbt"])
            for i in prep["sign_inputs"]:
                bob.sign(loose, i, spent, btc.SIGHASH_NONE)
            self.assertEqual(post(BOB, f"/v1/market/offers/{prep['offer_id']}/sign", {"psbt": loose.b64()}).status_code, 400)
            for i in prep["sign_inputs"]:
                bob.sign(p, i, spent)
            self.assertEqual(post(CAROL, f"/v1/market/offers/{prep['offer_id']}/sign", {"psbt": p.b64()}).status_code, 404)
            r = post(BOB, f"/v1/market/offers/{prep['offer_id']}/sign", {"psbt": p.b64(), "days": 3})
            self.assertEqual(r.status_code, 200, r.text)
            offer = r.json()
            self.assertEqual((offer["status"], offer["seller"], offer["price_sats"]), ("active", ALICE.address, 30_000))
            self.assertEqual(post(BOB, f"/v1/market/offers/{prep['offer_id']}/sign", {"psbt": p.b64()}).status_code, 409)
            self.assertEqual([o["id"] for o in self.client.get("/v1/market/offers?bitmap_number=100").json()["offers"]], [offer["id"]])
            self.assertEqual([o["id"] for o in self.client.get("/v1/market/offers?mine=true", headers=self.h(ALICE)).json()["offers"]], [offer["id"]])
            n = self.client.get("/v1/notifications", headers=self.h(ALICE)).json()["notifications"][0]
            self.assertEqual((n["kind"], n["actor"], n["bitmap_number"]), ("offer", BOB.address, 100))

            # The holder accepts: their wallet signs input 2 with SIGHASH_ALL, and it goes out.
            self.assertEqual(post(CAROL, f"/v1/market/offers/{offer['id']}/accept/prepare").status_code, 403)
            acc = post(ALICE, f"/v1/market/offers/{offer['id']}/accept/prepare").json()
            self.assertEqual(acc["sign_inputs"], [2])
            ap = btc.Psbt.parse(acc["psbt"])
            self.assertEqual(ap.tx.txid, p.tx.txid)
            wrong = btc.Psbt.parse(acc["psbt"])
            holder.sign(wrong, 2, spent, btc.SINGLE_ACP)
            self.assertEqual(post(ALICE, f"/v1/market/offers/{offer['id']}/accept", {"psbt": wrong.b64()}).status_code, 400)
            holder.sign(ap, 2, spent)
            r = post(ALICE, f"/v1/market/offers/{offer['id']}/accept", {"psbt": ap.b64()})
            self.assertEqual(r.status_code, 200, r.text)
            sale = fake.sent[-1]
            self.assertEqual(fake.utxos[f"{sale.txid}:1"][1:], [spk(bob_tr.address()), ["d100i0"]])
            self.assertEqual(fake.utxos[f"{sale.txid}:2"][:2], [30_000, spk(ALICE.address)])
            self.assertEqual(post(ALICE, f"/v1/market/offers/{offer['id']}/accept", {"psbt": ap.b64()}).status_code, 409)
            n = self.client.get("/v1/notifications", headers=self.h(BOB)).json()["notifications"][0]
            self.assertEqual((n["kind"], n["actor"]), ("offer_accepted", ALICE.address))

            # A parcel: the holder turns one offer down; another dies when the buyer's coins move.
            carol_ask = {"bitmap_number": 100, "tx_index": 1, "price_sats": 5_000, "payment_address": CAROL.address, "receive_address": carol_tr.address()}

            def make_offer():
                prep = post(CAROL, "/v1/market/offers/prepare", carol_ask).json()
                cp = btc.Psbt.parse(prep["psbt"])
                cs = [cp.witness_utxo(i) for i in range(len(cp.tx.inputs))]
                for i in prep["sign_inputs"]:
                    carol.sign(cp, i, cs)
                return post(CAROL, f"/v1/market/offers/{prep['offer_id']}/sign", {"psbt": cp.b64()}).json(), cp

            first, _ = make_offer()
            self.assertEqual(self.client.delete(f"/v1/market/offers/{first['id']}", headers=self.h(ALICE)).status_code, 403)
            self.assertEqual(self.client.delete(f"/v1/market/offers/{first['id']}", headers=self.h(BOB)).json()["status"], "declined")
            self.assertEqual(self.client.get("/v1/market/offers?bitmap_number=100").json()["offers"], [])
            second, cp = make_offer()
            fake.utxos.pop(cp.tx.inputs[3].outpoint)  # Carol spent the coins it used
            self.assertEqual(post(BOB, f"/v1/market/offers/{second['id']}/accept/prepare").status_code, 409)
            mine = {o["id"]: o["status"] for o in self.client.get("/v1/market/offers?mine=true", headers=self.h(CAROL)).json()["offers"]}
            self.assertEqual(mine, {first["id"]: "declined", second["id"]: "expired"})
        finally:
            market.chain = old_chain
            os.environ.pop("MARKET_NETWORK", None)
            with self.conn.cursor() as cur:
                cur.execute(
                    "update inscription_owners set outpoint = 'a:0' where inscription_id = 'd100i0'; "
                    "update inscription_owners set outpoint = 'd:0' where inscription_id = 'p1i0'; "
                    "delete from social.market_offers; delete from social.notifications where kind like 'offer%%';"
                )

    def test_park_sale(self):
        from api import btc, market
        from tests.test_market import FakeChain, SegwitKey, TaprootKey, txid

        alice, bob, bob_tr = SegwitKey(1), SegwitKey(2), TaprootKey(24)
        spk = lambda a: btc.address_script(a, "regtest")
        ids = {100: "d100i0", 101: "d101i0", 108: "d108i0"}
        fake = FakeChain()
        outs = {100: (f"{txid(0xa100)}:0", 546), 101: (f"{txid(0xa101)}:1", 546), 108: (f"{txid(0xa108)}:0", 1_000)}
        for n, (op, value) in outs.items():
            fake.add(op, value, spk(ALICE.address), [ids[n]])
        fake.offsets["d108i0"] = 400  # not every inscription sits on its output's first sat
        fake.add(f"{txid(0xa200)}:0", 50_000, spk(ALICE.address))
        for k, value in enumerate([600, 600, 300_000]):
            fake.add(f"{txid(0xb200 + k)}:0", value, spk(BOB.address))
        old_chain, market.chain = market.chain, fake
        post = lambda w, path, body=None: self.client.post(path, json=body or {}, headers=self.h(w))

        def index(outpoint, address=ALICE.address):
            """What the indexer would write once a move or sale is mined."""
            with self.conn.cursor() as cur:
                cur.execute("update inscription_owners set outpoint = %s, address = %s where inscription_id = any(%s);", (outpoint, address, list(ids.values())))

        def move(path):
            prep = post(ALICE, path, {"payment_address": ALICE.address})
            self.assertEqual(prep.status_code, 200, prep.text)
            prep = prep.json()
            p = btc.Psbt.parse(prep["psbt"])
            spent = [p.witness_utxo(i) for i in range(len(p.tx.inputs))]
            for i in prep["sign_inputs"]:
                alice.sign(p, i, spent)
            r = post(ALICE, f"/v1/market/moves/{prep['move_id']}/submit", {"psbt": p.b64()})
            self.assertEqual(r.status_code, 200, r.text)
            self.assertEqual(post(ALICE, f"/v1/market/moves/{prep['move_id']}/submit", {"psbt": p.b64()}).status_code, 409)
            return prep, fake.sent[-1]

        with self.conn.cursor() as cur:
            cur.execute(
                "insert into bitmaps (inscription_id, inscription_number, bitmap_number, block_height) values "
                "('d101i0', 10, 101, 300), ('d108i0', 11, 108, 301) on conflict do nothing;"
                "insert into inscription_owners (inscription_id, created_height, outpoint, address, updated_height) values "
                f"('d101i0', 300, 'e:0', '{ALICE.address}', 300), ('d108i0', 301, 'f:0', '{ALICE.address}', 301) on conflict do nothing;"
            )
            for n, (op, _) in outs.items():
                cur.execute("update inscription_owners set outpoint = %s where inscription_id = %s;", (op, ids[n]))
        park = post(ALICE, "/v1/parks", {"name": "打包园", "members": [100, 101, 108]}).json()
        sale = f"/v1/market/parks/{park['id']}"
        try:
            os.environ["MARKET_NETWORK"] = "regtest"
            self.assertFalse(self.client.get(sale).json()["packed"])
            ask = {"price_sats": 200_000, "pay_to": ALICE.address}
            self.assertEqual(post(ALICE, f"{sale}/listing/prepare", ask).status_code, 409)  # three outputs can't be listed as one
            self.assertEqual(post(BOB, f"{sale}/pack", {"payment_address": BOB.address}).status_code, 403)

            # Pack: the three outputs, in order, into one at Alice's address; her coin pays the miners.
            prep, tx = move(f"{sale}/pack")
            self.assertEqual(prep["own_inputs"], [0, 1, 2])
            self.assertEqual([t.outpoint for t in tx.inputs[:3]], [outs[n][0] for n in (100, 101, 108)])
            self.assertEqual((tx.outputs[0].value, tx.outputs[0].script_pubkey), (2_092, spk(ALICE.address)))
            self.assertEqual(sorted(fake.utxos[f"{tx.txid}:0"][2]), sorted(ids.values()))
            self.assertEqual(fake.satpoint("d108i0"), f"{tx.txid}:0:1492")
            index(f"{tx.txid}:0")
            self.assertTrue(self.client.get(sale).json()["packed"])
            self.assertEqual(post(ALICE, f"{sale}/pack", {"payment_address": ALICE.address}).status_code, 409)
            self.assertEqual(post(ALICE, "/v1/market/listings/prepare", {"bitmap_number": 100, **ask}).status_code, 409)  # not on its own any more

            # Unpack: one output per district again, each starting at its district's sat.
            _, tx = move(f"{sale}/unpack")
            self.assertEqual([o.value for o in tx.outputs[:3]], [546, 946, 600])
            self.assertEqual([fake.utxos[f"{tx.txid}:{k}"][2] for k in range(3)], [["d100i0"], ["d101i0"], ["d108i0"]])
            with self.conn.cursor() as cur:
                for k, n in enumerate((100, 101, 108)):
                    cur.execute("update inscription_owners set outpoint = %s where inscription_id = %s;", (f"{tx.txid}:{k}", ids[n]))
            _, tx = move(f"{sale}/pack")
            packed = f"{tx.txid}:0"
            index(packed)

            # List the park: one signature over the one output, like a district.
            prep = post(ALICE, f"{sale}/listing/prepare", ask).json()
            self.assertEqual((prep["members"], prep["postage_sats"]), ([100, 101, 108], 2_092))
            p = btc.Psbt.parse(prep["psbt"])
            alice.sign(p, 0, [p.witness_utxo(0)], btc.SINGLE_ACP)
            self.assertEqual(post(BOB, f"{sale}/listing", {"psbt": p.b64()}).status_code, 403)
            r = post(ALICE, f"{sale}/listing", {"psbt": p.b64()})
            self.assertEqual(r.status_code, 201, r.text)
            listing = r.json()
            self.assertEqual((listing["park_id"], listing["members"], listing["price_sats"]), (park["id"], [100, 101, 108], 200_000))
            self.assertEqual(self.client.get(sale).json()["listing"]["id"], listing["id"])
            self.assertEqual([l["id"] for l in self.client.get("/v1/market/listings?bitmap_number=108").json()["listings"]], [listing["id"]])
            self.assertIsNone(self.client.get("/v1/land/100").json()["district"]["sale"])  # the district itself isn't for sale alone

            # Bob buys it like any listing, and the park is his.
            q = post(BOB, f"/v1/market/listings/{listing['id']}/quote", {"payment_address": BOB.address, "receive_address": bob_tr.address()}).json()
            bp = btc.Psbt.parse(q["psbt"])
            spent = [bp.witness_utxo(i) for i in range(len(bp.tx.inputs))]
            for i in q["sign_inputs"]:
                bob.sign(bp, i, spent)
            r = post(BOB, f"/v1/market/quotes/{q['quote_id']}/submit", {"psbt": bp.b64()})
            self.assertEqual(r.status_code, 200, r.text)
            bought = fake.sent[-1]
            self.assertEqual(fake.utxos[f"{bought.txid}:1"][1], spk(bob_tr.address()))
            self.assertEqual(sorted(fake.utxos[f"{bought.txid}:1"][2]), sorted(ids.values()))
            self.assertEqual(fake.utxos[f"{bought.txid}:2"][:2], [200_000, spk(ALICE.address)])
            index(f"{bought.txid}:1", bob_tr.address())
            now = self.client.get(f"/v1/parks/{park['id']}").json()
            self.assertEqual((now["owner"], now["members"]), (bob_tr.address(), [100, 101, 108]))
            self.assertIsNone(self.client.get(sale).json()["listing"])
        finally:
            market.chain = old_chain
            os.environ.pop("MARKET_NETWORK", None)
            with self.conn.cursor() as cur:
                cur.execute(
                    "update inscription_owners set outpoint = 'a:0', address = %s where inscription_id = 'd100i0'; "
                    "delete from inscription_owners where inscription_id in ('d101i0', 'd108i0'); "
                    "delete from bitmaps where inscription_id in ('d101i0', 'd108i0'); "
                    "delete from social.park_members where park_id = %s; delete from social.parks where id = %s; "
                    "delete from social.market_listings; delete from social.market_quotes; delete from social.market_moves; "
                    "delete from social.notifications where kind = 'sold';",
                    (ALICE.address, park["id"], park["id"]),
                )

    def test_agent(self):
        import hashlib

        from coincurve import PublicKeyXOnly

        from api import agent, tips

        class FakeModel:
            """Answers each turn from a script of tool calls, and keeps what it was shown."""

            def __init__(self, script):
                self.script, self.seen = list(script), []

            def __call__(self, system, messages, tools):
                self.seen.append((system, [m for m in messages]))
                calls = self.script.pop(0) if self.script else []
                content = [{"type": "tool_use", "id": f"t{len(self.seen)}{i}", "name": name, "input": args}
                           for i, (name, args) in enumerate(calls)]
                return {"content": content or [{"type": "text", "text": "done"}], "stop_reason": "tool_use" if calls else "end_turn"}

        class Lnurl:
            paid = set()

            @staticmethod
            def ask_invoice(a, sats, comment):
                return f"lnbc{sats * 10}n1agent", f"https://wallet.test/agent/{sats}"

            @staticmethod
            def settled(url):
                return url in Lnurl.paid

        post = lambda w, path, body=None: self.client.post(path, json=body, headers=self.h(w))
        view = lambda w=ALICE: self.client.get(f"/v1/districts/{DISTRICT}/agent", headers=self.h(w))
        old_model, old_lnurl = agent.model, tips.lnurl
        tips.lnurl = Lnurl
        try:
            self.assertFalse(self.client.get("/v1/agent").json()["open"])
            self.assertEqual(post(ALICE, f"/v1/districts/{DISTRICT}/agent/prepare", {}).status_code, 503)
            os.environ["ANTHROPIC_API_KEY"] = "test"
            self.assertTrue(self.client.get("/v1/agent").json()["open"])

            # Only the owner grants it, with their own signature over the grant.
            self.assertEqual(post(BOB, f"/v1/districts/{DISTRICT}/agent/prepare", {}).status_code, 403)
            self.assertEqual(post(ALICE, f"/v1/districts/{DISTRICT}/agent/prepare", {"posts_per_day": 11}).status_code, 422)
            g = post(ALICE, f"/v1/districts/{DISTRICT}/agent/prepare", {"posts_per_day": 2, "days": 10}).json()
            self.assertIn(f"district: {DISTRICT}.bitmap", g["message"])
            self.assertIn("posts per day: 2", g["message"])
            self.assertEqual(post(ALICE, f"/v1/districts/{DISTRICT}/agent", {"id": g["id"], "signature": BOB.sign(g["message"])}).status_code, 401)
            self.assertEqual(post(BOB, f"/v1/districts/{DISTRICT}/agent", {"id": g["id"], "signature": BOB.sign(g["message"])}).status_code, 403)
            r = post(ALICE, f"/v1/districts/{DISTRICT}/agent", {"id": g["id"], "signature": ALICE.sign(g["message"])})
            self.assertEqual(r.status_code, 200, r.text)
            me = r.json()["agent"]
            self.assertEqual((me["posts_per_day"], me["problem"], me["tasks"]), (2, None, ["welcome", "digest", "answers"]))
            self.assertEqual(view(BOB).status_code, 403)
            r = self.client.put(f"/v1/districts/{DISTRICT}/agent/settings", json={"persona": "叫我们的街「百号街」。", "tasks": ["welcome", "answers", "digest"]},
                                headers=self.h(ALICE))
            self.assertEqual(r.json()["agent"]["persona"], "叫我们的街「百号街」。")

            # Something new: a resident moves in, and someone asks a question under the owner's post.
            top = self.post(ALICE, "周六下午在市政厅喝茶。").json()
            question = self.post(BOB, "几点开始？", reply_to=top["id"]).json()
            with self.conn.cursor() as cur:
                cur.execute("insert into land_events (block_height, block_time, kind, inscription_id, bitmap_number, tx_index, to_address) "
                            "values (1000, extract(epoch from now())::int8, 'parcel_claimed', 'p9i0', %s, 9, %s);", (DISTRICT, CAROL.address))
            agent.model = fake = FakeModel([
                [("read_posts", {"limit": 5}), ("district_facts", {})],
                [("draft_post", {"task": "welcome", "body": "欢迎新邻居！", "why": "a new resident"}),
                 ("draft_reply", {"task": "answers", "post_id": top["id"], "body": "下午三点。", "why": "Bob asked when"}),
                 ("draft_reply", {"task": "answers", "post_id": 999999, "body": "x", "why": "no such post"}),
                 ("draft_post", {"task": "digest", "body": "本周百号街：一位新居民。", "why": "weekly digest"}),
                 ("remember", {"note": "主人喜欢周六喝茶"})],
                [("draft_post", {"task": "digest", "body": "one too many", "why": ""})],
            ])
            out = agent.run(me["id"])
            self.assertEqual((out["drafts"], out["error"]), (3, None))
            self.assertIsNone(agent.run(me["id"]))  # it just looked
            system, messages = fake.seen[0]
            self.assertIn("百号街", system)
            self.assertIn(CAROL.address[:6], messages[0]["content"])
            self.assertIn("几点开始", messages[0]["content"])
            self.assertIn("[digest]", messages[0]["content"])
            facts = json.loads(fake.seen[1][1][-1]["content"][1]["content"])
            self.assertEqual(facts["posts_last_7_days"], 1)
            refused = [json.loads(c["content"]) for c in fake.seen[2][1][-1]["content"]]
            self.assertIn("error", refused[2])
            self.assertIn("error", json.loads(fake.seen[3][1][-1]["content"][0]["content"]))  # a fourth draft
            v = view().json()
            drafts = {d["task"]: d for d in v["drafts"]}
            self.assertEqual(sorted(drafts), ["answers", "digest", "welcome"])
            self.assertEqual(drafts["answers"]["reply_to"], top["id"])
            self.assertEqual(v["agent"]["memory"], ["主人喜欢周六喝茶"])
            n = self.client.get("/v1/notifications", headers=self.h(ALICE)).json()["notifications"]
            self.assertIn(("agent_draft", DISTRICT), [(x["kind"], x["bitmap_number"]) for x in n])

            # Nothing new, nothing to do: the model isn't asked again.
            with self.conn.cursor() as cur:
                cur.execute("update social.agents set last_run_at = now() - interval '2 hours' where id = %s;", (me["id"],))
            fake.seen.clear()
            self.assertEqual(agent.run(me["id"])["drafts"], 0)
            self.assertEqual(fake.seen, [])
            self.assertEqual(post(ALICE, f"/v1/districts/{DISTRICT}/agent/run").status_code, 429)  # it just looked
            with self.conn.cursor() as cur:
                cur.execute("update social.agents set last_run_at = now() - interval '11 minutes' where id = %s;", (me["id"],))
            self.assertEqual(post(ALICE, f"/v1/districts/{DISTRICT}/agent/run").status_code, 202)
            self.assertIsNone(view().json()["agent"]["last"]["error"])

            # The owner approves, maybe after an edit; the post is signed by the agent's key under the grant.
            self.assertEqual(post(BOB, f"/v1/agent/drafts/{drafts['answers']['id']}/publish", {}).status_code, 403)
            r = post(ALICE, f"/v1/agent/drafts/{drafts['answers']['id']}/publish", {"body": "下午三点，市政厅见。"})
            self.assertEqual(r.status_code, 201, r.text)
            p = r.json()
            self.assertEqual((p["body"], p["reply_to"], p["author"]["address"], p["agent"]["grant_id"]), ("下午三点，市政厅见。", top["id"], ALICE.address, me["id"]))
            self.assertTrue(PublicKeyXOnly(bytes.fromhex(p["agent"]["key"])).verify(bytes.fromhex(p["signature"]), hashlib.sha256(p["signed_message"].encode()).digest()))
            self.assertIn(f"grant: {me['id']}", p["signed_message"])
            self.assertTrue(p["signed_message"].endswith("下午三点，市政厅见。"))
            record = self.client.get(f"/v1/agent/grants/{me['id']}").json()
            self.assertTrue(bip322.verify(record["owner"], record["message"], record["signature"]))
            self.assertIn(f"agent key: {p['agent']['key']}", record["message"])
            n = self.client.get("/v1/notifications", headers=self.h(BOB)).json()["notifications"][0]
            self.assertEqual((n["kind"], n["post_id"]), ("reply", p["id"]))
            self.assertEqual(post(ALICE, f"/v1/agent/drafts/{drafts['answers']['id']}/publish", {}).status_code, 409)
            # The grant's daily limit holds.
            self.assertEqual(post(ALICE, f"/v1/agent/drafts/{drafts['welcome']['id']}/publish", {}).status_code, 201)
            with self.conn.cursor() as cur:
                cur.execute("insert into social.agent_drafts (agent_id, bitmap_number, body, task) values (%s, %s, 'extra', 'digest') returning id;",
                            (me["id"], DISTRICT))
                extra = cur.fetchone()[0]
            self.assertEqual(post(ALICE, f"/v1/agent/drafts/{extra}/publish", {}).status_code, 429)
            self.assertEqual(self.client.delete(f"/v1/agent/drafts/{extra}", headers=self.h(ALICE)).status_code, 200)
            self.assertEqual(post(ALICE, f"/v1/agent/drafts/{extra}/publish", {}).status_code, 409)
            self.assertEqual(view().json()["agent"]["posted_today"], 2)

            # Watching nearby listings: told once per district.
            self.client.put(f"/v1/districts/{DISTRICT}/agent/settings", json={"persona": "叫我们的街「百号街」。", "watch": {"radius": 10, "max_price_sats": 1000}},
                            headers=self.h(ALICE))
            with self.conn.cursor() as cur:
                cur.execute("insert into social.listings values ('d105i0', 900, %s, 'magiceden', null); "
                            "insert into social.listings_checked values ('magiceden', now(), now()) on conflict (market) do update set ok_at = now();",
                            (CAROL.address,))
            with self.conn.cursor() as cur:
                a = agent._row(cur, "id = %s", (me["id"],))
            self.assertEqual((agent.watch(a), agent.watch(a)), (1, 0))
            n = self.client.get("/v1/notifications", headers=self.h(ALICE)).json()["notifications"][0]
            self.assertEqual((n["kind"], n["bitmap_number"]), ("agent_alert", OTHER))

            # With a price set, it stops until the owner pays; a confirmed payment buys PAID_DAYS.
            os.environ.update(AGENT_PRICE_SATS="2100", AGENT_LIGHTNING_ADDRESS="agents@unimap.test")
            self.assertEqual(view().json()["agent"]["problem"], "unpaid")
            self.assertEqual(post(ALICE, f"/v1/agent/drafts/{drafts['digest']['id']}/publish", {}).status_code, 409)
            bill = post(ALICE, f"/v1/districts/{DISTRICT}/agent/pay").json()
            self.assertEqual((bill["amount_sats"], bill["invoice"]), (2100, "lnbc21000n1agent"))
            status = lambda w: self.client.get(f"/v1/agent/payments/{bill['id']}", headers=self.h(w))
            self.assertEqual(status(BOB).status_code, 404)
            self.assertEqual(status(ALICE).json()["status"], "pending")
            Lnurl.paid.add("https://wallet.test/agent/2100")
            with self.conn.cursor() as cur:
                cur.execute("update social.agent_payments set checked_at = null;")
            self.assertEqual(status(ALICE).json()["status"], "settled")
            v = view().json()["agent"]
            self.assertIsNone(v["problem"])
            self.assertGreater(v["paid_until"], v["granted_at"])

            # A new grant keeps the settings; selling the district ends it.
            g2 = post(ALICE, f"/v1/districts/{DISTRICT}/agent/prepare", {"posts_per_day": 3}).json()
            v = post(ALICE, f"/v1/districts/{DISTRICT}/agent", {"id": g2["id"], "signature": ALICE.sign(g2["message"])}).json()
            self.assertEqual((v["agent"]["id"], v["agent"]["persona"], v["agent"]["problem"], v["drafts"]), (g2["id"], "叫我们的街「百号街」。", None, []))
            self.assertIsNotNone(self.client.get(f"/v1/agent/grants/{me['id']}").json()["revoked_at"])
            with self.conn.cursor() as cur:
                cur.execute("update inscription_owners set address = %s where inscription_id = 'd100i0';", (CAROL.address,))
                a = agent._row(cur, "id = %s", (g2["id"],))
                self.assertEqual(agent.problem(cur, a), "owner_changed")
                cur.execute("update inscription_owners set address = %s where inscription_id = 'd100i0';", (ALICE.address,))
            self.assertEqual(self.client.delete(f"/v1/districts/{DISTRICT}/agent", headers=self.h(ALICE)).status_code, 200)
            self.assertIsNone(view().json()["agent"])
            self.assertIsNone(agent.run(g2["id"], agent.MANUAL_GAP))
            # Switched on again later, it keeps the paid time and the settings, and starts reading from now.
            g3 = post(ALICE, f"/v1/districts/{DISTRICT}/agent/prepare", {}).json()
            v = post(ALICE, f"/v1/districts/{DISTRICT}/agent", {"id": g3["id"], "signature": ALICE.sign(g3["message"])}).json()["agent"]
            self.assertEqual((v["problem"], v["persona"]), (None, "叫我们的街「百号街」。"))
            self.client.delete(f"/v1/districts/{DISTRICT}/agent", headers=self.h(ALICE))
            # Its posts stay, still checkable against the old grant.
            self.assertEqual(self.client.get(f"/v1/posts/{p['id']}").json()["agent"]["grant_id"], me["id"])
        finally:
            agent.model, tips.lnurl = old_model, old_lnurl
            for k in ("ANTHROPIC_API_KEY", "AGENT_PRICE_SATS", "AGENT_LIGHTNING_ADDRESS"):
                os.environ.pop(k, None)
            with self.conn.cursor() as cur:
                cur.execute("delete from social.listings; delete from social.listings_checked; delete from land_events where inscription_id = 'p9i0'; "
                            "delete from social.notifications where kind like 'agent%%';")

    def test_lnurl_checks(self):
        from api import tips

        self.assertEqual(tips.invoice_msat("lnbc5000n1pjqxyz"), 500_000)
        self.assertEqual(tips.invoice_msat("lnbc25u1pjqxyz"), 2_500_000)
        self.assertEqual(tips.invoice_msat("lnbc1m1pjq"), 100_000_000)
        self.assertEqual(tips.invoice_msat("lnbc10p1pjq"), 1)
        self.assertIsNone(tips.invoice_msat("lnbc1pjqxyz"))  # no amount
        self.assertIsNone(tips.invoice_msat("not an invoice"))
        for url in ("http://wallet.test/x", "https://127.0.0.1/x", "https://localhost/x", "https://10.0.0.5/x", "https://[::1]/x"):
            with self.assertRaises(tips.LnurlError, msg=url):
                tips._get(url)

if __name__ == "__main__":
    unittest.main()
