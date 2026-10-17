"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { useTip } from "@/components/BlockWatch";
import { CityMap } from "@/components/CityMap";
import { LuckyStrip } from "@/components/GameBits";
import { NewcomerTask } from "@/components/Newcomer";
import { Term } from "@/components/Term";
import { Today } from "@/components/Today";
import { TourCard, useTour } from "@/components/Tour";
import { OpenedList } from "@/components/Opening";
import { Promoted } from "@/components/Promoted";
import { StartHere } from "@/components/Welcome";
import { phone, WorldMap } from "@/components/WorldMap";
import { epochName, timeAgo } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
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
const COLUMN = 440; // the title and the three cards, as .atlas-hero in globals.css
/** Where the world map may put land: right of the title and the cards on a wide screen; nearly
 * the whole canvas below 900px, where the map sits under them. */
const room = (w: number) => {
  // A phone's legend sits under the map, so the land can come down to the bottom edge.
  if (phone()) return { top: 40, right: 14, bottom: 14, left: 14 };
  if (w <= 900) return { top: 34, right: 12, bottom: 40, left: 12 };
  const side = (w - Math.min(w, 1200)) / 2 + 24;
  // The legend sits under the title column and 新手任务 floats over the page, so the land gets the full height.
  return { top: 120, right: side, bottom: 48, left: side + COLUMN + 32 };
};

/** The home page is the map: the whole world first, and the city map of a spot once you pick one
 * (?b= names the block, so the browser's back button returns to the world). */
function HomeView() {
  const router = useRouter();
  const search = useSearchParams();
  const { tip, error } = useTip();
  const tour = useTour();
  const [highlight, setHighlight] = useState<number | null>(null);
  // Where the city map opens: ?b=, else the newest block when the page was opened (a new block later doesn't move it).
  const [opened, setOpened] = useState<number | null>(null);
  useEffect(() => {
    if (tip != null && opened == null) setOpened(tip);
  }, [tip, opened]);
  const b = Number(search.get("b"));
  const city = tip != null && search.get("b") != null && Number.isInteger(b) && b >= 0 && b <= tip;
  const enter = (n: number) => router.push(`/?b=${n}`, { scroll: false });

  const hero = (
    <>
      <h1>{t("比特币的每一个区块，都是城市里的一个街区")}</h1>
      <p className="on-wide">
        {tn("你出生那天、结婚那天，比特币上都出了一个块。在这里，每个块是一个{bitmap}，你可以去逛、签到，也可以给未来写一封信。", {
          bitmap: <Term k="bitmap">{t("街区#term")}</Term>,
        })}
      </p>
      <p className="on-narrow">{t("你出生那天，比特币上也出了一个块。")}</p>
    </>
  );

  return (
    <div className="home">
      {error && (
        <div className="page">
          <p className="error">{t("连不上 unimap 服务：{error}", { error })}</p>
        </div>
      )}
      {tip == null && !error && (
        <div className="page">
          <div className="city-skeleton" aria-label={t("地图加载中")} />
        </div>
      )}
      {tip != null && city && (
        <div className="page">
          <div className="city-head">{hero}</div>
          <nav className="map-crumbs" aria-label={t("地图位置")}>
            <button type="button" className="ghost sm" onClick={() => router.push("/", { scroll: false })}>
              ← {t("世界地图")}
            </button>
            <span className="muted small">
              {t(continent(Math.floor(b / HALVING)).name)} · <span className="mono">{ISLANDS[Math.floor(b / HALVING)]?.years}</span>
            </span>
          </nav>
          <CityMap tip={tip} focus={b} />
          <NewcomerTask tour={tour} card={false} />
        </div>
      )}
      {tip != null && !city && (
        <section className="atlas" aria-label={t("世界地图")}>
          <div className="atlas-map">
            <WorldMap tip={tip} highlight={highlight} onEnter={enter} room={room} />
          </div>
          <div className="atlas-over">
            <div className="atlas-hero">
              {hero}
              <StartHere tip={tip} tour={tour} />
            </div>
            <LiveTip tip={tip} />
            <NewcomerTask tour={tour} />
          </div>
        </section>
      )}
      {tip != null && (
        <div className="page home-more">
          <div>
            <LuckyStrip tip={tip} />
            {!city && <Sheet tip={tip} highlight={highlight} setHighlight={setHighlight} enter={enter} />}
          </div>
          <div>
            <Today />
            <TourCard />
            <Promoted />
            {city && <OpenedList />}
          </div>
        </div>
      )}
    </div>
  );
}

