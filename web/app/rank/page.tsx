"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { short } from "@/components/Session";
import { ShareMenu } from "@/components/ShareMenu";
import { TileThumb } from "@/components/TileThumb";
import { api, type Ranking } from "@/lib/api";
import { LEVEL_NAMES, type Level } from "@/lib/prosperity";
import { rankText } from "@/lib/share";
import { ZONES, zoneOf } from "@/lib/zones";

export default function RankPage() {
  const [rows, setRows] = useState<Ranking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ rankings: Ranking[] }>("/v1/rankings")
      .then((r) => setRows(r.rankings))
      .catch((e) => setError(e.status === 404 ? "繁荣榜还没有上线。" : e.message));
  }, []);
  return (
    <div className="page narrow rank">
      <div className="row between">
        <h1>繁荣榜</h1>
        <ShareMenu path="/rank" text={rankText} />
      </div>
      <p className="muted">最热闹的 50 个街区。按繁荣度排序，只算近 30 天的帖子、回复和签到，所以名次每天都会变。</p>
      {error ? (
        <p className="error">{error}</p>
      ) : !rows ? (
        <p className="muted">加载中…</p>
      ) : (
        <ol className="rank-list">
          {rows.map((r, i) => {
            const zone = zoneOf(r.zone);
            return (
              <li key={r.bitmap_number}>
                <Link href={`/district/${r.bitmap_number}`}>
                  <span className={`rank-no mono${i < 3 ? " top" : ""}`}>{i + 1}</span>
                  <TileThumb zone={zone} n={r.bitmap_number} width={56} level={r.level} />
                  <span className="grow">
                    <b className="mono">{r.name}</b>
                    <span className="muted small">
                      {zone ? ZONES[zone].name : "地段计算中"} · {short(r.owner)}
                    </span>
                  </span>
                  <span className="rank-score">
                    <b className="mono">{r.score}</b>
                    <span className="muted small">
                      {r.level} 级 · {LEVEL_NAMES[r.level as Level]}
                    </span>
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
