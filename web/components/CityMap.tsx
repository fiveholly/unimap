"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { short } from "./Session";
import { api, type Land, type Tile } from "@/lib/api";
import { CX, CY, GROUND, PAVED, rng, TILE_H, TILE_W, tileSprite } from "@/lib/iso";
import { layout } from "@/lib/mondrian";
import { side } from "@/lib/parks";
import { LANDMARKS, ZONE_ORDER, ZONES, zoneOf, type Zone } from "@/lib/zones";

// Blocks are grouped into quarters of 8 x 8, laid out like a city's street grid: inside a
// quarter consecutive blocks run along its rows, and every quarter has a street along two of its
// edges, so neighbouring quarters are always a street apart and four streets meet at a small
// park. Quarters sit on a staggered grid, QUARTERS to a row.
const SIDE = 8; // blocks along a quarter's edge
const CELL = SIDE + 1; // cells along its edge, with the street
const QUARTERS = 24;
const QW = CELL * 128; // a quarter's width, and its rows' half height and pitch:
const QH = CELL * 32;
const PER_Q = SIDE * SIDE;
const CHUNK = 1000; // blocks per /v1/land request (the API's maximum)
const MIN_SCALE = 0.05;
const MAX_SCALE = 4;
// Three levels of detail. Zoomed out, each quarter of SIDE x SIDE blocks is drawn as one
// cluster of 3 x 3 buildings in the mix of zones those blocks are in. In the middle each block is a building tile. Zoomed right in,
// the buildings fade into the block's parcels (one plot per transaction, as on the district page).
const AREA_SCALE = 0.3;
const SLOTS = 3;
const COMPACT_SCALE = 0.11; // below this an area tile is a single building
const PARCEL_FADE = [1.9, 2.5] as const;
const PARCEL_FETCH_LIMIT = 80; // never fetch parcels for more tiles than this at once
const PLAN = 384; // px of a cached parcel plan

type Level = "area" | "block" | "parcel";
const LEVELS: [Level, string][] = [
  ["area", "城区"],
  ["block", "街区"],
  ["parcel", "地块"],
];
const levelOf = (s: number): Level => (s < AREA_SCALE ? "area" : s < PARCEL_FADE[0] ? "block" : "parcel");
/** Blocks fill the view a few columns across, so every building is legible. */
const defaultScale = (w: number) => Math.min(1.6, Math.max(0.45, w / ((w < 600 ? 2.6 : 5.5) * 128)));
const LEVEL_SCALE: Record<Level, (w: number) => number> = { area: () => 0.16, block: defaultScale, parcel: () => 2.8 };

const shade = (hex: string, f: number) => {
  const v = parseInt(hex.slice(1, 7), 16);
  const ch = (x: number) => Math.round(f < 0 ? x * (1 + f) : x + (255 - x) * f);
  return `rgb(${ch(v >> 16)},${ch((v >> 8) & 255)},${ch(v & 255)})`;
};

/** A block's land: plots marked out on its ground (a unit square, skewed onto the tile
 * when drawn), and the claimed plots as boxes [u0, v0, u1, v1, height] standing on them. */
type Plan = { ground: HTMLCanvasElement; claimed: [number, number, number, number, number][]; colors: [string, string, string] };

