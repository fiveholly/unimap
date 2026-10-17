// 时间胶囊: the letter is encrypted here, in the browser, with AES-GCM under a random key. The API
// keeps the ciphertext and holds the key until the first block at or past the opening time
// (api/capsule.py); the sender gets the same key once, as the recipient's spare key, in the share
// link's #fragment, which browsers never send to a server.

import { t } from "./i18n/index.ts";

export const BLOCK_SECONDS = 600;
export const MAX_LETTER = 2000;
export const MAX_RECIPIENT = 64; // a label, or a Bitcoin address
export const MAX_LINE = 80;
/** Blocks either side of a block that count as "前后 1 小时" among 同块人. */
export const HOUR_BLOCKS = 6;

export const TAGS = ["birth", "wedding", "farewell", "start", "other"] as const;
export type Tag = (typeof TAGS)[number];
// Keys for t(): "#tag" keeps them apart from the same words elsewhere ("其他" as a report reason).
export const TAG_NAMES: Record<Tag, string> = { birth: "出生#tag", wedding: "结婚#tag", farewell: "告别#tag", start: "开始#tag", other: "其他#tag" };

// ---- tiers (api/capsule.py) ----------------------------------------------------------------
// With billing off every capsule is "open": free, no limits. With it on, "free" is one per wallet
// (text only, the default envelope, opening within a year) and "paid" (封存) is paid for (from the
// connected wallet on-chain, or over Lightning; lib/billing.ts) before it counts as sealed.
// "inscribe" (刻上链) is shown as coming soon, never sold.

export type Tier = "open" | "free" | "paid";
export type TierOption = { tier: "free" | "paid" | "inscribe"; sats: number; available: boolean };

/** The envelopes: paper and wax. classic is the free one. */
export const STYLES = ["classic", "midnight", "celadon", "dusk"] as const;
export type EnvelopeStyle = (typeof STYLES)[number];
export const DEFAULT_STYLE: EnvelopeStyle = "classic";
export const STYLE_NAMES: Record<EnvelopeStyle, string> = { classic: "素笺朱漆", midnight: "夜航金漆", celadon: "青瓷墨绿", dusk: "暮色紫漆" };
/** The photo once shrunk in the browser, before it is encrypted. */
export const MAX_PHOTO_BYTES = 300_000;
export const PHOTO_SIDE = 1600;

/** The options on the write page, in order: 免费体验 while the wallet still has it (or before
 * anyone signs in), 封存 at its price, and 刻上链, never available. None with billing off. */
export function tierOptions(billing: boolean, freeLeft: boolean | null, paidSats: number, inscribeSats: number): TierOption[] {
  if (!billing) return [];
  return [
    ...(freeLeft !== false ? [{ tier: "free" as const, sats: 0, available: true }] : []),
    { tier: "paid", sats: paidSats, available: paidSats > 0 },
    { tier: "inscribe", sats: inscribeSats, available: false },
  ];
}

/** The tier to start on: the free one while it is offered, else 封存; "open" with billing off. */
export function defaultTier(options: TierOption[]): Tier {
  if (!options.length) return "open";
  return options.some((o) => o.tier === "free") ? "free" : "paid";
}

/** What a capsule of this tier may carry: a photo, an envelope style, any time up to 100 years, and 「信打开了」. */
export function tierAllows(tier: Tier): { photo: boolean; style: boolean; anyTime: boolean; told: boolean } {
  const all = tier !== "free";
  return { photo: all, style: all, anyTime: all, told: all };
}

/** Whether openAt is too far off for the free tier: more than freeDays after now (unix seconds). */
export function pastFreeLimit(tier: Tier, openAt: number, now: number, freeDays: number): boolean {
  return tier === "free" && openAt > now + freeDays * 86400;
}

