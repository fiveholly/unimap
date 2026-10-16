// Demo mode: a made-up city served from the browser, so the site runs with no API.
// Turned on by NEXT_PUBLIC_DEMO=1 (`npm run demo`). Every /v1 route the site uses is answered
// here from deterministic fake data; what the visitor does (posts, likes, follows, profile
// edits) is kept in localStorage, and "重置演示数据" clears it.

import type { Capsule, CapsulePeer, CapsuleScope, Conversation, DmMessage, MarketOffer, OfferQuote, Agent, AgentDraft, AgentGrant, AgentInfo, AgentTask, AgentView, Application, Tenant, Badge, CaredPet, Contest, MarketListing, ContestMetric, District, DistrictGame, Draw, Game, Season, FeedItem, Land, LandEvent, Me, Notification, Parcel, Park, Poll, Post, Ranking, Recruiting, ReportGroup, Role, Ban, Sale, Metrics, ShopBought, ShopItem, Tip, TipTop, LinkedWallet, Person, SearchResults, Showcase, Tile, XAccount } from "./api";
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
  { n: 840001, who: 7, body: "在 #7 号地块上开了一家小书店，周末开门。", ago: 1.1, replies: [[14, "书店卖旧书吗？几点开门？"]] },
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
  tenants?: Record<number, Tenant[]>; // 暂住居民 (api/tenants.py)
  polls?: DemoPoll[];
  parks?: { id: number; name: string; owner: string; members: number[] }[];
  showcase?: Record<number, PetKey[]>; // what the visitor chose to show on their districts
  notifications?: Notification[]; // the visitor's, newest first
  x?: XAccount | null; // the visitor's linked X account
  linked?: string[]; // wallets the visitor linked to their own
  reports?: { post_id: number; reporter: string; reason: string; note: string; created_at: string; resolved?: boolean }[];
  bans?: Ban[];
  lightning?: string | null; // the visitor's Lightning address for tips
  petCare?: Partial<Record<PetKey, DemoCare>>; // 我的宠物: feeding and names (api/pets.py)
  nostr?: string | null; // the visitor's linked Nostr key
  parcelPet?: PetKey | null; // the pet the visitor shows on their parcel
  pats?: Record<string, string>; // "owner:asset" -> the day the visitor last patted that pet (串门摸宠物)
  tips?: DemoTip[];
  boot?: number; // when this demo began: a new block is "mined" every DEMO_BLOCK_MS after it
  badges?: Badge[]; // the visitor's
  worn?: number | null; // the id (badgeId) of the badge the visitor wears
  opened?: Record<number, string>; // treasures opened, by block height
  contests?: DemoContest[]; // 街区活动
  market?: DemoListing[]; // 站内交易
  packed?: number[]; // parks whose districts sit in one output (园区打包卖)
  dummies?: boolean; // the visitor made the two small outputs a purchase needs
  agents?: DemoAgent[]; // 街区 agent, on the visitor's districts
  offers?: MarketOffer[]; // 出价
  agentPay?: { id: number; at: number; settled: boolean; agent?: number } | null;
  shop?: DemoItem[]; // 店铺
  orders?: DemoOrder[];
  capsules?: DemoCapsule[]; // 时间胶囊 the visitor sealed
  capsulePays?: { id: number; ref: string; at: number; settled: boolean }[]; // 封存 invoices (api/billing.py), paid by 演示：模拟付款
  dms?: DemoDm[]; // 私信
  dmStrangers?: boolean;
  blocked?: string[]; // addresses the visitor muted (and so won't hear from)
};
type DemoCapsule = Omit<Capsule, "status" | "tip" | "blocks_left" | "open_height" | "key" | "mine" | "payment" | "has_photo"> & {
  ref: string; escrow: string; open_height: number | null;
  pending?: boolean; // 封存 waiting for its (simulated) payment
  told?: boolean; // 「信打开了」 written
};
type DemoDm = { id: number; from: string; to: string; body: string; at: number; read?: boolean; removed?: boolean };
type DemoAgent = Omit<Agent, "posted_today" | "running" | "problem"> & { n: number; message: string; revoked?: boolean; drafts: AgentDraft[] };
type DemoItem = Omit<ShopItem, "sold" | "left" | "on_sale" | "mine" | "bought"> & { content: string; sold: number; introduced?: boolean };
type DemoOrder = { id: number; item: number; buyer: string; at: number; settled: boolean };
type DemoListing = { id: number; n: number; seller: string; price: number; status: MarketListing["status"]; at: string; txid?: string; park?: number; members?: number[]; tx?: number };
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
    840008: { message: "找几个常来聊天的邻居，先暂住，熟了再给地块。", parcels: [], updated_at: iso(0.8), by: DEMO_ADDRESS },
  };
  // Two people waiting on the visitor's own notice, so "let them stay" can be tried.
  s.applications ??= {
    840008: [
      { address: fakeAddress(4101), note: "每天都来巡城，想在这儿发帖", created_at: iso(0.6) },
      { address: fakeAddress(4102), note: "", created_at: iso(0.2) },
    ],
  };
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
  // Residents selling their parcels (地块交易), two of them in a district that is recruiting.
  if (!s.market.some((x) => x.tx != null)) {
    const picks: [number, number, number][] = [[840002, 0, 180_000], [840002, 1, 260_000], [839941, 0, 95_000], [840001, 2, 420_000]];
    for (const [n, k, price] of picks) {
      const i = parcelIndexes(n).filter((x) => parcelOwner(n, x) !== DEMO_ADDRESS)[k];
      if (i == null) continue;
      s.market.push({ id: Math.max(0, ...s.market.map((x) => x.id)) + 1, n, tx: i, seller: parcelOwner(n, i), price, status: "active", at: iso(0.3 + k) });
    }
  }
  // 矿工新村's owner put the whole park up in one sale.
  if (!s.packed) {
    s.packed = [SEED_PARK.id];
    s.market.push({ id: Math.max(0, ...s.market.map((x) => x.id)) + 1, n: SEED_PARK.members[0], seller: SEED_PARK.owner, price: 42_000_000, status: "active", at: iso(1.5), park: SEED_PARK.id, members: SEED_PARK.members });
  }
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
  s.shop ??= seedShop();
  s.orders ??= [];
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
let lastMove: { park: number; pack: boolean } | null = null; // the pack or unpack handed to the visitor's wallet
function listingView(l: DemoListing): MarketListing {
  return { id: l.id, inscription_id: inscriptionId(l.tx == null ? l.n : l.n * 1000 + l.tx), bitmap_number: l.n, tx_index: l.tx ?? null, seller: l.seller, price_sats: l.price, postage_sats: 546,
    status: l.status, created_at: l.at, txid: l.txid ?? null, buyer: null, park_id: l.park ?? null, members: l.members ?? null };
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
    pets: ownerOf(n) === DEMO_ADDRESS ? petsAt(n).reduce((sum, x) => sum + caredPet(x.asset).level - 1, 0) : 0,
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
// 我的宠物, as api/pets.py: the dog has been looked after for a few days, the others are new.
type DemoCare = { name: string | null; affection: number; fed_at: number | null; streak: number; last_day: string | null; face?: string | null; public?: boolean };
// The demo frogs are real Bitcoin Frogs (their pictures load from ordinals.com); the other
// collections have no made-up inscriptions, so their pets are drawn.
const DEMO_ITEMS: Partial<Record<PetKey, string[]>> = {
  frog: [
    "6f7db76f94fdfbba79be9af20befc936d7fcc53cc5b0911739b9ff377e793ba9i0",
    "7fcdcc1d3957390a2976e6dafa01ebb0b01ba8b0ffbc119b8f1911e18591321fi0",
    "79e4567ff1ef86d80a3156393fa730c00a56d3d70548029aa82d3d8b63a87a81i0",
    "ebe961f34d2ccf9d08b478db174a990beff3ad0ced56527168f25cd9ef4ad605i0",
    "4709d556f22f35ec203a3b7d9ca35d68e4314b4ccd4bea27445c784a74a22d11i0",
    "18262584040e850500cbad95b025c007e01e08bda42e4746ec00dfe4179cfc28i0",
    "938b88de10dbdfa91d71103c72a515fe7d5271214a02ba0903373cba02565017i0",
  ],
};
const FEED_HOURS = 6, HOUR = 3_600_000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
function careOf(k: PetKey): DemoCare {
  const c = load().petCare?.[k];
  if (c) return c;
  return k === "dog" ? { name: null, affection: 140, fed_at: Date.now() - 8 * HOUR, streak: 4, last_day: dayOf(Date.now() - DAY * 1000) } : { name: null, affection: 0, fed_at: null, streak: 0, last_day: null };
}
function caredPet(k: PetKey): CaredPet {
  const held = holdingsOf(DEMO_ADDRESS, 0)[k] ?? 0, c = careOf(k), now = Date.now();
  const level = Math.min(10, 1 + Math.floor(Math.sqrt(Math.floor(c.affection / 30))));
  const hours = c.fed_at == null ? Infinity : (now - c.fed_at) / HOUR;
  return {
    asset: k, tier: petTier(k, held), amount: String(held), name: c.name, affection: c.affection, level,
    next_level_at: level < 10 ? 30 * level ** 2 : null,
    streak: c.last_day && c.last_day >= dayOf(now - DAY * 1000) ? c.streak : 0,
    fed_at: c.fed_at == null ? null : new Date(c.fed_at).toISOString(),
    can_feed_at: c.fed_at == null ? null : new Date(c.fed_at + FEED_HOURS * HOUR).toISOString(),
    items: DEMO_ITEMS[k] ?? [],
    public: !!c.public,
    face: c.face && DEMO_ITEMS[k]?.includes(c.face) ? c.face : null,
    mood: c.fed_at == null || (hours >= 24 && hours < 72) ? "hungry" : hours < FEED_HOURS ? "full" : hours < 24 ? "ok" : "starving",
  };
}
const myPets = () => PET_KEYS.filter((k) => petTier(k, holdingsOf(DEMO_ADDRESS, 0)[k] ?? 0) > 0);
const petTier = (k: PetKey, amount: number) => PETS[k].tiers.filter((t) => amount >= t).length;
function petsAt(n: number): Pet[] {
  const owner = ownerOf(n);
  const held = holdingsOf(owner, n);
  const chosen = owner === DEMO_ADDRESS ? load().showcase?.[n] ?? [] : (Object.keys(held) as PetKey[]);
  const face = (k: PetKey) => (owner === DEMO_ADDRESS ? caredPet(k).face : null);
  return chosen.flatMap((k) => (petTier(k, held[k] ?? 0) ? [{ asset: k, tier: petTier(k, held[k]!), amount: String(held[k]), face: face(k), ...patsOf(owner, k) }] : []));
}
/** Today's pats on someone's pet, as api/pets.py: a made-up few from others, plus the visitor's. */
function patsOf(owner: string | null, k: PetKey) {
  if (!owner) return { pats: 0, patted: false };
  const day = dayOf(Date.now());
  const patted = owner !== DEMO_ADDRESS && load().pats?.[`${owner}:${k}`] === day;
  const others = owner === DEMO_ADDRESS ? 0 : strHash(`${owner}:${k}:${day}`) % 4;
  return { pats: others + (patted ? 1 : 0), patted };
}
/** {tx_index: "dog:2"}: residents' pets on their parcels; a made-up quarter of them show one. */
function parcelPetsAt(n: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of parcelIndexes(n)) {
    if (n === OWN_PARCEL.bitmap_number && i === OWN_PARCEL.tx_index) {
      const k = load().parcelPet;
      const tier = k ? petTier(k, holdingsOf(DEMO_ADDRESS, n)[k] ?? 0) : 0;
      if (k && tier) out[i] = `${k}:${tier}`;
    } else if (hash(n * 7 + i) < 0.25) {
      out[i] = `${PET_KEYS[Math.floor(hash(n * 11 + i) * PET_KEYS.length)]}:${1 + Math.floor(hash(n * 13 + i) * 3)}`;
    }
  }
  return out;
}
function parcelShowcaseView(n: number, i: number) {
  const held = holdingsOf(DEMO_ADDRESS, n);
  return { chosen: load().parcelPet ?? null, held: PET_KEYS.map((k) => ({ asset: k, tier: petTier(k, held[k] ?? 0), amount: String(held[k] ?? 0) })), shown: parcelPetsAt(n)[i] ?? null };
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
const ownListing = (n: number) => (load().market ?? []).find((x) => x.n === n && x.status === "active" && x.park == null && x.tx == null);
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
const BADGE_KINDS = ["treasure", "lucky", "lucky_visit", "crown", "tour"];
/** A demo badge's id: there is no table, so its kind and height stand in. */
const badgeId = (b: { kind: string; height: number }) => b.height * 8 + BADGE_KINDS.indexOf(b.kind);
const myBadges = (): Badge[] => (load().badges ?? []).map((b) => ({ ...b, id: badgeId(b), worn: badgeId(b) === load().worn }));
const wornBadge = (a: string) => {
  const b = a === DEMO_ADDRESS ? myBadges().find((x) => x.worn) : undefined;
  return b ? { kind: b.kind, rarity: b.rarity } : null;
};

/** 每日巡城, as api/tour.py: two stops out of the districts posted in this week, then the rest
 * out of all claimed ones, each by SHA-256 of "<day>:tour:<i>". Not stored: the demo's posts
 * only change when the visitor posts, which is rare enough. */
const TOUR_STREAKS: [number, Rarity][] = [[30, "legendary"], [7, "epic"], [3, "rare"], [1, "common"]];
const dayNumber = (day: string) => Math.round(Date.parse(day) / 86_400_000);
function tourStops(day: string): number[] {
  const all = districtPool();
  const week = Date.now() - 7 * DAY * 1000;
  const active = [...new Set(load().posts.filter((p) => p.reply_to == null && !p.removed && Date.parse(p.created_at) > week && ownerOf(p.bitmap_number)).map((p) => p.bitmap_number))].sort((a, b) => a - b);
  const picked: number[] = [];
  let i = 0;
  const take = (pool: number[], want: number) => {
    for (let tries = 0; tries < want * 8 && picked.length < want && pool.some((n) => !picked.includes(n)); tries++) {
      const n = pool[pick(day, `tour:${i++}`, pool.length)!];
      if (!picked.includes(n)) picked.push(n);
    }
  };
  take(active, 2);
  take(all, 3);
  return picked;
}
function tourStreak(day: string): number {
  const done = new Set((load().badges ?? []).filter((b) => b.kind === "tour").map((b) => b.height));
  let d = dayNumber(day);
  if (!done.has(d)) d -= 1;
  let run = 0;
  while (done.has(d - run)) run++;
  return run;
}
function tourView(me: string | null) {
  const day = today(), stops = tourStops(day), s = load();
  const stopsOut = stops.map((n) => ({ bitmap_number: n, visited: !!me && (s.checkins?.[n] ?? []).includes(day) }));
  return {
    day,
    stops: stopsOut,
    rules: { stops: 3, active: 2, active_days: 7, streaks: TOUR_STREAKS },
    ...(me ? { done: stopsOut.every((x) => x.visited), streak: tourStreak(day) } : {}),
  };
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
    last: { number: n - 1, winners }, weights: { posts: 4, replies: 1.5, checkins: 1 },
    pool_sats: 210_000, pool_split: [105_000, 63_000, 42_000],
  };
}

