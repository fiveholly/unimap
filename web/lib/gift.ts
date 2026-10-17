// 礼物: bitcoin sent with a 时间胶囊, locked by Bitcoin itself until block H (api/gift.py has the
// whole design). Everything here runs in the browser and holds no state: the gift's Taproot address
// and its spending paths, the ord inscription (commit and reveal) that carries the encrypted letter
// into the gift's own UTXO, the sweep a recipient signs after H, the 2-of-2 split of the letter's
// key, and the 时间锁 card's packed text. Test networks only; there is no mainnet here.
//
// The gift address: internal key = BIP-341's NUMS point (no key path), leaves
//   1. <H> OP_CHECKLOCKTIMEVERIFY OP_DROP <recipient> OP_CHECKSIG
//   2. <H + 262800> OP_CHECKLOCKTIMEVERIFY OP_DROP <sender> OP_CHECKSIG   (the refund; optional)
// Must match taproot_address in api/gift.py; lib/gift.test.ts and tests/test_gift.py share vectors.

import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { base64urlnopad, hex, utf8 } from "@scure/base";
import * as btc from "@scure/btc-signer";

export const GIFT_TIERS = [50_000, 100_000, 200_000, 300_000, 500_000] as const;
export const GIFT_MIN = 50_000;
export const REFUND_BLOCKS = 262_800; // about five years of blocks after H
export const NETWORKS = ["signet", "testnet", "testnet4"] as const;
export type GiftNetwork = (typeof NETWORKS)[number];
export const NETWORK_NAMES: Record<GiftNetwork, string> = { signet: "Signet", testnet: "Testnet3", testnet4: "Testnet4" };
/** The ord envelope's content type for a capsule: a JSON header line, then the ciphertexts' bytes. */
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

/** The ord envelope: <key> OP_CHECKSIG OP_FALSE OP_IF "ord" 01 <content type> OP_0 <body in 520-byte pushes> OP_ENDIF */
export function inscriptionScript(xonly: Uint8Array, contentType: string, body: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < body.length; i += MAX_PUSH) chunks.push(body.slice(i, i + MAX_PUSH));
  return btc.Script.encode([xonly, "CHECKSIG", "OP_0", "IF", utf8.decode("ord"), new Uint8Array([1]), utf8.decode(contentType), "OP_0", ...chunks, "ENDIF"]);
}

/** The content type and body of the first ord envelope in a tapscript, or null. */
export function parseInscription(script: Uint8Array): { contentType: string; body: Uint8Array } | null {
  let ops: (string | number | Uint8Array)[];
  try {
    ops = btc.Script.decode(script) as (string | number | Uint8Array)[];
  } catch {
    return null;
  }
  const eq = (x: unknown, s: string) => x instanceof Uint8Array && utf8.encode(x) === s;
  for (let i = 0; i + 2 < ops.length; i++) {
    if (!(ops[i] === 0 || ops[i] === "OP_0") || ops[i + 1] !== "IF" || !eq(ops[i + 2], "ord")) continue;
    let contentType = "", j = i + 3;
    const body: Uint8Array[] = [];
    for (; j < ops.length && ops[j] !== "ENDIF"; j++) {
      const op = ops[j];
      const isOne = op === 1 || op === "OP_1" || (op instanceof Uint8Array && op.length === 1 && op[0] === 1);
      if (isOne && ops[j + 1] instanceof Uint8Array) contentType = utf8.encode(ops[++j] as Uint8Array);
      else if (op === 0 || op === "OP_0") {
        for (j++; j < ops.length && ops[j] instanceof Uint8Array; j++) body.push(ops[j] as Uint8Array);
        j--;
      } else if (op instanceof Uint8Array) j++; // another tag and its value
    }
    const all = new Uint8Array(body.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const b of body) (all.set(b, at), (at += b.length));
    return { contentType, body: all };
  }
  return null;
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
// sits in the reveal's witness, which weighs a quarter, so the reveal is about body bytes / 4 plus
// its fixed parts; the commit is an ordinary payment. Both are worked out byte for byte here, as
// buildReveal and commitPsbt build them (lib/gift.test.ts checks against buildReveal).

/** The inscription's JSON header line (encodeContent), its timelock included: ~800 bytes. */
export const HEADER_BYTES = 800;
/** The commit: one wallet input (P2WPKH, the larger kind), the commit output and change. */
export const COMMIT_VBYTES = 11 + 43 * 2 + 68;

const pushLen = (n: number) => (n <= 75 ? 1 : n <= 255 ? 2 : 3) + n;
const varintLen = (n: number) => (n < 0xfd ? 1 : n <= 0xffff ? 3 : 5);

/** The envelope's length for a body of n bytes (inscriptionScript, content type CONTENT_TYPE). */
export function envelopeLength(n: number, contentType = CONTENT_TYPE): number {
  let pushes = 0;
  for (let i = 0; i < n; i += MAX_PUSH) pushes += pushLen(Math.min(MAX_PUSH, n - i));
  return 33 + 1 + 1 + 1 + 4 + 2 + pushLen(contentType.length) + 1 + pushes + 1;
}

/** The reveal's vsize for a body of n bytes: one script-path input, one P2TR output (43 bytes). */
export function revealVbytes(n: number): number {
  const env = envelopeLength(n);
  const base = 4 + 1 + 41 + 1 + 43 + 4;
  const witness = 2 + 1 + 65 + varintLen(env) + env + 34;
  return Math.ceil((base * 4 + witness) / 4);
}

/** The inscription's body for a letter of letterBytes (UTF-8) and a photo of photoBytes (0: none):
 * the header, then each as iv || AES-GCM (12 + 16 bytes more). */
export const bodyBytes = (letterBytes: number, photoBytes: number) => HEADER_BYTES + 28 + letterBytes + (photoBytes > 0 ? 28 + photoBytes : 0);

/** Commit and reveal together, in vbytes, for such a letter. */
export const inscriptionVbytes = (letterBytes: number, photoBytes: number) => COMMIT_VBYTES + revealVbytes(bodyBytes(letterBytes, photoBytes));

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
