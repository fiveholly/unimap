"""街区活动: a district's owner puts up sats for the people who do the most in the district over
one difficulty season (api/seasons.py), such as "the three who post most here this season get
10,000, 5,000 and 2,000 sats". unimap keeps the rules and the ranking in public and freezes the
winners when the season ends; the owner pays each prize as a Lightning tip (api/tips.py,
`event_id` and `place`), so whether a prize was paid shows on the event, confirmed by the
winner's wallet. The money never passes through unimap, and taking part costs nothing.

One event per district per season. It can be put up for the season under way or the next one,
and called off only before it starts: once it runs it is a public promise.
"""

from fastapi import APIRouter, Depends, HTTPException
from psycopg2.extras import Json
from pydantic import BaseModel, Field

from api import game, notify, roles, seasons, wallets
from api.auth import current_address
from api.db import cursor

router = APIRouter()

METRICS = ("posts", "replies", "checkins")
MAX_PRIZES = 3
MIN_PRIZE = 100
MAX_PRIZE = 1_000_000  # as api/tips.py MAX_SATS: each prize is one tip
MAX_NOTE = 140
STANDINGS = 5
LIST_SIZE = 20

COLUMNS = "id, bitmap_number, season, host, metric, prizes, note, created_at, cancelled_at, winners"


def _window(cur, season, tip):
    """(since, until) times of a season; until is None while it runs."""
    since = seasons.start_time(cur, season, tip)
    until = seasons.start_time(cur, season + 1, tip) if since is not None else None
    return since, until


def scores(cur, n, metric, host, since, until):
    """[(address, score)] of everyone but the host's wallet group, best first; a tie goes to whoever got there first.
    Addresses in one wallet group count as one person, under its main address."""
    if metric == "checkins":
        cur.execute(
            "select address, count(*), min(created_at) from social.checkins where bitmap_number = %s "
            "and day >= (%s at time zone 'utc')::date and (%s::timestamptz is null or day < (%s at time zone 'utc')::date) group by 1;",
            (n, since, until, until),
        )
    else:
        cur.execute(
            "select author_address, count(*), min(created_at) from social.posts where bitmap_number = %s and removed_at is null "
            f"and reply_to is {'null' if metric == 'posts' else 'not null'} "
            "and created_at >= %s and (%s::timestamptz is null or created_at < %s) group by 1;",
            (n, since, until, until),
        )
    rows = cur.fetchall()
    if not rows:
        return []
    mains = wallets.groups(cur, [a for a, _, _ in rows] + [host])
    skip = mains[host][0]
    out = {}
    for address, count, first in rows:
        main = mains[address][0]
        if main == skip:
            continue
        score, at = out.get(main, (0, first))
        out[main] = (score + count, min(at, first))
    ranked = sorted(out.items(), key=lambda kv: (-kv[1][0], kv[1][1], kv[0]))
    return [(a, s) for a, (s, _) in ranked]


