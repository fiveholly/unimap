"use client";

import { useEffect, useState } from "react";

import { useSession } from "./Session";
import { api, type Post } from "@/lib/api";
import { postMessage } from "@/lib/messages";
import { nostrExtension, now, publish, writeRelays } from "@/lib/nostr";
import { SITE_URL } from "@/lib/share";
import { t } from "@/lib/i18n";

const NOSTR_PREF = "unimap.toNostr";

/** Sign the post as a Nostr note with the extension, send it to relays, and tell unimap its id. */
async function sendToNostr(post: Post, text: string, media: string[], pubkey: string, token: string) {
  const ext = nostrExtension();
  if (!ext) throw new Error(t("没有找到 Nostr 插件"));
  const link = `${SITE_URL}/post/${post.id}`;
  const content = [text, ...media, link].join("\n\n");
  const ev = await ext.signEvent({ kind: 1, created_at: now(), tags: [["r", link], ["t", "bitmap"]], content });
  if (ev.pubkey !== pubkey) throw new Error(t("插件里的 Nostr 账号不是你绑定的那个"));
  const sent = await publish(ev, await writeRelays(ext));
  if (!sent) throw new Error(t("没有中继收下这条帖子"));
  await api(`/v1/posts/${post.id}/nostr`, { method: "POST", token, body: { event: ev } });
  return ev.id;
}

export function Composer({
  district,
  replyTo = null,
  asOptions = [],
  onPosted,
  speakingAs,
  draft,
}: {
  district: number;
  replyTo?: number | null;
  asOptions?: number[];
  onPosted: (p: Post) => void;
  /** How the poster appears by default, e.g. "地块 #88" or "街区主人". */
  speakingAs?: string;
  /** Text to put in the box, e.g. a starter post the owner picked; replaced each time it changes. */
  draft?: string;
}) {
  const { token, sign } = useSession();
  const [body, setBody] = useState("");
  useEffect(() => {
    if (draft) setBody(draft);
  }, [draft]);
  const [media, setMedia] = useState("");
  const [showMedia, setShowMedia] = useState(false);
  const [asBitmap, setAsBitmap] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 同步到 Nostr: offered on new posts when this browser has a Nostr extension and the address linked a key.
  const [nostrKey, setNostrKey] = useState<string | null>(null);
  const [toNostr, setToNostr] = useState(false);
  useEffect(() => {
    if (replyTo || !token || !nostrExtension()) return;
    api<{ pubkey: string | null }>("/v1/me/nostr", { token })
      .then((r) => {
        setNostrKey(r.pubkey);
        try {
          setToNostr(!!r.pubkey && localStorage.getItem(NOSTR_PREF) !== "0");
        } catch {
          setToNostr(!!r.pubkey);
        }
      })
      .catch(() => {});
  }, [replyTo, token]);
  const pickNostr = (on: boolean) => {
    setToNostr(on);
    try {
      localStorage.setItem(NOSTR_PREF, on ? "1" : "0");
    } catch {}
  };

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
      let posted = post;
      if (toNostr && nostrKey) {
        try {
          posted = { ...post, nostr_event_id: await sendToNostr(post, text, urls, nostrKey, token!) };
        } catch (e) {
          setError(t("帖子已经发出，但没能同步到 Nostr：{why}", { why: e instanceof Error ? e.message : String(e) }));
        }
      }
      setBody("");
      setMedia("");
      setShowMedia(false);
      onPosted(posted);
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
        placeholder={replyTo ? t("写下你的回复…") : t("说点什么…")}
        aria-label={replyTo ? t("回复") : t("发帖")}
        rows={replyTo ? 2 : 3}
        maxLength={2000}
        name="body"
      />
      {showMedia && (
        <input
          value={media}
          onChange={(e) => setMedia(e.target.value)}
          placeholder={t("图片链接（https://…），多个用空格隔开")}
          aria-label={t("图片链接")}
          name="media"
        />
      )}
      <div className="composer-bar">
        {asOptions.length > 0 ? (
          <select
            value={asBitmap ?? ""}
            onChange={(e) => setAsBitmap(e.target.value ? Number(e.target.value) : null)}
            name="as"
            aria-label={t("发言身份")}
          >
            <option value="">{speakingAs ? t("以{who}发言", { who: speakingAs }) : t("以我的地址发言")}</option>
            {asOptions.map((n) => (
              <option key={n} value={n}>
                {t("以 {n}.bitmap 发言", { n })}
              </option>
            ))}
          </select>
        ) : (
          speakingAs && (
            <span className="speaking-as">
              <i aria-hidden />{t("以{who}发言", { who: speakingAs })}
            </span>
          )
        )}
        <span className="grow" />
        {nostrKey && (
          <label className="nostr-toggle small" title={t("用你的 Nostr 插件签名，同时发到 Nostr")}>
            <input type="checkbox" checked={toNostr} onChange={(e) => pickNostr(e.target.checked)} />
            {t("同步到 Nostr")}
          </label>
        )}
        {!replyTo && (
          <button type="button" className="icon-btn bare" aria-label={t("添加图片")} aria-pressed={showMedia} onClick={() => setShowMedia(!showMedia)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          </button>
        )}
        <button type="button" className="solid" onClick={submit} disabled={busy || !body.trim()}>
          {busy ? t("等待钱包签名…") : replyTo ? t("签名并回复") : t("签名并发布")}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
