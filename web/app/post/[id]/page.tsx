"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { PostCard } from "@/components/PostCard";
import { useSession } from "@/components/Session";
import { api, ApiError, type Post } from "@/lib/api";
import { t } from "@/lib/i18n";

/** One post on its own, the page a shared post link opens. */
export default function PostPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useSession();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Post>(`/v1/posts/${id}`, { token })
      .then(setPost)
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? t("这条帖子不存在，或者已经删除了。") : e.message));
  }, [id, token]);
  if (error) return <p className="page error">{error}</p>;
  if (!post) return <p className="page muted">{t("加载中…")}</p>;
  return (
    <div className="page narrow post-page">
      <div className="crumbs">
        <Link href={`/district/${post.bitmap_number}`}>{post.bitmap_number}.bitmap</Link>
        <span aria-hidden>·</span>
        <span>{t("帖子#one")}</span>
      </div>
      <PostCard post={post} showDistrict />
      <Link className="btn lg" href={`/district/${post.bitmap_number}`}>
        {t("去 {n}.bitmap 看看", { n: post.bitmap_number })}
      </Link>
    </div>
  );
}
