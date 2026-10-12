"""指标: the weekly numbers the growth plan's roadmap moves on, for site admins.

- 打赏 (stage one): how many districts got a confirmed tip that week; the gate to the next stage
  is TIPPED_GATE of them in a week.
- 回来的人 (stage two): addresses that did something that week (signed in, checked in, posted or
  replied, liked, voted, tipped, bought), and how many of them had also done something in an
  earlier week. The gate is that number doubling.
- 站内交易 (stage three): sats that changed hands in listings bought and offers accepted here,
  and in shop sales.

Weeks start on Monday, UTC. A week that is still running is counted so far.
"""

from datetime import date, timedelta

from fastapi import APIRouter, Depends

from api.db import cursor
from api.moderation import require_admin

router = APIRouter()

TIPPED_GATE = 50
MAX_WEEKS = 52

# Every row that shows someone did something here, as (address, when).
ACTIVITY = """
    select address, created_at as at from social.sessions
    union all select address, created_at from social.checkins
    union all select author_address, created_at from social.posts where agent_id is null
    union all select address, created_at from social.likes
    union all select address, created_at from social.poll_votes
    union all select tipper, created_at from social.tips where status = 'settled'
    union all select buyer, created_at from social.shop_orders where status = 'settled'
"""


def _weeks(n, today=None):
    """The Mondays of the last n weeks, oldest first, this week last."""
    today = today or date.today()
    monday = today - timedelta(days=today.weekday())
    return [monday - timedelta(weeks=k) for k in range(n - 1, -1, -1)]


def weekly(cur, n):
    weeks = _weeks(n)
    first = weeks[0]
    rows = {w: {"week": w.isoformat(), "tipped_districts": 0, "tippers": 0, "tip_sats": 0, "active": 0, "returning": 0, "new": 0,
                "trades": 0, "trade_sats": 0, "shop_orders": 0, "shop_sats": 0} for w in weeks}

    def fill(sql, keys, args=()):
        cur.execute(sql, (first, *args))
        for week, *values in cur.fetchall():
            if week in rows:
                rows[week].update({k: int(v or 0) for k, v in zip(keys, values)})

    fill("select date_trunc('week', settled_at)::date, count(distinct bitmap_number), count(distinct tipper), sum(amount_sats) "
         "from social.tips where status = 'settled' and event_id is null and settled_at >= %s group by 1;",
         ("tipped_districts", "tippers", "tip_sats"))
    # Who was active each week, and whether they had been active in any week before it.
    fill(f"""with a as (select address, date_trunc('week', at)::date as week from ({ACTIVITY}) x where address is not null),
                  firsts as (select address, min(week) as first_week from a group by address),
                  weekly as (select distinct address, week from a where week >= %s)
             select w.week, count(*), count(*) filter (where f.first_week < w.week), count(*) filter (where f.first_week = w.week)
             from weekly w join firsts f using (address) group by w.week;""",
         ("active", "returning", "new"))
    fill("""select week, count(*), sum(price) from (
                select date_trunc('week', updated_at)::date as week, price_sats as price from social.market_listings where status = 'sold'
                union all
                select date_trunc('week', updated_at)::date, price_sats from social.market_offers where status = 'accepted'
            ) t where week >= %s group by week;""",
         ("trades", "trade_sats"))
    fill("select date_trunc('week', settled_at)::date, count(*), sum(amount_sats) from social.shop_orders "
         "where status = 'settled' and settled_at >= %s group by 1;",
         ("shop_orders", "shop_sats"))
    return [rows[w] for w in weeks]


@router.get("/v1/admin/metrics")
def metrics(weeks: int = 12, _: str = Depends(require_admin)):
    """The last weeks, oldest first, with the roadmap's gates."""
    with cursor() as cur:
        return {"weeks": weekly(cur, max(2, min(weeks, MAX_WEEKS))), "gates": {"tipped_districts": TIPPED_GATE}}
