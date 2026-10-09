// Demo mode: a made-up city served from the browser, so the site runs with no API.
// Turned on by NEXT_PUBLIC_DEMO=1 (`npm run demo`). Every /v1 route the site uses is answered
// here from deterministic fake data; what the visitor does (posts, likes, follows, profile
// edits) is kept in localStorage, and "重置演示数据" clears it.

import type { District, FeedItem, Land, LandEvent, Me, Parcel, Post, Ranking, Role, Tile } from "./api";
import { prosperity, type ProsperityParts } from "./prosperity";

export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

export const DEMO_TIP = 918_500;
/** The visitor's demo wallet: owns 840000 and 812345, lives on parcel 7 of 840001. */
export const DEMO_ADDRESS = "bc1pdemo7visitor0wa11et0unimap0city0xyz0000000000000000q8d2k";
const OWNED = [840000, 812345];
const OWN_PARCEL = { bitmap_number: 840001, tx_index: 7 };

const LANDMARKS = [0, 57043, 210000, 420000, 481824, 630000, 709632, 767430, 840000];

const hash = (n: number) => {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

// Roughly how mainnet looks by era: early blocks are mostly empty (mountain), inscriptions
// fill blocks after 767430.
function zoneOf(n: number): string {
  if (LANDMARKS.includes(n)) return "landmark";
  const u = hash(n);
  if (n < 130_000) return u < 0.85 ? "mountain" : u < 0.95 ? "residential" : "villa";
  if (n < 767_430) return u < 0.55 ? "residential" : u < 0.7 ? "villa" : u < 0.9 ? "commercial" : u < 0.95 ? "cbd" : "mountain";
  return u < 0.45 ? "data" : u < 0.75 ? "residential" : u < 0.9 ? "commercial" : u < 0.96 ? "cbd" : "villa";
}
function txCount(n: number): number {
  if (n === 0 || zoneOf(n) === "mountain") return 1; // the genesis block holds only its coinbase
  if (n < 130_000) return 2 + Math.floor(hash(n + 7) * 12);
  if (n < 400_000) return 50 + Math.floor(hash(n + 7) * 900);
  return 600 + Math.floor(hash(n + 7) * 3400);
}

const NAMES = ["bc1pq7x", "bc1pm3k", "bc1pz9a", "bc1pw2r", "bc1pn6t", "bc1ph4c", "bc1pj8e", "bc1pv5u"];
const fakeAddress = (seed: number) => {
  let s = NAMES[Math.floor(hash(seed) * NAMES.length)];
  for (let i = 0; s.length < 62; i++) s += "023456789acdefghjklmnpqrstuvwxyz"[Math.floor(hash(seed * 31 + i) * 32)];
  return s;
};
const ownerOf = (n: number): string | null =>
  OWNED.includes(n) ? DEMO_ADDRESS : n === 840001 || hash(n + 3) < 0.88 ? fakeAddress(n) : null;
const inscriptionId = (seed: number) => {
  let s = "";
  for (let i = 0; i < 64; i++) s += "0123456789abcdef"[Math.floor(hash(seed * 7 + i) * 16)];
  return s + "i0";
};
// How busy a neighbourhood is, 0 to 1: a few lively stretches of the chain, the blocks
// around each landmark, and quiet everywhere else. Drives the fake activity below.
const smooth = (x: number) => {
  const i = Math.floor(x), f = x - i, t = f * f * (3 - 2 * f);
  return hash(i * 97 + 1) * (1 - t) + hash(i * 97 + 98) * t;
};
function heat(n: number): number {
  const wide = smooth(n / 4000) ** 3;
  const local = hash(Math.floor(n / 64) + 17);
  const near = Math.max(...LANDMARKS.map((l) => Math.exp(-Math.abs(n - l) / 120)));
  return Math.min(1, wide * (0.3 + 0.7 * local) * 1.6 + near * 0.9) * (0.5 + 0.5 * hash(n + 23));
}
function parcelIndexes(n: number): number[] {
  if (!ownerOf(n)) return [];
  const count = txCount(n);
  const k = n === 840001 ? 24 : Math.floor(hash(n + 5) * Math.min(count, 60) * heat(n));
  const set = new Set<number>();
  for (let i = 0; set.size < k && i < k * 4; i++) set.add(Math.floor(hash(n * 13 + i) * count));
  if (n === OWN_PARCEL.bitmap_number) set.add(OWN_PARCEL.tx_index);
  return [...set].sort((a, b) => a - b);
}
const parcelOwner = (n: number, i: number) =>
  n === OWN_PARCEL.bitmap_number && i === OWN_PARCEL.tx_index ? DEMO_ADDRESS : fakeAddress(n * 1000 + i);
const owner = (address: string, seed: number) => ({ address, outpoint: inscriptionId(seed).slice(0, 64) + ":0", output_value: 546 });

// ---- seeded social data ---------------------------------------------------------

const DAY = 86400;
const NOW = Math.floor(Date.now() / 1000);
type Seed = { n: number; who: "owner" | number; body: string; ago: number; replies?: [number | "owner", string][] };
const SEEDS: Seed[] = [
  { n: 840000, who: "owner", body: "第四次减半的街区开张了。这里的地块按交易顺序编号，认领了就是这里的居民，欢迎常来。", ago: 0.2,
    replies: [[3, "恭喜开张！地块 #3 报到。"], [11, "减半区块的街区，意义很特别。"]] },
  { n: 840000, who: 3, body: "今天把 #3 号地块的头像换成了街区的 Mondrian 图，大家觉得怎么样？", ago: 1.4 },
  { n: 840000, who: 27, body: "有人知道这个区块里最大的那笔交易是谁的吗？在地图上是最大的那块地。", ago: 3.1,
    replies: [["owner", "是一笔交易所的归集，地块还没人认领。"]] },
  { n: 840001, who: "owner", body: "紧挨着减半区块的街区。居民可以发帖，访客可以回复。", ago: 0.6 },
  { n: 840001, who: 14, body: "隔壁 840000 今天很热闹，我们这条街也来点动静。", ago: 2.2 },
  { n: 812345, who: "owner", body: "这个街区的号码很好记，打算做成一个铭文收藏者的聚会点。", ago: 5 },
  { n: 0, who: "owner", body: "创世区块，一切开始的地方。只有一笔交易，所以这里只有一块地。", ago: 9 },
  { n: 839998, who: "owner", body: "减半前两个区块。手续费那几天很高，所以这里被划成了 CBD。", ago: 0.9 },
  { n: 840002, who: 5, body: "地块 #5 的居民，路过打个招呼。", ago: 1.8 },
  { n: 767430, who: "owner", body: "第一个铭文出现的区块。数据区的起点。", ago: 12 },
];

type State = {
  nextId: number;
  posts: Post[];
  likes: Record<number, boolean>;
  follows: number[];
  profiles: Record<number, Partial<District["profile"]>>;
  mutes: Record<number, string[]>;
  checkins?: Record<number, string[]>; // the visitor's check-in days (YYYY-MM-DD) per district
};

const KEY = "unimap.demo";
let state: State | null = null;

function seed(): State {
  const posts: Post[] = [];
  let id = 1;
  const make = (n: number, who: "owner" | number, body: string, ago: number, replyTo: number | null): Post => {
    const address = who === "owner" ? ownerOf(n) ?? fakeAddress(n) : parcelOwner(n, who);
    const role: Role = who === "owner" ? "owner" : "resident";
    return {
      id: id++, bitmap_number: n, reply_to: replyTo, body, media: [],
      author: { address, role, parcel: who === "owner" ? null : who, as_bitmap: null },
      signed_message: `unimap post\ndistrict: ${n}.bitmap\n\n${body}`, signature: "演示签名",
      created_at: new Date((NOW - ago * DAY) * 1000).toISOString(), removed: false,
      like_count: Math.floor(hash(id) * 30), reply_count: 0, liked_by_me: false,
    };
  };
  for (const s of SEEDS) {
    const p = make(s.n, s.who, s.body, s.ago, null);
    posts.push(p);
    for (const [k, [who, body]] of (s.replies ?? []).entries()) {
      posts.push(make(s.n, who, body, s.ago - 0.05 * (k + 1), p.id));
      p.reply_count++;
    }
  }
  return {
    nextId: id, posts, likes: {}, follows: [840000, 840001, 0],
    profiles: { 840000: { bio: "第四次减半所在的区块。欢迎来逛，居民可以在这里发帖。" }, 812345: { bio: "" } },
    mutes: {},
  };
}
function load(): State {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? (JSON.parse(raw) as State) : seed();
  } catch {
    state = seed();
  }
  return state;
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}
export function resetDemo() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  state = null;
}

