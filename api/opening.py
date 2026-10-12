"""开张: getting an empty district going.

A district starts with no bio, no posts and nobody living there, and visitors who find it leave.
Its owner gets three steps (STEPS): write the bio, make the first post, and post a notice for
residents. All three done by the owner who holds it now earns the 开张 badge (kind 'opening',
height = the district number, so one per owner and district) and lists the district under
新开张的街区 on the home page for OPENED_DAYS days, so visitors have somewhere new to go.
"""

from fastapi import APIRouter, Depends

from api import roles
from api.auth import current_address
from api.db import cursor

router = APIRouter()

STEPS = ("bio", "post", "recruit")
OPENED_DAYS = 7
OPENED_LIST = 12


def steps(cur, n, owner):
    """{step: done} for the owner who holds n now."""
    cur.execute(
        "select "
        "exists(select 1 from social.profiles where bitmap_number = %(n)s and updated_by = %(o)s and bio <> ''), "
        "exists(select 1 from social.posts where bitmap_number = %(n)s and author_address = %(o)s "
        "and reply_to is null and removed_at is null), "
        "exists(select 1 from social.recruitments where bitmap_number = %(n)s and created_by = %(o)s);",
        {"n": n, "o": owner},
    )
    return dict(zip(STEPS, cur.fetchone()))


def check(cur, n, owner):
    """Steps, and the badge when they are all done: (steps, badge or None, new)."""
    done = steps(cur, n, owner)
    cur.execute("select id, created_at from social.badges where kind = 'opening' and height = %s and address = %s;", (n, owner))
    row = cur.fetchone()
    new = False
    if row is None and all(done.values()):
        cur.execute(
            "insert into social.badges (address, kind, height, bitmap_number, rarity) values (%s, 'opening', %s, %s, 'rare') "
            "on conflict do nothing returning id, created_at;",
            (owner, n, n),
        )
        row = cur.fetchone()
        new = row is not None
    badge = {"kind": "opening", "height": n, "bitmap_number": n, "rarity": "rare", "created_at": row[1].isoformat()} if row else None
    return done, badge, new


@router.get("/v1/districts/{bitmap_number}/opening")
def opening(bitmap_number: int, address: str = Depends(current_address)):
    """The owner's steps to opening the district."""
    with cursor() as cur:
        roles.require_owner(cur, bitmap_number, address)
        done, badge, new = check(cur, bitmap_number, address)
        return {"steps": done, "opened": badge is not None, "badge": badge, "new": new}


@router.get("/v1/opened")
def opened():
    """新开张的街区: opened in the last OPENED_DAYS days by the owner who still holds them, newest first."""
    with cursor() as cur:
        cur.execute(
            "select b.bitmap_number, b.created_at, p.bio, "
            "(select count(*) from social.posts s where s.bitmap_number = b.bitmap_number and s.reply_to is null and s.removed_at is null) "
            "from social.badges b join bitmaps m on m.bitmap_number = b.bitmap_number "
            "join inscription_owners o on o.inscription_id = m.inscription_id and o.address = b.address "
            "left join social.profiles p on p.bitmap_number = b.bitmap_number "
            "where b.kind = 'opening' and b.created_at > now() - make_interval(days => %s) "
            "order by b.created_at desc limit %s;",
            (OPENED_DAYS, OPENED_LIST),
        )
        return {
            "districts": [
                {"bitmap_number": n, "opened_at": at.isoformat(), "bio": (bio or "")[:80], "posts": posts}
                for n, at, bio, posts in cur.fetchall()
            ]
        }
