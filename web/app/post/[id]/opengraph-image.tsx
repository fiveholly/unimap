import { api, type Post } from "@/lib/api";
import { short } from "@/lib/format";
import { C, Frame, render, siteName } from "@/lib/og";
import { SITE_URL } from "@/lib/share";

export { contentType, size } from "@/lib/og";
export const alt = "unimap 帖子卡片";
export const revalidate = 600;

const ROLE: Record<string, [string, string]> = { owner: ["街区主人", "#f7b863"], resident: ["居民", "#86c7a8"], visitor: ["访客", C.fg3] };

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const post = await api<Post>(`/v1/posts/${(await params).id}`).catch(() => null);
  const site = siteName(SITE_URL);
  if (!post)
    return render(
      <Frame site={site}>
        <span style={{ fontSize: 48, fontWeight: 700 }}>这条帖子不存在了</span>
      </Frame>,
    );
  const body = (post.body ?? "").replace(/\s+/g, " ").trim();
  const clip = body.length > 140 ? `${body.slice(0, 140)}…` : body;
  const [role, color] = ROLE[post.author.role] ?? ROLE.visitor;
  return render(
    <Frame site={site}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 26, color: C.fg2 }}>
        <span style={{ fontFamily: "Geist Mono", fontWeight: 700, color: C.fg }}>{short(post.author.address)}</span>
        <span style={{ color, border: `1px solid ${color}`, borderRadius: 999, padding: "2px 14px", fontSize: 22 }}>
          {role}
          {post.author.role === "resident" && post.author.parcel != null ? ` · 地块 #${post.author.parcel}` : ""}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 28,
          paddingLeft: 28,
          borderLeft: `6px solid ${C.accent}`,
          fontSize: clip.length > 70 ? 40 : 52,
          lineHeight: 1.4,
          fontWeight: 700,
          maxHeight: 300,
          overflow: "hidden",
        }}
      >
        {clip || "（图片）"}
      </div>
      <div style={{ display: "flex", gap: 28, marginTop: 32, fontSize: 26, color: C.fg3 }}>
        <span>
          来自 <span style={{ fontFamily: "Geist Mono", fontWeight: 700, color: C.fg, marginLeft: 8 }}>{post.bitmap_number}.bitmap</span>
        </span>
        <span>{post.reply_count} 条回复</span>
        <span>{post.like_count} 个赞</span>
      </div>
    </Frame>,
  );
}
