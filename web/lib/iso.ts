// Isometric district tiles: one illustrated building set per zone, drawn as flat polygons.
// A tile is TILE_W x TILE_H; its ground diamond is centred at (CX, CY) and spans 128 x 64.

import { COLORS, styleKey, type DistrictStyle } from "./style";
import type { Zone } from "./zones";

export const TILE_W = 128;
export const TILE_H = 230;
export const CX = 64;
export const CY = 190;
const A = 64;
const B = 32;

type Pt = [number, number];
export type Shape = { pts: Pt[]; fill: string } | { e: [number, number, number, number]; fill: string };

const hash = (n: number) => {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
};
export function rng(seed: number) {
  let s = hash(seed);
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return hash(s) / 4294967296;
  };
}

const iso = (x: number, y: number): Pt => [CX + ((x - y) * A) / 2, CY + ((x + y) * B) / 2];
const up = (p: Pt, h: number): Pt => [p[0], p[1] - h];
const lerp = (p: Pt, q: Pt, u: number): Pt => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];

type Faces = { t?: string; l: string; r: string };
type Roof = { rb: string; lb: string; l: string; r: string };
type Box = { N: Pt; E: Pt; S: Pt; W: Pt; h: number };

class Painter {
  out: Shape[] = [];
  poly(pts: Pt[], fill: string) {
    this.out.push({ pts, fill });
  }
  ell(x: number, y: number, rx: number, ry: number, fill: string) {
    this.out.push({ e: [x, y, rx, ry], fill });
  }
  ground(c: Faces) {
    const g = 0.95;
    const N = iso(-g, -g), E = iso(g, -g), S = iso(g, g), W = iso(-g, g);
    this.poly([W, S, [S[0], S[1] + 8], [W[0], W[1] + 8]], c.l);
    this.poly([S, E, [E[0], E[1] + 8], [S[0], S[1] + 8]], c.r);
    this.poly([N, E, S, W], c.t!);
  }
  box(gx: number, gy: number, w: number, d: number, h: number, c: Faces, z0 = 0): Box {
    const N = up(iso(gx - w, gy - d), z0), E = up(iso(gx + w, gy - d), z0);
    const S = up(iso(gx + w, gy + d), z0), W = up(iso(gx - w, gy + d), z0);
    this.poly([up(W, h), up(S, h), S, W], c.l);
    this.poly([up(S, h), up(E, h), E, S], c.r);
    if (c.t) this.poly([up(N, h), up(E, h), up(S, h), up(W, h)], c.t);
    return { N, E, S, W, h };
  }
  bands(k: Box, from: number, top: number, step: number, th: number, rate: number, r: () => number, on: string, off: string, u0 = 0.12, u1 = 0.88) {
    for (let z = from; z + th <= k.h - top; z += step) {
      for (const [p0, p1] of [[k.W, k.S], [k.S, k.E]] as [Pt, Pt][]) {
        const a = lerp(p0, p1, u0), b = lerp(p0, p1, u1);
        this.poly([up(a, z + th), up(b, z + th), up(b, z), up(a, z)], r() < rate ? on : off);
      }
    }
  }
  roof(k: Box, rh: number, c: Roof, gx: number, gy: number, z0 = 0) {
    const ap = up(iso(gx, gy), z0 + k.h + rh);
    const T = (p: Pt) => up(p, k.h);
    this.poly([T(k.N), T(k.E), ap], c.rb);
    this.poly([T(k.W), T(k.N), ap], c.lb);
    this.poly([T(k.W), T(k.S), ap], c.l);
    this.poly([T(k.S), T(k.E), ap], c.r);
  }
  tree(gx: number, gy: number, s: number) {
    const b = iso(gx, gy);
    this.ell(b[0] + 2.5 * s, b[1] + 0.5, 6.5 * s, 2.6 * s, "rgba(0,0,0,0.28)");
    this.poly([[b[0] - 1.3, b[1]], [b[0] + 1.3, b[1]], [b[0] + 1.3, b[1] - 6 * s], [b[0] - 1.3, b[1] - 6 * s]], "#5A3E28");
    this.ell(b[0], b[1] - 11 * s, 6.5 * s, 7.5 * s, "#3A6E34");
    this.ell(b[0] - 1.8 * s, b[1] - 13 * s, 3.6 * s, 4 * s, "#5C9A4A");
  }
  grass(r: () => number, n: number, col: string) {
    for (let i = 0; i < n; i++) {
      const p = iso(r() * 1.8 - 0.9, r() * 1.8 - 0.9);
      this.poly([[p[0] - 1.6, p[1]], [p[0] + 1.6, p[1]], [p[0] + 0.3, p[1] - 4]], col);
      this.poly([[p[0] + 0.8, p[1]], [p[0] + 3.2, p[1]], [p[0] + 2.8, p[1] - 3]], col);
    }
  }
  mountain(sx: number, sy: number, rr: number, H: number) {
    const W: Pt = [sx - rr, sy], E: Pt = [sx + rr, sy], S: Pt = [sx + rr * 0.1, sy + rr * 0.38], ap: Pt = [sx + rr * 0.08, sy - H];
    this.poly([W, S, ap], "#5C564C");
    this.poly([S, E, ap], "#867D6D");
    this.poly([lerp(ap, W, 0.3), lerp(ap, S, 0.3), ap], "#D3CEC2");
    this.poly([lerp(ap, S, 0.3), lerp(ap, E, 0.3), ap], "#F2EEE6");
  }
}

