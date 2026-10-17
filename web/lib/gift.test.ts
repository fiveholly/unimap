import assert from "node:assert/strict";
import { test } from "node:test";

import { hex } from "@scure/base";

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
  CONTENT_TYPE,
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

test("the inscription: envelope, content, reveal paying the gift as output 0", () => {
  const photo = crypto.getRandomValues(new Uint8Array(1500));
  const content = { net: "signet" as const, h: H, round: 123, tlock: "-----BEGIN AGE ENCRYPTED FILE-----\nx\n-----END AGE ENCRYPTED FILE-----\n", fingerprint: "ab".repeat(32), letter: new Uint8Array([1, 2, 3, 10, 5]), photo };
  const body = encodeContent(content);
  assert.deepEqual(decodeContent(body), content);
  const secret = new Uint8Array(32).fill(7);
  const envelope = inscriptionScript(xonlyOf(secret), CONTENT_TYPE, body);
  // <key> CHECKSIG OP_0 IF PUSH3 "ord" PUSH1 01 ...
  assert.equal(hex.encode(envelope.slice(33, 42)), "ac0063036f7264" + "0101");
  assert.deepEqual(parseInscription(envelope), { contentType: CONTENT_TYPE, body });
  const fee = revealFee(secret, envelope, WITH_REFUND, 100_000, 2);
  const commit = commitTaproot(secret, envelope);
  assert.match(commit.address!, /^tb1p/);
  const reveal = buildReveal({ secret, envelope, giftAddress: WITH_REFUND, giftSats: 100_000, commit: { txid: "11".repeat(32), vout: 1, value: 100_000 + fee } });
  assert.ok(Math.ceil(reveal.vsize * 2) <= fee);
  const seen = describeTx(reveal.hex);
  assert.equal(seen.txid, reveal.txid);
  assert.deepEqual(seen.outputs, [{ address: WITH_REFUND, value: 100_000 }]);
  assert.deepEqual(seen.inputs.map((i) => [i.txid, i.vout]), [["11".repeat(32), 1]]);
  assert.deepEqual(seen.inscription?.body, body);
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
