import assert from "node:assert/strict";
import { test } from "node:test";

import { sha256 } from "@noble/hashes/sha2.js";
import { hex } from "@scure/base";
import * as btc from "@scure/btc-signer";

import {
  buildReveal,
  buildSweep,
  commitTaproot,
  decodeContent,
  describeTx,
  encodeContent,
  giftLeaves,
  giftLine,
  giftTaproot,
  inscriptionScript,
  isTestAddress,
  joinKey,
  lockLeaf,
  NUMS,
  packTimelock,
  parseInscription,
  parseXonly,
  REFUND_BLOCKS,
  revealFee,
  splitKey,
  sweepPsbt,
  timelockAddress,
  timelockFromHash,
  unpackTimelock,
  xonlyOf,
  amountProblem,
  bodyBytes,
  COMMIT_VBYTES,
  envelopeLength,
  HEADER_BYTES,
  inscriptionVbytes,
  letterLine,
  revealVbytes,
  CONTENT_TYPE,
  capsuleContent,
  cborDecode,
  cborEncode,
  delegateBytes,
  delegateId,
  envelopeSvg,
  inscriptionProblem,
  letterMetadata,
  letterScript,
  metadataLength,
  SVG_TYPE,
  type Cbor,
  type Face,
  type Timelock,
} from "./gift.ts";

// The same vectors as tests/test_gift.py: the recipient's secret is 0x01 * 32, the sender's 0x02 * 32.
const R_SECRET = new Uint8Array(32).fill(1), S_SECRET = new Uint8Array(32).fill(2);
const RECIPIENT = xonlyOf(R_SECRET), SENDER = xonlyOf(S_SECRET);
const H = 900_000;
const WITH_REFUND = "tb1p4srk47vjl9a0v4ew6uf7p6ehtqypn8yex5drmp3nv3d0hj6kul0qplhgsh";
const NO_REFUND = "tb1pqxuqm6tl9ahdr6pu00w67cj3ynt7c65rkct9un6q2y9tueenhzwqqx4cd7";
const keys = { height: H, recipient: RECIPIENT, sender: SENDER, refund: true };

test("the internal key is BIP-341's NUMS point", () => {
  assert.equal(hex.encode(NUMS), "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0");
});

test("leaf scripts: CLTV at H for the recipient, at H + 262800 for the refund", () => {
  assert.equal(hex.encode(RECIPIENT), "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f");
  assert.equal(hex.encode(lockLeaf(H, RECIPIENT)), "03a0bb0db17520" + hex.encode(RECIPIENT) + "ac");
  const [one, two] = giftLeaves(keys);
  assert.deepEqual(one, lockLeaf(H, RECIPIENT));
  assert.equal(hex.encode(two), "0330be11b17520" + hex.encode(SENDER) + "ac");
  assert.equal(H + REFUND_BLOCKS, 0x11be30);
});

test("same keys and H give the same address, the one api/gift.py builds", () => {
  assert.equal(giftTaproot(keys).address, WITH_REFUND);
  assert.equal(giftTaproot({ ...keys }).address, WITH_REFUND);
  assert.notEqual(giftTaproot({ ...keys, height: H + 1 }).address, WITH_REFUND);
  assert.notEqual(giftTaproot({ ...keys, recipient: SENDER, sender: RECIPIENT }).address, WITH_REFUND);
});

test("with the refund off there is one leaf", () => {
  const off = { ...keys, refund: false, sender: null };
  assert.equal(giftLeaves(off).length, 1);
  const t = giftTaproot(off);
  assert.equal(t.address, NO_REFUND);
  assert.equal(t.tapLeafScript?.length, 1);
  assert.equal(giftTaproot(keys).tapLeafScript?.length, 2);
  assert.throws(() => giftLeaves({ ...keys, sender: null }));
});

