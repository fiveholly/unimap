"use client";

import { useEffect, useRef } from "react";

import { TILE_H, TILE_W, tileSprite } from "@/lib/iso";
import type { Zone } from "@/lib/zones";

// The thumbnail shows the tile from CROP_TOP down; only the tallest towers reach above it.
const CROP_TOP = 50;

/** One district's isometric tile as a small picture. */
export function TileThumb({ zone, n, width = 96, level = null }: { zone: Zone | null; n: number; width?: number; level?: number | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const height = Math.round((width * (TILE_H - CROP_TOP)) / TILE_W);
  useEffect(() => {
    const cv = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const k = cv.width / TILE_W;
    ctx.drawImage(tileSprite(zone, n, k > 1 ? 2 : 1, level), 0, -CROP_TOP * k, cv.width, TILE_H * k);
  }, [zone, n, width, height, level]);
  return <canvas ref={ref} className="tile-thumb" style={{ width, height }} aria-hidden />;
}
