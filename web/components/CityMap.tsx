"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { short } from "./Session";
import { api, type Land, type Tile } from "@/lib/api";
import { epochName } from "@/lib/format";
import { CX, CY, GROUND, TILE_H, TILE_W, tileSprite } from "@/lib/iso";
import { layout } from "@/lib/mondrian";
import { LANDMARKS, ZONE_ORDER, ZONES, zoneOf, type Zone } from "@/lib/zones";

// Blocks are laid out row by row, COLS to a row, on a staggered isometric grid: odd rows
// shift half a tile right, so consecutive blocks run left to right and the map fills a rectangle.
const COLS = 48;
const CHUNK = 1000; // blocks per /v1/land request (the API's maximum)
const MIN_SCALE = 0.05;
const MAX_SCALE = 4;
// Three levels of detail. Zoomed out, blocks merge into areas of AREA_COLS x AREA_ROWS,
// each striped by the share of every zone in it; in the middle each block is a building tile; zoomed right in,
// the buildings fade into the block's parcels (one square per transaction, as on the district page).
const AREA_SCALE = 0.3;
const AREA_COLS = 8;
const AREA_ROWS = 16;
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
const LEVEL_SCALE: Record<Level, (w: number) => number> = { area: () => 0.06, block: defaultScale, parcel: () => 2.8 };

/** A block's parcels drawn flat on a unit square, ready to be skewed onto its ground. */
function parcelPlan(txValues: number[], claimed: Set<number>, zone: Zone | null): HTMLCanvasElement {
  const { squares, width, height } = layout(txValues);
  const extent = Math.max(width, height, 1);
  const k = PLAN / extent, dx = (extent - width) / 2;
  const gap = Math.max(0.6, Math.min(0.25, extent / 400 + 0.08) * k) / 2;
  const cv = document.createElement("canvas");
  cv.width = cv.height = PLAN;
  const ctx = cv.getContext("2d")!;
  const base = zone ? ZONES[zone].color : "#8C877C";
  squares.forEach((q, i) => {
    ctx.fillStyle = claimed.has(i) ? base : base + "4D";
    ctx.fillRect((dx + q.x) * k + gap, q.y * k + gap, q.r * k - 2 * gap, q.r * k - 2 * gap);
  });
  return cv;
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
  const areas = useRef(new Map<number, [Zone, number][]>()); // zone shares of each fully loaded area
  const plans = useRef(new Map<number, HTMLCanvasElement | "loading" | "failed">());
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
      // One rectangle per area, in the colour of the zone most of its blocks are in.
      const gap = Math.max(1, 3 * s * 4);
      for (let ar = Math.floor(rMin / AREA_ROWS); ar <= Math.floor(rMax / AREA_ROWS); ar++) {
        for (let ac = Math.floor(cMin / AREA_COLS); ac <= Math.floor(cMax / AREA_COLS); ac++) {
          const first = ar * AREA_ROWS * COLS + ac * AREA_COLS;
          if (first > tip) continue;
          const [ax, ay] = toScreen(ac * AREA_COLS * 128 + 32, ar * AREA_ROWS * 32 + CY - 16);
          const aw = AREA_COLS * 128 * s, ah = AREA_ROWS * 32 * s;
          const key = ar * COLS + ac;
          let shares = areas.current.get(key);
          if (!shares) {
            const count = new Map<Zone, number>();
            let missing = false, total = 0;
            for (let r = ar * AREA_ROWS; r < (ar + 1) * AREA_ROWS; r++) {
              for (let c = ac * AREA_COLS; c < (ac + 1) * AREA_COLS; c++) {
                const n = r * COLS + c;
                if (n > tip) continue;
                const t = tiles.current.get(n);
                const z = zoneOf(t?.zone);
                if (!t) {
                  missing = true;
                  want.add(Math.floor(n / CHUNK));
                } else if (z && z !== "landmark") {
                  count.set(z, (count.get(z) ?? 0) + 1);
                  total++;
                }
              }
            }
            shares = ZONE_ORDER.filter((z) => count.has(z)).map((z): [Zone, number] => [z, count.get(z)! / total]);
            if (!missing) areas.current.set(key, shares);
          }
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(ax + gap / 2, ay + gap / 2, aw - gap, ah - gap, Math.min(6, aw / 12));
          ctx.fillStyle = "#2A2823";
          ctx.fill();
          ctx.clip();
          let sx = ax + gap / 2;
          for (const [z, share] of shares) {
            ctx.fillStyle = ZONES[z].color;
            ctx.fillRect(sx, ay, share * (aw - gap) + 0.5, ah);
            sx += share * (aw - gap);
          }
          ctx.restore();
        }
      }
      // Halvings split the city into epochs.
      ctx.font = `500 12px ${getComputedStyle(cv).fontFamily}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      for (let e = 0; e * 210000 <= tip; e++) {
        const r = Math.floor((e * 210000) / COLS);
        const [, ly] = toScreen(0, r * 32 + CY - 16);
        if (ly < -20 || ly > h + 20) continue;
        if (e > 0) {
          ctx.fillStyle = "rgba(237,234,227,0.5)";
          ctx.fillRect(0, ly - 1, w, 1);
        }
        ctx.fillStyle = "rgba(237,234,227,0.85)";
        ctx.fillText(epochName(e * 210000), 12, ly - 4);
      }
      for (const [n, name] of Object.entries(LANDMARKS)) {
        if (+n > tip) continue;
        const [lx, ly] = toScreen(...centre(+n));
        if (lx > -60 && lx < w + 60 && ly > -20 && ly < h + 20) labels.push([lx, ly - 12, name]);
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
          if (plan instanceof HTMLCanvasElement) {
            // A bare slab with the parcels on top: map the unit square onto the ground diamond.
            const g = GROUND[zone ?? "unknown"];
            const top = (dy: number) => {
              ctx.beginPath();
              ctx.moveTo(sx + 64 * s, sy + (CY - 30 + dy) * s);
              ctx.lineTo(sx + 124 * s, sy + (CY + dy) * s);
              ctx.lineTo(sx + 64 * s, sy + (CY + 30 + dy) * s);
              ctx.lineTo(sx + 4 * s, sy + (CY + dy) * s);
              ctx.closePath();
            };
            ctx.fillStyle = g.r;
            top(6);
            ctx.fill();
            ctx.fillStyle = "#151411";
            top(0);
            ctx.fill();
            ctx.save();
            ctx.setTransform(dpr * 60 * s / PLAN, dpr * 30 * s / PLAN, -dpr * 60 * s / PLAN, dpr * 30 * s / PLAN, dpr * (sx + 64 * s), dpr * (sy + (CY - 30) * s));
            ctx.drawImage(plan, 0, 0);
            ctx.restore();
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
          {level === "area" ? "每格是 128 个区块，色条是各地段的占比。点击放大" : level === "parcel" ? "每一小格是一笔交易，也就是一个地块；亮色为已认领" : "拖动平移，滚轮缩放，点击街区查看；放大到最近可看到地块"}
        </span>
      </div>
    </div>
  );
}
