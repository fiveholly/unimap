"use client";

import Link from "next/link";
import { useState } from "react";

import { Composer } from "./Composer";
import { short, useSession } from "./Session";
import { api, type Post } from "@/lib/api";
import { timeAgo } from "@/lib/format";

export type PostActions = {
  canReply: boolean;
  isOwner: boolean;
  asOptions: number[];
  onPin?: (p: Post) => void;
  onMute?: (address: string) => void;
};

export function RoleBadge({ role, parcel }: { role: string; parcel: number | null }) {
  const label = role === "owner" ? "Owner" : role === "resident" ? `Resident · parcel ${parcel}` : "Visitor";
  return <span className={`badge ${role}`}>{label}</span>;
}

export function PostCard({
  post: initial,
  actions,
  showDistrict = false,
  onRemoved,
}: {
  post: Post;
  actions?: PostActions;
  showDistrict?: boolean;
  onRemoved?: (id: number) => void;
}) {
  const { address, token } = useSession();
  const [post, setPost] = useState(initial);
  const [replies, setReplies] = useState<Post[] | null>(null);
  const [showReplies, setShowReplies] = useState(false);
  const [showSig, setShowSig] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      if (!token) throw new Error("Sign in to like posts");
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
      if (!confirm("Remove this post?")) return;
      await api(`/v1/posts/${post.id}`, { method: "DELETE", token });
      onRemoved?.(post.id);
    });

  if (post.removed) return null;
  const mine = address === post.author.address;

  return (
    <article className={`post${isReply ? " reply" : ""}`}>
      <div className="post-head">
        <span className="author" title={post.author.address}>
          {post.author.as_bitmap != null ? (
            <Link href={`/district/${post.author.as_bitmap}`}>{post.author.as_bitmap}.bitmap</Link>
          ) : (
            short(post.author.address)
          )}
        </span>
        <RoleBadge role={post.author.role} parcel={post.author.parcel} />
        {showDistrict && (
          <Link className="muted small" href={`/district/${post.bitmap_number}`}>
            in {post.bitmap_number}.bitmap
          </Link>
        )}
        <span className="muted small">{timeAgo(new Date(post.created_at).getTime() / 1000)}</span>
      </div>
      <p className="post-body">{post.body}</p>
      {post.media.length > 0 && (
        <div className="media">
          {post.media.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={url} src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />
          ))}
        </div>
      )}
      <div className="post-actions">
        <button className={`ghost small${post.liked_by_me ? " liked" : ""}`} onClick={toggleLike}>
          ♥ {post.like_count}
        </button>
        {!isReply && (
          <button className="ghost small" onClick={loadReplies}>
            {showReplies ? "Hide replies" : `Replies ${post.reply_count}`}
          </button>
        )}
        <button className="ghost small" onClick={() => setShowSig(!showSig)}>
          Signature
        </button>
        {!isReply && actions?.isOwner && actions.onPin && (
          <button className="ghost small" onClick={() => actions.onPin!(post)}>
            Pin
          </button>
        )}
        {actions?.isOwner && !mine && actions.onMute && (
          <button className="ghost small" onClick={() => actions.onMute!(post.author.address)}>
            Mute author
          </button>
        )}
        {(mine || actions?.isOwner) && (
          <button className="ghost small danger" onClick={remove}>
            Remove
          </button>
        )}
      </div>
      {showSig && (
        <div className="sig">
          <p className="muted small">Signed by {post.author.address}</p>
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
    </article>
  );
}
