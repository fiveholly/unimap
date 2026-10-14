import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Noto_Serif_SC } from "next/font/google";

import "./globals.css";
import { BlockWatch } from "@/components/BlockWatch";
import { DemoBanner } from "@/components/DemoBanner";
import { Footer, Header } from "@/components/Header";
import { LangProvider } from "@/components/Lang";
import { SessionProvider } from "@/components/Session";
import { SITE_URL } from "@/lib/share";

// Inter for Latin text (Chinese falls back to the system's PingFang or Noto Sans SC), Noto Serif SC
// for titles and names, JetBrains Mono for numbers. The serif's Chinese comes as many small
// unicode-range files, fetched only for the characters a page shows, so it isn't preloaded.
const sans = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });
const serif = Noto_Serif_SC({ weight: "500", variable: "--font-noto-serif", display: "swap", preload: false });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "unimap",
  description: "比特币上的 Bitmap 城市：每一个区块都是一个街区。 The Bitmap city on Bitcoin: every block is a district.",
  openGraph: { siteName: "unimap", locale: "zh_CN", type: "website" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        <LangProvider>
          <SessionProvider>
            <BlockWatch>
              <DemoBanner />
              <Header />
              <main>{children}</main>
              <Footer />
            </BlockWatch>
          </SessionProvider>
        </LangProvider>
      </body>
    </html>
  );
}
