"use client";

import { TileThumb } from "@/components/TileThumb";
import { GROWTH, LEVEL_NAMES, PART_NAMES, THRESHOLDS, WEIGHTS, type Prosperity, type ProsperityParts } from "@/lib/prosperity";
import type { Park } from "@/lib/api";
import type { DistrictStyle } from "@/lib/style";
import type { Zone } from "@/lib/zones";

/** How lively a district is, what it looks like now, and what the next level needs. */
export function ProsperityCard({
  p,
  zone,
  n,
  park = null,
  look = null,
}: {
  p: Prosperity;
  zone: Zone | null;
  n: number;
  park?: Park | null;
  look?: DistrictStyle | null;
}) {
  const shown = Math.max(p.level, park?.level ?? 0);
  const growth: string[] = GROWTH[zone ?? "residential"] ?? GROWTH.residential;
  const from = THRESHOLDS[p.level - 1];
  const pct = p.next == null ? 100 : Math.round(((p.score - from) / (p.next - from)) * 100);
  const keys = (Object.keys(WEIGHTS) as (keyof ProsperityParts)[]).filter((k) => p.parts[k] > 0);
  return (
    <section className="prosperity" aria-label="繁荣度">
      <div className="pros-head">
        <div className="pros-looks">
          <TileThumb zone={zone} n={n} width={72} level={shown} look={look} />
          {p.next != null && shown < 5 && (
            <>
              <span className="pros-arrow" aria-hidden>
                →
              </span>
              <span className="pros-next">
                <TileThumb zone={zone} n={n} width={72} level={shown + 1} look={look} />
              </span>
            </>
          )}
        </div>
        <div className="grow">
          <div className="row between">
            <b>
              繁荣度 {p.level} 级 · {LEVEL_NAMES[p.level]}
            </b>
            <span className="mono muted small">
              {p.score}
              {p.next != null && ` / ${p.next}`}
            </span>
          </div>
          <div className="pros-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <i style={{ width: `${Math.max(3, pct)}%` }} />
          </div>
          <div className="muted small">
            现在是{growth[p.level - 1]}
            {p.next != null
              ? `，再涨 ${p.next - p.score} 分升到 ${p.level + 1} 级，会变成${growth[p.level]}。`
              : "，已经是最高等级。"}
          </div>
        </div>
      </div>
      {park && park.level > p.level && (
        <div className="small">
          这里属于园区「{park.name}」，园区合计 {park.score} 分，地图上按 {park.level} 级 · {LEVEL_NAMES[park.level as Prosperity["level"]]}显示。
        </div>
      )}
      {keys.length > 0 && (
        <ul className="pros-parts">
          {keys.map((k) => (
            <li key={k}>
              <span className="muted">{PART_NAMES[k]}</span>
              <span className="mono">
                {p.parts[k].toLocaleString("en-US")}
                <span className="dim"> × {WEIGHTS[k]}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="dim small">只算近 30 天的帖子、回复和签到，没人来就会慢慢降回去。</p>
    </section>
  );
}
