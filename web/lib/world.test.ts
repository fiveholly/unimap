import assert from "node:assert/strict";
import test from "node:test";

import { cellsOf, coastline } from "./world.ts";

test("a block of cells has one smooth coast around it", () => {
  const cells: [number, number][] = [];
  for (let u = 0; u < 3; u++) for (let v = 0; v < 3; v++) cells.push([u, v]);
  const loops = coastline(cells);
  assert.equal(loops.length, 1);
  for (const [u, v] of loops[0]) {
    assert.ok(u >= -0.5 && u <= 2.5 && v >= -0.5 && v <= 2.5, `${u},${v} is outside the cells`);
  }
});

test("a staircase coast becomes a straight line before rounding", () => {
  // A triangle of cells whose long side is a staircase.
  const cells: [number, number][] = [];
  for (let u = 0; u < 8; u++) for (let v = 0; v <= u; v++) cells.push([u, v]);
  const [loop] = coastline(cells, 0, 0);
  // Points on the staircase side all lie on one line, u - v = -0.5.
  const diagonal = loop.filter(([u, v]) => v > u - 0.25);
  assert.ok(diagonal.length >= 10);
  for (const [u, v] of diagonal) assert.ok(Math.abs(u - v + 0.5) < 1e-9, `${u},${v} is off the diagonal`);
});

test("lone cells are left out, and every continent has a coast", () => {
  assert.equal(coastline([[0, 0]]).length, 0);
  for (let e = 0; e < 4; e++) assert.ok(coastline(cellsOf(e)).length >= 1);
});
