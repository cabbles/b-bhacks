import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { MOCK, MOCK_REFEREE, MOCK_RELAYER } from "@/lib/env";

export const metadata: Metadata = {
  title: "AI Referee",
  description: "Stake testnet AUSD on finishing something. An AI referee checks the evidence itself.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#09090b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
          <nav className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3 text-sm">
            <Link href="/" className="font-black tracking-tight text-lime-300">
              🏁 AI Referee
            </Link>
            <div className="ml-auto flex gap-4 text-zinc-300">
              <Link href="/stake" className="hover:text-white">Stake</Link>
              <Link href="/cohorts/1" className="hover:text-white">Board</Link>
              <Link href="/fool" className="hover:text-white">Fool the Ref</Link>
            </div>
          </nav>
        </header>
        {MOCK && (
          <div className="bg-amber-500/15 px-4 py-1 text-center text-xs text-amber-300">
            Mock mode: {MOCK_RELAYER && MOCK_REFEREE ? "relayer and referee" : MOCK_RELAYER ? "relayer" : "referee"} not
            configured, showing fixtures.
          </div>
        )}
        <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-3xl px-4 pb-10 pt-4 text-xs text-zinc-500">
          Testnet only (Base Sepolia). Tokens have no value. Nobody, including the operator, can withdraw stakes.
        </footer>
      </body>
    </html>
  );
}