// Decorations an owner picks (lib/style.ts), in the front corner and along the two front
// edges, drawn last so they stay in view in front of the buildings.
const DECO_SPOTS: [number, number][] = [
  [0.72, 0.72],
  [-0.3, 0.8],
  [0.8, -0.3],
];
function decorate(p: Painter, style: DistrictStyle) {
  const hex = COLORS[style.color]?.hex ?? COLORS.orange.hex;
  style.deco.slice(0, DECO_SPOTS.length).forEach((d, i) => {
    const [gx, gy] = DECO_SPOTS[i];
    const b = iso(gx, gy);
    const shadow = () => p.ell(b[0] + 2, b[1] + 1, 7, 2.6, "rgba(0,0,0,0.3)");
    if (d === "flag") {
      shadow();
      p.poly([[b[0] - 0.8, b[1]], [b[0] + 0.8, b[1]], [b[0] + 0.8, b[1] - 30], [b[0] - 0.8, b[1] - 30]], "#D8D2C4");
      p.poly([[b[0] + 0.8, b[1] - 30], [b[0] + 14, b[1] - 26], [b[0] + 0.8, b[1] - 21]], hex);
    } else if (d === "flowers") {
      p.ell(b[0], b[1], 10, 4.6, "#5A3E28");
      p.ell(b[0], b[1] - 1.2, 9, 4, "#3A6E34");
      for (const [dx, dy] of [[-5, -1.5], [0, -3], [5, -1.5], [-2.5, 0.5], [3, 0.6]]) p.ell(b[0] + dx, b[1] + dy - 1.5, 1.7, 1.4, dx === 0 ? "#F2EEE6" : hex);
    } else if (d === "lamps") {
      for (const dx of [-6, 6]) {
        const x = b[0] + dx, y = b[1] + (dx > 0 ? -2 : 2);
        p.ell(x, y - 18, 5, 4, "rgba(246,198,107,0.22)");
        p.poly([[x - 0.7, y], [x + 0.7, y], [x + 0.7, y - 17], [x - 0.7, y - 17]], "#2E2C28");
        p.ell(x, y - 18, 2.2, 2, "#F6C66B");
      }
    } else if (d === "fountain") {
      p.ell(b[0], b[1], 12, 5.4, "#9A958A");
      p.ell(b[0], b[1] - 1.5, 10, 4.4, "#5BA7D9");
      p.poly([[b[0] - 1.2, b[1] - 1], [b[0] + 1.2, b[1] - 1], [b[0] + 1.2, b[1] - 9], [b[0] - 1.2, b[1] - 9]], "#C9C3B6");
      p.ell(b[0], b[1] - 11, 3.4, 2.8, "rgba(160,210,240,0.85)");
    } else if (d === "statue") {
      shadow();
      p.poly([[b[0] - 5, b[1]], [b[0], b[1] + 2.5], [b[0], b[1] - 4.5], [b[0] - 5, b[1] - 7]], "#8E887C");
      p.poly([[b[0], b[1] + 2.5], [b[0] + 5, b[1]], [b[0] + 5, b[1] - 7], [b[0], b[1] - 4.5]], "#B3AC9E");
      p.poly([[b[0] - 5, b[1] - 7], [b[0], b[1] - 9.5], [b[0] + 5, b[1] - 7], [b[0], b[1] - 4.5]], "#CFC8BA");
      p.poly([[b[0] - 2, b[1] - 8], [b[0] + 2, b[1] - 8], [b[0] + 1.6, b[1] - 20], [b[0] - 1.6, b[1] - 20]], hex);
      p.ell(b[0], b[1] - 22.5, 2.4, 2.6, hex);
    }
  });
}

