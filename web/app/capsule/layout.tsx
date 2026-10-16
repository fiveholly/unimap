import type { Metadata } from "next";

import { pageMeta } from "@/lib/share";

export const metadata: Metadata = pageMeta("时间胶囊", "今天写一封信，等到未来某一天之后的第一个比特币区块出来才能打开。", "/capsule");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
