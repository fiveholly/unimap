"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { short } from "./Session";
import { api, type Land, type Tile } from "@/lib/api";
import { CX, CY, GROUND, rng, TILE_H, TILE_W, tileSprite } from "@/lib/iso";
import { layout } from "@/lib/mondrian";
import { LANDMARKS, ZONE_ORDER, ZONES, zoneOf, type Zone } from "@/lib/zones";

// Blocks are laid out row by row, COLS to a row, on a staggered isometric grid: odd rows
// shift half a tile right, so consecutive blocks run left to right and the map fills a rectangle.
const COLS = 48;
const CHUNK = 1000; // blocks per /v1/land request (the API's maximum)
const MIN_SCALE = 0.05;
const MAX_SCALE = 4;
// Three levels of detail. Zoomed out, the city is drawn as big tiles AREA times a block's
// size, each holding about AREA² blocks and shown as a 3 x 3 cluster of buildings in the mix
// of zones those blocks are in. In the middle each block is a building tile. Zoomed right in,
// the buildings fade into the block's parcels (one plot per transaction, as on the district page).
const AREA_SCALE = 0.3;
const AREA = 8;
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

type View = { x: number; y: number; s: number }; // world point at the canvas centre, and zoom

const origin = (n: number): [number, number] => {
  const r = Math.floor(n / COLS), c = n % COLS;
  return [c * 128 + (r & 1) * 64, r * 32];
};
const centre = (n: number): [number, number] => {
  const [x, y] = origin(n);
  return [x + CX, y + CY];
};

