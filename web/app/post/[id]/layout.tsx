import type { Metadata } from "next";

import { api, type Post } from "@/lib/api";
import { pageMeta } from "@/lib/share";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const post = await api<Post>(`/v1/posts/${id}`).catch(() => null);
  if (!post) return { title: "帖子 · unimap" };
  const title = `${post.bitmap_number}.bitmap 的帖子`;
  const body = (post.body ?? "").replace(/\s+/g, " ").trim();
  const description = body.length > 120 ? `${body.slice(0, 120)}…` : body || "unimap 上的一条帖子";
  return pageMeta(title, description, `/post/${id}`, "article");
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
