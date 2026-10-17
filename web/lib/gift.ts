// 礼物: bitcoin sent with a 时间胶囊, locked by Bitcoin itself until block H (api/gift.py has the
// whole design). Everything here runs in the browser and holds no state: the gift's Taproot address
// and its spending paths, the ord inscription (commit and reveal) that carries the encrypted letter
// in its metadata into the gift's own UTXO, showing an envelope, the sweep a recipient signs after H, the 2-of-2 split of the letter's
// key, and the 时间锁 card's packed text. Test networks only; there is no mainnet here.
//
// The gift address: internal key = BIP-341's NUMS point (no key path), leaves
//   1. <H> OP_CHECKLOCKTIMEVERIFY OP_DROP <recipient> OP_CHECKSIG
//   2. <H + 262800> OP_CHECKLOCKTIMEVERIFY OP_DROP <sender> OP_CHECKSIG   (the refund; optional)
// Must match taproot_address in api/gift.py; lib/gift.test.ts and tests/test_gift.py share vectors.

import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64urlnopad, hex, utf8 } from "@scure/base";
import * as btc from "@scure/btc-signer";

export const GIFT_TIERS = [50_000, 100_000, 200_000, 300_000, 500_000] as const;
export const GIFT_MIN = 50_000;
export const REFUND_BLOCKS = 262_800; // about five years of blocks after H
export const NETWORKS = ["signet", "testnet", "testnet4"] as const;
export type GiftNetwork = (typeof NETWORKS)[number];
export const NETWORK_NAMES: Record<GiftNetwork, string> = { signet: "Signet", testnet: "Testnet3", testnet4: "Testnet4" };
/** A capsule's content type: a JSON header line, then the ciphertexts' bytes. It names the body in
 * the inscription's metadata (letterMetadata); letters inscribed before that had it as their content. */
export const CONTENT_TYPE = "application/x-unimap-capsule";
const TEST = btc.TEST_NETWORK; // signet, testnet3 and testnet4 all use tb / m,n / 2
const OPTS = { allowUnknownOutputs: true, allowUnknownInputs: true, disableScriptCheck: true };
const MAX_PUSH = 520;

