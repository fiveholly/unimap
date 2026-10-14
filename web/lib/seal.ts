// 印章: a district's seal, drawn from its block number alone, so 840000 always stamps the same way.
// The digits become Chinese numerals set in columns, read top to bottom and right to left as on a
// real seal; the outline, the tilt and the worn specks come from a generator seeded with the number.

const NUMERALS = "〇一二三四五六七八九";

/** A small seeded generator (mulberry32): the same n gives the same sequence everywhere. */
function seeded(n: number) {
  let s = (n ^ 0x5eed5eed) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SealGlyph = { ch: string; x: number; y: number; size: number; stretch: number };
export type SealLayout = {
  /** The stamp's outline in a 100x100 box: a square whose corners and edges wander a little. */
  outline: string;
  /** Degrees; a hand-pressed stamp is never quite straight. */
  rotate: number;
  glyphs: SealGlyph[];
  /** Spots where the ink didn't take. */
  specks: { x: number; y: number; r: number }[];
  /** Seed for the rough-edge filter. */
  noise: number;
};

const INSET = 12; // the characters sit inside this margin
const BOX = 100 - INSET * 2;

export function sealLayout(n: number): SealLayout {
  const r = seeded(Math.max(0, Math.floor(n)));
  const j = (amount: number) => (r() - 0.5) * 2 * amount;

  // Corners pulled in or out by up to 2 units, each edge bowed slightly through its midpoint.
  const c = [
    [3 + j(1.5), 3 + j(1.5)],
    [97 + j(1.5), 3 + j(1.5)],
    [97 + j(1.5), 97 + j(1.5)],
    [3 + j(1.5), 97 + j(1.5)],
  ];
  const f = (v: number) => v.toFixed(2);
  let outline = `M${f(c[0][0])} ${f(c[0][1])}`;
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    // Push the midpoint along the edge's outward normal.
    const nx = (b[1] - a[1]) / 94, ny = -(b[0] - a[0]) / 94;
    const bow = j(1.4);
    outline += ` Q${f(mx - nx * bow)} ${f(my - ny * bow)} ${f(b[0])} ${f(b[1])}`;
  }
  outline += " Z";

  const digits = String(Math.max(0, Math.floor(n))).split("").map((d) => NUMERALS[Number(d)]);
  const k = digits.length;
  const cols = Math.ceil(Math.sqrt(k));
  const rows = Math.ceil(k / cols);
  const cw = BOX / cols, ch = BOX / rows;
  const size = Math.min(cw, ch) * 0.98;
  // Seal characters are tall; stretch them to fill a tall cell, but not past 1.6x.
  const stretch = Math.min(1.6, Math.max(1, (ch * 0.94) / size));
  const glyphs: SealGlyph[] = digits.map((d, i) => {
    const col = Math.floor(i / rows);
    const row = i % rows;
    const inCol = Math.min(rows, k - col * rows); // the last column may be short; centre it
    const x = 100 - INSET - cw * (col + 0.5);
    const y = INSET + (BOX - inCol * ch) / 2 + ch * (row + 0.5);
    return { ch: d, x, y, size, stretch };
  });

  const specks = Array.from({ length: 5 + Math.floor(r() * 5) }, () => {
    // Mostly near an edge, where a stamp wears first.
    const edge = Math.floor(r() * 4);
    const along = 6 + r() * 88, depth = 2 + r() * 7;
    const [x, y] = edge === 0 ? [along, depth] : edge === 1 ? [100 - depth, along] : edge === 2 ? [along, 100 - depth] : [depth, along];
    return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), r: Number((0.5 + r() * 1.4).toFixed(2)) };
  });

  return { outline, rotate: Number(j(2.6).toFixed(2)), glyphs, specks, noise: Math.floor(r() * 1000) };
}
