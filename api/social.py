"""Social API: district pages, posts and replies, moderation, follows and likes.

Every write checks the author's standing against the indexer tables at that
moment (api/roles.py), so ownership always follows the chain.

Every post carries the author's wallet signature over post_message(...), so a
post can be checked without trusting this server.
"""

import time
from datetime import datetime, timezone

import psycopg2.extras
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from api import bip322, game, holdings, moderation, notify, parks, prosperity, recruit, roles, seasons, style, tips, wallets, xlink
from api.auth import current_address, normalize_address, optional_address
from api.db import cursor
from api.land import EVENT_SELECT, _event

router = APIRouter()

MAX_BODY = 2000
MAX_MEDIA = 4
SIGNED_AT_SKEW = 600  # seconds
POSTS_PER_MINUTE = 5
NEIGHBOR_RADIUS = 10


def post_message(bitmap_number, reply_to, as_bitmap, signed_at, media, body):
    """The exact text the wallet signs for a post."""
    lines = [
        "unimap post",
        f"district: {bitmap_number}.bitmap",
        f"reply-to: {reply_to if reply_to is not None else 'none'}",
        f"as: {f'{as_bitmap}.bitmap' if as_bitmap is not None else 'none'}",
        f"time: {signed_at}",
    ]
    lines += [f"media: {url}" for url in media] or ["media: none"]
    return "\n".join(lines) + "\n\n" + body


# --- reads ---------------------------------------------------------------------

POST_COLUMNS = (
    "p.id, p.bitmap_number, p.author_address, p.author_role, p.author_parcel, p.author_bitmap, p.reply_to, "
    "p.body, p.media, p.signed_message, p.signature, p.created_at, p.removed_at, "
    "(select count(*) from social.likes l where l.post_id = p.id) as like_count, "
    "(select count(*) from social.posts r where r.reply_to = p.id and r.removed_at is null) as reply_count, "
    "exists(select 1 from social.likes l where l.post_id = p.id and l.address = %(me)s) as liked_by_me, "
    "(select x.username from social.x_accounts x where x.address = p.author_address) as author_x, "
    "(select coalesce(sum(t.amount_sats), 0) from social.tips t where t.post_id = p.id and t.status = 'settled') "
    "as tips_sats, "
    "exists(select 1 from social.lightning_addresses a where a.address = coalesce("
    "(select w.main_address from social.wallet_links w where w.address = p.author_address), p.author_address)) "
    "as author_tippable "
)


def _post(row):
    removed = row["removed_at"] is not None
    return {
        "id": row["id"],
        "bitmap_number": row["bitmap_number"],
        "author": {
            "address": row["author_address"],
            "role": row["author_role"],
            "parcel": row["author_parcel"],
            "as_bitmap": row["author_bitmap"],
            "x": row["author_x"],  # linked X @username, if any
            "tippable": row["author_tippable"],  # has a Lightning address for tips
        },
        "reply_to": row["reply_to"],
        "body": None if removed else row["body"],
        "media": [] if removed else row["media"],
        "signed_message": None if removed else row["signed_message"],
        "signature": None if removed else row["signature"],
        "created_at": row["created_at"].isoformat(),
        "removed": removed,
        "like_count": row["like_count"],
        "reply_count": row["reply_count"],
        "liked_by_me": row["liked_by_me"],
        "tips_sats": int(row["tips_sats"]),  # confirmed Lightning tips
    }


def _fetch_posts(cur, where, args, me, limit):
    cur.execute(
        f"select {POST_COLUMNS} from social.posts p where {where} order by p.id desc limit %(limit)s;",
        {**args, "me": me, "limit": limit},
    )
    return [_post(r) for r in cur.fetchall()]


def _profile(cur, bitmap_number):
    cur.execute(
        "select bio, cover, visitor_comments_on, pinned_post_id, updated_by, updated_at, style "
        "from social.profiles where bitmap_number = %s;",
        (bitmap_number,),
    )
    row = cur.fetchone()
    if row is None:
        return {"bio": "", "cover": None, "visitor_comments_on": True, "pinned_post_id": None, "style": None}
    return {
        "style": row["style"],
        "bio": row["bio"],
        "cover": row["cover"],
        "visitor_comments_on": row["visitor_comments_on"],
        "pinned_post_id": row["pinned_post_id"],
    }


