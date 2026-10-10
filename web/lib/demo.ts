// Demo mode: a made-up city served from the browser, so the site runs with no API.
// Turned on by NEXT_PUBLIC_DEMO=1 (`npm run demo`). Every /v1 route the site uses is answered
// here from deterministic fake data; what the visitor does (posts, likes, follows, profile
// edits) is kept in localStorage, and "重置演示数据" clears it.

import type { Application, District, FeedItem, Land, LandEvent, Me, Notification, Parcel, Park, Poll, Post, Ranking, Recruiting, ReportGroup, Role, Ban, Sale, Tip, TipTop, LinkedWallet, Person, SearchResults, Showcase, Tile, XAccount } from "./api";
import { connected } from "./parks";
import { MAX_SHOWN, PET_KEYS, PETS, type Pet, type PetKey } from "./pets";
import { prosperity, THRESHOLDS, type ProsperityParts } from "./prosperity";
import { COLORS, DECOS, visibleStyle, type DistrictStyle } from "./style";

export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

export const DEMO_TIP = 918_500;
/** The visitor's demo wallet: owns 840000, the two districts that touch it in its quarter
 * (840008, 840009), 838407 across the street from it and 812345, and lives on parcel 7 of
 * 840001. */
export const DEMO_ADDRESS = "bc1pdemo7visitor0wa11et0unimap0city0xyz0000000000000000q8d2k";
// The visitor's second wallet, for trying 关联钱包: it holds the NodeMonkes the first lacks.
export const DEMO_SECOND_ADDRESS = "bc1pdemo7second0wa11et0unimap0city0xyz00000000000000000r4mz";
const OWNED = [838407, 840000, 840008, 840009, 812345];
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
// A park someone else already runs, a quarter before the halving block and across the street from it.
const SEED_PARK = { id: 1, name: "矿工新村", members: [838459, 838460, 839940, 839941, 839948, 839949, 839950], owner: "" };
const ownerOf = (n: number): string | null =>
  OWNED.includes(n)
    ? DEMO_ADDRESS
    : SEED_PARK.members.includes(n)
      ? fakeAddress(77)
      : n === 840001 || hash(n + 3) < 0.88
        ? fakeAddress(n)
        : null;
SEED_PARK.owner = fakeAddress(77);
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
  { n: 840001, who: "owner", body: "比特币的第一条推文，贴在这里留个纪念。\nhttps://x.com/halfin/status/1110302988", ago: 4 },
  { n: 839998, who: "owner", body: "减半前两个区块。手续费那几天很高，所以这里被划成了 CBD。", ago: 0.9 },
  { n: 840002, who: 5, body: "地块 #5 的居民，路过打个招呼。", ago: 1.8 },
  { n: 767430, who: "owner", body: "第一个铭文出现的区块。数据区的起点。", ago: 12 },
  { n: 840002, who: 9, body: "免费空投！连接钱包签名就能领 1000 枚 BITMAP 代币，名额有限 → bitmap-airdrop.example", ago: 0.3 },
  { n: 840000, who: 31, body: "收地块，高价收，私信。收地块，高价收，私信。收地块，高价收，私信。", ago: 0.7 },
];
// Reports other wallets filed on the two spam seeds above, for the admin page.
const SEED_REPORTS: [string, number, string, string][] = [
  ["免费空投", 701, "scam", "钓鱼链接，让人签名转走铭文"],
  ["免费空投", 702, "scam", ""],
  ["免费空投", 703, "spam", ""],
  ["收地块", 704, "spam", "同一句话刷了好几个街区"],
];

type State = {
  nextId: number;
  posts: Post[];
  likes: Record<number, boolean>;
  follows: number[];
  profiles: Record<number, Partial<District["profile"]>>;
  mutes: Record<number, string[]>;
  checkins?: Record<number, string[]>; // the visitor's check-in days (YYYY-MM-DD) per district
  styles?: Record<number, DistrictStyle>;
  recruits?: Record<number, { message: string; parcels: number[]; updated_at: string; by: string }>;
  applications?: Record<number, Application[]>;
  polls?: DemoPoll[];
  parks?: { id: number; name: string; owner: string; members: number[] }[];
  showcase?: Record<number, PetKey[]>; // what the visitor chose to show on their districts
  notifications?: Notification[]; // the visitor's, newest first
  x?: XAccount | null; // the visitor's linked X account
  linked?: string[]; // wallets the visitor linked to their own
  reports?: { post_id: number; reporter: string; reason: string; note: string; created_at: string; resolved?: boolean }[];
  bans?: Ban[];
  lightning?: string | null; // the visitor's Lightning address for tips
  tips?: DemoTip[];
};
type DemoTip = { id: number; tipper: string; recipient: string; n: number; post_id: number | null; sats: number; comment: string; status: Tip["status"]; at: number };
type DemoPoll = { id: number; n: number; question: string; options: string[]; by: string; created_at: string; closes_at: string; closed_at: string | null; votes: Record<string, number> };

