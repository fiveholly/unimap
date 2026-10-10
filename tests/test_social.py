"""Social API against a real Postgres. Set TEST_PGURL to an empty, throwaway
database (its tables are dropped and recreated), e.g.
TEST_PGURL=postgresql://postgres:postgres@localhost/unimap_test"""

import base64
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
