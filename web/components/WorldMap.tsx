"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api, type MarketListing, type Ranking } from "@/lib/api";
import { t } from "@/lib/i18n";
import { continent, HALVING } from "@/lib/terrain";
import { blocksAt, CELL_BLOCKS, cellOf, cellsOf, coastline, ISLANDS } from "@/lib/world";
import { LANDMARKS } from "@/lib/zones";

/** The hue of each continent: a faint wash of it on the land and its contour lines. */
export const LAND = ["#C4AA70", "#96AA64", "#6EA0A5", "#BE7D69", "#A096C8", "#8E8A7E"];
const AMBER = "#F2A541"; // claimed: districts someone runs
const BLUE = "#5B8DEF"; // on sale
const INK = "#ECEDEE";
// Halvings are the continents themselves, so they get no pin of their own.
const PINNED = Object.entries(LANDMARKS)
  .map(([n, name]) => [Number(n), name] as const)
  .filter(([n]) => n % HALVING !== 0);
// Contour lines inside a continent: the coast of its oldest 80%, 60%, ... of cells. The cells fill
// from the middle outward, so these are lines of equal age, like the rings of a tree.
const CONTOURS = [0.8, 0.6, 0.4, 0.2];

type Marker = { n: number; x: number; y: number; name: string; kind: "landmark" | "hot" | "sale" | "tip" };
type Hover = { x: number; y: number; title: string; lines: string[] };
export type Room = { top: number; right: number; bottom: number; left: number };

const rgb = (hex: string) => {
  const v = parseInt(hex.slice(1, 7), 16);
  return `${v >> 16},${(v >> 8) & 255},${v & 255}`;
};
const num = (n: number) => n.toLocaleString("en-US");
/** A phone, where the map is drawn wider than the screen (see .world-pan in globals.css). */
export const phone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;

/** The whole city at once, drawn as a night chart: every halving epoch a continent, every cell 64
 * blocks. Hover to see which blocks a spot holds; clicking one opens the city map there. room says
 * how much of the canvas, from each edge, to keep clear of land (for what floats over the map). */
