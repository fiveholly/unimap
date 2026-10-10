// Demo mode: a made-up city served from the browser, so the site runs with no API.
// Turned on by NEXT_PUBLIC_DEMO=1 (`npm run demo`). Every /v1 route the site uses is answered
// here from deterministic fake data; what the visitor does (posts, likes, follows, profile
// edits) is kept in localStorage, and "重置演示数据" clears it.

import type { MarketOffer, OfferQuote, Agent, AgentDraft, AgentGrant, AgentInfo, AgentTask, AgentView, Application, Badge, Contest, MarketListing, ContestMetric, District, DistrictGame, Draw, Game, Season, FeedItem, Land, LandEvent, Me, Notification, Parcel, Park, Poll, Post, Ranking, Recruiting, ReportGroup, Role, Ban, Sale, Tip, TipTop, LinkedWallet, Person, SearchResults, Showcase, Tile, XAccount } from "./api";
import { CLAIM_BLOCKS, pick, rarityOf, ROUND, roundOf, SEASON, seasonOf, sha256, type Rarity } from "./game";
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
  n > DEMO_TIP
    ? null // mined since the demo began: nobody has inscribed it yet
    : OWNED.includes(n)
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
  boot?: number; // when this demo began: a new block is "mined" every DEMO_BLOCK_MS after it
  badges?: Badge[]; // the visitor's
  opened?: Record<number, string>; // treasures opened, by block height
  contests?: DemoContest[]; // 街区活动
  market?: DemoListing[]; // 站内交易
  dummies?: boolean; // the visitor made the two small outputs a purchase needs
  agents?: DemoAgent[]; // 街区 agent, on the visitor's districts
  offers?: MarketOffer[]; // 出价
  agentPay?: { id: number; at: number; settled: boolean } | null;
};
type DemoAgent = Omit<Agent, "posted_today" | "running" | "problem"> & { n: number; message: string; revoked?: boolean; drafts: AgentDraft[] };
type DemoListing = { id: number; n: number; seller: string; price: number; status: MarketListing["status"]; at: string; txid?: string };
type DemoTip = { id: number; tipper: string; recipient: string; n: number; post_id: number | null; sats: number; comment: string; status: Tip["status"]; at: number; event?: [number, number] };
type DemoContest = { id: number; bitmap_number: number; season: number; host: string; metric: ContestMetric; prizes: number[]; note: string; created_at: string; cancelled?: boolean;
  winners?: { address: string; score: number; prize_sats: number }[]; crowd?: [string, number][] };
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
  s.boot ??= Date.now();
  s.badges ??= [{ kind: "treasure", height: DEMO_TIP - 400, bitmap_number: 840001, tx_index: OWN_PARCEL.tx_index, rarity: "rare", created_at: iso(3) }];
  s.market ??= [{ id: 1, n: 840005, seller: ownerOf(840005)!, price: 9_800_000, status: "active", at: iso(0.8) }];
  if (!s.offers) {
    const at = (d: number) => ({ created_at: iso(d), expires_at: iso(d - 7) });
    s.offers = [
      { id: 1, inscription_id: inscriptionId(840000), bitmap_number: 840000, tx_index: null, buyer: fakeAddress(611), seller: DEMO_ADDRESS, price_sats: 4_200_000, status: "active", txid: null, ...at(0.3) },
      { id: 2, inscription_id: inscriptionId(840000), bitmap_number: 840000, tx_index: null, buyer: fakeAddress(612), seller: DEMO_ADDRESS, price_sats: 3_500_000, status: "active", txid: null, ...at(1.5) },
    ];
    const ids = (s.notifications ?? []).map((x) => x.id);
    s.notifications = [{ id: Math.max(0, ...ids) + 1, kind: "offer", actor: fakeAddress(611), bitmap_number: 840000, post_id: null, created_at: iso(0.3), read: false, snippet: null },
      ...(s.notifications ?? [])];
  }
  if (!s.contests) {
    s.contests = seedContests(s);
    const ids = (s.notifications ?? []).map((x) => x.id);
    s.notifications = [{ id: Math.max(0, ...ids) + 1, kind: "event_win", actor: ownerOf(840001)!, bitmap_number: 840001, post_id: null, created_at: iso(0.15), read: false, snippet: null,
      block_height: (seasonOf(DEMO_TIP)[0] - 1) * SEASON }, ...(s.notifications ?? [])];
  }
  if (!s.agents) seedAgent(s);
  s.opened ??= Object.fromEntries(Array.from({ length: 12 }, (_, i) => [DEMO_TIP - 3 - i * 9, fakeAddress(900 + i)]));
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
const settledTips = () => (load().tips ?? []).filter((x) => x.status === "settled" && !x.event); // a prize isn't a tip the district earned
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
// 街区活动 in the demo: 840001's owner ran one last season (the visitor came second, all paid) and runs one now;
// the visitor ran one on 840000 last season with the second prize still to pay; the park's owner has one coming.
function seedContests(s: State): DemoContest[] {
  const S = seasonOf(DEMO_TIP)[0], host = ownerOf(840001)!;
  const payable = (i: number) => {
    while (!tippable(fakeAddress(i))) i++;
    return fakeAddress(i);
  };
  const out: DemoContest[] = [
    { id: 1, bitmap_number: 840001, season: S - 1, host, metric: "posts", prizes: [5000, 2100, 1000], note: "谢谢大家上个赛季把街区写得这么热闹", created_at: iso(20),
      winners: [{ address: payable(931), score: 14, prize_sats: 5000 }, { address: DEMO_ADDRESS, score: 9, prize_sats: 2100 }, { address: payable(937), score: 6, prize_sats: 1000 }] },
    { id: 2, bitmap_number: 840001, season: S, host, metric: "checkins", prizes: [10000, 5000, 2000], note: "这个赛季每天来签到的邻居，前三名有奖", created_at: iso(4),
      crowd: [[fakeAddress(941), 6], [fakeAddress(942), 5], [fakeAddress(943), 3], [fakeAddress(944), 2]] },
    { id: 3, bitmap_number: 840000, season: S - 1, host: DEMO_ADDRESS, metric: "replies", prizes: [3000, 1000], note: "", created_at: iso(18),
      winners: [{ address: payable(951), score: 11, prize_sats: 3000 }, { address: payable(961), score: 7, prize_sats: 1000 }] },
    { id: 4, bitmap_number: 839941, season: S + 1, host: SEED_PARK.owner, metric: "replies", prizes: [21000], note: "矿工新村下个赛季的回帖王", created_at: iso(1) },
  ];
  const paid = (c: DemoContest, place: number, tipper: string) => {
    const w = c.winners![place - 1];
    (s.tips ??= []).push({ id: s.tips.length + 1, tipper, recipient: w.address, n: c.bitmap_number, post_id: null, sats: w.prize_sats, comment: "", status: "settled", at: (NOW - 2 * DAY) * 1000, event: [c.id, place] });
  };
  [1, 2, 3].forEach((place) => paid(out[0], place, host));
  paid(out[2], 1, DEMO_ADDRESS);
  return out;
}

