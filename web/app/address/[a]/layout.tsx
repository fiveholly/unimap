import type { Metadata } from "next";

import { short } from "@/lib/format";
import { pageMeta } from "@/lib/share";

export async function generateMetadata({ params }: { params: Promise<{ a: string }> }): Promise<Metadata> {
  const { a } = await params;
  return pageMeta(`${short(a)} · unimap`, "Bitmap 街区、地块和帖子 · Districts, parcels and posts on unimap", `/address/${a}`);
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