test("amounts: tiers and custom from 50,000", () => {
  assert.equal(amountProblem(50_000, 1_000_000), null);
  assert.equal(amountProblem(49_999, 1_000_000), "min");
  assert.equal(amountProblem(1_000_001, 1_000_000), "max");
  assert.equal(amountProblem(60_000.5, 1_000_000), "whole");
});

test("keys: x-only, compressed, rejected", () => {
  assert.deepEqual(parseXonly(hex.encode(RECIPIENT)), RECIPIENT);
  assert.deepEqual(parseXonly("03" + hex.encode(RECIPIENT).toUpperCase()), RECIPIENT);
  assert.equal(parseXonly("00".repeat(32)), null);
  assert.equal(parseXonly("xyz"), null);
  assert.ok(isTestAddress(WITH_REFUND));
  assert.ok(!isTestAddress("bc1pxnjyjj0cxauyt5hhmu29qg3yqa2pljnnqtpnjuelzgwqn6f64tnq8rtqhp"));
});

test("the backup key splits in two, and only both open it", () => {
  const k = crypto.getRandomValues(new Uint8Array(32));
  const { server, recipient } = splitKey(k);
  assert.deepEqual(joinKey(server, recipient), k);
  assert.notDeepEqual(server, k);
  assert.notDeepEqual(recipient, k);
});

test("the gift line matches api/gift.py", () => {
  assert.equal(giftLine({ sats: 100000, address: WITH_REFUND, height: H, network: "signet" }), `gift: 100000 sats to ${WITH_REFUND} unlocking at block 900000 on signet`);
});

test("an inscribed letter's line matches api/gift.py", () => {
  assert.equal(letterLine({ network: "signet", drand_round: 12_345_678 }), "inscribed: on signet, key timelocked to drand round 12345678");
});

const DELEGATE = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1fi0";
const REVERSED = "1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100";

test("the reveal's vsize is worked out byte for byte, before anything is built", () => {
  const secret = new Uint8Array(32).fill(9);
  // Body sizes either side of each push and CBOR boundary, for both faces (the SVG at 6 and 7 digits).
  for (const face of [{ opens: H }, { opens: 1_234_567 }, { delegate: DELEGATE }, { delegate: DELEGATE.replace(/i0$/, "i300") }] as Face[]) {
    for (const n of [1, 23, 24, 75, 76, 255, 256, 470, 471, 520, 521, 899, 2_800, 30_801, 52_801, 65_535, 65_536]) {
      const body = new Uint8Array(n).fill(0x5a);
      assert.equal(metadataLength(n), letterMetadata(body).length, `metadata for ${n}`);
      const envelope = letterScript(xonlyOf(secret), body, face);
      assert.equal(envelopeLength(n, face), envelope.length, `envelope for ${n}`);
      const reveal = buildReveal({ secret, envelope, giftAddress: NO_REFUND, giftSats: 546, commit: { txid: "11".repeat(32), vout: 0, value: 1_000_000 } });
      assert.equal(revealVbytes(n, face), reveal.vsize, `reveal for ${n}`);
    }
  }
  // The witness weighs a quarter: 4,000 more bytes of letter are about 1,000 vbytes.
  const svg = { opens: H };
  assert.ok(Math.abs(revealVbytes(bodyBytes(4_000, 0), svg) - revealVbytes(bodyBytes(0, 0), svg) - 1_000) < 30);
  assert.equal(inscriptionVbytes(100, 0, svg), COMMIT_VBYTES + revealVbytes(HEADER_BYTES + 28 + 100, svg));
  assert.equal(inscriptionVbytes(100, 25_000, svg) - inscriptionVbytes(100, 0, svg), revealVbytes(HEADER_BYTES + 128 + 25_028, svg) - revealVbytes(HEADER_BYTES + 128, svg));
  // The fallback SVG is its bytes / 4 more than the delegate: ~165 vB.
  const more = inscriptionVbytes(300, 0, svg) - inscriptionVbytes(300, 0, { delegate: DELEGATE });
  assert.ok(more > 150 && more < 180, String(more));
});