// ---- routes ---------------------------------------------------------------------

class DemoError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const fail = (status: number, message: string): never => {
  throw new DemoError(status, message);
};

const today = () => new Date().toISOString().slice(0, 10);
const seededFollowers = (n: number) => (ownerOf(n) ? Math.floor(hash(n + 11) * 240 * heat(n)) : 0);
/** What counts towards a district's prosperity: made-up background activity scaled by its
 * neighbourhood's heat, plus whatever the visitor has done here in this browser. */
function parts(n: number): ProsperityParts {
  const s = load(), h = heat(n), claimed = !!ownerOf(n);
  const since = NOW - 30 * DAY;
  const recent = s.posts.filter((p) => p.bitmap_number === n && !p.removed && Date.parse(p.created_at) / 1000 > since);
  const near = s.posts.filter((p) => p.bitmap_number !== n && Math.abs(p.bitmap_number - n) <= 5 && !p.removed && Date.parse(p.created_at) / 1000 > since).length;
  const mine = (s.checkins?.[n] ?? []).filter((d) => Date.parse(d) / 1000 > since).length;
  const fake = (k: number, max: number) => (claimed ? Math.floor(hash(n * 7 + k) * max * h * h) : 0);
  return {
    residents: parcelIndexes(n).length,
    posts30: fake(1, 30) + recent.filter((p) => p.reply_to == null).length,
    replies30: fake(2, 80) + recent.filter((p) => p.reply_to != null).length,
    followers: seededFollowers(n) + (s.follows.includes(n) ? 1 : 0),
    checkins30: fake(3, 120) + mine,
    neighbors30: Math.floor(hash(n * 7 + 4) * 150 * h * h) + near,
  };
}
function tile(n: number): Tile {
  const s = load();
  const o = ownerOf(n);
  return {
    bitmap_number: n, zone: zoneOf(n), tx_count: txCount(n), claimed: !!o, owner: o,
    parcels: parcelIndexes(n).length,
    posts: s.posts.filter((p) => p.bitmap_number === n && !p.removed && p.reply_to == null).length,
    level: zoneOf(n) === "landmark" ? 5 : prosperity(parts(n)).level,
  };
}
let hot: number[] | undefined;
/** The liveliest districts: only the busy stretches can make the list, so score just those. */
function rankings(): Ranking[] {
  const s = load();
  hot ??= Array.from({ length: Math.floor(DEMO_TIP / 64) + 1 }, (_, q) => q).filter((q) => heat(q * 64 + 32) > 0.5);
  const quarters = new Set(hot);
  for (const n of [...LANDMARKS, ...s.posts.map((p) => p.bitmap_number), ...s.follows]) quarters.add(Math.floor(n / 64));
  const out: Ranking[] = [];
  for (const q of quarters)
    for (let n = q * 64; n < q * 64 + 64 && n <= DEMO_TIP; n++) {
      if (zoneOf(n) === "landmark" || !ownerOf(n)) continue;
      const p = prosperity(parts(n));
      out.push({ bitmap_number: n, name: `${n}.bitmap`, zone: zoneOf(n), owner: ownerOf(n), score: p.score, level: p.level });
    }
  return out.sort((a, b) => b.score - a.score).slice(0, 50);
}
function land(n: number): Land {
  if (n < 0 || n > DEMO_TIP) fail(404, "no such block yet");
  const o = ownerOf(n);
  const base = { name: `${n}.bitmap`, bitmap_number: n, zone: zoneOf(n), tx_count: txCount(n) };
  if (!o) return { ...base, claimed: false, district: null, parcels: [] };
  const parcels: Parcel[] = parcelIndexes(n).map((i) => ({
    name: `${i}.${n}.bitmap`, bitmap_number: n, tx_index: i, inscription_id: inscriptionId(n * 1000 + i),
    inscription_number: 60_000_000 + Math.floor(hash(n + i) * 9_000_000), inscribed_height: 845_000 + Math.floor(hash(n * 3 + i) * 70_000),
    owner: owner(parcelOwner(n, i), n * 1000 + i),
  }));
  return {
    ...base, claimed: true, parcels,
    district: { inscription_id: inscriptionId(n), inscription_number: 30_000_000 + n, inscribed_height: 790_000 + (n % 40_000), owner: owner(o, n) },
  };
}
function txValues(n: number): number[] {
  return Array.from({ length: txCount(n) }, (_, i) => (i === 0 ? 312_500_000 + Math.floor(hash(n) * 5e7) : Math.floor(10 ** (3.5 + hash(n * 31 + i) * 5.5))));
}
function events(n: number): LandEvent[] {
  const o = ownerOf(n);
  if (!o) return [];
  const t0 = NOW - 200 * DAY;
  const out: LandEvent[] = [
    { id: n * 10, kind: "district_claimed", block_height: 790_000, block_time: t0, inscription_id: inscriptionId(n), bitmap_number: n, tx_index: null, from_address: null, to_address: o },
  ];
  parcelIndexes(n).slice(0, 6).forEach((i, k) =>
    out.push({ id: n * 10 + k + 1, kind: k === 2 ? "transfer" : "parcel_claimed", block_height: 850_000 + k * 1000, block_time: t0 + (k + 1) * 20 * DAY,
      inscription_id: inscriptionId(n * 1000 + i), bitmap_number: n, tx_index: i, from_address: k === 2 ? fakeAddress(n + 99) : null, to_address: parcelOwner(n, i) }),
  );
  return out.reverse();
}
function roleOf(address: string | null, n: number): [Role, number | null] {
  if (address && ownerOf(n) === address) return ["owner", null];
  if (address === DEMO_ADDRESS && n === OWN_PARCEL.bitmap_number) return ["resident", OWN_PARCEL.tx_index];
  return ["visitor", null];
}
function profile(n: number): District["profile"] {
  const p = load().profiles[n] ?? {};
  const pinned = n === 840000 && p.pinned_post_id === undefined ? 1 : p.pinned_post_id ?? null;
  return { bio: p.bio ?? "", cover: p.cover ?? null, visitor_comments_on: p.visitor_comments_on ?? true, pinned_post_id: pinned };
}
const view = (p: Post, me: string | null): Post => ({ ...p, liked_by_me: !!me && !!load().likes[p.id], like_count: p.like_count + (me && load().likes[p.id] ? 1 : 0) });
const topPosts = (pred: (p: Post) => boolean, me: string | null) =>
  load().posts.filter((p) => !p.removed && p.reply_to == null && pred(p)).sort((a, b) => b.id - a.id).map((p) => view(p, me));
