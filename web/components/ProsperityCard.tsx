"use client";

import { TileThumb } from "@/components/TileThumb";
import { t } from "@/lib/i18n";
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
    <section className="prosperity" aria-label={t("繁荣度")}>
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
              {t("繁荣度 {level} 级 · {name}", { level: p.level, name: t(LEVEL_NAMES[p.level]) })}
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
            {p.next != null
              ? t("现在是{now}，再涨 {n} 分升到 {level} 级，会变成{next}。", {
                  now: t(growth[p.level - 1]),
                  n: p.next - p.score,
                  level: p.level + 1,
                  next: t(growth[p.level]),
                })
              : t("现在是{now}，已经是最高等级。", { now: t(growth[p.level - 1]) })}
          </div>
        </div>
      </div>
      {park && park.level > p.level && (
        <div className="small">
          {t("这里属于园区「{name}」，园区合计 {score} 分，地图上按 {level} 级 · {levelName}显示。", {
            name: park.name,
            score: park.score,
            level: park.level,
            levelName: t(LEVEL_NAMES[park.level as Prosperity["level"]]),
          })}
        </div>
      )}
      {keys.length > 0 && (
        <ul className="pros-parts">
          {keys.map((k) => (
            <li key={k}>
              <span className="muted">{t(PART_NAMES[k])}</span>
              <span className="mono">
                {p.parts[k].toLocaleString("en-US")}
                <span className="dim"> × {WEIGHTS[k]}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="dim small">{t("只算近 30 天的帖子、回复和签到，没人来就会慢慢降回去。")}</p>
    </section>
  );
}
