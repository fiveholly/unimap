// The city's terrain (地形): every halving epoch is a continent. Where one epoch's blocks meet
// the next epoch's across a street, the street is sea instead, so each halving cuts a strait
// across the map, with bridges over it. The halving's own quarter is where the two continents
// still touch, unless the halving is a quarter's first block. Nothing here moves a block: the
// grid (components/CityMap.tsx, lib/parks.ts) stays as it is, only how streets are drawn changes.

import { PER_Q, SIDE, side } from "./parks.ts";

export const HALVING = 210_000;

export const epochOf = (n: number) => Math.floor(n / HALVING);

/** Continents, by epoch: name and shore colour. */
export const CONTINENTS: { name: string; shore: string }[] = [
  { name: "老城区", shore: "#7A6A48" },
  { name: "第一纪元", shore: "#5E6B45" },
  { name: "第二纪元", shore: "#4E6266" },
  { name: "第三纪元", shore: "#6E5444" },
  { name: "第四纪元", shore: "#5C5A50" },
  { name: "第五纪元", shore: "#665E48" },
];
export const continent = (epoch: number) => CONTINENTS[epoch] ?? { name: `第 ${epoch} 纪元`, shore: "#5C5A50" };

/** The blocks either side of street cell (u, v) of quarter q: [here, across] pairs. Cell u = SIDE
 * runs along the quarter's +u edge, v = SIDE along +v; (SIDE, SIDE) is where they cross. */
function across(q: number, u: number, v: number): [number, number | null][] {
  const base = q * PER_Q;
  if (u === SIDE && v < SIDE) {
    const a = base + v * SIDE + SIDE - 1;
    return [[a, side(a, 1, 0)]];
  }
  if (v === SIDE && u < SIDE) {
    const a = base + (SIDE - 1) * SIDE + u;
    return [[a, side(a, 0, 1)]];
  }
  const a = base + PER_Q - 1, r = side(a, 1, 0), d = side(a, 0, 1);
  return [
    [a, r],
    [a, d],
    [a, r == null ? null : side(r, 0, 1)],
  ];
}

/** Whether a street cell is sea: the blocks it separates are in different epochs. A street at
 * the map's edge stays a street. */
export function isWater(q: number, u: number, v: number): boolean {
  if (u < SIDE && v < SIDE) return false;
  return across(q, u, v).some(([a, b]) => b != null && epochOf(a) !== epochOf(b));
}

/** Bridges: one over the middle of each stretch of strait along a quarter's edge. 1 spans the
 * cell along u, 2 along v; 0 is open water. */
export function bridgeAt(q: number, u: number, v: number): 0 | 1 | 2 {
  if (!isWater(q, u, v)) return 0;
  if (u === SIDE && v === SIDE / 2) return 1;
  if (v === SIDE && u === SIDE / 2) return 2;
  return 0;
}

/** Whether quarter q could border a strait: within two rows of a halving. Saves the check
 * everywhere else. */
export function nearStrait(q: number): boolean {
  const n = q * PER_Q, h = Math.round(n / HALVING) * HALVING;
  return h > 0 && Math.abs(n - h) < 3 * 24 * PER_Q;
}

/** Blocks of quarter q on the shore of a strait: [u, v, du, dv], the way to the sea. */
export function shoreBlocks(q: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  if (!nearStrait(q)) return out;
  for (let i = 0; i < PER_Q; i++) {
    const u = i % SIDE, v = Math.floor(i / SIDE), n = q * PER_Q + i;
    const dirs: [number, number][] = [];
    if (u === SIDE - 1) dirs.push([1, 0]);
    if (u === 0) dirs.push([-1, 0]);
    if (v === SIDE - 1) dirs.push([0, 1]);
    if (v === 0) dirs.push([0, -1]);
    for (const [du, dv] of dirs) {
      const m = side(n, du, dv);
      if (m != null && epochOf(m) !== epochOf(n)) out.push([u, v, du, dv]);
    }
  }
  return out;
}
