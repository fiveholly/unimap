"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { short } from "@/components/Session";
import { ShareMenu } from "@/components/ShareMenu";
import { TileThumb } from "@/components/TileThumb";
import { PostCard } from "@/components/PostCard";
import { api, type Ranking, type TipTop } from "@/lib/api";
import { LEVEL_NAMES, type Level } from "@/lib/prosperity";
import { rankText } from "@/lib/share";
import { ZONES, zoneOf } from "@/lib/zones";
import { t } from "@/lib/i18n";

export default function RankPage() {
  const [tab, setTab] = useState<"prosperity" | "tips">("prosperity");
  const [rows, setRows] = useState<Ranking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ rankings: Ranking[] }>("/v1/rankings")
      .then((r) => setRows(r.rankings))
      .catch((e) => setError(e.status === 404 ? t("繁荣榜还没有上线。") : e.message));
  }, []);
  return (
    <div className="page narrow rank">
      <div className="row between">
        <h1>{t("繁荣榜")}</h1>
        <ShareMenu path="/rank" text={rankText()} />
      </div>
      <nav className="tabs" aria-label={t("榜单")}>
        <button type="button" className={tab === "prosperity" ? "active" : ""} onClick={() => setTab("prosperity")}>
          {t("繁荣度")}
        </button>
        <button type="button" className={tab === "tips" ? "active" : ""} onClick={() => setTab("tips")}>
          {t("打赏榜")}
        </button>
      </nav>
      {tab === "tips" ? (
        <TipBoard />
      ) : (
        <>
          <p className="muted rank-lead">{t("最热闹的 50 个街区。按繁荣度排序，只算近 30 天的帖子、回复和签到，所以名次每天都会变。")}</p>
          {error ? (
            <p className="error">{error}</p>
          ) : !rows ? (
            <p className="muted">{t("加载中…")}</p>
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
                          {zone ? t(ZONES[zone].name) : t("地段计算中")} · {short(r.owner)}
                        </span>
                      </span>
                      <span className="rank-score">
                        <b className="mono">{r.score}</b>
                        <span className="muted small">
                          {t("{n} 级", { n: r.level })} · {t(LEVEL_NAMES[r.level as Level])}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

/** 打赏榜: the districts and posts that got the most sats in confirmed Lightning tips this week. */
function TipBoard() {
  const [top, setTop] = useState<TipTop | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<TipTop>("/v1/tips/top?days=7")
      .then(setTop)
      .catch((e) => setError(e.message));
  }, []);
  if (error) return <p className="error">{error}</p>;
  if (!top) return <p className="muted">{t("加载中…")}</p>;
  if (!top.districts.length) return <p className="muted rank-lead">{t("这周还没有人打赏。给喜欢的帖子点一下 ⚡，聪会直接到作者的钱包。")}</p>;
  return (
    <>
      <p className="muted rank-lead">{t("近 7 天收到打赏最多的街区和帖子。只算钱包确认到账的打赏。")}</p>
      <h2 className="section-title">{t("街区")}</h2>
      <ol className="rank-list">
        {top.districts.map((d, i) => (
          <li key={d.bitmap_number}>
            <Link href={`/district/${d.bitmap_number}`}>
              <span className={`rank-no mono${i < 3 ? " top" : ""}`}>{i + 1}</span>
              <TileThumb zone={zoneOf(d.zone)} n={d.bitmap_number} width={56} />
              <span className="grow">
                <b className="mono">{d.name}</b>
                <span className="muted small">{t("{n} 人打赏", { n: d.tippers })}</span>
              </span>
              <span className="rank-score">
                <b className="mono tip-amount">{d.sats.toLocaleString("en-US")}</b>
                <span className="muted small">{t("聪")}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {top.posts.length > 0 && (
        <>
          <h2 className="section-title">{t("帖子")}</h2>
          <div className="tip-posts">
            {top.posts.map((p) => (
              <PostCard key={p.post.id} post={p.post} showDistrict />
            ))}
          </div>
        </>
      )}
    </>
  );
}
