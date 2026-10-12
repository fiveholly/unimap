"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { BadgeIcon } from "./Badge";
import type { Section } from "./OwnerTools";
import { api, type Opened, type Opening } from "@/lib/api";
import { t } from "@/lib/i18n";
import { timeAgo } from "@/lib/format";

/** Starter posts the owner can pick for the district's first post. */
const STARTERS = (n: number) => [
  t("{n}.bitmap 开张了！这里是我的街区，欢迎路过的朋友留言打个招呼。", { n }),
  t("{n}.bitmap 在招邻居：想在比特币的一个区块上安家的，来申请入住，我会同意你暂住。", { n }),
  t("每周在 {n}.bitmap 聊一个话题。这周先聊：你是怎么开始玩 Bitmap 的？", { n }),
];

/** 开张: for the owner of a district that isn't going yet, three steps to get it going. */
export function OpeningCard({
  n,
  token,
  version,
  onEdit,
  onDraft,
}: {
  n: number;
  token: string | null;
  /** Bumped after the district changes, so the steps are checked again. */
  version: unknown;
  onEdit: (section: Section) => void;
  onDraft: (text: string) => void;
}) {
  const [o, setO] = useState<Opening | null>(null);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!token) return;
    api<Opening>(`/v1/districts/${n}/opening`, { token })
      .then((r) => {
        setO(r);
        if (r.new) setFresh(true);
      })
      .catch(() => {});
  }, [n, token, version]);
  if (!o || (o.opened && !fresh)) return null;
  if (o.opened)
    return (
      <section className="callout opening done" aria-label={t("开张")}>
        <BadgeIcon kind="opening" rarity="rare" size={40} />
        <div>
          <b>{t("{n}.bitmap 开张了！", { n })}</b>
          <p className="muted small">{t("你拿到了开张徽章。接下来 7 天，首页的「新开张的街区」会列出这里，让访客找过来。")}</p>
        </div>
      </section>
    );
  const steps: [keyof Opening["steps"], string, React.ReactNode][] = [
    ["bio", t("写一段街区简介"), <button key="b" type="button" className="link-btn small" onClick={() => onEdit("profile")}>{t("去写")} →</button>],
    [
      "post",
      t("发第一条帖子"),
      <span key="p" className="chips">
        {STARTERS(n).map((s, i) => (
          <button key={i} type="button" className="chip small" title={s} onClick={() => onDraft(s)}>
            {[t("打招呼"), t("招邻居"), t("开个话题")][i]}
          </button>
        ))}
      </span>,
    ],
    ["recruit", t("发布招募，欢迎新居民"), <button key="r" type="button" className="link-btn small" onClick={() => onEdit("recruit")}>{t("去发布")} →</button>],
  ];
  const done = steps.filter(([k]) => o.steps[k]).length;
  return (
    <section className="callout opening" aria-label={t("开张")}>
      <div className="row between">
        <b>{t("让街区开张")}</b>
        <span className="mono small">
          {done}/{steps.length}
        </span>
      </div>
      <p className="muted small">{t("空街区没人来。做完这三步就能拿到开张徽章，首页也会把这里列进「新开张的街区」。")}</p>
      <ul className="today">
        {steps.map(([k, text, action]) => (
          <li key={k} className={o.steps[k] ? "done" : ""}>
            <span className="today-check" aria-hidden>
              {o.steps[k] ? "✓" : ""}
            </span>
            <span className="grow">{text}</span>
            {!o.steps[k] && action}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 新开张的街区: on the home page, districts whose owners just got them going. */
export function OpenedList() {
  const [list, setList] = useState<Opened[] | null>(null);
  useEffect(() => {
    api<{ districts: Opened[] }>("/v1/opened")
      .then((r) => setList(r.districts))
      .catch(() => {});
  }, []);
  if (!list?.length) return null;
  return (
    <section className="opened" aria-label={t("新开张的街区")}>
      <h2 className="section-title">{t("新开张的街区")}</h2>
      <ul>
        {list.map((d) => (
          <li key={d.bitmap_number}>
            <Link href={`/district/${d.bitmap_number}`}>
              <b className="mono">{d.bitmap_number}.bitmap</b>
              <span className="muted small grow">{d.bio || t("还没写简介")}</span>
              <span className="dim small">
                {t("{n} 帖", { n: d.posts })} · {timeAgo(new Date(d.opened_at).getTime() / 1000)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
