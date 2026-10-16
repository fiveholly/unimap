"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { ReportDialog } from "@/components/Report";
import { short, useSession } from "@/components/Session";
import { api, ApiError, type CapsulePeer, type CapsulePeers, type CapsuleScope } from "@/lib/api";
import { TAG_NAMES } from "@/lib/capsule";
import { t } from "@/lib/i18n";

const SCOPES: [CapsuleScope, string][] = [
  ["block", "这一块"],
  ["hour", "前后 1 小时"],
  ["day", "这一天"],
];

const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16);

/** 同块人: everyone who sealed a capsule on this block (or within an hour, or that day) and chose to say one thing in public. */
export default function SameBlockPage() {
  const { h } = useParams<{ h: string }>();
  const height = Number(h);
  const { address, token, ready } = useSession();
  const [scope, setScope] = useState<CapsuleScope>("block");
  const [data, setData] = useState<CapsulePeers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<CapsulePeers>(`/v1/capsules/peers/${height}?scope=${scope}`, { token })
        .then((d) => {
          setData(d);
          setTo((cur) => cur ?? d.peers.find((p) => !p.mine)?.address ?? null);
        })
        .catch((e) => setError(e instanceof ApiError && e.status === 404 ? t("这个区块还没出来。") : e.message)),
    [height, scope, token],
  );
  // Wait for the session, so a reply without it can't land after the one with it.
  useEffect(() => {
    if (ready) load();
  }, [load, ready]);

  if (!Number.isInteger(height) || height < 0) return <p className="page error">{t("这个区块还没出来。")}</p>;
  if (error) return <p className="page error">{error}</p>;
  if (!data) return <p className="page muted">{t("加载中…")}</p>;

  const removeMine = async (p: CapsulePeer) => {
    if (!p.capsule_id) return;
    await api(`/v1/capsules/${p.capsule_id}/line`, { method: "DELETE", token }).catch(() => {});
    load();
  };

  return (
    <div className="page capsule-page">
      <div className="cap-two">
        <div className="cap-main">
          <p className="eyebrow mono">
            {t("区块 {n}", { n: height.toLocaleString("en-US") })} · {data.day} UTC
          </p>
          <div className="cap-peers-head">
            <span className="cap-big mono">{data.counts[scope].toLocaleString("en-US")}</span>
            <h1 className="cap-title">
              {scope === "block" ? t("个人把这一刻留在了这一块") : scope === "hour" ? t("个人把这一刻留在了前后一小时") : t("个人把这一刻留在了这一天")}
            </h1>
          </div>
          <nav className="tabs cap-tabs" aria-label={t("范围")}>
            {SCOPES.map(([k, label]) => (
              <button key={k} type="button" className={scope === k ? "active" : ""} aria-pressed={scope === k} onClick={() => setScope(k)}>
                {t(label)} · <span className="mono">{data.counts[k].toLocaleString("en-US")}</span>
              </button>
            ))}
          </nav>
          {data.peers.length === 0 ? (
            <p className="muted cap-empty">
              {t("还没有人在这里公开留话。")} <Link href="/capsule">{t("封一封信，留下第一句")}</Link>
            </p>
          ) : (
            <ul className="cap-peers">
              {data.peers.map((p) => (
                <li key={p.ref} className={to === p.address && !p.mine ? "picked" : ""}>
                  <Avatar seed={p.address} size={34} />
                  <div className="grow">
                    <div className="cap-who">
                      {p.mine ? <b>{t("你")}</b> : <Link href={`/address/${p.address}`} className="mono">{short(p.address)}</Link>}
                      {p.tag && <span className={`cap-tag${p.mine ? " me" : ""}`}>{t(TAG_NAMES[p.tag])}</span>}
                      {scope !== "block" && <span className="dim small mono">{t("区块 {n}", { n: p.sealed_height.toLocaleString("en-US") })}</span>}
                    </div>
                    <p className="cap-say">{p.line}</p>
                    <div className="cap-peer-actions small">
                      {p.mine ? (
                        <button type="button" className="link-btn" onClick={() => removeMine(p)}>
                          {t("撤下这句话")}
                        </button>
                      ) : (
                        <>
                          <button type="button" className="link-btn" onClick={() => setTo(p.address)}>
                            {t("打个招呼")}
                          </button>
                          {token && (
                            <button type="button" className="link-btn" onClick={() => setReporting(p.ref)}>
                              {t("举报#tab")}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <span className="dim small mono">{hhmm(p.sealed_at)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="dim small">{t("只显示主人选择公开的那一句话。信的内容永远不会出现在这里。")}</p>
        </div>
        <aside className="cap-side">
          <h2 className="cap-side-title">{t("和同块人打个招呼")}</h2>
          <p className="muted small">{t("你们没有共同好友，也不在一个城市，唯一的共同点是同一个时刻。")}</p>
          {to && to !== address ? <Hello to={to} token={token} /> : <p className="dim small">{t("在左边选一个人，给对方发一条私信。")}</p>}
          <div className="cap-ring">
            <div>
              <b className="mono">{data.sealed_here.toLocaleString("en-US")}</b>
              <small>{t("封在这一块")}</small>
            </div>
            <div>
              <b className="mono">{data.births_here.toLocaleString("en-US")}</b>
              <small>{t("其中出生")}</small>
            </div>
            <div>
              <b className="mono">{data.counts.block.toLocaleString("en-US")}</b>
              <small>{t("公开了一句")}</small>
            </div>
          </div>
          <div className="cap-kv">
            <div>
              <span>{t("公开的内容")}</span>
              <span>{t("只有一句话和钱包缩写")}</span>
            </div>
            <div>
              <span>{t("私信")}</span>
              <Link href="/messages">{t("我的私信")}</Link>
            </div>
          </div>
          <Link className="btn" href="/capsule">
            {t("我也封一封")}
          </Link>
        </aside>
      </div>
      {reporting && token && (
        <ReportDialog path={`/v1/capsules/lines/${reporting}/report`} title={t("举报这句话")} token={token} close={() => setReporting(null)} />
      )}
    </div>
  );
}

/** A first private message to someone on the same block. */
function Hello({ to, token }: { to: string; token: string | null }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setSent(false);
    setError(null);
  }, [to]);
  if (!token) return <p className="dim small">{t("连接钱包后可以私聊。")}</p>;
  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/dms/${to}`, { method: "POST", token, body: { body: body.trim() } });
      setSent(true);
      setBody("");
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? t("对方没有开放陌生人私信，或者不想收到你的消息。") : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cap-field">
      <span>{t("私聊 {who}", { who: short(to) })}</span>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={1000} placeholder={t("恭喜！明年这一天，我们都来这块报个到？")} name="hello" />
      <button type="button" className="primary" onClick={send} disabled={busy || !body.trim()}>
        {t("发私信")}
      </button>
      {sent && (
        <p className="small">
          {t("发出去了。")} <Link href={`/messages/${to}`}>{t("去对话里看看")}</Link>
        </p>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
