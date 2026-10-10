"use client";

import { useCallback, useEffect, useState } from "react";

import { api, type Poll } from "@/lib/api";
import { locale, t } from "@/lib/i18n";

const DAYS = [1, 3, 7, 14];

/** A district's polls: the owner asks, the owner and residents vote, everyone sees results. */
export function Polls({ n, token, canVote, isOwner }: { n: number; token: string | null; canVote: boolean; isOwner: boolean }) {
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () => api<{ polls: Poll[] }>(`/v1/districts/${n}/polls`, { token }).then((r) => setPolls(r.polls)),
    [n, token],
  );
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  const replace = (p: Poll) => setPolls((ps) => (ps ?? []).map((x) => (x.id === p.id ? p : x)));
  const act = (path: string, method: string, body?: unknown) =>
    api<Poll>(path, { method, token, body })
      .then(replace)
      .catch((e) => setError(e.message));

  if (error) return <p className="error">{error}</p>;
  if (!polls) return <p className="muted">{t("加载中…")}</p>;
  return (
    <div className="polls">
      {isOwner && <NewPoll n={n} token={token} onCreated={(p) => setPolls([p, ...polls])} />}
      {!canVote && token && polls.some((p) => !p.closed) && <p className="muted small hint">{t("街区主人和居民可以投票，访客可以看结果。")}</p>}
      {polls.length === 0 && <p className="muted empty">{t("还没有投票。")}{isOwner ? "" : t("街区主人可以在这里发起投票。")}</p>}
      {polls.map((p) => (
        <PollCard
          key={p.id}
          poll={p}
          canVote={canVote && !p.closed}
          onVote={(o) => act(`/v1/polls/${p.id}/vote`, "PUT", { option: o })}
          onClose={isOwner && !p.closed ? () => confirm(t("提前结束这个投票？")) && act(`/v1/polls/${p.id}/close`, "POST") : undefined}
        />
      ))}
    </div>
  );
}

function PollCard({ poll, canVote, onVote, onClose }: { poll: Poll; canVote: boolean; onVote: (o: number) => void; onClose?: () => void }) {
  const ends = new Date(poll.closes_at);
  const lead = Math.max(...poll.counts);
  const when = { n: poll.total, date: ends.toLocaleDateString(locale()), time: ends.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) };
  return (
    <article className="poll" aria-label={poll.question}>
      <div className="row between">
        <b>{poll.question}</b>
        <span className={`badge${poll.closed ? "" : " resident"}`}>{poll.closed ? t("已结束") : t("进行中")}</span>
      </div>
      <ul className="poll-options">
        {poll.options.map((o, i) => {
          const pct = poll.total ? Math.round((poll.counts[i] / poll.total) * 100) : 0;
          const mine = poll.my_vote === i;
          return (
            <li key={i}>
              <button
                type="button"
                className={`poll-option${mine ? " mine" : ""}${poll.closed && poll.total && poll.counts[i] === lead ? " lead" : ""}`}
                disabled={!canVote}
                aria-pressed={mine}
                onClick={() => onVote(i)}
              >
                <i style={{ width: `${pct}%` }} aria-hidden />
                <span>
                  {o}
                  {mine && ` · ${t("我的选择")}`}
                </span>
                <span className="mono">
                  {t("{n} 票 · {pct}%", { n: poll.counts[i], pct })}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="row between small muted">
        <span>
          {poll.closed ? t("{n} 人投票 · 结束于 {date} {time}", when) : t("{n} 人投票 · 截止 {date} {time}", when)}
        </span>
        {onClose && (
          <button type="button" className="link-btn small" onClick={onClose}>
            {t("提前结束")}
          </button>
        )}
      </div>
    </article>
  );
}

function NewPoll({ n, token, onCreated }: { n: number; token: string | null; onCreated: (p: Poll) => void }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [days, setDays] = useState(7);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button type="button" className="ghost new-poll" onClick={() => setOpen(true)}>
        {t("发起投票")}
      </button>
    );
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const ok = question.trim() && filled.length >= 2 && new Set(filled).size === filled.length;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await api<Poll>(`/v1/districts/${n}/polls`, { method: "POST", token, body: { question, options: filled, days } });
      onCreated(p);
      setOpen(false);
      setQuestion("");
      setOptions(["", ""]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="composer poll-form" aria-label={t("发起投票")}>
      <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t("要问大家什么？")} maxLength={200} name="question" />
      {options.map((o, i) => (
        <div className="row tight" key={i}>
          <input
            value={o}
            onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder={t("选项 {n}", { n: i + 1 })}
            maxLength={60}
            name={`option${i}`}
            className="grow"
          />
          {options.length > 2 && (
            <button type="button" className="ghost" onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label={t("删除选项 {n}", { n: i + 1 })}>
              {t("删除")}
            </button>
          )}
        </div>
      ))}
      <div className="composer-bar">
        {options.length < 4 && (
          <button type="button" className="link-btn small" onClick={() => setOptions([...options, ""])}>
            {t("加一个选项")}
          </button>
        )}
        <label className="inline small">
          {t("投票时长")}
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} name="days">
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {t("{n} 天", { n: d })}
              </option>
            ))}
          </select>
        </label>
        <span className="grow" />
        {error && <span className="error small">{error}</span>}
        <button type="button" className="ghost" onClick={() => setOpen(false)}>
          {t("取消")}
        </button>
        <button type="button" className="primary" disabled={!ok || busy} onClick={submit}>
          {t("发起")}
        </button>
      </div>
    </section>
  );
}
