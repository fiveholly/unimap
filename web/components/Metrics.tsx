"use client";

import { useEffect, useState } from "react";

import { api, type Metrics, type MetricsWeek } from "@/lib/api";
import { locale, t } from "@/lib/i18n";

const num = (n: number) => n.toLocaleString("en-US");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { month: "short", day: "numeric", timeZone: "UTC" });

/** 指标: the weekly numbers the roadmap's three stages are judged by, for site admins. */
export function MetricsPanel({ token }: { token: string }) {
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Metrics>("/v1/admin/metrics?weeks=12", { token })
      .then(setM)
      .catch((e) => setError(e.message));
  }, [token]);
  if (error) return <p className="error small">{error}</p>;
  if (!m) return <p className="muted">{t("加载中…")}</p>;
  const weeks = m.weeks;
  const now = weeks[weeks.length - 1], last = weeks[weeks.length - 2], before = weeks[Math.max(0, weeks.length - 6)];
  const gate = m.gates.tipped_districts;
  const growth = before.returning > 0 ? last.returning / before.returning : null;
  return (
    <div className="metrics">
      <p className="muted small">{t("每周从周一开始（UTC）。本周还没过完，按到现在为止算；看门槛用上一个完整的周。")}</p>
      <div className="metric-cards">
        <section className="agent-card metric-card">
          <span className="muted small">{t("第一阶段 · 收到打赏的街区")}</span>
          <b className="metric-big mono">
            {num(last.tipped_districts)} <span className="muted">/ {num(gate)}</span>
          </b>
          <span className="small">{last.tipped_districts >= gate ? t("上周过了门槛。") : t("上周还差 {n} 个到门槛。", { n: num(gate - last.tipped_districts) })}</span>
          <span className="muted small">{t("本周到现在 {n} 个", { n: num(now.tipped_districts) })}</span>
        </section>
        <section className="agent-card metric-card">
          <span className="muted small">{t("第二阶段 · 每周回来的人")}</span>
          <b className="metric-big mono">{num(last.returning)}</b>
          <span className="small">
            {growth == null
              ? t("4 周前还没有回来的人，先攒一个起点。")
              : t("是 4 周前（{n}）的 {x} 倍，门槛是翻一倍。", { n: num(before.returning), x: growth.toFixed(1) })}
          </span>
          <span className="muted small">{t("上周活跃 {a}，其中新来的 {b}", { a: num(last.active), b: num(last.new) })}</span>
        </section>
        <section className="agent-card metric-card">
          <span className="muted small">{t("第三阶段 · 站内成交")}</span>
          <b className="metric-big mono">
            {num(last.trade_sats)} <span className="muted">{t("聪")}</span>
          </b>
          <span className="small">{t("上周 {n} 笔交易；店铺卖了 {s} 聪（{o} 单）", { n: num(last.trades), s: num(last.shop_sats), o: num(last.shop_orders) })}</span>
        </section>
      </div>
      <div className="metric-table-wrap">
        <table className="metric-table">
          <thead>
            <tr>
              <th>{t("周")}</th>
              <th>{t("收到打赏的街区")}</th>
              <th>{t("打赏（聪）")}</th>
              <th>{t("活跃")}</th>
              <th>{t("回来的")}</th>
              <th>{t("新来的")}</th>
              <th>{t("成交（聪）")}</th>
              <th>{t("店铺（聪）")}</th>
            </tr>
          </thead>
          <tbody>
            {[...weeks].reverse().map((w: MetricsWeek, i) => (
              <tr key={w.week} className={i === 0 ? "muted" : undefined}>
                <td>
                  {day(w.week)}
                  {i === 0 && ` ${t("（本周）")}`}
                </td>
                <td className={w.tipped_districts >= gate ? "metric-hit mono" : "mono"}>{num(w.tipped_districts)}</td>
                <td className="mono">{num(w.tip_sats)}</td>
                <td className="mono">{num(w.active)}</td>
                <td className="mono">{num(w.returning)}</td>
                <td className="mono">{num(w.new)}</td>
                <td className="mono">{num(w.trade_sats)}</td>
                <td className="mono">{num(w.shop_sats)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">{t("活跃：这一周登录、签到、发帖或回复、点赞、投票、打赏或在店里买过东西的地址。回来的：其中在更早的周也活跃过的。成交：站内挂单被买下和出价被接受的金额。")}</p>
    </div>
  );
}