/** Width and height scaled down (never up) so the longer side is at most side. */
export function fitWithin(w: number, h: number, side: number): [number, number] {
  const k = Math.min(1, side / Math.max(w, h, 1));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** "286 KB" */
export function kb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/** Shrink an image in the browser to a JPEG of at most maxBytes: lower quality first, then size. */
export async function compressImage(file: Blob, maxBytes = MAX_PHOTO_BYTES, side = PHOTO_SIDE): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  try {
    for (let s = side; s >= 320; s = Math.round(s * 0.75)) {
      const [w, h] = fitWithin(bitmap.width, bitmap.height, s);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
      for (const q of [0.85, 0.72, 0.6, 0.48]) {
        const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", q));
        if (blob && blob.size <= maxBytes) return new Uint8Array(await blob.arrayBuffer());
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error(t("这张照片压不到 300 KB 以内，换一张试试。"));
}

/** Unix seconds as the API writes them in the signed text: 2044-10-15T00:00:00Z. */
export function isoZ(unix: number): string {
  return new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The exact text the wallet signs to seal a capsule. Must match capsule_message in api/capsule.py. */
export function capsuleMessage(recipient: string, openAt: number, fingerprint: string, line: string | null, tag: Tag | null, signedAt: number): string {
  return [
    "unimap time capsule",
    `to: ${recipient}`,
    `open-at: ${isoZ(openAt)}`,
    `sha256: ${fingerprint}`,
    `public: ${line || "none"}`,
    `tag: ${tag || "none"}`,
    `time: ${signedAt}`,
  ].join("\n");
}

/** Blocks still to come before openAt (unix seconds), at blockSeconds a block; at least 1. */
export function blocksUntil(openAt: number, now: number, blockSeconds = BLOCK_SECONDS): number {
  return Math.max(1, Math.ceil((openAt - now) / blockSeconds));
}

/** Roughly the block that opens a capsule: the tip plus the blocks still to come. */
export function openHeightEstimate(tip: number, openAt: number, now: number, blockSeconds = BLOCK_SECONDS): number {
  return tip + blocksUntil(openAt, now, blockSeconds);
}

/** "大约 18 年" for so many blocks. */
export function spanText(blocks: number, blockSeconds = BLOCK_SECONDS): string {
  const s = blocks * blockSeconds;
  if (s >= 365.25 * 86400) return t("大约 {n} 年", { n: Math.round(s / (365.25 * 86400)) });
  if (s >= 2 * 86400) return t("大约 {n} 天", { n: Math.round(s / 86400) });
  if (s >= 3600) return t("大约 {n} 小时", { n: Math.round(s / 3600) });
  return t("大约 {n} 分钟", { n: Math.max(1, Math.round(s / 60)) });
}

/** How many of n bars to fill: the share of the wait already behind, at least one. */
export function barsDone(sealedHeight: number, tip: number, blocksLeft: number, n = 18): number {
  const total = tip - sealedHeight + blocksLeft;
  return total <= 0 ? n : Math.min(n, Math.max(1, Math.round(((tip - sealedHeight) / total) * n)));
}

/** 7f3a91c2…e04b */
export function shortHash(hex: string): string {
  return hex.length > 14 ? `${hex.slice(0, 8)}…${hex.slice(-4)}` : hex;
}

/** The spare key in a share link's fragment: #k=<key>. */
export function keyFromHash(hash: string): string | null {
  const m = hash.replace(/^#/, "").match(/(?:^|&)k=([A-Za-z0-9_-]{43})(?:&|$)/);
  return m ? m[1] : null;
}

/** The next time month and day of `day` (YYYY-MM-DD) come round, at least `after` (unix seconds), as YYYY-MM-DD. */
export function nextAnniversary(day: string, after: number): string | null {
  const m = day.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const from = new Date(after * 1000);
  for (let y = from.getUTCFullYear(); y < from.getUTCFullYear() + 9; y++) {
    const d = new Date(Date.UTC(y, +m[1] - 1, +m[2]));
    if (d.getUTCMonth() === +m[1] - 1 && d.getTime() / 1000 >= after) return d.toISOString().slice(0, 10);
  }
  return null;
}

// ---- crypto -----------------------------------------------------------------------------

const toB64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64url = (bytes: Uint8Array) => toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => fromB64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sealBytes(key: CryptoKey, plain: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain as BufferSource));
  return concat(iv, sealed);
}

const concat = (a: Uint8Array, b: Uint8Array) => {
  const all = new Uint8Array(a.length + b.length);
  all.set(a);
  all.set(b, a.length);
  return all;
};

/** Encrypt a letter, and a photo if given, under one random key, each with its own iv: base64 of
 * iv || ciphertext for each, the key as base64url, and the sha256 of the letter's bytes followed by
 * the photo's (the letter's alone with no photo). That fingerprint is what the wallet signs. */
export async function encryptLetter(text: string, photo?: Uint8Array | null): Promise<{ ciphertext: string; photo: string | null; key: string; fingerprint: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const letter = await sealBytes(key, new TextEncoder().encode(text));
  const image = photo ? await sealBytes(key, photo) : null;
  return { ciphertext: toB64(letter), photo: image ? toB64(image) : null, key: toB64url(raw), fingerprint: await sha256Hex(image ? concat(letter, image) : letter) };
}

async function openBytes(sealed: string, key: string): Promise<Uint8Array> {
  const all = fromB64(sealed);
  const k = await crypto.subtle.importKey("raw", fromB64url(key) as BufferSource, "AES-GCM", false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, k, all.slice(12)));
}

/** The letter back from encryptLetter's ciphertext and key; throws if the key is wrong. */
export async function decryptLetter(ciphertext: string, key: string): Promise<string> {
  return new TextDecoder().decode(await openBytes(ciphertext, key));
}

/** The photo's bytes (a JPEG) back from encryptLetter's photo and key; throws if the key is wrong. */
export function decryptPhoto(photo: string, key: string): Promise<Uint8Array> {
  return openBytes(photo, key);
}

/** Whether the ciphertext (and the photo, if any) still hash to the fingerprint the sender signed. */
export async function fingerprintOk(ciphertext: string, fingerprint: string, photo?: string | null): Promise<boolean> {
  const letter = fromB64(ciphertext);
  return (await sha256Hex(photo ? concat(letter, fromB64(photo)) : letter)) === fingerprint;
}
