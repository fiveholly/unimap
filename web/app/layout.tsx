import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import "./globals.css";
import { DemoBanner } from "@/components/DemoBanner";
import { Header } from "@/components/Header";
import { SessionProvider } from "@/components/Session";
import { SITE_URL } from "@/lib/share";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "unimap",
  description: "比特币上的 Bitmap 城市：每一个区块都是一个街区。",
  openGraph: { siteName: "unimap", locale: "zh_CN", type: "website" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <SessionProvider>
          <Header />
          <DemoBanner />
          <main>{children}</main>
          <footer className="footer">
            <span className="mono">unimap</span>
            <span>比特币上的 Bitmap 城市</span>
          </footer>
        </SessionProvider>
      </body>
    </html>
  );
}
