import type { Metadata } from "next";

import { pageMeta } from "@/lib/share";

export const metadata: Metadata = pageMeta("时间锁", "一封锁到某个比特币区块的信和一份礼物：到点之前谁都打不开，到点之后拿着时间锁就能领。", "/capsule/gift");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