function gameView(me: string | null): Game {
  const tip = demoTip(), lucky = luckyNow();
  return {
    tip,
    round: lucky && { since: lucky.since, until: lucky.since + ROUND - 1, block_hash: lucky.block_hash, candidates: lucky.candidates, index: lucky.index, bitmap_number: lucky.n, owner: ownerOf(lucky.n) },
    draws: Array.from({ length: 20 }, (_, i) => drawAt(tip - i)),
    badges: me ? myBadges() : null,
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
  return { message: r.message, parcels: r.parcels.filter((i) => !taken.has(i)), updated_at: r.updated_at, applications: apps.length, applied: !!me && apps.some((a) => a.address === me),
    for_sale: parcelsListed(n) };
}
/** The district's parcels listed in unimap, cheapest first. */
function parcelsListed(n: number) {
  return (load().market ?? [])
    .filter((x) => x.n === n && x.tx != null && x.status === "active")
    .sort((a, b) => a.price - b.price)
    .map((x) => ({ listing_id: x.id, tx_index: x.tx!, price_sats: x.price, seller: x.seller }));
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
  if (address && load().tenants?.[n]?.some((x) => x.address === address)) return ["tenant", null];
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
const view = (p: Post, me: string | null): Post => ({ ...p, author: { ...p.author, x: xOf(p.author.address)?.username ?? null, tippable: tippable(p.author.address), badge: wornBadge(p.author.address) }, tips_sats: postTips(p.id), liked_by_me: !!me && !!load().likes[p.id], like_count: p.like_count + (me && load().likes[p.id] ? 1 : 0) });
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
    parcel_pets: parcelPetsAt(n),
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
    pets: a === DEMO_ADDRESS ? myPets().map(caredPet).filter((p) => p.public).map(({ asset, tier, amount, name, level, mood, face }) => ({ asset, tier, amount, name, level, mood, face })) : [],
    badges: a === DEMO_ADDRESS ? myBadges() : a === ownerOf(840001) ? [{ kind: "lucky", height: roundOf(DEMO_TIP)[0], bitmap_number: 840001, tx_index: null, rarity: "rare", created_at: iso(0.3) }] : [],
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
const agentGrant = (n: number, key: string, perDay: number, expires: string, mayPublish = false, parcel: number | null = null) =>
  `unimap agent grant\ndistrict: ${n}.bitmap\n${parcel != null ? `parcel: #${parcel}\n` : ""}agent key: ${key}\nmay: draft posts and replies here; ${mayPublish ? "publish them on its own, up to the posts per day below" : "publish the ones I approve"}\nposts per day: ${perDay}\nexpires: ${expires.slice(0, 19)}Z\nissued: ${Math.floor(Date.now() / 1000)}`;
/** The agent's post of draft d, as the demo's agent key would sign it. */
function agentPost(s: State, live: DemoAgent, d: AgentDraft, text: string, owner: string, auto = false): Post {
  const now = new Date().toISOString();
  const signed = `unimap agent post\ngrant: ${live.id}\nagent key: ${live.key}\n\nunimap post\ndistrict: ${live.n}.bitmap\nreply-to: ${d.reply_to ?? "none"}\nas: none\n\n${text}`;
  const parcel = live.parcel ?? null;
  const post: Post = { id: s.nextId++, bitmap_number: live.n, reply_to: d.reply_to, body: text, media: [], author: { address: owner, role: parcel != null ? "resident" : "owner", parcel, as_bitmap: null },
    signed_message: signed, signature: sha256(signed) + sha256(text), created_at: now, removed: false, like_count: 0, reply_count: 0, liked_by_me: false,
    agent: { grant_id: live.id, key: live.key } };
  s.posts.push(post);
  if (d.reply_to != null) {
    const parent = s.posts.find((x) => x.id === d.reply_to);
    if (parent) parent.reply_count++;
  }
  Object.assign(d, { status: "posted", post_id: post.id, body: text, decided_at: now, auto });
  return post;
}
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
    persona: "语气轻松一点，叫居民「邻居」。", tasks: ["welcome", "digest", "answers"], may_publish: false, auto_tasks: [], watch: { radius: 20, max_price_sats: 10_000_000 },
    memory: ["主人喜欢简短的帖子", "#3 号地块的邻居经常换头像"], last_run_at: iso(0.03), last: { at: iso(0.03), drafts: 2, error: null },
    drafts: [
      { id: 1, reply_to: null, body: "欢迎新邻居 bc1q7m…x2k4 搬进地块 #42！有什么想问的，在这里发帖就好。", why: "地块 #42 刚被认领", task: "welcome", status: "pending", post_id: null, created_at: iso(0.03), decided_at: null },
      ...(mondrian ? [{ id: 2, reply_to: mondrian.id, body: "很配！Mondrian 图就是这个区块里每笔交易的大小，#3 号地块正好在左上角那一块。", why: "邻居 #3 在问大家觉得新头像怎么样",
        task: "answers" as const, status: "pending" as const, post_id: null, created_at: iso(0.03), decided_at: null }] : []),
      { id: 3, reply_to: null, body: digest, why: "上周的周报", task: "digest", status: "posted", post_id: s.nextId - 1, created_at: iso(2.1), decided_at: iso(2) },
    ],
  }];
}
/** Who holds what an agent looks after: the district, or one of its parcels. */
const agentHolder = (n: number, parcel: number | null | undefined) => (parcel != null ? parcelOwner(n, parcel) : ownerOf(n));
function parcelBriefing(n: number, parcel: number, s: State): AgentView["briefing"] {
  const soon = (s.polls ?? []).filter((x) => x.n === n && !x.closed_at && Date.parse(x.closes_at) > Date.now() && Date.parse(x.closes_at) < Date.now() + 2 * DAY * 1000 && !(DEMO_ADDRESS in x.votes));
  return [
    ...soon.map((x) => ({ kind: "poll_closing" as const, poll_id: x.id, question: x.question, closes_at: x.closes_at })),
    ...districtGame(n, DEMO_ADDRESS).treasures.filter((x) => x.tx_index === parcel && x.claimable).map((x) => ({ kind: "treasure" as const, height: x.height, rarity: x.rarity, closes_at_height: x.closes_at })),
  ];
}
// 店铺: 840001's owner and a resident sell there; the visitor sells one poster in 840000.
function seedShop(): DemoItem[] {
  const item = (id: number, n: number, tx: number | null, title: string, description: string, price: number, stock: number | null, sold: number, content: string, days: number): DemoItem => ({
    id, bitmap_number: n, tx_index: tx, seller: (tx == null ? ownerOf(n) : parcelOwner(n, tx)) ?? fakeAddress(n), title, description, price_sats: price, stock, active: true,
    created_at: iso(days), content, sold, introduced: true });
  return [
    item(1, 840000, null, "减半区块纪念海报（高清 PNG）", "第四次减半区块 840000 的 Mondrian 图，6000×6000 像素，可以打印成海报。", 5000, null, 2, "https://files.unimap.city/demo/840000-poster.png", 3),
    item(2, 840001, null, "840001 街区壁纸包", "四张手机壁纸，用这条街的交易画的。", 2100, 20, 3, "https://files.unimap.city/demo/840001-wallpapers.zip", 5),
    item(3, 840001, 14, "#14 号地块手绘明信片（电子版）", "我画的这条街，适合发给朋友。", 500, null, 7, "https://files.unimap.city/demo/840001-14-postcard.jpg", 2),
  ];
}
const shopHolder = (i: { bitmap_number: number; tx_index: number | null }) => agentHolder(i.bitmap_number, i.tx_index);
function itemView(i: DemoItem, viewer: string | null, s: State): ShopItem {
  const { content: _c, introduced: _i, ...rest } = i;
  const left = i.stock == null ? null : Math.max(0, i.stock - i.sold);
  const on_sale = i.active && shopHolder(i) === i.seller && left !== 0;
  const bought = viewer ? s.orders!.filter((o) => o.item === i.id && o.buyer === viewer && o.settled).map((o) => ({ order_id: o.id, content: i.content, at: new Date(o.at).toISOString() })) : [];
  return { ...rest, left, on_sale, mine: viewer === i.seller, bought };
}
function agentView(a: DemoAgent, s: State): AgentView {
  const today = s.posts.filter((p) => p.agent?.grant_id === a.id && Date.parse(p.created_at) > Date.now() - DAY * 1000).length;
  const problem = Date.parse(a.expires_at) < Date.now() ? "expired" : a.paid_until && Date.parse(a.paid_until) < Date.now() ? "unpaid" : null;
  const { n: _n, message: _m, revoked: _r, drafts, ...rest } = a;
  const briefing: AgentView["briefing"] = a.parcel != null ? parcelBriefing(a.n, a.parcel, s)
    : (s.applications?.[a.n]?.length ?? 0) > 0 ? [{ kind: "applications", count: s.applications![a.n].length }] : [];
  return { agent: { ...rest, may_publish: rest.may_publish ?? false, auto_tasks: rest.may_publish ? rest.auto_tasks ?? [] : [], posted_today: today, running: false, problem }, drafts: drafts.filter((d) => d.status === "pending"),
    recent: drafts.filter((d) => d.status !== "pending").sort((x, y) => y.id - x.id), briefing };
}