def _limit(limit):
    return max(1, min(limit, 50))


@router.get("/v1/me")
def me(address: str = Depends(current_address)):
    with cursor() as cur:
        districts, parcels = roles.holdings(cur, address)
        cur.execute("select bitmap_number from social.follows where address = %s order by bitmap_number;", (address,))
        follows = [r[0] for r in cur.fetchall()]
        x = xlink.of(cur, address)
        linked = wallets.view(cur, address)
        is_banned = moderation.banned(cur, address)
    return {
        "address": address,
        "districts": districts,
        "parcels": parcels,
        "follows": follows,
        "x": x,
        "wallets": linked,
        "admin": moderation.is_admin(address),
        "banned": is_banned,
    }


@router.get("/v1/people/{address}")
def person(address: str, before_id: int | None = None, limit: int = 20, viewer: str | None = Depends(optional_address)):
    """Someone's page: the land they hold, their X account and what they posted, newest first."""
    address = normalize_address(address)
    with cursor(dict_rows=True) as cur:
        posts = _fetch_posts(
            cur,
            "p.author_address = %(a)s and p.removed_at is null and (%(before)s::int8 is null or p.id < %(before)s)",
            {"a": address, "before": before_id},
            viewer,
            _limit(limit),
        )
    with cursor() as cur:
        districts, parcels = roles.holdings(cur, address)
        x = xlink.of(cur, address)
        cur.execute(
            "select count(*) filter (where reply_to is null), count(*) filter (where reply_to is not null), "
            "min(created_at) from social.posts where author_address = %s and removed_at is null;",
            (address,),
        )
        post_count, reply_count, first_post = cur.fetchone()
        cur.execute("select count(*) from social.follows where address = %s;", (address,))
        follows = cur.fetchone()[0]
        badges = game.badges_of(cur, address)
        # Score held districts a run at a time, so two far-apart districts don't score everything between.
        levels, park_of, run = {}, {}, []
        for n in districts + [None]:
            if run and (n is None or n - run[0] > 1000):
                lv, po = parks.scored(cur, run[0], run[-1])
                levels.update(lv)
                park_of.update(po)
                run = []
            if n is not None:
                run.append(n)
    return {
        "address": address,
        "x": x,
        "districts": [{"bitmap_number": n, "level": levels.get(n, 0), "park": (park_of.get(n) or {}).get("name")} for n in districts],
        "parcels": parcels,
        "post_count": post_count,
        "reply_count": reply_count,
        "follows": follows,
        "first_post_at": first_post.isoformat() if first_post else None,
        "badges": badges,
        "posts": posts,
    }


