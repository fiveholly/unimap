"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Avatar } from "./Avatar";
import { TipDialog } from "./Tip";
import { api, type Contest, type ContestMetric } from "@/lib/api";
import { short } from "@/lib/format";
import { t } from "@/lib/i18n";

const sats = (n: number) => n.toLocaleString("en-US");
const PLACES = 3;
const MIN_PRIZE = 100; // as api/events.py
const MAX_PRIZE = 1_000_000;

export const METRIC_NAMES: Record<ContestMetric, string> = { posts: "发帖#metric", replies: "回复#metric", checkins: "签到#metric" };
const UNITS: Record<ContestMetric, string> = { posts: "{n} 条帖子", replies: "{n} 条回复", checkins: "签到 {n} 天" };

/** 街区活动 on a district's page: what the owner put up, who leads, who won and whether they were paid. */
export function Contests({ n, token, me, isOwner }: { n: number; token: string | null; me: string | null; isOwner: boolean }) {
  const [list, setList] = useState<Contest[] | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<{ contest: Contest; place: number } | null>(null);
  const load = useCallback(
    () =>
      api<{ events: Contest[]; season: number | null }>(`/v1/districts/${n}/events`, { token }).then((r) => {
        setList(r.events);
        setSeason(r.season);
      }),
    [n, token],
  );
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  if (error) return <p className="error">{error}</p>;
  if (!list) return <p className="muted">{t("加载中…")}</p>;
  const taken = new Set(list.filter((c) => c.status !== "cancelled").map((c) => c.season));
  const open = season == null ? [] : [season, season + 1].filter((s) => !taken.has(s));
  const cancel = (c: Contest) =>
    confirm(t("取消第 {s} 赛季的活动？", { s: c.season })) &&
    api(`/v1/events/${c.id}`, { method: "DELETE", token })
      .then(load)
      .catch((e) => setError(e.message));
  return (
    <div className="contests">
      {isOwner && token && open.length > 0 && <NewContest n={n} token={token} seasons={open} current={season!} onCreated={load} />}
      {list.length === 0 && (
        <p className="muted empty">
          {t("这里还没有活动。")}
          {isOwner ? "" : t("街区主人可以出一笔聪，奖励一个赛季里在这里最活跃的人。")}
        </p>
      )}
      {list.map((c) => (
        <ContestCard
          key={c.id}
          contest={c}
          me={me}
          isHost={!!me && me === c.host}
          onPay={(place) => setPaying({ contest: c, place })}
          onCancel={() => cancel(c)}
        />
      ))}
      {paying && token && (
        <TipDialog
          target={{ event_id: paying.contest.id, place: paying.place }}
          to={short(paying.contest.winners![paying.place - 1].address)}
          token={token}
          fixed={paying.contest.winners![paying.place - 1].prize_sats}
          close={() => {
            setPaying(null);
            load().catch(() => {});
          }}
        />
      )}
    </div>
  );
}

