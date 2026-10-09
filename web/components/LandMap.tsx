"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api, type Tile } from "@/lib/api";
import { LANDMARKS } from "@/lib/format";

const PAGE = 400;

/** Grid of districts by height: claimed, active (has posts), or open land. */
export function LandMap() {
  const [start, setStart] = useState<number | null>(null);
  const [tip, setTip] = useState<number | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ indexed_height: { bitmap: number | null } }>("/v1/status")
      .then((s) => {
        const t = s.indexed_height.bitmap ?? 0;
        setTip(t);
        setStart(Math.max(0, t - PAGE + 1));
      })
      .catch((e) => setError(String(e.message || e)));
  }, []);

  useEffect(() => {
    if (start == null) return;
    api<{ tiles: Tile[] }>(`/v1/land?start=${start}&end=${start + PAGE - 1}`)
      .then((r) => setTiles(r.tiles))
      .catch((e) => setError(String(e.message || e)));
  }, [start]);

  if (error) return <p className="error">Can&apos;t reach the unimap API: {error}</p>;
  if (start == null) return <p className="muted">Loading the map…</p>;
  const claimed = tiles.filter((t) => t.claimed).length;
  return (
    <section className="card">
      <div className="row">
        <h2 className="grow">
          Blocks {start.toLocaleString()} – {(start + tiles.length - 1).toLocaleString()}
        </h2>
        <button className="ghost small" onClick={() => setStart(Math.max(0, start - PAGE))} disabled={start === 0}>
          Earlier
        </button>
        <button className="ghost small" onClick={() => setStart(start + PAGE)} disabled={tip == null || start + PAGE > tip}>
          Later
        </button>
      </div>
      <p className="muted small">
        {claimed} of {tiles.length} claimed here · tip {tip?.toLocaleString()}
      </p>
      <div className="land-map">
        {tiles.map((t) => (
          <Link
            key={t.bitmap_number}
            href={`/district/${t.bitmap_number}`}
            className={`tile${t.claimed ? " claimed" : ""}${t.posts > 0 ? " active" : ""}${LANDMARKS[t.bitmap_number] ? " landmark" : ""}`}
            title={`${t.bitmap_number}.bitmap${t.claimed ? "" : " (unclaimed)"}${t.posts ? ` · ${t.posts} posts` : ""}${
              LANDMARKS[t.bitmap_number] ? ` · ${LANDMARKS[t.bitmap_number]}` : ""
            }`}
          />
        ))}
      </div>
      <div className="legend small muted">
        <span>
          <i className="tile" /> unclaimed
        </span>
        <span>
          <i className="tile claimed" /> claimed
        </span>
        <span>
          <i className="tile claimed active" /> has posts
        </span>
      </div>
    </section>
  );
}