export const isGiftNetwork = (n: unknown): n is GiftNetwork => typeof n === "string" && (NETWORKS as readonly string[]).includes(n);
/** A test-network address of a kind this page can pay (tb1…, or a testnet base58 one). */
export const isTestAddress = (a: string) => /^(tb1[02-9ac-hj-np-z]{8,87}|[mn2][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a.trim());

// ---- keys --------------------------------------------------------------------------------

/** The NUMS point of BIP-341: nobody knows a private key for it, so the gift has no key path. */
export const NUMS = btc.taprootNumsKey();

/** A fresh secret key (for the 礼物钥匙 and the reveal's one-time key). */
export const newSecret = (): Uint8Array => schnorr.utils.randomSecretKey();
export const xonlyOf = (secret: Uint8Array): Uint8Array => schnorr.getPublicKey(secret);

/** An x-only key from 64 hex, or a 66-hex compressed key (its prefix dropped); null if not a curve point. */
export function parseXonly(input: string | null | undefined): Uint8Array | null {
  let s = (input ?? "").trim().toLowerCase();
  if (s.length === 66 && (s.startsWith("02") || s.startsWith("03"))) s = s.slice(2);
  if (!/^[0-9a-f]{64}$/.test(s)) return null;
  try {
    secp256k1.Point.fromHex("02" + s);
    return hex.decode(s);
  } catch {
    return null;
  }
}

/** Split a 32-byte key into two halves that only open it together (xor): one for unimap, one for the 时间锁. */
export function splitKey(key: Uint8Array, server = crypto.getRandomValues(new Uint8Array(32))): { server: Uint8Array; recipient: Uint8Array } {
  if (key.length !== 32 || server.length !== 32) throw new Error("a 32-byte key");
  return { server, recipient: key.map((b, i) => b ^ server[i]) };
}
export const joinKey = (a: Uint8Array, b: Uint8Array): Uint8Array => a.map((x, i) => x ^ b[i]);
export const b64url = { encode: (b: Uint8Array) => base64urlnopad.encode(b), decode: (s: string) => base64urlnopad.decode(s) };

// ---- the gift address --------------------------------------------------------------------

export type GiftKeys = { height: number; recipient: Uint8Array; sender: Uint8Array | null; refund: boolean };

/** <height> OP_CHECKLOCKTIMEVERIFY OP_DROP <xonly> OP_CHECKSIG */
export const lockLeaf = (height: number, xonly: Uint8Array): Uint8Array => btc.Script.encode([height, "CHECKLOCKTIMEVERIFY", "DROP", xonly, "CHECKSIG"]);

/** The gift's leaf scripts: the recipient's, then the refund's when it is on. */
export function giftLeaves(g: GiftKeys): Uint8Array[] {
  if (g.refund && !g.sender) throw new Error("the refund leaf needs the sender's key");
  return g.refund ? [lockLeaf(g.height, g.recipient), lockLeaf(g.height + REFUND_BLOCKS, g.sender!)] : [lockLeaf(g.height, g.recipient)];
}

/** The gift's Taproot output: its address, scriptPubKey, and the leaves with their control blocks. */
export function giftTaproot(g: GiftKeys) {
  const leaves = giftLeaves(g);
  const tree = leaves.length === 1 ? { script: leaves[0] } : leaves.map((script) => ({ script }));
  return btc.p2tr(NUMS, tree, TEST, true);
}

/** Why an amount can't be a gift, or null: whole sats, at least 50,000, at most max. */
export function amountProblem(sats: number, max: number): "min" | "max" | "whole" | null {
  if (!Number.isInteger(sats)) return "whole";
  if (sats < GIFT_MIN) return "min";
  return sats > max ? "max" : null;
}

/** The line a gift adds to the capsule's signed text. Must match gift_line in api/gift.py. */
export const giftLine = (g: { sats: number; address: string; height: number; network: string }) =>
  `gift: ${g.sats} sats to ${g.address} unlocking at block ${g.height} on ${g.network}`;

/** The line an inscribed letter without a gift (上链的信) adds to the signed text. Must match letter_line in api/gift.py. */
export const letterLine = (l: { network: string; drand_round: number }) => `inscribed: on ${l.network}, key timelocked to drand round ${l.drand_round}`;

/** What the reveal of a letter without a gift sends on: the inscribed sat's output (api/gift.py POSTAGE). */
export const POSTAGE = 546;

// ---- the inscription ---------------------------------------------------------------------

/** What is inscribed: who it's for in no way at all; only the network, H, the drand round and the
 * timelock-encrypted key in a JSON line, then the letter's and photo's ciphertexts (iv || AES-GCM). */
export type GiftContent = { net: GiftNetwork; h: number; round: number; tlock: string; fingerprint: string; letter: Uint8Array; photo: Uint8Array | null };
type Header = { p: "unimap-capsule"; v: 1; net: GiftNetwork; h: number; round: number; tlock: string; fingerprint: string; letter: number; photo: number };

export function encodeContent(c: GiftContent): Uint8Array {
  const head: Header = { p: "unimap-capsule", v: 1, net: c.net, h: c.h, round: c.round, tlock: c.tlock, fingerprint: c.fingerprint, letter: c.letter.length, photo: c.photo?.length ?? 0 };
  const line = utf8.decode(JSON.stringify(head) + "\n");
  const all = new Uint8Array(line.length + c.letter.length + (c.photo?.length ?? 0));
  all.set(line);
  all.set(c.letter, line.length);
  if (c.photo) all.set(c.photo, line.length + c.letter.length);
  return all;
}

export function decodeContent(body: Uint8Array): GiftContent | null {
  const nl = body.indexOf(10);
  if (nl < 0) return null;
  try {
    const h = JSON.parse(utf8.encode(body.slice(0, nl))) as Header;
    if (h.p !== "unimap-capsule" || h.v !== 1 || !isGiftNetwork(h.net) || body.length !== nl + 1 + h.letter + h.photo) return null;
    const letter = body.slice(nl + 1, nl + 1 + h.letter);
    return { net: h.net, h: h.h, round: h.round, tlock: h.tlock, fingerprint: h.fingerprint, letter, photo: h.photo ? body.slice(nl + 1 + h.letter) : null };
  } catch {
    return null;
  }
}

// ---- the envelope a wallet shows ---------------------------------------------------------
// The capsule's bytes aren't the inscription's content, which wallets and ordinals.com would show
// as an unknown file: they ride in its metadata (ord tag 5, CBOR, in 520-byte pushes), and what is
// shown is an envelope. Either the shared envelope image the operator inscribed once per network
// (CAPSULE_ENVELOPE_INSCRIPTION, web/scripts/inscribe-envelope.mjs), by ord's delegate tag (11), with
// no content of the letter's own; or, with none set, a small SVG of a sealed envelope as the
// inscription's own content, naming only the block it opens at (envelopeSvg). Must match api/gift.py.
//
// The envelope, byte for byte (each tag a 1-byte push, never an OP_n):
//   <key> OP_CHECKSIG OP_0 OP_IF "ord"
//     [01 "image/svg+xml"]                    the fallback only
//     05 <metadata chunk> 05 <chunk> ...      cborEncode({ t: CONTENT_TYPE, v: 1, b: <encodeContent body> })
//     [0b <delegate id>]                      the shared envelope only: txid reversed, index LE trimmed
//     [OP_0 <svg in 520-byte pushes>]         the fallback only
//   OP_ENDIF
// Letters inscribed before this (no metadata: content type CONTENT_TYPE, the body as content) are
// still read (capsuleContent), and a draft saved without a face is still built that way (lib/giftseal.ts).

/** What an inscribed letter shows: the shared envelope inscription (by delegate), or its own SVG
 * saying the block it opens at. */
export type Face = { delegate: string } | { opens: number };
export const SVG_TYPE = "image/svg+xml";
export const INSCRIPTION_ID = /^[0-9a-f]{64}i\d+$/;

/** The fallback envelope: a sealed envelope and "Opens at block N", nothing else (no names, no
 * letter). About 700 bytes. Must match envelope_svg in api/gift.py byte for byte. */
export const envelopeSvg = (height: number): Uint8Array =>
  utf8.decode(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">' +
      '<rect width="300" height="200" rx="6" fill="#f3eee4"/>' +
      '<path d="M0 0L150 112L300 0M0 200L120 90M300 200L180 90" fill="none" stroke="#d8d0c2" stroke-width="1.5"/>' +
      '<g transform="rotate(-6 150 100)"><circle cx="150" cy="100" r="28" fill="#b8352a"/>' +
      '<circle cx="150" cy="100" r="22" fill="none" stroke="#f3eee4" stroke-width="1.2" opacity=".85"/>' +
      '<text x="150" y="107" text-anchor="middle" font-family="serif" font-weight="700" font-size="19" fill="#f3eee4">封</text></g>' +
      `<text x="150" y="182" text-anchor="middle" font-family="monospace" font-size="11" fill="#6b655c">Opens at block ${height}</text></svg>`,
  );

/** An inscription id as ord's delegate (and parent) tag holds it: the txid's 32 bytes in internal
 * order (reversed from how it is written), then the index little-endian with trailing zeros dropped. */
export function delegateBytes(id: string): Uint8Array {
  if (!INSCRIPTION_ID.test(id)) throw new Error("not an inscription id");
  const [txid, index] = id.split("i");
  let n = Number(index);
  if (!Number.isSafeInteger(n) || n > 0xffffffff) throw new Error("not an inscription id");
  const idx: number[] = [];
  for (let i = 0; i < 4; i++, n = Math.floor(n / 256)) idx.push(n % 256);
  while (idx.length && idx[idx.length - 1] === 0) idx.pop();
  return new Uint8Array([...hex.decode(txid).reverse(), ...idx]);
}

/** delegateBytes undone; null if the bytes can't be an id. */
export function delegateId(b: Uint8Array): string | null {
  if (b.length < 32 || b.length > 36) return null;
  let n = 0;
  for (let i = b.length - 1; i >= 32; i--) n = n * 256 + b[i];
  return `${hex.encode(b.slice(0, 32).reverse())}i${n}`;
}

// ---- CBOR, just what the metadata needs (RFC 8949: unsigned integers, bytes, text, arrays, maps) ----

export type Cbor = number | string | Uint8Array | Cbor[] | { [key: string]: Cbor };

function cborHead(major: number, n: number): number[] {
  const m = major << 5;
  if (n < 24) return [m | n];
  if (n < 0x100) return [m | 24, n];
  if (n < 0x10000) return [m | 25, n >> 8, n & 0xff];
  if (n <= 0xffffffff) return [m | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  throw new Error("too large for this CBOR");
}

export function cborEncode(v: Cbor): Uint8Array {
  const parts: Uint8Array[] = [];
  const put = (x: Cbor) => {
    if (typeof x === "number") {
      if (!Number.isSafeInteger(x) || x < 0) throw new Error("only unsigned integers");
      parts.push(new Uint8Array(cborHead(0, x)));
    } else if (typeof x === "string" || x instanceof Uint8Array) {
      const b = typeof x === "string" ? utf8.decode(x) : x;
      parts.push(new Uint8Array(cborHead(typeof x === "string" ? 3 : 2, b.length)), b);
    } else if (Array.isArray(x)) {
      parts.push(new Uint8Array(cborHead(4, x.length)));
      x.forEach(put);
    } else {
      const keys = Object.keys(x);
      parts.push(new Uint8Array(cborHead(5, keys.length)));
      for (const k of keys) (put(k), put(x[k]));
    }
  };
  put(v);
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (all.set(p, at), at + p.length), 0);
  return all;
}

/** The one CBOR item that is the whole of b, of the kinds cborEncode writes (map keys text); throws otherwise. */
export function cborDecode(b: Uint8Array): Cbor {
  let at = 0;
  const need = (n: number) => {
    if (at + n > b.length) throw new Error("CBOR cut short");
  };
  const item = (depth: number): Cbor => {
    if (depth > 16) throw new Error("CBOR too deep");
    need(1);
    const first = b[at++], major = first >> 5, info = first & 31;
    let n = info;
    if (info >= 24) {
      if (info > 26) throw new Error("CBOR this reader doesn't take");
      const len = 1 << (info - 24);
      need(len);
      n = 0;
      for (let i = 0; i < len; i++) n = n * 256 + b[at++];
    }
    if (major === 0) return n;
    if (major === 2 || major === 3) {
      need(n);
      const s = b.slice(at, (at += n));
      return major === 2 ? s : new TextDecoder("utf-8", { fatal: true }).decode(s);
    }
    if (major === 4) return Array.from({ length: n }, () => item(depth + 1));
    if (major === 5) {
      const m: { [key: string]: Cbor } = {};
      for (let i = 0; i < n; i++) {
        const k = item(depth + 1);
        if (typeof k !== "string") throw new Error("CBOR map keys are text here");
        m[k] = item(depth + 1);
      }
      return m;
    }
    throw new Error("CBOR this reader doesn't take");
  };
  const v = item(0);
  if (at !== b.length) throw new Error("CBOR has bytes after it");
  return v;
}

/** The letter's metadata: the capsule's body (encodeContent) under its content type. */
export const letterMetadata = (body: Uint8Array): Uint8Array => cborEncode({ t: CONTENT_TYPE, v: 1, b: body });

const chunked = (b: Uint8Array): Uint8Array[] => {
  const out: Uint8Array[] = [];
  for (let i = 0; i < b.length; i += MAX_PUSH) out.push(b.slice(i, i + MAX_PUSH));
  return out;
};
const tag = (n: number) => new Uint8Array([n]); // a 1-byte push, as ord writes a tag

/** The ord envelope: <key> OP_CHECKSIG OP_FALSE OP_IF "ord" 01 <content type> OP_0 <body in 520-byte pushes> OP_ENDIF.
 * A letter inscribed before metadata is this, with CONTENT_TYPE and the capsule's body. */
export function inscriptionScript(xonly: Uint8Array, contentType: string, body: Uint8Array): Uint8Array {
  return btc.Script.encode([xonly, "CHECKSIG", "OP_0", "IF", utf8.decode("ord"), tag(1), utf8.decode(contentType), "OP_0", ...chunked(body), "ENDIF"]);
}

/** A letter's envelope: the capsule's body in the metadata, and the face it shows (see above). */
export function letterScript(xonly: Uint8Array, body: Uint8Array, face: Face): Uint8Array {
  const meta = chunked(letterMetadata(body)).flatMap((c) => [tag(5), c]);
  const fields =
    "delegate" in face
      ? [...meta, tag(11), delegateBytes(face.delegate)]
      : [tag(1), utf8.decode(SVG_TYPE), ...meta, "OP_0" as const, ...chunked(envelopeSvg(face.opens))];
  return btc.Script.encode([xonly, "CHECKSIG", "OP_0", "IF", utf8.decode("ord"), ...fields, "ENDIF"]);
}

export type Inscription = { contentType: string; body: Uint8Array; metadata: Uint8Array | null; delegate: string | null };

/** The first ord envelope in a tapscript: its content type, body, metadata (tag 5's pushes joined)
 * and delegate; null if there is none. */
export function parseInscription(script: Uint8Array): Inscription | null {
  let ops: (string | number | Uint8Array)[];
  try {
    ops = btc.Script.decode(script) as (string | number | Uint8Array)[];
  } catch {
    return null;
  }
  const isZero = (op: unknown) => op === 0 || op === "OP_0";
  const eq = (x: unknown, s: string) => x instanceof Uint8Array && utf8.encode(x) === s;
  const tagOf = (op: unknown) => (op instanceof Uint8Array && op.length === 1 ? op[0] : typeof op === "number" && op >= 1 && op <= 16 ? op : null);
  const join = (parts: Uint8Array[]) => {
    const all = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
    parts.reduce((at, b) => (all.set(b, at), at + b.length), 0);
    return all;
  };
  for (let i = 0; i + 2 < ops.length; i++) {
    if (!isZero(ops[i]) || ops[i + 1] !== "IF" || !eq(ops[i + 2], "ord")) continue;
    let contentType = "", delegate: string | null = null;
    const body: Uint8Array[] = [], meta: Uint8Array[] = [];
    for (let j = i + 3; j < ops.length && ops[j] !== "ENDIF"; j += 2) {
      if (isZero(ops[j])) {
        for (j++; j < ops.length && ops[j] instanceof Uint8Array; j++) body.push(ops[j] as Uint8Array);
        break;
      }
      const v = ops[j + 1], value = v instanceof Uint8Array ? v : isZero(v) ? new Uint8Array(0) : null;
      if (value == null) break;
      const k = tagOf(ops[j]);
      if (k === 1) contentType = utf8.encode(value);
      else if (k === 5) meta.push(value);
      else if (k === 11) delegate = delegateId(value);
    }
    return { contentType, body: join(body), metadata: meta.length ? join(meta) : null, delegate };
  }
  return null;
}

/** The capsule a letter's inscription carries: from its metadata, or (a letter inscribed before
 * metadata) from its content; null if it carries none. */
export function capsuleContent(ins: Inscription | null): GiftContent | null {
  if (!ins) return null;
  if (ins.metadata) {
    try {
      const m = cborDecode(ins.metadata) as Record<string, Cbor>;
      if (m && typeof m === "object" && m.t === CONTENT_TYPE && m.v === 1 && m.b instanceof Uint8Array) return decodeContent(m.b);
    } catch {}
    return null;
  }
  return ins.contentType === CONTENT_TYPE ? decodeContent(ins.body) : null;
}

/** As api/gift.py check_inscription: why a reveal's inscription isn't this capsule's letter, or null.
 * The letter's and photo's bytes must hash to the fingerprint the sender signed and its block be
 * the capsule's; it must show one of envelopes (the shared envelope's ids, by delegate) or the
 * fallback SVG for that block. A letter inscribed before metadata is taken with no envelope. */
export function inscriptionProblem(ins: Inscription | null, o: { fingerprint: string; height: number; envelopes: string[] }): string | null {
  const c = capsuleContent(ins);
  if (!ins || !c) return "the reveal doesn't carry this capsule's letter";
  const both = c.photo ? new Uint8Array([...c.letter, ...c.photo]) : c.letter;
  if (hex.encode(sha256(both)) !== o.fingerprint || c.h !== o.height) return "the reveal doesn't carry this capsule's letter";
  if (!ins.metadata) return null;
  const ok = ins.delegate != null ? o.envelopes.includes(ins.delegate) : ins.contentType === SVG_TYPE && hex.encode(ins.body) === hex.encode(envelopeSvg(o.height));
  return ok ? null : "the reveal's envelope isn't this server's";
}

/** The commit address: the reveal's one-time key, with the envelope as its one leaf. */
export function commitTaproot(revealSecret: Uint8Array, envelope: Uint8Array) {
  return btc.p2tr(xonlyOf(revealSecret), { script: envelope }, TEST, true);
}

export type Outpoint = { txid: string; vout: number; value: number };

/** Sign a script-path input with secret and write its witness (sig, script, control block) by hand,
 * since these leaves aren't kinds the library finalizes itself. */
function signLeaf(tx: btc.Transaction, idx: number, secret: Uint8Array) {
  tx.signIdx(secret, idx);
  const input = tx.getInput(idx);
  const [cb, scriptVer] = input.tapLeafScript![0];
  const sig = input.tapScriptSig![0][1];
  tx.updateInput(idx, { finalScriptWitness: [sig, scriptVer.slice(0, -1), btc.TaprootControlBlock.encode(cb)] }, true);
}

/** The reveal: spends the commit through the envelope leaf and pays giftSats to the gift address
 * as output 0, so the inscribed sat lands in the gift. Signed here with the one-time key. */
export function buildReveal(o: { secret: Uint8Array; envelope: Uint8Array; commit: Outpoint; giftAddress: string; giftSats: number }) {
  const c = commitTaproot(o.secret, o.envelope);
  const tx = new btc.Transaction(OPTS);
  tx.addInput({ txid: o.commit.txid, index: o.commit.vout, witnessUtxo: { script: c.script, amount: BigInt(o.commit.value) }, tapLeafScript: c.tapLeafScript });
  // No tapInternalKey: with it the library would sign the key path (the same key) and the envelope would never be revealed.
  tx.addOutputAddress(o.giftAddress, BigInt(o.giftSats), TEST);
  signLeaf(tx, 0, o.secret);
  return { hex: tx.hex, txid: tx.id, vsize: tx.vsize };
}

/** The reveal's fee at feeRate sats/vB: its size doesn't depend on the commit's txid, so a dummy one measures it. */
export function revealFee(secret: Uint8Array, envelope: Uint8Array, giftAddress: string, giftSats: number, feeRate: number): number {
  const { vsize } = buildReveal({ secret, envelope, giftAddress, giftSats, commit: { txid: "00".repeat(32), vout: 0, value: giftSats + 1_000_000 } });
  return Math.ceil(vsize * feeRate);
}

// ---- what an inscription costs -----------------------------------------------------------
// Before anything is signed, the write page shows the network fee: vbytes × fee rate. The envelope
// sits in the reveal's witness, which weighs a quarter, so the reveal is about metadata bytes / 4
// plus its fixed parts and its face (the delegate's id, or the fallback SVG); the commit is an
// ordinary payment. Both are worked out byte for byte here, as buildReveal and commitPsbt build
// them (lib/gift.test.ts checks against buildReveal with letterScript).

/** The inscription's JSON header line (encodeContent), its timelock included: ~800 bytes. */
export const HEADER_BYTES = 800;
/** The commit: one wallet input (P2WPKH, the larger kind), the commit output and change. */
export const COMMIT_VBYTES = 11 + 43 * 2 + 68;

const pushLen = (n: number) => (n <= 75 ? 1 : n <= 255 ? 2 : 3) + n;
const varintLen = (n: number) => (n < 0xfd ? 1 : n <= 0xffff ? 3 : 5);
const cborHeadLen = (n: number) => (n < 24 ? 1 : n < 0x100 ? 2 : n < 0x10000 ? 3 : 5);
/** n bytes in 520-byte pushes, each after a 1-byte tag push when tagged (2 bytes more a push). */
function pushesLength(n: number, tagged: boolean): number {
  let all = 0;
  for (let i = 0; i < n; i += MAX_PUSH) all += (tagged ? 2 : 0) + pushLen(Math.min(MAX_PUSH, n - i));
  return all;
}

/** letterMetadata's length for a body of n bytes: a map of three, "t" (the content type), "v" (1), "b" (the body). */
export const metadataLength = (n: number) => 1 + 2 + cborHeadLen(CONTENT_TYPE.length) + CONTENT_TYPE.length + 2 + 1 + 2 + cborHeadLen(n) + n;

/** The envelope's length for a body of n bytes (letterScript with face). */
export function envelopeLength(n: number, face: Face): number {
  const meta = pushesLength(metadataLength(n), true);
  const shown = "delegate" in face ? 2 + pushLen(delegateBytes(face.delegate).length) : 2 + pushLen(SVG_TYPE.length) + 1 + pushesLength(envelopeSvg(face.opens).length, false);
  return 33 + 1 + 1 + 1 + 4 + meta + shown + 1;
}

/** The reveal's vsize for a body of n bytes: one script-path input, one P2TR output (43 bytes). */
export function revealVbytes(n: number, face: Face): number {
  const env = envelopeLength(n, face);
  const base = 4 + 1 + 41 + 1 + 43 + 4;
  const witness = 2 + 1 + 65 + varintLen(env) + env + 34;
  return Math.ceil((base * 4 + witness) / 4);
}

/** The inscription's body for a letter of letterBytes (UTF-8) and a photo of photoBytes (0: none):
 * the header, then each as iv || AES-GCM (12 + 16 bytes more). */
export const bodyBytes = (letterBytes: number, photoBytes: number) => HEADER_BYTES + 28 + letterBytes + (photoBytes > 0 ? 28 + photoBytes : 0);

/** Commit and reveal together, in vbytes, for such a letter showing face. */
export const inscriptionVbytes = (letterBytes: number, photoBytes: number, face: Face) => COMMIT_VBYTES + revealVbytes(bodyBytes(letterBytes, photoBytes), face);

// ---- spending the gift -------------------------------------------------------------------

/** The input that spends the gift through one leaf: 0 the recipient's (from H), 1 the refund. */
function giftInput(g: GiftKeys, utxo: Outpoint, leaf: 0 | 1) {
  const t = giftTaproot(g);
  const script = giftLeaves(g)[leaf];
  const entry = (t.tapLeafScript ?? []).find(([, s]) => hex.encode(s.slice(0, -1)) === hex.encode(script));
  if (!entry) throw new Error("no such leaf");
  return { txid: utxo.txid, index: utxo.vout, sequence: 0xfffffffe, witnessUtxo: { script: t.script, amount: BigInt(utxo.value) }, tapLeafScript: [entry] };
}

const lockOf = (g: GiftKeys, leaf: 0 | 1) => (leaf === 0 ? g.height : g.height + REFUND_BLOCKS);
const SWEEP_VBYTES = 154; // one script-path input (sig, ~40-byte leaf, 33/65-byte control block) and one output

/** A sweep's fee at feeRate sats/vB. */
export const sweepFee = (feeRate: number) => Math.ceil(SWEEP_VBYTES * feeRate);

/** The sweep: every sat of the gift (less the fee) to `to`, nLockTime at the leaf's height, signed
 * with the 礼物钥匙 (or the refund key). A node takes it once the tip is at or past that height. */
export function buildSweep(o: { keys: GiftKeys; utxo: Outpoint; secret: Uint8Array; to: string; feeRate: number; leaf?: 0 | 1 }) {
  const leaf = o.leaf ?? 0;
  const fee = sweepFee(o.feeRate);
  if (o.utxo.value - fee < 330) throw new Error("the gift is too small for this fee");
  const tx = new btc.Transaction({ ...OPTS, lockTime: lockOf(o.keys, leaf) });
  tx.addInput(giftInput(o.keys, o.utxo, leaf));
  tx.addOutputAddress(o.to.trim(), BigInt(o.utxo.value - fee), TEST);
  signLeaf(tx, 0, o.secret);
  return { hex: tx.hex, txid: tx.id, fee };
}

/** The same sweep unsigned, as a PSBT (base64) for a wallet that holds the recipient's key. */
export function sweepPsbt(o: { keys: GiftKeys; utxo: Outpoint; to: string; feeRate: number; leaf?: 0 | 1 }): string {
  const leaf = o.leaf ?? 0;
  const tx = new btc.Transaction({ ...OPTS, lockTime: lockOf(o.keys, leaf) });
  tx.addInput(giftInput(o.keys, o.utxo, leaf));
  tx.addOutputAddress(o.to.trim(), BigInt(o.utxo.value - sweepFee(o.feeRate)), TEST);
  return bytesToB64(tx.toPSBT());
}

/** A PSBT a wallet signed (sweepPsbt's), finished: its script-path witness written, ready to broadcast. */
export function finishSweep(signedB64: string) {
  const tx = btc.Transaction.fromPSBT(b64ToBytes(signedB64), OPTS);
  const input = tx.getInput(0);
  if (!input.finalScriptWitness) {
    const sig = input.tapScriptSig?.[0]?.[1];
    if (!sig) throw new Error("the wallet didn't sign the gift");
    const [cb, scriptVer] = input.tapLeafScript![0];
    tx.updateInput(0, { finalScriptWitness: [sig, scriptVer.slice(0, -1), btc.TaprootControlBlock.encode(cb)] }, true);
  }
  return { hex: tx.hex, txid: tx.id };
}

const bytesToB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ---- the commit, funded by the sender's wallet -------------------------------------------

export type WalletUtxo = Outpoint & { address: string; publicKey: string | null };
const INPUT_VBYTES: Record<string, number> = { tr: 58, wpkh: 68, sh: 91 };

function spendInfo(address: string, publicKey: string | null) {
  const out = btc.Address(TEST).decode(address);
  const script = btc.OutScript.encode(out);
  const key = publicKey ? hex.decode(publicKey) : null;
  if (out.type === "tr") return { kind: "tr", script, extra: key ? { tapInternalKey: key.length === 33 ? key.slice(1) : key } : {} };
  if (out.type === "wpkh") return { kind: "wpkh", script, extra: {} };
  if (out.type === "sh" && key) return { kind: "sh", script, extra: { redeemScript: btc.p2wpkh(key, TEST).script } };
  throw new Error("this wallet's address type can't fund a gift here");
}

/** The commit PSBT (base64): wallet coins in, the commit address (gift + reveal fee) out, change back.
 * Coins are picked largest first; the fee is at feeRate sats/vB. */
export function commitPsbt(o: { utxos: WalletUtxo[]; commitAddress: string; amount: number; change: string; feeRate: number }) {
  const tx = new btc.Transaction(OPTS);
  let total = 0, vbytes = 11 + 43 * 2;
  const used: WalletUtxo[] = [];
  for (const u of [...o.utxos].sort((a, b) => b.value - a.value)) {
    const info = spendInfo(u.address, u.publicKey);
    tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: info.script, amount: BigInt(u.value) }, ...info.extra });
    used.push(u);
    total += u.value;
    vbytes += INPUT_VBYTES[info.kind];
    if (total >= o.amount + Math.ceil(vbytes * o.feeRate) + 330) break;
  }
  const fee = Math.ceil(vbytes * o.feeRate);
  if (total < o.amount + fee) throw new Error(`not enough coins: ${total} < ${o.amount + fee}`);
  tx.addOutputAddress(o.commitAddress, BigInt(o.amount), TEST);
  const change = total - o.amount - fee;
  if (change >= 330) tx.addOutputAddress(o.change, BigInt(change), TEST);
  return { psbt: bytesToB64(tx.toPSBT()), inputs: used, fee };
}

