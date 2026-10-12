"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api, type Ranking } from "@/lib/api";
import { t } from "@/lib/i18n";
import { continent, HALVING } from "@/lib/terrain";
import { blocksAt, CELL_BLOCKS, cellOf, cellsOf, hash, ISLANDS } from "@/lib/world";
import { LANDMARKS } from "@/lib/zones";

/** Land colour of each continent, lighter than its shore colour on the city map. */
export const LAND = ["#B9A06A", "#8FA35E", "#6E9E9A", "#B4836A", "#9C96BC", "#8E8A7E"];
const BEACH = "#D8C9A0";
const LUCKY = "#F2B544";
const HOT = "#F07B4F";
// Halvings are the continents themselves, so they get no pin of their own.
const PINNED = Object.entries(LANDMARKS)
  .map(([n, name]) => [Number(n), name] as const)
  .filter(([n]) => n % HALVING !== 0);

type Marker = { n: number; x: number; y: number; name: string; kind: "landmark" | "hot" | "tip" };
type Hover = { x: number; y: number; title: string; lines: string[] };

const shade = (hex: string, f: number) => {
  const v = parseInt(hex.slice(1, 7), 16);
  const ch = (x: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? x * (1 + f) : x + (255 - x) * f)));
  return `rgb(${ch(v >> 16)},${ch((v >> 8) & 255)},${ch(v & 255)})`;
};
const num = (n: number) => n.toLocaleString("en-US");

/** The whole city at once: every halving epoch a continent, every cell 64 blocks. Hover to see
 * which blocks a spot holds; clicking one opens the city map there. */
