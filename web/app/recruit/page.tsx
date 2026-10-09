"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { short } from "@/components/Session";
import { TileThumb } from "@/components/TileThumb";
import { api, type Recruiting } from "@/lib/api";
import { LEVEL_NAMES, type Level } from "@/lib/prosperity";
import { ZONES, zoneOf } from "@/lib/zones";

export default function RecruitPage() {
  const [rows, setRows] = useState<Recruiting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ districts: Recruiting[] }>("/v1/recruiting")
      .then((r) => setRows(r.districts))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="page narrow rank">
      <h1>招募居民</h1>
      <p className="muted">这些街区在找新邻居。进去看看说明，申请入住后，街区主人会把地块转给你。</p>
      {error ? (
        <p className="error">{error}</p>
      ) : !rows ? (
        <p className="muted">加载中…</p>
      ) : rows.length === 0 ? (
        <p className="muted empty">现在没有街区在招募。</p>
      ) : (
        <ol className="rank-list">
          {rows.map((r) => {
            const zone = zoneOf(r.zone);
            return (
              <li key={r.bitmap_number}>
                <Link href={`/district/${r.bitmap_number}`}>
                  <TileThumb zone={zone} n={r.bitmap_number} width={56} level={r.level} />
                  <span className="grow">
                    <b className="mono">{r.name}</b>
                    <span className="small">{r.message}</span>
                    <span className="muted small">
                      {zone ? ZONES[zone].name : "地段计算中"} · {r.level} 级 {LEVEL_NAMES[r.level as Level]} · {short(r.owner)}
                    </span>
                  </span>
                  <span className="rank-score">
                    <b className="mono">{r.parcels.length || "—"}</b>
                    <span className="muted small">开放地块</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