// Things on a tile are drawn back to front by k = gx + gy.
const inOrder = (items: { k: number; f: () => void }[]) => items.sort((a, b) => a.k - b.k).forEach((i) => i.f());
const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];
const LIT = "#F6C66B";
const OFF = "rgba(10,12,16,0.35)";

// Heights grow with the district's prosperity level (lib/prosperity.ts): 1 is bare land, 3 is
// a settled block, 5 is the busiest skyline. Buildings stop below the tile's top edge.
type Lv = 1 | 2 | 3 | 4 | 5;
const MAX_H = 168;
const cap = (h: number) => Math.min(MAX_H, Math.round(h));

const house = (p: Painter, r: () => number, gx: number, gy: number, w = 0.27) => {
  const roofs = [
    { rb: "#C9714E", lb: "#A9573A", l: "#8E4630", r: "#B85E40" },
    { rb: "#6F7E8C", lb: "#55626F", l: "#47525D", r: "#5E6C79" },
    { rb: "#B98A4E", lb: "#9A6F3A", l: "#7E5A2E", r: "#A07440" },
  ];
  p.roof(p.box(gx, gy, w, w, 12 * (w / 0.27), { l: "#C9BDA6", r: "#E6DCC8" }), 11 * (w / 0.27), pick(r, roofs), gx, gy);
};
const cabin = (p: Painter, gx: number, gy: number) =>
  p.roof(p.box(gx, gy, 0.13, 0.13, 7, { l: "#6E5236", r: "#8A6844" }), 7, { rb: "#5A3E28", lb: "#4A3220", l: "#3E2A1A", r: "#5A3E28" }, gx, gy);
const tower = (p: Painter, r: () => number, gx: number, gy: number, w: number, h: number, c: Faces, rate = 0.55) => {
  const k = p.box(gx, gy, w, w, cap(h), c);
  p.bands(k, 6, 6, 7, 3, rate, r, LIT, OFF);
  return k;
};