@router.get("/v1/districts/{bitmap_number}")
def district(bitmap_number: int, tasks: BackgroundTasks, viewer: str | None = Depends(optional_address)):
    """District page header: profile, owner, the viewer's role, counts."""
    with cursor(dict_rows=True) as cur:
        profile = _profile(cur, bitmap_number)
        owner = roles.district_owner(cur, bitmap_number)
        role, parcel = roles.role_in(cur, viewer, bitmap_number) if viewer else (None, None)
        cur.execute(
            "select (select count(*) from social.follows where bitmap_number = %(n)s) as followers, "
            "(select count(*) from social.posts where bitmap_number = %(n)s and reply_to is null "
            "and removed_at is null) as posts, "
            "exists(select 1 from social.mutes where bitmap_number = %(n)s and address = %(me)s) as muted, "
            "exists(select 1 from social.follows where bitmap_number = %(n)s and address = %(me)s) as following, "
            "exists(select 1 from social.checkins where bitmap_number = %(n)s and address = %(me)s "
            "and day = (now() at time zone 'utc')::date) as checked_in;",
            {"n": bitmap_number, "me": viewer},
        )
        counts = cur.fetchone()
        pinned = None
        if profile["pinned_post_id"] is not None:
            found = _fetch_posts(
                cur, "p.id = %(id)s and p.removed_at is null", {"id": profile["pinned_post_id"]}, viewer, 1
            )
            pinned = found[0] if found else None
    with cursor() as cur:
        prosper = prosperity.of(cur, bitmap_number)
        levels, park_of = parks.scored(cur, bitmap_number, bitmap_number)
        notice = recruit.get(cur, bitmap_number, viewer)
        pets = holdings.shown(cur, bitmap_number, owner)
        owner_x = xlink.of(cur, owner)
        tipped = tips.district_tips(cur, bitmap_number)
        beat = game.district_view(cur, bitmap_number, viewer)
        tip = game.top(cur)
        crown = seasons.crowns(cur, tip).get(bitmap_number) if tip is not None else None
        owner_tippable = tips.lightning_of(cur, owner) is not None
        # Pets on show keep their owner's balances fresh; the page doesn't wait for it.
        if holdings.chosen(cur, bitmap_number, owner) and holdings.stale_group(cur, owner):
            tasks.add_task(holdings.refresh_group, owner, 0, True)
    profile["style"] = style.visible(profile["style"], levels[bitmap_number])
    return {
        "bitmap_number": bitmap_number,
        "name": f"{bitmap_number}.bitmap",
        "owner": owner,
        "owner_x": owner_x,
        "profile": profile,
        "pinned_post": pinned,
        "followers": counts["followers"],
        "post_count": counts["posts"],
        "prosperity": prosper,
        "checked_in_today": counts["checked_in"],
        "level": levels[bitmap_number],
        "park": park_of.get(bitmap_number),
        "recruit": notice,
        "pets": pets,
        "tips": tipped,  # confirmed Lightning tips on the district and its posts, last 30 days
        "owner_tippable": owner_tippable,
        "game": {**beat, "crown": crown and {"rank": crown, "season": tip // seasons.SEASON - 1}},  # api/game.py, api/seasons.py
        "viewer": None
        if viewer is None
        else {
            "address": viewer,
            "role": role,
            "parcel": parcel,
            "muted": counts["muted"],
            "following": counts["following"],
        },
    }


@router.get("/v1/rankings")
def rankings():
    """The liveliest districts by prosperity."""
    with cursor() as cur:
        return {"rankings": prosperity.ranking(cur)}


@router.post("/v1/districts/{bitmap_number}/checkin")
def checkin(bitmap_number: int, address: str = Depends(current_address)):
    """Once a day per signed-in address and district."""
    with cursor() as cur:
        cur.execute("select max(block_height) from bitmap_block_hashes;")
        tip = cur.fetchone()[0]
        if bitmap_number < 0 or tip is None or bitmap_number > tip:
            raise HTTPException(404, "no such block yet")
        cur.execute(
            "insert into social.checkins (address, bitmap_number, day) values (%s, %s, (now() at time zone 'utc')::date) "
            "on conflict do nothing;",
            (address, bitmap_number),
        )
        if cur.rowcount == 0:
            raise HTTPException(409, "already checked in today")
        badges = game.on_checkin(cur, address, bitmap_number)
    return {"ok": True, "badges": badges}


@router.get("/v1/districts/{bitmap_number}/posts")
def district_posts(
    bitmap_number: int, before_id: int | None = None, limit: int = 20, viewer: str | None = Depends(optional_address)
):
    with cursor(dict_rows=True) as cur:
        posts = _fetch_posts(
            cur,
            "p.bitmap_number = %(n)s and p.reply_to is null and p.removed_at is null "
            "and (%(before)s::int8 is null or p.id < %(before)s)",
            {"n": bitmap_number, "before": before_id},
            viewer,
            _limit(limit),
        )
    return {"posts": posts}


@router.get("/v1/posts/{post_id}")
def get_post(post_id: int, viewer: str | None = Depends(optional_address)):
    with cursor(dict_rows=True) as cur:
        found = _fetch_posts(cur, "p.id = %(id)s", {"id": post_id}, viewer, 1)
    if not found:
        raise HTTPException(404, "no such post")
    return found[0]


@router.get("/v1/posts/{post_id}/replies")
def replies(post_id: int, after_id: int | None = None, limit: int = 50, viewer: str | None = Depends(optional_address)):
    """Replies oldest first."""
    with cursor(dict_rows=True) as cur:
        cur.execute(
            f"select {POST_COLUMNS} from social.posts p where p.reply_to = %(id)s and p.removed_at is null "
            "and (%(after)s::int8 is null or p.id > %(after)s) order by p.id limit %(limit)s;",
            {"id": post_id, "after": after_id, "me": viewer, "limit": _limit(limit)},
        )
        return {"replies": [_post(r) for r in cur.fetchall()]}


@router.get("/v1/districts/{bitmap_number}/neighbors")
def neighbors(bitmap_number: int, radius: int = NEIGHBOR_RADIUS, limit: int = 20, viewer: str | None = Depends(optional_address)):
    """Latest posts from districts within radius heights, excluding this one."""
    radius = max(1, min(radius, 100))
    with cursor(dict_rows=True) as cur:
        posts = _fetch_posts(
            cur,
            "p.bitmap_number between %(lo)s and %(hi)s and p.bitmap_number <> %(n)s "
            "and p.reply_to is null and p.removed_at is null",
            {"lo": bitmap_number - radius, "hi": bitmap_number + radius, "n": bitmap_number},
            viewer,
            _limit(limit),
        )
    return {"posts": posts}


@router.get("/v1/feed")
def feed(limit: int = 30, before: float | None = None, address: str = Depends(current_address)):
    """Posts and land events from followed districts, newest first.
    before: unix time; pass the last item's time to page."""
    limit = _limit(limit)
    before = before if before is not None else time.time() + 1
    with cursor(dict_rows=True) as cur:
        cur.execute("select bitmap_number from social.follows where address = %s;", (address,))
        followed = [r["bitmap_number"] for r in cur.fetchall()]
        if not followed:
            return {"items": []}
        posts = _fetch_posts(
            cur,
            "p.bitmap_number = any(%(followed)s) and p.reply_to is null and p.removed_at is null "
            "and p.created_at < to_timestamp(%(before)s)",
            {"followed": followed, "before": before},
            address,
            limit,
        )
    with cursor() as cur:
        cur.execute(
            EVENT_SELECT + "where bitmap_number = any(%s) and block_time < %s order by block_time desc, id desc limit %s;",
            (followed, before, limit),
        )
        events = [_event(r) for r in cur.fetchall()]
    items = [{"type": "post", "time": datetime.fromisoformat(p["created_at"]).timestamp(), "post": p} for p in posts]
    items += [{"type": "event", "time": e["block_time"], "event": e} for e in events]
    items.sort(key=lambda i: i["time"], reverse=True)
    return {"items": items[:limit]}


# --- writes --------------------------------------------------------------------


class NewPost(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_BODY)
    media: list[str] = Field(default_factory=list, max_length=MAX_MEDIA)
    reply_to: int | None = None
    as_bitmap: int | None = None
    signed_at: int
    signature: str


@router.post("/v1/districts/{bitmap_number}/posts", status_code=201)
def create_post(bitmap_number: int, req: NewPost, address: str = Depends(current_address)):
    if any(not url.startswith("https://") or len(url) > 500 or "\n" in url for url in req.media):
        raise HTTPException(400, "media must be https URLs")
    if "\r" in req.body:
        raise HTTPException(400, "use \\n line breaks")
    if abs(time.time() - req.signed_at) > SIGNED_AT_SKEW:
        raise HTTPException(400, "signed_at too far from server time")
    message = post_message(bitmap_number, req.reply_to, req.as_bitmap, req.signed_at, req.media, req.body)
    try:
        if not bip322.verify(address, message, req.signature):
            raise HTTPException(401, "bad post signature")
    except bip322.Unsupported as e:
        raise HTTPException(400, str(e))

    with cursor(dict_rows=True) as cur:
        role, parcel = roles.role_in(cur, address, bitmap_number)
        if moderation.banned(cur, address):
            raise HTTPException(403, "this address is banned from posting")
        cur.execute(
            "select 1 from social.mutes where bitmap_number = %s and address = %s;", (bitmap_number, address)
        )
        if cur.fetchone() is not None:
            raise HTTPException(403, "muted in this district")
        if req.reply_to is None:
            if role == roles.VISITOR:
                raise HTTPException(403, "only the district owner and residents can post; visitors can reply")
        else:
            cur.execute(
                "select bitmap_number, reply_to, removed_at, author_address from social.posts where id = %s;",
                (req.reply_to,),
            )
            parent = cur.fetchone()
            if parent is None or parent["removed_at"] is not None or parent["bitmap_number"] != bitmap_number:
                raise HTTPException(404, "no such post in this district")
            if parent["reply_to"] is not None:
                raise HTTPException(400, "reply to the top-level post")
            if role == roles.VISITOR and not _profile(cur, bitmap_number)["visitor_comments_on"]:
                raise HTTPException(403, "the owner has turned off visitor replies")
        if req.as_bitmap is not None and roles.district_owner(cur, req.as_bitmap) != address:
            raise HTTPException(403, f"you don't hold {req.as_bitmap}.bitmap")
        cur.execute(
            "select count(*) as n from social.posts where author_address = %s and created_at > now() - interval '1 minute';",
            (address,),
        )
        if cur.fetchone()["n"] >= POSTS_PER_MINUTE:
            raise HTTPException(429, "slow down")
        cur.execute(
            "insert into social.posts (bitmap_number, author_address, author_role, author_parcel, author_bitmap, "
            "reply_to, body, media, signed_message, signature) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "on conflict (signature) do nothing returning id;",
            (
                bitmap_number,
                address,
                role,
                parcel,
                req.as_bitmap,
                req.reply_to,
                req.body,
                psycopg2.extras.Json(req.media),
                message,
                req.signature,
            ),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(409, "this signature was already used")
        if req.reply_to is None:
            notify.notify(cur, roles.district_owner(cur, bitmap_number), "post", address, bitmap_number, row["id"])
        else:
            notify.notify(cur, parent["author_address"], "reply", address, bitmap_number, row["id"])
        return _fetch_posts(cur, "p.id = %(id)s", {"id": row["id"]}, address, 1)[0]


_require_owner = roles.require_owner


def _log(cur, bitmap_number, action, by, target=None, post_id=None):
    cur.execute(
        "insert into social.moderation (bitmap_number, action, target_address, post_id, by_address) "
        "values (%s, %s, %s, %s, %s);",
        (bitmap_number, action, target, post_id, by),
    )


@router.delete("/v1/posts/{post_id}")
def remove_post(post_id: int, address: str = Depends(current_address)):
    """The author or the district's current owner can remove a post."""
    with cursor(dict_rows=True) as cur:
        cur.execute("select bitmap_number, author_address, removed_at from social.posts where id = %s;", (post_id,))
        post = cur.fetchone()
        if post is None or post["removed_at"] is not None:
            raise HTTPException(404, "no such post")
        if post["author_address"] != address:
            _require_owner(cur, post["bitmap_number"], address)
            _log(cur, post["bitmap_number"], "remove_post", address, post["author_address"], post_id)
        cur.execute(
            "update social.posts set removed_at = now(), removed_by = %s where id = %s;", (address, post_id)
        )
    return {"ok": True}


class ProfileUpdate(BaseModel):
    bio: str | None = Field(default=None, max_length=1000)
    cover: str | None = Field(default=None, max_length=500)
    visitor_comments_on: bool | None = None


@router.put("/v1/districts/{bitmap_number}/profile")
def update_profile(bitmap_number: int, req: ProfileUpdate, address: str = Depends(current_address)):
    if req.cover is not None and req.cover and not req.cover.startswith("https://"):
        raise HTTPException(400, "cover must be an https URL")
    with cursor(dict_rows=True) as cur:
        _require_owner(cur, bitmap_number, address)
        current = _profile(cur, bitmap_number)
        merged = {
            "bio": current["bio"] if req.bio is None else req.bio,
            "cover": current["cover"] if req.cover is None else (req.cover or None),
            "visitor_comments_on": current["visitor_comments_on"]
            if req.visitor_comments_on is None
            else req.visitor_comments_on,
        }
        cur.execute(
            "insert into social.profiles (bitmap_number, bio, cover, visitor_comments_on, updated_by) "
            "values (%(n)s, %(bio)s, %(cover)s, %(v)s, %(by)s) on conflict (bitmap_number) do update set "
            "bio = excluded.bio, cover = excluded.cover, visitor_comments_on = excluded.visitor_comments_on, "
            "updated_by = excluded.updated_by, updated_at = now();",
            {"n": bitmap_number, "bio": merged["bio"], "cover": merged["cover"], "v": merged["visitor_comments_on"], "by": address},
        )
        _log(cur, bitmap_number, "profile", address)
        return _profile(cur, bitmap_number)


class Pin(BaseModel):
    post_id: int


def _set_pin(cur, bitmap_number, post_id, address):
    cur.execute(
        "insert into social.profiles (bitmap_number, pinned_post_id, updated_by) values (%s, %s, %s) "
        "on conflict (bitmap_number) do update set pinned_post_id = excluded.pinned_post_id, "
        "updated_by = excluded.updated_by, updated_at = now();",
        (bitmap_number, post_id, address),
    )


@router.put("/v1/districts/{bitmap_number}/pin")
def pin(bitmap_number: int, req: Pin, address: str = Depends(current_address)):
    with cursor(dict_rows=True) as cur:
        _require_owner(cur, bitmap_number, address)
        cur.execute(
            "select 1 from social.posts where id = %s and bitmap_number = %s and reply_to is null and removed_at is null;",
            (req.post_id, bitmap_number),
        )
        if cur.fetchone() is None:
            raise HTTPException(404, "no such post in this district")
        _set_pin(cur, bitmap_number, req.post_id, address)
        _log(cur, bitmap_number, "pin", address, post_id=req.post_id)
    return {"ok": True}


@router.delete("/v1/districts/{bitmap_number}/pin")
def unpin(bitmap_number: int, address: str = Depends(current_address)):
    with cursor(dict_rows=True) as cur:
        _require_owner(cur, bitmap_number, address)
        _set_pin(cur, bitmap_number, None, address)
        _log(cur, bitmap_number, "unpin", address)
    return {"ok": True}


@router.get("/v1/districts/{bitmap_number}/mutes")
def list_mutes(bitmap_number: int, address: str = Depends(current_address)):
    with cursor(dict_rows=True) as cur:
        _require_owner(cur, bitmap_number, address)
        cur.execute(
            "select address, by_address, created_at from social.mutes where bitmap_number = %s order by created_at;",
            (bitmap_number,),
        )
        return {"mutes": [{**r, "created_at": r["created_at"].isoformat()} for r in cur.fetchall()]}


@router.put("/v1/districts/{bitmap_number}/mutes/{target}")
def mute(bitmap_number: int, target: str, address: str = Depends(current_address)):
    target = normalize_address(target)
    with cursor(dict_rows=True) as cur:
        _require_owner(cur, bitmap_number, address)
        if target == address:
            raise HTTPException(400, "you can't mute yourself")
        cur.execute(
            "insert into social.mutes (bitmap_number, address, by_address) values (%s, %s, %s) on conflict do nothing;",
            (bitmap_number, target, address),
        )
        _log(cur, bitmap_number, "mute", address, target)
    return {"ok": True}


@router.delete("/v1/districts/{bitmap_number}/mutes/{target}")
def unmute(bitmap_number: int, target: str, address: str = Depends(current_address)):
    target = normalize_address(target)
    with cursor(dict_rows=True) as cur:
        _require_owner(cur, bitmap_number, address)
        cur.execute("delete from social.mutes where bitmap_number = %s and address = %s;", (bitmap_number, target))
        _log(cur, bitmap_number, "unmute", address, target)
    return {"ok": True}


@router.put("/v1/districts/{bitmap_number}/follow")
def follow(bitmap_number: int, address: str = Depends(current_address)):
    with cursor() as cur:
        cur.execute(
            "insert into social.follows (address, bitmap_number) values (%s, %s) on conflict do nothing;",
            (address, bitmap_number),
        )
        notify.notify(cur, roles.district_owner(cur, bitmap_number), "follow", address, bitmap_number)
    return {"ok": True}


@router.delete("/v1/districts/{bitmap_number}/follow")
def unfollow(bitmap_number: int, address: str = Depends(current_address)):
    with cursor() as cur:
        cur.execute("delete from social.follows where address = %s and bitmap_number = %s;", (address, bitmap_number))
    return {"ok": True}


@router.put("/v1/posts/{post_id}/like")
def like(post_id: int, address: str = Depends(current_address)):
    with cursor() as cur:
        cur.execute(
            "select author_address, bitmap_number from social.posts where id = %s and removed_at is null;", (post_id,)
        )
        post = cur.fetchone()
        if post is None:
            raise HTTPException(404, "no such post")
        cur.execute(
            "insert into social.likes (address, post_id) values (%s, %s) on conflict do nothing;", (address, post_id)
        )
        notify.notify(cur, post[0], "like", address, post[1], post_id)
    return {"ok": True}


@router.delete("/v1/posts/{post_id}/like")
def unlike(post_id: int, address: str = Depends(current_address)):
    with cursor() as cur:
        cur.execute("delete from social.likes where address = %s and post_id = %s;", (address, post_id))
    return {"ok": True}
