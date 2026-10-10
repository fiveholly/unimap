import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { pick, rarityOf, roundOf, sha256 } from "./game.ts";

test("sha256 matches node's", () => {
  for (const s of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "区块节拍", "0".repeat(64) + ":treasure"])
    assert.equal(sha256(s), createHash("sha256").update(s).digest("hex"));
});

test("draws match api/game.py", () => {
  const h = "00000000000000000001b2a8c8f1d4a1c6b8e1f0a2d3c4b5a6978877665544332";
  const n = BigInt("0x" + createHash("sha256").update(`${h}:lucky`).digest("hex"));
  assert.equal(pick(h, "lucky", 1000), Number(n % 1000n));
  assert.equal(pick(h, "treasure", 0), null);
  assert.equal(rarityOf("ab"), "common");
  assert.equal(rarityOf("ab0"), "rare");
  assert.equal(rarityOf("ab00"), "epic");
  assert.equal(rarityOf("a00000"), "legendary");
  assert.deepEqual(roundOf(918_500), [918_432, 918_575]);
});
