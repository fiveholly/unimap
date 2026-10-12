import type { Metadata } from "next";

import { pageMeta } from "@/lib/share";

export const metadata: Metadata = pageMeta("繁荣榜", "unimap 城市里最热闹的 50 个街区，按近 30 天的帖子、回复和签到排名。", "/rank");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