def freeze_due(cur, tip):
    """Settle the winners of every event whose season is over."""
    if tip is None:
        return
    cur.execute(
        f"select {COLUMNS} from social.events where cancelled_at is null and winners is null and season < %s "
        "order by id for update skip locked;",
        (tip // seasons.SEASON,),
    )
    for ev in cur.fetchall():
        eid, n, season, host, metric, prizes = ev[:6]
        since, until = _window(cur, season, tip)
        if since is None or until is None:
            continue
        top = scores(cur, n, metric, host, since, until)[: len(prizes)]
        winners = [{"address": a, "score": s, "prize_sats": prizes[i]} for i, (a, s) in enumerate(top)]
        cur.execute("update social.events set winners = %s, frozen_at = now() where id = %s;", (Json(winners), eid))
        for w in winners:
            notify.notify(cur, w["address"], "event_win", host, n, block_height=seasons.bounds(season)[0])


def _paid(cur, ids):
    """{(event_id, place): 'settled' | 'pending'}: how each prize's tip stands."""
    if not ids:
        return {}
    cur.execute(
        "select event_id, event_place, bool_or(status = 'settled'), bool_or(status = 'pending') from social.tips "
        "where event_id = any(%s) group by 1, 2;",
        (list(ids),),
    )
    return {(e, p): "settled" if s else "pending" if q else None for e, p, s, q in cur.fetchall()}


def _views(cur, rows, tip):
    current = tip // seasons.SEASON if tip is not None else None
    paid = _paid(cur, [r[0] for r in rows if r[9]])
    out = []
    for eid, n, season, host, metric, prizes, note, created_at, cancelled_at, winners in rows:
        since_h, until_h = seasons.bounds(season)
        if cancelled_at is not None:
            status = "cancelled"
        elif current is None or season > current:
            status = "upcoming"
        elif season == current:
            status = "running"
        else:
            status = "ended"
        view = {
            "id": eid,
            "bitmap_number": n,
            "season": season,
            "since": since_h,
            "until": until_h,
            "host": host,
            "metric": metric,
            "prizes": prizes,
            "total_sats": sum(prizes),
            "note": note,
            "status": status,
            "created_at": created_at.isoformat(),
        }
        if status == "running":
            since, _ = _window(cur, season, tip)
            view["standings"] = [{"address": a, "score": s} for a, s in scores(cur, n, metric, host, since, None)[:STANDINGS]] if since else []
        if winners is not None:
            view["winners"] = [{**w, "place": i + 1, "paid": paid.get((eid, i + 1))} for i, w in enumerate(winners)]
        out.append(view)
    return out


def event_row(cur, event_id):
    cur.execute(f"select {COLUMNS} from social.events where id = %s;", (event_id,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "no such event")
    return row


def prize_target(cur, event_id, place, tipper, amount_sats):
    """(winner, bitmap_number) for the tip that pays prize place of an event; only its host pays it, in full."""
    eid, n, _, host, _, prizes, _, _, cancelled_at, winners = event_row(cur, event_id)
    if wallets.main_of(cur, tipper) != wallets.main_of(cur, host):
        raise HTTPException(403, "only the host pays this event's prizes")
    if cancelled_at is not None or winners is None:
        raise HTTPException(409, "this event hasn't ended yet")
    if not 1 <= place <= len(winners):
        raise HTTPException(404, "no such place")
    w = winners[place - 1]
    if amount_sats != w["prize_sats"]:
        raise HTTPException(400, f"this prize is {w['prize_sats']} sats")
    return w["address"], n


@router.get("/v1/districts/{bitmap_number}/events")
def district_events(bitmap_number: int):
    """The district's events, newest season first."""
    with cursor() as cur:
        tip = game.top(cur)
        freeze_due(cur, tip)
        cur.execute(
            f"select {COLUMNS} from social.events where bitmap_number = %s "
            "and (cancelled_at is null or created_at > now() - interval '7 days') order by season desc, id desc limit 10;",
            (bitmap_number,),
        )
        return {"events": _views(cur, cur.fetchall(), tip), "season": tip // seasons.SEASON if tip is not None else None}


@router.get("/v1/events")
def city_events():
    """Events running now or about to start, across the city, biggest purse first."""
    with cursor() as cur:
        tip = game.top(cur)
        if tip is None:
            return {"events": []}
        freeze_due(cur, tip)
        cur.execute(
            f"select {COLUMNS} from social.events where cancelled_at is null and season >= %s "
            "order by season, (select sum(x) from unnest(prizes) x) desc, id limit %s;",
            (tip // seasons.SEASON, LIST_SIZE),
        )
        return {"events": _views(cur, cur.fetchall(), tip)}


class NewEvent(BaseModel):
    metric: str
    prizes: list[int] = Field(min_length=1, max_length=MAX_PRIZES)
    note: str = Field(default="", max_length=MAX_NOTE)
    next_season: bool = False  # false: the season under way


@router.post("/v1/districts/{bitmap_number}/events", status_code=201)
def create_event(bitmap_number: int, req: NewEvent, address: str = Depends(current_address)):
    if req.metric not in METRICS:
        raise HTTPException(400, f"metric is one of {', '.join(METRICS)}")
    if any(not MIN_PRIZE <= p <= MAX_PRIZE for p in req.prizes):
        raise HTTPException(400, f"each prize is {MIN_PRIZE} to {MAX_PRIZE:,} sats")
    if any(a < b for a, b in zip(req.prizes, req.prizes[1:])):
        raise HTTPException(400, "a lower place can't get more than a higher one")
    with cursor() as cur:
        roles.require_owner(cur, bitmap_number, address)
        tip = game.top(cur)
        if tip is None:
            raise HTTPException(503, "the index hasn't caught up yet")
        season = tip // seasons.SEASON + (1 if req.next_season else 0)
        cur.execute(
            "insert into social.events (bitmap_number, season, host, metric, prizes, note) values (%s, %s, %s, %s, %s, %s) "
            "on conflict do nothing returning id;",
            (bitmap_number, season, address, req.metric, req.prizes, req.note.strip()),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(409, "this district already has an event that season")
        return _views(cur, [event_row(cur, row[0])], tip)[0]


@router.delete("/v1/events/{event_id}")
def cancel_event(event_id: int, address: str = Depends(current_address)):
    """Call an event off; only before its season starts."""
    with cursor() as cur:
        row = event_row(cur, event_id)
        if wallets.main_of(cur, row[3]) != wallets.main_of(cur, address):
            raise HTTPException(403, "only the host can call this event off")
        tip = game.top(cur)
        if row[8] is None and (tip is None or row[2] <= tip // seasons.SEASON):
            raise HTTPException(409, "this event has started; it runs to the end of the season")
        cur.execute("update social.events set cancelled_at = coalesce(cancelled_at, now()) where id = %s;", (event_id,))
        return _views(cur, [event_row(cur, event_id)], tip)[0]