function district(n: number, me: string | null): District {
  const s = load();
  const prof = profile(n);
  const pinned = prof.pinned_post_id != null ? s.posts.find((p) => p.id === prof.pinned_post_id && !p.removed) : undefined;
  const [role, parcel] = roleOf(me, n);
  const pr = prosperity(parts(n));
  return {
    bitmap_number: n, name: `${n}.bitmap`, owner: ownerOf(n), profile: prof, pinned_post: pinned ? view(pinned, me) : null,
    followers: pr.parts.followers,
    post_count: s.posts.filter((p) => p.bitmap_number === n && !p.removed && p.reply_to == null).length,
    viewer: me ? { address: me, role, parcel, muted: (s.mutes[n] ?? []).includes(me), following: s.follows.includes(n) } : null,
    prosperity: zoneOf(n) === "landmark" ? { ...pr, level: 5, next: null } : pr,
    checked_in_today: !!me && (s.checkins?.[n] ?? []).includes(today()),
  };
}

type Opts = { method?: string; body?: unknown; token?: string | null };

function route(path: string, opts: Opts): unknown {
  const url = new URL(path, "http://demo");
  const p = url.pathname, method = opts.method || "GET";
  const me = opts.token ? DEMO_ADDRESS : null;
  const body = (opts.body ?? {}) as Record<string, unknown>;
  const s = load();
  const needMe = () => me ?? fail(401, "请先连接钱包");
  let m: RegExpMatchArray | null;

  if (p === "/v1/status") return { indexed_height: { bitmap: DEMO_TIP, parcel: DEMO_TIP, owner: DEMO_TIP } };
  if (p === "/v1/auth/nonce") return { nonce: "demo", message: "unimap login (demo)" };
  if (p === "/v1/auth/login") return { token: "demo-token", address: DEMO_ADDRESS };
  if (p === "/v1/auth/logout") return { ok: true };
  if (p === "/v1/land") {
    const start = Math.max(0, Number(url.searchParams.get("start"))), end = Math.min(DEMO_TIP, Number(url.searchParams.get("end")));
    const tiles: Tile[] = [];
    for (let n = start; n <= end; n++) tiles.push(tile(n));
    return { tip: DEMO_TIP, tiles };
  }
  if ((m = p.match(/^\/v1\/land\/(\d+)$/))) return land(+m[1]);
  if ((m = p.match(/^\/v1\/land\/(\d+)\/txs$/))) return { bitmap_number: +m[1], tx_values: txValues(+m[1]) };
  if ((m = p.match(/^\/v1\/land\/(\d+)\/events$/))) return { events: events(+m[1]) };
  if (p === "/v1/me") {
    const a = needMe();
    return { address: a, districts: OWNED, parcels: [OWN_PARCEL], follows: [...s.follows].sort((x, y) => x - y) } satisfies Me;
  }
  if (p === "/v1/feed") {
    needMe();
    const items: FeedItem[] = [
      ...topPosts((x) => s.follows.includes(x.bitmap_number), me).map((post) => ({ type: "post" as const, time: Date.parse(post.created_at) / 1000, post })),
      ...s.follows.flatMap(events).map((event) => ({ type: "event" as const, time: event.block_time, event })),
    ];
    return { items: items.sort((a, b) => b.time - a.time).slice(0, 30) };
  }
  if ((m = p.match(/^\/v1\/districts\/(\d+)$/))) return district(+m[1], me);
  if (p === "/v1/rankings") return { rankings: rankings() };
  if ((m = p.match(/^\/v1\/districts\/(\d+)\/checkin$/)) && method === "POST") {
    needMe();
    const days = ((s.checkins ??= {})[+m[1]] ??= []);
    if (days.includes(today())) fail(409, "今天已经签到过了");
    days.push(today());
    save();
    return { ok: true };
  }
  if ((m = p.match(/^\/v1\/districts\/(\d+)\/neighbors$/))) {
    const n = +m[1];
    return { posts: topPosts((x) => Math.abs(x.bitmap_number - n) <= 10 && x.bitmap_number !== n, me) };
  }
  if ((m = p.match(/^\/v1\/districts\/(\d+)\/posts$/))) {
    const n = +m[1];
    if (method === "GET") return { posts: topPosts((x) => x.bitmap_number === n, me) };
    const a = needMe();
    const [role, parcel] = roleOf(a, n);
    const replyTo = (body.reply_to as number | null) ?? null;
    if ((s.mutes[n] ?? []).includes(a)) fail(403, "你在这个街区被禁言了");
    if (replyTo == null && role === "visitor") fail(403, "只有街区主人和居民可以发帖，访客可以回复");
    const post: Post = {
      id: s.nextId++, bitmap_number: n, reply_to: replyTo, body: String(body.body), media: (body.media as string[]) ?? [],
      author: { address: a, role, parcel, as_bitmap: (body.as_bitmap as number | null) ?? null },
      signed_message: `unimap post\ndistrict: ${n}.bitmap\n\n${body.body}`, signature: String(body.signature),
      created_at: new Date().toISOString(), removed: false, like_count: 0, reply_count: 0, liked_by_me: false,
    };
    s.posts.push(post);
    if (replyTo != null) {
      const parent = s.posts.find((x) => x.id === replyTo);
      if (parent) parent.reply_count++;
    }
    save();
    return post;
  }
  if ((m = p.match(/^\/v1\/posts\/(\d+)\/replies$/)))
    return { replies: s.posts.filter((x) => x.reply_to === +m![1] && !x.removed).sort((a, b) => a.id - b.id).map((x) => view(x, me)) };
  if ((m = p.match(/^\/v1\/posts\/(\d+)\/like$/))) {
    needMe();
    s.likes[+m[1]] = method === "PUT";
    save();
    return { ok: true };
  }
  if ((m = p.match(/^\/v1\/posts\/(\d+)$/)) && method === "DELETE") {
    const post = s.posts.find((x) => x.id === +m![1]) ?? fail(404, "no such post");
    const a = needMe();
    if (post.author.address !== a && ownerOf(post.bitmap_number) !== a) fail(403, "只有作者或街区主人可以删除");
    post.removed = true;
    const parent = s.posts.find((x) => x.id === post.reply_to);
    if (parent) parent.reply_count--;
    save();
    return { ok: true };
  }
  if ((m = p.match(/^\/v1\/districts\/(\d+)\/(follow|profile|pin|mutes\/(.+))$/))) {
    const n = +m[1], a = needMe();
    if (m[2] === "follow") {
      s.follows = s.follows.filter((x) => x !== n);
      if (method === "PUT") s.follows.push(n);
    } else {
      if (ownerOf(n) !== a) fail(403, "只有街区主人可以这样做");
      const prof = (s.profiles[n] ??= {});
      if (m[2] === "profile") {
        if (typeof body.bio === "string") prof.bio = body.bio;
        if (typeof body.cover === "string") prof.cover = body.cover || null;
        if (typeof body.visitor_comments_on === "boolean") prof.visitor_comments_on = body.visitor_comments_on;
      } else if (m[2] === "pin") {
        prof.pinned_post_id = method === "PUT" ? (body.post_id as number) : null;
      } else {
        const list = (s.mutes[n] ??= []);
        if (method === "PUT" && !list.includes(m[3])) list.push(m[3]);
        if (method === "DELETE") s.mutes[n] = list.filter((x) => x !== m![3]);
      }
    }
    save();
    return { ok: true };
  }
  return fail(404, `演示模式没有这个接口：${method} ${p}`);
}

/** Answer an API call from the demo city, after a short pause like a real network. */
export async function demoApi<T>(path: string, opts: Opts): Promise<T> {
  await new Promise((r) => setTimeout(r, 60 + Math.random() * 140));
  try {
    return structuredClone(route(path, opts)) as T;
  } catch (e) {
    if (e instanceof DemoError) {
      const { ApiError } = await import("./api");
      throw new ApiError(e.status, e.message);
    }
    throw e;
  }
}
