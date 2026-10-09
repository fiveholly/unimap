"use client";

import { useState } from "react";

import { useSession } from "./Session";
import { api, type Post } from "@/lib/api";
import { postMessage } from "@/lib/messages";

export function Composer({
  district,
  replyTo = null,
  asOptions = [],
  onPosted,
  speakingAs,
}: {
  district: number;
  replyTo?: number | null;
  asOptions?: number[];
  onPosted: (p: Post) => void;
  /** How the poster appears by default, e.g. "地块 #88" or "街区主人". */
  speakingAs?: string;
}) {
  const { token, sign } = useSession();
  const [body, setBody] = useState("");
  const [media, setMedia] = useState("");
  const [showMedia, setShowMedia] = useState(false);
  const [asBitmap, setAsBitmap] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const urls = media.split(/\s+/).filter(Boolean);
      const signedAt = Math.floor(Date.now() / 1000);
      const signature = await sign(postMessage(district, replyTo, asBitmap, signedAt, urls, text));
      const post = await api<Post>(`/v1/districts/${district}/posts`, {
        method: "POST",
        token,
        body: { body: text, media: urls, reply_to: replyTo, as_bitmap: asBitmap, signed_at: signedAt, signature },
      });
      setBody("");
      setMedia("");
      setShowMedia(false);
      onPosted(post);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "cancelled") setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`composer${replyTo ? " reply" : ""}`}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={replyTo ? "写下你的回复…" : "说点什么…"}
        aria-label={replyTo ? "回复" : "发帖"}
        rows={replyTo ? 2 : 3}
        maxLength={2000}
        name="body"
      />
      {showMedia && (
        <input
          value={media}
          onChange={(e) => setMedia(e.target.value)}
          placeholder="图片链接（https://…），多个用空格隔开"
          aria-label="图片链接"
          name="media"
        />
      )}
      <div className="composer-bar">
        {asOptions.length > 0 ? (
          <select
            value={asBitmap ?? ""}
            onChange={(e) => setAsBitmap(e.target.value ? Number(e.target.value) : null)}
            name="as"
            aria-label="发言身份"
          >
            <option value="">{speakingAs ? `以${speakingAs}发言` : "以我的地址发言"}</option>
            {asOptions.map((n) => (
              <option key={n} value={n}>
                以 {n}.bitmap 发言
              </option>
            ))}
          </select>
        ) : (
          speakingAs && (
            <span className="speaking-as">
              <i aria-hidden />以{speakingAs}发言
            </span>
          )
        )}
        <span className="grow" />
        {!replyTo && (
          <button type="button" className="icon-btn bare" aria-label="添加图片" aria-pressed={showMedia} onClick={() => setShowMedia(!showMedia)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          </button>
        )}
        <button type="button" className="solid" onClick={submit} disabled={busy || !body.trim()}>
          {busy ? "等待钱包签名…" : replyTo ? "签名并回复" : "签名并发布"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
