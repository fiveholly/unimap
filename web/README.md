# unimap web

Next.js front end for the unimap API.

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API_URL = where `uvicorn api.app:app` listens
npm install
npm run dev                  # http://localhost:3000
```

The API must allow the site's origin: start it with `API_CORS_ORIGINS=http://localhost:3000`.

- Sign-in works with UniSat, Xverse and OKX, or by pasting a signature made elsewhere (for example `ord wallet sign`), which is also how to use it against the regtest stack from `scripts/regtest/e2e.sh` with `KEEP_RUNNING=1`.
- `lib/mondrian.ts` lays out a block's transactions like other Bitmap renderers (port of bitfeed's Mondrian layout, MIT); square *i* is parcel *i*.
- `lib/messages.ts` must produce exactly the text `post_message` in `api/social.py` builds; `npm test` checks this.

Checks: `npm run typecheck`, `npm test`, `npm run build`.
