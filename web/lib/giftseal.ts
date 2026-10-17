// 礼物, from the write page's side: everything made in the browser when a capsule with a gift is
// sealed (lib/gift.ts has the pieces), and the draft kept in localStorage until the gift is funded,
// so a reload between paying 封存 and locking the sats loses nothing. 上链的信 (a letter inscribed
// without a gift, api/capsule.py onchain()) is made the same way and funded by the same GiftFund:
// its reveal sends POSTAGE to the recipient's address, or back to the sender's own.

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
  inscriptionVbytes,
  isTestAddress,
  letterLine,
  newSecret,
  POSTAGE,
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

/** A gift (or an inscribed letter) sealed but maybe not yet funded: the reveal's one-time key and the
 * inscription's body stay in this browser until both transactions are out. */
export type GiftDraft = {
  capsuleId: string;
  network: GiftNetwork;
  esplora: string;
  address: string; // the gift address; a letter's postage address, or "" for the sender's own (their wallet's, when funding)
  sats: number; // the gift; a letter's postage
  revealSecret: string; // hex
  body: string; // base64url of the inscription's content
  timelock?: Timelock; // a gift's 时间锁
  letter?: { half: string; live?: true }; // an inscribed letter: the link's half of its key (base64url); live: 真实 Signet
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
  const { tlock, server, half, revealSecret, body } = await sealKey(r.network, height, round, o);
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

/** The key's timelock and split, a one-time reveal key and the inscription's body: what a gift and an
 * inscribed letter both need. */
async function sealKey(net: GiftNetwork, height: number, round: number, o: { key: string; ciphertext: string; photo: string | null; fingerprint: string }) {
  const letterKey = b64url.decode(o.key);
  const tlock = await tlockEncrypt(round, letterKey);
  const { server, recipient: half } = splitKey(letterKey);
  const body = encodeContent({ net, h: height, round, tlock, fingerprint: o.fingerprint, letter: b64ToBytes(o.ciphertext), photo: o.photo ? b64ToBytes(o.photo) : null });
  return { tlock, server, half, revealSecret: newSecret(), body };
}

/** The recipient's label as an address the reveal can pay (a test network's P2WPKH or P2TR, as
 * api/gift.py check_letter takes), else null: the postage then goes back to the sender. */
export function postageAddress(recipient: string): string | null {
  const a = recipient.trim().toLowerCase();
  return isTestAddress(a) && /^tb1(q[02-9ac-hj-np-z]{38}|p[02-9ac-hj-np-z]{58})$/.test(a) ? a : null;
}

/** Everything an inscribed letter without a gift needs at sealing time (上链的信): the gift network's
 * block at the opening time (written in the inscription), the key timelocked to drand's round at
 * the opening time and split in two, the postage address (the recipient's, when the label is an
 * address on the test network; else "", the sender's own when funding), and the inscription's body.
 * Returns what goes to the API (the server's half as the key, chain, the signed line), the link's
 * half, and a draft without its capsule id. */
export async function prepareLetter(o: { rules: GiftRules; key: string; ciphertext: string; photo: string | null; fingerprint: string; openAt: number; now: number; recipient: string }) {
  const r = o.rules;
  if (r.tip == null) throw new Error(t("现在看不到测试网的最新区块，稍后再试。"));
  const height = r.tip + blocksUntil(o.openAt, o.now, r.block_seconds);
  const round = roundAtOrAfter(o.openAt);
  const { tlock, server, half, revealSecret, body } = await sealKey(r.network, height, round, o);
  const address = postageAddress(o.recipient) ?? "";
  const chain = { network: r.network, height, drand_round: round, tlock, address: address || null, ...(r.live ? { live: true } : {}) }; // live: only the demo reads it
  return {
    serverHalf: b64url.encode(server),
    half: b64url.encode(half),
    chain,
    line: letterLine(chain),
    draft: { network: r.network, esplora: r.esplora, address, sats: POSTAGE, revealSecret: hex.encode(revealSecret), body: b64url.encode(body),
      letter: { half: b64url.encode(half), ...(r.live ? { live: true as const } : {}) } } satisfies Omit<GiftDraft, "capsuleId">,
  };
}

/** What inscribing a letter costs, before anything is signed: the network fee for commit and reveal
 * at feeRate sats/vB (vbytes from lib/gift.ts inscriptionVbytes: the witness counts a quarter), and
 * how much of it the photo is. letterBytes is the letter's UTF-8 length, photoBytes the shrunk photo's (0: none). */
export function letterCost(letterBytes: number, photoBytes: number, feeRate: number) {
  const vbytes = inscriptionVbytes(letterBytes, photoBytes);
  const photoVbytes = photoBytes > 0 ? vbytes - inscriptionVbytes(letterBytes, 0) : 0;
  return { vbytes, photoVbytes, fee: Math.ceil(vbytes * feeRate), photoFee: Math.ceil(photoVbytes * feeRate) };
}

/** The 时间锁's link: the page that shows it, with everything in the #fragment (never sent to a server). */
export const timelockLink = (origin: string, x: Timelock) => `${origin}/capsule/gift#g=${packTimelock(x)}`;
