import assert from "node:assert/strict";
import { test } from "node:test";

import { encryptLetter } from "./capsule.ts";
import { roundAtOrAfter } from "./drand.ts";
import { b64url, decodeContent, inscriptionVbytes, joinKey, letterLine, POSTAGE } from "./gift.ts";
import { letterCost, postageAddress, prepareLetter } from "./giftseal.ts";

const RULES = { network: "signet" as const, tiers: [], min_sats: 50_000, max_sats: 1_000_000, refund_blocks: 262_800, block_seconds: 600, tip: 200_000, esplora: "https://esplora.test/api", explorer: "" };
const TB = "tb1pqxuqm6tl9ahdr6pu00w67cj3ynt7c65rkct9un6q2y9tueenhzwqqx4cd7";

test("an inscribed letter: the round at the open time, the key in two halves, postage to an address or back", async () => {
  const sealed = await encryptLetter("给十年后的你");
  const now = 1_800_000_000, openAt = now + 6_000;
  const named = await prepareLetter({ rules: RULES, ...sealed, openAt, now, recipient: "小满" });
  assert.deepEqual([named.chain.network, named.chain.height, named.chain.drand_round, named.chain.address], ["signet", 200_010, roundAtOrAfter(openAt), null]);
  assert.match(named.chain.tlock, /^-----BEGIN AGE ENCRYPTED FILE-----/);
  assert.equal(named.line, letterLine(named.chain));
  assert.equal(b64url.encode(joinKey(b64url.decode(named.serverHalf), b64url.decode(named.half))), sealed.key);
  assert.notEqual(named.serverHalf, sealed.key);
  assert.deepEqual([named.draft.address, named.draft.sats, named.draft.letter.half, "timelock" in named.draft], ["", POSTAGE, named.half, false]);
  const body = decodeContent(b64url.decode(named.draft.body))!;
  assert.deepEqual([body.h, body.round, body.fingerprint, body.photo], [200_010, roundAtOrAfter(openAt), sealed.fingerprint, null]);
  const toAddress = await prepareLetter({ rules: RULES, ...sealed, openAt, now, recipient: ` ${TB.toUpperCase()} ` });
  assert.equal(toAddress.chain.address, TB);
  assert.equal(toAddress.draft.address, TB);
});

test("postage goes to a test network's P2WPKH or P2TR address, else back", () => {
  assert.equal(postageAddress(TB), TB);
  assert.equal(postageAddress("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"), "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx");
  assert.equal(postageAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"), null); // mainnet
  assert.equal(postageAddress("mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn"), null); // P2PKH: not one api/gift.py takes
  assert.equal(postageAddress("18 岁的小满"), null);
});

test("what inscribing costs: vbytes × fee rate, and the photo's share", () => {
  const plain = letterCost(300, 0, 4);
  assert.deepEqual(plain, { vbytes: inscriptionVbytes(300, 0), photoVbytes: 0, fee: inscriptionVbytes(300, 0) * 4, photoFee: 0 });
  const photo = letterCost(300, 25_000, 4);
  assert.equal(photo.photoVbytes, inscriptionVbytes(300, 25_000) - inscriptionVbytes(300, 0));
  assert.ok(photo.photoVbytes > 6_200 && photo.photoVbytes < 6_400); // ~25,028 witness bytes / 4
  assert.equal(photo.photoFee, photo.photoVbytes * 4);
  assert.equal(letterCost(300, 0, 1.5).fee, Math.ceil(inscriptionVbytes(300, 0) * 1.5));
});