export function WorldMap({ tip, highlight, onEnter }: { tip: number; highlight: number | null; onEnter: (n: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const land = useRef<{ img: HTMLCanvasElement; key: string } | null>(null);
  const geo = useRef({ ox: 0, oy: 0, hw: 1, tops: [] as [number, number][] });
  const markers = useRef<Marker[]>([]);
  const cursor = useRef<[number, number] | null>(null);
  const [hot, setHot] = useState<Ranking[]>([]);
  const [hover, setHover] = useState<Hover | null>(null);
  const epochs = Math.floor(tip / HALVING) + 1; // continents with blocks; one more is still to come
  // The continent still to come, outlined in the sea; left out on a small screen, where the room
  // is better spent on the land there is.
  const shownFor = (w: number) => Math.min(epochs + (w < 520 ? 0 : 1), ISLANDS.length);

  useEffect(() => {
    api<{ rankings: Ranking[] }>("/v1/rankings")
      .then((r) => setHot(r.rankings.slice(0, 5)))
      .catch(() => {});
  }, []);

  /** The land, drawn once per size: every cell back to front, with a cliff under the coast. */
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
      const pad = w < 520 ? 10 : 24, top = w < 520 ? 26 : 44; // room above for the continents' names
      const hw = Math.min((w - 2 * pad) / (maxX - minX + 2), (h - pad - top) / (maxY - minY + 2));
      const ox = w / 2 - ((minX + maxX) / 2) * hw, oy = top + (h - pad - top) / 2 - ((minY + maxY) / 2) * hw;
      const tops: [number, number][] = [];
      geo.current = { ox, oy, hw, tops };
      const img = document.createElement("canvas");
      img.width = Math.round(w * dpr);
      img.height = Math.round(h * dpr);
      const ctx = img.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // The sea, with a few ripples.
      const sea = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      sea.addColorStop(0, "#12232c");
      sea.addColorStop(1, "#0a1217");
      ctx.fillStyle = sea;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(160,200,215,0.07)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 90; i++) {
        const x = hash(i, 1) * w, y = hash(i, 2) * h, l = 6 + hash(i, 3) * 14;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + l / 2, y - 2, x + l, y);
        ctx.stroke();
      }
      const at = (u: number, v: number): [number, number] => [ox + (u - v) * hw, oy + ((u + v) / 2) * hw];
      const diamond = (x: number, y: number, dy = 0) => {
        ctx.beginPath();
        ctx.moveTo(x, y - hw / 2 + dy);
        ctx.lineTo(x + hw, y + dy);
        ctx.lineTo(x, y + hw / 2 + dy);
        ctx.lineTo(x - hw, y + dy);
        ctx.closePath();
      };
      const cliff = Math.max(1.5, hw * 0.9);
      for (let e = 0; e < shown; e++) {
        const all = cellsOf(e);
        const future = e >= epochs;
        const filled = future ? 0 : Math.min(all.length, Math.ceil((Math.min(tip, (e + 1) * HALVING - 1) - e * HALVING + 1) / CELL_BLOCKS));
        const mine = new Set(all.slice(0, future ? all.length : filled).map(([u, v]) => `${u},${v}`));
        const order = all.map((c, k) => [c[0], c[1], k] as const).sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
        // A continent's name goes just above its northernmost cell, over the middle of the land.
        const cut = future ? all.length : filled;
        const [nu, nv] = order.find(([, , k]) => k < cut)!;
        const [cu, cv] = ISLANDS[e].at;
        tops[e] = [at(cu, cv)[0], at(nu, nv)[1] - hw / 2];
        if (future || filled < all.length) {
          // Where the continent will reach: a faint outline in the sea.
          ctx.fillStyle = "rgba(220,215,200,0.05)";
          for (const [u, v, k] of order) if (future || k >= filled) (diamond(...at(u, v)), ctx.fill());
          if (future) continue;
        }
        const base = LAND[e] ?? LAND[LAND.length - 1];
        const coast = (u: number, v: number) => !mine.has(`${u + 1},${v}`) || !mine.has(`${u},${v + 1}`) || !mine.has(`${u - 1},${v}`) || !mine.has(`${u},${v - 1}`);
        ctx.fillStyle = shade(base, -0.55);
        for (const [u, v, k] of order) if (k < filled && (!mine.has(`${u + 1},${v}`) || !mine.has(`${u},${v + 1}`))) (diamond(...at(u, v), cliff), ctx.fill());
        for (const [u, v, k] of order) {
          if (k >= filled) continue;
          // Older blocks, nearer the middle, a little lighter; and some grain everywhere.
          const f = 0.12 * (1 - k / all.length) + (hash(u, v) - 0.5) * 0.14;
          ctx.fillStyle = coast(u, v) ? BEACH : shade(base, f);
          diamond(...at(u, v));
          ctx.fill();
        }
      }
      // Markers sit on the cell of their block.
      const list: Marker[] = PINNED.filter(([n]) => n <= tip).map(([n, name]) => ({ n, ...xy(at, n), name: t(name), kind: "landmark" }));
      for (const r of hot) if (r.bitmap_number <= tip) list.push({ n: r.bitmap_number, ...xy(at, r.bitmap_number), name: r.name || `${r.bitmap_number}.bitmap`, kind: "hot" });
      list.push({ n: tip, ...xy(at, tip), name: t("最新区块 {n}", { n: num(tip) }), kind: "tip" });
      markers.current = list;
      land.current = { img, key: `${w}x${h}@${dpr}:${tip}:${hot.length}` };
    },
    [tip, hot, epochs], // eslint-disable-line react-hooks/exhaustive-deps
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
      if (land.current?.key !== `${w}x${h}@${dpr}:${tip}:${hot.length}`) paintLand(w, h, dpr);
      const ctx = cv.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(land.current!.img, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const { ox, oy, hw } = geo.current;
      const at = (u: number, v: number): [number, number] => [ox + (u - v) * hw, oy + ((u + v) / 2) * hw];
      const font = getComputedStyle(cv).fontFamily;

      if (highlight != null && highlight < epochs) {
        ctx.fillStyle = "rgba(255,250,235,0.16)";
        const last = Math.min(tip, (highlight + 1) * HALVING - 1);
        cellsOf(highlight).forEach(([u, v], k) => {
          if (highlight * HALVING + k * CELL_BLOCKS > last) return;
          const [x, y] = at(u, v);
          ctx.fillRect(x - hw / 2, y - hw / 4, hw, hw / 2);
        });
      }
      // The spot under the cursor.
      const c = cursor.current;
      if (c) {
        const [x, y] = at(...c);
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 1.5;
        const r = Math.max(hw * 1.6, 5);
        ctx.beginPath();
        ctx.moveTo(x, y - r / 2);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r / 2);
        ctx.lineTo(x - r, y);
        ctx.closePath();
        ctx.stroke();
      }

      // Continent names, over the upper part of each continent.
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let e = 0; e < shown; e++) {
        const [x, top] = geo.current.tops[e];
        // On a small screen only the names fit.
        const roomy = hw >= 2;
        const ly = top - (roomy ? 30 : 14);
        ctx.font = `600 ${roomy ? Math.min(16, hw * 4) : 11}px ${font}`;
        ctx.fillStyle = e < epochs ? "rgba(20,18,14,0.82)" : "rgba(220,215,200,0.55)";
        if (e < epochs) {
          const tw = ctx.measureText(t(continent(e).name)).width + 16;
          ctx.beginPath();
          ctx.roundRect(x - tw / 2, ly - (roomy ? 11 : 9), tw, roomy ? 22 : 18, 9);
          ctx.fill();
          ctx.fillStyle = "#F1ECE0";
        }
        ctx.fillText(t(continent(e).name), x, ly);
        if (!roomy) continue;
        ctx.font = `500 11px ${font}`;
        ctx.fillStyle = "rgba(237,234,227,0.7)";
        ctx.fillText(e < epochs ? ISLANDS[e].years : t("约 {y} 年出现", { y: ISLANDS[e].years.slice(0, 4) }), x, ly + 18);
      }

      for (const m of markers.current) {
        if (m.kind === "tip") {
          const p = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.4 : (now % 1600) / 1600;
          ctx.strokeStyle = `rgba(242,181,68,${1 - p})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(m.x, m.y, 4 + 12 * p, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = LUCKY;
        } else ctx.fillStyle = m.kind === "hot" ? HOT : "#F1ECE0";
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.kind === "landmark" ? 3 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(10,10,10,0.7)";
        ctx.lineWidth = 1;
        ctx.stroke();
        if (m.kind !== "hot" && hw >= 1.6) {
          ctx.font = `500 11px ${font}`;
          ctx.textAlign = "left";
          ctx.fillStyle = m.kind === "tip" ? LUCKY : "rgba(241,236,224,0.9)";
          ctx.shadowColor = "rgba(0,0,0,0.9)";
          ctx.shadowBlur = 3;
          ctx.fillText(m.name, m.x + 7, m.y);
          ctx.shadowBlur = 0;
          ctx.textAlign = "center";
        }
      }
    },
    [tip, hot, highlight, epochs, paintLand], // eslint-disable-line react-hooks/exhaustive-deps
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
    const near = markers.current.find((m) => Math.hypot(m.x - px, m.y - py) < 8);
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
          {hover.lines.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      )}
      <div className="world-key small">
        <span>
          <i style={{ background: "#F1ECE0" }} />
          {t("地标")}
        </span>
        <span>
          <i style={{ background: HOT }} />
          {t("最热闹的街区")}
        </span>
        <span>
          <i style={{ background: LUCKY }} />
          {t("最新区块")}
        </span>
      </div>
    </div>
  );
}

function xy(at: (u: number, v: number) => [number, number], n: number) {
  const [x, y] = at(...cellOf(n));
  return { x, y };
}