/** A commit PSBT the wallet signed, finalized (if the wallet didn't) into a transaction to broadcast. */
export function finishCommit(signedB64: string) {
  const tx = btc.Transaction.fromPSBT(b64ToBytes(signedB64), OPTS);
  tx.finalize();
  return { hex: tx.hex, txid: tx.id };
}

// ---- reading transactions ----------------------------------------------------------------

/** A raw transaction's id, inputs, outputs (with addresses) and locktime, and the envelope in input 0's witness if any. */
export function describeTx(rawHex: string) {
  const tx = btc.Transaction.fromRaw(hex.decode(rawHex), OPTS);
  const inputs = Array.from({ length: tx.inputsLength }, (_, i) => {
    const x = tx.getInput(i);
    return { txid: hex.encode(x.txid!), vout: x.index!, witness: x.finalScriptWitness ?? [] };
  });
  const outputs = Array.from({ length: tx.outputsLength }, (_, i) => {
    const o = tx.getOutput(i);
    let address: string | null = null;
    try {
      address = btc.Address(TEST).encode(btc.OutScript.decode(o.script!));
    } catch {}
    return { address, value: Number(o.amount) };
  });
  const w = inputs[0]?.witness ?? [];
  return { txid: tx.id, lockTime: tx.lockTime, inputs, outputs, inscription: w.length >= 3 ? parseInscription(w[w.length - 2]) : null };
}