function parcelPlan(txValues: number[], claimed: Set<number>, zone: Zone | null): Plan {
  const { squares, width, height } = layout(txValues);
  const extent = Math.max(width, height, 1);
  const k = PLAN / extent, dx = (extent - width) / 2;
  const gap = Math.max(1, Math.min(0.25, extent / 400 + 0.08) * k) / 2;
  const g = GROUND[zone ?? "unknown"].t;
  const cv = document.createElement("canvas");
  cv.width = cv.height = PLAN;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = shade(g, -0.3); // the paths between plots
  ctx.fillRect(0, 0, PLAN, PLAN);
  const boxes: Plan["claimed"] = [];
  squares.forEach((q, i) => {
    const x = (dx + q.x) * k + gap, y = q.y * k + gap, r = q.r * k - 2 * gap;
    ctx.fillStyle = shade(g, i % 3 === 0 ? 0.06 : i % 3 === 1 ? 0 : -0.06);
    ctx.fillRect(x, y, r, r);
    if (claimed.has(i)) boxes.push([x / PLAN, y / PLAN, (x + r) / PLAN, (y + r) / PLAN, Math.min(16, 3 + (q.r / extent) * 40)]);
  });
  // Back to front, so nearer boxes cover farther ones.
  boxes.sort((p, q) => p[0] + p[1] - (q[0] + q[1]));
  const base = zone && zone !== "residential" && zone !== "villa" ? ZONES[zone].color : "#E9DFC9";
  return { ground: cv, claimed: boxes, colors: [shade(base, 0.1), shade(base, -0.3), shade(base, -0.15)] };
}

type View = { x: number; y: number; s: number };

const STREET = "#2E2C28";
const AREA_LABEL = 1;

/** A street cell: asphalt a little below the blocks' ground, with a dashed centre line along it
 * (road 1 runs along a quarter's v axis, 2 along its u axis); where streets cross (3), a small
 * park with a tree. */
/** A street cell (1: along u, 2: along v, 3: the park where they cross), or 4: a lot for a
 * block that hasn't been mined yet. */
