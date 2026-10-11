import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { IBM_Plex_Mono, IBM_Plex_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { MOCK, MOCK_REFEREE, MOCK_RELAYER } from "@/lib/env";

const display = Space_Grotesk({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-display" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "AI Referee",
  description: "Stake testnet AUSD on finishing something. An AI referee checks the evidence itself.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0D0F12" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <header className="sticky top-0 z-10 border-b border-line bg-ink/90 backdrop-blur">
          <nav className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-8">
            <Link href="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap font-display text-lg font-bold tracking-tight">
              <span className="inline-block h-3 w-3 bg-accent" aria-hidden="true" />
              AI Referee
            </Link>
            <div className="ml-auto flex gap-3 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.12em] text-muted sm:gap-5 sm:text-[11px] sm:tracking-[0.16em]">
              <Link href="/stake" className="hover:text-fg">Stake</Link>
              <Link href="/cohorts/1" className="hover:text-fg">Board</Link>
              <Link href="/fool" className="hover:text-fg">Fool&nbsp;the&nbsp;Ref</Link>
            </div>
          </nav>
        </header>
        {MOCK && (
          <div className="border-b border-line px-4 py-1 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-human">
            Mock: {MOCK_RELAYER && MOCK_REFEREE ? "relayer + referee" : MOCK_RELAYER ? "relayer" : "referee"} on fixtures
          </div>
        )}
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-14">{children}</main>
        <footer className="mx-auto max-w-6xl border-t border-line px-4 py-6 font-mono text-[11px] uppercase tracking-[0.14em] text-muted sm:px-8">
          Testnet only · Base Sepolia · tokens have no value · no one can withdraw stakes, including the operator
        </footer>
      </body>
    </html>
  );
}
