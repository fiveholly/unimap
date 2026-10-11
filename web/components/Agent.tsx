"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useSession } from "./Session";
import { TipDialog } from "./Tip";
import { api, type AgentBriefing, type AgentDraft, type AgentInfo, type AgentProblem, type AgentTask, type AgentView, type AgentGrant, type Agent } from "@/lib/api";
import { short, timeAgo } from "@/lib/format";
import { RARITY_COLORS, RARITY_NAMES } from "@/lib/game";
import { locale, t, tn } from "@/lib/i18n";

const POLL_MS = 3000;
const DAYS = [7, 30, 90];
export const TASK_NAMES: Record<AgentTask, string> = { welcome: "欢迎新居民", digest: "每周街区周报", answers: "回答大家的问题" };
const TASK_HINTS: Record<AgentTask, string> = {
  welcome: "有人认领或搬进这里的地块时，写一条欢迎帖。",
  digest: "每 7 天总结一次这里发生了什么。",
  answers: "有人在你的帖子下面或者居民发帖时提问，起草一条回复。",
};
const PARCEL_HINTS: Partial<Record<AgentTask, string>> = { answers: "有人在你的帖子下面提问时，起草一条回复。" };
const PROBLEMS: Record<AgentProblem, string> = {
  expired: "授权已到期，重新签名就能继续。",
  owner_changed: "你已经不是这个街区的主人，授权失效了。",
  unpaid: "使用时间到了，续费后继续工作。",
  banned: "这个地址被禁止发帖，agent 也停下了。",
  muted: "你在这个街区被禁言了，agent 也停下了。",
};
const problemText = (p: AgentProblem, parcel: number | null) => (p === "owner_changed" && parcel != null ? "你已经不持有这个地块，授权失效了。" : PROBLEMS[p]);
/** Where an agent's routes live: the district's own, or a resident's for one parcel. */
const agentPath = (n: number, parcel: number | null, sub = "") => `/v1/districts/${n}/agent${sub}${parcel != null ? `?parcel=${parcel}` : ""}`;
const tasksOf = (parcel: number | null): AgentTask[] => (parcel != null ? ["answers"] : (Object.keys(TASK_NAMES) as AgentTask[]));
const date = (iso: string) => new Date(iso).toLocaleDateString(locale(), { month: "short", day: "numeric" });

let info: Promise<AgentInfo> | null = null;
function useAgentInfo() {
  const [i, setI] = useState<AgentInfo | null>(null);
  useEffect(() => {
    info ??= api<AgentInfo>("/v1/agent").catch(() => ({ open: false, price_sats: 0, days: 30, max_days: 90, max_per_day: 10, tasks: [] }));
    info.then(setI);
  }, []);
  return i;
}

