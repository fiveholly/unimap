// The world map (世界地图) on the home page: every block at once, as continents in a sea. Each
// halving epoch is one continent (as in lib/terrain.ts) and each cell of it is 64 blocks, the
// size of a quarter on the city map. A continent grows outward from its centre as its blocks are
// mined, its oldest blocks in the middle, so the newest epoch is the island still growing. The
// layout is only for this overview; the city map keeps its own street grid.

import { HALVING } from "./terrain.ts";

export const CELL_BLOCKS = 64;
const FULL = Math.ceil(HALVING / CELL_BLOCKS); // cells of a whole continent
const REACH = 46; // cells from a continent's centre its coast can reach

/** Where each continent sits, in cells, and the years its epoch spans. The old town is in the
 * middle and the later epochs ring it, going round the way time does. */
export const ISLANDS: { at: [number, number]; years: string }[] = [
  { at: [0, 0], years: "2009–2012" },
  { at: [92, -20], years: "2012–2016" },
  { at: [70, 78], years: "2016–2020" },
  { at: [-22, 100], years: "2020–2024" },
  { at: [-98, 30], years: "2024–2028" },
  { at: [-62, -78], years: "2028–2032" },
];

/** A small deterministic hash in [0, 1). */
export function hash(a: number, b = 0): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const orders = new Map<number, [number, number][]>();

/** The cells of continent e, in the order its blocks fill them: nearest the centre first, along
 * a coastline made uneven by a few waves around it, different for every continent. */
export function cellsOf(e: number): [number, number][] {
  const known = orders.get(e);
  if (known) return known;
  const [cu, cv] = ISLANDS[e]?.at ?? [0, 0];
  const waves = [2, 3, 5, 7].map((k, i) => [k, hash(e, i) * Math.PI * 2, 0.07 + 0.09 * hash(e, i + 9)] as const);
  const cells: [number, number, number][] = [];
  for (let du = -REACH; du <= REACH; du++)
    for (let dv = -REACH; dv <= REACH; dv++) {
      const d = Math.hypot(du, dv);
      if (d > REACH) continue;
      const a = Math.atan2(dv, du);
      const coast = 1 + waves.reduce((sum, [k, phase, amp]) => sum + amp * Math.sin(k * a + phase), 0);
      cells.push([cu + du, cv + dv, d / coast + hash(cu + du, cv + dv) * 0.6]);
    }
  cells.sort((x, y) => x[2] - y[2]);
  const out = cells.slice(0, FULL).map(([u, v]) => [u, v] as [number, number]);
  orders.set(e, out);
  return out;
}

/** The cell block n is in. */
export function cellOf(n: number): [number, number] {
  const e = Math.floor(n / HALVING);
  return cellsOf(e)[Math.floor((n - e * HALVING) / CELL_BLOCKS)];
}

/** The blocks of the cell at (u, v), or null for the sea: [first, last], up to the newest block. */
export function blocksAt(u: number, v: number, tip: number): [number, number] | null {
  for (let e = 0; e <= Math.floor(tip / HALVING); e++) {
    const [cu, cv] = ISLANDS[e]?.at ?? [0, 0];
    if (Math.hypot(u - cu, v - cv) > REACH) continue;
    const k = cellsOf(e).findIndex(([a, b]) => a === u && b === v);
    if (k < 0) continue;
    const first = e * HALVING + k * CELL_BLOCKS;
    if (first > tip) return null;
    return [first, Math.min(first + CELL_BLOCKS - 1, (e + 1) * HALVING - 1, tip)];
  }
  return null;
}
