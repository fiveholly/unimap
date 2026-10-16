// 时间胶囊: the letter is encrypted here, in the browser, with AES-GCM under a random key. The API
// keeps the ciphertext and holds the key until the first block at or past the opening time
// (api/capsule.py); the sender gets the same key once, as the recipient's spare key, in the share
// link's #fragment, which browsers never send to a server.

import { t } from "./i18n/index.ts";

export const BLOCK_SECONDS = 600;
export const MAX_LETTER = 2000;
export const MAX_RECIPIENT = 40;
export const MAX_LINE = 80;
/** Blocks either side of a block that count as "前后 1 小时" among 同块人. */
export const HOUR_BLOCKS = 6;

export const TAGS = ["birth", "wedding", "farewell", "start", "other"] as const;
export type Tag = (typeof TAGS)[number];
// Keys for t(): "#tag" keeps them apart from the same words elsewhere ("其他" as a report reason).
export const TAG_NAMES: Record<Tag, string> = { birth: "出生#tag", wedding: "结婚#tag", farewell: "告别#tag", start: "开始#tag", other: "其他#tag" };

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

/** Encrypt a letter: base64 of iv || ciphertext, the key as base64url, and the ciphertext's sha256. */
export async function encryptLetter(text: string): Promise<{ ciphertext: string; key: string; fingerprint: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)));
  const all = new Uint8Array(iv.length + sealed.length);
  all.set(iv);
  all.set(sealed, iv.length);
  return { ciphertext: toB64(all), key: toB64url(raw), fingerprint: await sha256Hex(all) };
}

/** The letter back from encryptLetter's ciphertext and key; throws if the key is wrong. */
export async function decryptLetter(ciphertext: string, key: string): Promise<string> {
  const all = fromB64(ciphertext);
  const k = await crypto.subtle.importKey("raw", fromB64url(key) as BufferSource, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, k, all.slice(12));
  return new TextDecoder().decode(plain);
}

/** Whether the ciphertext still hashes to the fingerprint the sender signed. */
export async function fingerprintOk(ciphertext: string, fingerprint: string): Promise<boolean> {
  return (await sha256Hex(fromB64(ciphertext))) === fingerprint;
}