const iso = (daysAgo: number) => new Date((NOW - daysAgo * DAY) * 1000).toISOString();
function seedExtras(s: State) {
  s.styles ??= {};
  s.recruits ??= {
    840002: { message: "减半旁边的街区，欢迎新邻居。地块不多，先到先得。", parcels: [3, 8, 12], updated_at: iso(0.5), by: ownerOf(840002)! },
    839998: { message: "CBD 招商：想在手续费最高的那几天留个名字的，来这里。", parcels: [1, 2], updated_at: iso(1.2), by: ownerOf(839998)! },
    839941: { message: "矿工新村招居民，园区里七个街区隔着马路一起热闹。", parcels: [4, 9], updated_at: iso(2), by: SEED_PARK.owner },
  };
  s.applications ??= {};
  s.polls ??= [
    { id: 1, n: 840001, question: "街区要不要在 coinbase 那块地上修一个广场？", options: ["修广场", "保持原样", "改成公园"], by: ownerOf(840001)!,
      created_at: iso(1), closes_at: iso(-6), closed_at: null, votes: { a: 0, b: 0, c: 2, d: 0, e: 1 } },
    { id: 2, n: 840001, question: "下个月的街区聚会选哪天？", options: ["周六", "周日"], by: ownerOf(840001)!,
      created_at: iso(20), closes_at: iso(13), closed_at: null, votes: { a: 1, b: 1, c: 0 } },
  ];
  s.parks ??= [SEED_PARK];
  s.notifications ??= seedNotifications(s);
  s.reports ??= SEED_REPORTS.flatMap(([start, who, reason, note], i) => {
    const post = s.posts.find((p) => p.body?.startsWith(start));
    return post ? [{ post_id: post.id, reporter: fakeAddress(who), reason, note, created_at: iso(0.2 - i * 0.03) }] : [];
  });
  s.lightning === undefined && (s.lightning = "bitmapper@walletofsatoshi.com");
  s.tips ??= seedTips(s);
  s.bans ??= [{ address: fakeAddress(705), reason: "scam", banned_by: DEMO_ADDRESS, created_at: iso(2), expires_at: iso(-28) }];
  return s;
}

// Tips other wallets sent on the seeded posts, and two on the visitor's own, for the 打赏榜.
function seedTips(s: State): DemoTip[] {
  const out: DemoTip[] = [];
  const amounts = [100, 210, 500, 1000, 2100, 5000];
  for (const p of s.posts.filter((x) => x.reply_to == null && !x.removed)) {
    const mine = p.author.address === DEMO_ADDRESS;
    const k = mine ? 2 : hash(p.id * 13) < 0.6 && strHash(p.author.address) % 10 < 7 ? 1 + Math.floor(hash(p.id * 17) * 4) : 0;
    for (let i = 0; i < k; i++)
      out.push({ id: out.length + 1, tipper: fakeAddress(800 + p.id * 5 + i), recipient: p.author.address, n: p.bitmap_number, post_id: p.id,
        sats: amounts[Math.floor(hash(p.id * 19 + i) * amounts.length)], comment: i === 0 && mine ? "写得好，请你喝杯咖啡" : "", status: "settled",
        at: (NOW - (0.3 + hash(p.id + i) * 5) * DAY) * 1000 });
  }
  return out;
}
const strHash = (a: string) => [...a].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
/** Who has a Lightning address in the demo: the visitor if they set one, and most other wallets. */
const tippable = (a: string | null) => !!a && (a === DEMO_ADDRESS ? !!load().lightning : strHash(a) % 10 < 7);
const settledTips = () => (load().tips ?? []).filter((x) => x.status === "settled");
const postTips = (id: number) => settledTips().filter((x) => x.post_id === id).reduce((a, x) => a + x.sats, 0);
function tipsSince(days: number) {
  const since = Date.now() - days * DAY * 1000;
  return settledTips().filter((x) => x.at > since);
}
function districtTips(n: number) {
  const recent = tipsSince(30).filter((x) => x.n === n);
  return { sats30: recent.reduce((a, x) => a + x.sats, 0), tippers30: new Set(recent.map((x) => x.tipper)).size };
}
function tipTop(me: string | null): TipTop {
  const recent = tipsSince(7);
  const by = <K,>(key: (x: DemoTip) => K | null) => {
    const m = new Map<K, { sats: number; tippers: Set<string> }>();
    for (const x of recent) {
      const k = key(x);
      if (k == null) continue;
      const e = m.get(k) ?? { sats: 0, tippers: new Set<string>() };
      e.sats += x.sats;
      e.tippers.add(x.tipper);
      m.set(k, e);
    }
    return [...m.entries()].sort((a, b) => b[1].sats - a[1].sats).slice(0, 10);
  };
  const s = load();
  return {
    days: 7,
    posts: by((x) => x.post_id).flatMap(([id, e]) => {
      const p = s.posts.find((x) => x.id === id && !x.removed);
      return p ? [{ post: view(p, me), sats: e.sats, tippers: e.tippers.size }] : [];
    }),
    districts: by((x) => x.n).map(([n, e]) => ({ bitmap_number: n, name: `${n}.bitmap`, zone: zoneOf(n), sats: e.sats, tippers: e.tippers.size })),
  };
}
const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const fakeInvoice = (sats: number, seed: number) =>
  `lnbc${sats * 10}n1p` + Array.from({ length: 180 }, (_, i) => BECH32[Math.floor(hash(seed * 31 + i) * 32)]).join("");

