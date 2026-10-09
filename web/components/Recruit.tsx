"use client";

import { useState } from "react";

import { api, type Recruit } from "@/lib/api";

/** The district's call for residents, with an apply form for signed-in visitors. */
export function RecruitCard({
  n,
  recruit,
  token,
  canApply,
  onPick,
  onChanged,
}: {
  n: number;
  recruit: Recruit;
  token: string | null;
  canApply: boolean;
  onPick: (i: number) => void;
  onChanged: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const send = (method: "PUT" | "DELETE") =>
    api(`/v1/districts/${n}/application`, { method, token, body: method === "PUT" ? { note } : undefined })
      .then(onChanged)
      .catch((e) => setError(e.message));
  return (
    <section className="callout recruit" aria-label="招募居民">
      <div className="row between">
        <b>招募居民</b>
        <span className="muted small">{recruit.applications} 人申请</span>
      </div>
      <p className="pre">{recruit.message}</p>
      {recruit.parcels.length > 0 && (
        <div className="chips">
          {recruit.parcels.map((i) => (
            <button key={i} type="button" className="chip mono" onClick={() => onPick(i)}>
              地块 #{i}
            </button>
          ))}
        </div>
      )}
      {canApply &&
        (recruit.applied ? (
          <div className="row between small">
            <span className="muted">已申请，等街区主人联系你。</span>
            <button type="button" className="link-btn small" onClick={() => send("DELETE")}>
              撤回申请
            </button>
          </div>
        ) : (
          <>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={200} placeholder="介绍一下自己，想要哪块地（可不填）" name="note" />
            <button type="button" className="primary" onClick={() => send("PUT")}>
              申请入住
            </button>
          </>
        ))}
      {!token && <p className="muted small">连接钱包后可以申请入住。</p>}
      {error && <p className="error small">{error}</p>}
      <p className="dim small">地块要由街区主人铭刻成子铭文转给你，链上到账后你就是这里的居民。</p>
    </section>
  );
}
