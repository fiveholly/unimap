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
  placeholder,
}: {
  district: number;
  replyTo?: number | null;
  asOptions?: number[];
  onPosted: (p: Post) => void;
  placeholder?: string;
}) {
  const { token, sign } = useSession();
  const [body, setBody] = useState("");
  const [media, setMedia] = useState("");
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
      onPosted(post);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`composer${replyTo ? " reply" : ""}`}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder || (replyTo ? "Write a reply" : "Say something to the neighborhood")}
        rows={replyTo ? 2 : 3}
        maxLength={2000}
        name="body"
      />
      {!replyTo && (
        <input value={media} onChange={(e) => setMedia(e.target.value)} placeholder="Image links (https://…), optional" name="media" />
      )}
      <div className="row">
        {asOptions.length > 0 && (
          <select value={asBitmap ?? ""} onChange={(e) => setAsBitmap(e.target.value ? Number(e.target.value) : null)} name="as">
            <option value="">Post as my address</option>
            {asOptions.map((n) => (
              <option key={n} value={n}>
                Post as {n}.bitmap
              </option>
            ))}
          </select>
        )}
        <span className="muted small grow">Your wallet signs every post.</span>
        <button onClick={submit} disabled={busy || !body.trim()}>
          {busy ? "Signing…" : replyTo ? "Reply" : "Post"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
