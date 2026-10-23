import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import type { ReactNode } from "react";

import { DownloadsDrawer } from "@/components/downloads/downloads-drawer";
import { FirstRunDialog } from "@/components/first-run-dialog";
import { RateLimitBanner } from "@/components/rate-limit-banner";
import { SiteHeader } from "@/components/site-header";

import { copy } from "@/lib/copy";

import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: copy.pageTitle,
  description: copy.pageDescription,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // Dark-mode-first (spec §10).
    <html lang="en" className={`dark ${inter.variable} ${geistMono.variable}`}>
      <body className="bg-glow min-h-dvh antialiased">
        <Providers>
          <RateLimitBanner />
          <SiteHeader />
          <main className="mx-auto w-full max-w-[1200px] px-4 py-10">{children}</main>
          <DownloadsDrawer />
          <FirstRunDialog />
        </Providers>
      </body>
    </html>
  );
}

