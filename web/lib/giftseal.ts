// 礼物, from the write page's side: everything made in the browser when a capsule with a gift is
// sealed (lib/gift.ts has the pieces), and the draft kept in localStorage until the gift is funded,
// so a reload between paying 封存 and locking the sats loses nothing.

import { hex } from "@scure/base";

import type { GiftRules } from "./api";
import { timeAtHeight } from "./blocktime.ts";
import { blocksUntil } from "./capsule.ts";
import { roundAtOrAfter, tlockEncrypt } from "./drand.ts";
import {
  b64url,
  CONTENT_TYPE,
  encodeContent,
  giftLine,
  giftTaproot,
  inscriptionScript,
  newSecret,
  packTimelock,
  parseXonly,
  splitKey,
  type GiftNetwork,
  type Outpoint,
  type Timelock,
  xonlyOf,
} from "./gift.ts";
import { t } from "./i18n/index.ts";

/** What the sender picked on the write page. */
export type GiftChoice = { on: boolean; sats: number; custom: string; refund: boolean; recipientKey: string; senderKey: string };
export const NO_GIFT: GiftChoice = { on: false, sats: 100_000, custom: "", refund: true, recipientKey: "", senderKey: "" };

/** A gift sealed but maybe not yet funded: the reveal's one-time key and the inscription's body stay
 * in this browser until both transactions are out. */
export type GiftDraft = {
  capsuleId: string;
  network: GiftNetwork;
  esplora: string;
  address: string;
  sats: number;
  revealSecret: string; // hex
  body: string; // base64url of the inscription's content
  timelock: Timelock;
  commit?: Outpoint; // broadcast already
  reveal?: string; // its txid, broadcast already
  done?: boolean; // the txids reached unimap
};

const KEY = (id: string) => `unimap.gift.${id}`;
export function loadDraft(capsuleId: string): GiftDraft | null {
  try {
    const raw = localStorage.getItem(KEY(capsuleId));
    return raw ? (JSON.parse(raw) as GiftDraft) : null;
  } catch {
    return null;
  }
}
export function saveDraft(d: GiftDraft) {
  try {
    localStorage.setItem(KEY(d.capsuleId), JSON.stringify(d));
  } catch {}
}

export const envelopeOf = (d: GiftDraft) => inscriptionScript(xonlyOf(hex.decode(d.revealSecret)), CONTENT_TYPE, b64url.decode(d.body));

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The gift's amount from the choice: a tier, or the custom box when it has something in it. */
export const chosenSats = (c: GiftChoice) => (c.custom.trim() ? Number(c.custom.replace(/[,\s_]/g, "")) : c.sats);

/** Everything a gift needs at sealing time, from the letter already encrypted under key (base64url):
 * the gift's keys and address, H from the gift network's tip and the opening time, the letter key
 * timelocked to drand and split in two, and the inscription's body. Returns what goes to the API
 * (the server's half as the capsule's key, the gift fields, the signed line) and a draft without
 * its capsule id. Throws a message for the page if the choice can't be sealed. */
export async function prepareGift(o: {
  rules: GiftRules;
  choice: GiftChoice;
  walletKey: string | null; // the sender's wallet public key, for the refund leaf
  key: string; // the letter's AES key, base64url
  ciphertext: string; // base64
  photo: string | null; // base64
  fingerprint: string;
  openAt: number;
  now: number;
  recipient: string;
  author: string;
}) {
  const r = o.rules, c = o.choice;
  if (r.tip == null) throw new Error(t("现在看不到测试网的最新区块，稍后再试。"));
  const sats = chosenSats(c);
  if (!Number.isInteger(sats) || sats < r.min_sats) throw new Error(t("礼物至少 {n} 聪。", { n: r.min_sats.toLocaleString("en-US") }));
  if (sats > r.max_sats) throw new Error(t("测试网上的礼物最多 {n} 聪。", { n: r.max_sats.toLocaleString("en-US") }));
  let giftSecret: Uint8Array | null = null, recipientKey: Uint8Array;
  if (c.recipientKey.trim()) {
    const k = parseXonly(c.recipientKey);
    if (!k) throw new Error(t("收礼人的公钥不对：要 64 位（或 66 位）十六进制。"));
    recipientKey = k;
  } else {
    giftSecret = newSecret();
    recipientKey = xonlyOf(giftSecret);
  }
  let senderKey: Uint8Array | null = null;
  if (c.refund) {
    senderKey = parseXonly(c.senderKey.trim() || o.walletKey);
    if (!senderKey) throw new Error(t("退回需要你的公钥：钱包没有给出，填一个，或者关掉退回。"));
  }
  const height = r.tip + blocksUntil(o.openAt, o.now, r.block_seconds);
  const keys = { height, recipient: recipientKey, sender: senderKey, refund: c.refund };
  const address = giftTaproot(keys).address!;
  const round = roundAtOrAfter(timeAtHeight(height, r.tip, o.now, r.block_seconds));
  const letterKey = b64url.decode(o.key);
  const tlock = await tlockEncrypt(round, letterKey);
  const { server, recipient: half } = splitKey(letterKey);
  const revealSecret = newSecret();
  const body = encodeContent({ net: r.network, h: height, round, tlock, fingerprint: o.fingerprint, letter: b64ToBytes(o.ciphertext), photo: o.photo ? b64ToBytes(o.photo) : null });
  const timelock: Timelock = {
    v: 1, net: r.network, c: "", to: o.recipient, h: height, a: sats, r: c.refund, rk: hex.encode(recipientKey), sk: senderKey ? hex.encode(senderKey) : null,
    gk: giftSecret ? hex.encode(giftSecret) : null, b: b64url.encode(half), d: round, s: o.author, t: null, ct: null,
    ...(r.live ? { live: true as const } : {}),
  };
  const gift = {
    network: r.network, sats, height, refund: c.refund, recipient_key: hex.encode(recipientKey), sender_key: senderKey ? hex.encode(senderKey) : null,
    bearer: giftSecret != null, address, drand_round: round, tlock,
    ...(r.live ? { live: true } : {}), // only the demo's 真实 Signet sets it (lib/signet.ts); the API has no such field
  };
  return {
    serverHalf: b64url.encode(server),
    gift,
    line: giftLine({ sats, address, height, network: r.network }),
    draft: { network: r.network, esplora: r.esplora, address, sats, revealSecret: hex.encode(revealSecret), body: b64url.encode(body), timelock } satisfies Omit<GiftDraft, "capsuleId">,
  };
}

/** The 时间锁's link: the page that shows it, with everything in the #fragment (never sent to a server). */
export const timelockLink = (origin: string, x: Timelock) => `${origin}/capsule/gift#g=${packTimelock(x)}`;
