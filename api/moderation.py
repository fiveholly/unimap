"""Reports and site moderation (举报和管理).

Anyone signed in can report a post once, giving a reason. Site admins, the addresses listed
in ADMIN_ADDRESSES (comma separated), see open reports grouped by post and either remove the
post or dismiss the reports; either way every open report on that post is closed. Admins can
also ban an address from posting anywhere, for some days or for good, and lift the ban. A ban
stops every write of text others see (posts and replies, district profiles, polls, recruit
notices and applications, events, park and pet names, shop items, tip comments, time capsules
and private messages): those routes take writer_address instead of current_address. Admins can
also clear a district's bio and cover.

A private message (api/dms.py) or a time capsule's public line (api/capsule.py) is reported the
same way into social.item_reports, and an admin removes it or dismisses the reports.

District owners keep their own tools (removing posts in their district, muting); this is for
what crosses districts: spam, scams and abuse.
"""

import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.auth import current_address, normalize_address
from api.db import cursor

router = APIRouter()

REASONS = ("spam", "abuse", "scam", "other")


def admins():
    return {normalize_address(a) for a in (os.getenv("ADMIN_ADDRESSES") or "").split(",") if a.strip()}


def is_admin(address):
    return bool(address) and address in admins()


def require_admin(address: str = Depends(current_address)):
    if not is_admin(address):
        raise HTTPException(403, "site admins only")
    return address


def banned(cur, address):
    cur.execute(
        "select 1 from social.bans where address = %s and (expires_at is null or expires_at > now());", (address,)
    )
    return cur.fetchone() is not None


def writer_address(address: str = Depends(current_address)):
    """current_address, for routes that write text others see: 403 while the address is banned."""
    with cursor() as cur:
        if banned(cur, address):
            raise HTTPException(403, "this address is banned")
    return address


def muted(cur, bitmap_number, address):
    """True if the district's current owner muted address there; mutes by an earlier owner lapse."""
    cur.execute(
        "select 1 from social.mutes m join bitmaps b on b.bitmap_number = m.bitmap_number "
        "join inscription_owners o on o.inscription_id = b.inscription_id and o.address = m.by_address "
        "where m.bitmap_number = %s and m.address = %s;",
        (bitmap_number, address),
    )
    return cur.fetchone() is not None


class ReportBody(BaseModel):
    reason: str
    note: str = Field(default="", max_length=500)


