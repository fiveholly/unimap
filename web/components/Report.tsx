"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "@/lib/api";
import { t } from "@/lib/i18n";

export const REPORT_REASONS = ["spam", "abuse", "scam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const reasonLabel = (r: string) =>
  r === "spam" ? t("垃圾广告") : r === "abuse" ? t("骚扰或辱骂") : r === "scam" ? t("诈骗或钓鱼") : t("其他");

/** 举报: pick a reason, add a note, and the site admins get it. */
export function ReportDialog({ postId, token, close }: { postId: number; token: string; close: (sent: boolean) => void }) {
  const [reason, setReason] = useState<ReportReason>("spam");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && close(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, close]);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/posts/${postId}/report`, { method: "POST", token, body: { reason, note } });
      close(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return createPortal(
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="report-title" onClick={(e) => e.target === e.currentTarget && !busy && close(false)}>
      <div className="dialog">
        <h2 id="report-title">{t("举报这条帖子")}</h2>
        <p className="muted small">{t("站点管理员会看到你的举报并决定是否删除。街区主人也可以自己删帖或禁言。")}</p>
        <div className="report-reasons" role="radiogroup">
          {REPORT_REASONS.map((r) => (
            <label key={r} className="check">
              <input type="radio" name="report-reason" id={`report-${r}`} checked={reason === r} onChange={() => setReason(r)} />
              {reasonLabel(r)}
            </label>
          ))}
        </div>
        <textarea
          id="report-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder={t("补充说明（可选）")}
        />
        {error && <p className="error small">{error}</p>}
        <div className="row end">
          <button type="button" className="ghost" onClick={() => close(false)} disabled={busy}>
            {t("取消")}
          </button>
          <button type="button" className="primary" onClick={send} disabled={busy}>
            {t("提交举报")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
