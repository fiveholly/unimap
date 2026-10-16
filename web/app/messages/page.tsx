"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { short, useSession } from "@/components/Session";
import { api, type Conversation } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { t } from "@/lib/i18n";

/** 私信: everyone you have written to or heard from, latest first. */
export default function MessagesPage() {
  const { token, ready } = useSession();
  const [list, setList] = useState<Conversation[] | null>(null);
  const [strangers, setStrangers] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    api<{ conversations: Conversation[] }>("/v1/dms", { token }).then((r) => setList(r.conversations), (e) => setError(e.message));
    api<{ strangers: boolean }>("/v1/me/dm-settings", { token }).then((r) => setStrangers(r.strangers), () => {});
  }, [token]);
  const toggle = async (on: boolean) => {
    setStrangers(on);
    await api("/v1/me/dm-settings", { method: "PUT", token, body: { strangers: on } }).catch(() => setStrangers(!on));
  };
  if (!ready) return null;
  if (!token) return <p className="page muted">{t("连接钱包后可以看到你的私信。")}</p>;
  return (
    <div className="page narrow messages-page">
      <h1>{t("私信")}</h1>
      <label className="check small dm-setting">
        <input type="checkbox" checked={strangers ?? true} disabled={strangers == null} onChange={(e) => toggle(e.target.checked)} name="strangers" />
        {t("接收陌生人的私信")}
        <span className="dim">{t("关掉后，只有你写过信的人能给你发私信。")}</span>
      </label>
      {error ? (
        <p className="error">{error}</p>
      ) : list == null ? (
        <p className="muted">{t("加载中…")}</p>
      ) : list.length === 0 ? (
        <p className="muted">
          {t("还没有私信。")} <Link href="/capsule">{t("去时间胶囊找找同块人")}</Link>
        </p>
      ) : (
        <ul className="dm-list">
          {list.map((c) => (
            <li key={c.peer} className={c.unread ? "unread" : ""}>
              <Link href={`/messages/${c.peer}`}>
                <Avatar seed={c.peer} size={36} />
                <span className="grow">
                  <b className="mono">{short(c.peer)}</b>
                  <span className="muted small dm-snippet">
                    {c.last.from_me && <span className="dim">{t("你：")}</span>}
                    {c.last.removed ? t("这条消息已被删除") : c.last.body}
                  </span>
                </span>
                <span className="dm-meta">
                  <span className="dim small">{timeAgo(new Date(c.last.created_at).getTime() / 1000)}</span>
                  {c.unread > 0 && <span className="bell-count dm-unread">{c.unread}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