// What the visitor's wallet hears about: replies on their posts, likes, new followers of
// 840000 and someone asking to live there.
function seedNotifications(s: State): Notification[] {
  const mine = s.posts.filter((p) => p.author.address === DEMO_ADDRESS && p.reply_to == null);
  const out: Omit<Notification, "id">[] = [];
  const at = (hoursAgo: number) => new Date((NOW - hoursAgo * 3600) * 1000).toISOString();
  const add = (n: Omit<Notification, "id" | "read" | "snippet"> & { snippet?: string | null }, read = false) =>
    out.push({ snippet: null, read, ...n });
  for (const p of mine)
    for (const r of s.posts.filter((x) => x.reply_to === p.id && x.author.address !== DEMO_ADDRESS))
      add({ kind: "reply", actor: r.author.address, bitmap_number: p.bitmap_number, post_id: r.id, created_at: r.created_at, snippet: r.body });
  if (mine[0])
    for (let i = 0; i < 4; i++) add({ kind: "like", actor: fakeAddress(500 + i), bitmap_number: mine[0].bitmap_number, post_id: mine[0].id, created_at: at(1 + i * 2), snippet: mine[0].body });
  add({ kind: "follow", actor: fakeAddress(611), bitmap_number: 840000, post_id: null, created_at: at(0.4) });
  add({ kind: "follow", actor: fakeAddress(612), bitmap_number: 840000, post_id: null, created_at: at(5) });
  add({ kind: "apply", actor: fakeAddress(613), bitmap_number: 840000, post_id: null, created_at: at(0.2) });
  if (mine[0]) add({ kind: "tip", actor: fakeAddress(800 + mine[0].id * 5), bitmap_number: mine[0].bitmap_number, post_id: mine[0].id, created_at: at(0.6), amount_sats: 2100, comment: "写得好，请你喝杯咖啡" });
  add({ kind: "follow", actor: fakeAddress(614), bitmap_number: 812345, post_id: null, created_at: at(80) }, true);
  return out
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((n, i, all) => ({ ...n, id: all.length - i, read: n.read || Date.parse(n.created_at) < (NOW - 3 * DAY) * 1000 }));
}

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
  return seedExtras(state);
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
    tippers30: fake(5, 8) + new Set((s.tips ?? []).filter((x) => x.status === "settled" && x.n === n && x.at / 1000 > since).map((x) => x.tipper)).size,
  };
}
// The visitor's wallet holds 2.5 million DOG, a Quantum Cat, three Bitcoin Puppets, seven
// Bitcoin Frogs and a Runestone, but no NodeMonkes; nothing shows until they pick it. Some other
// owners show made-up holdings, and 840001 and its neighbours show off the top tiers.
const DEMO_HOLDINGS: Partial<Record<PetKey, number>> = { dog: 2_500_000, cat: 1, puppet: 3, frog: 7, runestone: 1 };
const SHOWCASE_STREET: Record<number, Partial<Record<PetKey, number>>> = {
  840001: { dog: 420_000_000, cat: 12 },
  840002: { puppet: 12, monkey: 4, frog: 25 },
  840003: { monkey: 10, runestone: 11 },
  840004: { runestone: 4, frog: 6, cat: 2 },
};
const SECOND_HOLDINGS: Partial<Record<PetKey, number>> = { dog: 600_000, monkey: 4 };
function holdingsOf(address: string | null, n: number): Partial<Record<PetKey, number>> {
  if (!address) return {};
  if (address === DEMO_ADDRESS) {
    if (!load().linked?.includes(DEMO_SECOND_ADDRESS)) return DEMO_HOLDINGS;
    const sum: Partial<Record<PetKey, number>> = { ...DEMO_HOLDINGS };
    for (const [k, v] of Object.entries(SECOND_HOLDINGS) as [PetKey, number][]) sum[k] = (sum[k] ?? 0) + v;
    return sum;
  }
  if (SHOWCASE_STREET[n]) return SHOWCASE_STREET[n];
  if (hash(n + 61) > 0.14) return {};
  // Most show a dog, some a cat, a few one of the collections, never more than three.
  const extra = PET_KEYS.slice(2)[Math.floor(hash(n + 65) * 4)];
  return {
    dog: Math.floor(10 ** (hash(n + 62) * 9)),
    ...(hash(n + 63) < 0.5 ? { cat: 1 + Math.floor(hash(n + 64) * 4) } : {}),
    ...(hash(n + 66) < 0.3 ? { [extra]: 1 + Math.floor(hash(n + 67) * 12) } : {}),
  };
}
const petTier = (k: PetKey, amount: number) => PETS[k].tiers.filter((t) => amount >= t).length;
function petsAt(n: number): Pet[] {
  const owner = ownerOf(n);
  const held = holdingsOf(owner, n);
  const chosen = owner === DEMO_ADDRESS ? load().showcase?.[n] ?? [] : (Object.keys(held) as PetKey[]);
  return chosen.flatMap((k) => (petTier(k, held[k] ?? 0) ? [{ asset: k, tier: petTier(k, held[k]!), amount: String(held[k]) }] : []));
}
function showcaseView(n: number): Showcase {
  const held = holdingsOf(DEMO_ADDRESS, n);
  return {
    chosen: load().showcase?.[n] ?? [],
    held: PET_KEYS.map((k) => ({ asset: k, tier: petTier(k, held[k] ?? 0), amount: String(held[k] ?? 0) })),
    wallets: 1 + (load().linked?.length ?? 0),
    checked_at: iso(0.1),
    error: null,
    shown: petsAt(n),
  };
}
// 在售: a few districts listed on Magic Eden, among them one of the visitor's and two next to 840000.
const LISTED: Record<number, number> = { 840002: 4_200_000, 840005: 12_500_000, 840008: 6_900_000, 839998: 25_000_000 };
function saleAt(n: number): number | null {
  if (!ownerOf(n)) return null;
  if (LISTED[n]) return LISTED[n];
  const h = hash(n * 7 + 3);
  return h < 0.03 ? 300_000 + Math.round((h / 0.03) * 40) * 250_000 : null;
}
function saleOf(n: number): Sale | null {
  const price = saleAt(n);
  if (price == null) return null;
  return { price_sats: price, market: "magiceden", url: `https://magiceden.io/ordinals/item-details/${inscriptionId(n)}`, listed_at: iso(0.5 + hash(n) * 9) };
}