test("CBOR: what the metadata needs, round trip, and the bytes api/gift.py writes", () => {
  const meta = letterMetadata(new Uint8Array([1, 2, 3]));
  // {"t": "application/x-unimap-capsule", "v": 1, "b": h'010203'}
  assert.equal(hex.encode(meta), "a3" + "6174" + "781c" + hex.encode(new TextEncoder().encode(CONTENT_TYPE)) + "6176" + "01" + "6162" + "43010203");
  for (const v of [0, 23, 24, 255, 256, 65_535, 65_536, 4_294_967_295, "", "封", new Uint8Array(0), new Uint8Array(300).fill(7), [1, "a", [new Uint8Array([9])]], { a: 1, b: { c: "d" } }] as Cbor[])
    assert.deepEqual(cborDecode(cborEncode(v)), v);
  assert.equal(hex.encode(cborEncode(500)), "1901f4");
  assert.equal(hex.encode(cborEncode(new Uint8Array(70_000))).slice(0, 10), "5a00011170");
  assert.throws(() => cborDecode(new Uint8Array([0x43, 1, 2]))); // cut short
  assert.throws(() => cborDecode(new Uint8Array([0x01, 0x01]))); // bytes after it
  assert.throws(() => cborDecode(new Uint8Array([0x5f, 0xff]))); // indefinite length: not here
  assert.throws(() => cborEncode(-1));
});

test("the delegate id as ord serializes it: txid reversed, index little-endian with trailing zeros dropped", () => {
  // ord's docs: 000102…1fi0 is the 32 bytes 1f1e…00, nothing after them.
  assert.equal(hex.encode(delegateBytes(DELEGATE)), REVERSED);
  assert.equal(hex.encode(delegateBytes(DELEGATE.replace(/i0$/, "i255"))), REVERSED + "ff");
  assert.equal(hex.encode(delegateBytes(DELEGATE.replace(/i0$/, "i256"))), REVERSED + "0001");
  assert.equal(hex.encode(delegateBytes(DELEGATE.replace(/i0$/, "i16777216"))), REVERSED + "00000001");
  for (const i of [0, 1, 255, 256, 65_536, 4_294_967_295]) assert.equal(delegateId(delegateBytes(DELEGATE.replace(/i0$/, `i${i}`))), DELEGATE.replace(/i0$/, `i${i}`));
  assert.throws(() => delegateBytes("xyz"));
  assert.equal(delegateId(new Uint8Array(31)), null);
});