const BUILD: Record<Zone, (p: Painter, r: () => number, lv: Lv) => void> = {
  cbd: (p, r, lv) => {
    const glass = [
      { t: "#A7B8C6", l: "#2F3C4A", r: "#4A5D70" },
      { t: "#CFC5B3", l: "#46423C", r: "#6B655B" },
      { t: "#8EA6A0", l: "#2C3D3A", r: "#476260" },
    ];
    if (lv === 1) {
      // A building site: a concrete core and a crane.
      p.box(-0.2, -0.2, 0.42, 0.42, 4, { t: "#8D877C", l: "#5A554D", r: "#6F695F" });
      p.box(-0.2, -0.2, 0.18, 0.18, 26, { t: "#A39D92", l: "#615C54", r: "#7D776D" }, 4);
      const base = iso(0.55, 0.45), top = up(base, 92), arm = [top[0] - 44, top[1] + 4] as Pt;
      p.poly([[base[0] - 1.2, base[1]], [base[0] + 1.2, base[1]], [top[0] + 1.2, top[1]], [top[0] - 1.2, top[1]]], "#E2A93B");
      p.poly([[arm[0], arm[1] - 1.5], [top[0] + 14, top[1] - 1.5], [top[0] + 14, top[1] + 1.5], [arm[0], arm[1] + 1.5]], "#E2A93B");
      p.poly([[arm[0] + 6, arm[1]], [arm[0] + 7, arm[1]], [arm[0] + 7, arm[1] + 30], [arm[0] + 6, arm[1] + 30]], "#9A8F7A");
      return;
    }
    const f = { 2: 0.42, 3: 0.65, 4: 1, 5: 1.12 }[lv];
    const spots: [number, number, number][] = [[-0.5, -0.5, 150], [0.5, -0.5, 112], [-0.5, 0.5, 96], [0.5, 0.5, 66]];
    inOrder(
      spots.slice(0, lv === 2 ? 2 : 4).map(([gx, gy, h0], i) => ({
        k: gx + gy,
        f: () => {
          const h = cap(h0 * f * (0.8 + 0.35 * r()));
          tower(p, r, gx, gy, 0.34, h, pick(r, glass), 0.6);
          if (i === 0 && lv >= 4) {
            const tp = up(iso(gx, gy), h + 16), bt = up(iso(gx, gy), h);
            p.poly([[bt[0] - 0.8, bt[1]], [bt[0] + 0.8, bt[1]], [tp[0] + 0.4, tp[1]], [tp[0] - 0.4, tp[1]]], "#C9D2DA");
            p.ell(tp[0], tp[1], 1.8, 1.8, "#FF6A4D");
          }
        },
      })),
    );
  },
  commercial: (p, r, lv) => {
    const walls = [
      { t: "#B98F5E", l: "#7A5A3A", r: "#9A7450" },
      { t: "#CDBFA2", l: "#857660", r: "#A6957A" },
      { t: "#B0735A", l: "#6E4532", r: "#8C5840" },
    ];
    const awnings = ["#C2553D", "#3D8C86", "#D9A441"];
    const shop = (gx: number, gy: number, w: number, h: number) => {
      const k = p.box(gx, gy, w, w, cap(h), pick(r, walls));
      const a = pick(r, awnings);
      for (const [p0, p1] of [[k.W, k.S], [k.S, k.E]] as [Pt, Pt][]) {
        const s = lerp(p0, p1, 0.08), e = lerp(p0, p1, 0.92);
        p.poly([up(s, Math.min(12, h)), up(e, Math.min(12, h)), [e[0], e[1] - Math.min(7, h - 2)], [s[0], s[1] - Math.min(7, h - 2)]], a);
        if (h > 10) p.poly([up(s, 6), up(e, 6), e, s], "rgba(20,14,8,0.55)");
      }
      if (h > 20) p.bands(k, 17, 5, 8, 3, 0.45, r, LIT, OFF);
    };
    if (lv === 1) {
      p.grass(r, 6, "#8C8A5C");
      inOrder([[-0.4, -0.3], [0.35, -0.35], [-0.2, 0.45]].map(([gx, gy]) => ({ k: gx + gy, f: () => shop(gx, gy, 0.2, 9) })));
      return;
    }
    const f = { 2: 0.7, 3: 1, 4: 1.6, 5: 1.9 }[lv];
    const spots: [number, number, number][] = [[-0.48, -0.48, 46], [0.5, -0.45, 34], [-0.45, 0.5, 30], [0.5, 0.5, 20]];
    inOrder(
      spots.slice(0, lv === 2 ? 2 : 4).map(([gx, gy, h0], i) => ({
        k: gx + gy,
        f: () =>
          lv === 5 && i === 0
            ? tower(p, r, gx, gy, 0.38, 132, { t: "#CDBFA2", l: "#6E6352", r: "#8F826C" })
            : shop(gx, gy, 0.38, h0 * f * (0.85 + 0.3 * r())),
      })),
    );
  },
  residential: (p, r, lv) => {
    const spots: [number, number][] = [[-0.5, -0.45], [0.48, -0.52], [-0.5, 0.48], [0.45, 0.5]];
    if (lv === 1) {
      p.grass(r, 16, "#76A257");
      inOrder([{ k: -0.6, f: () => p.tree(-0.4, -0.2, 0.9) }, { k: 0.3, f: () => p.tree(0.5, -0.2, 0.7) }, { k: 0.9, f: () => p.tree(0.1, 0.8, 0.8) }]);
      return;
    }
    p.grass(r, lv >= 4 ? 4 : 8, "#76A257");
    const flat = [
      { t: "#D9CDB4", l: "#9C8F76", r: "#BDAF93" },
      { t: "#C99B7E", l: "#8A5E46", r: "#AA765A" },
      { t: "#BFC3B8", l: "#7C8177", r: "#9CA196" },
    ];
    const items = spots.slice(0, lv === 2 ? 2 : 4).map(([gx, gy], i) => ({
      k: gx + gy,
      f: () => {
        if (lv === 3 || lv === 2 || (lv === 4 && i >= 2)) return house(p, r, gx, gy);
        const h = lv === 4 ? 34 + 10 * r() : 62 + 34 * r() - i * 6;
        tower(p, r, gx, gy, 0.3, h, pick(r, flat), 0.5);
      },
    }));
    items.push({ k: 0, f: () => p.tree(0, 0, 0.9) });
    if (lv <= 3) items.push({ k: 0.05, f: () => p.tree(0.9, -0.85, 0.75) });
    inOrder(items);
  },
  villa: (p, r, lv) => {
    p.grass(r, 22, "#6DAA52");
    const white = { t: "#EFEAE0", l: "#B9B2A4", r: "#D9D3C7" };
    const trees = [
      { k: -1.4, f: () => p.tree(0.75, -0.85, 1) },
      { k: -0.25, f: () => p.tree(-0.85, 0.6, 1.1) },
      { k: 0.65, f: () => p.tree(0.85, -0.2, 0.85) },
      { k: 0.8, f: () => p.tree(-0.1, 0.9, 0.9) },
    ];
    if (lv === 1) return inOrder(trees);
    if (lv === 2) return inOrder([{ k: -0.6, f: () => house(p, r, -0.3, -0.3, 0.3) }, ...trees]);
    const big = lv >= 4 ? 1.25 : 1;
    const pool = (x0: number, y0: number, x1: number, y1: number) => {
      p.poly([iso(x0 - 0.08, y0 - 0.08), iso(x1 + 0.08, y0 - 0.08), iso(x1 + 0.08, y1 + 0.08), iso(x0 - 0.08, y1 + 0.08)], "#E6E0D2");
      p.poly([iso(x0, y0), iso(x1, y0), iso(x1, y1), iso(x0, y1)], "#4FB3C9");
      p.poly([iso(x0, y0), iso(x1, y0), iso(x1 - 0.12, y0 + 0.12), iso(x0, y0 + 0.12)], "#7FD0DE");
    };
    inOrder([
      {
        k: -0.6,
        f: () => {
          const k = p.box(-0.3, -0.3, 0.46 * big, 0.34 * big, 18 * big, white);
          const s = lerp(k.S, k.E, 0.1), e = lerp(k.S, k.E, 0.9);
          p.poly([up(s, 14 * big), up(e, 14 * big), up(e, 4), up(s, 4)], "#2E3E4A");
          const k2 = p.box(-0.42, -0.4, 0.28 * big, 0.22 * big, 13 * big, white, 18 * big);
          const s2 = lerp(k2.W, k2.S, 0.15), e2 = lerp(k2.W, k2.S, 0.85);
          p.poly([up(s2, 10 * big), up(e2, 10 * big), up(e2, 3), up(s2, 3)], "#2E3E4A");
          if (lv === 5) {
            const k3 = p.box(-0.62, -0.62, 0.16, 0.16, 26, white, 18 * big + 13 * big);
            p.roof(k3, 12, { rb: "#C9A24E", lb: "#B08A3A", l: "#8E6E2C", r: "#C49A40" }, -0.62, -0.62, 18 * big + 13 * big);
          }
        },
      },
      { k: 1.0, f: () => pool(0.2, 0.38, 0.78, 0.82) },
      ...(lv === 5 ? [{ k: 1.2, f: () => p.ell(iso(-0.55, 0.62)[0], iso(-0.55, 0.62)[1], 7, 3.5, "#7FD0DE") }] : []),
      ...trees,
    ]);
  },
  data: (p, r, lv) => {
    const hall = { t: "#7F93A7", l: "#3F4F60", r: "#56697E" };
    const led = "#7FD1E8", dark = "rgba(10,14,20,0.35)";
    if (lv === 1) {
      p.grass(r, 6, "#7C8A6A");
      p.bands(p.box(0, 0, 0.26, 0.2, 9, hall), 3, 2, 4, 2, 0.6, r, led, dark, 0.1, 0.9);
      return;
    }
    const f = lv === 5 ? 1.6 : 1;
    const chimney = (gx: number, gy: number, h: number) => {
      p.box(gx, gy, 0.13, 0.13, h, { t: "#A9A39A", l: "#5E5952", r: "#7E786F" });
      const tp = up(iso(gx, gy), h + 6);
      p.ell(tp[0] + 4, tp[1] - 6, 8, 6, "rgba(230,230,230,0.22)");
      p.ell(tp[0] + 10, tp[1] - 14, 10, 7, "rgba(230,230,230,0.14)");
    };
    const items = [
      {
        k: -0.6,
        f: () => {
          const k = p.box(-0.15, -0.5, 0.75, 0.3, 18 * f, hall);
          p.bands(k, 5, 4, 6, 2, 0.7, r, led, dark, 0.06, 0.94);
          for (let i = 0; i < 3; i++) p.box(-0.6 + i * 0.42, -0.5, 0.1, 0.12, 5, { t: "#9AABBC", l: "#55687C", r: "#6D8196" }, 18 * f);
        },
      },
    ];
    if (lv >= 3) items.push({ k: 0.5, f: () => p.bands(p.box(0.3, 0.38, 0.55, 0.32, 13 * f, hall), 4, 3, 5, 2, 0.6, r, led, dark, 0.06, 0.94) });
    if (lv >= 4) items.push({ k: -0.1, f: () => chimney(-0.65, 0.55, 40 * f) });
    if (lv >= 5) items.push({ k: 0.2, f: () => chimney(-0.85, 0.2, 52) });
    inOrder(items);
  },
  landmark: (p, _r, lv) => {
    p.poly([iso(-0.65, -0.65), iso(0.65, -0.65), iso(0.65, 0.65), iso(-0.65, 0.65)], "#B8944C");
    const flag = (gx: number, gy: number) => {
      const b = iso(gx, gy), t = up(b, 30);
      p.poly([[b[0] - 0.7, b[1]], [b[0] + 0.7, b[1]], [t[0] + 0.7, t[1]], [t[0] - 0.7, t[1]]], "#D8D0BC");
      p.poly([t, [t[0] + 10, t[1] + 3], [t[0], t[1] + 7]], "#F7931A");
    };
    inOrder([
      { k: -1.6, f: () => p.tree(-0.8, -0.8, 0.8) },
      {
        k: 0,
        f: () => {
          p.box(0, 0, 0.34, 0.34, 8, { t: "#E0D2AC", l: "#8C7B55", r: "#B09C70" });
          const ob = p.box(0, 0, 0.13, 0.13, lv >= 5 ? 156 : 140, { t: "#F3D27A", l: "#9A7425", r: "#C9982F" }, 8);
          p.roof(ob, 16, { rb: "#FBE3A0", lb: "#E2BC5C", l: "#B08524", r: "#E7B946" }, 0, 0, 8);
        },
      },
      ...(lv >= 4 ? [{ k: -0.9, f: () => flag(0.55, -0.55) }, { k: -0.85, f: () => flag(-0.55, 0.55) }] : []),
      { k: 0.1, f: () => p.tree(0.85, -0.75, 0.8) },
      { k: 0.15, f: () => p.tree(-0.75, 0.85, 0.8) },
      { k: 1.6, f: () => p.tree(0.8, 0.8, 0.8) },
    ]);
  },
  mountain: (p, r, lv) => {
    p.grass(r, 7, "#8A8758");
    p.mountain(44, 194, 32, 58);
    p.mountain(88, 198, 26, 42);
    p.mountain(66, 214, 20, 24);
    if (lv === 1) {
      p.ell(30, 214, 4, 2.5, "#7A7466");
      p.ell(98, 214, 3, 2, "#7A7466");
      return;
    }
    if (lv >= 4) {
      // A cable car from the valley to the high peak.
      const a: Pt = [44, 138], b: Pt = [104, 206];
      p.poly([[a[0], a[1] - 0.6], [b[0], b[1] - 0.6], [b[0], b[1] + 0.6], [a[0], a[1] + 0.6]], "#3A342C");
      const c = lerp(a, b, 0.45);
      p.poly([[c[0] - 3, c[1] + 2], [c[0] + 3, c[1] + 2], [c[0] + 3, c[1] + 7], [c[0] - 3, c[1] + 7]], "#C2553D");
    }
    const cabins: [number, number][] = [[0.62, 0.55], [-0.6, 0.72], [0.15, 0.85], [0.8, 0.15]];
    inOrder([
      ...cabins.slice(0, lv === 2 ? 1 : lv === 3 ? 3 : 4).map(([gx, gy]) => ({ k: gx + gy, f: () => cabin(p, gx, gy) })),
      ...(lv >= 3 ? [{ k: 0.9, f: () => p.tree(-0.2, 0.75, 0.6) }, { k: 1.1, f: () => p.tree(0.5, 0.85, 0.55) }] : []),
      ...(lv === 5
        ? [{ k: 1.3, f: () => p.bands(p.box(0.55, 0.62, 0.3, 0.2, 24, { t: "#E6DCC8", l: "#8E7E62", r: "#B3A282" }), 5, 4, 6, 3, 0.8, r, LIT, OFF) }]
        : []),
    ]);
  },
};

