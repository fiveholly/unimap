import type { Metadata } from "next";

import { pageMeta } from "@/lib/share";
import { LANDMARKS } from "@/lib/zones";

// The page itself runs in the browser; this gives a shared link its title (the card image is
// opengraph-image.tsx next to it).
export async function generateMetadata({ params }: { params: Promise<{ n: string }> }): Promise<Metadata> {
  const { n } = await params;
  const landmark = LANDMARKS[Number(n)];
  const title = `${n}.bitmap${landmark ? ` · ${landmark}` : ""}`;
  const description = `比特币第 ${Number(n).toLocaleString("en-US")} 个区块，unimap 城市里的一个街区。来逛逛、关注它，或者成为这里的居民。`;
  return pageMeta(title, description, `/district/${n}`);
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
