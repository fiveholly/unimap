"""District polls (街区投票): the owner asks a question with two to four answers; the owner
and the residents each have one vote, which they can change until the poll closes. Anyone
can see the results. Standing is checked when the vote is cast."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import roles
from api.auth import current_address, optional_address
from api.db import cursor

router = APIRouter()

MAX_DAYS = 30
LIST_SIZE = 10


def _poll(row, now):
    pid, n, question, options, created_by, created_at, closes_at, closed_at, counts, mine = row
    tally = [0] * len(options)
    for option, count in counts or []:
        if 0 <= option < len(tally):
            tally[option] = count
    end = closed_at or closes_at
    return {
        "id": pid,
        "bitmap_number": n,
        "question": question,
        "options": options,
        "counts": tally,
        "total": sum(tally),
        "my_vote": mine,
        "created_by": created_by,
        "created_at": created_at.isoformat(),
        "closes_at": end.isoformat(),
        "closed": end <= now,
    }


SELECT = (
    "select p.id, p.bitmap_number, p.question, p.options, p.created_by, p.created_at, p.closes_at, p.closed_at, "
    "(select array_agg(array[v.option, c]) from (select option, count(*)::int as c from social.poll_votes "
    " where poll_id = p.id group by option) v), "
    "(select option from social.poll_votes where poll_id = p.id and address = %(me)s) "
    "from social.polls p "
)


@router.get("/v1/districts/{bitmap_number}/polls")
def polls(bitmap_number: int, viewer: str | None = Depends(optional_address)):
    """The district's polls, newest first."""
    with cursor() as cur:
        cur.execute(
            SELECT + "where p.bitmap_number = %(n)s order by p.id desc limit %(limit)s;",
            {"me": viewer, "n": bitmap_number, "limit": LIST_SIZE},
        )
        now = datetime.now(timezone.utc)
        return {"polls": [_poll(r, now) for r in cur.fetchall()]}


class NewPoll(BaseModel):
    question: str = Field(min_length=1, max_length=200)
    options: list[str] = Field(min_length=2, max_length=4)
    days: int = Field(default=7, ge=1, le=MAX_DAYS)


def _one(cur, poll_id, me):
    cur.execute(SELECT + "where p.id = %(id)s;", {"me": me, "id": poll_id})
    row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "no such poll")
    return _poll(row, datetime.now(timezone.utc))


@router.post("/v1/districts/{bitmap_number}/polls", status_code=201)
def create_poll(bitmap_number: int, req: NewPoll, address: str = Depends(current_address)):
    options = [o.strip() for o in req.options]
    if any(not o or len(o) > 60 for o in options) or len(set(options)) != len(options):
        raise HTTPException(400, "answers must be different and 1 to 60 characters")
    with cursor() as cur:
        roles.require_owner(cur, bitmap_number, address)
        cur.execute(
            "insert into social.polls (bitmap_number, question, options, created_by, closes_at) "
            "values (%s, %s, %s, %s, now() + make_interval(days => %s)) returning id;",
            (bitmap_number, req.question.strip(), options, address, req.days),
        )
        return _one(cur, cur.fetchone()[0], address)


class Vote(BaseModel):
    option: int


@router.put("/v1/polls/{poll_id}/vote")
def vote(poll_id: int, req: Vote, address: str = Depends(current_address)):
    with cursor() as cur:
        poll = _one(cur, poll_id, address)
        if poll["closed"]:
            raise HTTPException(409, "this poll has closed")
        if not 0 <= req.option < len(poll["options"]):
            raise HTTPException(400, "no such answer")
        role, _ = roles.role_in(cur, address, poll["bitmap_number"])
        if role == roles.VISITOR:
            raise HTTPException(403, "only the owner and residents can vote")
        cur.execute(
            "insert into social.poll_votes (poll_id, address, option, role) values (%s, %s, %s, %s) "
            "on conflict (poll_id, address) do update set option = excluded.option, role = excluded.role, "
            "created_at = now();",
            (poll_id, address, req.option, role),
        )
        return _one(cur, poll_id, address)


@router.post("/v1/polls/{poll_id}/close")
def close(poll_id: int, address: str = Depends(current_address)):
    with cursor() as cur:
        poll = _one(cur, poll_id, address)
        roles.require_owner(cur, poll["bitmap_number"], address)
        cur.execute("update social.polls set closed_at = now() where id = %s and closed_at is null;", (poll_id,))
        return _one(cur, poll_id, address)