export const GROUND: Record<Zone | "unknown", Faces & { t: string }> = {
  cbd: { t: "#4B4842", l: "#2A2824", r: "#3A3833" },
  commercial: { t: "#6E5D46", l: "#3A2E20", r: "#4A3B2A" },
  residential: { t: "#5C8743", l: "#3E3020", r: "#4E3C28" },
  villa: { t: "#4F8A3E", l: "#3E3020", r: "#4E3C28" },
  data: { t: "#3E4A56", l: "#232A31", r: "#2E363F" },
  landmark: { t: "#9C7A3A", l: "#5A4520", r: "#6E5428" },
  mountain: { t: "#6B6844", l: "#3E3424", r: "#4C4130" },
  unknown: { t: "#2A2823", l: "#1A1916", r: "#22201C" },
};

/** The ground of a park member (lib/parks.ts): one paved plaza across the whole park. */
export const PAVED: Faces & { t: string } = { t: "#A8977A", l: "#5A4C38", r: "#6E5E46" };

/** Shapes of one tile. variant picks heights and colours, so neighbours differ. */
export function tileShapes(zone: Zone | null, variant: number, level: Lv = 3, style: DistrictStyle | null = null, paved = false): Shape[] {
  const p = new Painter();
  p.ground(paved ? PAVED : GROUND[zone ?? "unknown"]);
  if (zone) BUILD[zone](p, rng(variant), level);
  if (style?.deco.length) decorate(p, style);
  return p.out;
}

