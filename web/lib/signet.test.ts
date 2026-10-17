// The demo's 真实 Signet (lib/signet.ts): the switch, the Esplora reads that release unimap's half,
// the reveal check, drand's two ways of failing, and a whole gift's three transactions (commit from
// a taproot wallet, reveal, sweep) checked signature by signature as a node would, against a fake
// Esplora on localhost. The real signet and drand aren't reachable from the tests.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hex } from "@scure/base";
import * as btc from "@scure/btc-signer";

import {
  buildReveal,
  buildSweep,
  commitPsbt,
  commitTaproot,
  capsuleContent,
  describeTx,
  encodeContent,
  finishCommit,
  giftTaproot,
  letterScript,
  packTimelock,
  revealFee,
  unpackTimelock,
  xonlyOf,
  type Timelock,
} from "./gift.ts";

// signet.ts reads NEXT_PUBLIC_DEMO when it loads, and localStorage and window when asked.
process.env.NEXT_PUBLIC_DEMO = "1";
const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
const events = new EventTarget();
g.window = { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) };
const signet = await import("./signet.ts");

/** A fake Esplora: a tip, and transactions by txid in Esplora's JSON. */
async function fakeEsplora(state: { tip: number | null; txs: Record<string, unknown> }) {
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    if (url === "/blocks/tip/height") {
      if (state.tip == null) return res.writeHead(503).end("down");
      return res.writeHead(200).end(String(state.tip));
    }
    const m = url.match(/^\/tx\/([0-9a-f]{64})$/);
    if (m) return state.txs[m[1]] ? res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(state.txs[m[1]])) : res.writeHead(404).end("Transaction not found");
    res.writeHead(404).end("no");
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as { port: number };
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

test("the switch is per browser, off by default, and tells who listens", () => {
  assert.equal(signet.liveSignet(), false);
  let heard = 0;
  const off = signet.onLiveSignet(() => heard++);
  signet.setLiveSignet(true);
  assert.equal(signet.liveSignet(), true);
  assert.equal(store.get("unimap.demo.signet"), "1");
  signet.setLiveSignet(false);
  assert.equal(signet.liveSignet(), false);
  assert.equal(heard, 2);
  off();
  signet.setLiveSignet(true);
  assert.equal(heard, 2);
  signet.setLiveSignet(false);
});

test("the tip is read from Esplora, and nothing when it can't be", async () => {
  const state = { tip: 271_234 as number | null, txs: {} };
  const e = await fakeEsplora(state);
  try {
    assert.equal(await signet.signetTip(e.base), 271_234);
    state.tip = null;
    assert.equal(await signet.signetTip(e.base), null);
    assert.equal(await signet.signetTip("http://127.0.0.1:1"), null); // nothing listening
  } finally {
    await e.close();
  }
});

