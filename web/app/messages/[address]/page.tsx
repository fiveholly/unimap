"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { announceRead } from "@/components/Notifications";
import { ReportDialog } from "@/components/Report";
import { short, useSession } from "@/components/Session";
import { api, type DmMessage, type DmThread } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { t } from "@/lib/i18n";

/** One conversation, oldest first, with a box to write back. */
export default function ThreadPage() {
  const { address: raw } = useParams<{ address: string }>();
  const peer = decodeURIComponent(raw);
  const { token, ready } = useSession();
  const [thread, setThread] = useState<DmThread | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(
    () =>
      api<DmThread>(`/v1/dms/${peer}`, { token })
        .then((th) => {
          setThread(th);
          announceRead();
        })
        .catch((e) => setError(e.message)),
    [peer, token],
  );
  useEffect(() => {
    if (!token) return;
    load();
    const timer = setInterval(load, 20_000);
    return () => clearInterval(timer);
  }, [token, load]);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [thread?.messages.length]);

  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const m = await api<DmMessage>(`/v1/dms/${peer}`, { method: "POST", token, body: { body: body.trim() } });
      setThread((th) => th && { ...th, messages: [...th.messages, m] });
      setBody("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const block = async (on: boolean) => {
    await api(`/v1/me/mutes/${peer}`, { method: on ? "PUT" : "DELETE", token }).catch(() => {});
    load();
  };

  if (!ready) return null;
  if (!token) return <p className="page muted">{t("连接钱包后可以看到你的私信。")}</p>;
  if (error && !thread) return <p className="page error">{error}</p>;
  if (!thread) return <p className="page muted">{t("加载中…")}</p>;
  return (
    <div className="page narrow messages-page">
      <div className="crumbs">
        <Link href="/messages">{t("私信")}</Link>
        <span aria-hidden>·</span>
        <span className="mono">{short(peer)}</span>
      </div>
      <div className="dm-head">
        <Avatar seed={peer} size={40} />
        <div className="grow">
          <Link href={`/address/${peer}`} className="mono break">
            {peer}
          </Link>
        </div>
        <button type="button" className="ghost small" onClick={() => block(!thread.blocked_by_me)}>
          {thread.blocked_by_me ? t("取消屏蔽") : t("屏蔽")}
        </button>
      </div>
      {thread.messages.length === 0 && <p className="muted">{t("还没有消息。打个招呼吧。")}</p>}
      <ol className="dm-thread">
        {thread.messages.map((m) => (
          <li key={m.id} className={m.from_me ? "mine" : ""}>
            <p className={m.removed ? "dim" : ""}>{m.removed ? t("这条消息已被删除") : m.body}</p>
            <span className="dim small">
              {timeAgo(new Date(m.created_at).getTime() / 1000)}
              {!m.from_me && !m.removed && (
                <>
                  {" · "}
                  <button type="button" className="link-btn" onClick={() => setReporting(m.id)}>
                    {t("举报#tab")}
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
      <div ref={end} />
      {thread.can_send ? (
        <div className="dm-compose">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={1000} placeholder={t("写点什么…")} name="message" onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && send()} />
          <div className="row end">
            <button type="button" className="primary" onClick={send} disabled={busy || !body.trim()}>
              {t("发送")}
            </button>
          </div>
        </div>
      ) : (
        <p className="muted small">{thread.why_not === "blocked" ? t("对方不想收到你的消息。") : t("对方只接收自己写过信的人的私信。")}</p>
      )}
      {error && <p className="error small">{error}</p>}
      {reporting != null && <ReportDialog path={`/v1/dms/messages/${reporting}/report`} title={t("举报这条私信")} token={token} close={() => setReporting(null)} />}
    </div>
  );
}
