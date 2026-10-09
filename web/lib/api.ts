// Typed client for the unimap API (api/ in this repo).

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  const res = await fetch(API_URL + path, {
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
  author: { address: string; role: Role; parcel: number | null; as_bitmap: number | null };
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
  profile: { bio: string; cover: string | null; visitor_comments_on: boolean; pinned_post_id: number | null };
  pinned_post: Post | null;
  followers: number;
  post_count: number;
  viewer: { address: string; role: Role; parcel: number | null; muted: boolean; following: boolean } | null;
};

export type Me = {
  address: string;
  districts: number[];
  parcels: { bitmap_number: number; tx_index: number }[];
  follows: number[];
};

export type FeedItem = { type: "post"; time: number; post: Post } | { type: "event"; time: number; event: LandEvent };
