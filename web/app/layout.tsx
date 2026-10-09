import type { Metadata } from "next";

import "./globals.css";
import { Header } from "@/components/Header";
import { SessionProvider } from "@/components/Session";

export const metadata: Metadata = {
  title: "unimap",
  description: "Bitmap districts as communities: every Bitcoin block is a place.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <Header />
          <main className="main">{children}</main>
        </SessionProvider>
      </body>
    </html>
  );
}
