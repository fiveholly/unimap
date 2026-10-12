"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { BadgeIcon } from "./Badge";
import { useSession } from "./Session";
import { api, type Tour } from "@/lib/api";
import { RARITY_NAMES, type Rarity } from "@/lib/game";
import { t } from "@/lib/i18n";

/** 每日巡城 (api/tour.py), fetched again whenever `version` changes. */
export function useTour(version: unknown = null) {
  const { token, ready } = useSession();
  const [tour, setTour] = useState<Tour | null>(null);
  useEffect(() => {
    if (!ready) return;
    api<Tour>("/v1/tour", { token })
      .then(setTour)
      .catch(() => {});
  }, [token, ready, version]);
  return tour;
}

/** The days in a row the next tour badge would need for a rarer one, or null at the top. */
function nextStep(tour: Tour) {
  const run = (tour.streak ?? 0) + (tour.done ? 0 : 1);
  const steps = [...tour.rules.streaks].sort((a, b) => a[0] - b[0]);
  return steps.find(([days]) => days > run) ?? null;
}

/** Today's tour: the stops, which the viewer has been to, and the run of days. */
export function TourCard() {
  const tour = useTour();
  const { token } = useSession();
  if (!tour || !tour.stops.length) return null;
  const seen = tour.stops.filter((s) => s.visited).length;
  const next = nextStep(tour);
  return (
    <section className="tour-card">
      <div className="tour-head">
        <BadgeIcon kind="tour" rarity={tour.done ? "rare" : "common"} size={34} />
        <div className="grow">
          <h2 className="section-title">
            {t("今日巡城")} <span className="mono">{seen}/{tour.stops.length}</span>
          </h2>
          <p className="muted small">
            {tour.done
              ? t("今天的巡城完成了，明天会换三个新的街区。")
              : t("到这 {n} 个街区签到，全部到过就得到今天的巡城徽章。", { n: tour.stops.length })}
          </p>
        </div>
        {token && tour.streak != null && tour.streak > 0 && <span className="tour-streak small">{t("连续 {n} 天", { n: tour.streak })}</span>}
      </div>
      <ol className="tour-stops">
        {tour.stops.map((s) => (
          <li key={s.bitmap_number} className={s.visited ? "done" : ""}>
            <Link className="mono" href={`/district/${s.bitmap_number}`}>
              <span className="tour-check" aria-hidden>
                {s.visited ? "✓" : ""}
              </span>
              {s.bitmap_number}.bitmap
            </Link>
          </li>
        ))}
      </ol>
      <p className="muted small">
        {!token
          ? t("连接钱包后，在街区页点「签到」就算到过。")
          : next
            ? t("再连续 {n} 天，徽章升为{rarity}。", { n: next[0] - (tour.streak ?? 0), rarity: t(RARITY_NAMES[next[1]]) })
            : t("你已经连续 30 天以上，每天的徽章都是传说。")}
      </p>
    </section>
  );
}

/** On a district's page when it is one of today's stops. */
export function TourHint({ n, version }: { n: number; version: unknown }) {
  const tour = useTour(version);
  const stop = tour?.stops.find((s) => s.bitmap_number === n);
  if (!tour || !stop) return null;
  const seen = tour.stops.filter((s) => s.visited).length;
  return (
    <p className="tour-hint small">
      <BadgeIcon kind="tour" rarity="common" size={20} />
      <span>
        {stop.visited
          ? t("今日巡城：这一站到过了（{k}/{n}）。", { k: seen, n: tour.stops.length })
          : t("这里是今日巡城的一站，签到就算到过（{k}/{n}）。", { k: seen, n: tour.stops.length })}{" "}
        <Link href="/game">{t("巡城是什么 →")}</Link>
      </span>
    </p>
  );
}

/** What a check-in's tour badge says. */
export function tourWon(b: { rarity: Rarity; streak?: number }) {
  return t("今天的巡城完成了，你得到一枚{rarity}巡城徽章（连续 {n} 天）。", { rarity: t(RARITY_NAMES[b.rarity]), n: b.streak ?? 1 });
}
