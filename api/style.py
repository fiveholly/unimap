"""A district's look on the map: a colour and up to MAX_DECOS decorations.

Decorations unlock with prosperity (api/prosperity.py) and hide again if the district falls
below their level. Mirrors web/lib/style.ts; keep the keys and levels in step.
"""

from fastapi import APIRouter, Depends, HTTPException
from psycopg2.extras import Json
from pydantic import BaseModel, Field

from api import parks, roles
from api.auth import current_address
from api.db import cursor

router = APIRouter()

COLORS = {"orange": 1, "red": 1, "blue": 1, "green": 1, "purple": 3, "gold": 5}  # colour: level it unlocks at
DECOS = {"flag": 1, "flowers": 2, "lamps": 3, "fountain": 4, "statue": 5}
MAX_DECOS = 3


def visible(style, level):
    """What of a saved style shows at this level, or None."""
    if not style:
        return None
    color = style.get("color")
    return {
        "color": color if COLORS.get(color, 99) <= level else "orange",
        "deco": [d for d in style.get("deco", []) if DECOS.get(d, 99) <= level],
    }


def in_range(cur, lo, hi):
    cur.execute(
        "select bitmap_number, style from social.profiles where bitmap_number between %s and %s and style is not null;",
        (lo, hi),
    )
    return dict(cur.fetchall())


class StyleBody(BaseModel):
    color: str
    deco: list[str] = Field(default_factory=list, max_length=MAX_DECOS)


@router.put("/v1/districts/{bitmap_number}/style")
def set_style(bitmap_number: int, req: StyleBody, address: str = Depends(current_address)):
    if req.color not in COLORS or any(d not in DECOS for d in req.deco) or len(set(req.deco)) != len(req.deco):
        raise HTTPException(400, f"color is one of {', '.join(COLORS)}; deco up to {MAX_DECOS} of {', '.join(DECOS)}")
    with cursor() as cur:
        roles.require_owner(cur, bitmap_number, address)
        level = parks.scored(cur, bitmap_number, bitmap_number)[0][bitmap_number]
        locked = [k for k in [req.color, *req.deco] if {**COLORS, **DECOS}[k] > level]
        if locked:
            raise HTTPException(403, f"{', '.join(locked)} not unlocked at level {level}")
        style = {"color": req.color, "deco": req.deco}
        cur.execute(
            "insert into social.profiles (bitmap_number, style, updated_by) values (%s, %s, %s) "
            "on conflict (bitmap_number) do update set style = excluded.style, updated_by = excluded.updated_by, "
            "updated_at = now();",
            (bitmap_number, Json(style), address),
        )
    return style