test("the fallback envelope: under a kilobyte, the block and nothing else, the bytes api/gift.py writes", () => {
  const svg = envelopeSvg(H);
  assert.ok(svg.length < 1_000);
  const text = new TextDecoder().decode(svg);
  assert.match(text, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"[^]*Opens at block 900000<\/text><\/svg>$/);
  assert.equal(hex.encode(sha256(svg)), "530dd86f7f3371473667ca920626a95f89e77ff8f1df85a5dde013a02fb44784");
  // Whole envelopes, as tests/test_gift.py builds and parses them.
  const key = new Uint8Array(32).fill(7), body = new Uint8Array(600).fill(0x5a);
  assert.equal(hex.encode(sha256(letterScript(key, body, { opens: H }))), "52c6f4daf161a48e34cc4d0827739a2cb1594b8569962140edc35cf91aef1bef");
  assert.equal(hex.encode(sha256(letterScript(key, body, { delegate: DELEGATE.replace(/i0$/, "i300") }))), "f659c8e49c6f70a9ffaa50cf4b8a5f73b176ea225a2b3f0d76b7dfd107ddb00e");
});

const CONTENT = { net: "signet" as const, h: H, round: 123, tlock: "-----BEGIN AGE ENCRYPTED FILE-----\nx\n-----END AGE ENCRYPTED FILE-----\n", fingerprint: "ab".repeat(32), letter: new Uint8Array([1, 2, 3, 10, 5]), photo: crypto.getRandomValues(new Uint8Array(1500)) };

test("the inscription: the letter in the metadata, an envelope shown, the reveal paying the gift as output 0", () => {
  const body = encodeContent(CONTENT);
  assert.deepEqual(decodeContent(body), CONTENT);
  const secret = new Uint8Array(32).fill(7);
  const envelope = letterScript(xonlyOf(secret), body, { opens: H });
  // <key> CHECKSIG OP_0 IF PUSH3 "ord" PUSH1 01 PUSH13 "image/svg+xml" PUSH1 05 PUSHDATA2 <520 bytes of metadata> …
  assert.equal(hex.encode(envelope.slice(33, 61)), "ac0063036f7264" + "0101" + "0d" + hex.encode(new TextEncoder().encode(SVG_TYPE)) + "0105" + "4d0802");
  const ins = parseInscription(envelope)!;
  assert.deepEqual(ins, { contentType: SVG_TYPE, body: envelopeSvg(H), metadata: letterMetadata(body), delegate: null });
  assert.deepEqual(capsuleContent(ins), CONTENT);
  const fee = revealFee(secret, envelope, WITH_REFUND, 100_000, 2);
  const commit = commitTaproot(secret, envelope);
  assert.match(commit.address!, /^tb1p/);
  const reveal = buildReveal({ secret, envelope, giftAddress: WITH_REFUND, giftSats: 100_000, commit: { txid: "11".repeat(32), vout: 1, value: 100_000 + fee } });
  assert.ok(Math.ceil(reveal.vsize * 2) <= fee);
  const seen = describeTx(reveal.hex);
  assert.equal(seen.txid, reveal.txid);
  assert.deepEqual(seen.outputs, [{ address: WITH_REFUND, value: 100_000 }]);
  assert.deepEqual(seen.inputs.map((i) => [i.txid, i.vout]), [["11".repeat(32), 1]]);
  assert.deepEqual(capsuleContent(seen.inscription), CONTENT);

  // By delegate: no content of its own, the shared envelope's id after the metadata.
  const shared = letterScript(xonlyOf(secret), body, { delegate: DELEGATE });
  assert.equal(hex.encode(shared.slice(-36)), "010b" + "20" + REVERSED + "68"); // PUSH1 0b, PUSH32 <id>, ENDIF
  assert.deepEqual(parseInscription(shared), { contentType: "", body: new Uint8Array(0), metadata: letterMetadata(body), delegate: DELEGATE });
  assert.deepEqual(capsuleContent(parseInscription(shared)), CONTENT);
});

test("metadata over 520 bytes goes in 520-byte pushes, each after its own tag 5", () => {
  const body = new Uint8Array(1_200).fill(0x33);
  const ops = btc.Script.decode(letterScript(new Uint8Array(32).fill(1), body, { delegate: DELEGATE }));
  const meta: Uint8Array[] = [];
  for (let i = 0; i < ops.length; i++) if (ops[i] instanceof Uint8Array && (ops[i] as Uint8Array).length === 1 && (ops[i] as Uint8Array)[0] === 5) meta.push(ops[++i] as Uint8Array);
  const whole = letterMetadata(body);
  assert.deepEqual(meta.map((m) => m.length), [520, 520, whole.length - 1_040]);
  assert.deepEqual(new Uint8Array(meta.flatMap((m) => [...m])), whole);
});

test("letters inscribed before metadata still read: the body as the content", () => {
  const body = encodeContent(CONTENT);
  const old = parseInscription(inscriptionScript(xonlyOf(new Uint8Array(32).fill(7)), CONTENT_TYPE, body))!;
  assert.deepEqual(old, { contentType: CONTENT_TYPE, body, metadata: null, delegate: null });
  assert.deepEqual(capsuleContent(old), CONTENT);
  // Something else entirely carries no capsule.
  assert.equal(capsuleContent(parseInscription(inscriptionScript(xonlyOf(new Uint8Array(32).fill(7)), "text/plain", new TextEncoder().encode("hi")))), null);
  assert.equal(capsuleContent({ contentType: SVG_TYPE, body: envelopeSvg(H), metadata: cborEncode({ t: "other", v: 1, b: body }), delegate: null }), null);
  assert.equal(capsuleContent(null), null);
});

test("what the server checks of a reveal's inscription (as api/gift.py check_inscription)", () => {
  const content = { ...CONTENT, photo: null, letter: new Uint8Array([4, 5, 6]) };
  const body = encodeContent(content), key = xonlyOf(new Uint8Array(32).fill(7));
  const fingerprint = hex.encode(sha256(content.letter));
  const want = { fingerprint, height: H, envelopes: [DELEGATE] };
  assert.equal(inscriptionProblem(parseInscription(letterScript(key, body, { opens: H })), want), null);
  assert.equal(inscriptionProblem(parseInscription(letterScript(key, body, { delegate: DELEGATE })), want), null);
  assert.equal(inscriptionProblem(parseInscription(inscriptionScript(key, CONTENT_TYPE, body)), want), null); // drafts from before
  assert.match(String(inscriptionProblem(parseInscription(letterScript(key, body, { opens: H + 1 })), want)), /envelope/);
  assert.match(String(inscriptionProblem(parseInscription(letterScript(key, body, { delegate: DELEGATE.replace(/i0$/, "i1") })), want)), /envelope/);
  assert.match(String(inscriptionProblem(parseInscription(letterScript(key, body, { delegate: DELEGATE })), { ...want, envelopes: [] })), /envelope/);
  assert.match(String(inscriptionProblem(parseInscription(letterScript(key, body, { opens: H })), { ...want, fingerprint: "00".repeat(32) })), /letter/);
  assert.match(String(inscriptionProblem(parseInscription(letterScript(key, body, { opens: H })), { ...want, height: H + 1 })), /letter|envelope/);
  assert.match(String(inscriptionProblem(null, want)), /letter/);
});

test("the sweep spends leaf 1 with nLockTime H", () => {
  const utxo = { txid: "22".repeat(32), vout: 0, value: 100_000 };
  const sweep = buildSweep({ keys, utxo, secret: R_SECRET, to: NO_REFUND, feeRate: 2 });
  const seen = describeTx(sweep.hex);
  assert.equal(seen.lockTime, H);
  assert.deepEqual(seen.outputs, [{ address: NO_REFUND, value: 100_000 - sweep.fee }]);
  const w = seen.inputs[0].witness;
  assert.equal(w.length, 3);
  assert.deepEqual(w[1], lockLeaf(H, RECIPIENT));
  assert.throws(() => buildSweep({ keys, utxo, secret: S_SECRET, to: NO_REFUND, feeRate: 2 })); // not the recipient's key
  const refund = describeTx(buildSweep({ keys, utxo, secret: S_SECRET, to: NO_REFUND, feeRate: 2, leaf: 1 }).hex);
  assert.equal(refund.lockTime, H + REFUND_BLOCKS);
  assert.match(sweepPsbt({ keys, utxo, to: NO_REFUND, feeRate: 2 }), /^cHNidP/);
});

test("the 时间锁 packs and unpacks, and rebuilds the address", () => {
  const x: Timelock = { v: 1, net: "signet", c: "abc", to: "小满", h: H, a: 100_000, r: true, rk: hex.encode(RECIPIENT), sk: hex.encode(SENDER), gk: hex.encode(R_SECRET),
    b: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", d: 77, s: "tb1qsender", t: null, ct: null };
  const packed = packTimelock(x);
  assert.match(packed, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(unpackTimelock(packed), x);
  assert.deepEqual(timelockFromHash(`#g=${packed}`), x);
  assert.equal(timelockAddress(x), WITH_REFUND);
  assert.equal(unpackTimelock(packTimelock({ ...x, gk: hex.encode(S_SECRET) })), null); // a key that isn't the leaf's
  assert.equal(unpackTimelock(packTimelock({ ...x, net: "mainnet" as never })), null);
  assert.equal(unpackTimelock("garbage"), null);
});
