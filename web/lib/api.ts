// Typed client for the unimap API (api/ in this repo).

import { DEMO, demoApi } from "./demo";
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
  district: { inscription_id: string; inscription_number: number; inscribed_height: number; owner: Owner } | null;
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
};

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
  author: { address: string; role: Role; parcel: number | null; as_bitmap: number | null; x?: string | null };
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
};

export type Park = { id: number; name: string; owner: string; members: number[]; score: number; level: number };
export type Recruit = { message: string; parcels: number[]; updated_at: string; applications: number; applied: boolean };
export type Recruiting = {
  bitmap_number: number;
  name: string;
  zone: string | null;
  owner: string;
  level: number;
  message: string;
  parcels: number[];
  updated_at: string;
};
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

export type NotificationKind = "reply" | "like" | "post" | "follow" | "apply";
export type Notification = {
  id: number;
  kind: NotificationKind;
  actor: string;
  bitmap_number: number;
  post_id: number | null;
  created_at: string;
  read: boolean;
  snippet: string | null;
};
