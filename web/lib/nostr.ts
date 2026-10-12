// Nostr in the browser: a NIP-07 extension (Alby, nos2x…) holds the key and signs; we send the
// signed notes to relays ourselves. unimap's server never sees the key (api/nostr.py).

export type NostrEvent = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string };
export type Unsigned = Omit<NostrEvent, "id" | "pubkey" | "sig">;
type Nip07 = {
  getPublicKey: () => Promise<string>;
  signEvent: (e: Unsigned) => Promise<NostrEvent>;
  getRelays?: () => Promise<Record<string, { read: boolean; write: boolean }>>;
};

/** Relays a note goes to when the extension names none. */
export const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
export const LINK_KIND = 22242;

/** The browser's Nostr extension, if one is installed. */
export function nostrExtension(): Nip07 | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { nostr?: Nip07 }).nostr ?? null;
}

/** What the link event says; must match api/nostr.py link_text. */
export const linkText = (address: string) => `unimap: link this Nostr key to ${address}`;

export const now = () => Math.floor(Date.now() / 1000);

/** The relays the person writes to, as their extension lists them, else ours. */
export async function writeRelays(ext: Nip07): Promise<string[]> {
  try {
    const listed = Object.entries((await ext.getRelays?.()) ?? {})
      .filter(([url, r]) => r.write && /^wss:\/\//.test(url))
      .map(([url]) => url);
    if (listed.length) return listed.slice(0, 6);
  } catch {}
  return DEFAULT_RELAYS;
}

/** Send a signed event to relays; resolves with how many said OK. */
export function publish(ev: NostrEvent, relays: string[], timeoutMs = 7000): Promise<number> {
  return Promise.all(
    relays.map(
      (url) =>
        new Promise<boolean>((resolve) => {
          let ws: WebSocket;
          const done = (ok: boolean) => {
            clearTimeout(timer);
            try {
              ws.close();
            } catch {}
            resolve(ok);
          };
          const timer = setTimeout(() => done(false), timeoutMs);
          try {
            ws = new WebSocket(url);
          } catch {
            return done(false);
          }
          ws.onopen = () => ws.send(JSON.stringify(["EVENT", ev]));
          ws.onmessage = (m) => {
            try {
              const [type, id, ok] = JSON.parse(String(m.data));
              if (type === "OK" && id === ev.id) done(!!ok);
            } catch {}
          };
          ws.onerror = () => done(false);
        }),
    ),
  ).then((oks) => oks.filter(Boolean).length);
}

// --- NIP-19: npub / note as bech32 -------------------------------------------------------------

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values: number[]) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= G[i];
  }
  return chk;
}

function bech32(hrp: string, hex: string) {
  const bytes = hex.match(/../g)!.map((b) => parseInt(b, 16));
  const data: number[] = [];
  let acc = 0, bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) data.push((acc >> (bits -= 5)) & 31);
  }
  if (bits) data.push((acc << (5 - bits)) & 31);
  const expand = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat(0, [...hrp].map((c) => c.charCodeAt(0) & 31));
  const mod = polymod([...expand, ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const check = [0, 1, 2, 3, 4, 5].map((i) => (mod >> (5 * (5 - i))) & 31);
  return hrp + "1" + [...data, ...check].map((d) => CHARSET[d]).join("");
}

export const npub = (pubkey: string) => bech32("npub", pubkey);
export const noteId = (id: string) => bech32("note", id);
/** A Nostr profile or note on njump.me, which shows it to people without a Nostr app. */
export const profileUrl = (pubkey: string) => `https://njump.me/${npub(pubkey)}`;
export const noteUrl = (id: string) => `https://njump.me/${noteId(id)}`;
/** npub1abcd…wxyz, for showing. */
export const shortNpub = (pubkey: string) => {
  const n = npub(pubkey);
  return `${n.slice(0, 10)}…${n.slice(-6)}`;
};
