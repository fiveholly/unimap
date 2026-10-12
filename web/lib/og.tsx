// Share card images (1200 x 630), drawn by next/og on the server. Pages export these from
// their opengraph-image.tsx; X and chat apps show the card under a shared link.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { ReactElement, ReactNode } from "react";

import { layout } from "./mondrian";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export const C = {
  bg: "#0e0d0b",
  surface: "#161512",
  line: "#2a2823",
  fg: "#edeae3",
  fg2: "#a8a397",
  fg3: "#8c877c",
  accent: "#f7931a",
  free: "#302d27",
  claimed: "#7d6c50",
  coinbase: "#3a3833",
  park: "#d9c49a",
};

const geist = (file: string) => readFile(join(process.cwd(), "node_modules/geist/dist/fonts", file));
const LATIN = Promise.all([
  geist("geist-sans/Geist-Regular.ttf"),
  geist("geist-sans/Geist-Bold.ttf"),
  geist("geist-mono/GeistMono-Bold.ttf"),
]).catch(() => null);

// Chinese comes from Google Fonts, cut down to the characters on the card (the full font is far
// too big to ship). Without the network the card still renders, with the Chinese left out.
const cjkCache = new Map<string, Promise<ArrayBuffer | null>>();
function cjk(text: string, weight: 400 | 700): Promise<ArrayBuffer | null> {
  const chars = [...new Set(text.replace(/[\x00-\x7f]/g, ""))].sort().join("");
  if (!chars) return Promise.resolve(null);
  const key = `${weight}:${chars}`;
  const cached = cjkCache.get(key);
  if (cached) return cached;
  const font = (async (): Promise<ArrayBuffer | null> => {
    try {
      const css = await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@${weight}&text=${encodeURIComponent(chars)}`, {
        // An old user agent gets TrueType, which the renderer reads; newer ones get woff2.
        headers: { "User-Agent": "Mozilla/4.0" },
        signal: AbortSignal.timeout(4000),
      }).then((r) => r.text());
      const url = css.match(/src: url\((.+?)\)/)?.[1];
      if (!url) return null;
      return await fetch(url, { signal: AbortSignal.timeout(4000) }).then((r) => (r.ok ? r.arrayBuffer() : null));
    } catch {
      return null;
    }
  })();
  if (cjkCache.size > 200) cjkCache.delete(cjkCache.keys().next().value!);
  cjkCache.set(key, font);
  font.then((f) => f || cjkCache.delete(key));
  return font;
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (typeof el.type === "function") return textOf((el.type as (p: unknown) => ReactNode)(el.props));
  return textOf(el.props?.children);
}

export async function render(el: ReactElement): Promise<ImageResponse> {
  const text = textOf(el);
  const [latin, cjk400, cjk700] = await Promise.all([LATIN, cjk(text, 400), cjk(text, 700)]);
  const fonts: { name: string; data: ArrayBuffer | Buffer; weight: 400 | 700; style: "normal" }[] = [];
  if (latin) {
    fonts.push({ name: "Geist", data: latin[0], weight: 400, style: "normal" });
    fonts.push({ name: "Geist", data: latin[1], weight: 700, style: "normal" });
    fonts.push({ name: "Geist Mono", data: latin[2], weight: 700, style: "normal" });
  }
  if (cjk400) fonts.push({ name: "Noto Sans SC", data: cjk400, weight: 400, style: "normal" });
  if (cjk700) fonts.push({ name: "Noto Sans SC", data: cjk700, weight: 700, style: "normal" });
  return new ImageResponse(el, { ...size, fonts: fonts as never, headers: { "Cache-Control": "public, max-age=600" } });
}

const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const LOGO = svgUri(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="5" y="5" width="13" height="13" rx="1.5" fill="#f7931a"/><rect x="20" y="5" width="7" height="7" rx="1" fill="#f7931a"/><rect x="5" y="20" width="7" height="7" rx="1" fill="#f7931a"/><rect x="14" y="20" width="13" height="7" rx="1" fill="#f7931a" opacity=".55"/></svg>',
);

/** The block's Mondrian picture as an image: claimed parcels lit, the coinbase darker. */
export function mondrianUri(txValues: number[], claimed: Set<number>, lit: string = C.claimed): string {
  const { squares, width, height } = layout(txValues.length ? txValues : [1]);
  const extent = Math.max(width, height);
  const pad = Math.min(0.25, extent / 400 + 0.08);
  const dx = (extent - width) / 2;
  const rects = squares
    .map((q, i) => {
      const fill = i === 0 ? C.coinbase : claimed.has(i) ? lit : C.free;
      return `<rect x="${(dx + q.x + pad / 2).toFixed(3)}" y="${(q.y + pad / 2).toFixed(3)}" width="${(q.r - pad).toFixed(3)}" height="${(q.r - pad).toFixed(3)}" fill="${fill}"/>`;
    })
    .join("");
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" width="1000" height="1000">${rects}</svg>`);
}

/** Every card's frame: the brand on top, the tagline and site at the bottom, `children` between. */
export function Frame({ children, site, side }: { children: ReactNode; site: string; side?: ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: C.bg,
        color: C.fg,
        fontFamily: "Geist, Noto Sans SC",
        padding: 56,
        gap: 48,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO} width={36} height={36} alt="" />
          <span style={{ fontFamily: "Geist Mono", fontWeight: 700, fontSize: 28 }}>unimap</span>
          <span style={{ fontSize: 22, color: C.fg3, marginLeft: 8 }}>比特币上的 Bitmap 城市</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>{children}</div>
        {!side && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, color: C.fg3, marginTop: 20 }}>
            <span>比特币的每一个区块，都是城市里的一个街区</span>
            <span>{site}</span>
          </div>
        )}
      </div>
      {side && (
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", gap: 16 }}>
          {side}
          <span style={{ fontSize: 22, color: C.fg3 }}>{site}</span>
        </div>
      )}
    </div>
  );
}

export const Chip = ({ color, children }: { color: string; children: ReactNode }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "6px 16px",
      border: `1px solid ${C.line}`,
      borderRadius: 999,
      fontSize: 24,
      color: C.fg2,
    }}
  >
    <div style={{ width: 14, height: 14, borderRadius: 3, background: color }} />
    {children}
  </div>
);

export const siteName = (url: string) => url.replace(/^https?:\/\//, "");
