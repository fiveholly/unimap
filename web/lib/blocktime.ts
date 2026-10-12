// Roughly which block was mined on a given day, for 找到你生日那天的区块. Heights between these
// known blocks are interpolated linearly, and past the last one at ten minutes a block. Blocks
// came unevenly in the first years, so the answer there can be a day or more off; later it is
// within a few hundred blocks. The page says 大约.

const ANCHORS: [number, number][] = [
  [0, 1231006505], // genesis, 2009-01-03
  [57_043, 1274551200], // pizza day, 2010-05-22 (the hour is approximate)
  [100_000, 1293623863], // 2010-12-29
  [210_000, 1354116278], // first halving, 2012-11-28
  [420_000, 1468082773], // 2016-07-09
  [630_000, 1589225023], // 2020-05-11
  [840_000, 1713571767], // 2024-04-20
];
export const GENESIS_TIME = ANCHORS[0][1];

/** The block mined around unix time t (seconds), or null before the genesis block. */
export function heightAt(t: number): number | null {
  if (t < GENESIS_TIME) return null;
  for (let i = 1; i < ANCHORS.length; i++) {
    const [h0, t0] = ANCHORS[i - 1], [h1, t1] = ANCHORS[i];
    if (t <= t1) return Math.round(h0 + ((t - t0) / (t1 - t0)) * (h1 - h0));
  }
  const [h, t0] = ANCHORS[ANCHORS.length - 1];
  return Math.round(h + (t - t0) / 600);
}

/** The block around noon UTC of a YYYY-MM-DD date, at most tip; null before bitcoin or after tip. */
export function heightOnDay(day: string, tip: number): number | null {
  const t = Date.parse(`${day}T12:00:00Z`) / 1000;
  if (!Number.isFinite(t)) return null;
  const h = heightAt(t);
  return h == null || h > tip + 144 ? null : Math.min(h, tip);
}
