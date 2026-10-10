"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Avatar } from "./Avatar";
import { Composer } from "./Composer";
import { ReportDialog } from "./Report";
import { short, useSession } from "./Session";
import { ShareMenu } from "./ShareMenu";
import { TipButton } from "./Tip";
import { TweetEmbed, XHandle } from "./X";
import { tweetsIn } from "@/lib/tweets";
import { api, type Post } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { postText } from "@/lib/share";
import { t } from "@/lib/i18n";

export type PostActions = {
  canReply: boolean;
  isOwner: boolean;
  asOptions: number[];
  onPin?: (p: Post) => void;
  onMute?: (address: string) => void;
};

export function roleLabel(role: string, parcel: number | null): string {
  return role === "owner" ? t("街区主人") : role === "resident" ? t("居民 · 地块 #{n}", { n: String(parcel) }) : t("访客");
}

export function RoleBadge({ role, parcel }: { role: string; parcel: number | null }) {
  return <span className={`badge ${role}`}>{roleLabel(role, parcel)}</span>;
}

export function PostCard({
  post: initial,
  actions,
  showDistrict = false,
  pinned = false,
  onRemoved,
}: {
  post: Post;
  actions?: PostActions;
  showDistrict?: boolean;
  pinned?: boolean;
  onRemoved?: (id: number) => void;
}) {
  const { address, token } = useSession();
  const [post, setPost] = useState(initial);
  const [replies, setReplies] = useState<Post[] | null>(null);
  const [showReplies, setShowReplies] = useState(false);
  const [showSig, setShowSig] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const isReply = post.reply_to != null;

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleLike = () =>
    run(async () => {
      if (!token) throw new Error(t("连接钱包后才能点赞"));
      await api(`/v1/posts/${post.id}/like`, { method: post.liked_by_me ? "DELETE" : "PUT", token });
      setPost({ ...post, liked_by_me: !post.liked_by_me, like_count: post.like_count + (post.liked_by_me ? -1 : 1) });
    });

  const loadReplies = () =>
    run(async () => {
      if (showReplies) return setShowReplies(false);
      const res = await api<{ replies: Post[] }>(`/v1/posts/${post.id}/replies`, { token });
      setReplies(res.replies);
      setShowReplies(true);
    });

  const remove = () =>
    run(async () => {
      if (!confirm(t("删除这条帖子？"))) return;
      await api(`/v1/posts/${post.id}`, { method: "DELETE", token });
      onRemoved?.(post.id);
    });

  if (post.removed) return null;
  const mine = address === post.author.address;
  const menu: [string, () => void][] = [];
  if (!isReply && actions?.isOwner && actions.onPin) menu.push([t("置顶"), () => actions.onPin!(post)]);
  if (actions?.isOwner && !mine && actions.onMute) menu.push([t("禁言作者"), () => actions.onMute!(post.author.address)]);
  if (mine || actions?.isOwner) menu.push([t("删除"), remove]);
  if (token && !mine) menu.push([t("举报"), () => setReporting(true)]);
  // Authors are known by their land: the district they speak for, their parcel, or else their address.
  const a = post.author;
  const name =
    a.as_bitmap != null
      ? `${a.as_bitmap}.bitmap`
      : a.role === "owner"
        ? `${post.bitmap_number}.bitmap`
        : a.role === "resident"
          ? t("地块 #{n}", { n: String(a.parcel) })
          : short(a.address);
  const avatarSeed = a.as_bitmap ?? (a.role === "owner" ? post.bitmap_number : a.role === "resident" ? `${post.bitmap_number}.${a.parcel}` : a.address);

  return (
    <article className={`post${isReply ? " reply" : ""}`}>
      <Avatar seed={avatarSeed} size={isReply ? 28 : 36} />
      <div className="post-main">
        {pinned && (
          <div className="pin-line">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 17v5" />
              <path d="M9 10.8V4h6v6.8l3 3.2H6z" />
            </svg>
            {t("街区主人置顶")}
          </div>
        )}
        <div className="post-head">
          {post.author.as_bitmap != null ? (
            <Link className="author mono" href={`/district/${post.author.as_bitmap}`} title={post.author.address}>
              {name}
            </Link>
          ) : (
            <Link className="author mono" href={`/address/${post.author.address}`} title={post.author.address}>
              {name}
            </Link>
          )}
          {a.x && <XHandle username={a.x} />}
          <span className={`badge ${a.role}`}>{a.role === "owner" ? t("街区主人") : a.role === "resident" ? t("居民#one") : t("访客")}</span>
          <button type="button" className="signed" onClick={() => setShowSig(!showSig)} aria-expanded={showSig} title={t("这条帖子由作者的比特币钱包签名，点击查看")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20 6 9 17l-5-5" />
            </svg>
            {t("已签名")}
          </button>
          {showDistrict && (
            <Link className="muted small" href={`/district/${post.bitmap_number}`}>
              · {post.bitmap_number}.bitmap
            </Link>
          )}
          <span className="muted small">· {timeAgo(new Date(post.created_at).getTime() / 1000)}</span>
          <span className="grow" />
          {menu.length > 0 && <PostMenu items={menu} />}
        </div>
        {reporting && token && (
          <ReportDialog
            postId={post.id}
            token={token}
            close={(sent) => {
              setReporting(false);
              if (sent) setReported(true);
            }}
          />
        )}
        {reported && <p className="muted small">{t("已举报，管理员会处理。")}</p>}
        <p className="post-body">{post.body}</p>
        {tweetsIn(post.body).map((tw) => (
          <TweetEmbed key={tw.id} {...tw} />
        ))}
        {post.media.length > 0 && (
          <div className="media">
            {post.media.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />
            ))}
          </div>
        )}
        <div className="post-actions">
          {!isReply && (
            <button type="button" className="act" onClick={loadReplies} aria-expanded={showReplies}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
              </svg>
              {post.reply_count}
              <span className="sr-only">{t("条回复")}</span>
            </button>
          )}
          <button type="button" className={`act${post.liked_by_me ? " liked" : ""}`} onClick={toggleLike} aria-pressed={post.liked_by_me}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill={post.liked_by_me ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19.5 12.6 12 20l-7.5-7.4A4.8 4.8 0 0 1 12 6.2a4.8 4.8 0 0 1 7.5 6.4z" />
            </svg>
            {post.like_count}
            <span className="sr-only">{t("个赞")}</span>
          </button>
          {!mine && (post.author.tippable || (post.tips_sats ?? 0) > 0) && (
            <TipButton target={{ post_id: post.id }} to={name} sats={post.tips_sats ?? 0} token={token} canTip={!!post.author.tippable} onError={setError} />
          )}
          {!post.removed && <ShareMenu path={`/post/${post.id}`} text={postText(post)} label="" className="act" align="left" />}
        </div>
        {showSig && (
          <div className="sig">
            <p className="muted small">{t("签名地址 {address}", { address: post.author.address })}</p>
            <pre className="message">{post.signed_message}</pre>
            <code className="small break">{post.signature}</code>
          </div>
        )}
        {error && <p className="error small">{error}</p>}
        {showReplies && replies && (
          <div className="replies">
            {replies.map((r) => (
              <PostCard key={r.id} post={r} actions={actions} onRemoved={(id) => setReplies(replies.filter((x) => x.id !== id))} />
            ))}
            {actions?.canReply && (
              <Composer
                district={post.bitmap_number}
                replyTo={post.id}
                asOptions={actions.asOptions}
                onPosted={(p) => {
                  setReplies([...replies, p]);
                  setPost({ ...post, reply_count: post.reply_count + 1 });
                }}
              />
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function PostMenu({ items }: { items: [string, () => void][] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="post-menu" ref={ref}>
      <button type="button" className="icon-btn bare" aria-label={t("更多操作")} aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map(([label, fn]) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              className={`menu-item${label === t("删除") ? " danger" : ""}`}
              onClick={() => {
                setOpen(false);
                fn();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
