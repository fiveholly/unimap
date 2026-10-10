"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PostCard } from "@/components/PostCard";
import { reasonLabel, REPORT_REASONS, type ReportReason } from "@/components/Report";
import { useSession } from "@/components/Session";
import { api, type Ban, type Me, type ReportGroup } from "@/lib/api";
import { short, timeAgo } from "@/lib/format";
import { locale, t } from "@/lib/i18n";

const secs = (iso: string) => Date.parse(iso) / 1000;
// Bans made here keep the report reasons as codes ("scam,spam"); anything else is shown as written.
const banReason = (r: string) =>
  r.split(",").every((c) => REPORT_REASONS.includes(c as ReportReason)) ? r.split(",").map(reasonLabel).join(" · ") : r;

/** 站点管理: reported posts to remove or dismiss, and the addresses barred from posting. */
export default function AdminPage() {
  const { token, ready } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<"reports" | "bans">("reports");
  const [reports, setReports] = useState<ReportGroup[] | null>(null);
  const [bans, setBans] = useState<Ban[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const [r, b] = await Promise.all([
        api<{ reports: ReportGroup[] }>("/v1/admin/reports", { token }),
        api<{ bans: Ban[] }>("/v1/admin/bans", { token }),
      ]);
      setReports(r.reports);
      setBans(b.bans);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    api<Me>("/v1/me", { token })
      .then((m) => {
        setMe(m);
        if (m.admin) reload();
      })
      .catch((e) => setError(e.message));
  }, [token, reload]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const resolve = (postId: number, action: "remove" | "dismiss") =>
    act(() => api(`/v1/admin/reports/${postId}`, { method: "POST", token, body: { action } }));
  const ban = (address: string, days: number | null, reason: string) =>
    act(() => api("/v1/admin/bans", { method: "POST", token, body: { address, days, reason } }));
  const unban = (address: string) => act(() => api(`/v1/admin/bans/${address}`, { method: "DELETE", token }));

  if (!ready) return null;
  if (!token) return <p className="page muted">{t("连接钱包后才能管理站点。")}</p>;
  if (error && !me) return <p className="page error">{error}</p>;
  if (!me) return <p className="page muted">{t("加载中…")}</p>;
  if (!me.admin) return <p className="page muted">{t("只有站点管理员能看这一页。")}</p>;

  return (
    <div className="page narrow admin">
      <h1>{t("站点管理")}</h1>
      <p className="muted small">{t("这里是全站的举报和封禁。被封禁的地址不能发帖和回复，街区主人自己的禁言不受影响。")}</p>
      <nav className="tabs" aria-label={t("站点管理")}>
        <button type="button" className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")}>
          {t("举报#tab")} <span className="mono">{reports?.length ?? ""}</span>
        </button>
        <button type="button" className={tab === "bans" ? "active" : ""} onClick={() => setTab("bans")}>
          {t("封禁")} <span className="mono">{bans?.length ?? ""}</span>
        </button>
      </nav>
      {error && <p className="error small">{error}</p>}
      {tab === "reports" &&
        (reports == null ? (
          <p className="muted">{t("加载中…")}</p>
        ) : reports.length === 0 ? (
          <p className="muted admin-empty">{t("没有待处理的举报。")}</p>
        ) : (
          reports.map((g) => <ReportItem key={g.post.id} group={g} resolve={resolve} ban={ban} />)
        ))}
      {tab === "bans" &&
        (bans == null ? (
          <p className="muted">{t("加载中…")}</p>
        ) : bans.length === 0 ? (
          <p className="muted admin-empty">{t("没有被封禁的地址。")}</p>
        ) : (
          <ul className="ban-list">
            {bans.map((b) => (
              <li key={b.address}>
                <div className="grow">
                  <Link className="mono break" href={`/address/${b.address}`}>
                    {b.address}
                  </Link>
                  <p className="muted small">
                    {b.expires_at
                      ? t("封禁到 {date}", { date: new Date(b.expires_at).toLocaleDateString(locale()) })
                      : t("永久封禁")}
                    {" · "}
                    {t("{ago}由 {who} 封禁", { ago: timeAgo(secs(b.created_at)), who: short(b.banned_by) })}
                    {b.reason && ` · ${banReason(b.reason)}`}
                  </p>
                </div>
                <button type="button" className="ghost" onClick={() => unban(b.address)}>
                  {t("解除#ban")}
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

function ReportItem({
  group: g,
  resolve,
  ban,
}: {
  group: ReportGroup;
  resolve: (postId: number, action: "remove" | "dismiss") => void;
  ban: (address: string, days: number | null, reason: string) => void;
}) {
  const [days, setDays] = useState<string>("7");
  const author = g.post.author.address;
  const codes = [...new Set(g.reports.map((r) => r.reason))];
  const reasons = codes.map(reasonLabel).join(" · ");
  return (
    <section className="report-item">
      <p className="report-summary">
        <strong>{t("{n} 人举报", { n: String(g.count) })}</strong>
        <span className="muted"> · {reasons}</span>
      </p>
      <PostCard post={g.post} showDistrict />
      {g.reports.some((r) => r.note) && (
        <ul className="report-notes">
          {g.reports
            .filter((r) => r.note)
            .map((r) => (
              <li key={r.reporter} className="small">
                <span className="mono muted">{short(r.reporter)}</span> {reasonLabel(r.reason)}：{r.note}
              </li>
            ))}
        </ul>
      )}
      <div className="row wrap report-actions">
        <button type="button" className="danger" onClick={() => resolve(g.post.id, "remove")}>
          {t("删除帖子")}
        </button>
        <button type="button" className="ghost" onClick={() => resolve(g.post.id, "dismiss")}>
          {t("不处理")}
        </button>
        <span className="grow" />
        {g.author_banned ? (
          <span className="muted small">{t("作者已被封禁")}</span>
        ) : (
          <>
            <select value={days} onChange={(e) => setDays(e.target.value)} aria-label={t("封禁时长")}>
              <option value="7">{t("7 天")}</option>
              <option value="30">{t("30 天")}</option>
              <option value="">{t("永久")}</option>
            </select>
            <button type="button" className="ghost" onClick={() => ban(author, days ? Number(days) : null, codes.join(","))}>
              {t("封禁作者")}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
