import assert from "node:assert/strict";
import test from "node:test";

import { layout, txSize } from "./mondrian.ts";

test("tx sizes follow the log10 rule", () => {
  assert.equal(txSize(1), 1);
  assert.equal(txSize(100_000), 1);
  assert.equal(txSize(100_000_000), 3); // 1 BTC
  assert.equal(txSize(5_000_000_000), 5); // 50 BTC coinbase
});

test("squares never overlap and stay inside the grid width", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let n = 1; n < 300; n += 13) {
    const values = Array.from({ length: n }, () => Math.floor(10 ** (3 + rand() * 9)));
    const { squares } = layout(values);
    assert.equal(squares.length, n);
    const cells = new Set<string>();
    const width = Math.ceil(Math.sqrt(values.reduce((a, v) => a + txSize(v) ** 2, 0)));
    for (const q of squares) {
      assert.ok(q.x + q.r <= Math.max(width, q.r), `square past grid width (n=${n})`);
      for (let x = q.x; x < q.x + q.r; x++)
        for (let y = q.y; y < q.y + q.r; y++) {
          const k = `${x},${y}`;
          assert.ok(!cells.has(k), `overlap at ${k} (n=${n})`);
          cells.add(k);
        }
    }
  }
});

test("a single coinbase fills the image", () => {
  assert.deepEqual(layout([5_000_000_000]), { squares: [{ x: 0, y: 0, r: 5 }], width: 5, height: 5 });
});