function drawStreet(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, road: 1 | 2 | 3 | 4) {
  const d = (hw: number, hh: number, dy = 0) => {
    ctx.beginPath();
    ctx.moveTo(x, y - hh + dy);
    ctx.lineTo(x + hw, y + dy);
    ctx.lineTo(x, y + hh + dy);
    ctx.lineTo(x - hw, y + dy);
    ctx.closePath();
  };
  if (road === 4) {
    ctx.fillStyle = "#1A1916";
    d(58 * s, 29 * s, 6 * s);
    ctx.fill();
    ctx.setLineDash([4 * s, 4 * s]);
    ctx.strokeStyle = "#3A362F";
    ctx.lineWidth = Math.max(1, s);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  ctx.fillStyle = STREET;
  d(64.5 * s, 32.5 * s, 6 * s);
  ctx.fill();
  if (road === 3) {
    ctx.fillStyle = "#4C7A3C";
    d(40 * s, 20 * s, 4 * s);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(x + 3 * s, y + 5 * s, 9 * s, 4 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5A3E28";
    ctx.fillRect(x - 1.5 * s, y - 6 * s, 3 * s, 10 * s);
    ctx.fillStyle = "#3A6E34";
    ctx.beginPath();
    ctx.ellipse(x, y - 13 * s, 9 * s, 10 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5C9A4A";
    ctx.beginPath();
    ctx.ellipse(x - 2.5 * s, y - 16 * s, 5 * s, 5.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Dashes along the street's direction.
  const [ux, uy] = road === 1 ? [-64, 32] : [64, 32];
  ctx.strokeStyle = "rgba(230,214,170,0.55)";
  ctx.lineWidth = Math.max(0.6, 1.6 * s);
  ctx.setLineDash([9 * s, 9 * s]);
  ctx.beginPath();
  ctx.moveTo(x - ux * 0.5 * s, y + 6 * s - uy * 0.5 * s);
  ctx.lineTo(x + ux * 0.5 * s, y + 6 * s + uy * 0.5 * s);
  ctx.stroke();
  ctx.setLineDash([]);
} // world point at the canvas centre, and zoom

const quarterCentre = (q: number): [number, number] => {
  const qc = q % QUARTERS, qr = Math.floor(q / QUARTERS);
  return [qc * QW + (qr & 1) * (QW / 2) + QW / 2, qr * QH + QH];
};
/** Ground centre of cell (u, v) of quarter q; cells 0..7 are blocks, 8 is the street. */
const cellCentre = (q: number, u: number, v: number): [number, number] => {
  const [cx, cy] = quarterCentre(q);
  return [cx + (u - v) * 64, cy - QH + (u + v + 1) * 32];
};
const centre = (n: number): [number, number] => {
  const i = n % PER_Q;
  return cellCentre(Math.floor(n / PER_Q), i % SIDE, Math.floor(i / SIDE));
};
const origin = (n: number): [number, number] => {
  const [x, y] = centre(n);
  return [x - CX, y - CY];
};

/** Keep the map on screen: no panning past its edges, centred when smaller than the view. */
function clamp(v: View, w: number, h: number, tip: number): View {
  const fit = (pos: number, half: number, lo: number, hi: number) =>
    hi - lo <= 2 * half ? (lo + hi) / 2 : Math.min(hi - half, Math.max(lo + half, pos));
  const rows = Math.floor(Math.floor(tip / PER_Q) / QUARTERS) + 1;
  return {
    s: v.s,
    x: fit(v.x, w / 2 / v.s, 0, QUARTERS * QW + QW / 2),
    y: fit(v.y, h / 2 / v.s, -120, rows * QH + QH),
  };
}

export function CityMap({ tip, focus }: { tip: number; focus: number }) {
  const router = useRouter();
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // s = 0 until the first draw knows the canvas width.
  const view = useRef<View>({ x: centre(focus)[0], y: centre(focus)[1] - 30, s: 0 });
  const tiles = useRef(new Map<number, Tile>());
  const chunks = useRef(new Set<number>());
  const areas = useRef(new Map<number, { slots: (Zone | null)[]; level: number | null }>()); // each fully loaded quarter
  const plans = useRef(new Map<number, Plan | "loading" | "failed">());
  const parkNames = useRef(new Map<number, string | null>()); // null while loading
  const [level, setLevel] = useState<Level>("block");
  const hover = useRef<number | null>(null);
  const frame = useRef(0);
  const [selected, setSelected] = useState<number>(focus);
  const selectedRef = useRef(focus);
  const [, setLoaded] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const draw = useCallback(() => {
    frame.current = 0;
    const cv = canvas.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!view.current.s) view.current.s = defaultScale(w);
    view.current = clamp(view.current, w, h, tip);
    const { x: vx, y: vy, s } = view.current;
    const toWorld = (sx: number, sy: number): [number, number] => [vx + (sx - w / 2) / s, vy + (sy - h / 2) / s];
    const toScreen = (wx: number, wy: number): [number, number] => [(wx - vx) * s + w / 2, (wy - vy) * s + h / 2];
    const lvl = levelOf(s);
    setLevel(lvl);

    // Quarter rows on screen; buildings rise up to a tile height above their ground.
    const [, y0] = toWorld(0, 0), [, y1] = toWorld(w, h + TILE_H * s);
    const lastQ = Math.floor(tip / PER_Q);
    const qrMin = Math.max(0, Math.floor((y0 - QH) / QH) - 1), qrMax = Math.min(Math.floor(lastQ / QUARTERS), Math.ceil(y1 / QH) + 1);
    const quarters: number[] = [];
    for (let qr = qrMin; qr <= qrMax; qr++)
      for (let qc = 0; qc < QUARTERS; qc++) {
        const q = qr * QUARTERS + qc;
        if (q > lastQ) continue;
        const [cx, cy] = toScreen(...quarterCentre(q));
        if (cx + (QW / 2) * s < 0 || cx - (QW / 2) * s > w || cy - QH * s > h || cy + QH * s < 0) continue;
        quarters.push(q);
      }
    const want = new Set<number>();
    const labels: [number, number, string, "landmark" | "park"][] = [];
    const parkCells = new Map<number, [number, number][]>(); // park id -> screen centres of its members
    // A park's outline goes over everything at the end, like a territory line in a game:
    // drawn at ground level it would hide behind the tall buildings in front.
    const borders: [[number, number], [number, number]][] = [];
    /** Collect a park member's edges that face outside the park. */
    const parkBorder = (n: number, park: number, x: number, y: number) => {
      const N: [number, number] = [x, y - 30 * s], E: [number, number] = [x + 60 * s, y], S: [number, number] = [x, y + 30 * s], W: [number, number] = [x - 60 * s, y];
      const sides: [number, number, [number, number], [number, number]][] = [
        [1, 0, E, S],
        [-1, 0, N, W],
        [0, 1, S, W],
        [0, -1, N, E],
      ];
      for (const [du, dv, p0, p1] of sides) {
        const m = side(n, du, dv);
        // Across a street the outline stays: it marks the park's edge on each side of the road.
        if (m === null || tiles.current.get(m)?.park !== park || Math.floor(m / PER_Q) !== Math.floor(n / PER_Q)) borders.push([p0, p1]);
      }
    };
    const diamond = (x: number, y: number, hw: number, hh: number) => {
      ctx.beginPath();
      ctx.moveTo(x, y - hh);
      ctx.lineTo(x + hw, y);
      ctx.lineTo(x, y + hh);
      ctx.lineTo(x - hw, y);
      ctx.closePath();
    };
    const resFor = (k: number) => (s * k * dpr > 1.2 ? 2 : s * k * dpr > 0.6 ? 1 : 0.5);
    for (const [n, name] of Object.entries(LANDMARKS)) {
      if (+n > tip) continue;
      const [lx, ly] = toScreen(...centre(+n));
      if (lx > -60 && lx < w + 60 && ly > -40 && ly < h + 40) labels.push([lx, ly - (lvl === "area" ? 46 * AREA_LABEL * s : 150 * s), name, "landmark"]);
    }

    if (lvl === "area") {
      // Each quarter: its streets, then nine buildings in the mix of zones of its 64 blocks.
      for (const q of quarters) {
        const [cx, cy] = toScreen(...quarterCentre(q));
        ctx.fillStyle = STREET;
        diamond(cx, cy, (QW / 2) * s, QH * s);
        ctx.fill();
        let info = areas.current.get(q);
        if (!info) {
          const count = new Map<Zone, number>();
          let missing = false, total = 0, landmark = false, levels = 0, leveled = 0;
          for (let n = q * PER_Q; n < (q + 1) * PER_Q && n <= tip; n++) {
            total++;
            const t = tiles.current.get(n);
            if (!t) {
              missing = true;
              want.add(Math.floor(n / CHUNK));
              continue;
            }
            const z = zoneOf(t.zone);
            if (t.level != null) {
              levels += t.level;
              leveled++;
            }
            if (z === "landmark") landmark = true;
            else if (z) count.set(z, (count.get(z) ?? 0) + 1);
          }
          const slots: (Zone | null)[] = [];
          const known = [...count.values()].reduce((x, y) => x + y, 0);
          if (known > 0) {
            // Share out the nine plots by largest remainder, then shuffle them into place.
            const n9 = Math.max(1, Math.round((SLOTS * SLOTS * total) / PER_Q));
            const quota = ZONE_ORDER.filter((z) => count.has(z)).map((z) => ({ z, q: (count.get(z)! / known) * n9 }));
            for (const { z, q: k } of quota) for (let i = 0; i < Math.floor(k); i++) slots.push(z);
            quota.sort((a, b) => (b.q % 1) - (a.q % 1));
            for (let i = 0; slots.length < n9 && i < quota.length; i++) slots.push(quota[i].z);
            const rand = rng(q);
            for (let i = slots.length - 1; i > 0; i--) {
              const j = Math.floor(rand() * (i + 1));
              [slots[i], slots[j]] = [slots[j], slots[i]];
            }
            if (landmark) slots[Math.min(4, slots.length - 1)] = "landmark";
          }
          info = { slots, level: leveled ? Math.round(levels / leveled) : null };
          if (!missing) areas.current.set(q, info);
        }
        const [icx, icy] = toScreen(...cellCentre(q, 3.5, 3.5));
        if (!info.slots.length) continue;
        if (s < COMPACT_SCALE) {
          // Too small for nine: one building, of the zone with the most plots.
          const tally = new Map<Zone | null, number>();
          for (const z of info.slots) tally.set(z, (tally.get(z) ?? 0) + 1);
          const zone = info.slots.includes("landmark") ? "landmark" : [...tally].sort((a, b) => b[1] - a[1])[0][0];
          const k = SIDE;
          ctx.drawImage(tileSprite(zone, q, resFor(k), info.level), icx - CX * k * s, icy - CY * k * s, TILE_W * k * s, TILE_H * k * s);
          continue;
        }
        const k = SIDE / SLOTS;
        for (const idx of [0, 1, 3, 2, 4, 6, 5, 7, 8]) {
          const i = idx % SLOTS, j = Math.floor(idx / SLOTS);
          const zone = idx < info.slots.length ? info.slots[idx] : null;
          if (!zone) continue;
          const px = icx + ((i - j) * SIDE * 64 * s) / SLOTS, py = icy - SIDE * 32 * s + ((i + j + 1) * SIDE * 32 * s) / SLOTS;
          ctx.drawImage(tileSprite(zone, q * 9 + idx, resFor(k), info.level), px - CX * k * s, py - CY * k * s, TILE_W * k * s, TILE_H * k * s);
        }
      }
    } else {
      const fade = Math.min(1, Math.max(0, (s - PARCEL_FADE[0]) / (PARCEL_FADE[1] - PARCEL_FADE[0])));
      const res = resFor(1);
      const visible: number[] = [];
      // Every cell on screen, blocks and streets, drawn back to front.
      type Cell = { y: number; x: number; n: number | null; road: 0 | 1 | 2 | 3 | 4 };
      const cells: Cell[] = [];
      for (const q of quarters)
        for (let v = 0; v < CELL; v++)
          for (let u = 0; u < CELL; u++) {
            const [wx, wy] = cellCentre(q, u, v);
            const [x, y] = toScreen(wx, wy);
            if (x < -64 * s || x > w + 64 * s || y < -32 * s || y - (CY - 0) * s > h) continue;
            const n = u < SIDE && v < SIDE ? q * PER_Q + v * SIDE + u : null;
            if (n != null && n > tip) cells.push({ x, y, n: null, road: 4 });
            else cells.push({ x, y, n, road: n != null ? 0 : u === SIDE && v === SIDE ? 3 : u === SIDE ? 1 : 2 });
          }
      cells.sort((a, b) => a.y - b.y || a.x - b.x);
      for (const c of cells) {
        if (c.n == null) {
          drawStreet(ctx, c.x, c.y, s, c.road as 1 | 2 | 3 | 4);
          continue;
        }
        const n = c.n;
        const sx = c.x - CX * s, sy = c.y - CY * s;
        visible.push(n);
        const t = tiles.current.get(n);
        if (!t) want.add(Math.floor(n / CHUNK));
        const zone = zoneOf(t?.zone);
        const plan = fade > 0 ? plans.current.get(n) : undefined;
        const sprite = () => tileSprite(zone, n, res, t?.level ?? null, t?.style ?? null, t?.park != null);
        if (t?.park != null) {
          // Park members stand on one paved plaza: fill the seams between their tiles too.
          ctx.fillStyle = PAVED.t;
          diamond(c.x, c.y, 64.5 * s, 32.5 * s);
          ctx.fill();
          const list = parkCells.get(t.park) ?? [];
          list.push([c.x, c.y]);
          parkCells.set(t.park, list);
        }
        if (plan && typeof plan === "object") {
          // A bare slab with the plots on top: map the unit square onto the ground diamond.
          const g = GROUND[zone ?? "unknown"];
          const P = (u: number, v: number): [number, number] => [sx + (64 + (u - v) * 60) * s, sy + (CY - 30 + (u + v) * 30) * s];
          const poly = (pts: [number, number][], fill: string) => {
            ctx.fillStyle = fill;
            ctx.beginPath();
            ctx.moveTo(...pts[0]);
            for (const q of pts.slice(1)) ctx.lineTo(...q);
            ctx.closePath();
            ctx.fill();
          };
          const down = ([x, y]: [number, number], d: number): [number, number] => [x, y + d * s];
          poly([P(0, 1), P(1, 1), down(P(1, 1), 8), down(P(0, 1), 8)], g.l);
          poly([P(1, 1), P(1, 0), down(P(1, 0), 8), down(P(1, 1), 8)], g.r);
          ctx.save();
          ctx.setTransform((dpr * 60 * s) / PLAN, (dpr * 30 * s) / PLAN, (-dpr * 60 * s) / PLAN, (dpr * 30 * s) / PLAN, dpr * (sx + 64 * s), dpr * (sy + (CY - 30) * s));
          ctx.drawImage(plan.ground, 0, 0);
          ctx.restore();
          const [top, left, right] = plan.colors;
          for (const [u0, v0, u1, v1, hh] of plan.claimed) {
            const up = ([x, y]: [number, number]): [number, number] => [x, y - hh * s];
            const N = P(u0, v0), E = P(u1, v0), S = P(u1, v1), W = P(u0, v1);
            poly([W, S, up(S), up(W)], left);
            poly([S, E, up(E), up(S)], right);
            poly([up(N), up(E), up(S), up(W)], top);
          }
          if (fade < 1) {
            ctx.globalAlpha = 1 - fade;
            ctx.drawImage(sprite(), sx, sy, TILE_W * s, TILE_H * s);
            ctx.globalAlpha = 1;
          }
        } else {
          ctx.drawImage(sprite(), sx, sy, TILE_W * s, TILE_H * s);
        }
        if (t?.park != null) parkBorder(n, t.park, c.x, c.y);
        if (n === selectedRef.current || n === hover.current) {
          ctx.strokeStyle = n === selectedRef.current ? "#EDEAE3" : "rgba(237,234,227,0.45)";
          ctx.lineWidth = 2;
          diamond(c.x, c.y, 60 * s, 30 * s);
          ctx.stroke();
        }
      }
      if (fade > 0 && visible.length <= PARCEL_FETCH_LIMIT) for (const n of visible) loadPlan(n);
    }
    if (borders.length) {
      ctx.strokeStyle = "rgba(232,214,170,0.9)";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      for (const [p0, p1] of borders) {
        ctx.moveTo(...p0);
        ctx.lineTo(...p1);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const [id, cellsOf] of parkCells) {
      if (!parkNames.current.has(id)) {
        parkNames.current.set(id, null);
        api<{ name: string }>(`/v1/parks/${id}`)
          .then((p) => {
            parkNames.current.set(id, p.name);
            invalidate();
          })
          .catch(() => {});
      }
      const name = parkNames.current.get(id);
      if (!name) continue;
      const x = cellsOf.reduce((a, c) => a + c[0], 0) / cellsOf.length;
      const y = cellsOf.reduce((a, c) => a + c[1], 0) / cellsOf.length;
      labels.push([x, y - 70 * s, name, "park"]);
    }
    ctx.font = `600 11px ${getComputedStyle(cv).fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const [x, y, text, kind] of labels) {
      const tw = ctx.measureText(text).width + 18;
      ctx.fillStyle = kind === "park" ? "rgba(22,21,18,0.88)" : "#E8B04A";
      ctx.beginPath();
      ctx.roundRect(x - tw / 2, y - 10, tw, 20, 10);
      ctx.fill();
      if (kind === "park") {
        ctx.strokeStyle = PAVED.t;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fillStyle = kind === "park" ? "#EDEAE3" : "#1A1206";
      ctx.fillText(text, x, y + 0.5);
    }

    for (const k of want) {
      if (chunks.current.has(k) || chunks.current.size > 400) continue;
      chunks.current.add(k);
      api<{ tiles: Tile[] }>(`/v1/land?start=${k * CHUNK}&end=${k * CHUNK + CHUNK - 1}`)
        .then((res) => {
          for (const t of res.tiles) tiles.current.set(t.bitmap_number, t);
          areas.current.clear();
          setLoaded((v) => v + 1);
          invalidate();
        })
        .catch((e) => {
          chunks.current.delete(k);
          setError(String(e.message || e));
        });
    }
  }, [tip]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  // Parcels come from the block's transactions, so they are only read for the few tiles on
  // screen at the closest zoom, once per block.
  const loadPlan = (n: number) => {
    if (plans.current.has(n)) return;
    plans.current.set(n, "loading");
    Promise.all([api<{ tx_values: number[] }>(`/v1/land/${n}/txs`), api<Land>(`/v1/land/${n}`)])
      .then(([txs, land]) => {
        const claimed = new Set(land.parcels.map((p) => p.tx_index));
        plans.current.set(n, parcelPlan(txs.tx_values, claimed, zoneOf(land.zone ?? tiles.current.get(n)?.zone)));
        invalidate();
      })
      .catch(() => plans.current.set(n, "failed"));
  };

  const select = useCallback(
    (n: number, recentre = false) => {
      if (n < 0 || n > tip) return;
      selectedRef.current = n;
      setSelected(n);
      if (recentre) {
        const [x, y] = centre(n);
        view.current = { ...view.current, x, y: y - 30 };
      }
      invalidate();
    },
    [tip, invalidate],
  );

  const zoom = useCallback(
    (factor: number, sx?: number, sy?: number) => {
      const cv = canvas.current;
      if (!cv) return;
      const w = cv.clientWidth, h = cv.clientHeight;
      const v = view.current;
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.s * factor));
      const px = sx ?? w / 2, py = sy ?? h / 2;
      // Keep the world point under the cursor in place.
      const wx = v.x + (px - w / 2) / v.s, wy = v.y + (py - h / 2) / v.s;
      view.current = { s, x: wx - (px - w / 2) / s, y: wy - (py - h / 2) / s };
      invalidate();
    },
    [invalidate],
  );

  const zoomTo = useCallback(
    (l: Level, sx?: number, sy?: number) => {
      const cv = canvas.current;
      if (cv) zoom(LEVEL_SCALE[l](cv.clientWidth) / view.current.s, sx, sy);
    },
    [zoom],
  );

  const tileAt = useCallback(
    (sx: number, sy: number): number | null => {
      const cv = canvas.current!;
      const { x, y, s } = view.current;
      const wx = x + (sx - cv.clientWidth / 2) / s, wy = y + (sy - cv.clientHeight / 2) / s;
      // The quarter whose diamond holds the point, then the cell inside it.
      const r0 = Math.round((wy - QH) / QH);
      for (const r of [r0, r0 - 1, r0 + 1]) {
        if (r < 0) continue;
        const c = Math.round((wx - QW / 2 - (r & 1) * (QW / 2)) / QW);
        if (c < 0 || c >= QUARTERS) continue;
        const q = r * QUARTERS + c;
        const [cx, cy] = quarterCentre(q);
        if (Math.abs(wx - cx) / (QW / 2) + Math.abs(wy - cy) / QH > 1) continue;
        const dx = (wx - cx) / 64, dy = (wy - (cy - QH)) / 32;
        const u = Math.floor((dx + dy) / 2), v = Math.floor((dy - dx) / 2);
        if (u < 0 || v < 0 || u >= SIDE || v >= SIDE) return null;
        const n = q * PER_Q + v * SIDE + u;
        return n <= tip ? n : null;
      }
      return null;
    },
    [tip],
  );

  useEffect(() => {
    const cv = canvas.current!;
    const ro = new ResizeObserver(invalidate);
    ro.observe(cv);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    invalidate();
    return () => {
      ro.disconnect();
      cv.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [invalidate, zoom]);

  useEffect(() => select(focus, true), [focus, select]);

  // Drag to pan; a press that barely moves is a click.
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      if (d.moved) {
        view.current = { ...view.current, x: d.vx - dx / view.current.s, y: d.vy - dy / view.current.s };
        invalidate();
      }
      return;
    }
    const n = levelOf(view.current.s) === "area" ? null : tileAt(e.clientX - rect.left, e.clientY - rect.top);
    if (n !== hover.current) {
      hover.current = n;
      invalidate();
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      const rect = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (levelOf(view.current.s) === "area") return zoomTo("block", px, py);
      const n = tileAt(px, py);
      if (n != null) select(n);
    }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -SIDE, ArrowDown: SIDE };
    if (e.key in step) {
      e.preventDefault();
      select(selected + step[e.key], true);
    } else if (e.key === "Enter") {
      router.push(`/district/${selected}`);
    } else if (e.key === "+" || e.key === "=") {
      zoom(1.25);
    } else if (e.key === "-") {
      zoom(0.8);
    }
  };

  const t = tiles.current.get(selected);
  const zone = zoneOf(t?.zone);
  return (
    <div className="city" ref={box}>
      <div className="city-stage">
        <canvas
          ref={canvas}
          className="city-canvas"
          tabIndex={0}
          aria-label={`城市地图，当前选中 ${selected}.bitmap。方向键移动，回车进入街区，加减号缩放。`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            hover.current = null;
            invalidate();
          }}
          onKeyDown={onKeyDown}
        />
        <div className="city-levels" role="group" aria-label="显示层级">
          {LEVELS.map(([l, name]) => (
            <button key={l} type="button" className={l === level ? "on" : ""} aria-pressed={l === level} onClick={() => zoomTo(l)}>
              {name}
            </button>
          ))}
        </div>
        <div className="city-controls">
          <button type="button" className="icon-btn" aria-label="放大" onClick={() => zoom(1.25)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M5 12h14M12 5v14" />
            </svg>
          </button>
          <button type="button" className="icon-btn" aria-label="缩小" onClick={() => zoom(0.8)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M5 12h14" />
            </svg>
          </button>
          <button type="button" className="ghost small" onClick={() => select(tip, true)}>
            最新区块
          </button>
        </div>
        {error && <p className="city-error small">地图数据加载失败：{error}</p>}
      </div>

      <aside className="city-panel" aria-live="polite">
        <div className="zone-line">
          <span className="swatch" style={{ background: zone ? ZONES[zone].color : "var(--line)" }} />
          <span>{zone ? ZONES[zone].name : t ? "地段计算中" : "加载中"}</span>
          {LANDMARKS[selected] && <span className="landmark-name">· {LANDMARKS[selected]}</span>}
        </div>
        <div className="panel-title mono">
          {selected}
          <span className="dim">.bitmap</span>
        </div>
        {zone && <p className="muted">{ZONES[zone].story}</p>}
        <div className="stats small-stats">
          <div>
            <b className="mono">{t?.tx_count?.toLocaleString() ?? "—"}</b>
            <span>地块</span>
          </div>
          <div>
            <b className="mono">{t ? t.parcels.toLocaleString() : "—"}</b>
            <span>已认领</span>
          </div>
          <div>
            <b className="mono">{t ? t.posts.toLocaleString() : "—"}</b>
            <span>帖子</span>
          </div>
        </div>
        <dl className="facts">
          <dt>拥有者</dt>
          <dd className="mono">{t ? (t.claimed ? short(t.owner) : "未认领") : "—"}</dd>
          {zone && (
            <>
              <dt>划分依据</dt>
              <dd>{ZONES[zone].basis}</dd>
            </>
          )}
        </dl>
        <Link className="btn primary block" href={`/district/${selected}`}>
          进入街区
        </Link>
      </aside>

      <div className="city-legend">
        {ZONE_ORDER.map((z) => (
          <span key={z}>
            <i className="swatch" style={{ background: ZONES[z].color }} />
            {ZONES[z].name}
          </span>
        ))}
        <span className="grow" />
        <span className="muted">
          {level === "area" ? "每一片约 64 个区块，楼的种类按其中各地段的多少来摆。点击放大" : level === "parcel" ? "每一块地是区块里的一笔交易；立起来的是已认领的地块" : "拖动平移，滚轮缩放，点击街区查看；放大到最近可看到地块"}
        </span>
      </div>
    </div>
  );
}