@router.post("/v1/posts/{post_id}/report")
def report(post_id: int, req: ReportBody, address: str = Depends(current_address)):
    if req.reason not in REASONS:
        raise HTTPException(400, f"reason is one of {', '.join(REASONS)}")
    with cursor() as cur:
        cur.execute("select author_address from social.posts where id = %s and removed_at is null;", (post_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(404, "no such post")
        if row[0] == address:
            raise HTTPException(400, "you can't report your own post")
        # Reporting again updates the reason, and reopens it if an admin dismissed it before.
        cur.execute(
            "insert into social.reports (post_id, reporter, reason, note) values (%s, %s, %s, %s) "
            "on conflict (post_id, reporter) do update set reason = excluded.reason, note = excluded.note, "
            "created_at = now(), resolved_at = null, resolved_by = null, resolution = null;",
            (post_id, address, req.reason, req.note.strip()),
        )
    return {"ok": True}


@router.get("/v1/admin/reports")
def open_reports(_: str = Depends(require_admin)):
    """Posts with open reports, most reported first, each with its reasons and notes."""
    from api.social import POST_COLUMNS, _post

    with cursor(dict_rows=True) as cur:
        cur.execute(
            "select post_id, count(*) as n, max(created_at) as last from social.reports where resolved_at is null "
            "group by post_id order by count(*) desc, max(created_at) desc limit 100;"
        )
        groups = cur.fetchall()
        ids = [g["post_id"] for g in groups]
        if not ids:
            return {"reports": []}
        cur.execute(f"select {POST_COLUMNS} from social.posts p where p.id = any(%(ids)s);", {"ids": ids, "me": None})
        posts = {r["id"]: _post(r) for r in cur.fetchall()}
        cur.execute(
            "select post_id, reporter, reason, note, created_at from social.reports "
            "where resolved_at is null and post_id = any(%s) order by created_at;",
            (ids,),
        )
        details = {}
        for r in cur.fetchall():
            details.setdefault(r["post_id"], []).append(
                {"reporter": r["reporter"], "reason": r["reason"], "note": r["note"], "created_at": r["created_at"].isoformat()}
            )
        cur.execute(
            "select address from social.bans where address = any(%s) and (expires_at is null or expires_at > now());",
            ([p["author"]["address"] for p in posts.values()],),
        )
        bans = {r["address"] for r in cur.fetchall()}
    return {
        "reports": [
            {
                "post": posts[g["post_id"]],
                "count": g["n"],
                "reports": details.get(g["post_id"], []),
                "author_banned": posts[g["post_id"]]["author"]["address"] in bans,
            }
            for g in groups
            if g["post_id"] in posts
        ]
    }


class ResolveBody(BaseModel):
    action: str  # remove | dismiss


@router.post("/v1/admin/reports/{post_id}")
def resolve(post_id: int, req: ResolveBody, admin: str = Depends(require_admin)):
    if req.action not in ("remove", "dismiss"):
        raise HTTPException(400, "action is remove or dismiss")
    with cursor() as cur:
        if req.action == "remove":
            cur.execute(
                "update social.posts set removed_at = now(), removed_by = %s where id = %s and removed_at is null;",
                (admin, post_id),
            )
        cur.execute(
            "update social.reports set resolved_at = now(), resolved_by = %s, resolution = %s "
            "where post_id = %s and resolved_at is null;",
            (admin, "removed" if req.action == "remove" else "dismissed", post_id),
        )
        if cur.rowcount == 0 and req.action == "dismiss":
            raise HTTPException(404, "no open reports on this post")
    return {"ok": True}


class BanBody(BaseModel):
    address: str
    reason: str = Field(default="", max_length=300)
    days: int | None = Field(default=None, ge=1, le=3650)  # none: for good


@router.get("/v1/admin/bans")
def bans(_: str = Depends(require_admin)):
    with cursor() as cur:
        cur.execute(
            "select address, reason, banned_by, created_at, expires_at from social.bans "
            "where expires_at is null or expires_at > now() order by created_at desc;"
        )
        return {
            "bans": [
                {"address": a, "reason": r, "banned_by": b, "created_at": c.isoformat(), "expires_at": e.isoformat() if e else None}
                for a, r, b, c, e in cur.fetchall()
            ]
        }


@router.post("/v1/admin/bans")
def ban(req: BanBody, admin: str = Depends(require_admin)):
    address = normalize_address(req.address)
    if is_admin(address):
        raise HTTPException(400, "can't ban a site admin")
    with cursor() as cur:
        cur.execute(
            "insert into social.bans (address, reason, banned_by, expires_at) values "
            "(%s, %s, %s, case when %s::int is null then null else now() + make_interval(days => %s::int) end) "
            "on conflict (address) do update set reason = excluded.reason, banned_by = excluded.banned_by, "
            "created_at = now(), expires_at = excluded.expires_at;",
            (address, req.reason.strip(), admin, req.days, req.days),
        )
    return {"ok": True}


@router.delete("/v1/admin/bans/{address}")
def unban(address: str, _: str = Depends(require_admin)):
    with cursor() as cur:
        cur.execute("delete from social.bans where address = %s;", (normalize_address(address),))
    return {"ok": True}


@router.delete("/v1/admin/districts/{bitmap_number}/profile")
def clear_profile(bitmap_number: int, admin: str = Depends(require_admin)):
    """Clear a district's bio and cover, say ones a scammer wrote before the ban."""
    with cursor() as cur:
        cur.execute(
            "update social.profiles set bio = '', cover = null, updated_by = %s, updated_at = now() where bitmap_number = %s;",
            (admin, bitmap_number),
        )
        cur.execute(
            "insert into social.moderation (bitmap_number, action, by_address) values (%s, 'admin_clear_profile', %s);",
            (bitmap_number, admin),
        )
    return {"ok": True}


# --- reports on what isn't a post: a private message (api/dms.py) or a capsule's public line (api/capsule.py)

ITEM_KINDS = ("dm", "capsule")


def report_item(cur, kind, item_id, reporter, reason, note):
    assert kind in ITEM_KINDS
    if reason not in REASONS:
        raise HTTPException(400, f"reason is one of {', '.join(REASONS)}")
    cur.execute(
        "insert into social.item_reports (kind, item_id, reporter, reason, note) values (%s, %s, %s, %s, %s) "
        "on conflict (kind, item_id, reporter) do update set reason = excluded.reason, note = excluded.note, "
        "created_at = now(), resolved_at = null, resolved_by = null, resolution = null;",
        (kind, str(item_id), reporter, reason, note.strip()),
    )


@router.get("/v1/admin/item-reports")
def open_item_reports(_: str = Depends(require_admin)):
    """Reported private messages and capsule lines, most reported first, with the text reported.
    Admins see a private message only once its recipient reports it."""
    with cursor() as cur:
        cur.execute(
            "select r.kind, r.item_id, count(*), max(r.created_at), array_agg(r.reason order by r.created_at), "
            "array_agg(r.note order by r.created_at), coalesce(d.sender, c.author), coalesce(d.body, c.line) "
            "from social.item_reports r "
            "left join social.dms d on r.kind = 'dm' and d.id::text = r.item_id and d.removed_at is null "
            "left join social.capsules c on r.kind = 'capsule' and c.ref = r.item_id and c.line is not null "
            "where r.resolved_at is null group by r.kind, r.item_id, d.sender, c.author, d.body, c.line "
            "order by count(*) desc, max(r.created_at) desc limit 100;"
        )
        return {
            "reports": [
                {"kind": k, "item_id": i, "count": n, "last": last.isoformat(), "reasons": reasons, "notes": [x for x in notes if x], "author": who, "text": text}
                for k, i, n, last, reasons, notes, who, text in cur.fetchall()
                if text is not None
            ]
        }


@router.post("/v1/admin/item-reports/{kind}/{item_id}")
def resolve_item(kind: str, item_id: str, req: ResolveBody, admin: str = Depends(require_admin)):
    if kind not in ITEM_KINDS or req.action not in ("remove", "dismiss"):
        raise HTTPException(400, "kind is dm or capsule; action is remove or dismiss")
    with cursor() as cur:
        if req.action == "remove" and kind == "dm":
            cur.execute("update social.dms set removed_at = now() where id::text = %s and removed_at is null;", (item_id,))
        if req.action == "remove" and kind == "capsule":
            cur.execute("update social.capsules set line = null, tag = null, line_removed_by = %s where ref = %s;", (admin, item_id))
        cur.execute(
            "update social.item_reports set resolved_at = now(), resolved_by = %s, resolution = %s "
            "where kind = %s and item_id = %s and resolved_at is null;",
            (admin, "removed" if req.action == "remove" else "dismissed", kind, item_id),
        )
        if cur.rowcount == 0 and req.action == "dismiss":
            raise HTTPException(404, "no open reports on this")
    return {"ok": True}