export function drawShapes(ctx: CanvasRenderingContext2D, shapes: Shape[]) {
  for (const s of shapes) {
    ctx.fillStyle = s.fill;
    ctx.beginPath();
    if ("pts" in s) {
      ctx.moveTo(s.pts[0][0], s.pts[0][1]);
      for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0], s.pts[i][1]);
      ctx.closePath();
    } else {
      ctx.ellipse(s.e[0], s.e[1], s.e[2], s.e[3], 0, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

export const VARIANTS = 6;
const sprites = new Map<string, HTMLCanvasElement>();

/** A pre-rendered tile image at `res` pixels per tile unit, cached. level is the district's
 * prosperity level; districts without one look settled (3). */
export function tileSprite(
  zone: Zone | null,
  n: number,
  res: number,
  level: number | null = null,
  style: DistrictStyle | null = null,
  paved = false,
): HTMLCanvasElement {
  const variant = hash(n) % VARIANTS;
  const lv = (level != null && level >= 1 && level <= 5 ? Math.round(level) : 3) as Lv;
  const key = `${zone}:${variant}:${res}:${lv}:${styleKey(style)}:${paved ? "p" : ""}`;
  let c = sprites.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = Math.ceil(TILE_W * res);
    c.height = Math.ceil(TILE_H * res);
    const ctx = c.getContext("2d")!;
    ctx.scale(res, res);
    drawShapes(ctx, tileShapes(zone, 9000 + variant, lv, style, paved));
    sprites.set(key, c);
  }
  return c;
}
