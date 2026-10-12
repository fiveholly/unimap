import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import "./globals.css";
import { BlockWatch } from "@/components/BlockWatch";
import { DemoBanner } from "@/components/DemoBanner";
import { Footer, Header } from "@/components/Header";
import { LangProvider } from "@/components/Lang";
import { SessionProvider } from "@/components/Session";
import { SITE_URL } from "@/lib/share";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "unimap",
  description: "比特币上的 Bitmap 城市：每一个区块都是一个街区。 The Bitmap city on Bitcoin: every block is a district.",
  openGraph: { siteName: "unimap", locale: "zh_CN", type: "website" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <LangProvider>
          <SessionProvider>
            <BlockWatch>
              <Header />
              <DemoBanner />
              <main>{children}</main>
              <Footer />
            </BlockWatch>
          </SessionProvider>
        </LangProvider>
      </body>
    </html>
  );
}
