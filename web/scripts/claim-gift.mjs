#!/usr/bin/env node
// Claim a unimap 礼物 (a gift sent with a 时间胶囊) and read its letter, without unimap.
//
// The promise of a gift is that Bitcoin, not unimap, holds it: the sats sit at a Taproot address
// whose internal key is BIP-341's NUMS point (no key path), with the script leaves
//   1. <H> OP_CHECKLOCKTIMEVERIFY OP_DROP <recipient x-only key> OP_CHECKSIG
//   2. <H + 262800> OP_CHECKLOCKTIMEVERIFY OP_DROP <sender x-only key> OP_CHECKSIG   (if the refund is on)
// From block H, leaf 1 is spent with a transaction whose nLockTime is H and whose input's nSequence
// is below 0xffffffff, with the witness [signature, leaf script, control block]. This script does
// exactly that from the 时间锁 card's text backup (or its link), using a public Esplora API.
//
// The letter is the gift UTXO's inscription (the reveal transaction's input witness, an ord
// envelope). Its capsule (a JSON header line, then the AES-GCM ciphertexts) is in the envelope's
// metadata (tag 5, in 520-byte pushes joined), CBOR {"t": "application/x-unimap-capsule", "v": 1,
// "b": <the capsule's bytes>}; what wallets show is an envelope (a shared one by delegate, tag 11, or
// a small SVG as the content). Letters inscribed before that had the capsule as the content itself,
// of type application/x-unimap-capsule; both are read.
// Its key is timelock-encrypted to a drand quicknet round (tlock-js decrypts it once the round is
// out), or is the xor of the 时间锁's half and unimap's half (--server-half, if unimap still gives it).
//
// Setup, anywhere (Node 20 or later):
//   npm i @scure/btc-signer@2.4.1 @scure/base@2.4.0 @noble/curves@2.4.0 tlock-js@0.9.0
// Usage:
//   node claim-gift.mjs '<时间锁 text or link>' --to tb1q...           sweep the gift to an address
//   node claim-gift.mjs '<时间锁>' --to tb1q... --dry-run               print the signed tx, don't send
//   node claim-gift.mjs '<时间锁>' --letter [--server-half <base64url>] print the letter (photo to letter.jpg)
// Options: --esplora <api url> (default mempool.space for the card's network), --fee-rate <sat/vB>,
//   --key <hex> (the recipient's private key, when the gift is locked to a wallet key, not a 礼物钥匙),
//   --refund --key <sender's hex key> (spend leaf 2 instead, from H + 262800).
// Test networks only (signet, testnet, testnet4), as the gifts are.

import { writeFileSync } from "node:fs";

import { schnorr } from "@noble/curves/secp256k1.js";
import { base64urlnopad, hex, utf8 } from "@scure/base";
import * as btc from "@scure/btc-signer";

const ESPLORA = { signet: "https://mempool.space/signet/api", testnet: "https://mempool.space/testnet/api", testnet4: "https://mempool.space/testnet4/api" };
const REFUND_BLOCKS = 262_800;
const OPTS = { allowUnknownOutputs: true, allowUnknownInputs: true, disableScriptCheck: true };

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const die = (msg) => (console.error(msg), process.exit(1));
const VALUED = ["--to", "--esplora", "--fee-rate", "--key", "--server-half"];
const input = args.find((a, i) => !a.startsWith("--") && !VALUED.includes(args[i - 1]));
if (!input) die("usage: node claim-gift.mjs '<时间锁 text or link>' (--to <address> | --letter) [options]");

