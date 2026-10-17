// Typed client for the unimap API (api/ in this repo).

import type { PayMethod } from "./billing";
import { DEMO, demoApi } from "./demo";
import type { BadgeKind, Rarity } from "./game";
import type { Pet, PetKey, PublicPet } from "./pets";
import type { Prosperity } from "./prosperity";
import type { DistrictStyle } from "./style";
import type { EnvelopeStyle, Tag, Tier } from "./capsule";
import type { GiftNetwork } from "./gift";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
// The server (share images) can reach the API without going out through the public origin.
const BASE = typeof window === "undefined" ? (process.env.API_INTERNAL_URL || API_URL).replace(/\/$/, "") : API_URL;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  if (DEMO) return demoApi<T>(path, opts);
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  const res = await fetch(BASE + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const js = await res.json();
      detail = typeof js.detail === "string" ? js.detail : JSON.stringify(js.detail);
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export type Owner = { address: string | null; outpoint: string; output_value: number | null } | null;

export type Parcel = {
  name: string;
  bitmap_number: number;
  tx_index: number;
  inscription_id: string;
  inscription_number: number;
  inscribed_height: number;
  owner: Owner;
};

export type Land = {
  name: string;
  bitmap_number: number;
  zone: string | null;
  tx_count: number | null;
  claimed: boolean;
  district: { inscription_id: string; inscription_number: number; inscribed_height: number; owner: Owner; sale?: Sale | null } | null;
  parcels: Parcel[];
};

export type Tile = {
  bitmap_number: number;
  zone: string | null; // see lib/zones.ts; null until the zone indexer reaches the block
  tx_count: number | null;
  claimed: boolean;
  owner: string | null;
  parcels: number;
  posts: number;
  level?: number | null; // prosperity 1-5, see lib/prosperity.ts
  style?: DistrictStyle | null;
  park?: number | null;
  pets?: string[]; // "dog:2": what the owner shows of their wallet, see lib/pets.ts
  sale?: number | null; // asking price in sats while listed on a marketplace (api/listings.py)
  lucky?: boolean; // the lucky district this round (api/game.py)
  treasure?: Rarity | null; // the rarest open treasure on its parcels
  crown?: number | null; // 1-3: placed in the last season (api/seasons.py)
};

/** A district's listing on a marketplace (在售): its price and where to buy. */
export type Sale = { price_sats: number; market: string; url: string | null; listed_at: string | null; listing_id?: number };
/** 站内交易 (api/market.py). */
export type MarketInfo = { open: boolean; network: string | null; fee_bps: number; dummy_sats: number };
export type MarketListing = {
  id: number;
  inscription_id: string;
  bitmap_number: number;
  tx_index: number | null;
  seller: string;
  price_sats: number;
  postage_sats: number;
  status: "active" | "sold" | "cancelled" | "replaced" | "gone";
  created_at: string;
  txid: string | null;
  buyer: string | null;
  park_id: number | null; // 园区打包卖: the whole park, with its districts in members
  members: number[] | null;
};
/** A park sold whole: whether its districts are in one output yet, and its live listing. */
export type ParkSale = { park_id: number; name: string; owner: string; members: number[]; packed: boolean; listing: MarketListing | null };
/** Packing a park's districts into one output, or splitting it again: own_inputs are signed by the inscription address. */
export type ParkMove = { move_id: number; psbt: string; psbt_hex: string; sign_inputs: number[]; own_inputs: number[]; network_fee_sats: number; fee_rate: number };
export type Quote = {
  quote_id: number;
  psbt: string;
  sign_inputs: number[];
  price_sats: number;
  fee_sats: number;
  network_fee_sats: number;
  fee_rate: number;
  postage_sats: number;
  total_sats: number;
  expires_in: number;
};
/** 出价: a buyer's signed offer on something nobody listed, waiting for its holder. */
export type MarketOffer = {
  id: number;
  inscription_id: string;
  bitmap_number: number;
  tx_index: number | null;
  buyer: string;
  seller: string;
  price_sats: number;
  status: "active" | "accepted" | "cancelled" | "declined" | "expired" | "gone";
  created_at: string;
  expires_at: string;
  txid: string | null;
};
export type OfferQuote = Omit<Quote, "quote_id" | "expires_in"> & { offer_id: number };

export type LandEvent = {
  id: number;
  kind: "district_claimed" | "parcel_claimed" | "transfer";
  block_height: number;
  block_time: number;
  inscription_id: string;
  bitmap_number: number;
  tx_index: number | null;
  from_address: string | null;
  to_address: string | null;
};

export type Role = "owner" | "resident" | "tenant" | "visitor"; // tenant: 暂住居民, let in by the owner (api/tenants.py)

export type Post = {
  id: number;
  bitmap_number: number;
  author: { address: string; role: Role; parcel: number | null; as_bitmap: number | null; x?: string | null; tippable?: boolean; nostr?: string | null; badge?: WornBadge | null };
  reply_to: number | null;
  body: string | null;
  media: string[];
  signed_message: string | null;
  signature: string | null;
  created_at: string;
  removed: boolean;
  like_count: number;
  reply_count: number;
  liked_by_me: boolean;
  tips_sats?: number; // confirmed Lightning tips, in sats
  nostr_event_id?: string | null; // the Nostr note its author also published it as
  agent?: { grant_id: number; key: string } | null; // published by the district's agent, signed with its key
};

export type District = {
  bitmap_number: number;
  name: string;
  owner: string | null;
  owner_x?: XAccount | null;
  profile: { bio: string; cover: string | null; visitor_comments_on: boolean; pinned_post_id: number | null; style?: DistrictStyle | null };
  pinned_post: Post | null;
  followers: number;
  post_count: number;
  viewer: { address: string; role: Role; parcel: number | null; muted: boolean; following: boolean } | null;
  // Added with prosperity; the page hides them if an older API leaves them out.
  prosperity?: Prosperity;
  checked_in_today?: boolean;
  level?: number; // as drawn on the map: a park member takes the park's level
  park?: Park | null;
  recruit?: Recruit | null;
  pets?: Pet[];
  parcel_pets?: Record<string, string>; // {tx_index: "dog:2"}: the pet each resident shows on their parcel
  tips?: { sats30: number; tippers30: number };
  owner_tippable?: boolean; // the owner has a Lightning address for tips
  game?: DistrictGame;
};

/** POST /v1/tips and GET /v1/tips/{id}: an invoice from the recipient's wallet and whether it was paid. */
export type Tip = { id: number; invoice?: string; amount_sats?: number; verifiable: boolean; status: "pending" | "settled" | "expired"; zap?: boolean };
/** GET /v1/tips/top: 打赏榜. */
export type TipTop = {
  days: number;
  posts: { post: Post; sats: number; tippers: number }[];
  districts: { bitmap_number: number; name: string; zone: string | null; sats: number; tippers: number }[];
};

export type Park = { id: number; name: string; owner: string; members: number[]; score: number; level: number };
/** A parcel someone listed in unimap: buying it is the other way to move in. */
export type ParcelListed = { listing_id: number; tx_index: number; price_sats: number; seller: string };
export type Recruit = { message: string; parcels: number[]; updated_at: string; applications: number; applied: boolean; for_sale?: ParcelListed[] };
export type Recruiting = {
  bitmap_number: number;
  name: string;
  zone: string | null;
  owner: string;
  level: number;
  message: string;
  parcels: number[];
  updated_at: string;
  for_sale?: ParcelListed[];
};
/** A parcel for sale city-wide, with what its district is like. */
export type ParcelForSale = MarketListing & { level: number; residents: number; recruiting: boolean; zone: string | null };
export type Application = { address: string; note: string; created_at: string };
export type Tenant = { address: string; since: string };
// 开张 (api/opening.py)
export type Opening = { steps: { bio: boolean; post: boolean; recruit: boolean }; opened: boolean; badge: Badge | null; new: boolean };
export type Opened = { bitmap_number: number; opened_at: string; bio: string; posts: number };
export type Poll = {
  id: number;
  bitmap_number: number;
  question: string;
  options: string[];
  counts: number[];
  total: number;
  my_vote: number | null;
  created_by: string;
  created_at: string;
  closes_at: string;
  closed: boolean;
};

/** GET /v1/me/pets: a pet the wallet holds, with its care (api/pets.py). */
export type CaredPet = {
  asset: PetKey;
  tier: number;
  amount: string;
  name: string | null;
  affection: number;
  level: number;
  next_level_at: number | null;
  streak: number;
  fed_at: string | null;
  can_feed_at: string | null;
  mood: "full" | "ok" | "hungry" | "starving";
  items: string[]; // the wallet's own inscriptions of this collection, a few at most; none for a rune
  face: string | null; // the one the pet looks like
  public: boolean; // shown on the owner's public page
};

export type Ranking = { bitmap_number: number; name: string; zone: string | null; owner: string | null; score: number; level: number };

export type Me = {
  address: string;
  districts: number[];
  parcels: { bitmap_number: number; tx_index: number }[];
  follows: number[];
  x?: XAccount | null;
  wallets?: LinkedWallet[];
  admin?: boolean; // a site admin (ADMIN_ADDRESSES)
  banned?: boolean; // stopped from posting by a site admin
  nostr?: string | null; // linked Nostr public key (hex)
};

/** GET /v1/admin/reports: a reported post with its open reports. */
export type ReportGroup = {
  post: Post;
  count: number;
  reports: { reporter: string; reason: string; note: string; created_at: string }[];
  author_banned: boolean;
};
export type Ban = { address: string; reason: string; banned_by: string; created_at: string; expires_at: string | null };

/** One of the wallets linked together (关联钱包); main is the group's first address, me the one signed in. */
export type LinkedWallet = { address: string; main: boolean; me: boolean };

/** GET /v1/people/{address}: someone's land, X account and posts. */
export type Person = {
  address: string;
  x: XAccount | null;
  districts: { bitmap_number: number; level: number; park: string | null }[];
  parcels: { bitmap_number: number; tx_index: number }[];
  post_count: number;
  reply_count: number;
  follows: number;
  first_post_at: string | null;
  posts: Post[];
  badges?: Badge[];
  pets?: PublicPet[]; // the ones the owner chose to show
};

/** GET /v1/search: a district number, parks by name, people by address or X handle. */
export type SearchResults = {
  districts: number[];
  parks: { id: number; name: string; members: number; first: number }[];
  people: { address: string; x: XAccount | null; districts: number[]; count: number }[];
};

/** An X (Twitter) account linked to an address through X's sign-in. */
export type XAccount = { username: string; name: string; avatar_url: string | null; url: string };

export type FeedItem = { type: "post"; time: number; post: Post } | { type: "event"; time: number; event: LandEvent };

/** The owner's view of what their wallet holds and what the district shows. */
export type Showcase = { chosen: PetKey[]; held: Pet[]; wallets?: number; checked_at: string | null; error: string | null; shown: Pet[] };

export type NotificationKind = "reply" | "like" | "post" | "follow" | "apply" | "tip" | "treasure" | "lucky" | "crown" | "event_win" | "sold" | "offer" | "offer_accepted" | "agent_draft" | "agent_posted" | "agent_alert" | "shop_sold" | "pat" | "tenant" | "dm" | "capsule_open";
export type Notification = {
  id: number;
  kind: NotificationKind;
  actor: string;
  bitmap_number: number;
  post_id: number | null;
  created_at: string;
  read: boolean;
  snippet: string | null;
  amount_sats?: number; // tips
  comment?: string;
  block_height?: number; // treasure, lucky: the block that drew it; crown, event_win: the season's first block
  tx_index?: number; // treasure: the parcel
  rarity?: Rarity;
  agent_parcel?: number | null; // agent_*: set when it is a parcel's agent rather than the district's
  title?: string; // shop_sold: what was bought
  capsule_id?: string; // capsule_open: the letter, and who it was for
  recipient?: string | null;
};

/** 区块节拍 (api/game.py). */
export type Badge = { id?: number; kind: BadgeKind; height: number; bitmap_number: number; tx_index: number | null; rarity: Rarity; created_at: string; worn?: boolean };
/** The badge someone wears beside their name (PUT /v1/me/badge). */
export type WornBadge = { kind: BadgeKind; rarity: Rarity };
export type OpenTreasure = { height: number; block_hash: string; tx_index: number; rarity: Rarity; closes_at: number; claimable: boolean };
export type DistrictGame = {
  lucky: { since: number; until: number; visited: boolean } | null;
  treasures: OpenTreasure[];
  crown?: { rank: number; season: number } | null;
};
export type Draw = {
  height: number;
  block_hash: string;
  bitmap_number: number | null;
  tx_index: number | null;
  candidates: number;
  index: number | null;
  rarity: Rarity;
  opened_by: string | null;
  open: boolean;
};
export type LuckyRound = { since: number; until: number; block_hash: string; candidates: number; index: number | null; bitmap_number: number | null; owner: string | null };
/** 每日巡城 (api/tour.py): today's stops; done and streak only for a signed-in viewer. */
export type Tour = {
  day: string;
  stops: { bitmap_number: number; visited: boolean }[];
  done?: boolean;
  streak?: number;
  rules: { stops: number; active: number; active_days: number; streaks: [number, Rarity][] };
};
/** 新手任务 (api/newcomer.py): the signed-in address's three steps and, once done, the 新居民 badge. */
export type Newcomer = { steps: { birthday: boolean; checkin: boolean; capsule: boolean }; done: number; of: number; badge: Badge | null; new: boolean };
export type Game = { tip: number | null; round: LuckyRound | null; draws: Draw[]; badges: Badge[] | null; rules: { round: number; claim_blocks: number } };
/** 街区活动 (api/events.py): an owner's prizes for whoever does the most in the district over a season. */
export type ContestMetric = "posts" | "replies" | "checkins";
export type Contest = {
  id: number;
  bitmap_number: number;
  season: number;
  since: number;
  until: number;
  host: string;
  metric: ContestMetric;
  prizes: number[];
  total_sats: number;
  note: string;
  status: "upcoming" | "running" | "ended" | "cancelled";
  created_at: string;
  standings?: { address: string; score: number }[];
  winners?: { place: number; address: string; score: number; prize_sats: number; paid: "settled" | "pending" | null }[];
  sponsor?: Sponsor;
};
/** A sponsor named on the season's pool or an event: plain text, with an https link when given. */
export type Sponsor = { name: string; url: string | null };
/** 推广 (api/billing.py): a district a site admin put in a slot. */
export type Promotion = { bitmap_number: number; name: string; note: string; ends_at: string | null };
export type SeasonRow = { bitmap_number: number; owner: string | null; score: number; parts?: Record<"posts" | "replies" | "checkins", number> };
export type Season = {
  number: number | null;
  since: number;
  until: number;
  tip: number;
  started_at: string;
  standings: SeasonRow[];
  last: { number: number; winners: SeasonRow[] } | null;
  weights: Record<"posts" | "replies" | "checkins", number>;
  pool_sats: number;
  pool_split: number[];
  sponsor?: Sponsor | null;
};

/** 指标 (api/metrics.py), for site admins. */
export type MetricsWeek = {
  week: string; // the Monday it starts on
  tipped_districts: number;
  tippers: number;
  tip_sats: number;
  active: number;
  returning: number;
  new: number;
  trades: number;
  trade_sats: number;
  shop_orders: number;
  shop_sats: number;
};
export type Metrics = { weeks: MetricsWeek[]; gates: { tipped_districts: number } };

/** 店铺 (api/shop.py). */
export type ShopItem = {
  id: number;
  bitmap_number: number;
  tx_index: number | null; // sold from this parcel by its resident; null for the district's owner
  seller: string;
  title: string;
  description: string;
  price_sats: number;
  stock: number | null;
  active: boolean;
  created_at: string;
  sold: number;
  left: number | null;
  on_sale: boolean;
  mine?: boolean;
  bought?: { order_id: number; content: string; at: string }[]; // the viewer's own purchases
  content?: string; // for its seller only
};
export type ShopBought = { order_id: number; item_id: number; bitmap_number: number; title: string; amount_sats: number; content: string; at: string };

/** 街区 agent (api/agent.py). */
export type AgentTask = "welcome" | "digest" | "answers" | "shop";
export type AgentInfo = { open: boolean; price_sats: number; days: number; max_days: number; max_per_day: number; tasks: AgentTask[]; parcel_tasks?: AgentTask[] };
export type AgentProblem = "expired" | "owner_changed" | "unpaid" | "banned" | "muted";
export type Agent = {
  id: number;
  key: string;
  parcel?: number | null; // set for a resident's agent, which looks after that parcel
  posts_per_day: number;
  posted_today: number;
  expires_at: string;
  granted_at: string;
  paid_until: string | null;
  persona: string;
  tasks: AgentTask[];
  may_publish: boolean; // the signed grant lets it post without asking
  auto_tasks: AgentTask[]; // the tasks it posts on its own
  watch: { radius?: number; max_price_sats?: number };
  memory: string[];
  problem: AgentProblem | null;
  last_run_at: string | null;
  running: boolean;
  last: { at: string; drafts: number; posted?: number; error: string | null } | null;
};
export type AgentDraft = {
  id: number;
  reply_to: number | null;
  body: string;
  why: string;
  task: AgentTask;
  status: "pending" | "posted" | "discarded" | "expired";
  post_id: number | null;
  created_at: string;
  decided_at: string | null;
  auto?: boolean; // it posted this without the owner looking first
};
export type AgentBriefing =
  | { kind: "applications"; count: number }
  | { kind: "poll_closing"; poll_id: number; question: string; closes_at: string }
  | { kind: "prizes_unpaid"; event_id: number; season: number; count: number }
  | { kind: "treasure"; height: number; rarity: Rarity; closes_at_height: number };
export type AgentView = { agent: Agent | null; drafts: AgentDraft[]; recent: AgentDraft[]; briefing: AgentBriefing[] };
export type AgentGrant = { id: number; bitmap_number: number; parcel?: number | null; owner: string; agent_key: string; message: string; signature: string; granted_at: string; expires_at: string; revoked_at: string | null };

/** 时间胶囊 (api/capsule.py). key comes once it is open; ciphertext and the signature only on the capsule's own page. */
export type Capsule = {
  id: string;
  author: string;
  recipient: string;
  fingerprint: string;
  open_at: string;
  sealed_height: number;
  sealed_at: string;
  status: "pending" | "sealed" | "open"; // pending: 封存 waiting for its invoice to be paid, seen by its author alone
  tip: number | null;
  blocks_left: number | null;
  open_height: number | null;
  key: string | null;
  line: string | null;
  tag: Tag | null;
  mine: boolean;
  tier?: Tier; // open: sealed while billing was off
  style?: EnvelopeStyle;
  has_photo?: boolean;
  ciphertext?: string;
  photo?: string | null; // base64 of iv || AES-GCM of a JPEG, under the letter's key
  signed_message?: string;
  signature?: string;
  payment?: Payment; // POST /v1/capsules for 封存: the invoice that seals it
  gift?: CapsuleGiftSummary | null; // 礼物 (api/gift.py): then key never comes; the 时间锁 opens it
  onchain?: boolean; // 上链: the letter is inscribed (with its gift, or on its own: chain)
  chain?: CapsuleChain | null; // an inscribed letter without a gift: then key never comes, half does once open
  half?: string | null; // unimap's half of an inscribed letter's key, once open; the link's #r= is the other
};
/** api/gift.py letter(): an inscribed letter's public facts. address null: the postage went back to the sender. */
export type CapsuleChain = {
  network: GiftNetwork;
  height: number;
  drand_round: number;
  tlock: string;
  address: string | null;
  sats: number;
  commit_txid: string | null;
  reveal_txid: string | null;
  verified: boolean;
  inscribed: boolean;
  inscription_id: string | null;
  explorer: string;
  live?: boolean; // the demo's 真实 Signet (lib/signet.ts)
};
/** api/prices.py: mainnet's BTC/USD and fee rate (sat/vB), for showing costs in dollars. */
export type UsdRate = { btc_usd: number; fee_rate: number | null; at: number };
export type CapsuleGiftSummary = { network: GiftNetwork; sats: number; height: number; refund: boolean; address: string; reveal_txid: string | null; funded: boolean; live?: boolean };
/** api/gift.py: what anyone with the link may see of a gift. */
export type CapsuleGift = {
  capsule_id: string;
  network: GiftNetwork;
  sats: number;
  height: number;
  refund: boolean;
  refund_height: number | null;
  recipient_key: string;
  sender_key: string | null;
  bearer: boolean;
  address: string;
  author: string;
  drand_round: number;
  tlock: string;
  commit_txid: string | null;
  reveal_txid: string | null;
  inscription_id: string | null;
  verified: boolean;
  funded: boolean;
  tip: number | null;
  unlocked: boolean;
  explorer: string;
  live?: boolean; // the demo's 真实 Signet (lib/signet.ts)
};
export type GiftRules = { network: GiftNetwork; tiers: number[]; min_sats: number; max_sats: number; refund_blocks: number; block_seconds: number; tip: number | null; esplora: string; explorer: string; live?: boolean }; // live: the demo's 真实 Signet (lib/signet.ts)
export type CapsuleRules = {
  min_lead_seconds: number;
  block_seconds: number;
  tags: Tag[];
  tip: number | null;
  billing?: boolean; // 封存 is for sale (its price is in /v1/billing/products), so the free tier has limits
  free_left?: boolean | null; // the wallet still has its free capsule; null when not signed in
  free_days?: number;
  max_years?: number;
  styles?: EnvelopeStyle[];
  max_photo_chars?: number;
  inscribe_sats?: number; // 刻上链, shown as coming soon
  onchain?: boolean; // 上链: billing on and a gift network, so every letter is inscribed (首封 free of the service fee)
  max_chain_photo_bytes?: number;
  postage_sats?: number; // what an inscribed letter's reveal sends on
  usd?: UsdRate | null; // null: no price, show sats
  gift?: GiftRules | null; // 礼物 on a test network; null while off
};
/** api/billing.py: one payment for a product, as /v1/billing/pay and /v1/billing/payments/{id} give it.
 * onchain: send amount_sats to address, then post the txid; lightning: pay the invoice. */
export type Payment = {
  id: number;
  product: string;
  ref: string;
  amount_sats: number;
  status: "pending" | "settled" | "expired";
  verifiable: boolean;
  method?: PayMethod; // left out by older servers: lightning
  invoice?: string;
  address?: string;
  txid?: string | null;
};
export type BillingProducts = { products: { product: string; amount_sats: number }[]; cosmetics: boolean; methods?: PayMethod[] };
export type CapsuleScope = "block" | "hour" | "day";
/** 同块人: someone's public line on a capsule they sealed near a block. */
export type CapsulePeer = { ref: string; address: string; line: string; tag: Tag | null; sealed_at: string; sealed_height: number; mine: boolean; capsule_id?: string };
export type CapsulePeers = {
  height: number;
  tip: number;
  day: string;
  scope: CapsuleScope;
  counts: Record<CapsuleScope, number>;
  sealed_here: number;
  births_here: number;
  peers: CapsulePeer[];
};

/** 私信 (api/dms.py). */
export type DmMessage = { id: number; from_me: boolean; body: string | null; removed: boolean; created_at: string; read: boolean };
export type Conversation = { peer: string; last: DmMessage; unread: number };
export type DmThread = { peer: string; messages: DmMessage[]; more: boolean; can_send: boolean; why_not: "blocked" | "strangers_off" | null; blocked_by_me: boolean };
/** A reported private message or capsule line, for site admins. */
export type ItemReport = { kind: "dm" | "capsule"; item_id: string; count: number; last: string; reasons: string[]; notes: string[]; author: string; text: string };