// ---- 时间锁: what the recipient keeps ----------------------------------------------------

/** The 时间锁, packed into the card's QR and link (#g=…): everything the recipient needs, even
 * with unimap gone. gk (the 礼物钥匙) is there only when the gift is locked to a bearer key. */
export type Timelock = {
  v: 1;
  net: GiftNetwork;
  c: string; // the capsule's id on unimap
  to: string; // who it is for, as the sender wrote it
  h: number; // H
  a: number; // sats
  r: boolean; // the refund leaf is there
  rk: string; // recipient's x-only key, hex
  sk: string | null; // sender's x-only key, hex (refund)
  gk: string | null; // the 礼物钥匙, hex: whoever holds this card can claim from H
  b: string; // the recipient's half of the backup key, base64url
  d: number; // drand quicknet round of the timelock
  s: string; // who sealed it (their unimap address)
  t: string | null; // the reveal's txid: the inscription is <t>i0 and the gift is <t>:0
  ct: string | null; // the commit's txid
  live?: true; // sealed on the demo site in its 真实 Signet mode (lib/signet.ts): the chain is real signet, not the demo's
};

export const timelockKeys = (x: Timelock): GiftKeys => ({ height: x.h, refund: x.r, recipient: hex.decode(x.rk), sender: x.sk ? hex.decode(x.sk) : null });
export const timelockAddress = (x: Timelock) => giftTaproot(timelockKeys(x)).address!;