function ContestCard({ contest: c, me, isHost, onPay, onCancel }: { contest: Contest; me: string | null; isHost: boolean; onPay: (place: number) => void; onCancel: () => void }) {
  const status = { upcoming: t("未开始"), running: t("进行中"), ended: t("已结束"), cancelled: t("已取消") }[c.status];
  const rows = c.status === "running" ? (c.standings ?? []).map((s, i) => ({ place: i + 1, address: s.address, score: s.score })) : (c.winners ?? []);
  return (
    <article className={`contest ${c.status}`} aria-label={t("第 {s} 赛季活动", { s: c.season })}>
      <div className="row between">
        <b>
          {t("第 {s} 赛季：{metric}最多的人赢聪", { s: c.season, metric: t(METRIC_NAMES[c.metric]) })}
        </b>
        <span className={`badge${c.status === "running" ? " resident" : ""}`}>{status}</span>
      </div>
      <p className="muted small mono">{t("区块 {a} – {b}", { a: sats(c.since), b: sats(c.until) })}</p>
      <ol className="contest-prizes">
        {c.prizes.map((p, i) => (
          <li key={i}>
            <span className="muted">{t("第 {n} 名", { n: i + 1 })}</span> <b className="mono">{sats(p)}</b> {t("聪")}
          </li>
        ))}
      </ol>
      {c.note && <p className="contest-note">“{c.note}”</p>}
      <p className="muted small">
        {t("主人 {who} 出资，赛季结束后用闪电直接发给获奖者，unimap 不经手。在这里{metric}就算参加，免费；主人自己不参与排名。", {
          who: short(c.host),
          metric: t(METRIC_NAMES[c.metric]),
        })}
      </p>
      {(c.status === "running" || c.status === "ended") && (
        <>
          <h4 className="small">{c.status === "running" ? t("目前领先") : t("获奖者")}</h4>
          {rows.length === 0 ? (
            <p className="muted small">{c.status === "running" ? t("还没有人参加，第一个来的就领先。") : t("这个赛季没有人参加。")}</p>
          ) : (
            <ul className="contest-rows">
              {rows.map((r) => {
                const w = c.status === "ended" ? c.winners?.[r.place - 1] : undefined;
                return (
                  <li key={r.address} className={r.address === me ? "me" : ""}>
                    <span className="mono rank">{r.place}</span>
                    <Avatar seed={r.address} size={24} />
                    <Link className="mono grow" href={`/address/${r.address}`}>
                      {short(r.address)}
                      {r.address === me && <span className="muted"> {t("（你）")}</span>}
                    </Link>
                    <span className="small muted">{t(UNITS[c.metric], { n: r.score })}</span>
                    {w &&
                      (w.paid === "settled" ? (
                        <span className="tag paid">{t("✓ 已发 {n} 聪", { n: sats(w.prize_sats) })}</span>
                      ) : isHost ? (
                        <button type="button" className="primary sm" onClick={() => onPay(w.place)}>
                          {w.paid === "pending" ? t("继续发奖") : t("发 {n} 聪", { n: sats(w.prize_sats) })}
                        </button>
                      ) : (
                        <span className="tag">{w.paid === "pending" ? t("发奖中") : t("待发奖")}</span>
                      ))}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {c.status === "upcoming" && isHost && (
        <div className="row end">
          <button type="button" className="ghost sm" onClick={onCancel}>
            {t("取消活动")}
          </button>
        </div>
      )}
    </article>
  );
}

function NewContest({ n, token, seasons, current, onCreated }: { n: number; token: string; seasons: number[]; current: number; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [metric, setMetric] = useState<ContestMetric>("posts");
  const [prizes, setPrizes] = useState<string[]>(["10000", "5000", "2000"]);
  const [places, setPlaces] = useState(3);
  const [note, setNote] = useState("");
  const [season, setSeason] = useState(seasons[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <button type="button" className="contest-new-btn" onClick={() => setOpen(true)}>
        {t("+ 办一个活动")}
      </button>
    );
  const amounts = prizes.slice(0, places).map((p) => Math.floor(Number(p)));
  const submit = async () => {
    setError(null);
    if (amounts.some((a) => !Number.isFinite(a) || a < MIN_PRIZE || a > MAX_PRIZE)) return setError(t("每份奖金是 100 到 1,000,000 聪"));
    if (amounts.some((a, i) => i > 0 && a > amounts[i - 1])) return setError(t("后面名次的奖金不能比前面多"));
    setBusy(true);
    try {
      await api(`/v1/districts/${n}/events`, { method: "POST", token, body: { metric, prizes: amounts, note, next_season: season !== current } });
      setOpen(false);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="contest-new" onSubmit={(e) => (e.preventDefault(), submit())}>
      <b>{t("办一个街区活动")}</b>
      <p className="muted small">{t("你出一笔聪，奖励一个赛季里在你的街区最活跃的人。赛季结束时 unimap 公布获奖者，你用闪电把奖金直接发给他们。活动开始后就不能取消。")}</p>
      <label>
        {t("赛季")}
        <select value={season} onChange={(e) => setSeason(Number(e.target.value))}>
          {seasons.map((s) => (
            <option key={s} value={s}>
              {s === current ? t("第 {s} 赛季（现在这个）", { s }) : t("第 {s} 赛季（下一个）", { s })}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("比什么")}
        <select value={metric} onChange={(e) => setMetric(e.target.value as ContestMetric)}>
          {(Object.keys(METRIC_NAMES) as ContestMetric[]).map((m) => (
            <option key={m} value={m}>
              {t("{metric}最多", { metric: t(METRIC_NAMES[m]) })}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("几个名次")}
        <select value={places} onChange={(e) => setPlaces(Number(e.target.value))}>
          {Array.from({ length: PLACES }, (_, i) => i + 1).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <div className="contest-prize-inputs">
        {prizes.slice(0, places).map((p, i) => (
          <label key={i}>
            {t("第 {n} 名（聪）", { n: i + 1 })}
            <input inputMode="numeric" value={p} onChange={(e) => setPrizes(prizes.map((x, j) => (j === i ? e.target.value.replace(/\D/g, "").slice(0, 7) : x)))} />
          </label>
        ))}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder={t("说一句话（可选），比如：欢迎新邻居多来坐坐")} aria-label={t("说一句话")} />
      {error && <p className="error small">{error}</p>}
      <div className="row end">
        <button type="button" className="ghost" onClick={() => setOpen(false)} disabled={busy}>
          {t("取消")}
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? t("提交中…") : t("公布活动，共 {n} 聪", { n: sats(amounts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)) })}
        </button>
      </div>
    </form>
  );
}

/** On the game page: events running now or starting next season, across the city. */
export function CityContests() {
  const [list, setList] = useState<Contest[] | null>(null);
  useEffect(() => {
    api<{ events: Contest[] }>("/v1/events")
      .then((r) => setList(r.events))
      .catch(() => setList([]));
  }, []);
  if (!list) return null;
  return (
    <section className="game-card contests-city">
      <h2 className="section-title">{t("街区活动")}</h2>
      <p className="muted small">{t("街区主人自己出聪办的比赛。去那个街区发帖、回复或者签到就算参加，免费。")}</p>
      {list.length === 0 ? (
        <p className="muted small">{t("现在还没有活动。你有街区的话，可以在街区页的「活动」里办一个。")}</p>
      ) : (
        <ul className="city-contests">
          {list.map((c) => (
            <li key={c.id}>
              <Link className="mono" href={`/district/${c.bitmap_number}?tab=contests`}>
                {c.bitmap_number}.bitmap
              </Link>
              <span className="grow">
                {t("{metric}最多的人赢聪", { metric: t(METRIC_NAMES[c.metric]) })}
                {c.status === "upcoming" && <span className="muted small"> · {t("第 {s} 赛季开始", { s: c.season })}</span>}
              </span>
              <b className="mono">{sats(c.total_sats)}</b> <span className="muted small">{t("聪")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
