"""unimap API: land (indexer data) and social.

Run: uvicorn api.app:app   (DB settings from .env, as for parcel_index)
Social tables: psql -f api/social.sql
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import auth, game, holdings, land, listings, moderation, notify, parks, polls, recruit, search, social, style, tips, wallets, xlink

app = FastAPI(title="unimap API")
origins = [o for o in (os.getenv("API_CORS_ORIGINS") or "").split(",") if o]
if origins:
    app.add_middleware(
        CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["Authorization", "Content-Type"]
    )
app.include_router(land.router)
app.include_router(auth.router)
app.include_router(social.router)
for extra in (recruit, polls, style, parks, holdings, notify, xlink, wallets, search, moderation, listings, tips, game):
    app.include_router(extra.router)
