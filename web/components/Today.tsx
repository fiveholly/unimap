"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useSession } from "./Session";
import { useTour } from "./Tour";
import { api, type CaredPet, type Game, type Me } from "@/lib/api";
import { t } from "@/lib/i18n";

type Item = { key: string; done: boolean; text: string; href: string; action: string };

/** 今天可以做的事: for a signed-in visitor on the home page, the day's small things in one list:
 * the tour, the lucky district, pets to feed, treasures to open, and a way in without land. */
export function Today() {
  const { token, ready } = useSession();
  const tour = useTour();
  const [me, setMe] = useState<Me | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [pets, setPets] = useState<CaredPet[] | null>(null);
  useEffect(() => {
    if (!ready || !token) return;
    api<Me>("/v1/me", { token }).then(setMe).catch(() => {});
    api<Game>("/v1/game", { token }).then(setGame).catch(() => {});
    api<{ pets: CaredPet[] }>("/v1/me/pets", { token })
      .then((r) => setPets(r.pets))
      .catch(() => {});
  }, [ready, token]);
  if (!token || !me || !game || !tour) return null;

  const items: Item[] = [];
  if (tour.stops.length) {
    const seen = tour.stops.filter((s) => s.visited).length;
    const next = tour.stops.find((s) => !s.visited);
    items.push({
      key: "tour",
      done: !!tour.done,
      text: t("今日巡城 {k}/{n}", { k: seen, n: tour.stops.length }),
      href: next ? `/district/${next.bitmap_number}` : "/game",
      action: next ? t("去下一站") : t("看徽章"),
    });
  }
  const r = game.round;
  if (r?.bitmap_number != null) {
    const visited = !!game.badges?.some((b) => b.kind === "lucky_visit" && b.height === r.since);
    items.push({
      key: "lucky",
      done: visited,
      text: t("去幸运街区 {n}.bitmap 签到", { n: r.bitmap_number }),
      href: `/district/${r.bitmap_number}`,
      action: t("去签到"),
    });
  }
  if (pets?.length) {
    const now = Date.now();
    const hungry = pets.filter((p) => !p.can_feed_at || Date.parse(p.can_feed_at) <= now).length;
    items.push({
      key: "pets",
      done: hungry === 0,
      text: hungry ? t("{n} 只宠物可以喂了", { n: hungry }) : t("宠物都吃饱了"),
      href: "/me",
      action: t("去喂"),
    });
  }
  const mine = new Set(me.parcels.map((p) => `${p.bitmap_number}:${p.tx_index}`));
  const treasures = game.draws.filter((d) => d.open && d.bitmap_number != null && mine.has(`${d.bitmap_number}:${d.tx_index}`));
  if (treasures.length)
    items.push({
      key: "treasure",
      done: false,
      text: t("你的地块上有 {n} 个宝箱没打开", { n: treasures.length }),
      href: `/district/${treasures[0].bitmap_number}`,
      action: t("去打开"),
    });
  if (!me.districts.length && !me.parcels.length)
    items.push({ key: "land", done: false, text: t("还没有土地？先找个街区当居民"), href: "/recruit", action: t("看谁在招人") });

  if (!items.length) return null;
  const done = items.filter((i) => i.done).length;
  return (
    <section className="today" aria-label={t("今天可以做的事")}>
      <h2 className="section-title">
        {t("今天可以做的事")} <span className="mono">{done}/{items.length}</span>
      </h2>
      <ul>
        {items.map((i) => (
          <li key={i.key} className={i.done ? "done" : ""}>
            <span className="today-check" aria-hidden>
              {i.done ? "✓" : ""}
            </span>
            <span className="grow">{i.text}</span>
            {!i.done && (
              <Link className="small" href={i.href}>
                {i.action} →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