function tile(n: number): Tile {
  const s = load();
  const o = ownerOf(n);
  return {
    bitmap_number: n, zone: zoneOf(n), tx_count: txCount(n), claimed: !!o, owner: o,
    parcels: parcelIndexes(n).length,
    posts: s.posts.filter((p) => p.bitmap_number === n && !p.removed && p.reply_to == null).length,
    level: levelAt(n),
    style: styleAt(n),
    park: parkOf(n)?.id ?? null,
    pets: petsAt(n).map((x) => `${x.asset}:${x.tier}`),
    sale: saleAt(n),
  };
}
const ownScore = (n: number) => prosperity(parts(n));
/** Parks with only the members their owner still holds, and at least two of them. */
function liveParks() {
  return (load().parks ?? [])
    .map((p) => ({ ...p, members: p.members.filter((m) => ownerOf(m) === p.owner) }))
    .filter((p) => p.members.length >= 2);
}
function parkOf(n: number): Park | null {
  const p = liveParks().find((x) => x.members.includes(n));
  if (!p) return null;
  const score = p.members.reduce((a, m) => a + ownScore(m).score, 0);
  let level = 1;
  while (level < 5 && score >= THRESHOLDS[level]) level++;
  return { ...p, score, level };
}
function levelAt(n: number): number {
  if (zoneOf(n) === "landmark") return 5;
  return Math.max(ownScore(n).level, parkOf(n)?.level ?? 0);
}
/** The visitor's saved looks, and made-up ones on about a fifth of the claimed districts. */
function styleAt(n: number): DistrictStyle | null {
  const saved = load().styles?.[n];
  const lv = levelAt(n);
  if (saved) return visibleStyle(saved, lv);
  if (!ownerOf(n) || OWNED.includes(n) || hash(n + 41) > 0.2) return null;
  const colors = Object.keys(COLORS), decos = Object.keys(DECOS).filter((d) => DECOS[d].level <= lv);
  const k = Math.min(decos.length, 1 + Math.floor(hash(n + 43) * 3));
  const deco = decos.map((d, i) => [hash(n * 13 + i), d] as const).sort((a, b) => a[0] - b[0]).slice(0, k).map(([, d]) => d);
  return visibleStyle({ color: colors[Math.floor(hash(n + 42) * colors.length)], deco }, lv);
}
function recruitAt(n: number, me: string | null) {
  const s = load();
  const r = s.recruits?.[n];
  if (!r || ownerOf(n) !== r.by) return null;
  const taken = new Set(parcelIndexes(n));
  const apps = s.applications?.[n] ?? [];
  return { message: r.message, parcels: r.parcels.filter((i) => !taken.has(i)), updated_at: r.updated_at, applications: apps.length, applied: !!me && apps.some((a) => a.address === me) };
}
function pollView(p: DemoPoll, me: string | null): Poll {
  const counts = p.options.map((_, i) => Object.values(p.votes).filter((v) => v === i).length);
  const end = p.closed_at ?? p.closes_at;
  return {
    id: p.id, bitmap_number: p.n, question: p.question, options: p.options, counts, total: counts.reduce((a, b) => a + b, 0),
    my_vote: me != null && me in p.votes ? p.votes[me] : null, created_by: p.by, created_at: p.created_at, closes_at: end, closed: Date.parse(end) <= Date.now(),
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
    district: { inscription_id: inscriptionId(n), inscription_number: 30_000_000 + n, inscribed_height: 790_000 + (n % 40_000), owner: owner(o, n), sale: saleOf(n) },
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
  return { bio: p.bio ?? "", cover: p.cover ?? null, visitor_comments_on: p.visitor_comments_on ?? true, pinned_post_id: pinned, style: styleAt(n) };
}
// Other owners who linked X in the demo city; the visitor links their own from 我的土地.
const xAccount = (username: string, name: string): XAccount => ({ username, name, avatar_url: null, url: `https://x.com/${username}` });
function xOf(address: string | null): XAccount | null {
  if (!address) return null;
  if (address === DEMO_ADDRESS) return load().x ?? null;
  if (address === ownerOf(840001)) return xAccount("halving_next_door", "减半隔壁");
  if (address === SEED_PARK.owner) return xAccount("miner_village", "矿工新村");
  return null;
}
const view = (p: Post, me: string | null): Post => ({ ...p, author: { ...p.author, x: xOf(p.author.address)?.username ?? null, tippable: tippable(p.author.address) }, tips_sats: postTips(p.id), liked_by_me: !!me && !!load().likes[p.id], like_count: p.like_count + (me && load().likes[p.id] ? 1 : 0) });
const topPosts = (pred: (p: Post) => boolean, me: string | null) =>
  load().posts.filter((p) => !p.removed && p.reply_to == null && pred(p)).sort((a, b) => b.id - a.id).map((p) => view(p, me));
function district(n: number, me: string | null): District {
  const s = load();
  const prof = profile(n);
  const pinned = prof.pinned_post_id != null ? s.posts.find((p) => p.id === prof.pinned_post_id && !p.removed) : undefined;
  const [role, parcel] = roleOf(me, n);
  const pr = prosperity(parts(n));
  return {
    bitmap_number: n, name: `${n}.bitmap`, owner: ownerOf(n), owner_x: xOf(ownerOf(n)), profile: prof, pinned_post: pinned ? view(pinned, me) : null,
    followers: pr.parts.followers,
    post_count: s.posts.filter((p) => p.bitmap_number === n && !p.removed && p.reply_to == null).length,
    viewer: me ? { address: me, role, parcel, muted: (s.mutes[n] ?? []).includes(me), following: s.follows.includes(n) } : null,
    prosperity: zoneOf(n) === "landmark" ? { ...pr, level: 5, next: null } : pr,
    checked_in_today: !!me && (s.checkins?.[n] ?? []).includes(today()),
    level: levelAt(n),
    park: parkOf(n),
    recruit: recruitAt(n, me),
    pets: petsAt(n),
    tips: districtTips(n),
    owner_tippable: tippable(ownerOf(n)),
  };
}

// Search in the demo knows the visitor, the park next to the halving and the owner of 840001.
function searchDemo(q: string): SearchResults {
  const out: SearchResults = { districts: [], parks: [], people: [] };
  if (!q) return out;
  const m = q.match(/^#?(\d{1,7})(\.bitmap)?$/i);
  if (m && +m[1] <= DEMO_TIP) out.districts.push(+m[1]);
  const lower = q.toLowerCase();
  out.parks = liveParks()
    .filter((p) => p.name.toLowerCase().includes(lower))
    .slice(0, 5)
    .map((p) => ({ id: p.id, name: p.name, members: p.members.length, first: Math.min(...p.members) }));
  const handle = lower.replace(/^@/, "");
  const people: [string, number[]][] = [
    [DEMO_ADDRESS, OWNED],
    [SEED_PARK.owner, SEED_PARK.members],
    [ownerOf(840001)!, [840001]],
  ];
  out.people = people
    .filter(([a]) => (!m && q.length >= 6 && a.startsWith(lower)) || (!!handle && !!xOf(a)?.username.toLowerCase().includes(handle)))
    .map(([address, ns]) => {
      const sorted = [...ns].sort((x, y) => x - y);
      return { address, x: xOf(address), districts: sorted.slice(0, 6), count: sorted.length };
    });
  return out;
}

// Someone's page in the demo: land comes from the made-up owners, posts from the demo feed.
function personDemo(a: string, me: string | null, before: number | null): Person {
  const districts =
    a === DEMO_ADDRESS ? OWNED : a === SEED_PARK.owner ? SEED_PARK.members : a === ownerOf(840001) ? [840001] : [];
  const mine = load().posts.filter((p) => !p.removed && p.author.address === a);
  const posts = mine.filter((p) => before == null || p.id < before).sort((x, y) => y.id - x.id).slice(0, 20).map((p) => view(p, me));
  const first = mine.map((p) => p.created_at).sort()[0] ?? null;
  return {
    address: a,
    x: xOf(a),
    districts: [...districts].sort((x, y) => x - y).map((n) => ({ bitmap_number: n, level: levelAt(n), park: parkOf(n)?.name ?? null })),
    parcels: a === DEMO_ADDRESS ? [OWN_PARCEL] : [],
    post_count: mine.filter((p) => p.reply_to == null).length,
    reply_count: mine.filter((p) => p.reply_to != null).length,
    follows: a === DEMO_ADDRESS ? load().follows.length : 0,
    first_post_at: first,
    posts,
  };
}

const walletsView = (): LinkedWallet[] => [
  { address: DEMO_ADDRESS, main: true, me: true },
  ...(load().linked ?? []).map((address) => ({ address, main: false, me: false })),
];

const activeBans = () => (load().bans ?? []).filter((b) => !b.expires_at || Date.parse(b.expires_at) > Date.now());
const isBanned = (a: string) => activeBans().some((b) => b.address === a);

function reportGroups(me: string | null): ReportGroup[] {
  const s = load();
  const open = (s.reports ?? []).filter((r) => !r.resolved);
  const ids = [...new Set(open.map((r) => r.post_id))];
  return ids
    .map((id) => ({ id, post: s.posts.find((x) => x.id === id && !x.removed), reports: open.filter((r) => r.post_id === id) }))
    .filter((g) => g.post)
    .map((g) => ({
      post: view(g.post!, me),
      count: g.reports.length,
      reports: g.reports.map(({ reporter, reason, note, created_at }) => ({ reporter, reason, note, created_at })),
      author_banned: isBanned(g.post!.author.address),
    }))
    .sort((a, b) => b.count - a.count);
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
    return { address: a, districts: OWNED, parcels: [OWN_PARCEL], follows: [...s.follows].sort((x, y) => x - y), x: s.x ?? null, wallets: walletsView(), admin: true, banned: isBanned(a) } satisfies Me;
  }
  if ((m = p.match(/^\/v1\/people\/([^/]+)$/))) {
    const before = url.searchParams.get("before_id");
    return personDemo(decodeURIComponent(m[1]), me, before ? Number(before) : null);
  }
  if (p === "/v1/search") return searchDemo((url.searchParams.get("q") ?? "").trim());
  if (p === "/v1/me/wallets") {
    needMe();
    if (method === "POST") {
      if ((s.linked ??= []).includes(String(body.address))) fail(409, "already in your wallets");
      s.linked.push(String(body.address));
      save();
    }
    return { wallets: walletsView() };
  }
  if (p === "/v1/me/wallets/nonce") {
    needMe();
    if (body.address === DEMO_ADDRESS || s.linked?.includes(String(body.address))) fail(409, "already in your wallets");
    return { nonce: "demo", message: `Link this wallet on unimap\naddress: ${body.address}\nto: ${DEMO_ADDRESS}` };
  }
  if ((m = p.match(/^\/v1\/me\/wallets\/(\w+)$/)) && method === "DELETE") {
    needMe();
    s.linked = (s.linked ?? []).filter((a) => a !== m![1]);
    save();
    return { wallets: walletsView() };
  }
  // X sign-in skips x.com in the demo: start goes straight to the callback page.
  if (p === "/v1/x/link") {
    const a = needMe();
    if (method === "DELETE") {
      s.x = null;
      save();
      return { x: null };
    }
    return { available: true, x: xOf(a) };
  }
  if (p === "/v1/x/link/start") return needMe() && { url: "/x/callback?state=demo&code=demo" };
  if (p === "/v1/x/link/finish") {
    needMe();
    if (body.state !== "demo") fail(400, "这次 X 登录已过期，请重试");
    s.x = xAccount("unimap_demo", "演示访客");
    save();
    return { x: s.x };
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
  const owns = (n: number) => {
    const a = needMe();
    if (ownerOf(n) !== a) fail(403, "只有街区主人可以这样做");
    return a;
  };
  if (p === "/v1/recruiting") {
    const out: Recruiting[] = Object.keys(s.recruits ?? {})
      .map(Number)
      .flatMap((n) => {
        const r = recruitAt(n, me), o = ownerOf(n);
        return r && o ? [{ bitmap_number: n, name: `${n}.bitmap`, zone: zoneOf(n), owner: o, level: levelAt(n), message: r.message, parcels: r.parcels, updated_at: r.updated_at }] : [];
      })
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return { districts: out };
  }
  if ((m = p.match(/^\/v1\/districts\/(\d+)\/recruit$/))) {
    const n = +m[1], a = owns(n);
    if (method === "DELETE") {
      delete s.recruits![n];
      delete s.applications![n];
    } else {
      const plots = [...new Set((body.parcels as number[]) ?? [])].sort((x, y) => x - y);
      if (plots.some((i) => i < 0 || i >= txCount(n) || parcelIndexes(n).includes(i))) fail(400, "有的地块不存在或已经被认领");
      if (s.recruits![n] && s.recruits![n].by !== a) delete s.applications![n];
      s.recruits![n] = { message: String(body.message).trim(), parcels: plots, updated_at: new Date().toISOString(), by: a };
    }
    save();
    return method === "DELETE" ? { ok: true } : recruitAt(n, a);
  }
  if ((m = p.match(/^\/v1\/districts\/(\d+)\/applications?$/))) {
    const n = +m[1];
    if (p.endsWith("applications")) {
      owns(n);
      return { applications: [...(s.applications![n] ?? [])].reverse() };
    }
    const a = needMe();
    const list = (s.applications![n] ??= []);
    if (method === "DELETE") s.applications![n] = list.filter((x) => x.address !== a);
    else {
      if (!recruitAt(n, a)) fail(404, "这个街区没有在招募");
      if (roleOf(a, n)[0] !== "visitor") fail(400, "你已经住在这里了");
      s.applications![n] = [...list.filter((x) => x.address !== a), { address: a, note: String(body.note ?? "").trim(), created_at: new Date().toISOString() }];
    }
    save();
    return { ok: true };
  }
  if ((m = p.match(/^\/v1\/districts\/(\d+)\/polls$/))) {
    const n = +m[1];
    if (method === "GET") return { polls: s.polls!.filter((x) => x.n === n).sort((a, b) => b.id - a.id).map((x) => pollView(x, me)) };
    const a = owns(n);
    const options = (body.options as string[]).map((o) => o.trim());
    if (options.length < 2 || new Set(options).size !== options.length) fail(400, "选项要不同，至少两个");
    const poll: DemoPoll = { id: Math.max(0, ...s.polls!.map((x) => x.id)) + 1, n, question: String(body.question).trim(), options, by: a,
      created_at: new Date().toISOString(), closes_at: new Date(Date.now() + Number(body.days ?? 7) * DAY * 1000).toISOString(), closed_at: null, votes: {} };
    s.polls!.push(poll);
    save();
    return pollView(poll, a);
  }
  if ((m = p.match(/^\/v1\/polls\/(\d+)\/(vote|close)$/))) {
    const poll = s.polls!.find((x) => x.id === +m![1]) ?? fail(404, "没有这个投票");
    const a = needMe();
    if (m[2] === "close") {
      owns(poll.n);
      poll.closed_at ??= new Date().toISOString();
    } else {
      if (pollView(poll, a).closed) fail(409, "投票已经结束");
      if (roleOf(a, poll.n)[0] === "visitor") fail(403, "只有街区主人和居民可以投票");
      poll.votes[a] = Number(body.option);
    }
    save();
    return pollView(poll, a);
  }
  if ((m = p.match(/^\/v1\/districts\/(\d+)\/style$/))) {
    const n = +m[1];
    owns(n);
    const st = { color: String(body.color), deco: (body.deco as string[]) ?? [] };
    const lv = levelAt(n);
    const locked = [COLORS[st.color]?.level, ...st.deco.map((d) => DECOS[d]?.level)].some((l) => l == null || l > lv);
    if (locked) fail(403, `还没解锁，现在是 ${lv} 级`);
    s.styles![n] = st;
    save();
    return st;
  }
  if (p === "/v1/notifications" || p === "/v1/notifications/unread" || p === "/v1/notifications/read") {
    const a = needMe();
    const list = a === DEMO_ADDRESS ? s.notifications! : [];
    if (p === "/v1/notifications/read") {
      const upTo = (body.up_to as number | null) ?? Infinity;
      for (const n of list) if (n.id <= upTo) n.read = true;
      save();
    }
    const unread = list.filter((n) => !n.read).length;
    if (p === "/v1/notifications") {
      const before = Number(url.searchParams.get("before") ?? Infinity);
      return { notifications: list.filter((n) => n.id < before).slice(0, 30), unread };
    }
    return { unread };
  }
  if ((m = p.match(/^\/v1\/districts\/(\d+)\/showcase(\/refresh)?$/))) {
    const n = +m[1];
    owns(n);
    if (method === "PUT") {
      const assets = (body.assets as PetKey[]) ?? [];
      if (assets.some((k) => !(k in PETS))) fail(400, "没有这种藏品");
      if (assets.length > MAX_SHOWN) fail(400, `一个街区最多摆 ${MAX_SHOWN} 种`);
      (s.showcase ??= {})[n] = assets;
      save();
    }
    return showcaseView(n);
  }
  if ((m = p.match(/^\/v1\/parks(?:\/(\d+))?$/))) {
    const id = m[1] ? +m[1] : null;
    if (method === "GET") {
      const park = liveParks().find((x) => x.id === id);
      return park ? parkOf(park.members[0]) : fail(404, "没有这个园区");
    }
    const a = needMe();
    const existing = id != null ? s.parks!.find((x) => x.id === id) ?? fail(404, "没有这个园区") : null;
    if (existing && existing.owner !== a) fail(403, "只有园区主人可以这样做");
    if (method === "DELETE") {
      s.parks = s.parks!.filter((x) => x.id !== id);
      save();
      return { ok: true };
    }
    const members = [...new Set(body.members as number[])].sort((x, y) => x - y);
    if (members.length < 2 || !connected(members)) fail(400, "园区要由连成一片的两个以上街区组成，边挨着边或隔着马路相对都算");
    if (members.some((x) => ownerOf(x) !== a)) fail(403, "园区里的街区都要是你的");
    if (liveParks().some((x) => x.id !== id && x.members.some((y) => members.includes(y)))) fail(409, "有的街区已经在别的园区里了");
    const name = String(body.name).trim();
    if (existing) Object.assign(existing, { name, members });
    else s.parks!.push({ id: Math.max(0, ...s.parks!.map((x) => x.id)) + 1, name, owner: a, members });
    save();
    return parkOf(members[0]);
  }
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
    if (isBanned(a)) fail(403, "this address is banned from posting");
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
    return view(post, a);
  }
  if ((m = p.match(/^\/v1\/posts\/(\d+)\/replies$/)))
    return { replies: s.posts.filter((x) => x.reply_to === +m![1] && !x.removed).sort((a, b) => a.id - b.id).map((x) => view(x, me)) };
  if (p === "/v1/me/lightning") {
    needMe();
    if (method === "PUT") {
      const a = String(body.lightning_address ?? "").trim().toLowerCase();
      if (!/^[a-z0-9._+-]{1,64}@[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/.test(a)) fail(400, "a Lightning address looks like name@wallet.com");
      s.lightning = a;
      save();
    } else if (method === "DELETE") {
      s.lightning = null;
      save();
    }
    return { lightning_address: s.lightning ?? null };
  }
  if (p === "/v1/tips/top") return tipTop(me);
  if (p === "/v1/tips" && method === "POST") {
    const a = needMe();
    const sats = Number(body.amount_sats);
    if (!Number.isInteger(sats) || sats < 1 || sats > 1_000_000) fail(422, "amount_sats is 1 to 1,000,000");
    let recipient: string | null, n: number, postId: number | null = null;
    if (body.post_id != null) {
      const post = s.posts.find((x) => x.id === Number(body.post_id) && !x.removed) ?? fail(404, "no such post");
      [recipient, n, postId] = [post.author.address, post.bitmap_number, post.id];
    } else {
      n = Number(body.bitmap_number);
      recipient = ownerOf(n) ?? fail(404, "nobody holds this district");
    }
    if (recipient === a) fail(400, "you can't tip yourself");
    if (!tippable(recipient)) fail(409, "this person hasn't set up a Lightning address yet");
    const tip: DemoTip = { id: (s.tips ??= []).length + 1, tipper: a, recipient: recipient!, n, post_id: postId, sats, comment: String(body.comment ?? "").trim(), status: "pending", at: Date.now() };
    s.tips.push(tip);
    save();
    return { id: tip.id, invoice: fakeInvoice(sats, tip.id), amount_sats: sats, verifiable: true, status: "pending" } satisfies Tip;
  }
  if ((m = p.match(/^\/v1\/tips\/(\d+)$/))) {
    needMe();
    const tip = (s.tips ?? []).find((x) => x.id === +m![1]) ?? fail(404, "no such tip");
    // The demo wallet "pays" a few seconds after the invoice is shown.
    if (tip.status === "pending" && Date.now() - tip.at > 4000) {
      tip.status = "settled";
      tip.at = Date.now();
      save();
    }
    return { id: tip.id, status: tip.status, verifiable: true } satisfies Tip;
  }
  if ((m = p.match(/^\/v1\/posts\/(\d+)\/report$/)) && method === "POST") {
    const a = needMe(), id = +m[1];
    const post = s.posts.find((x) => x.id === id && !x.removed) ?? fail(404, "no such post");
    if (post.author.address === a) fail(400, "you can't report your own post");
    s.reports = (s.reports ?? []).filter((r) => !(r.post_id === id && r.reporter === a));
    s.reports.push({ post_id: id, reporter: a, reason: String(body.reason), note: String(body.note ?? ""), created_at: new Date().toISOString() });
    save();
    return { ok: true };
  }
  if (p === "/v1/admin/reports") return { reports: reportGroups(me) };
  if ((m = p.match(/^\/v1\/admin\/reports\/(\d+)$/)) && method === "POST") {
    needMe();
    const id = +m[1];
    if (body.action === "remove") {
      const post = s.posts.find((x) => x.id === id);
      if (post && !post.removed) {
        post.removed = true;
        const parent = s.posts.find((x) => x.id === post.reply_to);
        if (parent) parent.reply_count--;
      }
    }
    for (const r of s.reports ?? []) if (r.post_id === id) r.resolved = true;
    save();
    return { ok: true };
  }
  if (p === "/v1/admin/bans") {
    const a = needMe();
    if (method === "POST") {
      const address = String(body.address), days = body.days as number | null;
      if (address === DEMO_ADDRESS) fail(400, "can't ban a site admin");
      s.bans = (s.bans ?? []).filter((b) => b.address !== address);
      s.bans.unshift({ address, reason: String(body.reason ?? ""), banned_by: a, created_at: new Date().toISOString(),
        expires_at: days ? new Date(Date.now() + days * DAY * 1000).toISOString() : null });
      save();
    }
    return { bans: activeBans() };
  }
  if ((m = p.match(/^\/v1\/admin\/bans\/(\w+)$/)) && method === "DELETE") {
    needMe();
    s.bans = (s.bans ?? []).filter((b) => b.address !== m![1]);
    save();
    return { ok: true };
  }
  if ((m = p.match(/^\/v1\/posts\/(\d+)\/like$/))) {
    needMe();
    s.likes[+m[1]] = method === "PUT";
    save();
    return { ok: true };
  }
  if ((m = p.match(/^\/v1\/posts\/(\d+)$/)) && method === "GET") {
    const post = s.posts.find((x) => x.id === +m![1] && !x.removed) ?? fail(404, "no such post");
    return view(post, me);
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