test("a whole gift on signet: commit, reveal and sweep are signed as a node checks them", async () => {
  // The wallet: a taproot (key path) address, as UniSat's default on signet.
  const walletSecret = new Uint8Array(32).fill(7);
  const wallet = btc.p2tr(xonlyOf(walletSecret), undefined, btc.TEST_NETWORK);
  const coin = { txid: "aa".repeat(32), vout: 1, value: 300_000, address: wallet.address!, publicKey: hex.encode(xonlyOf(walletSecret)) };

  const giftKey = new Uint8Array(32).fill(3), sender = new Uint8Array(32).fill(4), tip = 271_000, H = tip + 1;
  const keys = { height: H, recipient: xonlyOf(giftKey), sender: xonlyOf(sender), refund: true };
  const gift = giftTaproot(keys);
  const revealSecret = new Uint8Array(32).fill(5);
  const letter = new Uint8Array(900).fill(1), fingerprint = hex.encode(sha256(letter));
  const body = encodeContent({ net: "signet", h: H, round: 12345, tlock: "-----BEGIN AGE ENCRYPTED FILE-----x", fingerprint, letter, photo: null });
  const envelope = letterScript(xonlyOf(revealSecret), body, { opens: H });
  const sats = 100_000, feeRate = 1;
  const amount = sats + revealFee(revealSecret, envelope, gift.address!, sats, feeRate);

  // The commit, as the wallet signs it (UniSat signs the PSBT; here btc-signer does in its place).
  const p = commitPsbt({ utxos: [coin], commitAddress: commitTaproot(revealSecret, envelope).address!, amount, change: wallet.address!, feeRate });
  const psbt = btc.Transaction.fromPSBT(Uint8Array.from(atob(p.psbt), (c) => c.charCodeAt(0)));
  psbt.sign(walletSecret);
  const commit = finishCommit(btoa(String.fromCharCode(...psbt.toPSBT())));
  const c = describeTx(commit.hex);
  assert.equal(c.outputs[0].address, commitTaproot(revealSecret, envelope).address);
  assert.equal(c.outputs[0].value, amount);
  verifyInputs(commit.hex, [{ script: wallet.script, amount: coin.value }]);

  // The reveal, signed in the browser with the one-time key: output 0 is the gift, its witness the letter.
  const reveal = buildReveal({ secret: revealSecret, envelope, commit: { txid: commit.txid, vout: 0, value: amount }, giftAddress: gift.address!, giftSats: sats });
  verifyInputs(reveal.hex, [{ script: commitTaproot(revealSecret, envelope).script, amount }]);
  const r = describeTx(reveal.hex);
  assert.equal(r.outputs[0].address, gift.address);
  assert.deepEqual(capsuleContent(r.inscription)?.letter, letter);

  // What the demo's stand-in checks when the txids are reported, from Esplora's view of the reveal.
  const witness = r.inputs[0].witness.map((w) => hex.encode(w));
  const esploraView = { txid: reveal.txid, vin: [{ txid: commit.txid, vout: 0, witness }], vout: r.outputs.map((o) => ({ scriptpubkey_address: o.address ?? undefined, value: o.value })) };
  const e = await fakeEsplora({ tip, txs: { [reveal.txid]: esploraView } });
  try {
    const seen = await signet.signetTx(reveal.txid, e.base);
    assert.equal(signet.checkReveal(seen, { address: gift.address!, sats, commit: commit.txid }), true);
    // The inscription is the capsule's letter, showing the fallback envelope for its block.
    const want = { fingerprint, height: H, envelopes: [] };
    assert.equal(signet.checkReveal(seen, { address: gift.address!, sats, commit: commit.txid, letter: want }), true);
    assert.match(String(signet.checkReveal(seen, { address: gift.address!, sats, commit: commit.txid, letter: { ...want, fingerprint: "00".repeat(32) } })), /letter/);
    const bare = { ...esploraView, vin: [{ txid: commit.txid, vout: 0 }] };
    assert.equal(signet.checkReveal(bare, { address: gift.address!, sats, commit: commit.txid, letter: want }), false); // no witness to look at yet
    assert.match(String(signet.checkReveal(seen, { address: gift.address!, sats: sats + 1, commit: commit.txid })), /doesn't pay/);
    assert.match(String(signet.checkReveal(seen, { address: gift.address!, sats, commit: "bb".repeat(32) })), /doesn't spend the commit/);
    assert.deepEqual(await signet.signetTx("cc".repeat(32), e.base), {}); // not seen yet
    assert.equal(signet.checkReveal({}, { address: gift.address!, sats, commit: commit.txid }), false);
    assert.equal(signet.checkReveal(null, { address: gift.address!, sats, commit: commit.txid }), false);
  } finally {
    await e.close();
  }

  // The sweep, from H, to an address the recipient types.
  const to = btc.p2wpkh(secp256k1.getPublicKey(new Uint8Array(32).fill(9), true), btc.TEST_NETWORK).address!;
  const sweep = buildSweep({ keys, utxo: { txid: reveal.txid, vout: 0, value: sats }, secret: giftKey, to, feeRate: 1 });
  const sw = btc.Transaction.fromRaw(hex.decode(sweep.hex), { allowUnknownOutputs: true, allowUnknownInputs: true, disableScriptCheck: true });
  assert.equal(sw.lockTime, H); // a node takes it once the signet tip is at H
  assert.ok(sw.getInput(0).sequence! < 0xffffffff);
  verifyInputs(sweep.hex, [{ script: gift.script, amount: sats }]);
});

test("a 真实 Signet 时间锁 says so, and only ever for signet", () => {
  const x: Timelock = {
    v: 1, net: "signet", c: "abc", to: "小满", h: 271_001, a: 100_000, r: false, rk: hex.encode(xonlyOf(new Uint8Array(32).fill(3))), sk: null,
    gk: hex.encode(new Uint8Array(32).fill(3)), b: "A".repeat(43), d: 1, s: "tb1q", t: null, ct: null, live: true,
  };
  assert.equal(unpackTimelock(packTimelock(x))?.live, true);
  assert.equal(unpackTimelock(packTimelock({ ...x, net: "testnet4" })), null);
  assert.equal(unpackTimelock(packTimelock({ ...x, live: "yes" as unknown as true })), null);
  const { live: _live, ...plain } = x;
  assert.equal(unpackTimelock(packTimelock(plain))?.live, undefined);
});

test("drand: not out yet, or not reachable", () => {
  assert.deepEqual(signet.drandProblem(10, 2_000, 1_000, new Error("x")), { kind: "early", at: 2_000 });
  assert.deepEqual(signet.drandProblem(10, 900, 1_000, new Error("It's too early to decrypt the ciphertext - decryptable at round 10")), { kind: "early", at: 900 });
  assert.deepEqual(signet.drandProblem(10, 900, 1_000, new TypeError("Failed to fetch")), { kind: "down", why: "Failed to fetch" });
});

/** Every input's BIP-341 signature, as a node checks it: the key path against the output key, a
 * script path against the key its leaf checks, with the leaf committed to by the control block. */
function verifyInputs(raw: string, prevouts: { script: Uint8Array; amount: number }[]) {
  const tx = btc.Transaction.fromRaw(hex.decode(raw), { allowUnknownOutputs: true, allowUnknownInputs: true, disableScriptCheck: true });
  const scripts = prevouts.map((p) => p.script), amounts = prevouts.map((p) => BigInt(p.amount));
  for (let i = 0; i < tx.inputsLength; i++) {
    const w = tx.getInput(i).finalScriptWitness!;
    const outputKey = scripts[i].slice(2, 34);
    if (w.length === 1) {
      const hash = tx.preimageWitnessV1(i, scripts, 0, amounts);
      assert.ok(schnorr.verify(w[0], hash, outputKey), `input ${i}: key-path signature`);
      continue;
    }
    const [sig, leaf, cb] = w.slice(-3);
    const ops = btc.Script.decode(leaf);
    const at = ops.findIndex((op, j) => op instanceof Uint8Array && op.length === 32 && ops[j + 1] === "CHECKSIG");
    assert.ok(at >= 0, `input ${i}: the leaf checks a key`);
    const hash = tx.preimageWitnessV1(i, scripts, 0, amounts, undefined, leaf, cb[0] & 0xfe);
    assert.ok(schnorr.verify(sig, hash, ops[at] as Uint8Array), `input ${i}: script-path signature`);
    // The control block's internal key and path, tweaked, are the output key (BIP-341's commitment).
    const internal = cb.slice(1, 33);
    let k = tagged("TapLeaf", new Uint8Array([cb[0] & 0xfe]), compactSize(leaf.length), leaf);
    for (let j = 33; j < cb.length; j += 32) {
      const e = cb.slice(j, j + 32);
      k = hex.encode(k) < hex.encode(e) ? tagged("TapBranch", k, e) : tagged("TapBranch", e, k);
    }
    const tweak = BigInt("0x" + hex.encode(tagged("TapTweak", internal, k)));
    const Q = secp256k1.Point.fromHex("02" + hex.encode(internal)).add(secp256k1.Point.BASE.multiply(tweak));
    const q = Q.toBytes(true);
    assert.equal(hex.encode(q.slice(1)), hex.encode(outputKey), `input ${i}: the leaf is in the output`);
    assert.equal(q[0] & 1, cb[0] & 1, `input ${i}: the control block's parity`);
  }
}

const compactSize = (n: number) => (n < 0xfd ? new Uint8Array([n]) : new Uint8Array([0xfd, n & 0xff, n >> 8]));
function tagged(tag: string, ...parts: Uint8Array[]): Uint8Array {
  const t = sha256(new TextEncoder().encode(tag));
  const all = new Uint8Array(64 + parts.reduce((n, p) => n + p.length, 0));
  all.set(t);
  all.set(t, 32);
  let at = 64;
  for (const p of parts) (all.set(p, at), (at += p.length));
  return sha256(all);
}