/** The newest block over the map's top right, live. */
function LiveTip({ tip }: { tip: number }) {
  const { since } = useTip();
  return (
    <Link className="atlas-live" href={`/district/${tip}`}>
      <span className="live-dot" aria-hidden />
      {t("最新区块")} <span className="mono">{num(tip)}</span>
      {since != null && <span className="dim"> · {timeAgo(since / 1000)}</span>}
    </Link>
  );
}

/** 城市概况, under the first screen: the newest block, how far the epoch has come, the epochs as a
 * table of contents (hover one to light it on the map, click to go in) and the districts just opened. */
function Sheet({ tip, highlight, setHighlight, enter }: { tip: number; highlight: number | null; setHighlight: (e: number | null) => void; enter: (n: number) => void }) {
  const { since } = useTip();
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  const epochs = Math.floor(tip / HALVING) + 1;
  const cur = epochs - 1;
  const share = (tip - cur * HALVING + 1) / HALVING;
  const nextYear = ISLANDS[cur + 1]?.years.slice(0, 4);
  return (
    <aside className="atlas-sheet" aria-label={t("城市概况")}>
      <div>
        <div className="live">
          <span className="live-dot" aria-hidden />
          {t("最新区块")}
          {since != null && <> · {timeAgo(since / 1000)}</>}
        </div>
        <Link className="tip-height" href={`/district/${tip}`}>
          {num(tip)}
        </Link>
        <p className="tip-sub">
          {nextYear
            ? t("{epoch}已出块 {p}%，约 {y} 年迎来{next}", { epoch: epochName(tip), p: (share * 100).toFixed(1), y: nextYear, next: t(continent(cur + 1).name) })
            : t("{epoch}已出块 {p}%", { epoch: epochName(tip), p: (share * 100).toFixed(1) })}
        </p>
        <div className="epoch-line" aria-hidden>
          <i style={{ width: `${share * 100}%` }} />
        </div>
      </div>
      <section className="sheet-block" aria-label={t("纪元")}>
        <h2 className="eyebrow">
          <Term k="epoch">{t("纪元")}</Term>
        </h2>
        <ol className="era-toc">
          {ISLANDS.slice(0, Math.min(epochs + 1, ISLANDS.length)).map((isle, e) => {
            const first = e * HALVING, last = Math.min(tip, (e + 1) * HALVING - 1);
            const future = e >= epochs;
            const range = future ? t("区块 {a} 起", { a: num(first) }) : t("区块 {a} – {b}", { a: num(first), b: num(last) });
            return (
              <li key={e}>
                <button
                  type="button"
                  className={`era${highlight === e ? " on" : ""}${e === cur ? " now" : ""}`}
                  disabled={future}
                  title={range}
                  onMouseEnter={() => setHighlight(e)}
                  onMouseLeave={() => setHighlight(null)}
                  onFocus={() => setHighlight(e)}
                  onBlur={() => setHighlight(null)}
                  onClick={() => enter(first)}
                >
                  <span className="era-n">{String(e).padStart(2, "0")}</span>
                  <span className="era-name">{t(continent(e).name)}</span>
                  <span className="era-y">
                    {future ? t("约 {y}", { y: isle.years.slice(0, 4) }) : e === cur ? `${isle.years.slice(0, 5)}` : isle.years}
                  </span>
                  <span className="sr-only">{range}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>
      <OpenedList />
    </aside>
  );
}