// ---- 时间胶囊 and 私信 --------------------------------------------------------------
// The demo's blocks come every DEMO_BLOCK_MS from when it began, so a capsule may open a couple of
// minutes on and the whole seal and open can be tried. Other people's public lines are made up
// per block; the visitor's own capsules are kept in localStorage, key and all.
const CAPSULE_LEAD = 120; // seconds
const CAPSULE_SATS = 5000; // 封存, as deploy/unimap.env.example suggests
const demoBlockTime = (h: number) => (load().boot ?? Date.now()) + (h - DEMO_TIP) * DEMO_BLOCK_MS;
const PEER_LINES: [string, CapsulePeer["tag"]][] = [
  ["儿子，凌晨四点。和你家孩子是同一块，以后他们算同块的兄妹了。", "birth"],
  ["外婆走了。想把这一刻也留下来。", "farewell"],
  ["今天离职，开始做自己的事。", "start"],
  ["领证了。十年后的今天一起拆开。", "wedding"],
  ["女儿出生，六斤二两。", "birth"],
  ["给 30 岁的自己：别忘了今天的决定。", "other"],
  ["搬到新城市的第一天。", "start"],
  ["送别老狗豆豆，它陪了我们十四年。", "farewell"],
  ["和她求婚成功，信封给二十年后的我们。", "wedding"],
  ["第一次买比特币，就在这一块。", "start"],
  ["双胞胎，一前一后，差了一个块。", "birth"],
  ["毕业了，给五年后的自己。", "other"],
];
function fakePeersAt(h: number): CapsulePeer[] {
  if (h < 0 || h > demoTip()) return [];
  const n = h >= DEMO_TIP - 6 ? 2 + Math.floor(hash(h * 13 + 5) * 3) : Math.floor(hash(h * 13 + 5) * 2.4);
  return Array.from({ length: n }, (_, i) => {
    const [line, tag] = PEER_LINES[Math.floor(hash(h * 31 + i) * PEER_LINES.length)];
    return { ref: `f${h}-${i}`, address: fakeAddress(h * 7 + i), line, tag, sealed_at: new Date(demoBlockTime(h) + (i + 1) * 23_000).toISOString(), sealed_height: h, mine: false };
  });
}
function capsuleView(c: DemoCapsule, me: string | null, full = true): Capsule {
  const tip = demoTip(), now = Date.now(), openMs = Date.parse(c.open_at);
  if (!c.pending && c.open_height == null && now >= openMs) {
    const first = Math.max(c.sealed_height + 1, DEMO_TIP + Math.ceil((openMs - (load().boot ?? now)) / DEMO_BLOCK_MS));
    if (first <= tip) {
      c.open_height = first;
      save();
    }
  }
  const open = c.open_height != null;
  // 「信打开了」 for 封存 (and capsules sealed with billing off), as api/capsule.py tell() does.
  if (open && c.tier !== "free" && !c.told && c.author === DEMO_ADDRESS) {
    const s = load();
    c.told = true;
    s.notifications = [{ id: Math.max(0, ...(s.notifications ?? []).map((x) => x.id)) + 1, kind: "capsule_open", actor: "", bitmap_number: 0, post_id: null,
      created_at: new Date().toISOString(), read: false, snippet: null, capsule_id: c.id, recipient: c.recipient, block_height: c.open_height! }, ...(s.notifications ?? [])];
    save();
  }
  const { escrow, ref: _ref, ciphertext, photo, signed_message, signature, pending, told: _told, ...rest } = c;
  return {
    ...rest,
    ...(full ? { ciphertext, photo: photo ?? null, signed_message, signature } : {}),
    has_photo: !!photo,
    status: pending ? "pending" : open ? "open" : "sealed",
    tip,
    blocks_left: open ? null : Math.max(1, Math.ceil((openMs - now) / DEMO_BLOCK_MS)),
    key: open ? escrow : null,
    mine: me === c.author,
  };
}
function capsulePeers(h: number, scope: CapsuleScope, me: string | null) {
  const tip = demoTip();
  if (!Number.isInteger(h) || h < 0 || h > tip) fail(404, "no such block yet");
  const day = new Date(demoBlockTime(h)).toISOString().slice(0, 10);
  const dayStart = Date.parse(`${day}T00:00:00Z`), boot = load().boot ?? Date.now();
  const ranges: Record<CapsuleScope, [number, number]> = {
    block: [h, h],
    hour: [h - 6, h + 6],
    day: [DEMO_TIP + Math.ceil((dayStart - boot) / DEMO_BLOCK_MS), DEMO_TIP + Math.floor((dayStart + DAY * 1000 - 1 - boot) / DEMO_BLOCK_MS)],
  };
  const mine = (load().capsules ?? []).filter((c) => c.line && !c.pending);
  const inRange = ([a, b]: [number, number]) => {
    const lo = Math.max(0, a), hi = Math.min(tip, b);
    const own: CapsulePeer[] = mine
      .filter((c) => c.sealed_height >= lo && c.sealed_height <= hi)
      .map((c) => ({ ref: c.ref, address: c.author, line: c.line!, tag: c.tag, sealed_at: c.sealed_at, sealed_height: c.sealed_height, mine: c.author === me, capsule_id: c.id }));
    let fakes: CapsulePeer[] = [];
    for (let x = lo; x <= hi; x++) fakes = fakes.concat(fakePeersAt(x));
    return [...own, ...fakes];
  };
  const counts = { block: inRange(ranges.block).length, hour: inRange(ranges.hour).length, day: inRange(ranges.day).length };
  const here = inRange(ranges.block);
  return {
    height: h, tip, day, scope, counts,
    sealed_here: here.length + Math.floor(hash(h * 3 + 1) * 6) + (load().capsules ?? []).filter((c) => !c.line && !c.pending && c.sealed_height === h).length,
    births_here: here.filter((p) => p.tag === "birth").length,
    peers: inRange(ranges[scope]).slice(0, 100),
  };
}
function demoDms(s: State): DemoDm[] {
  // One hello already waiting, from someone who sealed on the visitor's first block.
  s.dms ??= [{ id: 1, from: fakeAddress(DEMO_TIP * 7), to: DEMO_ADDRESS, body: "你好！我们的信封在同一块上，明年这一天来报个到？", at: Date.now() - 3_600_000 }];
  return s.dms.filter((m) => m.at <= Date.now());
}
const dmView = (m: DemoDm, me: string): DmMessage => ({ id: m.id, from_me: m.from === me, body: m.removed ? null : m.body, removed: !!m.removed, created_at: new Date(m.at).toISOString(), read: !!m.read });

