// Share links and texts. Each shared page has its own card image (app/**/opengraph-image.tsx),
// which X and chat apps show under the link.

import type { Metadata } from "next";

import type { District, Post } from "./api";
import { LEVEL_NAMES, type Level } from "./prosperity";
import { LANDMARKS } from "./zones";

/** The site's public origin: set NEXT_PUBLIC_SITE_URL, else the API's (they share one in deploy/). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000").replace(/\/$/, "");

/** A shared page's title and text, for the page itself, X and Open Graph alike. */
export const pageMeta = (title: string, description: string, url: string, type: "website" | "article" = "website"): Metadata => ({
  title: `${title} · unimap`,
  description,
  openGraph: { title, description, url, type },
  twitter: { card: "summary_large_image", title, description },
});

export const xIntent = (text: string, url: string) =>
  `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

const levelText = (level: number) => `${level} 级${LEVEL_NAMES[level as Level] ?? ""}`;

export function districtText(d: District, mine: boolean): string {
  const n = d.bitmap_number;
  const landmark = LANDMARKS[n] ? `（${LANDMARKS[n]}）` : "";
  const level = d.level ?? d.prosperity?.level;
  const head = mine ? `我在 unimap 的街区 ${n}.bitmap${landmark}` : `来 unimap 逛逛 ${n}.bitmap${landmark}`;
  const park = d.park ? `，属于园区「${d.park.name}」` : "";
  return `${head}${level ? `，现在是 ${levelText(level)}` : ""}${park}。#Bitmap #unimap`;
}

export const parkText = (name: string, members: number, level: number, mine: boolean) =>
  `${mine ? "我在 unimap 建了园区" : "unimap 上的园区"}「${name}」：${members} 个街区连成一片，现在是 ${levelText(level)}。#Bitmap #unimap`;

export function postText(p: Post): string {
  const body = (p.body ?? "").replace(/\s+/g, " ").trim();
  const clip = body.length > 80 ? `${body.slice(0, 80)}…` : body;
  return `${clip ? `“${clip}”` : "一条帖子"}，来自 unimap 的 ${p.bitmap_number}.bitmap`;
}

export const recruitText = (n: number, message: string) =>
  `${n}.bitmap 在招居民：${message.length > 60 ? `${message.slice(0, 60)}…` : message} 来 unimap 申请入住。#Bitmap #unimap`;

export const rankText = "unimap 繁荣榜：比特币城市里最热闹的街区。#Bitmap #unimap";
