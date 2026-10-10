// Typed client for the unimap API (api/ in this repo).

import { DEMO, demoApi } from "./demo";
import type { BadgeKind, Rarity } from "./game";
import type { Pet, PetKey } from "./pets";
import type { Prosperity } from "./prosperity";
import type { DistrictStyle } from "./style";

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

export type Role = "owner" | "resident" | "visitor";

export type Post = {
  id: number;
  bitmap_number: number;
  author: { address: string; role: Role; parcel: number | null; as_bitmap: number | null; x?: string | null; tippable?: boolean };
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
  tips?: { sats30: number; tippers30: number };
  owner_tippable?: boolean; // the owner has a Lightning address for tips
  game?: DistrictGame;
};

/** POST /v1/tips and GET /v1/tips/{id}: an invoice from the recipient's wallet and whether it was paid. */
export type Tip = { id: number; invoice?: string; amount_sats?: number; verifiable: boolean; status: "pending" | "settled" | "expired" };
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

export type NotificationKind = "reply" | "like" | "post" | "follow" | "apply" | "tip" | "treasure" | "lucky" | "crown" | "event_win" | "sold" | "offer" | "offer_accepted" | "agent_draft" | "agent_alert";
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
};

/** 区块节拍 (api/game.py). */
export type Badge = { kind: BadgeKind; height: number; bitmap_number: number; tx_index: number | null; rarity: Rarity; created_at: string };
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
};
export type SeasonRow = { bitmap_number: number; owner: string | null; score: number; parts?: Record<"posts" | "replies" | "checkins" | "tippers", number> };
export type Season = {
  number: number | null;
  since: number;
  until: number;
  tip: number;
  started_at: string;
  standings: SeasonRow[];
  last: { number: number; winners: SeasonRow[] } | null;
  weights: Record<"posts" | "replies" | "checkins" | "tippers", number>;
  pool_sats: number;
  pool_split: number[];
};

/** 街区 agent (api/agent.py). */
export type AgentTask = "welcome" | "digest" | "answers";
export type AgentInfo = { open: boolean; price_sats: number; days: number; max_days: number; max_per_day: number; tasks: AgentTask[] };
export type AgentProblem = "expired" | "owner_changed" | "unpaid" | "banned";
export type Agent = {
  id: number;
  key: string;
  posts_per_day: number;
  posted_today: number;
  expires_at: string;
  granted_at: string;
  paid_until: string | null;
  persona: string;
  tasks: AgentTask[];
  watch: { radius?: number; max_price_sats?: number };
  memory: string[];
  problem: AgentProblem | null;
  last_run_at: string | null;
  running: boolean;
  last: { at: string; drafts: number; error: string | null } | null;
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
};
export type AgentBriefing =
  | { kind: "applications"; count: number }
  | { kind: "poll_closing"; poll_id: number; question: string; closes_at: string }
  | { kind: "prizes_unpaid"; event_id: number; season: number; count: number };
export type AgentView = { agent: Agent | null; drafts: AgentDraft[]; recent: AgentDraft[]; briefing: AgentBriefing[] };
export type AgentGrant = { id: number; bitmap_number: number; owner: string; agent_key: string; message: string; signature: string; granted_at: string; expires_at: string; revoked_at: string | null };
