# unimap web

Next.js front end for the unimap API.

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API_URL = where `uvicorn api.app:app` listens
npm install
npm run dev                  # http://localhost:3000
```

The API must allow the site's origin: start it with `API_CORS_ORIGINS=http://localhost:3000`.

- Sign-in works with UniSat, Xverse and OKX, or by pasting a signature made elsewhere (for example `ord wallet sign`), which is also how to use it against the regtest stack from `scripts/regtest/e2e.sh` with `KEEP_RUNNING=1`.
- The interface is in Chinese and dark. Colours live as tokens at the top of `app/globals.css`; a light theme only needs another set.
- The home page is an isometric city map (`components/CityMap.tsx`, drawn on a canvas): blocks run left to right, 48 to a row, and each zone from the API has its own building set (`lib/iso.ts`). Zone names and colours are in `lib/zones.ts`.
- `lib/mondrian.ts` lays out a block's transactions like other Bitmap renderers (port of bitfeed's Mondrian layout, MIT); square *i* is parcel *i*.
- `lib/messages.ts` must produce exactly the text `post_message` in `api/social.py` builds; `npm test` checks this.

Checks: `npm run typecheck`, `npm test`, `npm run build`.