// The 时间锁: base64url of a JSON object (lib/gift.ts Timelock), alone or after #g= in a link.
const packed = (input.match(/[#&]g=([A-Za-z0-9_-]+)/) ?? [, input.replace(/\s+/g, "")])[1];
const x = JSON.parse(utf8.encode(base64urlnopad.decode(packed)));
if (x.v !== 1 || !ESPLORA[x.net]) die("not a unimap 时间锁 for a test network");
const esplora = (opt("--esplora") ?? ESPLORA[x.net]).replace(/\/+$/, "");
const get = async (path) => {
  const r = await fetch(esplora + path);
  if (!r.ok) die(`${esplora}${path}: ${r.status} ${await r.text()}`);
  return r;
};

// Rebuild the gift's address from the card alone: the same keys and H always give the same address.
const leaf = (h, key) => btc.Script.encode([h, "CHECKLOCKTIMEVERIFY", "DROP", hex.decode(key), "CHECKSIG"]);
const leaves = x.r ? [leaf(x.h, x.rk), leaf(x.h + REFUND_BLOCKS, x.sk)] : [leaf(x.h, x.rk)];
const tree = leaves.length === 1 ? { script: leaves[0] } : leaves.map((script) => ({ script }));
const gift = btc.p2tr(btc.taprootNumsKey(), tree, btc.TEST_NETWORK, true);
console.error(`gift: ${x.a} sats to ${x.to}, locked until block ${x.h} on ${x.net}\naddress: ${gift.address}`);

if (flag("--letter")) await letter();
else await sweep();

async function sweep() {
  const to = opt("--to") ?? die("--to <address> is needed");
  const refund = flag("--refund");
  const secretHex = opt("--key") ?? (refund ? null : x.gk);
  if (!secretHex) die(refund ? "--refund needs --key <the sender's private key, hex>" : "this gift is locked to a wallet key: pass --key <its private key, hex>");
  const secret = hex.decode(secretHex);
  const lock = refund ? x.h + REFUND_BLOCKS : x.h;
  const script = refund ? leaves[1] : leaves[0];
  if (refund && !x.r) die("this gift has no refund leaf");
  if (hex.encode(schnorr.getPublicKey(secret)) !== (refund ? x.sk : x.rk)) die("that key isn't the one this leaf is locked to");
  const tip = Number(await (await get("/blocks/tip/height")).text());
  if (tip < lock) die(`too early: locked until block ${lock}, the tip is ${tip} (about ${Math.round(((lock - tip) * 10) / 60)} hours to go)`);
  const utxos = await (await get(`/address/${gift.address}/utxo`)).json();
  if (!utxos.length) die("nothing at the gift address: claimed already, or never funded");
  const feeRate = Number(opt("--fee-rate") ?? 2);
  const entry = gift.tapLeafScript.find(([, s]) => hex.encode(s.slice(0, -1)) === hex.encode(script));
  const tx = new btc.Transaction({ ...OPTS, lockTime: lock });
  let total = 0;
  for (const u of utxos) {
    tx.addInput({ txid: u.txid, index: u.vout, sequence: 0xfffffffe, witnessUtxo: { script: gift.script, amount: BigInt(u.value) }, tapLeafScript: [entry] });
    total += u.value;
  }
  const fee = Math.ceil((43 + 10 + utxos.length * 100) * feeRate);
  tx.addOutputAddress(to, BigInt(total - fee), btc.TEST_NETWORK);
  for (let i = 0; i < utxos.length; i++) {
    tx.signIdx(secret, i);
    const inp = tx.getInput(i);
    const [cb, scriptVer] = inp.tapLeafScript[0];
    tx.updateInput(i, { finalScriptWitness: [inp.tapScriptSig[0][1], scriptVer.slice(0, -1), btc.TaprootControlBlock.encode(cb)] }, true);
  }
  console.error(`sweeping ${total} sats to ${to}, fee ${fee}`);
  if (flag("--dry-run")) return console.log(tx.hex);
  const r = await fetch(`${esplora}/tx`, { method: "POST", body: tx.hex });
  const text = await r.text();
  if (!r.ok) die(`broadcast refused: ${text}`);
  console.log(text);
}

async function letter() {
  const reveal = x.t ?? (await (await get(`/address/${gift.address}/txs`)).json()).find((t) => t.vout?.[0]?.scriptpubkey_address === gift.address)?.txid;
  if (!reveal) die("can't find the reveal transaction (the inscription)");
  const tx = btc.Transaction.fromRaw(hex.decode((await (await get(`/tx/${reveal}/hex`)).text()).trim()), OPTS);
  const w = tx.getInput(0).finalScriptWitness;
  const ops = btc.Script.decode(w[w.length - 2]);
  const at = ops.findIndex((o, i) => (o === 0 || o === "OP_0") && ops[i + 1] === "IF");
  const isZero = (o) => o === 0 || o === "OP_0";
  const join = (parts) => {
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    parts.reduce((n, p) => (all.set(p, n), n + p.length), 0);
    return all;
  };
  // <key> CHECKSIG OP_0 IF "ord" (<tag> <value>)... [OP_0 <body pushes...>] ENDIF; tags are 1-byte pushes.
  const pushes = [], meta = [];
  let contentType = "";
  for (let i = at + 3; i < ops.length && ops[i] !== "ENDIF"; i += 2) {
    if (isZero(ops[i])) {
      for (i++; ops[i] instanceof Uint8Array; i++) pushes.push(ops[i]);
      break;
    }
    const tag = ops[i] instanceof Uint8Array ? ops[i][0] : ops[i];
    const value = ops[i + 1] instanceof Uint8Array ? ops[i + 1] : new Uint8Array(0);
    if (tag === 1) contentType = utf8.encode(value);
    if (tag === 5) meta.push(value);
  }
  let body;
  if (meta.length) {
    const m = cbor(join(meta));
    if (m?.t !== "application/x-unimap-capsule" || m.v !== 1 || !(m.b instanceof Uint8Array)) die("this inscription's metadata isn't a unimap capsule");
    body = m.b;
  } else {
    if (contentType !== "application/x-unimap-capsule") die("this inscription isn't a unimap capsule");
    body = join(pushes); // inscribed before metadata
  }
  const nl = body.indexOf(10);
  const head = JSON.parse(utf8.encode(body.slice(0, nl)));
  const letterBytes = body.slice(nl + 1, nl + 1 + head.letter), photoBytes = head.photo ? body.slice(nl + 1 + head.letter) : null;
  let key;
  const serverHalf = opt("--server-half");
  if (serverHalf) {
    const a = base64urlnopad.decode(serverHalf), b = base64urlnopad.decode(x.b);
    key = a.map((v, i) => v ^ b[i]);
  } else {
    const tl = await import("tlock-js").then((m) => (m.default?.timelockDecrypt ? m.default : m));
    key = new Uint8Array(await tl.timelockDecrypt(head.tlock, tl.mainnetClient())); // quicknet
  }
  const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
  const open = async (b) => new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, aes, b.slice(12)));
  console.log(new TextDecoder().decode(await open(letterBytes)));
  if (photoBytes) {
    writeFileSync("letter.jpg", await open(photoBytes));
    console.error("photo written to letter.jpg");
  }
}

/** Just enough CBOR (RFC 8949) for the metadata: unsigned integers, bytes, text, arrays and maps. */
function cbor(b) {
  let at = 0;
  const item = () => {
    const first = b[at++], major = first >> 5, info = first & 31;
    let n = info;
    if (info >= 24) {
      if (info > 26) die("metadata: CBOR this script doesn't read");
      n = 0;
      for (let i = 0; i < 1 << (info - 24); i++) n = n * 256 + b[at++];
    }
    if (major === 0) return n;
    if (major === 2) return b.slice(at, (at += n));
    if (major === 3) return utf8.encode(b.slice(at, (at += n)));
    if (major === 4) return Array.from({ length: n }, item);
    if (major === 5) return Object.fromEntries(Array.from({ length: n }, () => [item(), item()]));
    die("metadata: CBOR this script doesn't read");
  };
  return item();
}
