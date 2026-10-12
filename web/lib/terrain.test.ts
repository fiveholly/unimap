import assert from "node:assert/strict";
import test from "node:test";

import { PER_Q, SIDE, side } from "./parks.ts";
import { bridgeAt, epochOf, isWater, nearStrait, shoreBlocks } from "./terrain.ts";

/** The street cell between block a and its neighbour along (du, dv), as [quarter, u, v]. */
function streetBetween(a: number, du: number, dv: number): [number, number, number] {
  const b = side(a, du, dv)!;
  const [from, d] = du + dv > 0 ? [a, [du, dv]] : [b, [-du, -dv]];
  const q = Math.floor(from / PER_Q), i = from % PER_Q;
  return d[0] ? [q, SIDE, Math.floor(i / SIDE)] : [q, i % SIDE, SIDE];
}

test("a halving cuts a strait: streets between epochs are sea, others stay streets", () => {
  // 840000 is the first block of its quarter, so every street around its top is sea.
  assert.equal(840000 % PER_Q, 0);
  assert.ok(isWater(...streetBetween(840000, -1, 0)));
  assert.ok(isWater(...streetBetween(840000, 0, -1)));
  // Far from any halving the streets are streets.
  assert.ok(!isWater(...streetBetween(500000, 1, 0)));
  assert.ok(!isWater(Math.floor(500000 / PER_Q), SIDE, SIDE));
  // Every street between two epochs is sea, and every sea street is between two epochs.
  for (const h of [210000, 420000, 630000, 840000])
    for (let n = h - 3 * 24 * PER_Q; n < h + 3 * 24 * PER_Q; n++)
      for (const [du, dv] of [[1, 0], [0, 1]]) {
        const m = side(n, du, dv);
        if (m == null || Math.floor(m / PER_Q) === Math.floor(n / PER_Q)) continue;
        const cell = streetBetween(n, du, dv);
        assert.equal(isWater(...cell), epochOf(n) !== epochOf(m), `${n} -> ${m}`);
        if (isWater(...cell)) assert.ok(nearStrait(cell[0]));
      }
});

test("bridges stand on the strait, one per quarter edge", () => {
  const q = 840000 / PER_Q;
  const up = Math.floor(side(840000, -1, 0)! / PER_Q);
  assert.equal(bridgeAt(up, SIDE, SIDE / 2), 1);
  assert.equal(bridgeAt(up, SIDE, 1), 0);
  assert.equal(bridgeAt(q + 3 * 24, SIDE, SIDE / 2), 0); // not on the strait
});

test("shore blocks face the next epoch across the strait", () => {
  const q = Math.floor(side(840000, -1, 0)! / PER_Q);
  const shore = shoreBlocks(q);
  assert.ok(shore.length > 0);
  for (const [u, v, du, dv] of shore) assert.notEqual(epochOf(side(q * PER_Q + v * SIDE + u, du, dv)!), epochOf(q * PER_Q + v * SIDE + u));
  assert.deepEqual(shoreBlocks(Math.floor(500000 / PER_Q)), []);
});