export function packTimelock(x: Timelock): string {
  return b64url.encode(utf8.decode(JSON.stringify(x)));
}

export function unpackTimelock(packed: string): Timelock | null {
  try {
    const x = JSON.parse(utf8.encode(b64url.decode(packed.trim()))) as Timelock;
    const hex64 = (s: unknown) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
    if (x.v !== 1 || !isGiftNetwork(x.net) || !Number.isInteger(x.h) || !Number.isInteger(x.a) || !hex64(x.rk) || (x.r && !hex64(x.sk))) return null;
    if ((x.gk != null && !hex64(x.gk)) || (x.t != null && !hex64(x.t)) || typeof x.b !== "string" || b64url.decode(x.b).length !== 32) return null;
    if (x.gk != null && hex.encode(xonlyOf(hex.decode(x.gk))) !== x.rk) return null; // the key must be the leaf's
    if (x.live !== undefined && (x.live !== true || x.net !== "signet")) return null;
    return x;
  } catch {
    return null;
  }
}

/** The 时间锁 from a link's fragment: #g=<packed>. */
export function timelockFromHash(hash: string): Timelock | null {
  const m = hash.replace(/^#/, "").match(/(?:^|&)g=([A-Za-z0-9_-]+)(?:&|$)/);
  return m ? unpackTimelock(m[1]) : null;
}