/** 街区 agent, for the district's owner, or a resident's agent for a parcel they hold: switch it on, look over its drafts, tell it how to talk. */
export function AgentPanel({ n, token, parcel = null }: { n: number; token: string; parcel?: number | null }) {
  const info = useAgentInfo();
  const [view, setView] = useState<AgentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [paying, setPaying] = useState(false);
  const [regrant, setRegrant] = useState(false);
  const load = useCallback(() => api<AgentView>(agentPath(n, parcel), { token }).then(setView), [n, parcel, token]);
  useEffect(() => {
    if (info?.open) load().catch((e) => setError(e.message));
  }, [info?.open, load]);
  // While it is looking, check back until it is done.
  useEffect(() => {
    if (!view?.agent?.running) return;
    const timer = setInterval(() => load().catch(() => {}), POLL_MS);
    return () => clearInterval(timer);
  }, [view?.agent?.running, load]);

  if (!info) return <p className="muted">{t("加载中…")}</p>;
  if (!info.open) return <p className="muted empty">{t("这个站点还没有开放街区 agent。")}</p>;
  if (error && !view) return <p className="error">{error}</p>;
  if (!view) return <p className="muted">{t("加载中…")}</p>;
  const a = view.agent;
  const act = (path: string, method: string, body?: unknown) => {
    setError(null);
    return api(path, { method, token, body })
      .then(() => load())
      .catch((e) => setError(e.message));
  };

  return (
    <div className="agent">
      {!a || regrant ? (
        <AgentSetup n={n} parcel={parcel} token={token} info={info} current={a} onDone={() => (setRegrant(false), load())} onCancel={a ? () => setRegrant(false) : undefined} />
      ) : (
        <section className="agent-card">
          <div className="row between">
            <b>{parcel != null ? t("地块 #{n} 的 agent", { n: parcel }) : t("街区 agent")}</b>
            <span className={`badge${a.problem ? "" : " resident"}`}>{a.problem ? t("已停下") : a.running ? t("正在看…") : t("在工作")}</span>
          </div>
          <p className="muted small">
            {t("授权到 {date} · 今天发了 {x}/{y} 条", { date: date(a.expires_at), x: a.posted_today, y: a.posts_per_day })}
            {a.last && ` · ${t("上次查看 {ago}", { ago: timeAgo(Date.parse(a.last.at) / 1000) })}`}
          </p>
          <p className="small">
            {a.may_publish && a.auto_tasks.length > 0
              ? t("自己发：{tasks}。其他的写成草稿等你确认。", { tasks: a.auto_tasks.map((k) => t(TASK_NAMES[k])).join(t("、")) })
              : t("只写草稿，每条都等你确认。")}
          </p>
          {a.problem && <p className="callout small">{t(problemText(a.problem, parcel))}</p>}
          {info.price_sats > 0 && (
            <p className="small">
              {a.paid_until && Date.parse(a.paid_until) > Date.now()
                ? t("已付到 {date}。", { date: date(a.paid_until) })
                : t("每 {days} 天 {sats} 聪，覆盖模型的费用。", { days: info.days, sats: info.price_sats.toLocaleString("en-US") })}
            </p>
          )}
          {a.running && <p className="muted small" aria-live="polite">{t("正在看街区里的新动静…")}</p>}
          {!a.running && a.last?.error === "model" && <p className="muted small">{t("上次没能连上模型，下一轮会再试。")}</p>}
          {!a.running && a.last?.error === "too_many_drafts" && <p className="muted small">{t("待确认的草稿满了，处理掉几条它才会接着写。")}</p>}
          {error && <p className="error small">{error}</p>}
          <div className="row wrap end">
            {(a.problem === "expired" || a.problem === null) && (
              <button type="button" className="ghost sm" onClick={() => setRegrant(true)}>
                {a.problem ? t("重新签名授权") : t("改授权")}
              </button>
            )}
            {info.price_sats > 0 && a.problem !== "owner_changed" && (
              <button type="button" className={a.problem === "unpaid" ? "primary sm" : "ghost sm"} onClick={() => setPaying(true)}>
                {t("续 {days} 天", { days: info.days })}
              </button>
            )}
            <button type="button" className="ghost sm" onClick={() => setSettings(!settings)} aria-expanded={settings}>
              {t("设置")}
            </button>
            <button
              type="button"
              className="ghost sm"
              onClick={() => confirm(t("撤销 agent 的授权？待确认的草稿会作废，已经发出去的帖子保留。")) && act(agentPath(n, parcel), "DELETE")}
            >
              {t("撤销授权")}
            </button>
            {!a.problem && (
              <button type="button" className="sm" disabled={a.running} onClick={() => act(agentPath(n, parcel, "/run"), "POST")}>
                {t("现在看一下")}
              </button>
            )}
          </div>
          {settings && <AgentSettings n={n} parcel={parcel} token={token} agent={a} onSaved={(v) => (setView(v), setSettings(false))} />}
        </section>
      )}

      {view.briefing.length > 0 && (
        <section>
          <h3 className="section-title">{t("等你处理")}</h3>
          <ul className="agent-brief">
            {view.briefing.map((b, i) => (
              <li key={i}>
                <BriefingLine b={b} n={n} parcel={parcel} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {a && (
        <section>
          <h3 className="section-title">{t("待确认的草稿")}</h3>
          {view.drafts.length === 0 ? (
            <p className="muted small">
              {parcel != null
                ? t("没有待确认的草稿。有人在你的帖子下面提问的时候，它会写在这里。")
                : t("没有待确认的草稿。有新居民、有人提问、或者该写周报的时候，它会写在这里。")}
            </p>
          ) : (
            view.drafts.map((d) => <DraftCard key={d.id} draft={d} token={token} disabled={!!a.problem} onDone={load} />)
          )}
          {view.recent.length > 0 && (
            <details className="agent-recent">
              <summary className="small muted">{t("最近处理过的 {n} 条", { n: view.recent.length })}</summary>
              {view.recent.some((d) => d.auto) && <p className="muted small">{t("它自己发的帖子，你在帖子上随时可以删掉。")}</p>}
              <ul>
                {view.recent.map((d) => (
                  <li key={d.id} className="small">
                    <span className="tag">{d.status === "posted" ? (d.auto ? t("自己发的") : t("已发出")) : d.status === "discarded" ? t("丢掉了") : t("过期了")}</span>{" "}
                    {d.post_id ? <Link href={`/post/${d.post_id}`}>{d.body.slice(0, 60)}</Link> : <span className="muted">{d.body.slice(0, 60)}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {paying && a && (
        <TipDialog
          target={{ bitmap_number: n }}
          to="unimap"
          token={token}
          fixed={info.price_sats}
          bill={{
            title: parcel != null ? t("续用地块 agent") : t("续用街区 agent"),
            note: t("付给 unimap，用来支付 agent 调用模型的费用，到账后延长 {days} 天。", { days: info.days }),
            done: t("付款成功，agent 可以再工作 {days} 天。", { days: info.days }),
            create: agentPath(n, parcel, "/pay"),
            status: (id) => `/v1/agent/payments/${id}`,
          }}
          close={() => {
            setPaying(false);
            load().catch(() => {});
          }}
        />
      )}
    </div>
  );
}

function BriefingLine({ b, n, parcel }: { b: AgentBriefing; n: number; parcel: number | null }) {
  switch (b.kind) {
    case "treasure":
      return (
        <Link href={`/district/${n}`}>
          {tn("你的地块 #{i} 上有一个{rarity}宝箱，区块 {end} 之前去打开它。", {
            i: parcel ?? 0,
            rarity: <b style={{ color: RARITY_COLORS[b.rarity] }}>{t(RARITY_NAMES[b.rarity])}</b>,
            end: b.closes_at_height.toLocaleString("en-US"),
          })}
        </Link>
      );
    case "applications":
      return <>{t("有 {n} 份入住申请，去「管理街区 → 招募」看看。", { n: b.count })}</>;
    case "poll_closing":
      return <>{t("投票「{q}」{when}截止。", { q: b.question, when: date(b.closes_at) })}</>;
    case "prizes_unpaid":
      return (
        <Link href={`/district/${n}?tab=contests`}>{t("第 {s} 赛季的活动还有 {n} 份奖金没发。", { s: b.season, n: b.count })}</Link>
      );
  }
}

function AgentSetup({ n, parcel, token, info, current, onDone, onCancel }: { n: number; parcel: number | null; token: string; info: AgentInfo; current: Agent | null; onDone: () => void; onCancel?: () => void }) {
  const { sign } = useSession();
  const [perDay, setPerDay] = useState(current?.posts_per_day ?? 3);
  const [days, setDays] = useState(30);
  const [mayPublish, setMayPublish] = useState(current?.may_publish ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setError(null);
    setBusy(true);
    try {
      const g = await api<{ id: number; message: string }>(agentPath(n, parcel, "/prepare"), { method: "POST", token, body: { posts_per_day: perDay, days, may_publish: mayPublish } });
      const signature = await sign(g.message);
      await api(agentPath(n, parcel), { method: "POST", token, body: { id: g.id, signature } });
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "cancelled") setError(msg);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="agent-card agent-setup">
      <b>{current ? t("重新签名授权") : parcel != null ? t("给地块 #{n} 开通 agent", { n: parcel }) : t("开通街区 agent")}</b>
      {!current && (
        <>
          <p className="small">
            {parcel != null
              ? t("它帮你照看你在这里的地块：有人在你的帖子下面提问时起草回复，还能帮你盯着附近的挂单。")
              : t("它帮你打理这个街区：欢迎新居民、每周写一份周报、回答大家的问题，还能帮你盯着附近的挂单。")}
          </p>
          <ul className="small agent-points">
            <li>{t("默认它只写草稿，每一条都要你点确认才会发出去。发出的帖子都标着「agent 代发」。")}</li>
            <li>{t("你的钱包签一份授权，写明它能在这里做什么、每天最多几条、什么时候到期。它有自己的密钥，只能签帖子，拿不到你的钱包，也动不了任何资产。")}</li>
            <li>{parcel != null ? t("随时可以撤销。地块卖掉以后，授权自动失效。") : t("随时可以撤销。街区卖掉以后，授权自动失效。")}</li>
            {info.price_sats > 0 && <li>{t("开通后每 {days} 天付 {sats} 聪，覆盖模型的费用。", { days: info.days, sats: info.price_sats.toLocaleString("en-US") })}</li>}
          </ul>
        </>
      )}
      <div className="row wrap">
        <label className="small">
          {t("每天最多发")}
          <select value={perDay} onChange={(e) => setPerDay(Number(e.target.value))}>
            {Array.from({ length: info.max_per_day }, (_, i) => i + 1).map((k) => (
              <option key={k} value={k}>
                {t("{n} 条", { n: k })}
              </option>
            ))}
          </select>
        </label>
        <label className="small">
          {t("授权多久")}
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {DAYS.filter((d) => d <= info.max_days).map((d) => (
              <option key={d} value={d}>
                {t("{n} 天", { n: d })}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="check small">
        <input type="checkbox" checked={mayPublish} onChange={(e) => setMayPublish(e.target.checked)} />
        <span>
          <b>{t("允许它自己发帖")}</b>{" "}
          <span className="muted">
            {parcel != null
              ? t("授权里会写上这一条。回答写好就直接发，不超过每天的条数。")
              : t("授权里会写上这一条。欢迎新居民和周报写好就直接发，不超过每天的条数；回答问题默认仍然等你确认，可以在设置里改。")}
          </span>
        </span>
      </label>
      {error && <p className="error small">{error}</p>}
      <div className="row end">
        {onCancel && (
          <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
            {t("取消")}
          </button>
        )}
        <button type="button" className="primary" onClick={go} disabled={busy}>
          {busy ? t("等待钱包签名…") : t("签名授权")}
        </button>
      </div>
    </section>
  );
}

function AgentSettings({ n, parcel, token, agent, onSaved }: { n: number; parcel: number | null; token: string; agent: Agent; onSaved: (v: AgentView) => void }) {
  const [persona, setPersona] = useState(agent.persona);
  const [tasks, setTasks] = useState<AgentTask[]>(agent.tasks);
  const [auto, setAuto] = useState<AgentTask[]>(agent.auto_tasks);
  const [radius, setRadius] = useState(String(agent.watch.radius ?? ""));
  const [price, setPrice] = useState(String(agent.watch.max_price_sats ?? ""));
  const [memory, setMemory] = useState(agent.memory);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      onSaved(
        await api<AgentView>(agentPath(n, parcel, "/settings"), {
          method: "PUT",
          token,
          body: { persona, tasks, memory, ...(agent.may_publish ? { auto_tasks: auto } : {}), watch: { radius: Math.min(100, Number(radius) || 0), max_price_sats: Number(price) || 0 } },
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="agent-settings" onSubmit={(e) => (e.preventDefault(), save())}>
      <fieldset>
        <legend className="small">{t("它做哪些事")}</legend>
        {tasksOf(parcel).map((k) => (
          <label key={k} className="check small">
            <input type="checkbox" checked={tasks.includes(k)} onChange={(e) => setTasks(e.target.checked ? [...tasks, k] : tasks.filter((x) => x !== k))} />
            <span>
              <b>{t(TASK_NAMES[k])}</b> <span className="muted">{t((parcel != null && PARCEL_HINTS[k]) || TASK_HINTS[k])}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {agent.may_publish && (
        <fieldset>
          <legend className="small">{t("哪些不用等你确认，写好就发")}</legend>
          {tasksOf(parcel).map((k) => (
            <label key={k} className="check small">
              <input type="checkbox" checked={auto.includes(k)} disabled={!tasks.includes(k)} onChange={(e) => setAuto(e.target.checked ? [...auto, k] : auto.filter((x) => x !== k))} />
              <span>
                <b>{t(TASK_NAMES[k])}</b>
              </span>
            </label>
          ))}
          <p className="muted small">{t("一天最多发授权里写的条数，超出的照样写成草稿等你。")}</p>
        </fieldset>
      )}
      <label className="small">
        {parcel != null ? t("人设：告诉它怎么说话、你是个什么样的邻居") : t("人设：告诉它怎么说话、这条街有什么讲究")}
        <textarea rows={3} maxLength={1000} value={persona} onChange={(e) => setPersona(e.target.value)} placeholder={t("比如：语气轻松一点，叫居民「邻居」，别用感叹号。")} />
      </label>
      <fieldset>
        <legend className="small">{t("盯着附近的挂单")}</legend>
        <div className="row wrap">
          <label className="small">
            {t("前后多少个街区")}
            <input inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="20" />
          </label>
          <label className="small">
            {t("价格不高于（聪）")}
            <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 12))} placeholder="1000000" />
          </label>
        </div>
        <p className="muted small">{t("有符合条件的街区挂单时发通知给你，每个街区只提醒一次。两项都填才会开始盯。")}</p>
      </fieldset>
      {memory.length > 0 && (
        <fieldset>
          <legend className="small">{t("它记下的笔记")}</legend>
          <ul className="agent-notes">
            {memory.map((m) => (
              <li key={m} className="small">
                <span className="grow">{m}</span>
                <button type="button" className="link-btn small" onClick={() => setMemory(memory.filter((x) => x !== m))}>
                  {t("删掉")}
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {error && <p className="error small">{error}</p>}
      <div className="row end">
        <button type="submit" className="primary sm" disabled={busy}>
          {busy ? t("保存中…") : t("保存")}
        </button>
      </div>
    </form>
  );
}

function DraftCard({ draft, token, disabled, onDone }: { draft: AgentDraft; token: string; disabled: boolean; onDone: () => Promise<unknown> }) {
  const [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (path: string, method: string, payload?: unknown) => {
    setError(null);
    setBusy(true);
    try {
      await api(path, { method, token, body: payload });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <article className="agent-draft" aria-label={t(TASK_NAMES[draft.task])}>
      <div className="row between small">
        <span className="tag">{t(TASK_NAMES[draft.task])}</span>
        <span className="muted">{timeAgo(Date.parse(draft.created_at) / 1000)}</span>
      </div>
      {draft.why && <p className="muted small">{draft.why}</p>}
      {draft.reply_to != null && (
        <p className="small">
          <Link href={`/post/${draft.reply_to}`}>{t("回复这条帖子 ↗")}</Link>
        </p>
      )}
      <textarea rows={Math.min(8, Math.max(3, body.split("\n").length + 1))} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} aria-label={t("草稿内容")} />
      {error && <p className="error small">{error}</p>}
      <div className="row end">
        <button type="button" className="ghost sm" disabled={busy} onClick={() => run(`/v1/agent/drafts/${draft.id}`, "DELETE")}>
          {t("丢掉")}
        </button>
        <button
          type="button"
          className="primary sm"
          disabled={busy || disabled || !body.trim()}
          onClick={() => run(`/v1/agent/drafts/${draft.id}/publish`, "POST", { body: body === draft.body ? null : body })}
        >
          {body === draft.body ? t("发出") : t("改好了，发出")}
        </button>
      </div>
    </article>
  );
}

/** Under an agent's post, in the signature details: whose grant it acted under, to check. */
export function AgentGrantNote({ grantId, agentKey }: { grantId: number; agentKey: string }) {
  const [grant, setGrant] = useState<AgentGrant | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="small">
      <p className="muted">
        {t("这条由 agent 代发，用它自己的密钥 {key} 签名（对签名原文的 SHA-256 做 BIP-340 签名）。发帖人用钱包签过授权：", { key: short(agentKey) })}{" "}
        <button
          type="button"
          className="link-btn small"
          onClick={() => {
            setOpen(!open);
            if (!grant) api<AgentGrant>(`/v1/agent/grants/${grantId}`).then(setGrant).catch(() => {});
          }}
          aria-expanded={open}
        >
          {open ? t("收起授权") : t("看授权")}
        </button>
      </p>
      {open && grant && (
        <>
          <p className="muted">{t("签名地址 {address}", { address: grant.owner })}{grant.revoked_at && ` · ${t("已撤销")}`}</p>
          <pre className="message">{grant.message}</pre>
          <code className="small break">{grant.signature}</code>
        </>
      )}
    </div>
  );
}