export function WorldMap({
  tip,
  highlight,
  onEnter,
  room,
}: {
  tip: number;
  highlight: number | null;
  onEnter: (n: number) => void;
  room?: (w: number, h: number) => Room;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pan = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  const land = useRef<{ img: HTMLCanvasElement; key: string } | null>(null);
  const geo = useRef({ ox: 0, oy: 0, hw: 1, tops: [] as [number, number][], shapes: [] as (Path2D | null)[] });
  const markers = useRef<Marker[]>([]);
  const cursor = useRef<[number, number] | null>(null);
  const fonts = useRef<{ serif: string; mono: string } | null>(null);
  const [hot, setHot] = useState<Ranking[]>([]);
  const [sale, setSale] = useState<MarketListing[]>([]);
  const [hover, setHover] = useState<Hover | null>(null);
  const epochs = Math.floor(tip / HALVING) + 1; // continents with blocks; one more is still to come
  // The continent still to come, outlined in the sea; left out on a small screen, where the room
  // is better spent on the land there is.
  const shownFor = (w: number) => Math.min(epochs + (w < 520 || phone() ? 0 : 1), ISLANDS.length);

  useEffect(() => {
    api<{ rankings: Ranking[] }>("/v1/rankings")
      .then((r) => setHot(r.rankings))
      .catch(() => {});
    api<{ listings: MarketListing[] }>("/v1/market/listings")
      .then((r) => setSale(r.listings.filter((l) => l.status === "active")))
      .catch(() => {});
  }, []);

  const keyOf = (w: number, h: number, dpr: number) => `${w}x${h}@${dpr}:${tip}:${hot.length}:${sale.length}`;

  /** The sea and the land, drawn once per size. */
  const paintLand = useCallback(
    (w: number, h: number, dpr: number) => {
      const shown = shownFor(w);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let e = 0; e < shown; e++)
        for (const [u, v] of cellsOf(e)) {
          minX = Math.min(minX, u - v);
          maxX = Math.max(maxX, u - v);
          minY = Math.min(minY, (u + v) / 2);
          maxY = Math.max(maxY, (u + v) / 2);
        }
      const r = room?.(w, h) ?? (w < 520 ? { top: 30, right: 10, bottom: 10, left: 10 } : { top: 48, right: 24, bottom: 24, left: 24 });
      const rw = Math.max(40, w - r.left - r.right), rh = Math.max(40, h - r.top - r.bottom);
      const hw = Math.min(rw / (maxX - minX + 2), rh / (maxY - minY + 2));
      const ox = r.left + rw / 2 - ((minX + maxX) / 2) * hw, oy = r.top + rh / 2 - ((minY + maxY) / 2) * hw;
      const tops: [number, number][] = [];
      const shapes: (Path2D | null)[] = [];
      geo.current = { ox, oy, hw, tops, shapes };
      const img = document.createElement("canvas");
      img.width = Math.round(w * dpr);
      img.height = Math.round(h * dpr);
      const ctx = img.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const at = (u: number, v: number): [number, number] => [ox + (u - v) * hw, oy + ((u + v) / 2) * hw];

      // The sea, and a faint graticule along the map's two axes.
      ctx.fillStyle = "#0A0B0D";
      ctx.fillRect(0, 0, w, h);
      const corner = (px: number, py: number) => {
        const a = (px - ox) / hw, b = (2 * (py - oy)) / hw;
        return [(a + b) / 2, (b - a) / 2];
      };
      const cs = [corner(0, 0), corner(w, 0), corner(0, h), corner(w, h)];
      const lo = Math.min(...cs.flat()), hi = Math.max(...cs.flat());
      const step = 12;
      ctx.strokeStyle = "rgba(236,237,238,0.035)";
      ctx.lineWidth = 1;
      for (let k = Math.floor(lo / step) * step; k <= hi; k += step) {
        ctx.beginPath();
        ctx.moveTo(...at(k, lo));
        ctx.lineTo(...at(k, hi));
        ctx.moveTo(...at(lo, k));
        ctx.lineTo(...at(hi, k));
        ctx.stroke();
      }

      // A set of cells as one smooth shape (lib/world.ts coastline), on screen.
      const shape = (cells: [number, number][]) => {
        const path = new Path2D();
        for (const loop of coastline(cells)) {
          loop.forEach(([u, v], i) => {
            const [x, y] = at(u, v);
            if (i) path.lineTo(x, y);
            else path.moveTo(x, y);
          });
          path.closePath();
        }
        return path;
      };
      for (let e = 0; e < shown; e++) {
        const all = cellsOf(e);
        const future = e >= epochs;
        const filled = future ? 0 : Math.min(all.length, Math.ceil((Math.min(tip, (e + 1) * HALVING - 1) - e * HALVING + 1) / CELL_BLOCKS));
        // A continent's name goes just above its northernmost cell, over the middle of the land.
        const cut = future ? all.length : filled;
        let north = Infinity;
        for (let k = 0; k < cut; k++) north = Math.min(north, all[k][0] + all[k][1]);
        const [cu, cv] = ISLANDS[e].at;
        tops[e] = [at(cu, cv)[0], oy + (north / 2) * hw - hw / 2];
        if (future || filled < all.length) {
          // Where the continent will reach: a dashed line in the sea.
          ctx.setLineDash([3, 5]);
          ctx.strokeStyle = future ? "rgba(236,237,238,0.2)" : "rgba(236,237,238,0.1)";
          ctx.lineWidth = 1;
          ctx.stroke(shape(all));
          ctx.setLineDash([]);
          if (future) {
            shapes[e] = null;
            continue;
          }
        }
        const hue = rgb(LAND[e] ?? LAND[LAND.length - 1]);
        const coast = shape(all.slice(0, filled));
        shapes[e] = coast;
        ctx.fillStyle = `rgba(${hue},0.1)`;
        ctx.fill(coast, "evenodd");
        ctx.lineWidth = 0.8;
        CONTOURS.forEach((f, j) => {
          const k = Math.floor(filled * f);
          if (k < 24) return;
          ctx.strokeStyle = `rgba(${hue},${0.3 - j * 0.05})`;
          ctx.stroke(shape(all.slice(0, k)));
        });
        ctx.strokeStyle = `rgba(${hue},0.78)`;
        ctx.lineWidth = 1.2;
        ctx.stroke(coast);
      }
      // Markers sit on the cell of their block.
      const list: Marker[] = PINNED.filter(([n]) => n <= tip).map(([n, name]) => ({ n, ...xy(at, n), name: t(name), kind: "landmark" }));
      for (const r of hot) if (r.bitmap_number <= tip) list.push({ n: r.bitmap_number, ...xy(at, r.bitmap_number), name: r.name || `${r.bitmap_number}.bitmap`, kind: "hot" });
      for (const l of sale) if (l.bitmap_number <= tip) list.push({ n: l.bitmap_number, ...xy(at, l.bitmap_number), name: t("{n}.bitmap 在售", { n: l.bitmap_number }), kind: "sale" });
      list.push({ n: tip, ...xy(at, tip), name: t("最新区块 {n}", { n: num(tip) }), kind: "tip" });
      markers.current = list;
      // Claimed and listed districts as fine points, the landmarks as small white dots.
      for (const m of list) {
        if (m.kind === "tip") continue;
        ctx.fillStyle = m.kind === "hot" ? AMBER : m.kind === "sale" ? BLUE : INK;
        if (m.kind === "landmark") {
          ctx.beginPath();
          ctx.arc(m.x, m.y, 1.8, 0, Math.PI * 2);
          ctx.fill();
        } else ctx.fillRect(m.x - 1.1, m.y - 1.1, 2.2, 2.2);
      }
      land.current = { img, key: keyOf(w, h, dpr) };
    },
    [tip, hot, sale, epochs, room], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const draw = useCallback(
    (now: number) => {
      const cv = canvas.current;
      if (!cv) return;
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      const shown = shownFor(w);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      if (land.current?.key !== keyOf(w, h, dpr)) paintLand(w, h, dpr);
      // On a phone the map is drawn wider than the screen so the continents read. It opens on the
      // current epoch, where the newest block is, and pans sideways with a swipe.
      const el = pan.current;
      if (el && !placed.current) {
        placed.current = true;
        const room = el.scrollWidth - el.clientWidth;
        const now = geo.current.tops[epochs - 1];
        if (room > 0 && now) el.scrollLeft = Math.max(0, Math.min(room, now[0] - el.clientWidth * 0.3));
      }
      const ctx = cv.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(land.current!.img, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const { ox, oy, hw } = geo.current;
      const at = (u: number, v: number): [number, number] => [ox + (u - v) * hw, oy + ((u + v) / 2) * hw];
      if (!fonts.current) {
        const css = getComputedStyle(document.documentElement);
        fonts.current = { serif: css.getPropertyValue("--font-serif").trim() || "serif", mono: css.getPropertyValue("--font-mono").trim() || "monospace" };
      }
      const { serif, mono } = fonts.current;

      const lit = highlight != null && highlight < epochs ? geo.current.shapes[highlight] : null;
      if (lit) {
        ctx.fillStyle = "rgba(236,237,238,0.05)";
        ctx.fill(lit, "evenodd");
        ctx.strokeStyle = "rgba(236,237,238,0.55)";
        ctx.lineWidth = 1.2;
        ctx.stroke(lit);
      }
      // The spot under the cursor.
      const c = cursor.current;
      if (c) {
        const [x, y] = at(...c);
        ctx.strokeStyle = "rgba(236,237,238,0.9)";
        ctx.lineWidth = 1;
        const r = Math.max(hw * 1.6, 5);
        ctx.beginPath();
        ctx.moveTo(x, y - r / 2);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r / 2);
        ctx.lineTo(x - r, y);
        ctx.closePath();
        ctx.stroke();
      }

      // Continent names in spaced serif over each continent, the years under them in mono.
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const roomy = hw >= 2;
      const spaced = "letterSpacing" in ctx;
      for (let e = 0; e < shown; e++) {
        const [x, top] = geo.current.tops[e];
        const ly = top - (roomy ? 24 : 12);
        const name = t(continent(e).name);
        const cur = e === epochs - 1, future = e >= epochs;
        ctx.font = `500 ${roomy ? 13 : 11}px ${serif}`;
        if (spaced) ctx.letterSpacing = roomy ? "0.22em" : "0.12em";
        ctx.fillStyle = future ? "rgba(236,237,238,0.38)" : cur ? AMBER : INK;
        ctx.fillText(name, x, ly);
        if (spaced) ctx.letterSpacing = "0px";
        if (!roomy) continue;
        const years = ISLANDS[e].years;
        ctx.font = `400 10px ${mono}`;
        ctx.fillStyle = future ? "rgba(163,168,176,0.5)" : "rgba(163,168,176,0.85)";
        ctx.fillText(future ? t("约 {y}", { y: years.slice(0, 4) }) : cur ? years.slice(0, 5) : years, x, ly + 14);
      }

      // The newest block: an amber ring and dot, breathing slowly.
      const tipMark = markers.current.find((m) => m.kind === "tip");
      if (tipMark) {
        if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
          const p = (now % 2400) / 2400;
          ctx.strokeStyle = `rgba(242,165,65,${0.45 * (1 - p)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(tipMark.x, tipMark.y, 6 + 9 * p, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.strokeStyle = "rgba(242,165,65,0.9)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(tipMark.x, tipMark.y, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = AMBER;
        ctx.beginPath();
        ctx.arc(tipMark.x, tipMark.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    [tip, hot, sale, highlight, epochs, paintLand], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    let frame = 0;
    const loop = (now: number) => {
      draw(now);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [draw]);

  /** What's under a point on the canvas: a marker within a few pixels, else the cell. */
  const pick = (px: number, py: number) => {
    let near: Marker | undefined;
    let best = 8;
    for (const m of markers.current) {
      const d = Math.hypot(m.x - px, m.y - py);
      if (d < best || (d === best && m.kind === "tip")) [near, best] = [m, d];
    }
    const { ox, oy, hw } = geo.current;
    const a = (px - ox) / hw, b = (2 * (py - oy)) / hw;
    const u = Math.round((a + b) / 2), v = Math.round((b - a) / 2);
    const blocks = near ? null : blocksAt(u, v, tip);
    return { near, cell: [u, v] as [number, number], blocks };
  };
  const local = (e: React.PointerEvent): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const onMove = (e: React.PointerEvent) => {
    const [px, py] = local(e);
    const { near, cell, blocks } = pick(px, py);
    if (near) {
      cursor.current = cellOf(near.n);
      setHover({ x: px, y: py, title: near.name, lines: [`${near.n}.bitmap`, t("点击进入这里的城区")] });
    } else if (blocks) {
      cursor.current = cell;
      const ep = Math.floor(blocks[0] / HALVING);
      setHover({ x: px, y: py, title: `${t(continent(ep).name)} · ${ISLANDS[ep].years}`, lines: [t("区块 {a} – {b}", { a: num(blocks[0]), b: num(blocks[1]) }), t("点击进入这里的城区")] });
    } else {
      cursor.current = null;
      setHover(null);
    }
  };
  const onClick = (e: React.PointerEvent) => {
    const [px, py] = local(e);
    const { near, blocks } = pick(px, py);
    if (near) onEnter(near.n);
    else if (blocks) onEnter(blocks[0]);
  };

  return (
    <div className="world-stage">
      <div className="world-pan" ref={pan}>
        <canvas
          ref={canvas}
          className="world-canvas"
          role="img"
          aria-label={t("世界地图：每一次减半是一块大陆，一共 {n} 个区块。用右边的列表进入各个大陆。", { n: num(tip + 1) })}
          onPointerMove={onMove}
          onPointerLeave={() => {
            cursor.current = null;
            setHover(null);
          }}
          onPointerUp={onClick}
          style={{ cursor: hover ? "pointer" : "default" }}
        />
        {hover && (
          <div className={`world-tip${hover.x > (canvas.current?.clientWidth ?? 0) / 2 ? " left" : ""}`} style={{ left: hover.x, top: hover.y }}>
            <b>{hover.title}</b>
            {hover.lines.map((l, i) => (
              <span key={l} className={i === 0 ? "mono" : undefined}>
                {l}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="world-key">
        <p>{t("每一次减半是一块大陆，大陆上每一小格是 64 个区块，越靠中间越早。点地图上任意一处，进入那里的城区。")}</p>
        <div>
          <span>
            <i style={{ background: AMBER }} />
            {t("有人经营的街区")}
          </span>
          <span>
            <i style={{ background: BLUE }} />
            {t("在售")}
          </span>
          <span>
            <i style={{ background: INK }} />
            {t("地标")}
          </span>
          <span>
            <i className="ring" />
            {t("最新区块")}
          </span>
        </div>
      </div>
    </div>
  );
}

function xy(at: (u: number, v: number) => [number, number], n: number) {
  const [x, y] = at(...cellOf(n));
  return { x, y };
}