/** Who leads a running contest: the seeded crowd plus what really happened in the demo since the season began. */
function contestStandings(c: DemoContest) {
  const s = load(), tip = demoTip(), since = seasonOf(tip)[1];
  const start = Date.now() - (tip - since) * 600_000;
  const score = new Map<string, number>(c.crowd ?? []);
  if (c.metric === "checkins") {
    const days = (s.checkins?.[c.bitmap_number] ?? []).filter((d) => Date.parse(d) >= start - DAY * 1000).length;
    if (days && c.host !== DEMO_ADDRESS) score.set(DEMO_ADDRESS, days);
  } else
    for (const p of s.posts)
      if (p.bitmap_number === c.bitmap_number && !p.removed && (p.reply_to == null) === (c.metric === "posts") && Date.parse(p.created_at) >= start && p.author.address !== c.host)
        score.set(p.author.address, (score.get(p.author.address) ?? 0) + 1);
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([address, n]) => ({ address, score: n }));
}
function contestView(c: DemoContest): Contest {
  const cur = seasonOf(demoTip())[0], [, since, until] = seasonOf(c.season * SEASON);
  const status = c.cancelled ? "cancelled" : c.season > cur ? "upcoming" : c.season === cur ? "running" : "ended";
  const tips = load().tips ?? [];
  const paid = (place: number) => {
    const mine = tips.filter((x) => x.event?.[0] === c.id && x.event[1] === place);
    return mine.some((x) => x.status === "settled") ? "settled" : mine.some((x) => x.status === "pending") ? "pending" : null;
  };
  return {
    id: c.id, bitmap_number: c.bitmap_number, season: c.season, since, until, host: c.host, metric: c.metric, prizes: c.prizes,
    total_sats: c.prizes.reduce((a, b) => a + b, 0), note: c.note, status, created_at: c.created_at,
    ...(status === "running" ? { standings: contestStandings(c) } : {}),
    ...(status === "ended" ? { winners: (c.winners ?? []).map((w, i) => ({ ...w, place: i + 1, paid: paid(i + 1) })) } : {}),
  };
}

