import assert from "node:assert/strict";
import test from "node:test";

import { sealLayout } from "./seal.ts";

test("the same block always gives the same seal", () => {
  assert.deepEqual(sealLayout(840000), sealLayout(840000));
  assert.notDeepEqual(sealLayout(840000).outline, sealLayout(840001).outline);
});

test("digits become numerals read top to bottom, right to left", () => {
  const s = sealLayout(840000);
  assert.deepEqual(s.glyphs.map((g) => g.ch).join(""), "八四〇〇〇〇");
  // First column is the rightmost one, top character first.
  assert.ok(s.glyphs[0].x > s.glyphs[2].x);
  assert.ok(s.glyphs[0].y < s.glyphs[1].y);
  assert.equal(sealLayout(0).glyphs.length, 1);
});

test("everything stays inside the stamp", () => {
  for (const n of [0, 7, 42, 210000, 840000, 918500, 1234567]) {
    const s = sealLayout(n);
    for (const g of s.glyphs) {
      assert.ok(g.x - g.size / 2 >= 10 && g.x + g.size / 2 <= 90, `x of ${n}`);
      assert.ok(g.y - (g.size * g.stretch) / 2 >= 10 && g.y + (g.size * g.stretch) / 2 <= 90, `y of ${n}`);
    }
    assert.ok(Math.abs(s.rotate) <= 2.6);
  }
});