/** Keep the map on screen: no panning past its edges, centred when smaller than the view. */
function clamp(v: View, w: number, h: number, tip: number): View {
  const fit = (pos: number, half: number, lo: number, hi: number) =>
    hi - lo <= 2 * half ? (lo + hi) / 2 : Math.min(hi - half, Math.max(lo + half, pos));
  const rows = Math.floor(tip / COLS) + 1;
  return {
    s: v.s,
    x: fit(v.x, w / 2 / v.s, 0, COLS * 128 + 64),
    y: fit(v.y, h / 2 / v.s, 0, rows * 32 + TILE_H - 32),
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
  const areas = useRef(new Map<number, (Zone | null)[]>()); // the buildings of each fully loaded area tile
  const plans = useRef(new Map<number, Plan | "loading" | "failed">());
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
    const lvl = levelOf(s);
    setLevel(lvl);

    // Rows and columns on screen; buildings rise up to a tile height above their ground.
    const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(w, h + TILE_H * s);
    const lastRow = Math.floor(tip / COLS);
    const rMin = Math.max(0, Math.floor((y0 - CY) / 32) - 1), rMax = Math.min(lastRow, Math.ceil((y1 - CY) / 32) + 1);
    const cMin = Math.max(0, Math.floor((x0 - TILE_W) / 128)), cMax = Math.min(COLS - 1, Math.ceil(x1 / 128));
    const want = new Set<number>();
    const labels: [number, number, string][] = [];
    const toScreen = (wx: number, wy: number): [number, number] => [(wx - vx) * s + w / 2, (wy - vy) * s + h / 2];

    if (lvl === "area") {
      // Area tiles sit on their own staggered grid, AREA times larger than the blocks': a diamond
      // AW wide and 2 * AH tall, rows AH apart.
      const AW = AREA * 128, AH = AREA * 32, oy = AH + CY - 32;
      const aMin = Math.max(0, Math.floor((y0 - oy) / AH) - 1), aMax = Math.ceil((y1 - oy) / AH) + 1;
      const aCols = Math.ceil(COLS / AREA) + 1;
      for (let ar = aMin; ar <= aMax; ar++) {
        for (let ac = 0; ac < aCols; ac++) {
          const cx = ac * AW + (ar & 1) * (AW / 2) + AW / 2, cy = ar * AH + oy;
          const [scx, scy] = toScreen(cx, cy);
          if (scx + (AW / 2) * s < 0 || scx - (AW / 2) * s > w || scy - AH * s > h || scy + AH * s < 0) continue;
          const key = ar * aCols + ac;
          let slots = areas.current.get(key);
          if (!slots) {
            // The blocks whose ground centre falls inside this tile's diamond.
            const count = new Map<Zone, number>();
            let missing = false, total = 0, landmark = false;
            for (let r = Math.max(0, ar * AREA - 1); r <= Math.min(lastRow, ar * AREA + 2 * AREA); r++) {
              for (let c = Math.max(0, Math.floor((cx - AW / 2) / 128) - 1); c <= Math.min(COLS - 1, Math.ceil((cx + AW / 2) / 128)); c++) {
                const n = r * COLS + c;
                if (n > tip) continue;
                const [bx, by] = centre(n);
                if (Math.abs(bx - cx) / (AW / 2) + Math.abs(by - cy) / AH > 1) continue;
                total++;
                const t = tiles.current.get(n);
                if (!t) {
                  missing = true;
                  want.add(Math.floor(n / CHUNK));
                  continue;
                }
                const z = zoneOf(t.zone);
                if (z === "landmark") landmark = true;
                else if (z) count.set(z, (count.get(z) ?? 0) + 1);
              }
            }
            slots = [];
            if (total > 0) {
              // Share out the nine plots by largest remainder, then shuffle them into place.
              const known = [...count.values()].reduce((x, y) => x + y, 0);
              const n9 = Math.max(1, Math.round((SLOTS * SLOTS * total) / (AREA * AREA)));
              const quota = ZONE_ORDER.filter((z) => count.has(z)).map((z) => ({ z, q: (count.get(z)! / known) * n9 }));
              for (const { z, q } of quota) for (let i = 0; i < Math.floor(q); i++) slots.push(z);
              quota.sort((p, q) => (q.q % 1) - (p.q % 1));
              for (let i = 0; slots.length < n9 && i < quota.length; i++) slots.push(quota[i].z);
              while (slots.length < n9) slots.push(null);
              const rand = rng(key);
              for (let i = slots.length - 1; i > 0; i--) {
                const j = Math.floor(rand() * (i + 1));
                [slots[i], slots[j]] = [slots[j], slots[i]];
              }
              if (landmark) slots[Math.min(4, slots.length - 1)] = "landmark";
            }
            if (!missing) areas.current.set(key, slots);
          }
          if (!slots.length) continue;
          if (s < COMPACT_SCALE) {
            // Too small for nine: one building, of the zone with the most plots.
            const tally = new Map<Zone | null, number>();
            for (const z of slots) tally.set(z, (tally.get(z) ?? 0) + 1);
            const zone = slots.includes("landmark") ? "landmark" : [...tally].sort((p, q) => q[1] - p[1])[0][0];
            const k = AREA, res = s * k * dpr > 1.2 ? 2 : s * k * dpr > 0.6 ? 1 : 0.5;
            ctx.drawImage(tileSprite(zone, key, res), scx - CX * k * s, scy - CY * k * s, TILE_W * k * s, TILE_H * k * s);
            continue;
          }
          // Nine smaller tiles inside the diamond, back to front; plots past the map's edge stay empty.
          const k = AREA / SLOTS, res = s * k * dpr > 1.2 ? 2 : s * k * dpr > 0.6 ? 1 : 0.5;
          for (const idx of [0, 1, 3, 2, 4, 6, 5, 7, 8]) {
            const i = idx % SLOTS, j = Math.floor(idx / SLOTS);
            const zone = idx < slots.length ? slots[idx] : null;
            if (!zone) continue;
            const px = cx + ((i - j) * AW) / 2 / SLOTS, py = cy - AH + ((i + j + 1) * AH) / SLOTS;
            const [qx, qy] = toScreen(px, py);
            ctx.drawImage(tileSprite(zone, key * 9 + idx, res), qx - CX * k * s, qy - CY * k * s, TILE_W * k * s, TILE_H * k * s);
          }
        }
      }
      for (const [n, name] of Object.entries(LANDMARKS)) {
        if (+n > tip) continue;
        const [lx, ly] = toScreen(...centre(+n));
        if (lx > -60 && lx < w + 60 && ly > -20 && ly < h + 20) labels.push([lx, ly - 40 * AREA * s, name]);
      }
    } else {
      const fade = Math.min(1, Math.max(0, (s - PARCEL_FADE[0]) / (PARCEL_FADE[1] - PARCEL_FADE[0])));
      const res = s * dpr > 1.2 ? 2 : s * dpr > 0.6 ? 1 : 0.5;
      const visible: number[] = [];
      for (let r = rMin; r <= rMax; r++) {
        for (let c = cMin; c <= cMax; c++) {
          const n = r * COLS + c;
          if (n > tip) continue;
          const [ox, oy] = origin(n);
          const [sx, sy] = toScreen(ox, oy);
          if (sx > w || sx + TILE_W * s < 0 || sy > h || sy + TILE_H * s < 0) continue;
          visible.push(n);
          const t = tiles.current.get(n);
          if (!t) want.add(Math.floor(n / CHUNK));
          const zone = zoneOf(t?.zone);
          const plan = fade > 0 ? plans.current.get(n) : undefined;
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
              ctx.drawImage(tileSprite(zone, n, res), sx, sy, TILE_W * s, TILE_H * s);
              ctx.globalAlpha = 1;
            }
          } else {
            ctx.drawImage(tileSprite(zone, n, res), sx, sy, TILE_W * s, TILE_H * s);
          }
          if (n === selectedRef.current || n === hover.current) {
            ctx.strokeStyle = n === selectedRef.current ? "#EDEAE3" : "rgba(237,234,227,0.45)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(sx + 64 * s, sy + (CY - 30) * s);
            ctx.lineTo(sx + 124 * s, sy + CY * s);
            ctx.lineTo(sx + 64 * s, sy + (CY + 30) * s);
            ctx.lineTo(sx + 4 * s, sy + CY * s);
            ctx.closePath();
            ctx.stroke();
          }
          if (LANDMARKS[n]) labels.push([sx + 64 * s, sy + (fade === 1 ? CY - 44 : 6) * s, LANDMARKS[n]]);
        }
      }
      if (fade > 0 && visible.length <= PARCEL_FETCH_LIMIT) for (const n of visible) loadPlan(n);
    }
    ctx.font = `600 11px ${getComputedStyle(cv).fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const [x, y, text] of labels) {
      const tw = ctx.measureText(text).width + 18;
      ctx.fillStyle = "#E8B04A";
      ctx.beginPath();
      ctx.roundRect(x - tw / 2, y - 10, tw, 20, 10);
      ctx.fill();
      ctx.fillStyle = "#1A1206";
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
      // The ground diamond containing the point, among the rows it could be in.
      const r0 = Math.round((wy - CY) / 32);
      for (const r of [r0, r0 - 1, r0 + 1]) {
        if (r < 0) continue;
        const c = Math.round((wx - CX - (r & 1) * 64) / 128);
        if (c < 0 || c >= COLS) continue;
        const dx = wx - (c * 128 + (r & 1) * 64 + CX), dy = wy - (r * 32 + CY);
        if (Math.abs(dx) / 64 + Math.abs(dy) / 32 <= 1) {
          const n = r * COLS + c;
          return n <= tip ? n : null;
        }
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
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS };
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
