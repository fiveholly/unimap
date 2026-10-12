"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { useTip } from "@/components/BlockWatch";
import { CityMap } from "@/components/CityMap";
import { LuckyStrip } from "@/components/GameBits";
import { Today } from "@/components/Today";
import { TourCard } from "@/components/Tour";
import { Welcome } from "@/components/Welcome";
import { LAND, WorldMap } from "@/components/WorldMap";
import { epochName } from "@/lib/format";
import { t } from "@/lib/i18n";
import { continent, HALVING } from "@/lib/terrain";
import { ISLANDS } from "@/lib/world";

export default function Home() {
  return (
    <Suspense>
      <HomeView />
    </Suspense>
  );
}

const num = (n: number) => n.toLocaleString("en-US");

/** The home page is the map: the whole world first, and the city map of a spot once you pick one
 * (?b= names the block, so the browser's back button returns to the world). */
function HomeView() {
  const router = useRouter();
  const search = useSearchParams();
  const { tip, error } = useTip();
  const [highlight, setHighlight] = useState<number | null>(null);
  // Where the city map opens: ?b=, else the newest block when the page was opened (a new block later doesn't move it).
  const [opened, setOpened] = useState<number | null>(null);
  useEffect(() => {
    if (tip != null && opened == null) setOpened(tip);
  }, [tip, opened]);
  const b = Number(search.get("b"));
  const city = tip != null && search.get("b") != null && Number.isInteger(b) && b >= 0 && b <= tip;
  const enter = (n: number) => router.push(`/?b=${n}`, { scroll: false });
  const epochs = tip == null ? 0 : Math.floor(tip / HALVING) + 1;

  return (
    <div className="page">
      <section className="home-head">
        <div>
          <h1>{t("比特币的每一个区块，都是城市里的一个街区")}</h1>
          <p className="muted">
            {t("持有 Bitmap 街区就能经营它的社区，持有地块就是这里的居民，其他人可以来逛、关注和回复。")}
          </p>
        </div>
        {tip != null && (
          <div className="mono muted small nowrap">
            {epochName(tip)} · {t("最新区块 {n}", { n: num(tip) })}
          </div>
        )}
      </section>
      {error && <p className="error">{t("连不上 unimap 服务：{error}", { error })}</p>}
      {tip == null && !error && <div className="city-skeleton" aria-label={t("地图加载中")} />}
      {tip != null && city && (
        <>
          <nav className="map-crumbs" aria-label={t("地图位置")}>
            <button type="button" className="ghost sm" onClick={() => router.push("/", { scroll: false })}>
              ← {t("世界地图")}
            </button>
            <span className="muted small">
              {t(continent(Math.floor(b / HALVING)).name)} · {ISLANDS[Math.floor(b / HALVING)]?.years}
            </span>
          </nav>
          <CityMap tip={tip} focus={b} />
        </>
      )}
      {tip != null && !city && (
        <div className="world">
          <WorldMap tip={tip} highlight={highlight} onEnter={enter} />
          <aside className="world-panel">
            <h2 className="section-title">{t("世界地图")}</h2>
            <p className="muted small">{t("每一次减半是一块大陆，大陆上每一小格是 64 个区块，越靠中间越早。点地图上任意一处，进入那里的城区。")}</p>
            <ul className="continents">
              {ISLANDS.slice(0, Math.min(epochs + 1, ISLANDS.length)).map((isle, e) => {
                const first = e * HALVING, last = Math.min(tip, (e + 1) * HALVING - 1);
                const future = e >= epochs;
                return (
                  <li key={e}>
                    <button
                      type="button"
                      className={`continent-row${highlight === e ? " on" : ""}`}
                      disabled={future}
                      onMouseEnter={() => setHighlight(e)}
                      onMouseLeave={() => setHighlight(null)}
                      onFocus={() => setHighlight(e)}
                      onBlur={() => setHighlight(null)}
                      onClick={() => enter(first)}
                    >
                      <i className="swatch" style={future ? { border: "1px dashed var(--fg-2)" } : { background: LAND[e] }} />
                      <span className="grow">
                        <b>{t(continent(e).name)}</b>
                        <span className="muted small">
                          {" "}
                          {isle.years}
                        </span>
                        <span className="mono muted small block">
                          {future ? t("区块 {a} 起", { a: num(first) }) : t("区块 {a} – {b}", { a: num(first), b: num(last) })}
                        </span>
                      </span>
                      <span className="small muted nowrap">{future ? t("还没出现") : last - first + 1 < HALVING ? t("还在长") : ""}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
      )}
      {tip != null && <Today />}
      {tip != null && <LuckyStrip tip={tip} />}
      {tip != null && <TourCard />}
      {tip != null && <Welcome tip={tip} />}
    </div>
  );
}
