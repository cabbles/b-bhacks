import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { DM_Sans, Fredoka, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { MOCK, MOCK_REFEREE, MOCK_RELAYER } from "@/lib/env";
import { Cow } from "@/components/Cow";

const display = Fredoka({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display" });
const body = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Cash Cow",
  description: "Put testnet AUSD behind a task. An AI referee checks the evidence itself and pays whoever was right.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#FBF8F1" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <header className="sticky top-0 z-10 border-b border-line bg-ink">
          <nav className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-8">
            <Link href="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap font-display text-lg font-bold tracking-tight sm:text-xl">
              <Cow size={30} />
              Cash Cow
            </Link>
            <div className="ml-auto flex gap-2.5 whitespace-nowrap font-display text-[13px] font-medium text-muted sm:gap-6 sm:text-base">
              <Link href="/stake" className="hover:text-fg">Stake</Link>              <Link href="/cohorts" className="hover:text-fg">Market</Link>
              <Link href="/integrity" className="hover:text-fg">Integrity</Link>
            </div>
          </nav>
        </header>
        {MOCK && (
          <div className="bg-human/10 px-4 py-1 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-human">
            Mock: {MOCK_RELAYER && MOCK_REFEREE ? "relayer + referee" : MOCK_RELAYER ? "relayer" : "referee"} on fixtures
          </div>
        )}
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-14">{children}</main>
        <footer className="mx-auto max-w-6xl border-t border-line px-4 py-6 text-sm text-muted sm:px-8">
          Testnet only · Base Sepolia · tokens have no value · no one can withdraw stakes, including the operator
        </footer>
      </body>
    </html>
  );
}
