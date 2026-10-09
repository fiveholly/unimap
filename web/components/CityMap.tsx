"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { short } from "./Session";
import { api, type Tile } from "@/lib/api";
import { CX, CY, TILE_H, TILE_W, tileSprite } from "@/lib/iso";
import { LANDMARKS, ZONE_ORDER, ZONES, zoneOf } from "@/lib/zones";

// Blocks are laid out row by row, COLS to a row, on a staggered isometric grid: odd rows
// shift half a tile right, so consecutive blocks run left to right and the map fills a rectangle.
const COLS = 48;
const CHUNK = 1000; // blocks per /v1/land request (the API's maximum)
const MIN_SCALE = 0.08;
const MAX_SCALE = 1.6;
const SPRITE_SCALE = 0.3; // below this, tiles are flat zone-coloured diamonds

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
  const view = useRef<View>({ x: centre(focus)[0], y: centre(focus)[1] - 60, s: 0.7 });
  const tiles = useRef(new Map<number, Tile>());
  const chunks = useRef(new Set<number>());
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
    view.current = clamp(view.current, w, h, tip);
    const { x: vx, y: vy, s } = view.current;
    const toWorld = (sx: number, sy: number): [number, number] => [vx + (sx - w / 2) / s, vy + (sy - h / 2) / s];

    // Rows and columns on screen; buildings rise up to a tile height above their ground.
    const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(w, h + TILE_H * s);
    const lastRow = Math.floor(tip / COLS);
    const rMin = Math.max(0, Math.floor((y0 - CY) / 32) - 1), rMax = Math.min(lastRow, Math.ceil((y1 - CY) / 32) + 1);
    const cMin = Math.max(0, Math.floor((x0 - TILE_W) / 128)), cMax = Math.min(COLS - 1, Math.ceil(x1 / 128));
    const want = new Set<number>();
    const labels: [number, number, string][] = [];
    const sprite = s >= SPRITE_SCALE;
    const res = s * dpr > 1.2 ? 2 : s * dpr > 0.6 ? 1 : 0.5;
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        const n = r * COLS + c;
        if (n > tip) continue;
        const [ox, oy] = origin(n);
        const sx = (ox - vx) * s + w / 2, sy = (oy - vy) * s + h / 2;
        if (sx > w || sx + TILE_W * s < 0 || sy > h || sy + TILE_H * s < 0) continue;
        const t = tiles.current.get(n);
        if (!t) want.add(Math.floor(n / CHUNK));
        const zone = zoneOf(t?.zone);
        if (sprite) {
          ctx.drawImage(tileSprite(zone, n, res), sx, sy, TILE_W * s, TILE_H * s);
        } else {
          ctx.fillStyle = zone ? ZONES[zone].color + "D0" : "#2A2823";
          ctx.beginPath();
          ctx.moveTo(sx + 64 * s, sy + (CY - 31) * s);
          ctx.lineTo(sx + 127 * s, sy + CY * s);
          ctx.lineTo(sx + 64 * s, sy + (CY + 31) * s);
          ctx.lineTo(sx + 1 * s, sy + CY * s);
          ctx.fill();
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
        if (LANDMARKS[n] && s >= 0.25) labels.push([sx + 64 * s, sy + (sprite ? 6 : CY - 40) * s, LANDMARKS[n]]);
      }
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

  const select = useCallback(
    (n: number, recentre = false) => {
      if (n < 0 || n > tip) return;
      selectedRef.current = n;
      setSelected(n);
      if (recentre) {
        const [x, y] = centre(n);
        view.current = { ...view.current, x, y: y - 60 };
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
    const n = tileAt(e.clientX - rect.left, e.clientY - rect.top);
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
      const n = tileAt(e.clientX - rect.left, e.clientY - rect.top);
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
        <span className="muted">拖动平移，滚轮缩放，点击地块查看</span>
      </div>
    </div>
  );
}