const DEMO_PSBT = "cHNidP8BAAoCAAAAAAAAAAAAAAA="; // an empty PSBT; the demo wallet hands it back as is
let lastPrice: number | null = null; // the price the visitor last asked to list at
function listingView(l: DemoListing): MarketListing {
  return { id: l.id, inscription_id: inscriptionId(l.n), bitmap_number: l.n, tx_index: null, seller: l.seller, price_sats: l.price, postage_sats: 546,
    status: l.status, created_at: l.at, txid: l.txid ?? null, buyer: null };
}

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
  add({ kind: "treasure", actor: "", bitmap_number: OWN_PARCEL.bitmap_number, post_id: null, created_at: at(0.1), block_height: DEMO_TIP, tx_index: OWN_PARCEL.tx_index, rarity: "epic" });
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
    lucky: luckyNow()?.n === n ? 1 : 0,
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
  const own = ownListing(n);
  if (own) return Math.min(own.price, LISTED[n] ?? Infinity);
  if (LISTED[n]) return LISTED[n];
  const h = hash(n * 7 + 3);
  return h < 0.03 ? 300_000 + Math.round((h / 0.03) * 40) * 250_000 : null;
}
// 站内交易 in the demo: 840005's owner listed it in unimap for less than on Magic Eden.
const ownListing = (n: number) => (load().market ?? []).find((x) => x.n === n && x.status === "active");
function saleOf(n: number): Sale | null {
  const own = ownListing(n);
  const price = saleAt(n);
  if (own && (price == null || own.price <= price)) return { price_sats: own.price, market: "unimap", url: null, listed_at: own.at, listing_id: own.id };
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
    lucky: luckyNow()?.n === n,
    treasure: openTreasures().get(n) ?? null,
    crown: crownOf(n),
  };
}
// ---- 区块节拍 -------------------------------------------------------------------
// The demo "mines" a block every DEMO_BLOCK_MS, and draws with the same formula as the API (lib/game.ts),
// from smaller candidate lists: the districts and parcels around the halving. Two blocks are mined to
// tell a story: the round's draw picks 840001, where the visitor lives, and the newest block at the
// start puts an epic treasure on the visitor's parcel.
const DEMO_BLOCK_MS = 75_000;
export const demoTip = () => DEMO_TIP + Math.min(500, Math.floor((Date.now() - (load().boot ?? Date.now())) / DEMO_BLOCK_MS));
let luckyPool: number[] | undefined, treasurePool: [number, number][] | undefined;
const districtPool = () => (luckyPool ??= Array.from({ length: 2001 }, (_, i) => 839_000 + i).filter((n) => ownerOf(n)));
const parcelPool = () => (treasurePool ??= Array.from({ length: 401 }, (_, i) => 839_800 + i).flatMap((n) => parcelIndexes(n).map((i) => [n, i] as [number, number])));
const blockHashes = new Map<number, string>();
function blockHash(h: number): string {
  let hit = blockHashes.get(h);
  if (hit) return hit;
  const make = (nonce: number, tail = "") => {
    const body = sha256(`demo block ${h} ${nonce}`);
    return "0000000000000000000" + body.slice(19, 64 - tail.length) + tail;
  };
  const [since] = roundOf(DEMO_TIP);
  if (h === since) {
    const want = districtPool().indexOf(OWN_PARCEL.bitmap_number);
    for (let k = 0; !hit; k++) if (pick(make(k), "lucky", districtPool().length) === want) hit = make(k);
  } else if (h === DEMO_TIP) {
    const want = parcelPool().findIndex(([n, i]) => n === OWN_PARCEL.bitmap_number && i === OWN_PARCEL.tx_index);
    for (let k = 0; !hit; k++) {
      const c = make(k, "00");
      if (c[61] !== "0" && pick(c, "treasure", parcelPool().length) === want) hit = c;
    }
  } else hit = make(0);
  blockHashes.set(h, hit);
  return hit;
}
function drawAt(h: number): Draw {
  const block_hash = blockHash(h), pool = parcelPool();
  const index = pick(block_hash, "treasure", pool.length);
  const [n, i] = index == null ? [null, null] : pool[index];
  const opened_by = load().opened?.[h] ?? null;
  return { height: h, block_hash, bitmap_number: n, tx_index: i, candidates: pool.length, index, rarity: rarityOf(block_hash), opened_by, open: !opened_by && h > demoTip() - CLAIM_BLOCKS };
}
function luckyNow(): { n: number; since: number; block_hash: string; index: number; candidates: number } | null {
  const [since] = roundOf(demoTip());
  const block_hash = blockHash(since), pool = districtPool();
  const index = pick(block_hash, "lucky", pool.length);
  return index == null ? null : { n: pool[index], since, block_hash, index, candidates: pool.length };
}
let openCache: { key: string; map: Map<number, Rarity> } | undefined;
/** The rarest open treasure in each district. */
function openTreasures(): Map<number, Rarity> {
  const tip = demoTip(), key = `${tip}:${Object.keys(load().opened ?? {}).length}`;
  if (openCache?.key === key) return openCache.map;
  const map = new Map<number, Rarity>();
  const order: Rarity[] = ["common", "rare", "epic", "legendary"];
  for (let h = tip - CLAIM_BLOCKS + 1; h <= tip; h++) {
    const d = drawAt(h);
    if (d.open && d.bitmap_number != null && (!map.has(d.bitmap_number) || order.indexOf(d.rarity) > order.indexOf(map.get(d.bitmap_number)!)))
      map.set(d.bitmap_number, d.rarity);
  }
  openCache = { key, map };
  return map;
}
function districtGame(n: number, me: string | null): DistrictGame {
  const tip = demoTip(), lucky = luckyNow();
  const treasures = [];
  for (let h = tip; h > tip - CLAIM_BLOCKS; h--) {
    const d = drawAt(h);
    if (d.open && d.bitmap_number === n)
      treasures.push({ height: h, block_hash: d.block_hash, tx_index: d.tx_index!, rarity: d.rarity, closes_at: h + CLAIM_BLOCKS - 1,
        claimable: me === DEMO_ADDRESS && n === OWN_PARCEL.bitmap_number && d.tx_index === OWN_PARCEL.tx_index });
  }
  const visited = !!me && (load().badges ?? []).some((b) => b.kind === "lucky_visit" && b.height === lucky?.since);
  const rank = crownOf(n);
  return {
    lucky: lucky?.n === n ? { since: lucky.since, until: lucky.since + ROUND - 1, visited } : null,
    treasures,
    crown: rank ? { rank, season: seasonOf(tip)[0] - 1 } : null,
  };
}
// 赛季: the last season's podium and this season's standings, made up from the demo's liveliest districts.
let crownCache: number[] | undefined;
const crowned = () => (crownCache ??= ((r) => [r[1], r[0], r[4]].filter(Boolean).map((x) => x.bitmap_number))(rankings()));
const crownOf = (n: number) => (crowned().indexOf(n) + 1) || null;
function seasonView(): Season {
  const tip = demoTip(), [n, since, until] = seasonOf(tip);
  const standings = rankings()
    .slice(0, 14)
    .map((r) => ({ bitmap_number: r.bitmap_number, owner: r.owner, score: Math.round(r.score * (0.25 + 0.35 * hash(r.bitmap_number + n))) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  const winners = crowned().map((b, i) => ({ bitmap_number: b, owner: ownerOf(b), score: [412, 356, 298][i] }));
  return {
    number: n, since, until, tip, started_at: new Date(Date.now() - (tip - since) * 600_000).toISOString(), standings,
    last: { number: n - 1, winners }, weights: { posts: 4, replies: 1.5, checkins: 1, tippers: 2 },
    pool_sats: 210_000, pool_split: [105_000, 63_000, 42_000],
  };
}

function gameView(me: string | null): Game {
  const tip = demoTip(), lucky = luckyNow();
  return {
    tip,
    round: lucky && { since: lucky.since, until: lucky.since + ROUND - 1, block_hash: lucky.block_hash, candidates: lucky.candidates, index: lucky.index, bitmap_number: lucky.n, owner: ownerOf(lucky.n) },
    draws: Array.from({ length: 20 }, (_, i) => drawAt(tip - i)),
    badges: me ? load().badges ?? [] : null,
    rules: { round: ROUND, claim_blocks: CLAIM_BLOCKS },
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
  if (n < 0 || n > demoTip()) fail(404, "no such block yet");
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
    game: districtGame(n, me),
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
    badges: a === DEMO_ADDRESS ? load().badges ?? [] : a === ownerOf(840001) ? [{ kind: "lucky", height: roundOf(DEMO_TIP)[0], bitmap_number: 840001, tx_index: null, rarity: "rare", created_at: iso(0.3) }] : [],
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


// 街区 agent: one already working on the visitor's 840000, with a digest it posted and two drafts waiting.
const AGENT_KEY = "7c3f9a1e5b2d8c4f6a0e9d3b1c7f5a2e8d4b6c0a9f3e1d7b5c2a8f4e6d0b9c3a";
const agentGrant = (n: number, key: string, perDay: number, expires: string) =>
  `unimap agent grant\ndistrict: ${n}.bitmap\nagent key: ${key}\nmay: draft posts and replies here; publish the ones I approve\nposts per day: ${perDay}\nexpires: ${expires.slice(0, 19)}Z\nissued: ${Math.floor(Date.now() / 1000)}`;
function seedAgent(s: State) {
  const n = 840000, expires = iso(-24);
  const find = (start: string) => s.posts.find((p) => p.bitmap_number === n && p.reply_to == null && p.body?.startsWith(start));
  const digest = "本周 840000 街区：发了 6 条帖子，#3 号地块换上了街区的 Mondrian 头像，居民们在讨论区块里最大的那笔交易。附近 840005 在 unimap 挂单 0.098 BTC。";
  const signed = `unimap agent post\ngrant: 1\nagent key: ${AGENT_KEY}\n\nunimap post\ndistrict: ${n}.bitmap\nreply-to: none\nas: none\n\n${digest}`;
  s.posts.push({ id: s.nextId++, bitmap_number: n, reply_to: null, body: digest, media: [], author: { address: DEMO_ADDRESS, role: "owner", parcel: null, as_bitmap: null },
    signed_message: signed, signature: sha256(signed) + sha256(digest), created_at: iso(2), removed: false, like_count: 4, reply_count: 0, liked_by_me: false,
    agent: { grant_id: 1, key: AGENT_KEY } });
  const mondrian = find("今天把 #3");
  s.agents = [{
    id: 1, n, key: AGENT_KEY, message: agentGrant(n, AGENT_KEY, 3, expires), posts_per_day: 3, expires_at: expires, granted_at: iso(6), paid_until: iso(-24),
    persona: "语气轻松一点，叫居民「邻居」。", tasks: ["welcome", "digest", "answers"], watch: { radius: 20, max_price_sats: 10_000_000 },
    memory: ["主人喜欢简短的帖子", "#3 号地块的邻居经常换头像"], last_run_at: iso(0.03), last: { at: iso(0.03), drafts: 2, error: null },
    drafts: [
      { id: 1, reply_to: null, body: "欢迎新邻居 bc1q7m…x2k4 搬进地块 #42！有什么想问的，在这里发帖就好。", why: "地块 #42 刚被认领", task: "welcome", status: "pending", post_id: null, created_at: iso(0.03), decided_at: null },
      ...(mondrian ? [{ id: 2, reply_to: mondrian.id, body: "很配！Mondrian 图就是这个区块里每笔交易的大小，#3 号地块正好在左上角那一块。", why: "邻居 #3 在问大家觉得新头像怎么样",
        task: "answers" as const, status: "pending" as const, post_id: null, created_at: iso(0.03), decided_at: null }] : []),
      { id: 3, reply_to: null, body: digest, why: "上周的周报", task: "digest", status: "posted", post_id: s.nextId - 1, created_at: iso(2.1), decided_at: iso(2) },
    ],
  }];
}
function agentView(a: DemoAgent, s: State): AgentView {
  const today = s.posts.filter((p) => p.agent?.grant_id === a.id && Date.parse(p.created_at) > Date.now() - DAY * 1000).length;
  const problem = Date.parse(a.expires_at) < Date.now() ? "expired" : a.paid_until && Date.parse(a.paid_until) < Date.now() ? "unpaid" : null;
  const { n: _n, message: _m, revoked: _r, drafts, ...rest } = a;
  const briefing: AgentView["briefing"] = (s.applications?.[a.n]?.length ?? 0) > 0 ? [{ kind: "applications", count: s.applications![a.n].length }] : [];
  return { agent: { ...rest, posted_today: today, running: false, problem }, drafts: drafts.filter((d) => d.status === "pending"),
    recent: drafts.filter((d) => d.status !== "pending").sort((x, y) => y.id - x.id), briefing };
}

function route(path: string, opts: Opts): unknown {
  const url = new URL(path, "http://demo");
  const p = url.pathname, method = opts.method || "GET";
  const me = opts.token ? DEMO_ADDRESS : null;
  const body = (opts.body ?? {}) as Record<string, unknown>;
  const s = load();
  const needMe = () => me ?? fail(401, "请先连接钱包");
  let m: RegExpMatchArray | null;

  if (p === "/v1/status") {
    const tip = demoTip();
    return { indexed_height: { bitmap: tip, parcel: tip, owner: tip } };
  }
  if (p === "/v1/game") return gameView(me);
  if (p === "/v1/season") return seasonView();
  if ((m = p.match(/^\/v1\/game\/treasures\/(\d+)\/open$/)) && method === "POST") {
    const a = needMe(), h = +m[1], d = drawAt(h);
    if (h > demoTip() || d.bitmap_number == null) fail(404, "no treasure at this block");
    if (h <= demoTip() - CLAIM_BLOCKS) fail(410, "this treasure has closed");
    if (!(d.bitmap_number === OWN_PARCEL.bitmap_number && d.tx_index === OWN_PARCEL.tx_index)) fail(403, "only the parcel's owner can open it");
    if (d.opened_by) fail(409, "already opened");
    (s.opened ??= {})[h] = a;
    const badge: Badge = { kind: "treasure", height: h, bitmap_number: d.bitmap_number!, tx_index: d.tx_index, rarity: d.rarity, created_at: new Date().toISOString() };
    (s.badges ??= []).unshift(badge);
    save();
    return { kind: "treasure", height: h, bitmap_number: d.bitmap_number, tx_index: d.tx_index, rarity: d.rarity };
  }
  if (p === "/v1/auth/nonce") return { nonce: "demo", message: "unimap login (demo)" };
  if (p === "/v1/auth/login") return { token: "demo-token", address: DEMO_ADDRESS };
  if (p === "/v1/auth/logout") return { ok: true };
  if (p === "/v1/land") {
    const tip = demoTip();
    const start = Math.max(0, Number(url.searchParams.get("start"))), end = Math.min(tip, Number(url.searchParams.get("end")));
    const tiles: Tile[] = [];
    for (let n = start; n <= end; n++) tiles.push(tile(n));
    return { tip, tiles };
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
    const lucky = luckyNow(), badges: Omit<Badge, "tx_index" | "created_at">[] = [];
    if (lucky?.n === +m[1] && !(s.badges ?? []).some((b) => b.kind === "lucky_visit" && b.height === lucky.since)) {
      badges.push({ kind: "lucky_visit", height: lucky.since, bitmap_number: lucky.n, rarity: "common" });
      (s.badges ??= []).unshift({ ...badges[0], tx_index: null, created_at: new Date().toISOString() });
    }
    save();
    return { ok: true, badges };
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
  if ((m = p.match(/^\/v1\/districts\/(\d+)\/events$/))) {
    const n = +m[1], cur = seasonOf(demoTip())[0];
    if (method === "GET")
      return { season: cur, events: s.contests!.filter((c) => c.bitmap_number === n).sort((a, b) => b.season - a.season || b.id - a.id).map(contestView) };
    const a = owns(n);
    const metric = String(body.metric) as ContestMetric, prizes = (body.prizes as number[]).map(Number);
    if (!["posts", "replies", "checkins"].includes(metric)) fail(400, "metric is one of posts, replies, checkins");
    if (!prizes.length || prizes.length > 3 || prizes.some((x) => !Number.isInteger(x) || x < 100 || x > 1_000_000)) fail(400, "each prize is 100 to 1,000,000 sats");
    if (prizes.some((x, i) => i > 0 && x > prizes[i - 1])) fail(400, "a lower place can't get more than a higher one");
    const season = cur + (body.next_season ? 1 : 0);
    if (s.contests!.some((c) => c.bitmap_number === n && c.season === season && !c.cancelled)) fail(409, "this district already has an event that season");
    const c: DemoContest = { id: Math.max(0, ...s.contests!.map((x) => x.id)) + 1, bitmap_number: n, season, host: a, metric, prizes, note: String(body.note ?? "").trim(), created_at: new Date().toISOString() };
    s.contests!.push(c);
    save();
    return contestView(c);
  }
  if (p === "/v1/events") {
    const cur = seasonOf(demoTip())[0];
    return { events: s.contests!.filter((c) => !c.cancelled && c.season >= cur).sort((a, b) => a.season - b.season || b.prizes.reduce((x, y) => x + y, 0) - a.prizes.reduce((x, y) => x + y, 0)).map(contestView) };
  }
  if ((m = p.match(/^\/v1\/events\/(\d+)$/)) && method === "DELETE") {
    const a = needMe(), c = s.contests!.find((x) => x.id === +m![1]) ?? fail(404, "no such event");
    if (c.host !== a) fail(403, "only the host can call this event off");
    if (!c.cancelled && c.season <= seasonOf(demoTip())[0]) fail(409, "this event has started; it runs to the end of the season");
    c.cancelled = true;
    save();
    return contestView(c);
  }
  if (p === "/v1/agent") return { open: true, price_sats: 2100, days: 30, max_days: 90, max_per_day: 10, tasks: ["welcome", "digest", "answers"] } satisfies AgentInfo;
  if ((m = p.match(/^\/v1\/districts\/(\d+)\/agent(\/[a-z]+)?$/))) {
    const n = +m[1], a = owns(n), live = s.agents!.find((x) => x.n === n && !x.revoked);
    const sub = m[2] ?? "";
    if (sub === "/prepare") {
      const key = sha256(`agent:${n}:${Date.now()}`);
      const days = Number(body.days ?? 30), perDay = Number(body.posts_per_day ?? 3);
      const id = Math.max(0, ...s.agents!.map((x) => x.id)) + 1;
      const expires = new Date(Date.now() + days * DAY * 1000).toISOString();
      s.agents!.push({ id, n, key, message: agentGrant(n, key, perDay, expires), posts_per_day: perDay, expires_at: expires, granted_at: "", paid_until: null, persona: "", tasks: ["welcome", "digest", "answers"],
        watch: {}, memory: [], last_run_at: null, last: null, drafts: [], revoked: true });
      save();
      return { id, message: s.agents!.find((x) => x.id === id)!.message };
    }
    if (sub === "" && method === "POST") {
      const g = s.agents!.find((x) => x.id === Number(body.id) && x.n === n && !x.granted_at) ?? fail(404, "no such grant waiting to be signed; start again");
      const last = live ?? s.agents!.filter((x) => x.n === n && x.granted_at && x.id !== g.id).sort((x, y) => y.id - x.id)[0];
      if (last) Object.assign(g, { persona: last.persona, tasks: last.tasks, watch: last.watch, memory: last.memory, paid_until: last.paid_until });
      if (live) {
        live.revoked = true;
        live.drafts.forEach((d) => d.status === "pending" && (d.status = "expired"));
      }
      g.revoked = false;
      g.granted_at = new Date().toISOString();
      save();
      return agentView(g, s);
    }
    if (sub === "" && method === "DELETE") {
      const gone = live ?? fail(404, "this district has no agent");
      gone.revoked = true;
      gone.drafts.forEach((d) => d.status === "pending" && (d.status = "expired"));
      save();
      return { ok: true };
    }
    if (sub === "" && method === "GET") {
      if (!live) return { agent: null, drafts: [], recent: [], briefing: [] } satisfies AgentView;
      return agentView(live, s);
    }
    const ag = live ?? fail(404, "this district has no agent");
    if (sub === "/settings") {
      Object.assign(ag, { persona: String(body.persona ?? "").trim(), tasks: body.tasks as AgentTask[], watch: body.watch as Agent["watch"],
        memory: body.memory ? ag.memory.filter((x) => (body.memory as string[]).includes(x)) : ag.memory });
      save();
      return agentView(ag, s);
    }
    if (sub === "/run") {
      if (ag.last_run_at && Date.now() - Date.parse(ag.last_run_at) < 10 * 60_000) fail(429, "it looked a few minutes ago; try again later");
      const id = Math.max(0, ...ag.drafts.map((d) => d.id)) + 1, now = new Date().toISOString();
      ag.drafts.push({ id, reply_to: null, body: `这周 ${n} 街区很热闹：有新邻居搬进来，邻居们换了头像，也在聊区块里最大的那笔交易。欢迎大家周末来签到。`, why: "该写本周周报了",
        task: "digest", status: "pending", post_id: null, created_at: now, decided_at: null });
      Object.assign(ag, { last_run_at: now, last: { at: now, drafts: 1, error: null } });
      save();
      return { running: true };
    }
    if (sub === "/pay") {
      s.agentPay = { id: Date.now() % 100000, at: Date.now(), settled: false };
      save();
      return { id: s.agentPay.id, invoice: "lnbc21000n1pdemoagent0unimap0city", amount_sats: 2100, verifiable: true, status: "pending" } satisfies Tip;
    }
    void a;
  }
  if ((m = p.match(/^\/v1\/agent\/payments\/(\d+)$/))) {
    needMe();
    const pay = s.agentPay?.id === +m[1] ? s.agentPay : fail(404, "no such payment");
    if (!pay.settled && Date.now() - pay.at > 4000) {
      pay.settled = true;
      const live = s.agents!.find((x) => !x.revoked);
      if (live) live.paid_until = new Date(Math.max(Date.now(), Date.parse(live.paid_until ?? "0")) + 30 * DAY * 1000).toISOString();
      save();
    }
    return { id: pay.id, status: pay.settled ? "settled" : "pending", verifiable: true } satisfies Tip;
  }
  if ((m = p.match(/^\/v1\/agent\/drafts\/(\d+)(\/publish)?$/))) {
    const a = needMe(), id = +m[1];
    const live = s.agents!.find((x) => !x.revoked && ownerOf(x.n) === a && x.drafts.some((d) => d.id === id && d.status === "pending")) ?? fail(409, "this draft isn't waiting any more");
    const d = live.drafts.find((x) => x.id === id)!, now = new Date().toISOString();
    if (!m[2]) {
      Object.assign(d, { status: "discarded", decided_at: now });
      save();
      return { ok: true };
    }
    const view0 = agentView(live, s);
    if (view0.agent!.posted_today >= live.posts_per_day) fail(429, `the grant allows ${live.posts_per_day} agent posts a day`);
    const text = String(body.body ?? d.body).trim();
    const signed = `unimap agent post\ngrant: ${live.id}\nagent key: ${live.key}\n\nunimap post\ndistrict: ${live.n}.bitmap\nreply-to: ${d.reply_to ?? "none"}\nas: none\n\n${text}`;
    const post: Post = { id: s.nextId++, bitmap_number: live.n, reply_to: d.reply_to, body: text, media: [], author: { address: a, role: "owner", parcel: null, as_bitmap: null },
      signed_message: signed, signature: sha256(signed) + sha256(text), created_at: now, removed: false, like_count: 0, reply_count: 0, liked_by_me: false,
      agent: { grant_id: live.id, key: live.key } };
    s.posts.push(post);
    if (d.reply_to != null) {
      const parent = s.posts.find((x) => x.id === d.reply_to);
      if (parent) parent.reply_count++;
    }
    Object.assign(d, { status: "posted", post_id: post.id, body: text, decided_at: now });
    save();
    return view(post, a);
  }
  if ((m = p.match(/^\/v1\/agent\/grants\/(\d+)$/))) {
    const g = s.agents!.find((x) => x.id === +m![1] && x.granted_at) ?? fail(404, "no such grant");
    return { id: g.id, bitmap_number: g.n, owner: ownerOf(g.n) ?? DEMO_ADDRESS, agent_key: g.key, message: g.message, signature: "演示签名", granted_at: g.granted_at,
      expires_at: g.expires_at, revoked_at: g.revoked ? new Date().toISOString() : null } satisfies AgentGrant;
  }
  if (p === "/v1/market/offers" && method === "GET") {
    const n = url.searchParams.get("bitmap_number"), mine = url.searchParams.get("mine");
    const live = (o: MarketOffer) => o.status === "active" && Date.parse(o.expires_at) > Date.now();
    if (mine) return { offers: s.offers!.filter((o) => o.status !== ("unsigned" as string) && (o.buyer === needMe() || o.seller === me)).sort((a, b) => b.id - a.id) };
    return { offers: s.offers!.filter((o) => live(o) && (n == null || o.bitmap_number === +n)).sort((a, b) => b.price_sats - a.price_sats) };
  }
  if (p === "/v1/market/offers/prepare") {
    const a = needMe(), n = Number(body.bitmap_number), tx = (body.tx_index as number | null) ?? null;
    const holder = (tx == null ? ownerOf(n) : parcelOwner(n, tx)) ?? fail(404, "nobody holds it yet");
    if (holder === a) fail(400, "it's already yours");
    if (!s.dummies) fail(409, "need_dummies: the paying address needs two small outputs (up to 1000 sats) first");
    const price = Number(body.price_sats);
    if (!Number.isInteger(price) || price < 1000) fail(422, "price_sats is at least 1000");
    const o = { id: Math.max(0, ...s.offers!.map((x) => x.id)) + 1, inscription_id: inscriptionId(n), bitmap_number: n, tx_index: tx, buyer: a, seller: holder, price_sats: price,
      status: "unsigned" as MarketOffer["status"], txid: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600_000).toISOString() };
    s.offers!.push(o);
    save();
    const network = 141 * 3;
    return { offer_id: o.id, psbt: DEMO_PSBT, sign_inputs: [0, 1, 3], price_sats: price, fee_sats: 0, network_fee_sats: network, fee_rate: 3, postage_sats: 546, total_sats: price + network } satisfies OfferQuote;
  }
  if ((m = p.match(/^\/v1\/market\/offers\/(\d+)(\/sign|\/accept\/prepare|\/accept)?$/))) {
    const a = needMe(), o = s.offers!.find((x) => x.id === +m![1]) ?? fail(404, "no such offer");
    const sub = m[2] ?? "";
    if (sub === "/sign") {
      if (o.buyer !== a) fail(404, "no such offer");
      s.offers!.forEach((x) => x.buyer === a && x.inscription_id === o.inscription_id && x.status === "active" && (x.status = "expired"));
      Object.assign(o, { status: "active", expires_at: new Date(Date.now() + Number(body.days ?? 7) * DAY * 1000).toISOString() });
      save();
      return o;
    }
    if (sub === "" && method === "DELETE") {
      if (a !== o.buyer && a !== o.seller) fail(403, "only the buyer or the holder can do this");
      if (o.status === "active") o.status = a === o.buyer ? "cancelled" : "declined";
      save();
      return o;
    }
    if (o.seller !== a) fail(403, "only the holder can accept it");
    if (o.status !== "active") fail(409, "this offer can't be accepted any more");
    if (sub === "/accept/prepare") return { psbt: DEMO_PSBT, psbt_hex: "", sign_inputs: [2], price_sats: o.price_sats, postage_sats: 546 };
    if (sub === "/accept") {
      o.status = "accepted";
      o.txid = sha256(`offer:${o.id}`);
      s.offers!.forEach((x) => x.inscription_id === o.inscription_id && x.status === "active" && (x.status = "expired"));
      save();
      return { txid: o.txid, offer_id: o.id };
    }
  }
  if (p === "/v1/market") return { open: true, network: "testnet4", fee_bps: 0, dummy_sats: 600 };
  if (p === "/v1/market/listings" && method === "GET") {
    const n = url.searchParams.get("bitmap_number");
    return { listings: s.market!.filter((x) => x.status === "active" && (n == null || x.n === +n)).map(listingView) };
  }
  if (p === "/v1/market/listings/prepare") {
    owns(Number(body.bitmap_number));
    lastPrice = Number(body.price_sats);
    return { psbt: DEMO_PSBT, psbt_hex: "", sign_inputs: [0], sighash: 0x83, inscription_id: inscriptionId(Number(body.bitmap_number)), postage_sats: 546 };
  }
  if (p === "/v1/market/listings" && method === "POST") {
    const n = Number(body.bitmap_number), a = owns(n);
    s.market!.forEach((x) => x.n === n && x.status === "active" && (x.status = "replaced"));
    const l: DemoListing = { id: Math.max(0, ...s.market!.map((x) => x.id)) + 1, n, seller: a, price: lastPrice ?? 1_000_000, status: "active", at: new Date().toISOString() };
    s.market!.push(l);
    save();
    return listingView(l);
  }
  if ((m = p.match(/^\/v1\/market\/listings\/(\d+)$/)) && method === "DELETE") {
    const a = needMe(), l = s.market!.find((x) => x.id === +m![1]) ?? fail(404, "no such listing");
    if (l.seller !== a) fail(403, "only the seller can take it down");
    if (l.status === "active") l.status = "cancelled";
    save();
    return listingView(l);
  }
  if ((m = p.match(/^\/v1\/market\/listings\/(\d+)\/quote$/))) {
    const a = needMe(), l = s.market!.find((x) => x.id === +m![1] && x.status === "active") ?? fail(409, "this listing is no longer for sale");
    if (l.seller === a) fail(400, "you can't buy your own listing");
    if (!s.dummies) fail(409, "need_dummies: the paying address needs two small outputs (up to 1000 sats) first");
    const network = 141 * 3;
    return { quote_id: l.id, psbt: DEMO_PSBT, psbt_hex: "", sign_inputs: [0, 1, 3], price_sats: l.price, fee_sats: 0, network_fee_sats: network, fee_rate: 3,
      postage_sats: 546, total_sats: l.price + network, expires_in: 600 };
  }
  if (p === "/v1/market/dummies") return (needMe(), { psbt: DEMO_PSBT, psbt_hex: "", sign_inputs: [0], network_fee_sats: 513 });
  if (p === "/v1/market/dummies/broadcast") {
    needMe();
    s.dummies = true;
    save();
    return { txid: sha256(`dummies:${Date.now()}`) };
  }
  if ((m = p.match(/^\/v1\/market\/quotes\/(\d+)\/submit$/))) {
    const a = needMe(), l = s.market!.find((x) => x.id === +m![1] && x.status === "active") ?? fail(409, "this listing is no longer for sale");
    l.status = "sold";
    l.txid = sha256(`sale:${l.id}:${a}`);
    save();
    return { txid: l.txid, listing_id: l.id };
  }
  if (p === "/v1/tips/top") return tipTop(me);
  if (p === "/v1/tips" && method === "POST") {
    const a = needMe();
    const sats = Number(body.amount_sats);
    if (!Number.isInteger(sats) || sats < 1 || sats > 1_000_000) fail(422, "amount_sats is 1 to 1,000,000");
    let recipient: string | null, n: number, postId: number | null = null, event: [number, number] | undefined;
    if (body.event_id != null) {
      const c = s.contests!.find((x) => x.id === Number(body.event_id)) ?? fail(404, "no such event");
      if (c.host !== a) fail(403, "only the host pays this event's prizes");
      const w = contestView(c).winners?.[Number(body.place) - 1] ?? fail(404, "no such place");
      if (sats !== w.prize_sats) fail(400, `this prize is ${w.prize_sats} sats`);
      [recipient, n, event] = [w.address, c.bitmap_number, [c.id, w.place]];
    } else if (body.post_id != null) {
      const post = s.posts.find((x) => x.id === Number(body.post_id) && !x.removed) ?? fail(404, "no such post");
      [recipient, n, postId] = [post.author.address, post.bitmap_number, post.id];
    } else {
      n = Number(body.bitmap_number);
      recipient = ownerOf(n) ?? fail(404, "nobody holds this district");
    }
    if (recipient === a) fail(400, "you can't tip yourself");
    if (!tippable(recipient)) fail(409, "this person hasn't set up a Lightning address yet");
    const tip: DemoTip = { id: (s.tips ??= []).length + 1, tipper: a, recipient: recipient!, n, post_id: postId, sats, comment: String(body.comment ?? "").trim(), status: "pending", at: Date.now(), event };
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