function capsuleRoute(p: string, q: URLSearchParams, method: string, body: Record<string, unknown>, me: string | null, s: State): { hit: true; value: unknown } | null {
  const needMe = () => me ?? fail(401, "请先连接钱包");
  const ok = (value: unknown) => ({ hit: true as const, value });
  let m: RegExpMatchArray | null;
  // 封存 sells in the demo, so the whole paid flow can be tried; payment is simulated.
  const freeUsed = (a: string | null) => !!a && (s.capsules ?? []).some((c) => c.author === a && c.tier === "free");
  const invoice = (ref: string) => {
    const pay = { id: Math.max(0, ...(s.capsulePays ?? []).map((x) => x.id)) + 1, ref, at: Date.now(), settled: false };
    (s.capsulePays ??= []).push(pay);
    return { id: pay.id, product: "capsule", ref, amount_sats: CAPSULE_SATS, status: "pending" as const, verifiable: true, invoice: `lnbc${CAPSULE_SATS * 10}n1pdemocapsule0unimap0city${pay.id}` };
  };
  if (p === "/v1/billing/products") return ok({ products: [{ product: "capsule", amount_sats: CAPSULE_SATS }], cosmetics: false });
  if (p === "/v1/capsules/rules")
    return ok({ min_lead_seconds: CAPSULE_LEAD, block_seconds: DEMO_BLOCK_MS / 1000, tags: ["birth", "wedding", "farewell", "start", "other"], tip: demoTip(),
      billing: true, free_left: me ? !freeUsed(me) : null, free_days: 366, max_years: 100, styles: ["classic", "midnight", "celadon", "dusk"], max_photo_chars: 420_000, inscribe_sats: 20_000 });
  if (p === "/v1/capsules" && method === "POST") {
    const a = needMe(), openAt = Number(body.open_at), line = String(body.line ?? "").trim() || null;
    const tier = (body.tier as "free" | "paid" | undefined) ?? "free", style = (body.style as Capsule["style"]) ?? "classic", photo = (body.photo as string | null) ?? null;
    if (!(openAt >= Date.now() / 1000 + CAPSULE_LEAD)) fail(400, `open_at must be at least ${CAPSULE_LEAD} seconds from now`);
    if (tier === "free" && (photo || style !== "classic")) fail(403, "a photo and the envelope styles come with 封存, the paid tier");
    if (tier === "free" && openAt > Date.now() / 1000 + 366 * 86400) fail(400, "a free capsule opens within a year; 封存 (paid) can wait up to 100 years");
    if (tier === "free" && freeUsed(a)) fail(409, "this wallet has used its free capsule; 封存 is the paid tier");
    const ciphertext = String(body.ciphertext);
    const c: DemoCapsule = {
      id: Math.random().toString(36).slice(2, 13), ref: `v${Date.now()}`, author: a, recipient: String(body.recipient).trim(), ciphertext,
      fingerprint: String(body.fingerprint ?? ""), escrow: String(body.key), open_at: new Date(openAt * 1000).toISOString(),
      sealed_height: demoTip(), sealed_at: new Date().toISOString(), line, tag: line ? ((body.tag as Capsule["tag"]) ?? null) : null,
      signed_message: "", signature: String(body.signature), open_height: null, tier, style, photo, pending: tier === "paid",
    };
    (s.capsules ??= []).unshift(c);
    const payment = tier === "paid" ? invoice(c.id) : undefined;
    save();
    return ok({ ...capsuleView(c, a), ...(payment ? { payment } : {}) });
  }
  if (p === "/v1/billing/pay" && method === "POST") {
    const a = needMe();
    const c = (s.capsules ?? []).find((x) => x.id === body.ref && x.author === a) ?? fail(404, "no such capsule of yours");
    if (!c.pending) fail(409, "this capsule is sealed already");
    const pay = invoice(c.id);
    save();
    return ok(pay);
  }
  if ((m = p.match(/^\/v1\/billing\/payments\/(\d+)(\/demo-settle)?$/))) {
    needMe();
    const pay = (s.capsulePays ?? []).find((x) => x.id === +m![1]) ?? fail(404, "no such payment");
    if (m[2] && !pay.settled) {
      // 演示：模拟付款 — billing's on_settled: sealed on the block of this moment.
      pay.settled = true;
      const c = (s.capsules ?? []).find((x) => x.id === pay.ref);
      if (c) Object.assign(c, { pending: false, sealed_height: demoTip(), sealed_at: new Date().toISOString() });
      save();
    }
    return ok({ id: pay.id, product: "capsule", ref: pay.ref, amount_sats: CAPSULE_SATS, status: pay.settled ? "settled" : "pending", verifiable: true });
  }
  if (p === "/v1/capsules/mine") {
    const a = needMe();
    return ok({ capsules: (s.capsules ?? []).filter((c) => c.author === a && !c.pending).map((c) => capsuleView(c, a, false)) });
  }
  if ((m = p.match(/^\/v1\/capsules\/peers\/(\d+)$/))) return ok(capsulePeers(+m[1], (q.get("scope") as CapsuleScope) || "block", me));
  if ((m = p.match(/^\/v1\/capsules\/lines\/([^/]+)\/report$/))) return (needMe(), ok({ ok: true }));
  if ((m = p.match(/^\/v1\/capsules\/([^/]+)\/line$/)) && method === "DELETE") {
    const c = (s.capsules ?? []).find((x) => x.id === m![1] && x.author === needMe()) ?? fail(404, "no such capsule of yours");
    c.line = null;
    c.tag = null;
    save();
    return ok({ ok: true });
  }
  if ((m = p.match(/^\/v1\/capsules\/([^/]+)$/))) {
    const c = (s.capsules ?? []).find((x) => x.id === m![1] && (!x.pending || x.author === me)) ?? fail(404, "no such capsule");
    return ok(capsuleView(c, me));
  }
  if (p === "/v1/admin/item-reports") return ok({ reports: [] });
  if (p === "/v1/me/dm-settings") {
    needMe();
    if (method === "PUT") {
      s.dmStrangers = !!body.strangers;
      save();
    }
    return ok({ strangers: s.dmStrangers ?? true });
  }
  if ((m = p.match(/^\/v1\/me\/mutes\/(.+)$/))) {
    needMe();
    s.blocked = (s.blocked ?? []).filter((x) => x !== m![1]);
    if (method === "PUT") s.blocked.push(m[1]);
    save();
    return ok({ ok: true });
  }
  if (p === "/v1/me/mutes") return ok({ mutes: s.blocked ?? [] });
  if (p === "/v1/dms" || p === "/v1/dms/unread") {
    const a = needMe(), list = demoDms(s);
    const unread = list.filter((x) => x.to === a && !x.read && !x.removed).length;
    if (p === "/v1/dms/unread") return ok({ unread });
    const peers = new Map<string, Conversation>();
    for (const x of [...list].sort((u, v) => v.id - u.id)) {
      const peer = x.from === a ? x.to : x.from;
      const c = peers.get(peer) ?? { peer, last: dmView(x, a), unread: 0 };
      if (x.to === a && !x.read && !x.removed) c.unread++;
      peers.set(peer, c);
    }
    return ok({ conversations: [...peers.values()], unread });
  }
  if ((m = p.match(/^\/v1\/dms\/messages\/(\d+)\/report$/))) return (needMe(), ok({ ok: true }));
  if ((m = p.match(/^\/v1\/dms\/([^/]+)$/))) {
    const a = needMe(), peer = decodeURIComponent(m[1]);
    if (peer === a) fail(400, "that's you");
    const list = demoDms(s);
    if (method === "POST") {
      const text = String(body.body ?? "").trim() || fail(400, "say something");
      const all = (s.dms ??= []);
      const sent: DemoDm = { id: Math.max(0, ...all.map((x) => x.id)) + 1, from: a, to: peer, body: text, at: Date.now(), read: false };
      all.push(sent);
      // Someone answers the first message, a few seconds later.
      if (!all.some((x) => x.from === peer && x.to === a)) all.push({ id: sent.id + 1, from: peer, to: a, body: "收到！同一块的缘分。到开信那天我们再聊。", at: Date.now() + 6000 });
      save();
      return ok(dmView(sent, a));
    }
    const thread = list.filter((x) => (x.from === a && x.to === peer) || (x.from === peer && x.to === a));
    for (const x of thread) if (x.to === a) x.read = true;
    save();
    const blocked = (s.blocked ?? []).includes(peer);
    return ok({ peer, messages: thread.map((x) => dmView(x, a)), more: false, can_send: true, why_not: null, blocked_by_me: blocked });
  }
  return null;
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
  const capsuleHit = p.startsWith("/v1/capsules") || p.startsWith("/v1/billing") || p.startsWith("/v1/dms") || p.startsWith("/v1/me/mutes") || p === "/v1/me/dm-settings" || p === "/v1/admin/item-reports" ? capsuleRoute(p, url.searchParams, method, body, me, s) : null;
  if (capsuleHit) return capsuleHit.value;
  if (p === "/v1/game") return gameView(me);
  if (p === "/v1/tour") return tourView(me);
  if (p === "/v1/me/badge" && method === "PUT") {
    needMe();
    const id = (body.id as number | null) ?? null;
    const b = myBadges().find((x) => x.id === id);
    if (id != null && !b) fail(404, "that isn't one of your badges");
    load().worn = id;
    save();
    return { worn: b ? { id, kind: b.kind, rarity: b.rarity } : null };
  }
  if (p === "/v1/season") return seasonView();
  if (p === "/v1/promotions") return { promotions: [] }; // nothing is promoted in the demo, as on a new server
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
    return { address: a, districts: OWNED, parcels: [OWN_PARCEL], follows: [...s.follows].sort((x, y) => x - y), x: s.x ?? null, wallets: walletsView(), admin: true, banned: isBanned(a), nostr: s.nostr ?? null } satisfies Me;
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
    return { nonce: "demo", message: `${location.host} wants you to link this wallet on unimap\naddress: ${body.address}\nto: ${DEMO_ADDRESS}\nURI: ${location.origin}\nNetwork: demo` };
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
        return r && o ? [{ bitmap_number: n, name: `${n}.bitmap`, zone: zoneOf(n), owner: o, level: levelAt(n), message: r.message, parcels: r.parcels, updated_at: r.updated_at, for_sale: r.for_sale }] : [];
      })
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return { districts: out };
  }
  // 开张 (api/opening.py)
  if ((m = p.match(/^\/v1\/districts\/(\d+)\/opening$/))) {
    const n = +m[1], a = owns(n);
    const steps = {
      bio: !!profile(n).bio,
      post: s.posts.some((x) => x.bitmap_number === n && x.author.address === a && x.reply_to == null && !x.removed),
      recruit: s.recruits?.[n]?.by === a,
    };
    let badge = (s.badges ?? []).find((x) => x.kind === "opening" && x.height === n) ?? null;
    let fresh = false;
    if (!badge && steps.bio && steps.post && steps.recruit) {
      badge = { kind: "opening", height: n, bitmap_number: n, tx_index: null, rarity: "rare", created_at: new Date().toISOString() };
      (s.badges ??= []).unshift(badge);
      fresh = true;
      save();
    }
    return { steps, opened: !!badge, badge, new: fresh };
  }
  if (p === "/v1/opened") {
    // The visitor's own, and two the made-up owners opened lately.
    const mine = (s.badges ?? []).filter((x) => x.kind === "opening" && Date.now() - Date.parse(x.created_at) < 7 * DAY * 1000).map((x) => ({ n: x.bitmap_number, at: x.created_at }));
    const seeded = [
      { n: 840001, at: iso(1.5), bio: "减半之后挖出的第一个街区，每周六晚上在这里聊天。" },
      { n: 839998, at: iso(4), bio: "CBD 的老街区，手续费最高那几天的见证。" },
    ];
    return {
      districts: [...mine, ...seeded].map(({ n, at, bio }: { n: number; at: string; bio?: string }) => ({
        bitmap_number: n,
        opened_at: at,
        bio: (profile(n).bio || bio || "").slice(0, 80),
        posts: s.posts.filter((x) => x.bitmap_number === n && x.reply_to == null && !x.removed).length,
      })),
    };
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
      // The demo's made-up owners say yes at once, so the visitor sees what being a tenant is like.
      const o = ownerOf(n);
      if (o && o !== a) {
        s.applications![n] = s.applications![n].filter((x) => x.address !== a);
        s.tenants = { ...s.tenants, [n]: [{ address: a, since: new Date().toISOString() }, ...(s.tenants?.[n] ?? [])] };
        const ids = (s.notifications ?? []).map((x) => x.id);
        s.notifications = [{ id: Math.max(0, ...ids) + 1, kind: "tenant", actor: o, bitmap_number: n, post_id: null, created_at: new Date().toISOString(), read: false, snippet: null }, ...(s.notifications ?? [])];
      }
    }
    save();
    return { ok: true };
  }
  if ((m = p.match(/^\/v1\/districts\/(\d+)\/tenants(?:\/([^/]+))?$/))) {
    const n = +m[1], max = 20;
    const list = () => ({ tenants: s.tenants?.[n] ?? [], max });
    if (method === "GET") return list();
    const a = needMe();
    if (method === "DELETE") {
      const who = decodeURIComponent(m[2] ?? "");
      if (who !== a) owns(n);
      s.tenants = { ...s.tenants, [n]: (s.tenants?.[n] ?? []).filter((x) => x.address !== who) };
    } else {
      owns(n);
      const who = String(body.address ?? "");
      if (!(s.applications![n] ?? []).some((x) => x.address === who)) fail(404, "they haven't applied here");
      if ((s.tenants?.[n] ?? []).length >= max) fail(409, `at most ${max} tenants a district`);
      s.applications![n] = s.applications![n].filter((x) => x.address !== who);
      s.tenants = { ...s.tenants, [n]: [{ address: who, since: new Date().toISOString() }, ...(s.tenants?.[n] ?? [])] };
    }
    save();
    return list();
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
  if ((m = p.match(/^\/v1\/districts\/(\d+)\/parcels\/(\d+)\/showcase$/))) {
    needMe();
    const [n, i] = [+m[1], +m[2]];
    if (n !== OWN_PARCEL.bitmap_number || i !== OWN_PARCEL.tx_index) fail(403, `only the holder of parcel #${i} can do this`);
    if (method === "PUT") {
      const k = (body.asset ?? null) as PetKey | null;
      if (k !== null && !(k in PETS)) fail(400, "没有这种藏品");
      s.parcelPet = k;
      save();
    }
    return parcelShowcaseView(n, i);
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
    const day = today(), stops = tourStops(day);
    if (stops.includes(+m[1]) && stops.every((n) => (s.checkins?.[n] ?? []).includes(day))) {
      const run = tourStreak(day) + 1;
      const won = { kind: "tour" as const, height: dayNumber(day), bitmap_number: +m[1], rarity: TOUR_STREAKS.find(([d]) => run >= d)![1] };
      badges.push({ ...won, streak: run } as (typeof badges)[number]);
      (s.badges ??= []).unshift({ ...won, tx_index: null, created_at: new Date().toISOString() });
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
  if (p === "/v1/me/nostr") {
    const a = needMe();
    if (method === "PUT") {
      const ev = body.event as { pubkey?: string; kind?: number; content?: string } | undefined;
      if (!ev || ev.kind !== 22242 || !/^[0-9a-f]{64}$/.test(ev.pubkey ?? "")) fail(400, "this Nostr event isn't signed correctly");
      if (ev!.content !== `unimap: link this Nostr key to ${a}`) fail(400, "the signed text doesn't name this address");
      s.nostr = ev!.pubkey!;
      save();
    } else if (method === "DELETE") {
      s.nostr = null;
      save();
    }
    return { pubkey: s.nostr ?? null };
  }
  if ((m = p.match(/^\/v1\/posts\/(\d+)\/nostr$/)) && method === "POST") {
    const a = needMe();
    const post = s.posts.find((x) => x.id === +m![1] && !x.removed) ?? fail(404, "no such post");
    if (post.author.address !== a) fail(403, "only the author can post this to Nostr");
    const ev = body.event as { id?: string; pubkey?: string } | undefined;
    if (!ev?.id || ev.pubkey !== s.nostr) fail(400, "sign with the Nostr key linked to this address");
    post.nostr_event_id = ev!.id!;
    save();
    return { nostr_event_id: post.nostr_event_id };
  }
  if (p === "/v1/tips/zap") {
    needMe();
    // A few of the made-up people linked Nostr keys and use wallets that take zaps.
    const id = Number(url.searchParams.get("post_id") ?? NaN);
    const post = s.posts.find((x) => x.id === id);
    const who = post ? post.author.address : ownerOf(Number(url.searchParams.get("bitmap_number")));
    if (!who || strHash(who) % 3 !== 0 || !tippable(who)) return { zap: null };
    return { zap: { pubkey: (strHash(who).toString(16).padStart(8, "0")).repeat(8), event_id: post?.nostr_event_id ?? null } };
  }
  if (p === "/v1/me/pets") return needMe() && { pets: myPets().map(caredPet), feed_hours: FEED_HOURS };
  if ((m = p.match(/^\/v1\/me\/pets\/(\w+)(\/feed)?$/))) {
    needMe();
    const k = m[1] as PetKey;
    if (!myPets().includes(k)) fail(404, "your wallets don't hold this pet");
    const c = { ...careOf(k) }, now = Date.now();
    if (m[2]) {
      if (c.fed_at != null && now < c.fed_at + FEED_HOURS * HOUR) fail(409, "it's still full; feed it again later");
      const today = dayOf(now);
      c.streak = c.last_day === today ? c.streak : c.last_day === dayOf(now - DAY * 1000) ? c.streak + 1 : 1;
      c.affection += 10 + Math.min(c.streak - 1, 7);
      c.fed_at = now;
      c.last_day = today;
    } else {
      if ("name" in body) {
        const name = String(body.name ?? "").trim();
        if (name.length > 20) fail(422, "a name is at most 20 characters");
        c.name = name || null;
      }
      if ("public" in body) c.public = !!body.public;
      if ("face" in body) {
        if (body.face != null && !DEMO_ITEMS[k]?.includes(String(body.face))) fail(400, "pick one of the inscriptions this pet has");
        c.face = body.face == null ? null : String(body.face);
      }
    }
    s.petCare = { ...s.petCare, [k]: c };
    save();
    return caredPet(k);
  }
  if ((m = p.match(/^\/v1\/people\/([^/]+)\/pets\/(\w+)\/pat$/))) {
    const me = needMe();
    const owner = decodeURIComponent(m[1]), k = m[2] as PetKey;
    if (owner === me) fail(400, "that's your own pet");
    // The demo's owners hold pets district by district, so any known pet is taken as shown.
    if (!PET_KEYS.includes(k)) fail(404, "this pet isn't shown anywhere");
    const day = dayOf(Date.now());
    if (s.pats?.[`${owner}:${k}`] === day) fail(409, "you already patted it today");
    s.pats = { ...s.pats, [`${owner}:${k}`]: day };
    save();
    return { asset: k, ...patsOf(owner, k) };
  }
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
  if (p === "/v1/agent") return { open: true, price_sats: 2100, days: 30, max_days: 90, max_per_day: 10, tasks: ["welcome", "digest", "answers"], parcel_tasks: ["answers"] } satisfies AgentInfo;
  if ((m = p.match(/^\/v1\/districts\/(\d+)\/agent(\/[a-z]+)?$/))) {
    const n = +m[1], q = url.searchParams.get("parcel"), parcel = q != null ? +q : null;
    const a = parcel == null ? owns(n) : agentHolder(n, parcel) === needMe() ? needMe() : fail(403, `only the holder of parcel #${parcel} can do this`);
    const scope = (x: DemoAgent) => x.n === n && (x.parcel ?? null) === parcel;
    const live = s.agents!.find((x) => scope(x) && !x.revoked);
    const sub = m[2] ?? "";
    if (sub === "/prepare") {
      const key = sha256(`agent:${n}:${Date.now()}`);
      const days = Number(body.days ?? 30), perDay = Number(body.posts_per_day ?? 3);
      const id = Math.max(0, ...s.agents!.map((x) => x.id)) + 1;
      const expires = new Date(Date.now() + days * DAY * 1000).toISOString();
      const mayPublish = !!body.may_publish;
      s.agents!.push({ id, n, parcel, key, message: agentGrant(n, key, perDay, expires, mayPublish, parcel), posts_per_day: perDay, expires_at: expires, granted_at: "", paid_until: null, persona: "",
        tasks: parcel != null ? ["answers"] : ["welcome", "digest", "answers"], may_publish: mayPublish, auto_tasks: parcel != null ? ["shop"] : ["welcome", "digest"],
        watch: {}, memory: [], last_run_at: null, last: null, drafts: [], revoked: true });
      save();
      return { id, message: s.agents!.find((x) => x.id === id)!.message };
    }
    if (sub === "" && method === "POST") {
      const g = s.agents!.find((x) => x.id === Number(body.id) && scope(x) && !x.granted_at) ?? fail(404, "no such grant waiting to be signed; start again");
      const last = live ?? s.agents!.filter((x) => scope(x) && x.granted_at && x.id !== g.id).sort((x, y) => y.id - x.id)[0];
      if (last) Object.assign(g, { persona: last.persona, tasks: last.tasks, watch: last.watch, memory: last.memory, paid_until: last.paid_until, auto_tasks: last.auto_tasks?.length ? last.auto_tasks : g.auto_tasks });
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
      const gone = live ?? fail(404, parcel != null ? "this parcel has no agent" : "this district has no agent");
      gone.revoked = true;
      gone.drafts.forEach((d) => d.status === "pending" && (d.status = "expired"));
      save();
      return { ok: true };
    }
    if (sub === "" && method === "GET") {
      if (!live) return { agent: null, drafts: [], recent: [], briefing: parcel != null ? parcelBriefing(n, parcel, s) : [] } satisfies AgentView;
      return agentView(live, s);
    }
    const ag = live ?? fail(404, parcel != null ? "this parcel has no agent" : "this district has no agent");
    if (sub === "/settings") {
      Object.assign(ag, { persona: String(body.persona ?? "").trim(), tasks: body.tasks as AgentTask[], watch: body.watch as Agent["watch"],
        memory: body.memory ? ag.memory.filter((x) => (body.memory as string[]).includes(x)) : ag.memory,
        auto_tasks: body.auto_tasks ? (["welcome", "digest", "shop"] as AgentTask[]).filter((k) => (body.auto_tasks as string[]).includes(k)) : ag.auto_tasks });
      save();
      return agentView(ag, s);
    }
    if (sub === "/run") {
      if (ag.last_run_at && Date.now() - Date.parse(ag.last_run_at) < 10 * 60_000) fail(429, "it looked a few minutes ago; try again later");
      const id = Math.max(0, ...s.agents!.flatMap((x) => x.drafts.map((d) => d.id))) + 1, now = new Date().toISOString();
      // A new item in the holder's shop comes first; otherwise a parcel's agent answers the newest question under its
      // holder's posts and the district's writes the digest.
      const fresh = ag.tasks.includes("shop") ? s.shop!.find((i) => i.bitmap_number === n && i.tx_index === parcel && i.seller === a && i.active && !i.introduced) : undefined;
      if (fresh) {
        fresh.introduced = true;
        ag.drafts.push({ id, reply_to: null, body: `新上架：${fresh.title}，${fresh.price_sats.toLocaleString("en-US")} 聪。${fresh.description} 在店铺里就能买，付款直接走闪电。`,
          why: "店里上了新商品", task: "shop", status: "pending", post_id: null, created_at: now, decided_at: null });
        Object.assign(ag, { last_run_at: now, last: { at: now, drafts: 1, posted: 0, error: null } });
        save();
        return { running: true };
      }
      const asked = parcel != null
        ? s.posts.filter((x) => x.bitmap_number === n && x.reply_to == null && !x.removed && x.author.address === a
            && s.posts.some((r) => r.reply_to === x.id && r.author.address !== a) && !ag.drafts.some((d) => d.reply_to === x.id)).sort((x, y) => y.id - x.id)[0]
        : undefined;
      const d: AgentDraft | null = parcel == null
        ? { id, reply_to: null, body: `这周 ${n} 街区很热闹：有新邻居搬进来，邻居们换了头像，也在聊区块里最大的那笔交易。欢迎大家周末来签到。`, why: "该写本周周报了",
          task: "digest", status: "pending", post_id: null, created_at: now, decided_at: null }
        : asked ? { id, reply_to: asked.id, body: asked.body?.includes("书店") ? "卖旧书，也可以拿书来换。周六周日下午两点开门，欢迎来坐坐。" : "谢谢留言，我看到了，晚点详细回你。",
          why: "有邻居在你的帖子下面提问", task: "answers", status: "pending", post_id: null, created_at: now, decided_at: null } : null;
      const auto = !!d && ag.may_publish && !!ag.auto_tasks?.includes(d.task) && agentView(ag, s).agent!.posted_today < ag.posts_per_day;
      if (d) ag.drafts.push(d);
      if (d && auto) {
        const post = agentPost(s, ag, d, d.body, a, true);
        if (a === DEMO_ADDRESS) s.notifications = [{ id: Math.max(0, ...(s.notifications ?? []).map((x) => x.id)) + 1, kind: "agent_posted", actor: a, bitmap_number: n,
          post_id: post.id, created_at: now, read: false, snippet: (post.body ?? "").slice(0, 80), agent_parcel: parcel }, ...(s.notifications ?? [])];
      }
      Object.assign(ag, { last_run_at: now, last: { at: now, drafts: d && !auto ? 1 : 0, posted: auto ? 1 : 0, error: null } });
      save();
      return { running: true };
    }
    if (sub === "/pay") {
      s.agentPay = { id: Date.now() % 100000, at: Date.now(), settled: false, agent: ag.id };
      save();
      return { id: s.agentPay.id, invoice: "lnbc21000n1pdemoagent0unimap0city", amount_sats: 2100, verifiable: true, status: "pending" } satisfies Tip;
    }
    void a;
  }
  if ((m = p.match(/^\/v1\/districts\/(\d+)\/shop$/))) {
    const n = +m[1];
    if (method === "POST") {
      const a = needMe(), parcel = body.parcel != null ? Number(body.parcel) : null;
      if (agentHolder(n, parcel) !== a) fail(403, parcel == null ? "only the district owner can sell here" : `only the holder of parcel #${parcel} can sell here`);
      if (!s.lightning) fail(409, "set a Lightning address first, so buyers can pay you");
      const id = Math.max(0, ...s.shop!.map((x) => x.id)) + 1;
      const it: DemoItem = { id, bitmap_number: n, tx_index: parcel, seller: a, title: String(body.title).trim(), description: String(body.description ?? "").trim(), price_sats: Number(body.price_sats),
        stock: body.stock != null ? Number(body.stock) : null, active: true, created_at: new Date().toISOString(), content: String(body.content).trim(), sold: 0 };
      s.shop!.push(it);
      save();
      return { ...itemView(it, a, s), content: it.content };
    }
    return { items: s.shop!.filter((i) => i.bitmap_number === n).map((i) => itemView(i, me, s)).filter((i) => i.on_sale || i.mine) };
  }
  if ((m = p.match(/^\/v1\/shop\/items\/(\d+)(\/buy)?$/))) {
    const a = needMe(), it = s.shop!.find((x) => x.id === +m![1]) ?? fail(404, "no such item");
    if (m[2]) {
      const v = itemView(it, a, s);
      if (!v.on_sale) fail(409, v.left === 0 ? "sold out" : "this item isn't on sale any more");
      if (it.seller === a) fail(400, "you can't buy your own item");
      const order: DemoOrder = { id: Math.max(0, ...s.orders!.map((o) => o.id)) + 1, item: it.id, buyer: a, at: Date.now(), settled: false };
      s.orders!.push(order);
      save();
      return { id: order.id, invoice: `lnbc${it.price_sats * 10}n1pdemoshop0unimap0city${order.id}`, amount_sats: it.price_sats, verifiable: true, status: "pending" } satisfies Tip;
    }
    if (it.seller !== a) fail(404, "no such item");
    if (method === "PUT") {
      for (const k of ["title", "description", "content"] as const) if (body[k] != null) it[k] = String(body[k]).trim();
      if (body.price_sats != null) it.price_sats = Number(body.price_sats);
      if (body.unlimited) it.stock = null;
      else if (body.stock != null) it.stock = Number(body.stock);
      if (body.active != null) it.active = !!body.active;
      save();
    }
    if (method === "DELETE") {
      it.active = false;
      save();
      return { ok: true };
    }
    return { ...itemView(it, a, s), content: it.content };
  }
  if ((m = p.match(/^\/v1\/shop\/orders\/(\d+)$/))) {
    const a = needMe(), o = s.orders!.find((x) => x.id === +m![1] && x.buyer === a) ?? fail(404, "no such order");
    const it = s.shop!.find((x) => x.id === o.item)!;
    if (!o.settled && Date.now() - o.at > 4000) {
      o.settled = true;
      it.sold++;
      save();
    }
    return { id: o.id, item_id: it.id, status: o.settled ? "settled" : "pending", verifiable: true, ...(o.settled ? { content: it.content } : {}) };
  }
  if (p === "/v1/me/shop") {
    const a = needMe();
    const bought = s.orders!.filter((o) => o.buyer === a && o.settled).sort((x, y) => y.id - x.id).map((o) => {
      const it = s.shop!.find((x) => x.id === o.item)!;
      return { order_id: o.id, item_id: it.id, bitmap_number: it.bitmap_number, title: it.title, amount_sats: it.price_sats, content: it.content, at: new Date(o.at).toISOString() } satisfies ShopBought;
    });
    return { bought, sold: [] };
  }
  if ((m = p.match(/^\/v1\/agent\/payments\/(\d+)$/))) {
    needMe();
    const pay = s.agentPay?.id === +m[1] ? s.agentPay : fail(404, "no such payment");
    if (!pay.settled && Date.now() - pay.at > 4000) {
      pay.settled = true;
      const live = s.agents!.find((x) => !x.revoked && (pay.agent == null || x.id === pay.agent));
      if (live) live.paid_until = new Date(Math.max(Date.now(), Date.parse(live.paid_until ?? "0")) + 30 * DAY * 1000).toISOString();
      save();
    }
    return { id: pay.id, status: pay.settled ? "settled" : "pending", verifiable: true } satisfies Tip;
  }
  if ((m = p.match(/^\/v1\/agent\/drafts\/(\d+)(\/publish)?$/))) {
    const a = needMe(), id = +m[1];
    const live = s.agents!.find((x) => !x.revoked && agentHolder(x.n, x.parcel) === a && x.drafts.some((d) => d.id === id && d.status === "pending")) ?? fail(409, "this draft isn't waiting any more");
    const d = live.drafts.find((x) => x.id === id)!, now = new Date().toISOString();
    if (!m[2]) {
      Object.assign(d, { status: "discarded", decided_at: now });
      save();
      return { ok: true };
    }
    const view0 = agentView(live, s);
    if (view0.agent!.posted_today >= live.posts_per_day) fail(429, `the grant allows ${live.posts_per_day} agent posts a day`);
    const post = agentPost(s, live, d, String(body.body ?? d.body).trim(), a);
    save();
    return view(post, a);
  }
  if ((m = p.match(/^\/v1\/agent\/grants\/(\d+)$/))) {
    const g = s.agents!.find((x) => x.id === +m![1] && x.granted_at) ?? fail(404, "no such grant");
    return { id: g.id, bitmap_number: g.n, parcel: g.parcel ?? null, owner: agentHolder(g.n, g.parcel) ?? DEMO_ADDRESS, agent_key: g.key, message: g.message, signature: "演示签名", granted_at: g.granted_at,
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
    return { listings: s.market!.filter((x) => x.status === "active" && (n == null || x.n === +n || x.members?.includes(+n))).map(listingView) };
  }
  if ((m = p.match(/^\/v1\/market\/parks\/(\d+)(\/pack|\/unpack|\/listing\/prepare|\/listing)?$/))) {
    const id = +m[1], park = liveParks().find((x) => x.id === id) ?? fail(404, "no such park");
    const packed = (s.packed ?? []).includes(id);
    const listing = s.market!.find((x) => x.park === id && x.status === "active");
    if (!m[2]) return { park_id: id, name: park.name, owner: park.owner, members: park.members, packed, listing: listing ? listingView(listing) : null };
    if (needMe() !== park.owner) fail(403, "only the address holding the park can do this");
    if (m[2] === "/pack" || m[2] === "/unpack") {
      if ((m[2] === "/pack") === packed) fail(409, packed ? "the park's districts are already in one output" : "the park's districts aren't in one output");
      const k = park.members.length;
      lastMove = { park: id, pack: m[2] === "/pack" };
      return { move_id: id, psbt: DEMO_PSBT, psbt_hex: "", sign_inputs: Array.from({ length: k + 1 }, (_, i) => i), own_inputs: Array.from({ length: k }, (_, i) => i),
        network_fee_sats: 3 * (11 + 68 * (k + 1) + 31 * (lastMove.pack ? 2 : k + 1)), fee_rate: 3 };
    }
    if (!packed) fail(409, "put the park's districts into one output first");
    if (m[2] === "/listing/prepare") {
      lastPrice = Number(body.price_sats);
      return { psbt: DEMO_PSBT, psbt_hex: "", sign_inputs: [0], sighash: 0x83, postage_sats: 546 * park.members.length, members: park.members };
    }
    s.market!.forEach((x) => (x.park === id || park.members.includes(x.n)) && x.status === "active" && (x.status = "replaced"));
    const l: DemoListing = { id: Math.max(0, ...s.market!.map((x) => x.id)) + 1, n: park.members[0], seller: park.owner, price: lastPrice ?? 5_000_000,
      status: "active", at: new Date().toISOString(), park: id, members: park.members };
    s.market!.push(l);
    save();
    return listingView(l);
  }
  if ((m = p.match(/^\/v1\/market\/moves\/(\d+)\/submit$/))) {
    needMe();
    const move = lastMove ?? fail(404, "no such transaction");
    lastMove = null;
    s.packed = move.pack ? [...(s.packed ?? []), move.park] : (s.packed ?? []).filter((x) => x !== move.park);
    save();
    return { txid: sha256(`move:${move.park}:${Date.now()}`) };
  }
  const holds = (n: number, tx: number | null) => {
    if (tx == null) return owns(n);
    const a = needMe();
    if (parcelOwner(n, tx) !== a || !parcelIndexes(n).includes(tx)) fail(403, "only the address holding it can sell it");
    return a;
  };
  if (p === "/v1/market/parcels") {
    const rows = s.market!.filter((x) => x.status === "active" && x.tx != null).map((x) => ({
      ...listingView(x), level: levelAt(x.n), residents: new Set(parcelIndexes(x.n).map((i) => parcelOwner(x.n, i))).size, recruiting: !!recruitAt(x.n, me), zone: zoneOf(x.n),
    }));
    return { parcels: rows.sort((a, b) => Number(b.recruiting) - Number(a.recruiting) || b.level - a.level || a.price_sats - b.price_sats) };
  }
  if (p === "/v1/market/listings/prepare") {
    holds(Number(body.bitmap_number), body.tx_index == null ? null : Number(body.tx_index));
    lastPrice = Number(body.price_sats);
    return { psbt: DEMO_PSBT, psbt_hex: "", sign_inputs: [0], sighash: 0x83, inscription_id: inscriptionId(Number(body.bitmap_number)), postage_sats: 546 };
  }
  if (p === "/v1/market/listings" && method === "POST") {
    const n = Number(body.bitmap_number), tx = body.tx_index == null ? undefined : Number(body.tx_index), a = holds(n, tx ?? null);
    s.market!.forEach((x) => x.n === n && x.tx === tx && x.park == null && x.status === "active" && (x.status = "replaced"));
    const l: DemoListing = { id: Math.max(0, ...s.market!.map((x) => x.id)) + 1, n, tx, seller: a, price: lastPrice ?? 1_000_000, status: "active", at: new Date().toISOString() };
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
    return { id: tip.id, invoice: fakeInvoice(sats, tip.id), amount_sats: sats, verifiable: true, status: "pending", zap: !!body.zap_request && body.event_id == null } satisfies Tip;
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
  if (p === "/v1/admin/metrics") {
    // Twelve made-up weeks that grow, with tips past the first gate lately, so the page has something to show.
    const n = Math.max(2, Math.min(52, Number(url.searchParams.get("weeks") ?? 12)));
    const today = new Date(), monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - ((today.getUTCDay() + 6) % 7)));
    const weeks = Array.from({ length: n }, (_, i) => {
      const k = n - 1 - i, grow = 1 + i / 3, part = k === 0 ? (((today.getUTCDay() + 6) % 7) + 1) / 7 : 1, jig = 0.85 + hash(i + 77) * 0.3;
      const f = (x: number) => Math.round(x * grow * part * jig);
      const active = f(60), returning = Math.round(active * (0.35 + i * 0.03)), trades = f(0.6);
      return { week: new Date(monday.getTime() - k * 7 * DAY * 1000).toISOString().slice(0, 10), tipped_districts: f(14), tippers: f(30), tip_sats: f(42_000),
        active, returning, new: active - returning, trades, trade_sats: trades * Math.round(180_000 + hash(i) * 400_000), shop_orders: f(3), shop_sats: f(3) * 1800 };
    });
    return { weeks, gates: { tipped_districts: 50 } } satisfies Metrics;
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
