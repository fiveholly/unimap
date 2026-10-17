import assert from "node:assert/strict";
import { test } from "node:test";

import { QUICKNET, roundAtOrAfter, roundTime, tlockEncrypt } from "./drand.ts";

test("rounds: the first one out at or after a time", () => {
  assert.equal(roundAtOrAfter(QUICKNET.genesis), 1);
  assert.equal(roundTime(1), QUICKNET.genesis);
  const t = 1_800_000_000;
  const r = roundAtOrAfter(t);
  assert.ok(roundTime(r) >= t && roundTime(r) - t < QUICKNET.period);
  assert.equal(roundAtOrAfter(roundTime(r)), r);
});

test("encrypting to a future round works offline", async () => {
  const armored = await tlockEncrypt(roundAtOrAfter(2_000_000_000), new Uint8Array(32).fill(9));
  assert.match(armored, /^-----BEGIN AGE ENCRYPTED FILE-----/);
  assert.ok(armored.length < 1000);
});
